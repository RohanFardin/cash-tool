import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readSheet } from 'read-excel-file/node'

// Optional real-browser check using an installed Chromium/Chrome executable.
// All pages and credentials come from check-pages.mjs's local fixture.
export async function checkMobileLayout({ appUrl, adminHeaders, userHeaders }) {
  const editingModeChanges = []
  const browser = spawn(process.env.CASH_TOOL_BROWSER, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-port=4320', `--user-data-dir=${resolve('.next-page-check/browser-profile')}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })
  let socket
  let send
  try {
    let version
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { version = await (await fetch('http://127.0.0.1:4320/json/version', { signal: AbortSignal.timeout(500) })).json(); break }
      catch { await new Promise((done) => setTimeout(done, 250)) }
    }
    assert.ok(version?.webSocketDebuggerUrl, 'headless browser started')
    socket = new WebSocket(version.webSocketDebuggerUrl)
    await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    let nextId = 0
    const pending = new Map()
    const browserErrors = []
    socket.addEventListener('message', (event) => {
      const reply = JSON.parse(event.data)
      if (reply.method === 'Runtime.exceptionThrown') browserErrors.push(reply.params.exceptionDetails.exception?.description || reply.params.exceptionDetails.text)
      if (!pending.has(reply.id)) return
      const { done, reject } = pending.get(reply.id)
      pending.delete(reply.id)
      if (reply.error) reject(new Error(reply.error.message)); else done(reply.result)
    })
    send = (method, params = {}, sessionId) => new Promise((done, reject) => {
      const id = ++nextId
      pending.set(id, { done, reject })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    const page = async (method, params) => {
      const result = await send(method, params, sessionId)
      if (method === 'Page.navigate') {
        // Streamed Next.js content can exist inside a hidden loading segment.
        // Wait for the page to become visible before measuring any controls.
        await waitFor(`location.href === ${JSON.stringify(params.url)} && document.readyState === 'complete' && getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() === '#0b6b57' && document.querySelector('.app-content .page-stack')?.getBoundingClientRect().width > 0`)
      }
      return result
    }
    const evaluate = async (expression) => {
      const value = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!value.exceptionDetails, value.exceptionDetails?.text)
      return value.result.value
    }
    const waitFor = async (expression) => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (await evaluate(expression)) return
        await new Promise((done) => setTimeout(done, 250))
      }
      console.error(JSON.stringify({ browserErrors, page: await evaluate("({url: location.href, title: document.title, inputKeys: Object.getOwnPropertyNames(document.querySelector('#credit .search-field input') || {})})") }))
      assert.fail(`Browser condition did not become true: ${expression}`)
    }
    await page('Page.enable')
    await page('Runtime.enable')
    await page('Network.enable')
    await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await mkdir('.next-page-check/screenshots', { recursive: true })
    for (const [path, headers, selector, name] of [
      ['/admin/summary', adminHeaders, '.summary-table', 'admin-summary'],
      ['/admin/cash-sales', adminHeaders, '.cash-history-table', 'admin-cash-sales'],
      ['/cash-sales', userHeaders, '.cash-history-table', 'user-cash-sales'],
    ]) {
      const split = headers.cookie.indexOf('=')
      await page('Network.setCookie', { name: headers.cookie.slice(0, split), value: headers.cookie.slice(split + 1), url: appUrl })
      await page('Page.navigate', { url: appUrl + path })
      let ready = false
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const check = await page('Runtime.evaluate', { expression: `document.readyState === 'complete' && Boolean(document.querySelector('${selector}'))`, returnByValue: true })
        if (check.result.value) { ready = true; break }
        await new Promise((done) => setTimeout(done, 250))
      }
      assert.ok(ready, `${path} loaded its table`)
      const result = await page('Runtime.evaluate', { expression: `(() => {
        const table = document.querySelector('${selector}');
        const wrapper = table.closest('.ledger-table-wrap');
        return { viewport: innerWidth, clientWidth: wrapper.clientWidth, scrollWidth: wrapper.scrollWidth,
          alignment: [...table.querySelectorAll('th, td')].map(cell => getComputedStyle(cell).textAlign),
          tableRight: table.getBoundingClientRect().right, wrapperRight: wrapper.getBoundingClientRect().right,
          tableWidth: getComputedStyle(table).width, tableMinWidth: getComputedStyle(table).minWidth,
          wrapperWidth: getComputedStyle(wrapper).width, media: matchMedia('(max-width: 760px)').matches,
          styleUrls: [...document.styleSheets].map(sheet => sheet.href),
          firstColumnsRight: [...table.querySelectorAll('thead th')].slice(0, 2).map(cell => cell.getBoundingClientRect().right),
          recordsLeft: table.querySelector('thead th:nth-child(3)').getBoundingClientRect().left };
      })()`, returnByValue: true })
      const layout = result.result.value
      assert.equal(layout.viewport, 390)
      if (selector === '.summary-table') {
        if (layout.scrollWidth <= layout.clientWidth) {
          const screenshot = await page('Page.captureScreenshot', { format: 'png' })
          await writeFile('.next-page-check/screenshots/layout-failure.png', Buffer.from(screenshot.data, 'base64'))
        }
        assert.ok(layout.scrollWidth > layout.clientWidth, `Records are available by horizontal scrolling: ${JSON.stringify(layout)}`)
        assert.ok(layout.firstColumnsRight.every(right => right <= layout.wrapperRight + 1), 'Section and Total Amount fit the initial view')
        assert.ok(layout.recordsLeft >= layout.wrapperRight - 2, 'Records starts outside the initial view')
        await evaluate("document.querySelector('.summary-table-wrap').scrollLeft = 9999")
        assert.ok(await evaluate("document.querySelector('.summary-table thead th:nth-child(3)').getBoundingClientRect().right <= document.querySelector('.summary-table-wrap').getBoundingClientRect().right + 1"), 'scrolling reveals Records')
        await evaluate("document.querySelector('.summary-table-wrap').scrollLeft = 0")
      } else {
        assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${path} fits without horizontal scrolling`)
        assert.ok(layout.tableRight <= layout.viewport, `${path} amounts are inside the viewport`)
      }
      assert.ok(layout.alignment.every((alignment) => alignment === 'left'), `${path} columns and amounts align left`)
      const screenshot = await page('Page.captureScreenshot', { format: 'png' })
      await writeFile(`.next-page-check/screenshots/${name}.png`, Buffer.from(screenshot.data, 'base64'))
      console.log(`PASS mobile ${path}: ${selector === '.summary-table' ? 'Section/Amount visible, Records revealed by scrolling' : 'fits 390px screen'}; columns align left`)
    }
    const split = adminHeaders.cookie.indexOf('=')
    await page('Network.setCookie', { name: adminHeaders.cookie.slice(0, split), value: adminHeaders.cookie.slice(split + 1), url: appUrl })
    await page('Page.navigate', { url: appUrl + '/admin/dashboard' })
    await waitFor("document.readyState === 'complete' && Boolean(document.querySelector('#credit .search-field input'))")
    await waitFor("Object.keys(document.querySelector('#credit .search-field input')).some(key => key.startsWith('__reactProps$'))")
    await evaluate(`window.setField = (input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }`)
    for (const [section, name, types, phone] of [
      ['credit', 'Alice', ['credit_sale', 'credit_recovery'], '01700000001'],
      ['supplier', 'Medicine Company', ['purchase', 'payment'], '01800000001'],
    ]) {
      await evaluate(`document.querySelector('#${section} .search-field input').focus()`)
      await page('Input.insertText', { text: name })
      await waitFor(`Boolean(document.querySelector('#${section} .search-results button'))`)
      await evaluate(`document.querySelector('#${section} .search-results button').click()`)
      await waitFor(`Boolean(document.querySelector('#${section} .portal-entry-form'))`)
      for (const [index, type] of types.entries()) {
        await evaluate(`(() => {
          const form = document.querySelector('#${section} .portal-entry-form');
          form.querySelector('input[value="${type}"]').click();
          setField(form.elements.amount, '${index ? 3 : 12.34}');
          setField(form.elements.phone_number, '${phone}');
          setField(form.elements.description, '${type} contact note');
          form.requestSubmit();
        })()`)
        await waitFor(`document.querySelectorAll('#${section} .staged-delete').length === ${index + 1}`)
      }
    }
    assert.equal(await evaluate("document.querySelectorAll('.staged-delete').length"), 4)
    assert.equal(await evaluate("Boolean(document.querySelector('.entry-shortcuts'))"), false)
    await evaluate("document.querySelector('.submit-actions > button').click()")
    await waitFor("Boolean(document.querySelector('input[name=staged_entries]'))")
    const entries = await evaluate("JSON.parse(document.querySelector('input[name=staged_entries]').value)")
    assert.deepEqual(entries.map((entry) => [entry.kind, entry.party_name, entry.entry_type, entry.amount, entry.phone_number, entry.description]), [
      ['customer', 'Alice', 'credit_sale', 12.34, '01700000001', 'credit_sale contact note'],
      ['customer', 'Alice', 'credit_recovery', 3, '01700000001', 'credit_recovery contact note'],
      ['supplier', 'Medicine Company', 'purchase', 12.34, '01800000001', 'purchase contact note'],
      ['supplier', 'Medicine Company', 'payment', 3, '01800000001', 'payment contact note'],
    ])
    await evaluate("document.querySelector('.confirm-modal button[type=button]').click()")
    await waitFor("!document.querySelector('.confirm-modal')")
    await evaluate("document.querySelector('#credit .staged-delete').click()")
    await waitFor("document.querySelectorAll('.staged-delete').length === 3")
    assert.equal(await evaluate("document.querySelectorAll('#supplier .staged-delete').length"), 2, 'party panels keep independent temporary entries')
    console.log('PASS mobile dashboard forms: customer/supplier search, all entry types, contact snapshots, confirmation payload and temporary deletion')
    await page('Page.navigate', { url: appUrl + '/admin/settings' })
    await waitFor("document.readyState === 'complete' && Boolean(document.querySelector('input[name=current_password]'))")
    const settingsLayout = await evaluate(`({
      viewport: innerWidth, width: document.documentElement.scrollWidth,
      fieldAlignment: [...document.querySelectorAll('.app-content input, .app-content select')].map(input => getComputedStyle(input).textAlign),
      links: [...document.querySelectorAll('.sidebar-footer a, .sidebar-footer button')].map(link => link.textContent)
    })`)
    assert.ok(settingsLayout.width <= settingsLayout.viewport, 'password settings fit the phone screen')
    assert.ok(settingsLayout.fieldAlignment.every(value => value === 'left'))
    assert.deepEqual(settingsLayout.links, ['Settings', 'Logout'])
    await waitFor("Object.keys(document.querySelector('.editing-switch')).some(key => key.startsWith('__reactProps$'))")
    for (const width of [320, 390]) {
      await page('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true })
      await evaluate("document.querySelector('#download-report > button').click()")
      await waitFor("Boolean(document.querySelector('#download-report [role=dialog] input[name=from]'))")
      const downloadLayout = await evaluate(`(() => {
        const dialog = document.querySelector('#download-report [role=dialog]');
        const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height }; };
        return { width: document.documentElement.scrollWidth, from: rect(dialog.querySelector('[name=from]')), to: rect(dialog.querySelector('[name=to]')),
          fields: [...dialog.querySelectorAll('input, button')].map(rect), focused: document.activeElement.name };
      })()`)
      assert.ok(downloadLayout.width <= width, 'the download dialog fits the phone screen')
      assert.equal(downloadLayout.focused, 'from', 'download form moves focus into the dialog')
      assert.ok(downloadLayout.fields.every(rect => rect.left >= 0 && rect.right <= width), 'download fields and actions stay inside the screen')
      assert.ok(Math.abs(downloadLayout.from.width - downloadLayout.to.width) <= 1 && Math.abs(downloadLayout.from.top - downloadLayout.to.top) <= 1, 'download date fields form an equal-width pair')
      assert.ok(downloadLayout.from.height >= 44 && downloadLayout.to.height >= 44)
      const screenshot = await page('Page.captureScreenshot', { format: 'png' })
      await writeFile(`.next-page-check/screenshots/download-report-${width}.png`, Buffer.from(screenshot.data, 'base64'))
      await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
      await waitFor("!document.querySelector('#download-report [role=dialog]')")
      assert.equal(await evaluate("document.activeElement === document.querySelector('#download-report > button')"), true, 'canceling returns focus to Download report')
    }
    await mkdir('.next-page-check/downloads', { recursive: true })
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve('.next-page-check/downloads') })
    await evaluate("document.querySelector('#download-report > button').click()")
    await waitFor("Boolean(document.querySelector('#download-report [role=dialog] input[name=to]'))")
    const downloadDate = await evaluate("document.querySelector('#download-report input[name=to]').value")
    const downloadFile = resolve(`.next-page-check/downloads/ozi-pharma-report-${downloadDate}-to-${downloadDate}.xlsx`)
    await rm(downloadFile, { force: true })
    async function setDownloadDate(name, value) {
      await evaluate(`(() => {
        const input = document.querySelector('#download-report input[name=${name}]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`)
    }
    await setDownloadDate('from', downloadDate)
    const beforeDate = new Date(`${downloadDate}T00:00:00Z`)
    beforeDate.setUTCDate(beforeDate.getUTCDate() - 1)
    await setDownloadDate('to', beforeDate.toISOString().slice(0, 10))
    await evaluate("document.querySelector('#download-report button[type=submit]').click()")
    await waitFor("document.querySelector('#download-report [role=status]')?.textContent.includes('Date From must be on or before Date To.')")
    await setDownloadDate('to', downloadDate)
    await evaluate("document.querySelector('#download-report button[type=submit]').click()")
    await waitFor("!document.querySelector('#download-report [role=dialog]') && document.querySelector('#download-report [role=status]')?.textContent.includes('downloaded')")
    let downloaded
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { downloaded = await readFile(downloadFile); break }
      catch { await new Promise(done => setTimeout(done, 250)) }
    }
    assert.ok(downloaded, 'pressing OK saves an actual Excel file')
    const downloadedRows = await readSheet(downloaded)
    assert.equal(downloadedRows.length, 2)
    assert.equal(downloadedRows[1][0].toISOString().slice(0, 10), downloadDate)
    assert.equal(downloadedRows[1][1], 250, 'frontend download includes carried closing cash')
    console.log('PASS mobile report download: date picker at 320px/390px, focus and cancellation, invalid range feedback, and an Excel file saved through the OK button')
    await evaluate(`(() => {
      const select = document.querySelector('#user-names select');
      select.value = select.options[1].value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await waitFor("document.querySelector('#user-names input[name=full_name]').value.length > 0")
    for (const enabled of [false, true, false, true]) {
      await evaluate("document.querySelector('.editing-switch').click()")
      await waitFor(`document.querySelector('.editing-switch').getAttribute('aria-checked') === '${enabled}' && !document.querySelector('.editing-switch').disabled`)
      editingModeChanges.push(enabled)
      await page('Page.navigate', { url: appUrl + '/admin/supplier' })
      await waitFor("document.readyState === 'complete' && Boolean(document.querySelector('.ledger-table'))")
      assert.equal(await evaluate("Boolean(document.querySelector('.table-edit'))"), enabled, 'saved edit mode applies after navigation')
      await page('Page.navigate', { url: appUrl + '/admin/settings' })
      await waitFor(`Boolean(document.querySelector('.editing-switch')) && document.querySelector('.editing-switch').getAttribute('aria-checked') === '${enabled}'`)
      await waitFor("Object.keys(document.querySelector('.editing-switch')).some(key => key.startsWith('__reactProps$'))")
    }
    console.log('PASS mobile admin settings: editing can be turned off/on repeatedly, persists between pages and gates Edit buttons; name selection prefills the current display name')
    await page('Page.navigate', { url: appUrl + '/admin/summary' })
    await waitFor("Boolean(document.querySelector('.page-heading .button.danger'))")
    await waitFor("Object.keys(document.querySelector('.page-heading .button.danger')).some(key => key.startsWith('__reactProps$'))")
    await evaluate("document.querySelector('.page-heading .button.danger').click()")
    await waitFor("Boolean(document.querySelector('input[name=confirm_date]'))")
    assert.equal(await evaluate("document.querySelector('.confirm-modal button[type=submit]').disabled"), true)
    const selectedDate = await evaluate("document.querySelector('.confirm-modal input[name=business_date]').value")
    const reportDate = await evaluate("document.querySelector('.history-filter input[name=date]').value")
    assert.equal(selectedDate, reportDate, 'deletion confirmation belongs to the displayed report date')
    await page('Input.insertText', { text: selectedDate })
    await waitFor("!document.querySelector('.confirm-modal button[type=submit]').disabled")
    await evaluate("document.querySelector('.confirm-modal .button.ghost').click()")
    await waitFor("!document.querySelector('.confirm-modal')")
    assert.ok(await evaluate("Boolean(document.querySelector('.summary-table'))"), 'canceling deletion preserves the report')
    console.log('PASS mobile settings and report deletion: left-aligned forms, Settings above Logout, selected-date confirmation, disabled delete until confirmed and cancellation')
    for (const width of [320, 390]) {
      await page('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true })
      for (const [prefix, headers] of [['', userHeaders], ['/admin', adminHeaders]]) {
        const split = headers.cookie.indexOf('=')
        await page('Network.setCookie', { name: headers.cookie.slice(0, split), value: headers.cookie.slice(split + 1), url: appUrl })
        for (const path of ['/cash-sales', '/credit-recovery', '/supplier', '/local-supplier', '/overhead-cost', '/conveyance']) {
          const url = `${appUrl}${prefix}${path}?from=2020-01-01&to=${selectedDate}`
          await page('Page.navigate', { url })
          await waitFor(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && Boolean(document.querySelector('.date-range-filter'))`)
          const controls = await evaluate(`(() => {
            const form = document.querySelector('.date-range-filter');
            const rect = element => { const r = element.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, width: r.width, height: r.height }; };
            return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
              from: rect(form.elements.from), to: rect(form.elements.to), values: [form.elements.from.value, form.elements.to.value],
              buttons: [...form.querySelectorAll('.filter-actions .button')].map(rect),
              fields: [...form.querySelectorAll('input, select')].map(rect) };
          })()`)
          assert.equal(controls.viewport, width)
          assert.ok(controls.pageWidth <= width + 1, `${prefix}${path} does not overflow a ${width}px phone`)
          assert.ok(Math.abs(controls.from.top - controls.to.top) <= 1 && Math.abs(controls.from.width - controls.to.width) <= 1, 'dates form an equal-width pair')
          assert.ok(controls.from.right <= controls.to.left, 'dates sit side by side')
          assert.deepEqual(controls.values, ['2020-01-01', selectedDate])
          assert.ok(controls.fields.every(field => field.left >= 0 && field.right <= width), 'date and party fields fit the screen')
          assert.ok(controls.buttons.every(button => button.height >= 44) && Math.abs(controls.buttons[0].top - controls.buttons[1].top) <= 1, `${prefix}${path} at ${width}px: Apply/Reset are touch-sized and side by side: ${JSON.stringify(controls.buttons)}`)
          if (width === 390 && path === '/credit-recovery') {
            const screenshot = await page('Page.captureScreenshot', { format: 'png' })
            await writeFile(`.next-page-check/screenshots/${prefix ? 'admin' : 'user'}-date-filters.png`, Buffer.from(screenshot.data, 'base64'))
          }
        }
      }
      const split = adminHeaders.cookie.indexOf('=')
      await page('Network.setCookie', { name: adminHeaders.cookie.slice(0, split), value: adminHeaders.cookie.slice(split + 1), url: appUrl })
      for (const path of ['/admin/dashboard', '/admin/summary']) {
        await page('Page.navigate', { url: appUrl + path })
        await waitFor(`location.href === ${JSON.stringify(appUrl + path)} && document.readyState === 'complete' && Boolean(document.querySelector('.report-date-filter'))`)
        assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth && document.querySelector('.report-date-filter input').getBoundingClientRect().right <= innerWidth"), 'single report-date controls fit mobile screens')
      }
      for (const [path, headers] of [['/admin/summary', adminHeaders], ['/summary', userHeaders]]) {
        const split = headers.cookie.indexOf('=')
        await page('Network.setCookie', { name: headers.cookie.slice(0, split), value: headers.cookie.slice(split + 1), url: appUrl })
        await page('Page.navigate', { url: appUrl + path })
        await waitFor("document.querySelector('.summary-cash-balances')?.getBoundingClientRect().width > 0")
        const cashCards = await evaluate(`(() => {
          const cards = document.querySelector('.summary-cash-balances');
          const totals = document.querySelector('.summary-table, .stat-grid');
          return { labels: [...cards.querySelectorAll('span')].map(node => node.textContent),
            amounts: [...cards.querySelectorAll('strong')].map(node => Number(node.textContent.replace(/[^0-9.-]/g, ''))),
            beforeTotals: cards.getBoundingClientRect().bottom <= totals.getBoundingClientRect().top,
            fits: document.documentElement.scrollWidth <= innerWidth && [...cards.querySelectorAll('strong')].every(node => node.getBoundingClientRect().right <= innerWidth) };
        })()`)
        assert.deepEqual(cashCards.labels, ['Yesterday’s Cash in Hand', 'Cash in Hand'])
        assert.deepEqual(cashCards.amounts, [150, 250])
        assert.ok(cashCards.beforeTotals && cashCards.fits, `${path} cash balances appear above totals and fit a ${width}px phone`)
      }
    }
    console.log('PASS all user/admin date filters at 320px and 390px: paired dates, retained values, full-width name filters, touch-sized actions and no page overflow')
    return { editingModeChanges }
  } finally {
    if (send && socket?.readyState === WebSocket.OPEN) {
      await send('Browser.close').catch(() => {})
      socket.close()
    } else browser.kill()
  }
}
