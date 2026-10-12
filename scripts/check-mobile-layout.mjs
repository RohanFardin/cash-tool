import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Optional real-browser check using an installed Chromium/Chrome executable.
// All pages and credentials come from check-pages.mjs's local fixture.
export async function checkMobileLayout({ appUrl, adminHeaders, userHeaders }) {
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
    const page = (method, params) => send(method, params, sessionId)
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
          tableRight: table.getBoundingClientRect().right };
      })()`, returnByValue: true })
      const layout = result.result.value
      assert.equal(layout.viewport, 390)
      assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${path} fits without horizontal scrolling`)
      assert.ok(layout.tableRight <= layout.viewport, `${path} amounts are inside the viewport`)
      assert.ok(layout.alignment.every((alignment) => alignment === 'left'), `${path} columns and amounts align left`)
      const screenshot = await page('Page.captureScreenshot', { format: 'png' })
      await writeFile(`.next-page-check/screenshots/${name}.png`, Buffer.from(screenshot.data, 'base64'))
      console.log(`PASS mobile ${path}: fits 390px screen; all columns align left`)
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
  } finally {
    if (send && socket?.readyState === WebSocket.OPEN) {
      await send('Browser.close').catch(() => {})
      socket.close()
    } else browser.kill()
  }
}
