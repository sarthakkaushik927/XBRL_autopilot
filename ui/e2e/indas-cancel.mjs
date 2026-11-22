// Auto-tag can be cancelled and continued (PR #15 review chat), dev app + backend, no AI:
// New project → client workbook → Auto-tag → Cancel part-way (the lines done keep their tags, nothing else changes) →
// the button says "Continue auto-tag (N left)" → Continue asks only for the rest → every line has suggestions.
// Usage: node e2e/indas-cancel.mjs <port> <screenshotDir> <workbook.xls|xlsx>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { newProject } from './indas-new-project.mjs'
const [port, outDir, workbook] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let i = 0; i < 240; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page' && t.url.startsWith('http'))) break } catch {} await sleep(500) }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pending = new Map(); const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 300) || m.params.exceptionDetails.text)
})
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description }
const waitFor = async (expr, label, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(300) } throw new Error('timeout: ' + label) }
const shot = async (name) => { await send('Page.bringToFront'); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, name), Buffer.from(r.result.data, 'base64')); console.log('  screenshot', name) }
const S = 'window.__xap_test__.indas.getState()'
const J = JSON.stringify
const failures = []
const check = (ok, what, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', what, detail ? '— ' + detail : ''); if (!ok) failures.push(what) }
const withSuggestions = `${S}.rows.filter(r => r.suggestions.length).length`
const button = `document.querySelector('[data-testid="auto-tag"]').textContent.trim()`

await send('Runtime.enable')
await send('Page.enable')
await waitFor(`!!window.__xap_test__?.indas && !!document.querySelector('[data-testid="activity-new-project"]')`, 'start screen', 120000)
await waitFor(`window.xap.sidecar.status().then(s => s.state === 'ready')`, 'backend connected', 60000)
await ev(`window.xap.settings.update({ aiConsent: false }).then(() => true)`)
check(await newProject(ev, waitFor, 'activity-new-project', { company: 'Synthetic Cancel Private Limited', cin: 'U72200KA2010PTC654321', start: '2025-04-01', end: '2026-03-31' }), 'New project')
await ev(`${S}.upload(${J(workbook)})`)
await waitFor(`${S}.busy === null && ${S}.transform !== null`, 'transform', 240000)
const total = await ev(`${S}.rows.length`)

// Auto-tag, then Cancel once the first sheets are done
await ev(`document.querySelector('[data-testid="auto-tag"]').click(), true`)
await waitFor(`(${S}.progress?.done ?? 0) >= 40`, 'some progress', 300000)
check(await ev(`!!document.querySelector('[data-testid="busy-cancel"]')`), 'the overlay offers Cancel during Auto-tag')
await ev(`document.querySelector('[data-testid="busy-cancel"]').click(), true`)
check(/Cancelling/.test(await ev(`${S}.step`)), 'Cancel says it finishes the current batch', await ev(`${S}.step`))
await waitFor(`${S}.busy === null`, 'cancelled', 120000)
const after = await ev(withSuggestions)
check(after > 0 && after < total, 'a cancelled run keeps the lines it got (and only those)', `${after}/${total} lines`)
check(await ev(`${S}.rows.filter(r => r.suggestions.length).every(r => r.concept)`), 'the lines it got are tagged')
check(await ev(`!document.querySelector('[data-testid="busy-overlay"]')`), 'the editor is usable again')
const label = await ev(button)
check(/^Continue auto-tag \(\d+ left\)$/.test(label), 'the button offers to continue', label)
await shot('cancel-1-continue.png')

// Continue: only the rest is asked for
await ev(`document.querySelector('[data-testid="auto-tag"]').click(), true`)
await waitFor(`${S}.busy !== null`, 'continue started', 10000)
const firstTotal = await ev(`${S}.progress?.total ?? 0`)
check(firstTotal > 0 && firstTotal < total, 'Continue asks only for the lines left', `${firstTotal} to do`)
await waitFor(`${S}.busy === null`, 'continued', 600000)
check((await ev(withSuggestions)) === total, 'after Continue every line has suggestions', `${await ev(withSuggestions)}/${total}`)
check((await ev(button)) === 'Auto-tag', 'the button is back to Auto-tag', await ev(button))
check(errors.length === 0, 'no uncaught renderer errors', errors.join(' | '))
await ev(`${S}.close()`)
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
ws.close()
process.exit(failures.length ? 1 : 0)
