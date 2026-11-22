# 17. Team direction (Vashu's calls)

> **Priority rule:** Vansh Sharma (Vashu, GitHub `VashuTheGreat`, remote `upstream`) sets the product and pipeline direction. Where this doc disagrees with [docs/16](16-target-architecture.md), [ADR-0016](decisions/ADR-0016-canonical-financial-package.md) or an older doc, **this doc wins**.
> It is a living log: add a dated entry whenever Vashu decides something. Newest first in the log; the "Current direction" section always shows the latest state.

## Current direction

### 1. Getting the client's Excel in (decided 2026-11-20)
There are three ways in, in this order:

| # | Path | What it means |
|---|---|---|
| 1 | **Our standard template** | We publish a downloadable template (the canonical sheets). The CA converts their own workbook into it, by hand or with any AI tool, and uploads it. It can be read exactly, without guessing. |
| 2 | **Heuristic transformation** | `POST /api/v1/indas/transform` → `src/transformation/indas.py` turns a raw client workbook into `CANONICAL_MASTER_<name>.xlsx` (BS, PL, CF, SOCIE, PPE schedule, financial notes). Heuristics for now. Vashu adds AI at individual decision points after studying 3–4 more workbooks. |
| 3 | **Template becomes the standard** | Long term, CAs prepare reports directly in our template, so path 2 is needed less. |

Canonical sheet columns are listed in [universal_parser.md](universal_parser.md) §5.

### 2. Sidecar routes (Vashu's `main`, PR #14, 2026-11-20)
All under `/api/v1/indas/`:

| Route | Does |
|---|---|
| `POST /transform` | Excel upload → canonical master workbook. Returns a download URL. |
| `POST /recommend/` | Tag suggestions for row keys (Qdrant dense + BM25, reranked). |
| `POST /generateXML` | Validates against `ind_as_knowledge_base.json` and writes the AOC-4 XML (contract: [doc 16-validation](16-validation-and-xml-generation-api-contract.md)). |
| `GET /download/{id}/{file}` | Serves generated files. They are deleted after `DELETE_FILE_AFTER` (15 min). |
| `GET /authority` | Ind AS knowledge-base JSON. |
| `GET /template` | The standard template: the canonical sheets in `data/canonical_sheets/` (the source of truth) served as one workbook, one sheet per file. |
| `GET /tree/{scope}` | A sheet's presentation tree(s), or its table axis members (the split view's right pane). |

**Changes made to Vashu's routes on `integrate/vashu-main` (2026-11-21), for him to review:**
- `/transform` reads a filled standard template as-is (`summary.source = "standard_template"`), otherwise runs his extractor (`"heuristic"`). The response also has `sheets` (canonical rows as JSON), so the app doesn't read the xlsx back.
- `/recommend` returns **one list per key, in key order**. Before, `top_k > 1` gave one flat list and you couldn't tell which key a match belonged to.
- `load_object` loads pickles holding a `PosixPath` on Windows. `db/ind_as_taxonomy.pkl` is built on Linux and failed on Windows with "cannot instantiate 'PosixPath'", so `/recommend` could not run on a CA's PC.
- Restored `src/core/parent_watch.py` and the per-launch token middleware. The desktop app starts the sidecar with `python -m api.app` (`run()` in `api/app.py`, also the PyInstaller entry); `make dev-backend` keeps `uvicorn api.app:app`.
- **PR #15 review (Vashu, 2026-11-21), done:** no `.py` files in `notebooks/` (now git-ignored); `/template` serves the existing canonical sheets instead of building one from a README; `/check` and `/master-fields` removed: the app computes the Difference bar and the master fields itself from `/authority` (fetched once per session, `IndasPipelineService`), so editing a cell never calls the sidecar; `api/__main__.py` removed.
- **`/generateXML` XML fixes (2026-11-21), found by checking the XML with Arelle against the official Ind AS 2017 taxonomy in `data/`:**
  - The schemaRef and namespaces were invented (`http://www.mca.gov.in/ind-as/2016-03-31`), so no fact belonged to the real taxonomy. They now come from the KB: `meta.schemaRef` = `https://www.mca.gov.in/V3XBRL/2017/07/16/Taxonomy/Ind/in-ci-ent-2017-03-31.xsd` (the address in the MCA-accepted Dixon instance), and `meta.namespaces` = `http://www.icai.org/xbrl/taxonomy/2017-03-31/{in-ca,ind-as,…}`, read from each schema's `targetNamespace` (`src/services/extractors/ind_as.py`).
  - Every Ind AS hypercube has `xbrldt:contextElement="scenario"`. The generator wrote dimensions in `<xbrli:segment>`, so the director facts were dimensionally invalid. Dimensions now go where the KB says (`meta.dimensionContextElement`).
  - The director typed member held `DirectorIdentificationNumberOfDirector`. It now uses the axis's `xbrldt:typedDomainRef` (`DirectorsSigningFinancialStatementsDomain`, KB concept field `typedDomain`).
  - EPS (`perShareItemType`) was written in INR with `decimals="0"` (5.00 → 5). The unit and decimals now follow the item type (INR/share with 2 places, shares, pure). Amounts are rounded with `Decimal` half-up; before, `int()` cut the decimals off.
  - **His PPE facts:** without the gross / accumulated-depreciation axis, `PropertyPlantAndEquipment` for a class means its **carrying amount**. It was given the gross closing (₹12 lakh while the balance sheet said ₹8 lakh). It is now the net block, and disposals are net of their depreciation.
