import { useEffect } from 'react'
import type { MenuCommand } from '@shared/ipc'
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
import { useMandatory } from '@/stores/mandatory'
import { useEditor } from '@/stores/editor'
import { useProject } from '@/stores/project'
import { useSettings } from '@/stores/settings'
import { useSidecar } from '@/stores/sidecar'
import { useTables } from '@/stores/tables'
import { toast } from '@/stores/toast'
import { useUi } from '@/stores/ui'
import { useValidation } from '@/stores/validation'
import { useAi } from '@/stores/ai'
import { useIndas } from '@/stores/indas'
import { IndasMastersDialog } from '@/features/indas/IndasMastersDialog'
import { closeFiling, openProjectFile } from './filings'
import { ActivityBar } from './ActivityBar'
import { StatusBar } from './StatusBar'
import { Workbench } from './Workbench'

/** Menu command → use case. One place, so the menu, toolbar buttons and shortcuts stay consistent (both filing kinds). */
function runCommand(cmd: MenuCommand): void {
  const ui = useUi.getState()
  const project = useProject.getState()
  const indas = useIndas.getState()
  const ind = indas.open
  // one long job at a time: a command that would change the filing waits until Auto-tag / Generate is done
  if (ind && indas.busy && !/^view:|^tools:settings$/.test(cmd)) return toast.info(`${indas.busy.replace(/…$/, '')} is still running. Wait until it is done.`)
  switch (cmd) {
    case 'file:new':
      return project.openNewFiling()
    case 'file:open':
      return void openProjectFile()
    case 'file:save':
      return void (ind ? indas.save() : project.summary ? project.save() : undefined)
    case 'file:save-as':
      return ind ? toast.info('Ind AS projects are saved in the projects folder (Save).') : void (project.summary ? project.saveAs() : undefined)
    case 'file:close':
      return void closeFiling()
    case 'file:import-excel':
      if (ind) return void indas.upload()
      return void (project.summary ? useEditor.getState().importWorkbook() : project.openNewFiling())
    case 'file:save-template':
      return void indas.saveTemplate()
    case 'filing:settings':
      return ind ? project.openFilingSettings() : toast.info(project.summary ? 'Filing settings can be changed for Ind AS projects.' : 'Open a filing first.')
    case 'filing:masters':
      if (ind) return indas.setMastersOpen(true)
      return project.summary ? ui.setActivity('masters') : toast.info('Open a filing first.')
    case 'view:toggle-sidebar':
      return ui.toggleSidebar()
    case 'view:toggle-bottom':
      return ui.toggleBottom()
    case 'tools:settings':
      return ui.setActivity('settings')
    case 'filing:validate':
      ui.setBottomTab('problems')
      if (ind) return indas.runCheck()
      return void (project.summary ? useValidation.getState().run() : undefined)
    case 'filing:generate-xml':
      if (ind) return void indas.generate()
      return project.summary ? useMandatory.getState().openGenerate() : toast.info('Open a filing first.')
    case 'tools:open-mca-validator':
      return void (project.summary ? useValidation.getState().launchMca() : toast.info('Open a filing first.'))
    default:
      // view:quick-switch arrives with a later phase
      return toast.info('Coming in a later phase of the build.')
  }
}

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
 * unsaved work is written to the project file. A C&I filing's recovery copies are main's AutosaveScheduler.
 */
function useIndasAutosave(): void {
  const seconds = useSettings((s) => s.state?.autosaveSeconds ?? 300)
  useEffect(() => {
    const timer = setInterval(() => void useIndas.getState().autosave(), seconds * 1000)
    return () => clearInterval(timer)
  }, [seconds])
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
