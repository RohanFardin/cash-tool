import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { businessDate } from '../src/lib/format.js'

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
        await waitFor(`location.href === ${JSON.stringify(params.url)} && document.readyState === 'complete' && getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() === '#0d8045' && document.querySelector('.app-content .page-stack')?.getBoundingClientRect().width > 0`)
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
    // The reused profile keeps localStorage. An activity time left by an older
    // run would otherwise sign out the first page as idle.
    await page('Storage.clearDataForOrigin', { origin: new URL(appUrl).origin, storageTypes: 'local_storage' })
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
      const layout = await evaluate(`(() => {
        const card = document.querySelector('#download-backup');
        const button = card.querySelector('button');
        const rect = button.getBoundingClientRect();
        return { pageWidth: document.documentElement.scrollWidth, left: rect.left, right: rect.right, height: rect.height, hasDates: Boolean(card.querySelector('input[type=date]')) };
      })()`)
      assert.ok(layout.pageWidth <= width && layout.left >= 0 && layout.right <= width && layout.height >= 44, 'backup action fits the phone and is touch-sized')
      assert.equal(layout.hasDates, false, 'database backup has no date-range selection')
      await evaluate("document.querySelector('#download-backup').scrollIntoView({ block: 'center' })")
      const screenshot = await page('Page.captureScreenshot', { format: 'png' })
      await writeFile(`.next-page-check/screenshots/download-backup-${width}.png`, Buffer.from(screenshot.data, 'base64'))
    }
    if (!await evaluate("document.querySelector('#download-backup button').disabled")) {
      const downloadDirectory = '.next-page-check/downloads'
      await mkdir(downloadDirectory, { recursive: true })
      const before = new Set(await readdir(downloadDirectory))
      await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve(downloadDirectory) })
      await evaluate("document.querySelector('#download-backup button').click()")
      await waitFor("document.querySelector('#download-backup [role=status]')?.textContent.includes('downloaded')")
      let downloaded
      for (let attempt = 0; attempt < 40; attempt++) {
        const file = (await readdir(downloadDirectory)).find(name => !before.has(name) && name.startsWith('joarder-pharmacy-backup-') && name.endsWith('.dump'))
        if (file) { downloaded = await readFile(resolve(downloadDirectory, file)); break }
        await new Promise(done => setTimeout(done, 250))
      }
      assert.ok(downloaded, 'Download Backup saves a file')
      assert.equal(downloaded.subarray(0, 5).toString(), 'PGDMP', 'browser saves a real PostgreSQL archive')
      console.log('PASS mobile backup: one-click native archive download, no date filter, 320px/390px layout and success feedback')
    }
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
              fields: [...form.querySelectorAll('input:not([type=hidden]), select, .person-select-trigger')].map(rect) };
          })()`)
          assert.equal(controls.viewport, width)
          assert.ok(controls.pageWidth <= width + 1, `${prefix}${path} does not overflow a ${width}px phone`)
          assert.ok(Math.abs(controls.from.top - controls.to.top) <= 1 && Math.abs(controls.from.width - controls.to.width) <= 1, 'dates form an equal-width pair')
          assert.ok(controls.from.right <= controls.to.left, 'dates sit side by side')
          assert.deepEqual(controls.values, ['2020-01-01', selectedDate])
          assert.ok(controls.fields.every(field => field.left >= 0 && field.right <= width), 'date and party fields fit the screen')
          assert.ok(controls.buttons.every(button => button.height >= 44) && Math.abs(controls.buttons[0].top - controls.buttons[1].top) <= 1, `${prefix}${path} at ${width}px: Apply/Reset are touch-sized and side by side: ${JSON.stringify(controls.buttons)}`)
          if (path === '/credit-recovery') {
            await waitFor("Object.keys(document.querySelector('.person-select-trigger') || {}).some(key => key.startsWith('__reactProps$'))")
            await evaluate("document.querySelector('.person-select-trigger').click()")
            await waitFor("Boolean(document.querySelector('.person-select-options'))")
            const menu = await evaluate(`(() => {
              const list = document.querySelector('.person-select-options');
              const rect = list.getBoundingClientRect();
              return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
                options: [...list.querySelectorAll('[role=option]')].map(option => ({ name: option.textContent.trim(), background: getComputedStyle(option).backgroundColor, color: getComputedStyle(option).color })) };
            })()`)
            assert.deepEqual(menu.options.map(option => option.name), ['All people', 'Alice', 'Bob', 'New Person'])
            assert.equal(menu.options[1].background, 'rgb(180, 35, 24)')
            assert.equal(menu.options[1].color, 'rgb(255, 255, 255)', 'only the unpaid person has a red background with white text')
            assert.ok([menu.options[0], ...menu.options.slice(2)].every(option => option.background !== 'rgb(180, 35, 24)' && option.color !== 'rgb(255, 255, 255)'), 'all-people, zero balances and overpayments keep normal colors')
            assert.ok(menu.left >= 0 && menu.right <= width && menu.top >= 0 && menu.bottom <= 844, 'the colored dropdown stays inside the phone viewport')
            const colorsScreenshot = await page('Page.captureScreenshot', { format: 'png' })
            await writeFile(`.next-page-check/screenshots/${prefix ? 'admin' : 'user'}-due-colors-${width}.png`, Buffer.from(colorsScreenshot.data, 'base64'))
            await evaluate("[...document.querySelectorAll('.person-select-option')].find(option => option.textContent.trim() === 'Alice').click()")
            await waitFor("document.querySelector('.date-range-filter input[name=party]').value === '1' && !document.querySelector('.person-select-options')")
            assert.ok(await evaluate("document.querySelector('.person-select-trigger').classList.contains('has-due')"))
            if (width === 390) {
              const press = async (key, code = key) => {
                await page('Input.dispatchKeyEvent', { type: 'keyDown', key, code })
                await page('Input.dispatchKeyEvent', { type: 'keyUp', key, code })
              }
              await press('Enter')
              await waitFor("document.querySelector('.person-select-trigger').getAttribute('aria-expanded') === 'true'")
              await press('End')
              await press('Escape')
              assert.equal(await evaluate("document.querySelector('input[name=party]').value"), '1', 'Escape cancels keyboard exploration without changing the filter')
              await evaluate("document.querySelector('.date-range-filter .filter-actions button').click()")
              await waitFor("new URL(location.href).searchParams.get('party') === '1' && document.querySelector('.ledger-table tbody')?.textContent.includes('Alice') && !document.querySelector('.ledger-table tbody')?.textContent.includes('Bob')")
              assert.deepEqual(await evaluate("[document.querySelector('input[name=from]').value, document.querySelector('input[name=to]').value]"), ['2020-01-01', selectedDate])
              await evaluate("document.querySelector('.date-range-filter .filter-actions a').click()")
              await waitFor("!location.search && document.querySelector('.person-select-trigger')?.textContent.includes('All people')")
              await waitFor("Object.keys(document.querySelector('.person-select-trigger') || {}).some(key => key.startsWith('__reactProps$'))")
              await evaluate("document.querySelector('.person-select-trigger').focus()")
              await press('b', 'KeyB')
              await waitFor("Boolean(document.querySelector('.person-select-options'))")
              await press('Enter')
              await waitFor("document.querySelector('input[name=party]').value === '2'")
              assert.ok(await evaluate("!document.querySelector('.person-select-trigger').classList.contains('has-due')"), 'keyboard selection of a paid person uses normal colors')
            }
          }
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
        assert.deepEqual(cashCards.labels, ['Opening Balance', 'Closing Balance'])
        assert.deepEqual(cashCards.amounts, [150, 250])
        assert.ok(cashCards.beforeTotals && cashCards.fits, `${path} cash balances appear above totals and fit a ${width}px phone`)
      }
    }
    console.log('PASS all user/admin date filters at 320px and 390px: paired dates, retained values, full-width name filters, touch-sized actions and no page overflow')
    console.log('PASS due colors for both roles: red/white unpaid names, normal zero/overpaid names, keyboard selection, Escape, Apply, date retention and Reset')
    await page('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: true })
    const adminSplit = adminHeaders.cookie.indexOf('=')
    await page('Network.setCookie', { name: adminHeaders.cookie.slice(0, adminSplit), value: adminHeaders.cookie.slice(adminSplit + 1), url: appUrl })
    await page('Page.navigate', { url: appUrl + '/admin/supplier' })
    const openPurchasePayment = "[...document.querySelectorAll('.page-heading button')].find(button => button.textContent.includes('Purchase & Payment'))"
    await waitFor(`Object.keys(${openPurchasePayment} || {}).some(key => key.startsWith('__reactProps$'))`)
    await evaluate(`${openPurchasePayment}.click()`)
    await waitFor("Boolean(document.querySelector('.modal select[name=supplier_id]'))")
    const purchaseForm = await evaluate(`(() => {
      const modal = document.querySelector('.modal');
      const rect = element => { const r = element.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right }; };
      return { title: modal.querySelector('h2').textContent, date: modal.querySelector('input[name=business_date]').value,
        companies: [...modal.querySelectorAll('select[name=supplier_id] option')].map(option => option.textContent),
        modal: rect(modal), phone: rect(modal.querySelector('input[name=phone_number]')), purchase: rect(modal.querySelector('input[name=purchase]')), payment: rect(modal.querySelector('input[name=payment]')),
        pageWidth: document.documentElement.scrollWidth };
    })()`)
    assert.equal(purchaseForm.title, 'Purchase & Payment')
    assert.equal(purchaseForm.date, businessDate(), 'the date starts as today')
    assert.ok(purchaseForm.companies.includes('Medicine Company') && purchaseForm.companies.includes('Other Company'))
    assert.ok(Math.abs(purchaseForm.purchase.top - purchaseForm.payment.top) <= 1 && purchaseForm.purchase.right <= purchaseForm.payment.left, 'purchase and payment sit side by side')
    assert.ok(purchaseForm.modal.left >= 0 && purchaseForm.modal.right <= 320 && purchaseForm.payment.right <= purchaseForm.modal.right && purchaseForm.pageWidth <= 321, 'the form fits a 320px phone')
    assert.ok(purchaseForm.phone.left >= purchaseForm.modal.left && purchaseForm.phone.right <= purchaseForm.modal.right, 'the phone field fits the mobile form')
    // Typing a company that already exists selects it instead of adding a duplicate.
    await evaluate("document.querySelector('.company-add-row input').focus()")
    await page('Input.insertText', { text: 'medicine company' })
    await waitFor("!document.querySelector('.company-add-row button').disabled")
    await evaluate("document.querySelector('.company-add-row button').click()")
    await waitFor("document.querySelector('.modal select[name=supplier_id]').value === '1' && document.querySelector('.company-add-row input').value === ''")
    assert.equal(await evaluate("document.querySelector('.modal input[name=phone_number]').value"), '01810000001', 'selecting an existing name loads its saved phone number')
    const chooseCompany = async (name) => evaluate(`(() => {
      const select = document.querySelector('.modal select[name=supplier_id]');
      select.value = [...select.options].find(option => option.textContent === ${JSON.stringify(name)}).value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await chooseCompany('Other Company')
    await waitFor("document.querySelector('.modal input[name=phone_number]').value === '01820000002'")
    await chooseCompany('New Company')
    await waitFor("document.querySelector('.modal input[name=phone_number]').value === ''")
    await chooseCompany('Medicine Company')
    await evaluate("document.querySelector('.company-add-row input').focus()")
    await page('Input.insertText', { text: 'Mobile Phone Company' })
    await waitFor("document.querySelector('.modal select[name=supplier_id]').value === '' && document.querySelector('.modal input[name=phone_number]').value === '' && !document.querySelector('.modal input[name=phone_number]').readOnly")
    await evaluate("document.querySelector('.company-add-row button').click()")
    await waitFor("document.querySelector('.modal .notice.error')?.textContent.includes('phone number')")
    assert.equal(await evaluate("document.querySelector('.company-add-row input').value"), 'Mobile Phone Company', 'a missing phone keeps the new company name')
    await evaluate("document.querySelector('.modal input[name=phone_number]').focus()")
    await page('Input.insertText', { text: '01830000003' })
    await evaluate("document.querySelector('.company-add-row button').click()")
    await waitFor("document.querySelector('.modal select[name=supplier_id]').selectedOptions[0].textContent === 'Mobile Phone Company' && document.querySelector('.company-add-row input').value === '' && document.querySelector('.modal input[name=phone_number]').value === '01830000003'")
    const purchaseScreenshot = await page('Page.captureScreenshot', { format: 'png' })
    await writeFile('.next-page-check/screenshots/admin-purchase-payment.png', Buffer.from(purchaseScreenshot.data, 'base64'))
    await evaluate("document.querySelector('.modal .button.ghost').click()")
    await waitFor("!document.querySelector('.modal')")
    await evaluate(`${openPurchasePayment}.click()`)
    await waitFor("Boolean(document.querySelector('.modal select[name=supplier_id]'))")
    await chooseCompany('Mobile Phone Company')
    await waitFor("document.querySelector('.modal input[name=phone_number]').value === '01830000003'")
    await evaluate("document.querySelector('.modal input[name=phone_number]').focus(); document.querySelector('.modal input[name=phone_number]').select()")
    await page('Input.insertText', { text: '01840000004' })
    await waitFor("document.querySelector('.modal input[name=phone_number]').value === '01840000004'")
    await evaluate("document.querySelector('.modal button[type=submit]').click()")
    await waitFor("!document.querySelector('.modal') && document.querySelector('.page-heading .notice.success')?.textContent.includes('Company phone number saved.')")
    await page('Page.navigate', { url: appUrl + '/admin/supplier' })
    await waitFor(`Object.keys(${openPurchasePayment} || {}).some(key => key.startsWith('__reactProps$'))`)
    await evaluate(`${openPurchasePayment}.click()`)
    await waitFor("Boolean(document.querySelector('.modal select[name=supplier_id]'))")
    await chooseCompany('Mobile Phone Company')
    await waitFor("document.querySelector('.modal input[name=phone_number]').value === '01840000004'")
    await evaluate("document.querySelector('.modal .button.ghost').click()")
    await waitFor("!document.querySelector('.modal')")
    console.log('PASS mobile purchase & payment: saved phones auto-fill, edits save without amounts and survive reloading, new companies retain their phone, form fits 320px')

    const userSplit = userHeaders.cookie.indexOf('=')
    await page('Network.setCookie', { name: userHeaders.cookie.slice(0, userSplit), value: userHeaders.cookie.slice(userSplit + 1), url: appUrl })
    await page('Page.navigate', { url: appUrl + '/dashboard' })
    await waitFor("Number(localStorage.getItem('cash-tool:last-activity')) > Date.now() - 60000")
    await evaluate("localStorage.setItem('cash-tool:last-activity', String(Date.now() - 61 * 60 * 1000))")
    await send('Page.navigate', { url: appUrl + '/dashboard' }, sessionId)
    await waitFor("location.pathname === '/login' && Boolean(document.querySelector('input[name=username]'))")
    assert.equal(await evaluate("localStorage.getItem('cash-tool:last-activity')"), null, 'signing in again starts a fresh idle period')
    console.log('PASS idle sign-out: pages record activity and a session idle for over an hour returns to sign-in')
    return { editingModeChanges }
  } finally {
    if (send && socket?.readyState === WebSocket.OPEN) {
      await send('Browser.close').catch(() => {})
      socket.close()
    } else browser.kill()
  }
}
