import { Braces } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { useWorkspace } from '@/app/workspace'
import { EmptyState } from '@/components/EmptyState'
import { Tabs } from '@/components/Tabs'
import { IndasFormView } from '@/features/indas/IndasFormView'
import { IndasPreviewView } from '@/features/indas/IndasPreviewView'
import { useUi } from '@/stores/ui'
import { FormView } from './FormView'
import { PreviewView } from './PreviewView'

// Monaco is large: load it only when the XML tab is opened.
const XmlView = lazy(() => import('./XmlView').then((m) => ({ default: m.XmlView })))
const IndasXmlView = lazy(() => import('@/features/indas/IndasXmlView').then((m) => ({ default: m.IndasXmlView })))

/** Right editor: XBRL Form (ELR grid), XML (Monaco) and an MCA-like preview, for either filing kind. */
export function XbrlPane() {
  const { rightTab, setRightTab } = useUi()
  const indas = useWorkspace()?.kind === 'indas'
  return (
    <section className="flex h-full flex-col bg-panel" aria-label="XBRL">
      <Tabs
        value={rightTab}
        onChange={setRightTab}
        tabs={[
          { id: 'form', label: 'XBRL Form' },
          { id: 'xml', label: 'XML' },
          { id: 'preview', label: 'Preview' },
        ]}
      />
      <div className="min-h-0 flex-1">
        {rightTab === 'form' && (indas ? <IndasFormView /> : <FormView />)}
        {rightTab === 'xml' && (
          <Suspense fallback={<EmptyState icon={Braces} title="Loading XML editor…" />}>{indas ? <IndasXmlView /> : <XmlView />}</Suspense>
        )}
        {rightTab === 'preview' && (indas ? <IndasPreviewView /> : <PreviewView />)}
      </div>
    </section>
  )
}
