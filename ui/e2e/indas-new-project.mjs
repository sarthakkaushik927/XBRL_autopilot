// Shared by the Ind AS e2e scripts: create a project through the real New project dialog (ADR-0017).
// `ev(expr)` evaluates in the renderer (CDP Runtime.evaluate); fields are typed the way React sees typing.

/** Sets a React-controlled input / select by its selector and fires the events React listens to. */
const setValueJs = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return false
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`

/**
 * Opens New project from `entry` (a data-testid: welcome-new-project or activity-new-project), fills the dialog and
 * creates the project (the "open the Excel right away" box is cleared: the native file dialog can't be driven).
 * Returns true when the editor shows the new project.
 */
export async function newProject(ev, waitFor, entry, p) {
  await ev(`document.querySelector('[data-testid="${entry}"]').click()`)
  await waitFor(`!!document.querySelector('[data-testid="new-company"]')`, 'New project dialog')
  await ev(`document.querySelector('[data-testid="taxonomy-ind-as-2017"]')?.click(), true`)
  await ev(setValueJs('[data-testid="new-company"]', p.company))
  await ev(setValueJs('[data-testid="new-cin"]', p.cin))
  // the dialog's first two date fields: current year start and end (the previous year follows them)
  await ev(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const d = document.querySelectorAll('.fixed input[type="date"]'); [${JSON.stringify(p.start)}, ${JSON.stringify(p.end)}].forEach((v, i) => { set.call(d[i], v); d[i].dispatchEvent(new Event('input', { bubbles: true })) }); return d.length })()`)
  if (p.level) await ev(`(() => { const s = [...document.querySelectorAll('.fixed select')].find((x) => [...x.options].some((o) => o.value === 'Crores')); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(p.level)}); s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  // don't open the native file dialog after creating
  await ev(`(() => { const box = [...document.querySelectorAll('.fixed label')].find((l) => l.textContent.includes("Open the client's Excel"))?.querySelector('input'); if (box?.checked) box.click(); return true })()`)
  await ev(`[...document.querySelectorAll('.fixed button')].find((b) => b.textContent.trim() === 'Create project').click(), true`)
  await waitFor(`window.__xap_test__.indas.getState().open && !document.querySelector('[data-testid="new-company"]')`, 'project created', 30000)
  return ev(`document.querySelector('[data-testid="explorer-company"]')?.textContent === ${JSON.stringify(p.company)}`)
}
