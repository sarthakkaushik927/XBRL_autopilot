import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import type { SheetTree } from '@shared/indas'
import { Input } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useIndas } from '@/stores/indas'

/**
 * The split view's right pane (docs/15 §5): the sheet's taxonomy tree. Green = tagged (with how many lines),
 * amber = suggested for the selected line. Clicking a concept tags the selected line with it.
 */
export function TaxonomyPane(props: {
  scope: string
  kind: 'concept' | 'member'
  /** qname → number of lines tagged with it */
  tagged: Map<string, number>
  /** the selected line's accepted value and its suggestions */
  current: string
  suggested: string[]
  /** shown above the tree */
  title: string
}) {
  const { trees, loadTree, tagFromTree, selection } = useIndas()
  const key = `${props.scope}:${props.kind}`
  const list = trees[key]
  const [query, setQuery] = useState('')
  const [elr, setElr] = useState<string | null>(null)
  // folded heads (+ / − as in webXBRL); search shows everything
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const toggle = (q: string) => setFolded((f) => (f.has(q) ? new Set([...f].filter((x) => x !== q)) : new Set([...f, q])))
  useEffect(() => {
    void loadTree(props.scope, props.kind)
  }, [props.scope, props.kind, loadTree])

  // a multi-ELR scope (notes) opens the ELR that holds the selected line's concept or suggestion
  const focus = props.current || props.suggested[0] || ''
  const active: SheetTree | undefined = useMemo(() => {
    if (!list?.length) return undefined
    if (list.length === 1) return list[0]
    const holder = focus ? list.find((t) => t.nodes.some((n) => n.qname === focus)) : undefined
    return holder ?? list.find((t) => t.elr === elr) ?? list[0]
  }, [list, focus, elr])

  const q = query.trim().toLowerCase()
  const nodes = useMemo(() => {
    if (!list) return []
    if (!q) {
      // hide the children of folded heads
      const out: ((typeof list)[number]['nodes'][number] & { tree: string })[] = []
      let hideBelow: number | null = null
      for (const n of active?.nodes ?? []) {
        if (hideBelow !== null && n.depth > hideBelow) continue
        hideBelow = folded.has(n.qname) ? n.depth : null
        out.push({ ...n, tree: active!.title })
      }
      return out
    }
    // a search covers every tree of the scope
    return list.flatMap((t) => t.nodes.filter((n) => !n.abstract && (n.label.toLowerCase().includes(q) || n.qname.toLowerCase().includes(q))).map((n) => ({ ...n, depth: 0, tree: t.title })))
  }, [list, active, q, folded])

  const focusRef = useRef<HTMLButtonElement | null>(null)
  // a block body: newer Chromium returns a Promise from scrollIntoView, which an effect must not return
  useEffect(() => {
    void focusRef.current?.scrollIntoView({ block: 'center' })
  }, [focus, active?.elr])

  return (
    <aside className="flex min-h-0 flex-col rounded-md border border-border bg-panel" data-testid="indas-taxonomy">
      <header className="flex flex-col gap-2 border-b border-border p-2">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <span className="min-w-0 flex-1 truncate">{props.title}</span>
          <button className="text-[11px] font-normal text-muted hover:text-fg" onClick={() => setFolded(new Set())} title="Expand all">
            Expand all
          </button>
        </div>
        {list && list.length > 1 && !q && (
          <select className="h-7 rounded border border-border bg-panel px-1 text-[12px]" value={active?.elr ?? ''} onChange={(e) => setElr(e.target.value)} aria-label="Statement or note">
            {list.map((t) => (
              <option key={t.elr} value={t.elr}>
                {t.title} ({t.elr})
              </option>
            ))}
          </select>
        )}
        <div className="relative">
          <Search size={13} className="absolute top-2 left-2 text-muted" />
          <Input className="h-7 pl-7 text-[12px]" placeholder="Search concepts" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="text-[11px] text-muted">{selection ? 'Click a concept to tag the selected line.' : 'Select a line on the left, then click its concept here.'}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {!list && <p className="p-4 text-center text-xs text-muted">Loading the taxonomy…</p>}
        {nodes.map((n, i) => {
          const count = props.tagged.get(n.qname) ?? 0
          const isCurrent = n.qname === props.current
          const isSuggested = !isCurrent && props.suggested.includes(n.qname)
          const missing = n.mandatory && count === 0
          return (
            <div key={`${n.qname}-${i}`} className="flex items-center" style={{ paddingLeft: 4 + n.depth * 12 }}>
            {n.abstract && !q ? (
              <button className="w-4 shrink-0 text-muted" onClick={() => toggle(n.qname)} aria-label={folded.has(n.qname) ? 'Expand' : 'Collapse'}>
                {folded.has(n.qname) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <button
              ref={n.qname === focus ? focusRef : undefined}
              disabled={n.abstract || !selection}
              onClick={() => tagFromTree(n)}
              title={`${n.qname}${n.periodType ? ` · ${n.periodType}` : ''}${q ? ` · ${n.tree}` : ''}`}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 py-0.5 pr-2 text-left text-[12px]',
                missing && 'text-err',
                n.abstract ? 'cursor-default font-semibold text-muted' : 'hover:bg-panel-2 disabled:cursor-default disabled:hover:bg-transparent',
                isCurrent && 'bg-accent/15 font-medium text-fg',
                isSuggested && 'bg-warn/10',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{n.label}</span>
              {n.mandatory && <span className={cn('shrink-0 text-[10px] font-semibold', missing ? 'text-err' : 'text-muted')} title="Mandatory (MCA)">M</span>}
              {isSuggested && <span className="shrink-0 rounded bg-warn/20 px-1 text-[10px] text-warn">suggested</span>}
              {count > 0 && <span className="shrink-0 rounded bg-ok/15 px-1 text-[10px] text-ok">✓ {count}</span>}
            </button>
            </div>
          )
        })}
        {list && nodes.length === 0 && <p className="p-4 text-center text-xs text-muted">No concept matches.</p>}
      </div>
    </aside>
  )
}
