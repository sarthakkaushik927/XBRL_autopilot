import Editor, { type OnMount } from '@monaco-editor/react'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import '@/lib/monaco'
import type { monaco as Monaco } from '@/lib/monaco'
import { useEditor } from '@/stores/editor'

type Ed = Monaco.editor.IStandaloneCodeEditor

const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches

/** Live, read-only instance XML of a C&I filing. Selecting a fact highlights its line; clicking a fact line selects it. */
export function XmlView() {
  const { xml, selection, selectFact, setXmlWanted } = useEditor()
  useEffect(() => {
    void setXmlWanted(true)
    return () => void setXmlWanted(false)
  }, [setXmlWanted])
  const factByLine = useMemo(() => new Map(Object.entries(xml?.factLines ?? {}).map(([k, l]) => [l, k])), [xml])
  const status = xml ? (
    xml.validated ? (
      <span className="flex items-center gap-1 text-ok">
        <CircleCheck size={13} /> Passes internal validation
      </span>
    ) : (
      <span className="flex items-center gap-1 text-warn" data-testid="xml-status">
        <CircleAlert size={13} /> Preview — {xml.errorCount} validation error(s) remain; not ready to file
      </span>
    )
  ) : (
    <span className="text-muted">Generating…</span>
  )
  return (
    <XmlCode
      xml={xml?.xml ?? ''}
      status={status}
      right={xml ? `${Object.keys(xml.factLines).length} facts` : undefined}
      highlightLine={selection.factKey ? xml?.factLines[selection.factKey] : undefined}
      onLineClick={(line) => {
        const key = factByLine.get(line)
        if (key) selectFact(key)
      }}
    />
  )
}

/** Read-only XML in Monaco with a status strip; one line can be highlighted (the selected fact). */
export function XmlCode(props: { xml: string; status: ReactNode; right?: string; highlightLine?: number; onLineClick?(line: number): void }) {
  const editorRef = useRef<Ed | null>(null)
  // state, not only the ref: the highlight effect must re-run once Monaco has mounted (it mounts after the XML arrives)
  const [mounted, setMounted] = useState(false)
  const decorations = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null)
  const [dark, setDark] = useState(prefersDark)
  const onLineClick = useRef(props.onLineClick)
  onLineClick.current = props.onLineClick

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onChange = () => setDark(prefersDark())
    mq?.addEventListener('change', onChange)
    return () => mq?.removeEventListener('change', onChange)
  }, [])

  const line = props.highlightLine
  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    decorations.current?.clear()
    if (!line) return
    decorations.current = ed.createDecorationsCollection([
      { range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, options: { isWholeLine: true, className: 'xap-xml-line', linesDecorationsClassName: 'xap-xml-gutter' } },
    ])
    ed.revealLineInCenterIfOutsideViewport(line)
  }, [line, props.xml, mounted])

  const onMount: OnMount = (ed) => {
    editorRef.current = ed
    setMounted(true)
    ed.onMouseDown((e) => {
      const at = e.target.position?.lineNumber
      if (at) onLineClick.current?.(at)
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-[11px]">
        {props.status}
        <span className="flex-1" />
        {props.right && <span className="text-muted">{props.right}</span>}
      </div>
      <div className="min-h-0 flex-1" data-testid="xml-editor">
        <Editor
          value={props.xml}
          language="xml"
          theme={dark ? 'vs-dark' : 'vs'}
          onMount={onMount}
          options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, wordWrap: 'off', scrollBeyondLastLine: false, renderLineHighlight: 'none', domReadOnly: true }}
        />
      </div>
    </div>
  )
}
