import { useEffect, useMemo, useState } from 'react'
import {
  defaultStatementPlaces,
  defaultReportingYear,
  fyLabel,
  isValidCin,
  maxDisplayPlaces,
  previousYearOf,
  ROUNDING_LEVELS,
  validateFilingPeriods,
  type ReportType,
  type RoundingLevel,
  type TaxonomyId,
} from '@xap/engine/basics'
import type { NewFilingInput } from '@shared/project'
import { createIndasProject } from '@/app/filings'
import { Button, Checkbox, Dialog, Field, Input, Section, Select } from '@/components/ui/primitives'
import { useIndas } from '@/stores/indas'
import { useProject } from '@/stores/project'

/** New projects are Ind AS 2017 (the current architecture only, Sarthak 2026-11-22; C&I's editor needs removed routes). */
export const NEW_PROJECT_TAXONOMY: TaxonomyId = 'ind-as-2017'

interface FormState {
  taxonomy: TaxonomyId
  companyName: string
  cin: string
  reportType: ReportType
  cyStart: string
  cyEnd: string
  firstYear: boolean
  pyStart: string
  pyEnd: string
  /** once the user edits PY dates we stop deriving them from CY */
  pyTouched: boolean
  level: RoundingLevel
  statementPlaces: number
  /** after creating, open the client's financial statements (file dialog) */
  openWorkbook: boolean
}

function initialForm(): FormState {
  const cy = defaultReportingYear(new Date())
  const py = previousYearOf(cy)!
  return { taxonomy: NEW_PROJECT_TAXONOMY, companyName: '', cin: '', reportType: 'Standalone', cyStart: cy.start, cyEnd: cy.end, firstYear: false, pyStart: py.start, pyEnd: py.end, pyTouched: false, level: 'Lakhs', statementPlaces: defaultStatementPlaces('Lakhs'), openWorkbook: true }
}

/** The form filled from existing settings (Filing settings…). */
export function formOf(d: NewFilingInput): FormState {
  const py = d.py ?? previousYearOf(d.cy) ?? { start: '', end: '' }
  return {
    taxonomy: d.taxonomy ?? NEW_PROJECT_TAXONOMY,
    companyName: d.companyName,
    cin: d.cin,
    reportType: d.reportType,
    cyStart: d.cy.start,
    cyEnd: d.cy.end,
    firstYear: d.py === null,
    pyStart: py.start,
    pyEnd: py.end,
    pyTouched: d.py !== null,
    level: d.level,
    statementPlaces: d.statementPlaces ?? defaultStatementPlaces(d.level),
    openWorkbook: false,
  }
}

export function toInput(f: FormState): NewFilingInput {
  return {
    taxonomy: f.taxonomy,
    companyName: f.companyName,
    cin: f.cin.trim().toUpperCase(),
    reportType: f.reportType,
    cy: { start: f.cyStart, end: f.cyEnd },
    py: f.firstYear ? null : { start: f.pyStart, end: f.pyEnd },
    level: f.level,
    statementPlaces: f.statementPlaces,
  }
}

/**
 * New project (File → New project, Ctrl+N, start screen, activity bar) and Filing settings (Filing menu): one dialog.
 * Projects are Ind AS, created by main (validated, saved straight away as `<Company>_<FY>.axbrl` in the projects
 * folder). In settings mode it edits the open Ind AS filing.
 */
