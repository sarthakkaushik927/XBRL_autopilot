# ADR-0017 · Ind AS filings in the webXBRL-style editor; one New project flow
- **Status:** accepted (2026-11-22, Sarthak). Branch `integrate/vashu-main` (PR #15). Builds on [docs/17](../17-team-direction.md) §5–7: Vashu's `/indas/*` pipeline and the client-side checks stay as they are.
- **Context:**
  - The Ind AS flow was a 4-step wizard (Financials → Tagging → Masters → Generate), with its steps in a bar at the top and Back / Next buttons (`IndasPipeline.tsx`). The team wants the editor the C&I filings used, like webXBRL (screenshot in the task): Filing Explorer, Excel ⟷ XBRL Form / XML / Preview, the Problems / AI Agent / Output panel, the status bar and the menus.
  - There was also no way to create an Ind AS project. "Start Ind AS filing" opened the wizard with no project behind it. "New filing" led to the old engine path, whose editor calls the removed `/taxonomies` and `/mapping` routes.
  - The Ind AS work has a different source of truth from a C&I filing:
    - C&I: an engine session in main.
    - Ind AS: the canonical rows, tags and masters held in the renderer and saved as `indas.json`.
  - The canonical rows carry no reference to the client workbook's cells. Sarthak's call: the left pane may show the parsed (canonical) sheets, since they are our own standard template's layout.
- **Decision:**
  1. **One editor, two adapters.** The shared panes read a `FilingWorkspace` (`ui/src/app/workspace.ts`: header, ELR list, active ELR, save state, problem counts), not a store:
     - `FilingExplorer`, `StatusBar`, `Workbench`, `BottomPanel`, `SidePanel` and `XbrlPane`'s tabs read it.
     - The C&I adapter wraps `useProject` / `useEditor`; the Ind AS adapter wraps `useIndas`.
     - Where the content really differs, the pane chooses by `kind`: Ind AS gets `IndasExcelPane`, `IndasFormView`, `IndasXmlView`, `IndasPreviewView` and `IndasProblemsPanel`.
     - The pieces both kinds use are shared: `UniverGrid` is now presentational (marks, reveal and callbacks as props; the C&I connector is `EditorGrid`). Also shared: `XmlCode`, `DifferenceFooter`, `CellChip`, `useFormTree`, `NewFilingDialog`, `TaxonomyPane` and `ConceptCell`.
  2. **The Excel pane shows the canonical sheets** (what `/indas/transform` returns, in the standard template's layout). Canonical row *i* of a sheet is grid row *i + 1*, so the cell ↔ tag link is exact by construction (`rowCells` / `rowIdAt` in `features/indas/workspace.ts`). Nothing is guessed, and Vashu's extractor is unchanged.
     - Select a cell → its line is selected (shown in the inspector) and its fact comes into view in the Form.
     - A value's chip in the Form → its cell in Excel.
     - Double-click a concept in the Form (or click one in the Taxonomy side panel) → tags the selected line with it.
  3. **The Filing Explorer lists each canonical sheet's ELRs** from `/indas/tree/{scope}`, grouped by the sheet that tags them, never by ELR code:
     - Statements: BS, P&L, cash flow, changes in equity.
     - Notes: financial notes, PPE, and "Notes text blocks [E]".
     - Disclosures: company, auditor & signatories.
     - The table and text sheets open their existing grids (`TableTagging.tsx`) in the Form pane.
  4. **The wizard's steps become editor commands:**
     - File → Open financial statements… / Save standard template….
     - Auto-tag (Excel toolbar; proposals only), plus Accept suggestions and Empty mandatory → 0 (Form toolbar).
     - Filing → Company & auditor details… (a dialog; fields the settings give are read-only).
     - Filing → Generate XML (also on the Form toolbar): the XML shows in the XML tab, problems go to Problems.
  5. **The Form's facts and the per-ELR Difference footer come from main in exact decimals.** `indas:check` now also returns `facts` (per concept, per year) and `byElr`. The renderer does no money arithmetic; it never adds JS floats.
  6. **One New project flow** (start screen, File → New project / Ctrl+N, activity bar) through the generalised `NewFilingDialog`:
     - It asks for company, CIN, taxonomy (default Ind AS 2017), nature, periods (with the first-year option), rounding and decimal places, and offers to open the client Excel right away.
     - For Ind AS, `IndasProjectService.create` (Electron-free) validates with the shared `validateNewFiling` (moved to `ui/shared/project.ts`) and saves `<Company>_<FY>.axbrl` in the projects folder straight away.
     - The settings live in the draft's `details` (draft version 2; version-1 drafts are migrated from `meta`) and in the manifest.
     - They prefill the masters (period, nature, company name, CIN, rounding) and `/generateXML`'s `meta`.
     - Filing → Filing settings… reopens the dialog and marks the project unsaved.
     - C&I keeps the engine path.
  7. File → Open picks a project and opens it in the right editor by its manifest's `kind` (`indas:pick-project`). File → Close Project saves an Ind AS filing's work first.
- **Removed:** `IndasPipeline.tsx`, `FinancialsStep`, `TaggingStep`, `GenerateStep`, `DifferenceBar`, the `step` / `tab` state, the `indasFocus` special case in `Workbench`, and "Start Ind AS filing". `MastersStep` became `IndasMastersDialog`.
- **No new sidecar routes.** Checks still run client-side from `/authority`, and nothing calls the sidecar on a cell edit.
- **Consequences:**
  - The editor looks and works the same for both kinds.
  - Tagging happens where the numbers are.
  - The C&I editor still depends on the removed routes; its panes are untouched apart from the generalised grid and form pieces.
  - The AI Agent tab has no Ind AS fix proposals yet.
  - Ind AS projects are not added to "Recent filings"; they are listed under Saved projects.
  - The client's original workbook is not shown, only the canonical sheets. Showing it would need provenance (sheet / row / column) from `/transform`; that is Vashu's call.
