import { Group, Panel, Separator } from 'react-resizable-panels'
import { BottomPanel } from '@/features/bottom/BottomPanel'
import { ExcelPane } from '@/features/excel/ExcelPane'
import { DocumentPane } from '@/features/notes/DocumentPane'
import { IndasPipeline } from '@/features/indas/IndasPipeline'
import { WelcomeScreen } from '@/features/welcome/WelcomeScreen'
import { XbrlPane } from '@/features/xbrl/XbrlPane'
import { useIndas } from '@/stores/indas'
import { useNotes } from '@/stores/notes'
import { useProject } from '@/stores/project'
import { useUi } from '@/stores/ui'
import { SidePanel } from './SidePanel'

const sepBase = 'bg-border outline-none transition-colors hover:bg-accent data-[separator=active]:bg-accent'

function HSep() {
  return <Separator className={`w-px ${sepBase}`} />
}
function VSep() {
  return <Separator className={`h-px ${sepBase}`} />
}

/** Side panel | (Excel ⟷ XBRL) over the bottom panel. See docs/08-ui-ux.md. */
export function Workbench() {
  const { sidebarOpen, bottomOpen } = useUi()
  const hasProject = useProject((s) => s.summary !== null)
  const showingDocument = useNotes((s) => s.activeDoc !== null)
  const indasOpen = useIndas((s) => s.open)
  // the Ind AS screen is a full-width workspace: no filing explorer, no engine log panel
  const indasFocus = indasOpen && !hasProject
  return (
    <Group orientation="horizontal" className="min-w-0 flex-1">
      {sidebarOpen && !indasFocus && (
        <>
          <Panel id="side" defaultSize="20%" minSize="12%" maxSize="40%">
            <SidePanel />
          </Panel>
          <HSep />
        </>
      )}
      <Panel id="main" minSize="40%">
        <Group orientation="vertical">
          <Panel id="editors" minSize="30%">
            {hasProject ? (
              <Group orientation="horizontal">
                <Panel id="excel" defaultSize="50%" minSize="20%">
                  {showingDocument ? <DocumentPane /> : <ExcelPane />}
                </Panel>
                <HSep />
                <Panel id="xbrl" defaultSize="50%" minSize="20%">
                  <XbrlPane />
                </Panel>
              </Group>
            ) : indasOpen ? (
              <IndasPipeline />
            ) : (
              <WelcomeScreen />
            )}
          </Panel>
          {bottomOpen && !indasFocus && (
            <>
              <VSep />
              <Panel id="bottom" defaultSize="28%" minSize="10%" maxSize="70%">
                <BottomPanel />
              </Panel>
            </>
          )}
        </Group>
      </Panel>
    </Group>
  )
}
