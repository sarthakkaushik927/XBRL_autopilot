import { ShieldCheck } from 'lucide-react'
import { Button, Checkbox, Field, Input, Section } from '@/components/ui/primitives'
import { useSettings } from '@/stores/settings'

export function SettingsPanel() {
  const { state, update, pickMcaTool } = useSettings()
  if (!state) return null

  return (
    <div className="flex flex-col gap-6 p-3">
      <Section title="AI Assistance">
        <Checkbox
          checked={state.aiConsent}
          onChange={(aiConsent) => void update({ aiConsent })}
          label="Allow sending row labels and validation messages for AI assistance"
        />
        <p className="flex gap-1.5 text-[11px] leading-relaxed text-muted">
          <ShieldCheck size={13} className="mt-px shrink-0" />
          CIN, company name, director and auditor details are never sent. Parsing, validation and XML generation stay on this PC.
        </p>
      </Section>

      <Section title="Auto-tag">
        <Checkbox
          checked={state.parallelAutoTag}
          onChange={(parallelAutoTag) => void update({ parallelAutoTag })}
          label="Faster Auto-tag (3–4 batches at once)"
        />
        <p className="text-[11px] leading-relaxed text-muted">
          With AI on, a few AI picks can differ (more Groq rate limits → model switch). Cancel stops after the running batches.
        </p>
      </Section>

      <Section title="MCA Validation Tool">
        <Field label="Tool location" hint="MCA_XBRL_Valiation_Tool_V5.1.exe — download it from mca.gov.in">
          <Input value={state.mcaToolPath} readOnly placeholder="Not set" className="font-mono text-[11px]" />
        </Field>
        <div>
          <Button onClick={() => void pickMcaTool()}>Browse…</Button>
        </div>
      </Section>

      <Section title="Saving">
        <Checkbox
          checked={state.autosave}
          onChange={(autosave) => void update({ autosave })}
          label="Auto-save (also the cloud switch at the top right of the editor)"
        />
        <Field label="Auto-save every (minutes)" hint="An Ind AS project is saved to its file (when auto-save is on); a C&I filing's unsaved work is always copied for crash recovery. 1 to 60 minutes.">
          <Input
            key={state.autosaveSeconds}
            type="number"
            min={1}
            max={60}
            defaultValue={Math.round(state.autosaveSeconds / 60)}
            onBlur={(e) => void update({ autosaveSeconds: Number(e.target.value) * 60 })}
            data-testid="autosave-minutes"
          />
        </Field>
      </Section>
    </div>
  )
}
