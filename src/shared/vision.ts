/**
 * Vision setup: shared contracts, provider presets, and the IPC-layer payload
 * validator. Pure module — no electron imports — so both the main process and
 * (via compiled copies) preload-adjacent code can use it.
 *
 * The presets here encode the hard-won provider knowledge: only ship a preset
 * that has been verified end-to-end (Zhipu GLM-4V-Flash on the OpenAI-compatible
 * endpoint). Zhipu's Anthropic-compatible endpoint silently drops image content,
 * and glm-4.5/4.6/5.x on the v4 endpoint are text-only + paid — never preset
 * either. Add new presets only after live verification.
 */

export const VISION_CREDENTIAL_REF = 'VISION_API_KEY' as const

export interface VisionProviderSettings {
  baseUrl: string
  model: string
  protocol: 'openai' | 'anthropic'
}

export interface VisionPreset {
  id: 'zhipu'
  label: string
  description: string
  provider: VisionProviderSettings
}

export const VISION_PRESETS: readonly VisionPreset[] = [
  {
    id: 'zhipu',
    label: '智谱 GLM-4V-Flash（免费）',
    description: '智谱开放平台提供的免费多模态模型，注册后即可领取 API Key。',
    provider: {
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'GLM-4V-Flash',
      protocol: 'openai',
    },
  },
]

/**
 * Prefill-only defaults for the custom form. They mirror the plugin's own
 * defaults (@anionex/dsh-vision-toolkit config.js); the backend applies its
 * own defaults at resolve time, so these are only a convenience for the UI.
 */
export const CUSTOM_PRESET_DEFAULTS: VisionProviderSettings = {
  baseUrl: 'https://api.inferera.com/v1',
  model: 'gemini-3.6-flash',
  protocol: 'openai',
}

export type VisionBackendState = 'stopped' | 'starting' | 'ready' | 'restarting' | 'failed'

export interface VisionState {
  /** Mirrors BackendManager.getState(). */
  backendState: VisionBackendState
  /** True when the backend is ready AND the settings route answered (plugin mounted). */
  available: boolean
  /** snapshot.credential.configured — the credential ref resolves to a value. */
  configured: boolean
  /** snapshot.settings.revision, for the save flow's optimistic locking. */
  revision: number
  /** Which preset (if any) the stored provider settings match. */
  currentProvider: 'zhipu' | 'custom' | null
  /** The stored provider settings (normalized), if any — prefill for custom mode. */
  storedProvider: VisionProviderSettings | null
}

export interface VisionApplyRequest {
  rawKey: string
  presetId: 'zhipu' | 'custom'
  custom?: { baseUrl: string; model: string; protocol: 'openai' | 'anthropic' }
}

export interface VisionApplyResult {
  ok: boolean
  /** Machine-readable code; the renderer styles on ok/title/message, never on code. */
  code: string
  /** zh title, resolved in the main process from STRINGS.visionSetup.results. */
  title: string
  /** zh message, may embed provider detail; the renderer displays it verbatim. */
  message: string
  healthy?: boolean
  serviceStatus?: 'ok' | 'warning' | 'error' | 'not_tested'
}

/** Length bounds (chars) for the custom-provider fields. */
const CUSTOM_BASE_URL_MAX = 2048
const CUSTOM_MODEL_MAX = 256

/**
 * Pure IPC-layer validator for the apply payload. Returns null on any shape
 * violation; never throws. The rawKey constraint (printable ASCII only, no
 * control chars) matches what the credentials writer can safely store.
 */
export function parseVisionApplyRequest(payload: unknown): VisionApplyRequest | null {
  if (typeof payload !== 'object' || payload === null) return null
  const record = payload as Record<string, unknown>

  if (typeof record.rawKey !== 'string') return null
  const rawKey = record.rawKey.trim()
  if (rawKey.length < 1 || rawKey.length > 512) return null
  if (!/^[\x20-\x7E]+$/.test(rawKey)) return null

  if (record.presetId !== 'zhipu' && record.presetId !== 'custom') return null

  if (record.presetId === 'custom') {
    const custom = record.custom
    if (typeof custom !== 'object' || custom === null) return null
    const c = custom as Record<string, unknown>
    if (typeof c.baseUrl !== 'string' || typeof c.model !== 'string') return null
    const baseUrl = c.baseUrl.trim()
    const model = c.model.trim()
    if (baseUrl.length < 1 || baseUrl.length > CUSTOM_BASE_URL_MAX) return null
    if (model.length < 1 || model.length > CUSTOM_MODEL_MAX) return null
    if (c.protocol !== 'openai' && c.protocol !== 'anthropic') return null
    return { rawKey, presetId: 'custom', custom: { baseUrl, model, protocol: c.protocol } }
  }

  return { rawKey, presetId: 'zhipu' }
}