export function NewFilingDialog() {
  const { newFilingOpen, newFilingMode, closeNewFiling } = useProject()
  const details = useIndas((s) => s.details)
  const editing = newFilingMode === 'settings' && !!details
  const [f, setF] = useState<FormState>(initialForm)
  const [serverProblems, setServerProblems] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (newFilingOpen) {
      setF(editing ? formOf(details!) : initialForm())
      setServerProblems([])
      setSubmitted(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newFilingOpen, editing])

  const patch = (p: Partial<FormState>) =>
    setF((cur) => {
      const next = { ...cur, ...p }
      if (!next.pyTouched && ('cyStart' in p || 'cyEnd' in p)) {
        const py = previousYearOf({ start: next.cyStart, end: next.cyEnd })
        if (py) Object.assign(next, { pyStart: py.start, pyEnd: py.end })
      }
      return next
    })

  const input = toInput(f)
  const cinError = f.cin && !isValidCin(f.cin) ? 'A CIN has 21 characters, e.g. U72200KA2010PTC123456' : null
  const periodErrors = useMemo(() => validateFilingPeriods(input.cy, input.py), [input.cy.start, input.cy.end, input.py?.start, input.py?.end])
  const nameError = submitted && !f.companyName.trim() ? 'Enter the company name' : null
  const canSubmit = Boolean(f.companyName.trim() && isValidCin(f.cin) && periodErrors.length === 0)

  const submit = async () => {
    setSubmitted(true)
    if (!canSubmit) return
    setBusy(true)
    try {
      if (editing) {
        const problems = useIndas.getState().updateDetails(input)
        setServerProblems(problems)
        if (!problems.length) closeNewFiling()
      } else {
        const problems = await createIndasProject(input)
        setServerProblems(problems)
        if (!problems.length) {
          closeNewFiling()
          if (f.openWorkbook) void useIndas.getState().upload()
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={newFilingOpen}
      title={editing ? 'Filing settings' : 'New project — AOC-4 XBRL (Ind AS 2017)'}
      onClose={closeNewFiling}
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={closeNewFiling}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || (submitted && !canSubmit)}>
            {busy ? 'Saving…' : editing ? 'Apply' : 'Create project'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >

        <Section title="Company">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company name" error={nameError} className="col-span-2">
              <Input value={f.companyName} onChange={(e) => patch({ companyName: e.target.value })} placeholder="Acme Private Limited" autoFocus data-testid="new-company" />
            </Field>
            <Field label="CIN" error={cinError} hint="Corporate Identity Number">
              <Input
                value={f.cin}
                maxLength={21}
                className="font-mono uppercase"
                onChange={(e) => patch({ cin: e.target.value.toUpperCase() })}
                placeholder="U72200KA2010PTC123456"
                data-testid="new-cin"
              />
            </Field>
            <Field label="Nature of report">
              <Select value={f.reportType} onChange={(e) => patch({ reportType: e.target.value as ReportType })}>
                <option value="Standalone">Standalone</option>
                <option value="Consolidated">Consolidated</option>
              </Select>
            </Field>
          </div>
        </Section>

        <Section title={`Reporting period · ${fyLabel(input.cy)}`}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current year — start">
              <Input type="date" value={f.cyStart} onChange={(e) => patch({ cyStart: e.target.value })} />
            </Field>
            <Field label="Current year — end">
              <Input type="date" value={f.cyEnd} onChange={(e) => patch({ cyEnd: e.target.value })} />
            </Field>
            <Field label="Previous year — start">
              <Input type="date" value={f.pyStart} disabled={f.firstYear} onChange={(e) => patch({ pyStart: e.target.value, pyTouched: true })} />
            </Field>
            <Field label="Previous year — end">
              <Input type="date" value={f.pyEnd} disabled={f.firstYear} onChange={(e) => patch({ pyEnd: e.target.value, pyTouched: true })} />
            </Field>
            <div className="col-span-2">
              <Checkbox checked={f.firstYear} onChange={(firstYear) => patch({ firstYear })} label="First financial year of the company (no previous-year figures)" />
            </div>
          </div>
          {periodErrors.map((e) => (
            <p key={e} className="text-[11px] text-err">
              {e}
            </p>
          ))}
        </Section>

        <Section title="Presentation">
          <Field label="Level of rounding used in the financial statements" hint="As printed in the statements (e.g. ₹ in lakhs).">
            <Select
              value={f.level}
              onChange={(e) => {
                const level = e.target.value as RoundingLevel
                patch({ level, statementPlaces: defaultStatementPlaces(level) })
              }}
            >
              {ROUNDING_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Decimal places as presented" hint="As printed (₹ 5,443.47 lakhs = 2). Excel figures are rounded to the cell's format, never past these places.">
            <Select value={f.statementPlaces} onChange={(e) => patch({ statementPlaces: Number(e.target.value) })} data-testid="statement-places">
              {Array.from({ length: maxDisplayPlaces(f.level) + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        {!editing && (
          <Section title="Financial statements">
            <Checkbox
              checked={f.openWorkbook}
              onChange={(openWorkbook) => patch({ openWorkbook })}
              label="Open the client's Excel right after creating (you can also do it later: File → Open financial statements)"
            />
          </Section>
        )}

        {serverProblems.length > 0 && (
          <ul className="rounded border border-err/40 bg-err/5 p-3 text-[12px] text-err">
            {serverProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
