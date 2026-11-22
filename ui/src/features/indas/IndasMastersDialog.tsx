import { Plus, Settings2, Trash2 } from 'lucide-react'
import { fyLabel } from '@xap/engine/basics'
import { useShallow } from 'zustand/react/shallow'
import type { MasterField } from '@shared/indas'
import { Button, Dialog, Field, Input, Select } from '@/components/ui/primitives'
import { useIndas } from '@/stores/indas'
import { useProject } from '@/stores/project'
import { fieldKind, knownMasters } from './model'

/**
 * Filing → Company & auditor details (the masters): the mandatory company and auditor fields (from the knowledge
 * base, /authority) and the signatories. Fields the filing settings already give (company, CIN, period, nature,
 * rounding) are shown read-only: they are edited once, in Filing settings.
 */
export function IndasMastersDialog() {
  const { mastersOpen, setMastersOpen, fields, details, company, setCompany, auditor, setAuditor, signatories, addSignatory, updateSignatory, removeSignatory } = useIndas(
    useShallow((s) => ({
      mastersOpen: s.mastersOpen, setMastersOpen: s.setMastersOpen, fields: s.fields, details: s.details, company: s.company, setCompany: s.setCompany, auditor: s.auditor,
      setAuditor: s.setAuditor, signatories: s.signatories, addSignatory: s.addSignatory, updateSignatory: s.updateSignatory, removeSignatory: s.removeSignatory,
    })),
  )
  const known = details ? knownMasters(details) : {}
  const close = () => setMastersOpen(false)
  return (
    <Dialog
      open={mastersOpen}
      title="Company, auditor & signatories"
      onClose={close}
      width={820}
      footer={
        <Button variant="primary" onClick={close} data-testid="indas-masters-done">
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-4" data-testid="indas-masters">
        {details && (
          <div className="flex items-center gap-2 rounded border border-border bg-panel-2 px-3 py-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate">
              {details.companyName} · {details.cin} · {fyLabel(details.cy)} · {details.reportType} · {details.level}
            </span>
            <Button variant="ghost" className="h-7" onClick={() => (close(), useProject.getState().openFilingSettings())}>
              <Settings2 size={13} /> Filing settings…
            </Button>
          </div>
        )}
        {!fields ? (
          <p className="text-center text-xs text-muted">Loading the mandatory fields…</p>
        ) : (
          <>
            <Card title="Company (mandatory)">
              <FieldGrid fields={fields.company} values={company} known={known} onChange={setCompany} />
            </Card>
            <Card title="Auditor's report (mandatory)">
              <FieldGrid fields={fields.auditor} values={auditor} known={known} onChange={setAuditor} />
            </Card>
          </>
        )}

        <Card title="Directors signing the financial statements (at least 2)">
          <div className="flex flex-col gap-2">
            {signatories.map((s, i) => (
              <div key={i} className="grid grid-cols-[7rem_minmax(0,1fr)_8rem_9.5rem_auto] items-end gap-2">
                <Field label="DIN">
                  <Input value={s.din} inputMode="numeric" maxLength={8} onChange={(e) => updateSignatory(i, { din: e.target.value.replace(/\D/g, '') })} />
                </Field>
                <Field label="Name">
                  <Input value={s.name} onChange={(e) => updateSignatory(i, { name: e.target.value })} />
                </Field>
                <Field label="Designation">
                  <Input value={s.designation} onChange={(e) => updateSignatory(i, { designation: e.target.value })} />
                </Field>
                <Field label="Signing date">
                  <Input type="date" value={s.signingDate ?? ''} onChange={(e) => updateSignatory(i, { signingDate: e.target.value })} />
                </Field>
                <Button variant="ghost" title="Remove" onClick={() => removeSignatory(i)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            <Button className="self-start" onClick={addSignatory}>
              <Plus size={14} /> Add director
            </Button>
          </div>
        </Card>
      </div>
    </Dialog>
  )
}

function Card(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-panel">
      <header className="border-b border-border px-3 py-2 text-xs font-semibold">{props.title}</header>
      <div className="p-3">{props.children}</div>
    </section>
  )
}

function FieldGrid(props: { fields: MasterField[]; values: Record<string, string>; known: Record<string, string>; onChange(qname: string, value: string): void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
      {props.fields.map((f) => {
        const v = props.values[f.qname] ?? ''
        const kind = fieldKind(f.type)
        const fromSettings = (f.qname.split(':').pop() ?? '') in props.known
        return (
          <Field key={f.qname} label={f.label} hint={fromSettings ? 'From Filing settings' : f.qname} className={kind === 'longtext' ? 'col-span-2' : undefined}>
            {kind === 'date' ? (
              <Input type="date" value={v} disabled={fromSettings} onChange={(e) => props.onChange(f.qname, e.target.value)} />
            ) : kind === 'boolean' ? (
              <Select value={v} disabled={fromSettings} onChange={(e) => props.onChange(f.qname, e.target.value)}>
                <option value="">—</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            ) : kind === 'longtext' ? (
              <textarea
                className="min-h-20 w-full rounded border border-border bg-panel px-2 py-1 text-[13px] outline-none focus:border-accent"
                value={v}
                onChange={(e) => props.onChange(f.qname, e.target.value)}
              />
            ) : (
              <Input value={v} disabled={fromSettings} onChange={(e) => props.onChange(f.qname, e.target.value)} />
            )}
          </Field>
        )
      })}
    </div>
  )
}
