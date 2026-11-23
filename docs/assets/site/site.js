// Wires the page: the download buttons for the visitor's system, and the docs reader.
import { createDocsReader } from './docs-reader.js';
import { applyDownload, detectOs } from './os-download.js';

const REPO_DOCS = 'https://github.com/VashuTheGreat/XBRL_autopilot/blob/main/docs/';
const byId = id => document.getElementById(id);

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const here = file => new URL(`./${file}`, import.meta.url);
const [releases, docs] = await Promise.all([fetchJson(here('releases.json')), fetchJson(here('docs.json'))]);

applyDownload(document, detectOs(navigator), releases);

createDocsReader(
  { list: byId('doc-list'), search: byId('doc-search'), title: byId('doc-title'), file: byId('doc-file'), body: byId('doc-body') },
  docs,
  {
    load: fetchText,
    render: md => (window.marked ? window.marked.parse(md) : ''),
    fallbackUrl: file => REPO_DOCS + file,
  },
);
