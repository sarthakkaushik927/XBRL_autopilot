import { useEffect } from 'react'
import { Toasts } from '@/components/Toasts'
import { NewFilingDialog } from '@/features/new-filing/NewFilingDialog'
import { ImportReportDialog } from '@/features/import-xbrl/ImportReportDialog'
import { ImportXbrlDialog } from '@/features/import-xbrl/ImportXbrlDialog'
import { TableDialogs } from '@/features/tables/TableDialogs'
import { ManualTagDialog } from '@/features/excel/ManualTagDialog'
import { GenerateDialog } from '@/features/mandatory/GenerateDialog'
import { MandatoryDialog } from '@/features/mandatory/MandatoryDialog'
import { AddReplaceDialog } from '@/features/sources/AddReplaceDialog'
import { SourceDetailsDialog } from '@/features/sources/SourceDetailsDialog'
import { NoteEditorDialog } from '@/features/notes/NoteEditorDialog'
import { useEditor } from '@/stores/editor'
import { useProject } from '@/stores/project'
import { useSettings } from '@/stores/settings'
import { useSidecar } from '@/stores/sidecar'
import { useTables } from '@/stores/tables'
import { useValidation } from '@/stores/validation'
import { useAi } from '@/stores/ai'
import { useIndas } from '@/stores/indas'
import { IndasMastersDialog } from '@/features/indas/IndasMastersDialog'
import { ActivityBar } from './ActivityBar'
import { runCommand } from './commands'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'
import { Workbench } from './Workbench'

export function App() {
  const initSidecar = useSidecar((s) => s.init)
  const initProject = useProject((s) => s.init)
  const initSettings = useSettings((s) => s.init)
  const initValidation = useValidation((s) => s.init)
  const initAi = useAi((s) => s.init)

  useEffect(() => initSidecar(), [initSidecar])
  useEffect(() => initProject(), [initProject])
  useEffect(() => initSettings(), [initSettings])
  useEffect(() => initValidation(), [initValidation])
  useEffect(() => initAi(), [initAi])
  useEffect(() => window.xap?.menu.onCommand(runCommand), [])
  useEditorSync()
  useIndasAutosave()

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <Workbench />
      </div>
      <StatusBar />
      <NewFilingDialog />
      <ImportXbrlDialog />
      <ImportReportDialog />
      <TableDialogs />
      <ManualTagDialog />
      <GenerateDialog />
      <MandatoryDialog />
      <AddReplaceDialog />
      <SourceDetailsDialog />
      <NoteEditorDialog />
      <IndasMastersDialog />
      <Toasts />
    </div>
  )
}

/**
 * Auto-save of an open Ind AS project (issue #20, point 2): every `autosaveSeconds` (Settings, 5 minutes by default)
 * unsaved work is written to the project file, unless auto-save is switched off (toolbar or Settings). A C&I filing's recovery copies are main's AutosaveScheduler.
 */
function useIndasAutosave(): void {
  const seconds = useSettings((s) => s.state?.autosaveSeconds ?? 300)
  const on = useSettings((s) => s.state?.autosave ?? true)
  useEffect(() => {
    if (!on) return
    const timer = setInterval(() => void useIndas.getState().autosave(), seconds * 1000)
    return () => clearInterval(timer)
  }, [seconds, on])
}

/** Keeps the editor read-models in step with the open filing (revision bumps on every change in main). */
function useEditorSync(): void {
  const summary = useProject((s) => s.summary)
  const elrs = useProject((s) => s.elrs)
  const { sync, reset, activeElr, setActiveElr } = useEditor()
  const resetTables = useTables((s) => s.reset)
  const projectId = summary?.id ?? null

  useEffect(() => {
    reset()
    resetTables()
  }, [projectId, reset, resetTables])

  useEffect(() => {
    if (summary) void sync(summary.revision, summary.sources.length)
  }, [summary, sync])

  useEffect(() => {
    // open on the first statement (the balance sheet) by default: by group, never by code (each taxonomy numbers differently)
    if (summary && !activeElr && elrs.length) void setActiveElr((elrs.find((e) => e.group === 'Statements') ?? elrs[0]!).uri)
  }, [summary, elrs, activeElr, setActiveElr])
}
