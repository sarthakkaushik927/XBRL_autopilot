import { Group, Panel, Separator } from 'react-resizable-panels'
import { BottomPanel } from '@/features/bottom/BottomPanel'
import { ExcelPane } from '@/features/excel/ExcelPane'
import { IndasExcelPane } from '@/features/indas/IndasExcelPane'
import { DocumentPane } from '@/features/notes/DocumentPane'
import { WelcomeScreen } from '@/features/welcome/WelcomeScreen'
import { XbrlPane } from '@/features/xbrl/XbrlPane'
import { useNotes } from '@/stores/notes'
import { useUi } from '@/stores/ui'
import { SidePanel } from './SidePanel'
import { useWorkspace } from './workspace'

const sepBase = 'bg-border outline-none transition-colors hover:bg-accent data-[separator=active]:bg-accent'

function HSep() {
  return <Separator className={`w-px ${sepBase}`} />
}
function VSep() {
  return <Separator className={`h-px ${sepBase}`} />
}

/**
 * Side panel | (Excel ⟷ XBRL) over the bottom panel, for every filing kind (docs/08-ui-ux.md, ADR-0017). Only the
 * Excel pane's content differs: the C&I client workbooks, or an Ind AS filing's canonical sheets.
 */
export function Workbench() {
  const { sidebarOpen, bottomOpen } = useUi()
  const ws = useWorkspace()
  const showingDocument = useNotes((s) => s.activeDoc !== null)
  return (
    <Group orientation="horizontal" className="min-w-0 flex-1">
      {sidebarOpen && (
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
            {ws ? (
              <Group orientation="horizontal">
                <Panel id="excel" defaultSize="50%" minSize="20%">
                  {ws.kind === 'indas' ? <IndasExcelPane /> : showingDocument ? <DocumentPane /> : <ExcelPane />}
                </Panel>
                <HSep />
                <Panel id="xbrl" defaultSize="50%" minSize="20%">
                  <XbrlPane />
                </Panel>
              </Group>
            ) : (
              <WelcomeScreen />
            )}
          </Panel>
          {bottomOpen && (
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
