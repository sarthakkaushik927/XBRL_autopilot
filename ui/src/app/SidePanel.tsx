import { ChevronsLeft, TriangleAlert } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { IndasMastersSummary, IndasTaxonomyPanel } from '@/features/indas/IndasSidePanels'
import { IndasProblemsPanel } from '@/features/indas/IndasProblemsPanel'
import { AiChatPanel } from '@/features/ai-chat/AiChatPanel'
import { FilingExplorer } from '@/features/explorer/FilingExplorer'
import { MastersPanel } from '@/features/masters/MastersPanel'
import { SettingsPanel } from '@/features/settings/SettingsPanel'
import { TaxonomyPanel } from '@/features/taxonomy/TaxonomyPanel'
import { cn } from '@/lib/cn'
import { useUi, type Activity } from '@/stores/ui'
import { useWorkspace } from './workspace'

const TITLES: Record<Activity, string> = {
  explorer: 'Filing explorer',
  taxonomy: 'Taxonomy',
  problems: 'Problems',
  ai: 'AI assistant',
  masters: 'Masters',
  settings: 'Settings',
}

export function SidePanel() {
  const activity = useUi((s) => s.activity)
  const hide = useUi((s) => s.toggleSidebar)
  const indas = useWorkspace()?.kind === 'indas'
  return (
    <aside className="flex h-full flex-col bg-panel">
      <header className="flex h-8 shrink-0 items-center border-b border-border pr-1 pl-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span className="min-w-0 flex-1 truncate">{TITLES[activity]}</span>
        <button className="flex h-6 w-6 items-center justify-center rounded hover:bg-panel-2 hover:text-fg" onClick={hide} title="Hide the side panel (Ctrl+B)" aria-label="Hide the side panel" data-testid="sidebar-hide">
          <ChevronsLeft size={14} />
        </button>
      </header>
      <div className={cn('min-h-0 flex-1', activity === 'ai' ? 'flex flex-col overflow-hidden' : 'overflow-auto')}>
        {activity === 'explorer' && <FilingExplorer />}
        {activity === 'taxonomy' && (indas ? <IndasTaxonomyPanel /> : <TaxonomyPanel />)}
        {activity === 'problems' &&
          (indas ? (
            <IndasProblemsPanel />
          ) : (
            <EmptyState icon={TriangleAlert} title="No problems" phase="Phase 6">
              Validation errors, warnings and MCA tool messages will be grouped by statement here.
            </EmptyState>
          ))}
        {activity === 'ai' && <AiChatPanel />}
        {activity === 'masters' && (indas ? <IndasMastersSummary /> : <MastersPanel />)}
        {activity === 'settings' && <SettingsPanel />}
      </div>
    </aside>
  )
}
