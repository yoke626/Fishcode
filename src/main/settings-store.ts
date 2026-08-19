/**
 * Durable settings with atomic writes and corrupt-file recovery.
 *
 * Writes are debounced and go through a `.tmp` -> `rename` swap so a crash can
 * never leave a half-written settings.json. A corrupt file is renamed aside
 * (`.corrupt-<ts>`) and the defaults are restored, notifying once.
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, SETTINGS_VERSION, sanitizeSettings, type Settings } from '../shared/settings'
import { STRINGS } from '../shared/strings'

const SETTINGS_FILENAME = 'settings.json'
const WRITE_DEBOUNCE_MS = 250

export class SettingsStore {
  private current: Settings = { ...DEFAULT_SETTINGS }
  private readonly filePath: string
  private writeTimer: NodeJS.Timeout | undefined
  private readonly listeners = new Set<(settings: Settings) => void>()
  private recoveryNotified = false

  /** Injected by bootstrap so a recovered corrupt file surfaces one notification. */
  onRecover: ((message: string) => void) | undefined

  constructor(userDataDir: string) {
    this.filePath = join(userDataDir, SETTINGS_FILENAME)
  }

  get(): Settings {
    return this.current
  }

  async load(): Promise<void> {
    let raw: string
    try {
      raw = await fs.readFile(this.filePath, 'utf8')
    } catch (error) {
      // A missing file is the normal first-run case; anything else is corrupt.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await this.recoverCorrupt('unreadable')
      }
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      await this.recoverCorrupt('invalid JSON')
      return
    }

    const rawVersion = isRecord(parsed) ? parsed.version : undefined
    this.current = sanitizeSettings(parsed)
    if (rawVersion !== SETTINGS_VERSION) {
      // v1 -> v2 migration: the bundled dsh-web-ui whale pet replaces the
      // native desktop pet by default. The native pet remains available as an
      // opt-in via the tray "显示 / 隐藏桌面萌宠".
      this.current.petEnabled = false
      this.scheduleWrite()
    }
  }

  update(patch: Partial<Settings>): void {
    this.current = { ...this.current, ...patch }
    this.emit()
    this.scheduleWrite()
  }

  onChange(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Flush any pending write now; called during shutdown before the app quits. */
  async flush(): Promise<void> {
    if (this.writeTimer !== undefined) {
      clearTimeout(this.writeTimer)
      this.writeTimer = undefined
    }
    await this.writeAtomic(this.current)
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.current)
  }

  private scheduleWrite(): void {
    if (this.writeTimer !== undefined) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined
      void this.writeAtomic(this.current)
    }, WRITE_DEBOUNCE_MS)
  }

  private async writeAtomic(snapshot: Settings): Promise<void> {
    const tmp = `${this.filePath}.tmp`
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8')
    await fs.rename(tmp, this.filePath)
  }

  private async recoverCorrupt(reason: string): Promise<void> {
    const backup = `${this.filePath}.corrupt-${Date.now()}`
    try {
      await fs.rename(this.filePath, backup)
    } catch {
      // Nothing to back up (file vanished mid-read); fall through to defaults.
    }
    this.current = { ...DEFAULT_SETTINGS }
    if (!this.recoveryNotified) {
      this.recoveryNotified = true
      this.onRecover?.(`${STRINGS.settings.recovered}（${reason}）`)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
