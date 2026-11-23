import { Maximize2, Minimize2, PanelBottom, PanelBottomClose, PanelLeft, PanelLeftClose, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/cn'
import { useUi } from '@/stores/ui'

/** VS Code-style layout toggles: side panel (Ctrl+B), bottom panel (Ctrl+J) and Focus, which hides both (Ctrl+Alt+F). */
export function LayoutToggles({ className }: { className?: string }) {
  const { sidebarOpen, bottomOpen, toggleSidebar, toggleBottom, toggleFocus } = useUi(
    useShallow((s) => ({ sidebarOpen: s.sidebarOpen, bottomOpen: s.bottomOpen, toggleSidebar: s.toggleSidebar, toggleBottom: s.toggleBottom, toggleFocus: s.toggleFocus })),
  )
  const focused = !sidebarOpen && !bottomOpen
  return (
    <div className={cn('flex items-center gap-0.5', className)} role="group" aria-label="Layout">
      <ToolbarButton
        icon={sidebarOpen ? PanelLeft : PanelLeftClose}
        on={sidebarOpen}
        title={`${sidebarOpen ? 'Hide' : 'Show'} the side panel (Ctrl+B)`}
        label="Toggle the side panel"
        onClick={toggleSidebar}
        testId="toggle-sidebar"
      />
      <ToolbarButton
        icon={bottomOpen ? PanelBottom : PanelBottomClose}
        on={bottomOpen}
        title={`${bottomOpen ? 'Hide' : 'Show'} the bottom panel (Ctrl+J)`}
        label="Toggle the bottom panel"
        onClick={toggleBottom}
        testId="toggle-bottom"
      />
      <ToolbarButton
        icon={focused ? Minimize2 : Maximize2}
        on={focused}
        title={focused ? 'Leave Focus: bring the panels back (Ctrl+Alt+F)' : 'Focus: hide both panels (Ctrl+Alt+F)'}
        label="Toggle Focus"
        onClick={toggleFocus}
        testId="toggle-focus"
      />
    </div>
  )
}

/** A small icon button for the editor toolbar; `on` shows it pressed. */
export function ToolbarButton(props: {
  icon: LucideIcon
  on?: boolean
  title: string
  label: string
  onClick(): void
  testId: string
  disabled?: boolean
  iconClassName?: string
  children?: ReactNode
}) {
  const Icon = props.icon
  return (
    <button
      className={cn(
        'relative flex h-6 min-w-6 items-center justify-center gap-1 rounded px-1 hover:bg-panel hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent',
        props.on ? 'text-fg' : 'text-muted',
      )}
      onClick={props.onClick}
      title={props.title}
      aria-label={props.label}
      aria-pressed={props.on}
      disabled={props.disabled}
      data-testid={props.testId}
    >
      <Icon size={14} strokeWidth={1.75} className={props.iconClassName} />
      {props.children}
    </button>
  )
}
