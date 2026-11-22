import { ChevronDown, RotateCw, Sparkles } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useWorkspace } from '@/app/workspace'
import { EmptyState } from '@/components/EmptyState'
import { Tabs } from '@/components/Tabs'
import { IndasProblemsPanel } from '@/features/indas/IndasProblemsPanel'
import { cn } from '@/lib/cn'
import { useSidecar } from '@/stores/sidecar'
import { useUi } from '@/stores/ui'
import { openCards, useAi } from '@/stores/ai'
import { useValidation } from '@/stores/validation'
import { AiPanel } from './AiPanel'
import { ProblemsPanel } from './ProblemsPanel'

function OutputLog() {
  const logs = useSidecar((s) => s.logs)
  const end = useRef<HTMLDivElement>(null)
  // Block body on purpose: scrollIntoView() returns a Promise in recent Chromium, and React would
  // treat a returned value as the effect's cleanup ("destroy_ is not a function").
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [logs.length])
  return (
    <div className="h-full overflow-auto px-3 py-2 font-mono text-[11px] leading-5 select-text" data-testid="output-log">
      {logs.length === 0 && <div className="text-muted">No output yet.</div>}
      {logs.map((l, i) => (
        <div key={i} className={cn(l.stream === 'stderr' && 'text-muted', l.stream === 'system' && 'text-accent')}>
          <span className="text-muted">{new Date(l.ts).toLocaleTimeString()} </span>
          {l.text}
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}

export function BottomPanel() {
  const { bottomTab, setBottomTab, toggleBottom } = useUi()
  const ws = useWorkspace()
  const indas = ws?.kind === 'indas'
  const ciErrors = useValidation((s) => s.view?.summary.errors ?? 0)
  const errors = indas ? (ws.problems?.errors ?? 0) : ciErrors
  const toReview = useAi((s) => openCards(s.view).length)
  return (
    <section className="flex h-full flex-col bg-panel" aria-label="Bottom panel">
      <Tabs
        value={bottomTab}
        onChange={setBottomTab}
        tabs={[
          { id: 'problems', label: 'Problems', badge: errors },
          { id: 'ai', label: 'AI Agent', badge: indas ? 0 : toReview },
          { id: 'output', label: 'Output' },
        ]}
        right={
          <>
            {bottomTab === 'output' && (
              <button
                className="flex items-center gap-1 px-3 text-muted hover:text-fg"
                title="Restart AI engine"
                onClick={() => void window.xap?.sidecar.restart()}
              >
                <RotateCw size={12} /> Restart AI engine
              </button>
            )}
            <button
              className="flex items-center px-2 text-muted hover:text-fg"
              title="Hide the panel (Ctrl+J). Show it again from the status bar or View → Toggle Bottom Panel."
              aria-label="Hide the bottom panel"
              onClick={toggleBottom}
              data-testid="bottom-hide"
            >
              <ChevronDown size={14} />
            </button>
          </>
        }
      />
      <div className="min-h-0 flex-1">
        {bottomTab === 'problems' && (indas ? <IndasProblemsPanel /> : <ProblemsPanel />)}
        {bottomTab === 'ai' &&
          (indas ? (
            <EmptyState icon={Sparkles} title="AI fix proposals">
              For an Ind AS filing the AI proposes tags (Auto-tag in the Excel pane); fixes for the MCA problems are proposed for C&amp;I filings only for now.
            </EmptyState>
          ) : (
            <AiPanel />
          ))}
        {bottomTab === 'output' && <OutputLog />}
      </div>
    </section>
  )
}
