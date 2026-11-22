// Responsiveness of an Ind AS filing in the editor (PR #15 review: "the application hangs"), dev app + backend
// (make dev-server), no AI. New project → client workbook → Auto-tag → (accepted automatically) → click lines, switch
// sheets and statements, double-click problems; each action is timed until the next painted frame (a freeze).
// Usage: node e2e/indas-perf.mjs <port> <screenshotDir> <workbook.xls|xlsx> [maxMs=600, dev build] [savedProject.axbrl]
// (with a saved, auto-tagged project the run skips New project and the ~3-minute Auto-tag)
// XAP_PERF_AI=1: Auto-tag with the AI pick (the user's AI consent on); the backend then calls Groq (its .env key).
// XAP_PERF_PARALLEL=1: Settings → Faster Auto-tag on (several batches at once); otherwise off, one at a time.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { newProject } from './indas-new-project.mjs'
const [port, outDir, workbook, budget = '600'] = process.argv.slice(2)
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
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, name), Buffer.from(r.result.data, 'base64')); console.log('  screenshot', name) }
const S = 'window.__xap_test__.indas.getState()'
const J = JSON.stringify
const failures = []
const check = (ok, what, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', what, detail ? '— ' + detail : ''); if (!ok) failures.push(what) }

await send('Runtime.enable')
await send('Page.enable')
await send('Page.reload')
await sleep(2000)
await waitFor(`!!window.__xap_test__?.indas && !!document.querySelector('[data-testid="activity-new-project"]')`, 'start screen', 120000)
await waitFor(`window.xap.sidecar.status().then(s => s.state === 'ready')`, 'backend connected', 60000)
const ai = process.env.XAP_PERF_AI === '1'
const parallel = process.env.XAP_PERF_PARALLEL === '1'
await ev(`window.xap.settings.update({ aiConsent: ${ai}, parallelAutoTag: ${parallel} }).then(() => true)`)

const project = process.argv[6]
if (project) {
  await ev(`${S}.openSaved(${J(project)})`)
  await waitFor(`${S}.open && ${S}.busy === null && ${S}.transform !== null`, 'project opened', 60000)
} else {
  check(await newProject(ev, waitFor, 'activity-new-project', { company: 'Synthetic Perf Private Limited', cin: 'U72200KA2010PTC654321', start: '2025-04-01', end: '2026-03-31', level: 'Lakhs' }), 'New project')
  await ev(`${S}.upload(${J(workbook)})`)
  await waitFor(`${S}.busy === null && ${S}.transform !== null`, 'transform', 240000)
}
await waitFor(`!!document.querySelector('[data-testid="univer-host"] canvas')`, 'Excel grid', 30000)
await waitFor(`${S}.elrs().length > 5`, 'Filing Explorer', 60000)

// each action: wall time until its render and effects have run (two macrotask turns; requestAnimationFrame
// doesn't fire while the window is hidden)
const timings = {}
const timed = async (phase, action) => {
  const ms = await ev(`(async () => { const t = performance.now(); ${action}; for (let i = 0; i < 2; i++) await new Promise((r) => setTimeout(r, 0)); return Math.round(performance.now() - t) })()`)
  ;(timings[phase] ??= []).push(ms)
}

if (!project) {
  const t0 = Date.now()
  await ev(`document.querySelector('[data-testid="auto-tag"]').click(), true`)
  await waitFor(`${S}.busy === null`, 'auto-tag', 1800000)
  const tagged = await ev(`${S}.rows.filter(r => r.concept).length`)
  const aiPicks = await ev(`${S}.rows.filter(r => r.concept && r.suggestions?.[0]?.pickedBy === 'ai').length`)
  console.log(`  auto-tag ${Math.round((Date.now() - t0) / 1000)} s${ai ? ' (AI pick)' : ''}${parallel ? ' (Faster Auto-tag)' : ''}, ${tagged} lines tagged${ai ? `, ${aiPicks} by the AI` : ''}`)
  await ev(`${S}.save()`)
  console.log('  saved', await ev(`${S}.savedPath`), '(pass it as the 4th argument to skip the auto-tag)')
}

for (const uri of await ev(`${S}.elrs().map(e => e.uri).filter(u => u !== 'MASTERS')`)) await timed('open statement', `${S}.setActiveElr(${J(uri)})`)
await ev(`${S}.setActiveElr(${S}.elrs()[0].uri)`)
for (const r of await ev(`${S}.rows.filter(r => r.statement === 'balanceSheet').slice(0, 25).map(r => r.id)`)) {
  await timed('click a line', `${S}.selectCell({ workbook: 'canonical', sheet: 'CANONICAL_BS', ref: 'A${Number(r.split(':')[1]) + 2}' })`)
}
const sheets = await ev(`window.__xap_test__.univer.getActiveWorkbook().getSheets().map(s => s.getSheetName())`)
for (let k = 0; k < 2; k++) for (const name of sheets) await timed('switch sheet', `window.__xap_test__.univer.getActiveWorkbook().getSheetByName(${J(name)}).activate()`)
for (let k = 0; k < 6; k++) await timed('open a problem', `document.querySelectorAll('[data-testid="problem"]')[${k}]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
await shot('perf-end.png')

let longest = 0
for (const [p, list] of Object.entries(timings)) {
  const max = Math.max(...list)
  longest = Math.max(longest, max)
  const avg = Math.round(list.reduce((a, b) => a + b, 0) / list.length)
  console.log(`  ${p.padEnd(16)} ${String(list.length).padStart(3)}×  average ${String(avg).padStart(5)} ms, longest ${String(max).padStart(5)} ms`)
}
check(longest <= Number(budget), `no action freezes the window over ${budget} ms`, `longest ${longest} ms`)
check(errors.length === 0, 'no uncaught renderer errors', errors.join(' | '))
await ev(`${S}.close()`)
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
ws.close()
process.exit(failures.length ? 1 : 0)
