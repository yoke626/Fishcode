/**
 * Settings owned by the FISHCODE shell itself. The harness owns everything it
 * reads from `$DSH_HOME` (API key, models, sessions); these are the shell's
 * own machine-local preferences.
 */

export interface PetPosition {
  x: number
  y: number
}

export interface Settings {
  version: 2
  onboardingDone: boolean
  minimizeToTray: boolean
  autoLaunch: boolean
  /** Native desktop pet. Since the dsh-web-ui whale pet is bundled, this
   *  defaults to off; users can still re-enable the native pet from the tray. */
  petEnabled: boolean
  petPosition: PetPosition | null
}

export const SETTINGS_VERSION = 2

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  onboardingDone: false,
  minimizeToTray: true,
  autoLaunch: false,
  petEnabled: false,
  petPosition: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asPetPosition(value: unknown): PetPosition | null {
  if (!isRecord(value)) return null
  if (typeof value.x !== 'number' || typeof value.y !== 'number') return null
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null
  return { x: value.x, y: value.y }
}

/** Coerce an unknown value into a complete, valid Settings object. */
export function sanitizeSettings(value: unknown): Settings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS }
  return {
    version: SETTINGS_VERSION,
    onboardingDone: asBoolean(value.onboardingDone, DEFAULT_SETTINGS.onboardingDone),
    minimizeToTray: asBoolean(value.minimizeToTray, DEFAULT_SETTINGS.minimizeToTray),
    autoLaunch: asBoolean(value.autoLaunch, DEFAULT_SETTINGS.autoLaunch),
    petEnabled: asBoolean(value.petEnabled, DEFAULT_SETTINGS.petEnabled),
    petPosition: value.petPosition === undefined ? null : asPetPosition(value.petPosition),
  }
}

/** Coerce an untrusted IPC payload into a partial patch (drops unknown/invalid keys). */
export function sanitizeSettingsPatch(value: unknown): Partial<Settings> {
  if (!isRecord(value)) return {}
  const patch: Partial<Settings> = {}
  if (typeof value.onboardingDone === 'boolean') patch.onboardingDone = value.onboardingDone
  if (typeof value.minimizeToTray === 'boolean') patch.minimizeToTray = value.minimizeToTray
  if (typeof value.autoLaunch === 'boolean') patch.autoLaunch = value.autoLaunch
  if (typeof value.petEnabled === 'boolean') patch.petEnabled = value.petEnabled
  if (value.petPosition !== undefined) patch.petPosition = asPetPosition(value.petPosition)
  return patch
}
