import { ChevronDown, ChevronRight, FolderTree } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ElrInfo } from '@shared/project'
import { useWorkspace } from '@/app/workspace'
import { EmptyState } from '@/components/EmptyState'
import { cn } from '@/lib/cn'

const GROUPS: ElrInfo['group'][] = ['Statements', 'Notes', 'Disclosures']

/** ELR tree of the open filing (C&I or Ind AS, through the FilingWorkspace adapter). */
export function FilingExplorer() {
  const ws = useWorkspace()
  const elrs = ws?.elrs ?? []
  const activeElr = ws?.activeElr ?? null
  const openElr = (uri: string) => ws?.openElr(uri)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['Notes', 'Disclosures']))
  const [filter, setFilter] = useState('')
  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const match = (e: ElrInfo) => !q || e.code.includes(q) || e.title.toLowerCase().includes(q)
    return GROUPS.map((g) => ({ group: g, items: elrs.filter((e) => e.group === g && match(e)) }))
  }, [elrs, filter])

  if (!ws) {
    return (
      <EmptyState icon={FolderTree} title="No filing open">
        Create or open a filing to see its statements, notes and disclosures.
      </EmptyState>
    )
  }
  const toggle = (g: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(g)) n.delete(g)
      else n.add(g)
      return n
    })

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="truncate text-[13px] font-medium" data-testid="explorer-company">{ws.header.company}</div>
        <div className="truncate font-mono text-[11px] text-muted">{ws.header.cin}</div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
          <span className="truncate">
            {ws.header.fyLabel} · {ws.header.nature} · {ws.header.level} ·
          </span>
          <select
            value={ws.header.places}
            onChange={(e) => ws.header.setPlaces(Number(e.target.value))}
            title="Decimal places as presented in the statements. Tagged figures are re-read from Excel when this changes."
            aria-label="Decimal places as presented"
            data-testid="statement-places-edit"
            className="rounded border border-border bg-panel px-1 text-[11px] text-fg"
          >
            {Array.from({ length: ws.header.maxPlaces + 1 }, (_, n) => (
              <option key={n} value={n}>
                {n} dp
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="px-2 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter statements…"
          className="h-7 w-full rounded border border-border bg-panel px-2 text-xs outline-none focus:border-accent select-text"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2 text-[12px]" role="tree">
        {grouped.map(({ group, items }) => (
          <div key={group} role="group">
            <button
              className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-fg"
              onClick={() => toggle(group)}
              aria-expanded={!collapsed.has(group)}
            >
              {collapsed.has(group) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              {group} <span className="font-normal">({items.length})</span>
            </button>
            {!collapsed.has(group) &&
              items.map((e) => (
                <div
                  key={e.uri}
                  role="treeitem"
                  aria-selected={activeElr === e.uri}
                  title={e.code ? `[${e.code}] ${e.title}` : e.title}
                  data-testid="explorer-elr"
                  data-elr={e.uri}
                  onClick={() => openElr(e.uri)}
                  className={cn('flex cursor-default items-baseline gap-2 truncate py-0.5 pr-2 pl-6 hover:bg-panel-2', activeElr === e.uri && 'bg-accent/10 text-fg')}
                >
                  <span className="shrink-0 font-mono text-[10px] text-muted">{e.code}</span>
                  <span className="truncate">{e.title}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
