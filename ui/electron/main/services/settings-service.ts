/**
 * SettingsService: non-secret app settings (key/value repository) + the Groq API key (secret store).
 * The key is never returned to the renderer; main reads it only to pass it to the sidecar.
 */
import { EventEmitter } from 'node:events'
import type { AppSettings, SettingsState } from '@shared/project'
import { ValidationError } from './errors'
import type { KeyValueRepository, SecretStore } from './ports'

/** Auto-save: every 5 minutes by default (issue #20, point 2), between 1 minute and 1 hour. */
export const AUTOSAVE_MIN_SECONDS = 60
export const AUTOSAVE_MAX_SECONDS = 3600

export const DEFAULT_SETTINGS: AppSettings = {
  groqModel: 'openai/gpt-oss-120b',
  mcaToolPath: '',
  autosaveSeconds: 300,
  autosave: true,
  aiConsent: false,
  // Faster Auto-tag (docs/18): off until it has been tried on the hosted backend with AI on
  parallelAutoTag: false,
}

const KEY = 'app.settings.v1'

export type SettingsEvents = {
  /** Groq key or model changed: the sidecar must be restarted to pick it up */
  'ai-config-changed': []
  changed: [SettingsState]
}

export class SettingsService extends EventEmitter<SettingsEvents> {
  /**
   * @param envGroqKey key from the dev .env (used only when none is stored), null in packaged builds
   */
  constructor(
    private readonly repo: KeyValueRepository,
    private readonly secrets: SecretStore,
    private readonly envGroqKey: string | null = null,
  ) {
    super()
  }

  get(): AppSettings {
    const raw = this.repo.get(KEY)
    let stored: Partial<AppSettings>
    try {
      stored = raw ? (JSON.parse(raw) as Partial<AppSettings>) : {}
    } catch {
      stored = {}
    }
    const out = { ...DEFAULT_SETTINGS, ...stored }
    // older versions stored their 30 s default with any other setting: below the minimum means the default now
    if (!(out.autosaveSeconds >= AUTOSAVE_MIN_SECONDS)) out.autosaveSeconds = DEFAULT_SETTINGS.autosaveSeconds
    return out
  }

  async state(): Promise<SettingsState> {
    const [stored, canEncrypt] = await Promise.all([this.secrets.get(), this.secrets.isAvailable()])
    return {
      ...this.get(),
      hasGroqKey: Boolean(stored || this.envGroqKey),
      groqKeyFromEnv: !stored && Boolean(this.envGroqKey),
      canEncrypt,
    }
  }

  update(patch: Partial<AppSettings>): Promise<SettingsState> {
    const next = { ...this.get(), ...sanitize(patch) }
    const before = this.get()
    this.repo.set(KEY, JSON.stringify(next))
    if (next.groqModel !== before.groqModel) this.emit('ai-config-changed')
    return this.emitState()
  }

  async setGroqKey(key: string): Promise<SettingsState> {
    const k = key.trim()
    if (!/^gsk_[A-Za-z0-9]{20,}$/.test(k)) throw new ValidationError(['That does not look like a Groq API key (it starts with "gsk_").'])
    await this.secrets.set(k)
    this.emit('ai-config-changed')
    return this.emitState()
  }

  async clearGroqKey(): Promise<SettingsState> {
    await this.secrets.clear()
    this.emit('ai-config-changed')
    return this.emitState()
  }

  /** Main-process only: the effective key for the sidecar (stored key wins over the dev .env). */
  async groqKey(): Promise<string | null> {
    return (await this.secrets.get()) ?? this.envGroqKey
  }

  private async emitState(): Promise<SettingsState> {
    const s = await this.state()
    this.emit('changed', s)
    return s
  }
}

function sanitize(p: Partial<AppSettings>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {}
  if (typeof p.groqModel === 'string' && p.groqModel.trim()) out.groqModel = p.groqModel.trim()
  if (typeof p.mcaToolPath === 'string') out.mcaToolPath = p.mcaToolPath.trim()
  if (typeof p.autosaveSeconds === 'number' && Number.isFinite(p.autosaveSeconds)) {
    out.autosaveSeconds = Math.min(AUTOSAVE_MAX_SECONDS, Math.max(AUTOSAVE_MIN_SECONDS, Math.round(p.autosaveSeconds)))
  }
  if (typeof p.autosave === 'boolean') out.autosave = p.autosave
  if (typeof p.aiConsent === 'boolean') out.aiConsent = p.aiConsent
  if (typeof p.parallelAutoTag === 'boolean') out.parallelAutoTag = p.parallelAutoTag
  return out
}