- The sidecar defaults `OPENBLAS_NUM_THREADS` / `OMP_NUM_THREADS` to 1: OpenBLAS ran out of memory loading the reranker on a 16-thread laptop.

### 3. What changes against our earlier plan
- **XML is generated in Python** (`src/pipeline/xml_generation_pipeline.py`), not only in the TS `engine/`. This overrides ADR-0016 decision 5 and the "no `/instances/generate`" line in docs/16.
- **The six canonical sheets are the pipeline stage** (not only an export view as in ADR-0016 decision 6).
- **Removed on Vashu's `main`:** `/taxonomies` and `/mapping` routes, the engine authority / engine rules builders and their `knowledge_base/*_engine_*.json` outputs, the Dixon and Rebel instances. The old UI and engine tests that use them will break; that is accepted during the rework (see CLAUDE.md → Branching).
- **Client workbooks in `notebooks/`** are accepted by the team; don't flag them.
- **AI and client fixtures (2026-11-21, Sarthak):** line-item names and headings from the client workbooks (e.g. HPL) may be sent to Groq for the AI tag pick and in the Ind AS e2e run. Amounts, company names, CINs and whole workbooks are never sent. (Replaces CLAUDE.md's old "never send them to an AI service".)

### 4. Projects folder (decided 2026-11-21) ✅
- Filings are saved by default to **`<Program Files>\XBRL_Autopilot\Projects`**. The per-machine installer creates it and makes it writable for every user (`ui/build/installer.nsh`).
- If it isn't writable (dev, no installer, Linux), the app uses `Documents\XBRL_Autopilot\Projects`, then `<userData>\Projects` (`ProjectsFolder`, `ui/electron/main/services/projects-folder.ts`).
- Save / Save as / Open dialogs start in that folder.
- **Start screen:** New filing, Open, Import XBRL, Recover, Recent filings (already there) + **Saved projects**: every `.axbrl` in the folder, newest first, with a Show folder button (`SavedProjectsService`, IPC `project:saved` / `project:open-folder`).

### 5. The app's Ind AS screen: the webXBRL-style editor (2026-11-22) ✅
Superseded the 4-step wizard of 2026-11-21 ([ADR-0017](decisions/ADR-0017-indas-in-the-editor.md)). An Ind AS filing opens in the same editor as a C&I filing:
- **New project** (start screen, File → New Project / Ctrl+N, activity bar): company, CIN, Ind AS 2017 (default) / C&I 2016, nature, periods, rounding, decimal places, optionally the client Excel. Saved straight away as `<Company>_<FY>.axbrl` in the projects folder. Filing → Filing Settings… edits the same settings later. They prefill the masters and `/generateXML`'s `meta`.
- **Filing Explorer** (ELRs of each canonical sheet's scope from `/tree/{scope}`), **Excel pane** = the canonical sheets in Univer (canonical row *i* = grid row *i + 1*, so the cell ↔ tag link is exact), **XBRL Form** (presentation tree, values with cell chips, Difference footer), **XML** / **Preview**, **Problems** / AI Agent / Output, status bar, File / Edit / View / Filing / Tools / Help.
- The wizard's steps are commands: Open financial statements… (`/transform`), Auto-tag (`/recommend`, proposals only), Company & auditor details…, Generate XML (`/generateXML`).
- Facts and per-ELR differences come from main in exact decimals (`indas:check` returns `facts` and `byElr`); no new routes, nothing calls the sidecar per edit.

Code: `IndasPipelineService`, `IndasProjectService` (create / save / open, Electron-free), `IndasController`; renderer `stores/indas.ts`, `app/workspace.ts` (the adapter the shared panes read), `features/indas/*`.

### 6. Tagging every sheet (docs/15 §3, §5) ✅ 2026-11-21
- **ELR scoping:** `/recommend` takes `scope` (a canonical sheet): candidates are only that sheet's ELR concepts (BS 110000: 57 instead of 5,647; P&L 141; CF 105; notes 1,843), or with `kind: "member"` the sheet's table-axis members (equity components 400200, PPE classes 400600). `src/services/sheet_scope.py` takes them from the knowledge base, because the vector index has no `elr` metadata yet.
- **Ranking:** local embedding (all-mpnet) + FlashRank, fused. **AI pick** (`use_llm`, only with the user's AI consent): one Groq call per batch picks a concept per line from the allowed scope; only line names and headings are sent; a pick outside the scope is dropped. HPL BS sample: 10/10 right with the AI pick, 7/10 without.
- **Generator:** `statements.cashFlow` and `statements.noteLines`; contexts from each concept's `periodType`; opening balances (`periodRole: "start"`) at the prior instant (`PY2_Instant`); generic dimensional table rows `{member, concept, cy, py}` (changes in equity); his PPE table rows unchanged; an identical repeated fact is written once, different amounts for the same fact = `OPENING_CLOSING_MISMATCH`.
- **Screen:** one tab per sheet: Balance Sheet, Profit & Loss, Cash Flow, Notes [L]; Changes in Equity [T] (movement concept × component member); Fixed Assets [T] (class member, columns map to his PPE fields); Notes text [E] (heading + pasted text → text block, `TEXT_BLOCKS` scope). Instant concepts get Closing / Opening. The AI's pick is marked "AI pick — check it"; nothing is tagged until accepted.

### 7. Saving (2026-11-21, naming 2026-11-22) ✅
The work is saved as `<Company>_FY yyyy-yy.axbrl` in the projects folder (from New project on; before 2026-11-22: `<Company>_Ind AS_FY yyyy-yy.axbrl`): `manifest.json` (`kind: "indas"`) + `indas.json` (canonical rows, tags, tables, text blocks, masters). Save button; leaving the screen saves first; the start screen's Saved projects marks Ind AS projects and reopens them in the Ind AS screen. Another project's file is never overwritten (" (2)").

### 8. Open items
- [x] Groq model switch on rate limit · [x] template download · [x] UI wiring · [x] ELR-scoped suggestions · [x] cash flow / equity / PPE / notes / text blocks · [x] saving
- [ ] **AI at decision points in `indas.py`** (path 2) — Vashu's, after he reviews more workbooks.
- [ ] **His PPE XML** writes 4 facts per class without the gross / accumulated-depreciation axis (`CarryingAmountAccumulatedDepreciationAndGrossCarryingAmountAxis`), now as carrying amounts (net block); Vashu to decide whether to model gross and depreciation fully.
- [ ] **Our MCA checks are a subset of MCA's rules.** `/generateXML` checks the 700300 company fields, statement roots, calculations, non-negatives and PPE roll-forwards. It does not check the other mandatory lists (`mandatoryByELR`: e.g. 110000 wants OtherIntangibleAssets, LoansNoncurrent…; 700400 wants the auditor details table; 700600 the board report items) or the formula linkbase. Decide whether to add them (and zero-fill, doc 15 §5 tab 6) or rely on the MCA Validation Tool.
- [ ] **Subtotals a statement doesn't print** (e.g. "Financial assets" under current assets): the XBRL calculation then compares a total with only some of its children and fails. The synthetic template prints them; a real workbook may not. Option: derive the missing subtotal deterministically.
- [ ] **Validation tab with zero-fill** (doc 15 §5 tab 6) — today only the checks inside Generate.
- [ ] **Old screens:** New project now creates Ind AS projects through the new pipeline (ADR-0017). A **C&I** project still opens the engine editor, whose tagging grid and validation call the removed `/taxonomies` and `/mapping` routes. Decide: remove C&I from New project, or point the C&I editor at the new pipeline.
- [ ] **The client's original workbook in the Excel pane:** today the pane shows the canonical sheets. Showing the client's own workbook needs `/transform` to return where each canonical row came from (sheet / row / columns). Vashu's call.
- [ ] **Index `elr` metadata** (his ingestion) — would let the hybrid search scope too; the KB-based scope works without it.

## Log
- **2026-11-22** — Sarthak: the Ind AS filing uses the webXBRL-style editor (Filing Explorer / Excel / XBRL Form / XML / Preview, Problems, status bar), not the 4-step wizard; one **New project** flow creates `<Company>_<FY>.axbrl`, and its settings prefill the masters. The left pane may show our parsed canonical sheets, since they are our own template. Done on `integrate/vashu-main` ([ADR-0017](decisions/ADR-0017-indas-in-the-editor.md)).
- **2026-11-22** — Vashu (PR #15 review): notebooks hold only `.ipynb`; `data/canonical_sheets/` is the template's source of truth; no server round trip per cell edit (client-side checks; our plan keeps the TS engine for validation); no `/master-fields` (use `/authority`); no `api/__main__.py`. Done on `integrate/vashu-main`.
- **2026-11-21** — Done: ELR-scoped suggestions with the AI pick, tagging of all six sheets + text blocks, cash flow / equity / notes in the generator, saving and reopening Ind AS projects. Line-item names may go to the AI (Sarthak).
- **2026-11-21** — Done on `integrate/vashu-main`: Groq model switch on 429, standard template (`/indas/template`), the app's 4-step Ind AS screen over `/indas/*`, plus the fixes listed under §2.
- **2026-11-21** — Vashu: make an `XBRL_Autopilot` folder in Program Files and save projects there; the start screen shows the saved projects and New filing. Done on `integrate/vashu-main`.
- **2026-11-21** — Merged Vashu's `main` into branch `integrate/vashu-main` (`main` untouched). Sarthak: Vashu's calls take priority; record them here.
- **2026-11-20** — Vashu (chat): input via (1) our standard template, (2) heuristic transformation, (3) the template becoming the CA standard; heuristics for now, AI added at decision points over time. Says the rate-limit model switch is done. PR #14 (`client-server`) merged into his `main`: transform, recommend, generateXML, download routes.
