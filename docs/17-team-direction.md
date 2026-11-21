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
| `GET /template` | The standard template (README + six canonical sheets; columns from `indas.py`). Added 2026-11-21. |
| `GET /master-fields` | Mandatory company (ELR 700300) and auditor (700400) fields with labels and types, from the KB. Added 2026-11-21. |

**Changes made to Vashu's routes on `integrate/vashu-main` (2026-11-21), for him to review:**
- `/transform` reads a filled standard template as-is (`summary.source = "standard_template"`), otherwise runs his extractor (`"heuristic"`). The response also has `sheets` (canonical rows as JSON), so the app doesn't read the xlsx back.
- `/recommend` returns **one list per key, in key order**. Before, `top_k > 1` gave one flat list and you couldn't tell which key a match belonged to.
- `load_object` loads pickles holding a `PosixPath` on Windows. `db/ind_as_taxonomy.pkl` is built on Linux and failed on Windows with "cannot instantiate 'PosixPath'", so `/recommend` could not run on a CA's PC.
- Restored `api/__main__.py` + `src/core/parent_watch.py` (the desktop app starts the sidecar with `python -m api`) and the per-launch token middleware.
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

### 5. The app's Ind AS screen (2026-11-21) ✅
Start screen → **Start Ind AS filing** (or **Download standard template**). Four steps (`ui/src/features/indas/`):
1. **Financial statements:** upload .xls / .xlsx → `/transform`; review the six canonical sheets. A badge says whether the file was read exactly (template) or converted automatically.
2. **Tagging:** Balance Sheet + P&L lines with amounts. **Suggest tags** → `/recommend` (8 keys per call, progress shown; the key is the breadcrumb, else the line item). The user picks a suggestion or types a concept; **Accept top suggestions** fills the untagged lines. The AI only proposes.
3. **Company & auditor:** the `/master-fields` form (period and nature prefilled from the filing settings) and the signatories (at least 2, 8-digit DIN).
4. **Generate:** readiness check, then `/generateXML`. The XML is saved to the projects folder (`<Company>_AOC4_<end date>.xml`), or the MCA problems are listed.

Code: `IndasPipelineService` (Electron-free), `IndasController` (dialogs, progress), `SidecarManager.upload / download`, IPC `indas:*`.

### 6. Tagging every sheet (docs/15 §3, §5) ✅ 2026-11-21
- **ELR scoping:** `/recommend` takes `scope` (a canonical sheet): candidates are only that sheet's ELR concepts (BS 110000: 57 instead of 5,647; P&L 141; CF 105; notes 1,843), or with `kind: "member"` the sheet's table-axis members (equity components 400200, PPE classes 400600). `src/services/sheet_scope.py` takes them from the knowledge base, because the vector index has no `elr` metadata yet.
- **Ranking:** local embedding (all-mpnet) + FlashRank, fused. **AI pick** (`use_llm`, only with the user's AI consent): one Groq call per batch picks a concept per line from the allowed scope; only line names and headings are sent; a pick outside the scope is dropped. HPL BS sample: 10/10 right with the AI pick, 7/10 without.
- **Generator:** `statements.cashFlow` and `statements.noteLines`; contexts from each concept's `periodType`; opening balances (`periodRole: "start"`) at the prior instant (`PY2_Instant`); generic dimensional table rows `{member, concept, cy, py}` (changes in equity); his PPE table rows unchanged; an identical repeated fact is written once, different amounts for the same fact = `OPENING_CLOSING_MISMATCH`.
- **Screen:** one tab per sheet: Balance Sheet, Profit & Loss, Cash Flow, Notes [L]; Changes in Equity [T] (movement concept × component member); Fixed Assets [T] (class member, columns map to his PPE fields); Notes text [E] (heading + pasted text → text block, `TEXT_BLOCKS` scope). Instant concepts get Closing / Opening. The AI's pick is marked "AI pick — check it"; nothing is tagged until accepted.

### 7. Saving (2026-11-21) ✅
The work is saved as `<Company>_Ind AS_FY yyyy-yy.axbrl` in the projects folder: `manifest.json` (`kind: "indas"`) + `indas.json` (canonical rows, tags, tables, text blocks, masters). Save button; leaving the screen saves first; the start screen's Saved projects marks Ind AS projects and reopens them in the Ind AS screen. Another project's file is never overwritten (" (2)").

### 8. Open items
- [x] Groq model switch on rate limit · [x] template download · [x] UI wiring · [x] ELR-scoped suggestions · [x] cash flow / equity / PPE / notes / text blocks · [x] saving
- [ ] **AI at decision points in `indas.py`** (path 2) — Vashu's, after he reviews more workbooks.
- [ ] **His PPE XML** writes 4 facts per class without the gross / accumulated-depreciation axis (`CarryingAmountAccumulatedDepreciationAndGrossCarryingAmountAxis`); Vashu to decide whether to model it fully.
- [ ] **Validation tab with zero-fill** (doc 15 §5 tab 6) — today only the checks inside Generate.
- [ ] **Old screens** (New filing, tagging grid, validation) still call the removed `/taxonomies` and `/mapping` routes. Decide: remove them, or point them at the new pipeline.
- [ ] **Index `elr` metadata** (his ingestion) — would let the hybrid search scope too; the KB-based scope works without it.

## Log
- **2026-11-21** — Done: ELR-scoped suggestions with the AI pick, tagging of all six sheets + text blocks, cash flow / equity / notes in the generator, saving and reopening Ind AS projects. Line-item names may go to the AI (Sarthak).
- **2026-11-21** — Done on `integrate/vashu-main`: Groq model switch on 429, standard template (`/indas/template`), the app's 4-step Ind AS screen over `/indas/*`, plus the fixes listed under §2.
- **2026-11-21** — Vashu: make an `XBRL_Autopilot` folder in Program Files and save projects there; the start screen shows the saved projects and New filing. Done on `integrate/vashu-main`.
- **2026-11-21** — Merged Vashu's `main` into branch `integrate/vashu-main` (`main` untouched). Sarthak: Vashu's calls take priority; record them here.
- **2026-11-20** — Vashu (chat): input via (1) our standard template, (2) heuristic transformation, (3) the template becoming the CA standard; heuristics for now, AI added at decision points over time. Says the rate-limit model switch is done. PR #14 (`client-server`) merged into his `main`: transform, recommend, generateXML, download routes.
