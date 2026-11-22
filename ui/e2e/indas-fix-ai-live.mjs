// Ind AS Fix with AI with the REAL Groq model on a real workbook (the team's sample data, not client data — Sarthak,
// 2026-11-22): New project (synthetic company / CIN) → open the workbook → Auto-tag (AI pick) → the Differences left
// (when Auto-tag leaves none: up to 3 lines retagged with their 2nd candidate, kept only when that breaks a total)
// → ✦ Fix with AI on one problem → ✦ Fix all with AI → accept every card whose dry run says it helps → how many
// Differences are left. A real model is not deterministic: the script checks the contract (an answer, cards with a
// dry run, accepting a helpful card never adds a Difference) and prints what came back.
// Usage: backend with the Groq key (.env) on XAP_API_URL; node ui/e2e/indas-fix-ai-live.mjs <port> <screenshotDir> <workbook>
// A project already open and tagged in the app is reused (no reload, no Auto-tag).
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
const waitFor = async (expr, label, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(1000) } throw new Error('timeout: ' + label) }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, name), Buffer.from(r.result.data, 'base64')); console.log('  screenshot', name) }
const S = 'window.__xap_test__.indas.getState()'
const UI = 'window.__xap_test__.ui.getState()'
const J = JSON.stringify
const failures = []
const check = (ok, what, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', what, detail ? '— ' + detail : ''); if (!ok) failures.push(what) }
const qa = (sel) => `[...document.querySelectorAll(${J(sel)})]`
const diffCount = `Object.values(${S}.checks).reduce((n, c) => n + c.differences.length, 0)`
const sessionStatus = `${qa('[data-testid="fix-session"]')}.at(-1)?.dataset.status`
const lastCards = `${qa('[data-testid="fix-session"]')}.at(-1).querySelectorAll('[data-testid="fix-card"]')`
const cardsOf = `[...${lastCards}].map(c => ({ row: c.dataset.row, label: c.querySelector('button').textContent, concept: c.dataset.concept, state: c.dataset.state, better: c.querySelector('[data-testid="fix-effect"]').dataset.better === 'true', effect: c.querySelector('[data-testid="fix-effect"]').textContent }))`

await send('Runtime.enable')
await send('Page.enable')
const reuse = await ev(`!!window.__xap_test__?.indas && ${S}.open && ${S}.rows.some(r => r.concept)`)
let t = Date.now()
if (!reuse) {
  await send('Page.reload')
  await sleep(2000)
  await waitFor(`!!window.__xap_test__?.indas && !!document.querySelector('[data-testid="welcome-new-project"]')`, 'start screen', 120000)
  await waitFor(`window.xap.sidecar.status().then(s => s.state === 'ready')`, 'backend ready', 180000)
  await ev(`window.xap.settings.update({ aiConsent: true })`)
  check(await newProject(ev, waitFor, 'welcome-new-project', { company: 'Live Fix Test Private Limited', cin: 'U72200KA2010PTC123456', start: '2025-04-01', end: '2026-03-31', level: 'Actual' }), 'New project')
  await ev(`${S}.upload(${J(workbook)})`)
  await waitFor(`${S}.busy === null && ${S}.transform !== null`, 'transform', 300000)
  await ev(`${S}.autoTag()`)
  await waitFor(`${S}.busy === null`, 'auto-tag', 1200000)
}
await ev(`window.xap.settings.update({ aiConsent: true })`)
await waitFor(`Object.keys(${S}.checks).length === 4`, 'checks', 30000)
const tagged = await ev(`${S}.rows.filter(r => r.concept).length + '/' + ${S}.rows.length`)
console.log(`  ${reuse ? 'reused the open project' : 'auto-tag'}: ${tagged} lines tagged in ${Math.round((Date.now() - t) / 1000)} s; ${await ev(diffCount)} Difference(s)`)

// plant realistic mistakes when there are none: a line's 2nd candidate, kept only when it breaks a total
const planted = []
if ((await ev(diffCount)) === 0) {
  const lines = await ev(`${S}.rows.filter(r => (r.statement === 'balanceSheet' || r.statement === 'profitLoss') && r.concept && r.suggestions[1] && r.suggestions[1].qname !== r.concept).map(r => ({ id: r.id, label: r.label, right: r.concept, wrong: r.suggestions[1].qname }))`)
  for (const l of lines) {
    if (planted.length === 3) break
    const n = await ev(diffCount)
    await ev(`${S}.setConcept(${J(l.id)}, ${J(l.wrong)})`)
    await sleep(900)
    if ((await ev(diffCount)) > n) planted.push(l)
    else { await ev(`${S}.setConcept(${J(l.id)}, ${J(l.right)})`); await sleep(900) }
  }
  for (const l of planted) console.log(`  planted: ${l.label}: ${l.right} → ${l.wrong}`)
}
const before = await ev(diffCount)
check(before > 0, 'there are Differences to fix', String(before))
await ev(`${UI}.setBottomTab('problems'), true`)
await sleep(500)

// one problem: ✦ Fix with AI on its row
const first = await ev(`${qa('[data-testid="problem"][data-source="difference"]')}[0]?.textContent`)
t = Date.now()
await ev(`${qa('[data-testid="problem"][data-source="difference"] [data-testid="fix-ai"]')}[0].click(), true`)
await waitFor(`${sessionStatus} === 'ready' || ${sessionStatus} === 'failed'`, 'single answer', 180000)
const single = await ev(cardsOf)
console.log(`  single (${Math.round((Date.now() - t) / 1000)} s) for: ${first}\n   `, await ev(`${qa('[data-testid="fix-explanation"]')}.at(-1)?.textContent ?? ${qa('[data-testid="fix-error"]')}.at(-1)?.textContent`))
for (const c of single) console.log(`    ${c.better ? '✓' : '!'} ${c.label} → ${c.concept || 'no tag'} (${c.effect})`)
check((await ev(sessionStatus)) === 'ready', 'Fix with AI on one problem: the AI answered')
await shot('live-01-single.png')

// all of them
t = Date.now()
await ev(`document.querySelector('[data-testid="fix-all-ai"]').click(), true`)
await sleep(500)
await waitFor(`${sessionStatus} === 'ready' || ${sessionStatus} === 'failed'`, 'all answer', 300000)
const all = await ev(cardsOf)
console.log(`  all (${Math.round((Date.now() - t) / 1000)} s):\n   `, await ev(`${qa('[data-testid="fix-explanation"]')}.at(-1)?.textContent ?? ${qa('[data-testid="fix-error"]')}.at(-1)?.textContent`))
for (const c of all) console.log(`    ${c.better ? '✓' : '!'} ${c.label} → ${c.concept || 'no tag'} (${c.effect})`)
check((await ev(sessionStatus)) === 'ready', 'Fix all with AI: the AI answered', `${all.length} card(s), ${all.filter((c) => c.better).length} helpful`)
await shot('live-02-all.png')

// accept the helpful ones, one by one; the Difference count must never go up
let worse = 0
for (const c of all.filter((x) => x.better)) {
  const n = await ev(diffCount)
  await ev(`[...${lastCards}].find(x => x.dataset.row === ${J(c.row)})?.querySelector('[data-testid="fix-accept"]')?.click(), true`)
  await sleep(700)
  if ((await ev(diffCount)) > n) worse++
}
const after = await ev(diffCount)
console.log(`  Differences: ${before} → ${after} after accepting ${all.filter((c) => c.better).length} helpful card(s)`)
check(worse === 0, 'accepting a card the dry run marked helpful never adds a Difference')
if (planted.length) {
  const restored = await ev(`${J(planted)}.filter(l => ${S}.rows.find(r => r.id === l.id).concept === l.right).length`)
  console.log(`  planted mistakes put right: ${restored}/${planted.length}`)
}
await shot('live-03-accepted.png')

check(errors.length === 0, 'no uncaught renderer errors', errors.join(' | '))
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
ws.close()
process.exit(failures.length ? 1 : 0)
