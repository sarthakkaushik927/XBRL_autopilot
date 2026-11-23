import { Cloud, CloudCheck, CloudOff, CloudUpload, Save } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/cn'
import { useIndas } from '@/stores/indas'
import { useSettings } from '@/stores/settings'
import { runCommand } from './commands'
import { LayoutToggles, ToolbarButton } from './LayoutToggles'
import { useWorkspace } from './workspace'

/** How long the "just saved" tick stays after a save lands. */
const SAVED_FLASH_MS = 1800

/**
 * The editor toolbar in the title bar (TitleBar.tsx): auto-save on/off (Ind AS), Save, and the layout toggles.
 * Thin: it shows state and runs the same commands as the menu and the shortcuts.
 */
export function EditorToolbar() {
  const ws = useWorkspace()
  return (
    <div className="flex items-center gap-0.5 px-1.5" role="toolbar" aria-label="Editor">
      {ws?.kind === 'indas' && <AutosaveToggle />}
      {ws && <SaveButton saveState={ws.saveState} />}
      <LayoutToggles className={cn(ws && 'ml-1 border-l border-border pl-1.5')} />
    </div>
  )
}

function SaveButton({ saveState }: { saveState: string }) {
  const saving = useIndas((s) => s.saving === 'manual')
  const dirty = saveState === 'Unsaved changes' || saveState === 'Not saved yet'
  return (
    <ToolbarButton
      icon={Save}
      on={dirty}
      title={`Save (Ctrl+S) · ${saving ? 'Saving…' : saveState}`}
      label="Save"
      onClick={() => runCommand('file:save')}
      disabled={saveState === 'Read-only'}
      iconClassName={cn(saving && 'animate-pulse text-accent')}
      testId="toolbar-save"
    >
      {dirty && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />}
    </ToolbarButton>
  )
}

/** Auto-save on/off; the cloud animates while an auto-save is written and ticks when it lands. */
function AutosaveToggle() {
  const { on, minutes, update } = useSettings(
    useShallow((s) => ({ on: s.state?.autosave ?? true, minutes: Math.round((s.state?.autosaveSeconds ?? 300) / 60), update: s.update })),
  )
  const { saving, dirty, savedAt } = useIndas(useShallow((s) => ({ saving: s.saving === 'auto', dirty: s.dirty, savedAt: s.savedAt })))
  const justSaved = useFlashOnChange(savedAt?.auto ? savedAt.at : null)

  const state = !on ? 'off' : saving ? 'saving' : justSaved ? 'saved' : dirty ? 'pending' : 'clean'
  const icon = { off: CloudOff, saving: CloudUpload, saved: CloudCheck, pending: Cloud, clean: CloudCheck }[state]
  const last = savedAt ? ` Last ${savedAt.auto ? 'auto-saved' : 'saved'} ${new Date(savedAt.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''
  const title = on
    ? `Auto-save is on: unsaved work is saved every ${minutes} min (change it in Settings).${last} Click to turn it off.`
    : 'Auto-save is off: only Save (Ctrl+S) writes the project. Click to turn it on.'

  const toggle = async () => {
    await update({ autosave: !on })
    if (!on) void useIndas.getState().autosave() // turned on with unsaved work: save it now
  }

  return (
    <ToolbarButton
      icon={icon}
      on={on}
      title={title}
      label={on ? 'Turn auto-save off' : 'Turn auto-save on'}
      onClick={() => void toggle()}
      iconClassName={cn(state === 'saving' && 'animate-pulse text-accent', state === 'saved' && 'text-ok', state === 'pending' && 'text-warn')}
      testId="toggle-autosave"
    >
      {state === 'saved' && <span className="pointer-events-none absolute left-1 top-1 h-4 w-4 animate-ping rounded-full bg-ok/30" aria-hidden />}
      <span className={cn('text-[10px] font-medium uppercase tracking-wide', !on && 'line-through decoration-1')} data-testid="autosave-state" data-state={state}>
        Auto
      </span>
    </ToolbarButton>
  )
}

/** true for a moment each time `value` changes to a new non-null value (not on mount). */
function useFlashOnChange(value: string | null): boolean {
  const [flash, setFlash] = useState(false)
  const prev = useRef(value)
  // a layout effect: the tick shows in the same frame as the new save time (no flash of the plain icon first)
  useLayoutEffect(() => {
    if (value === prev.current) return
    prev.current = value
    if (!value) return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), SAVED_FLASH_MS)
    return () => clearTimeout(t)
  }, [value])
  return flash
}
