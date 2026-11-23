/**
 * The docs reader: a filterable list of the repository's Markdown documents beside the open one.
 * It owns only the reader's DOM; where documents come from and how Markdown becomes HTML are
 * passed in (load, render), so it runs the same on GitHub Pages, a local server or a test.
 *
 * @typedef {{ file: string, title: string, group: string }} DocEntry
 * @typedef {{ list: HTMLElement, search: HTMLInputElement, title: HTMLElement, file: HTMLElement, body: HTMLElement }} ReaderView
 * @typedef {{ load: (file: string) => Promise<string>, render: (markdown: string) => string, fallbackUrl: (file: string) => string }} ReaderDeps
 */

/** @param {DocEntry} doc @param {string} query */
export const matchesQuery = (doc, query) => {
  const q = query.trim().toLowerCase();
  return !q || [doc.file, doc.title, doc.group].some(v => v.toLowerCase().includes(q));
};

/** @param {ReaderView} view @param {DocEntry[]} docs @param {ReaderDeps} deps */
export function createDocsReader(view, docs, deps) {
  let current = docs[0]?.file;

  function itemButton(doc) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'reader__item';
    b.setAttribute('role', 'listitem');
    b.setAttribute('aria-current', String(doc.file === current));
    const group = document.createElement('span');
    group.textContent = doc.group;
    b.append(doc.title, group);
    b.addEventListener('click', () => open(doc));
    return b;
  }

  function renderList() {
    const rows = docs.filter(d => matchesQuery(d, view.search.value));
    if (rows.length) return view.list.replaceChildren(...rows.map(itemButton));
    const none = document.createElement('p');
    none.className = 't-small muted';
    none.textContent = 'No document matches that.';
    view.list.replaceChildren(none);
  }

  function showFallback(doc) {
    const p = document.createElement('p');
    const a = document.createElement('a');
    a.href = deps.fallbackUrl(doc.file);
    a.rel = 'noreferrer';
    a.textContent = `Read ${doc.file} on GitHub`;
    p.append('This document opens from the published site. ', a);
    view.body.replaceChildren(p);
  }

  /** @param {DocEntry} doc */
  async function open(doc) {
    current = doc.file;
    renderList();
    view.title.textContent = doc.title;
    view.file.textContent = doc.file;
    try {
      view.body.innerHTML = deps.render(await deps.load(doc.file));
      view.body.parentElement?.scrollTo?.(0, 0);
    } catch {
      showFallback(doc);
    }
  }

  view.search.addEventListener('input', renderList);
  renderList();
  if (docs[0]) open(docs[0]);
  return { open, renderList };
}
