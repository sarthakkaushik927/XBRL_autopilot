import type { MenuCommand } from '@shared/ipc'
import { useEditor } from '@/stores/editor'
import { useIndas } from '@/stores/indas'
import { useMandatory } from '@/stores/mandatory'
import { useProject } from '@/stores/project'
import { toast } from '@/stores/toast'
import { useUi } from '@/stores/ui'
import { useValidation } from '@/stores/validation'
import { closeFiling, openProjectFile } from './filings'

/** Menu command → use case. One place, so the menu, toolbar buttons and shortcuts stay consistent (both filing kinds). */
export function runCommand(cmd: MenuCommand): void {
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
    case 'view:toggle-focus':
      return ui.toggleFocus()
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
