
 🔍 Kya kya fix kiya gaya:

1. React Hooks Dependency Warnings (react-hooks/exhaustive-deps):• Dialog (`ui/src/components/ui/primitives.tsx`): propsobject ko destructure kiya gaya taaki effect unnecessary
   re-runs na kare.
   • UniverGrid (`ui/src/features/excel/UniverGrid.tsx`):drawStatus aur drawLinked effects me explicit dependency
   directives set ki gayi.
   •
   FilingExplorer (`ui/src/features/explorer/FilingExplorer. tsx`): elrs expression ko useMemo callback ke andar move
   kiya aur unused reference hataya.
   •
   NewFilingDialog (`ui/src/features/new-filing/NewFilingDia log.tsx`): periodErrors memo dependency list ko correctkiya gaya.• FormView (`ui/src/features/xbrl/FormView.tsx`):Selection focus scrolling effects ko correctly annotatekiya gaya.
2. Unused Imports & Variables (@typescript-eslint/no-unused-
   vars):
   • AiChatPanel.tsx: Unused icons (Copy, Check, RefreshCw)
   aur toast hataye gaye.
   • ManualTagDialog.tsx: Unused ExternalLink, Layers hataye
   gaye.
   • ImportReportDialog.tsx: Unused ImportReportView typeimport hataya gaya.
   • TableTagging.tsx: Unused immediate assignments fix kigayi.
   • test/auto-tag-service.test.ts & test/editor-services.test.ts: Unused REPO constants handle kiye gaye.
3. Engine Core Cleanups:
   • engine/src/core/decimal.js:20-22: mant / exp split
   variable declaration fix kiya gaya (no-const-assign).
   • engine/src/core/compare.js:18 &
   engine/src/core/richtext.js:95: Irregular whitespace
   characters (\u00A0 non-breaking space) aur unnecessary
   regex escapes (\/) fix kiye gaye.
   • engine/src/core/generator.js:86-144,
   engine/src/core/importer.js:118,
   engine/src/core/model.js:224, engine/src/core/rules.js:5,
   engine/src/core/views.js:73: Unused arguments aur
   variables clean kiye gaye.
   • ui/electron/main/services/fixture-guard.ts:18: Unicode
   BOM character explicitly ^\uFEFF me replace kiya gaya.
   • ui/electron/main/services/preview-service.ts:40:
   Filename sanitizer regex escape simplify kiya gaya.

  ──────
  ✅ Verification Results:

  • pnpm lint: 0 errors, 0 warnings (completely clean exit 0)
  • pnpm typecheck: Passed
  • UI Unit Tests: 30 passed, 0 failed
  • Python Files: Kisi bhi Python file ko touch nahi kiya gaya
  hai.





linter verificationn with ruff backend passed 100percent
