# 08 · UI / UX

The layout is IDE-like, built for accountants: dense, keyboard-friendly and calm. The vocabulary is accounting's ("Statement", "Note", "Tag", "Problem"), never developer's.

## Main window
```
┌ Title bar: XBRL Autopilot — Acme Pvt Ltd · FY 2025-26 · Standalone •                         ─ □ ✕ ┐
├ Menu: File  Edit  View  Filing  Tools  Help                                                        ┤
├──┬───────────────────┬───────────────────────────────────┬─────────────────────────────────────────┤
│AB│ Side panel        │ LEFT: Excel (Univer)              │ RIGHT: [XBRL Form] [XML] [Preview]       │
│  │ (Filing explorer  │  sheet tabs: BS | PL | BS Sch     │  ELR grid / Monaco XML / MCA-like preview│
│📁│  / Taxonomy /     │  cells coloured by mapping status │  selected fact highlighted               │
│🔎│  Problems / AI /  │  ◀──── linked selection ─────▶   │                                          │
│⚠ │  Masters)         │                                   │                                          │
│✨│                   ├───────────────────────────────────┴─────────────────────────────────────────┤
│🏢│                   │ Mapping Inspector (selected cell → concept, period, dims, confidence, ✓ ✗ ✎)  │
│⚙ │                   ├──────────────────────────────────────────────────────────────────────────────┤
│  │                   │ Bottom panel: [Problems (12)] [AI Agent] [Output]                             │
├──┴───────────────────┴──────────────────────────────────────────────────────────────────────────────┤
│ Status: CIN U12345… │ C&I 2016 │ FY 25-26 │ ⛔ 3 ⚠ 9 │ Sidecar ● ready │ AI ● gpt-oss-120b │ ▯ ▭     │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- **AB** is the activity bar; its first button is New project.
- **Title bar** (VS Code style, `TitleBar.tsx` + main `title-bar.ts`): the OS title bar is hidden (`titleBarStyle: 'hidden'`); Windows still draws minimise / maximise / close (`titleBarOverlay`, recoloured with the theme). One 32 px row holds the app mark, the menu names (File … Help, read from the application menu; a click pops that real submenu up, so every shortcut keeps working), the open filing (`● Company · FY` with ● while unsaved) and the editor toolbar. The bar drags the window; double-click maximises. macOS keeps its traffic lights and global menu.
  - **Alt keys** (`menu-keys.ts`, as on Windows / VS Code): Alt+F / E / V / I / T / H opens that menu (the access keys come from the `&` in the menu labels); holding Alt underlines them; a lone Alt tap puts the focus on File: ← / → move, Enter / ↓ / the letter opens, Esc or another Alt tap leaves. AltGr (Ctrl+Alt) and Alt+Shift are left alone.
- **Editor toolbar** (right end of the title bar): `EditorToolbar.tsx`, thin, runs the same commands as the menu (`app/commands.ts`).
  - **☁ Auto** (Ind AS): auto-save on / off (`settings.autosave`, also a checkbox in Settings → Saving). The cloud shows the state: ✓ saved, orange = unsaved work waiting for the next tick, pulsing ↑ while an auto-save is written, a green tick with a ping when it lands, struck through ☁̸ when off (only Save writes the file then). Turning it on saves pending work at once. A C&I filing's crash-recovery copies are not affected.
  - **💾 Save** (Ctrl+S), with an orange dot while there are unsaved changes.
  - **Layout toggles** (VS Code style): ▯ shows / hides the side panel (Ctrl+B), ▭ the bottom panel (Ctrl+J), ⤢ **Focus** hides both and brings back what was open (Ctrl+Alt+F, View menu). The bottom panel also has its own ⌄ hide button. Showing a bottom tab (Problems after Generate, the status-bar error count) opens the panel again. Which panels are shown is remembered across restarts (`localStorage`, `xap.layout`).
- All splits are resizable (`react-resizable-panels`). Sizes are remembered in `ui-state.json`.

## Activity bar → side panels
| Icon | Panel | Contents |
|---|---|---|
| 📁 | **Filing explorer** | ELR tree grouped Statements / Notes / Disclosures / General info, with status dots: ● complete, ◐ partial, ○ empty, ⛔ errors |
| 🔎 | **Taxonomy** | Search concepts (label/qname). Filters: ELR, type, period. Drag a concept onto an Excel cell to tag it |
| ⚠ | **Problems** | Same as the bottom panel, larger, grouped by ELR |
| ✨ | **AI Copilot** | Interactive MCA/XBRL filing copilot (`AiChatPanel`), conversation threads, prompt suggestions, expandable RAG citations, and rich GFM markdown preview |
| 🏢 | **Masters** | Company / directors / auditor (General Information 400100 form) |
| ⚙ | **Settings** | MCA tool path, theme, autosave interval, data-consent toggle (model and API keys configured securely backend/env-side) |

## Mapping colours (Excel pane)
| Colour | Meaning |
|---|---|
| 🟩 green | Approved mapping |
| 🟨 amber | AI suggestion, not yet approved (darker = lower confidence) |
| 🟥 red outline | Mapped fact has an ERROR issue |
| ⬜ grey hatch | Numeric cell with no mapping |
| 🟦 blue outline | Linked to the selection on the right |

On the right, the XBRL Form shows the reverse: the source cell ref shows as a chip next to each fact, and clicking it selects the cell on the left.

## Linkage interactions
- **Selecting a cell** → the Inspector shows its mapping, and the right pane follows it (2026-11-11, `ui/e2e/linkage-follow.mjs`):
  - **XBRL Form:** if the open statement doesn't show the cell's element, the Form opens one that does (`MappingView.elrUris`, by code). If the open statement shows the element, it stays open.
  - The element's row scrolls into view, below the sticky column header, and is highlighted: blue for a tagged fact, amber for a suggestion.
  - Clicking the same cell again brings the row back after the Form was scrolled away.
  - **XML tab:** the `<fact>` line is highlighted and scrolled into view.
- **Amounts in the Inspector** are shown as they go into the filing. Excel float noise is rounded to the cell's number format, or to the filing's "decimal places as presented" when the cell has none. A `rounded` badge appears, and its tooltip shows the stored number (e.g. `5443.466337358575` → 5,443.47). A shown digit beyond the filing's decimal places is never rounded away: tagging is refused with a message.
- **Ranges:** dragging over cells in one column selects a range. The inspector shows "sum of N cells" and the total, and tagging files the sum as one figure (a line with no total cell, e.g. Trade payables = MSME + others). A cell inside a tagged range belongs to that tag.
- **XBRL Form → "Empty mandatory → 0"** reports the statement's mandatory amounts that are still empty as 0 and lists them in a toast. Text fields are left to the user, who reviews the list (a line the company has inside another line, e.g. CSR inside Other expenses, must be corrected).
- **Decimal places as presented** are chosen in the New Filing wizard and can be changed in the Filing explorer header ("2 dp"). Changing them re-reads every tagged figure from Excel.
- **Column period & WebXBRL-style figure columns:**
  - **Sheet figure columns (Excel toolbar):** The active sheet's CY and PY columns are shown prominently on the toolbar (`CY: Col C · PY: Col D` or `Set CY / PY Columns`). Clicking it opens the configuration dialog to specify CY column, PY column (or CY-to-PY gap), with an option to apply across all sheets. The choice is remembered in `mapping.json` (`columns`).
  - **WebXBRL-style manual tagging:** When line-item particulars (e.g. column B) are selected, double-clicking an element in the Taxonomy browser tags both CY (column C) and PY (column D) together, or specific CY/PY buttons can be clicked on hover.
  - **Inspector column period:** The bottom inspector always shows the selected cell's column period status (`Column C: CY`, `Column B: period unknown`), with quick CY/PY override buttons.
  - **Auto-tag dialog:** Uses the sheet's configured CY & PY figure columns automatically, asking only for the line-item description column (with an expandable panel to adjust CY/PY if desired).
- **Selecting a fact (Form or XML)** → the source cell is selected and scrolled into view on the left.
- **Tables (Phase 11, [ADR-0013](decisions/ADR-0013-table-tagging.md)):**
  - **Map as table:** drag over a note table in Excel, then click "Map as table" in the Excel toolbar. Pick the taxonomy table by searching its title or statement. Then:
    - every row with figures gets a line item, with its opening / closing role, an optional year and members (e.g. "Gross carrying amount");
    - every column gets members (e.g. "Computer equipments") and an optional year.

    **Preview** lists what would be filed and the cells that can't be tagged, with the reason; it also counts the facts reported again ("12 cells ready (+24 facts reported again)": a fair value equal to the carrying amount, the one category as the total). **Map cells** tags the ready cells as one block. A block cell is an ordinary tag, linked both ways; its extra facts are its "also" facts.
    Opened on a suggestion, the dialog keeps what it doesn't edit as suggested: a row's own columns (a related party under its category), its other line items, a column's totals (the row label's tooltip lists them).
  - **The Form shows the statement's tables** under its rows:
    - one column per member combination and year that holds a value;
    - each value with its source-cell chip;
    - line items without a value are folded away.

    Selecting a table cell in Excel opens its table's note on that value; clicking a value selects and reveals its cell.
  - **Also reported as:** the inspector of a tagged cell shows "also: Equity shares 1" chips and an "Also as…" button. The dialog lists the tables that report the cell's element first (★), preselects the element and asks for the members. The extra fact follows the cell on every value change. In the Form its chip is marked "also reported from I39".
  - **Suggested tables (auto-tagging):** a block the tagger matched to a taxonomy table has a dashed amber outline. Selecting one of its cells shows a bar above the inspector: the table, its confidence, the range and the number of cells, plus **Accept** (tag as suggested), **Review…** ("Map as table" prefilled; Map cells accepts it as edited) and **Reject**. A suggested "also reported as" fact shows in the inspector as "also: … (suggested)", with ✓ / ✗ once the cell is tagged. "Accept all ≥ 90%" never files those.
  - **Table zeros → 0** (Form toolbar, for statements with tables): reports as 0 what the mandatory-line-items rules require, in columns that already have a value, and lists what it filled in a toast.
- **A failing Excel view** shows "The Excel view stopped working" with Try again (`ErrorBoundary`), never a white window. Reveal requests wait until Univer has rendered the sheet (2026-11-11: a reveal right after a sheet change threw and blanked the app).
- **Hovering a cell** → tooltip: concept label + qname, period, dimensions, confidence, rule status.
- **Drag** a taxonomy concept onto a cell → creates a manual mapping, `origin: manual`.
- **Double-click manual tagging (`ManualTagDialog.tsx`):**
  - Double-clicking any financial statement line item, particulars row, or figure cell (in Univer grid or FormView) opens the Manual Tag dialog immediately.
  - Search taxonomy elements by label or technical QName with debounced queries.
  - Inspect element details (data type, period type, balance type, abstract status, documentation).
  - Period scope selector: tag both Current & Previous Year (`Both CY & PY`), `CY only`, or `PY only`.
  - Direct 1-click tagging: pressing Enter on search, double-clicking any taxonomy element card, or clicking the hover `[Tag]` button directly binds the tag without repetitive confirmation dialogs.
  - Coexists with AI suggestions: preserves AI candidate alternatives and displays clear visual distinction in the Mapping Inspector (green `[Manual]` vs amber `[AI Suggestion]`).

## AI Copilot Chatbot (`AiChatPanel.tsx`)
- Located in the left activity bar (`✨` icon).
- Connected to the sidecar FastAPI service (`/api/v1/conversations`, `/api/v1/conversations/{id}/messages`) backed by LangGraph's `InMemorySaver` and Qdrant hybrid retrieval over MCA rules and taxonomies.
- **Features:**
  - Thread switcher and multi-conversation management (`+ New Conversation`, delete thread, automatic titles).
  - Quick suggested prompt chips for common MCA/Ind AS compliance questions.
  - Expandable citations showing retrieved MCA rule and taxonomy context snippets.
  - **Rich GFM Markdown Preview:** Powered by the `marked` library with custom styling (`.markdown-body` in `ui/src/styles.css`), rendering GFM tables, headings (`h1`–`h4`), code blocks, bullet/numbered lists, bold/italics, and quotes.

## Model & API Configuration
- Preconfigured securely at the backend / environment level (`.env`).
- User-facing model selection dropdown and Groq API key configuration inputs removed from the Settings panel to prevent manual tampering and streamline the accountant workflow.

## Screens
1. **Welcome:** New project · Open… · Download standard template · Recent filings · Saved projects (the projects folder). Both lists show Ind AS projects only, and each opens the project in the editor. Old-architecture entries are hidden for now (Sarthak, 2026-11-22): filings saved by the earlier engine editor, Import XBRL and Recover unsaved work. File → Open on such a file explains why it can't open.
2. **New project** (welcome, File → New Project / Ctrl+N, the activity bar's first button; the same dialog is Filing → Filing Settings…, [ADR-0017](decisions/ADR-0017-indas-in-the-editor.md)):
   1. Taxonomy: Ind AS 2017 (the C&I choice is hidden while the C&I editor needs the removed routes).
   2. Company name and CIN, validated live against the CIN format.
   3. Report type: standalone / consolidated.
   4. FY dates; first financial year?
   5. Rounding level (Actual / Thousands / Lakhs / Millions / Crores) and decimal places.
   6. Ind AS: "Open the client's Excel right after creating". The project is saved at once as `<Company>_<FY>.axbrl` in the projects folder; the settings prefill the masters (period, nature, company name, CIN, rounding) and `/generateXML`'s `meta`.
3. **An Ind AS filing in the editor** ([ADR-0017](decisions/ADR-0017-indas-in-the-editor.md)): the same Workbench as C&I.
   - **Filing Explorer:** company, CIN, FY · nature · rounding · dp; Statements (BS, P&L, OCI, cash flows, changes in equity), Notes (note ELRs, PPE, Notes text blocks [E]), Disclosures (company, auditor & signatories → the masters dialog). The ELRs come from `/indas/tree/{scope}`, grouped by canonical sheet.
   - **Excel pane:** the canonical sheets (standard template layout) in Univer: green = tagged, amber = suggestion waiting, blue = the selected line. Toolbar: Open financial statements… / Replace…, Template, Auto-tag. Below: the selected line's inspector (✓ accept / ✗ next suggestion, opening / closing balance).
   - **XBRL Form:** the ELR's presentation tree, Current year / Previous year with a cell chip per value (click → the cell in Excel); red = mandatory and empty, green = reported. Double-click a concept to tag the line selected in Excel. Toolbar: Empty mandatory → n (zero lines), Mandatory items (n) (the masters dialog), Accept suggestions (this statement), Generate XML. Footer: Difference CY · PY (per ELR, exact decimals). Changes in equity, PPE and text blocks open their tagging grid beside the taxonomy tree.
   - **XML** tab: the instance `/generateXML` wrote; **Preview:** the tagged statements, MCA-like.
   - **Problems:** before-generating checks, totals that don't add up (double-click → the statement), the MCA checks' answer. **Side panel:** Taxonomy searches the selected line's sheet scope; Masters summarises and opens the dialog.
4. **Import XBRL instance** (welcome button, File → Import XBRL Instance…; Phase 7):
   - Choose *Open that filing* (every fact as filed) or *Start next year's filing* (its current year becomes the previous year), then the file.
   - The taxonomy, company and periods come from the file.
   - The **import report** follows: counts, the round-trip proof (every fact regenerated with the same element, period, dimensions, unit, decimals and value), anything not imported, and a "their conventions vs ours" table (generator, context-id style, duplicate contexts, fact ids, units, decimals, footnotes). The report is kept in the project (`import/`).
5. **Workbench:** the main window above.
6. **Generate XML dialog:** blocking errors are summarised, with "Fix first" or "Generate anyway". Output path; option to open the MCA tool.
7. **Settings.**

## Keyboard shortcuts
| Keys | Action |
|---|---|
| Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S | New / Open / Save / Save as |
| Ctrl+Shift+V | Validate |
| Ctrl+G | Generate XML |
| Ctrl+P | Quick-switch ELR / sheet |
| Ctrl+Shift+F | Search taxonomy |
| F8 / Shift+F8 | Next / previous problem |
| Ctrl+. | Quick fix for the selected problem |
| Enter / Delete (on suggestion) | Approve / reject mapping |
| Ctrl+J | Toggle bottom panel |
| Ctrl+B | Toggle side panel |
| Ctrl+Alt+F | Focus: hide / restore both panels |
| Alt+F, Alt+E, … / Alt | Open a menu / enter the menu bar |

## Visual style
- Tailwind 4 with CSS-variable tokens; light and dark themes, following the system by default.
- Inter or Segoe UI at 13 px base; tabular numbers for amounts.
- Indian digit grouping (12,34,567.00) in the Form and Preview.
- Icons: lucide-react.
