/**
 * FilingWorkspace: what the editor's shared panes (Filing Explorer, status bar, bottom panel, Workbench) need to know
 * about the open filing, whichever kind it is (ADR-0017). Two adapters fill it: the C&I engine session (useProject /
 * useEditor) and the Ind AS filing (useIndas). Panes read this instead of a store, so one editor serves both.
 */
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { fyLabel, maxDisplayPlaces, taxonomyLabel, type RoundingLevel, type TaxonomyId } from '@xap/engine/basics'
import type { ElrInfo } from '@shared/project'
import { readinessProblems } from '@/features/indas/model'
import { explorerElrs, problemsOf } from '@/features/indas/workspace'
import { useEditor } from '@/stores/editor'
import { useIndas } from '@/stores/indas'
import { useProject } from '@/stores/project'
import { useUi } from '@/stores/ui'
import { useValidation } from '@/stores/validation'

export interface WorkspaceHeader {
  company: string
  cin: string
  fyLabel: string
  nature: string
  level: RoundingLevel
  places: number
  maxPlaces: number
  setPlaces(places: number): void
}

export interface FilingWorkspace {
  kind: 'filing' | 'indas'
  header: WorkspaceHeader
  taxonomy: string
  /** 'Saved', or 'Saved 10:42' / 'Auto-saved 10:42' when the time is known */
  saveState: 'Saved' | `Saved ${string}` | `Auto-saved ${string}` | 'Unsaved changes' | 'Not saved yet' | 'Read-only'
  elrs: ElrInfo[]
  activeElr: string | null
  openElr(uri: string): void
  /** null = not validated yet */
  problems: { errors: number; warnings: number } | null
}

/** The open filing as the shared panes see it; null when none is open. */
export function useWorkspace(): FilingWorkspace | null {
  const indas = useIndasWorkspace()
  const filing = useFilingWorkspace()
  return indas ?? filing
}

/** "10:42" in the user's time zone */
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function useFilingWorkspace(): FilingWorkspace | null {
  const { summary, elrs, setStatementPlaces } = useProject()
  const { activeElr, setActiveElr } = useEditor()
  const setRightTab = useUi((s) => s.setRightTab)
  const problems = useValidation((s) => s.view?.summary ?? null)
  return useMemo(() => {
    if (!summary) return null
    return {
      kind: 'filing',
      header: {
        company: summary.company.name,
        cin: summary.company.cin,
        fyLabel: summary.fyLabel,
        nature: summary.reportType,
        level: summary.level,
        places: summary.statementPlaces,
        maxPlaces: maxDisplayPlaces(summary.level),
        setPlaces: (n) => void setStatementPlaces(n),
      },
      taxonomy: taxonomyLabel(summary.taxonomy),
      saveState: summary.readOnlyReason ? 'Read-only' : summary.dirty ? (summary.path ? 'Unsaved changes' : 'Not saved yet') : 'Saved',
      elrs,
      activeElr,
      openElr: (uri) => {
        void setActiveElr(uri)
        setRightTab('form')
      },
      problems: problems ? { errors: problems.errors, warnings: problems.warnings } : null,
    }
  }, [summary, elrs, activeElr, setActiveElr, setRightTab, setStatementPlaces, problems])
}

function useIndasWorkspace(): FilingWorkspace | null {
  // only what the shared panes show: a selection or progress change must not re-render the whole window
  const s = useIndas(useShallow((x) => ({ open: x.open, details: x.details, dirty: x.dirty, savedAt: x.savedAt, activeElr: x.activeElr, setActiveElr: x.setActiveElr })))
  const setRightTab = useUi((u) => u.setRightTab)
  const elrs = useIndasElrs()
  const problems = useIndasProblems()
  return useMemo(() => {
    const d = s.details
    if (!s.open || !d) return null
    return {
      kind: 'indas',
      header: {
        company: d.companyName,
        cin: d.cin,
        fyLabel: fyLabel(d.cy),
        nature: d.reportType,
        level: d.level,
        places: d.statementPlaces ?? 0,
        maxPlaces: maxDisplayPlaces(d.level),
        setPlaces: (n) => void useIndas.getState().updateDetails({ ...d, statementPlaces: n }),
      },
      taxonomy: taxonomyLabel((d.taxonomy ?? 'ind-as-2017') as TaxonomyId),
      saveState: s.dirty ? 'Unsaved changes' : s.savedAt ? `${s.savedAt.auto ? 'Auto-saved' : 'Saved'} ${clock(s.savedAt.at)}` : 'Saved',
      elrs,
      activeElr: s.activeElr,
      openElr: (uri) => {
        s.setActiveElr(uri)
        setRightTab('form')
      },
      problems: { errors: problems.filter((p) => p.severity === 'error').length, warnings: problems.filter((p) => p.severity === 'warning').length },
    }
  }, [s, elrs, problems, setRightTab])
}

/** The Ind AS explorer entries (stable while the trees don't change). */
export function useIndasElrs() {
  const trees = useIndas((s) => s.trees)
  return useMemo(() => explorerElrs(trees), [trees])
}

/** The Ind AS Problems list: readiness, totals that don't add up, MCA's answer to Generate. */
export function useIndasProblems() {
  const { rows, socie, ppe, details, signatories, company, fields, checks, result } = useIndas(
    useShallow((s) => ({ rows: s.rows, socie: s.socie, ppe: s.ppe, details: s.details, signatories: s.signatories, company: s.company, fields: s.fields, checks: s.checks, result: s.result })),
  )
  return useMemo(() => {
    if (!details) return []
    const readiness = readinessProblems({ rows, details, signatories, company, companyFields: fields?.company ?? [] })
    return problemsOf({ readiness, checks, result, lines: { rows, socie, ppe } })
  }, [rows, socie, ppe, details, signatories, company, fields, checks, result])
}
