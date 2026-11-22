import { PanelBottom, PanelBottomClose, PanelLeft, PanelLeftClose, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useUi } from '@/stores/ui'

/** VS Code-style layout toggles: show / hide the side panel (Ctrl+B) and the bottom panel (Ctrl+J). */
export function LayoutToggles({ className }: { className?: string }) {
  const { sidebarOpen, bottomOpen, toggleSidebar, toggleBottom } = useUi()
  return (
    <div className={cn('flex items-center gap-0.5', className)} role="group" aria-label="Layout">
      <Toggle on={sidebarOpen} onIcon={PanelLeft} offIcon={PanelLeftClose} label="side panel" keys="Ctrl+B" onClick={toggleSidebar} testId="toggle-sidebar" />
      <Toggle on={bottomOpen} onIcon={PanelBottom} offIcon={PanelBottomClose} label="bottom panel" keys="Ctrl+J" onClick={toggleBottom} testId="toggle-bottom" />
    </div>
  )
}

function Toggle(props: { on: boolean; onIcon: LucideIcon; offIcon: LucideIcon; label: string; keys: string; onClick(): void; testId: string }) {
  const Icon = props.on ? props.onIcon : props.offIcon
  return (
    <button
      className={cn('flex h-5 w-6 items-center justify-center rounded hover:bg-panel hover:text-fg', props.on ? 'text-fg' : 'text-muted')}
      onClick={props.onClick}
      title={`${props.on ? 'Hide' : 'Show'} the ${props.label} (${props.keys})`}
      aria-label={`Toggle the ${props.label}`}
      aria-pressed={props.on}
      data-testid={props.testId}
    >
      <Icon size={14} strokeWidth={1.75} />
    </button>
  )
}
