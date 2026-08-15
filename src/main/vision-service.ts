/**
 * Vision setup: the expert work FISHCODE performs so users never have to.
 *
 * `apply()` walks the whole setup journey on the user's behalf:
 *   1. writes the raw API key into $DSH_HOME/.credentials.yaml under the fixed
 *      ref VISION_API_KEY (dsh hot-reloads the file — no backend restart),
 *   2. GETs the vision-toolkit settings snapshot for its revision,
 *   3. POSTs a MERGED save (only the four provider fields are overridden;
 *      everything else the user may have set survives — the API stores the raw
 *      value verbatim, replacing the whole namespace),
 *   4. runs the plugin's own health + connection test and maps the outcome to
 *      friendly zh copy.
 *
 * Safety rulings this module honors:
 *   - The credentials file is parsed as strict YAML (uniqueKeys: true) by
 *     dsh-credentials-local; a duplicate VISION_API_KEY key or a corrupt
 *     document fails plugin activation at the next backend boot. The writer
 *     therefore REPLACES the existing top-level key line or REFUSES — it never
 *     appends when the key exists in any quoted form, and it refuses block
 *     scalars and duplicate keys outright.
 *   - The raw API key is never logged. Only paths and status are logged.
 *   - The first-ever save can trigger a managed-Python venv build (up to ~10
 *     minutes) inside the save POST, hence the 15-minute save timeout.
 */

import type { BackendState } from './backend-manager'
import { CredentialWriteError, writeCredentialKey } from './credentials-writer'
import { safeOpenExternal } from './security'
import { URLS } from '../shared/constants'
import { STRINGS } from '../shared/strings'
import {
  VISION_CREDENTIAL_REF,
  VISION_PRESETS,
  type VisionApplyRequest,
  type VisionApplyResult,
  type VisionProviderSettings,
  type VisionState,
} from '../shared/vision'

const SETTINGS_ROUTE = '_dsh/vision-toolkit/settings'
const JSON_HEADERS = { 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin' } as const

/** Zhipu GLM-4V-Flash hard cap per image; the preset pins the toolkit's
 * server-side limit to it so oversized direct-path references fail clearly. */
const ZHIPU_MAX_IMAGE_BYTES = 5 * 1024 * 1024

// The first save on a fresh machine can build the managed Python venv inside
// the save POST (up to ~10 min); health does a live provider probe.
const GET_TIMEOUT_MS = 15_000
const SAVE_TIMEOUT_MS = 900_000
const HEALTH_TIMEOUT_MS = 90_000
// dsh re-reads the credentials file via a watcher (100ms debounce); give the
// hot-publish a beat before declaring the freshly written key missing.
const CREDENTIAL_RETRY_DELAY_MS = 1_500

type ResultCode = keyof typeof STRINGS.visionSetup.results

export interface VisionServiceDeps {
  getBaseUrl: () => string | null
  getBackendState: () => BackendState
}

export class VisionService {
  private applying = false

  constructor(private readonly deps: VisionServiceDeps) {}

  /** Never throws — renderer polls this while the backend comes up. */
  async getState(): Promise<VisionState> {
    const backendState = this.deps.getBackendState()
    const baseUrl = this.deps.getBaseUrl()
    const degraded: VisionState = {
      backendState,
      available: false,
      configured: false,
      revision: 0,
      currentProvider: null,
      storedProvider: null,
    }
    if (!baseUrl || backendState !== 'ready') return degraded

    try {
      const response = await fetch(`${baseUrl}${SETTINGS_ROUTE}`, {
        signal: AbortSignal.timeout(GET_TIMEOUT_MS),
      })
      if (!response.ok) return degraded // 404 = plugin not mounted
      const body = (await response.json()) as SettingsEnvelope
      if (!body.ok || typeof body.value !== 'object' || body.value === null) return degraded
      const snapshot = body.value as SettingsSnapshot
      const storedProvider = normalizeProvider(
        isRecord(snapshot.settings?.value) ? snapshot.settings.value.provider : undefined,
      )
      return {
        backendState,
        available: true,
        configured: snapshot.credential?.configured === true,
        revision: typeof snapshot.settings?.revision === 'number' ? snapshot.settings.revision : 0,
        currentProvider: storedProvider ? matchPreset(storedProvider) : null,
        storedProvider,
      }
    } catch {
      return degraded // local fetch rejection — treat as unavailable, keep polling
    }
  }

  /** Single-flight; concurrent calls get a busy result. Never throws. */
  async apply(req: VisionApplyRequest): Promise<VisionApplyResult> {
    if (this.applying) return failResult('busy')
    this.applying = true
    try {
      return await this.applyInner(req)
    } catch (error) {
      console.error('[Fishcode] vision apply failed:', error)
      return failResult('network')
    } finally {
      this.applying = false
    }
  }

  openConsole(): void {
    void safeOpenExternal(URLS.zhipuConsole)
  }

  private async applyInner(req: VisionApplyRequest): Promise<VisionApplyResult> {
    const baseUrl = this.deps.getBaseUrl()
    if (this.deps.getBackendState() !== 'ready' || !baseUrl) return failResult('backend-not-ready')

    const provider = resolveProvider(req)
    if (!provider) return failResult('invalid-request')

    try {
      await writeCredentialKey(req.rawKey)
    } catch (error) {
      const code = error instanceof CredentialWriteError ? error.code : 'credential-write-failed'
      console.error(`[Fishcode] vision credential write failed (${code})`)
      return failResult(code === 'unsafe' ? 'credential-file-unsafe' : 'credential-write-failed')
    }

    // Snapshot for the revision + the existing raw value (merge preserves the
    // user's other fields — the API replaces the whole namespace verbatim).
    const snapshotResult = await this.fetchSnapshot(baseUrl)
    if (!snapshotResult.ok) return snapshotResult.result

    const existing = isRecord(snapshotResult.snapshot?.settings?.value)
      ? snapshotResult.snapshot.settings.value
      : {}
    const merged = {
      ...existing,
      provider: {
        ...(isRecord(existing.provider) ? existing.provider : {}),
        baseUrl: provider.baseUrl,
        model: provider.model,
        protocol: provider.protocol,
        credential: VISION_CREDENTIAL_REF,
      },
      // GLM-4V-Flash rejects images over 5 MB with HTTP 400 [1210] ("API 调用
      // 参数有误" — reads as a config problem, but it's the image size). UI
      // intake is auto-compressed client-side down to this cap (vendored patch
      // v4 reads maxImageBytes fresh at send time), so the cap only bites
      // direct local-path references: they fail with a clear local 'capacity'
      // error instead of a cryptic remote 1210. Custom providers keep whatever
      // limit the user configured — and the client-side compression threshold
      // follows it, so generous providers receive images untouched.
      ...(req.presetId === 'zhipu' ? { maxImageBytes: ZHIPU_MAX_IMAGE_BYTES } : {}),
    }

    const saveResult = await this.saveWithRetry(baseUrl, merged, snapshotResult.snapshot?.settings?.revision ?? 0)
    if (!saveResult.ok) return saveResult.result

    const healthResult = await this.checkHealth(baseUrl)
    return healthResult
  }

  private async fetchSnapshot(
    baseUrl: string,
  ): Promise<{ ok: true; snapshot: SettingsSnapshot } | { ok: false; result: VisionApplyResult }> {
    try {
      const response = await fetch(`${baseUrl}${SETTINGS_ROUTE}`, {
        signal: AbortSignal.timeout(GET_TIMEOUT_MS),
      })
      if (!response.ok) {
        return { ok: false, result: failResult('settings-unavailable') }
      }
      const body = (await response.json()) as SettingsEnvelope
      if (!body.ok || typeof body.value !== 'object' || body.value === null) {
        return { ok: false, result: failResult('settings-unavailable') }
      }
      return { ok: true, snapshot: body.value as SettingsSnapshot }
    } catch (error) {
      return { ok: false, result: mapFetchError(error) }
    }
  }

  private async saveWithRetry(
    baseUrl: string,
    value: Record<string, unknown>,
    expectedRevision: number,
  ): Promise<{ ok: true } | { ok: false; result: VisionApplyResult }> {
    // One retry on 409 with a fresh revision; a second conflict is reported.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`${baseUrl}${SETTINGS_ROUTE}`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ action: 'save', expectedRevision, value }),
          signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
        })
        if (response.status === 409) {
          if (attempt === 1) return { ok: false, result: failResult('settings-conflict') }
          const fresh = await this.fetchSnapshot(baseUrl)
          if (!fresh.ok) return fresh
          expectedRevision = fresh.snapshot.settings?.revision ?? 0
          continue
        }
        if (!response.ok) {
          const error = await readErrorBody(response)
          if (response.status === 403) return { ok: false, result: failResult('origin-rejected') }
          return { ok: false, result: failResult('settings-rejected', error ?? `HTTP ${response.status}`) }
        }
        const body = (await response.json()) as SettingsEnvelope
        if (!body.ok) {
          const code = body.error?.code
          if (code === 'settings-conflict' && attempt === 0) {
            const fresh = await this.fetchSnapshot(baseUrl)
            if (!fresh.ok) return fresh
            expectedRevision = fresh.snapshot.settings?.revision ?? 0
            continue
          }
          return { ok: false, result: failResult('settings-rejected', body.error?.message ?? '') }
        }
        return { ok: true }
      } catch (error) {
        return { ok: false, result: mapFetchError(error) }
      }
    }
    return { ok: false, result: failResult('settings-conflict') }
  }

  private async checkHealth(baseUrl: string): Promise<VisionApplyResult> {
    let body: HealthBody
    try {
      const response = await fetch(`${baseUrl}${SETTINGS_ROUTE}`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ action: 'health', testConnection: true }),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      })
      if (!response.ok) {
        if (response.status === 503) return failResult('health-failed')
        if (response.status === 403) return failResult('origin-rejected')
        return failResult('checks-failed')
      }
      const parsed = (await response.json()) as SettingsEnvelope
      if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) {
        return failResult('checks-failed')
      }
      body = parsed.value as HealthBody
    } catch (error) {
      return mapFetchError(error)
    }

    // The credential check can run before dsh's watcher re-reads the file we
    // just wrote; wait and retry once before declaring the key missing.
    if (body.checks?.credential?.status === 'error') {
      await sleep(CREDENTIAL_RETRY_DELAY_MS)
      try {
        const response = await fetch(`${baseUrl}${SETTINGS_ROUTE}`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ action: 'health', testConnection: true }),
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        })
        if (!response.ok) return failResult('checks-failed')
        const parsed = (await response.json()) as SettingsEnvelope
        if (parsed.ok && typeof parsed.value === 'object' && parsed.value !== null) {
          body = parsed.value as HealthBody
        }
      } catch {
        // fall through with the original body
      }
      if (body.checks?.credential?.status === 'error') return failResult('credential-missing')
    }

    const service = body.checks?.service
    const serviceStatus = service?.status
    const serviceDetail = typeof service?.detail === 'string' ? service.detail : ''

    if (serviceStatus === 'error') {
      const httpMatch = /HTTP (\d{3})/.exec(serviceDetail)
      if (httpMatch && (httpMatch[1] === '401' || httpMatch[1] === '403')) {
        return failResult('key-rejected', httpMatch[1])
      }
      if (/could not be reached/i.test(serviceDetail)) return failResult('service-unreachable')
      return failResult('service-error', serviceDetail.slice(0, 200) || '未知错误')
    }

    if (body.healthy === false) return failResult('checks-failed')

    const isServiceOk = serviceStatus === 'ok'
    const isServiceWarning = serviceStatus === 'warning'
    return {
      ok: true,
      code: 'ok',
      title: STRINGS.visionSetup.usage.title,
      message: isServiceWarning ? STRINGS.visionSetup.serviceNote : '',
      healthy: true,
      serviceStatus: isServiceOk || isServiceWarning ? serviceStatus : 'ok',
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SettingsEnvelope {
  ok?: boolean
  value?: unknown
  error?: { code?: string; message?: string }
}

interface SettingsSnapshot {
  settings?: { value?: unknown; revision?: number }
  credential?: { configured?: boolean }
}

interface HealthCheck {
  status?: string
  detail?: string
}

interface HealthBody {
  healthy?: boolean
  checks?: Record<string, HealthCheck | undefined>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function normalizeProvider(raw: unknown): VisionProviderSettings | null {
  if (!isRecord(raw)) return null
  const baseUrl = typeof raw.baseUrl === 'string' ? stripTrailingSlash(raw.baseUrl) : ''
  const model = typeof raw.model === 'string' ? raw.model : ''
  const protocol = raw.protocol === 'openai' || raw.protocol === 'anthropic' ? raw.protocol : null
  if (!baseUrl || !model || !protocol) return null
  return { baseUrl, model, protocol }
}

function matchPreset(provider: VisionProviderSettings): 'zhipu' | 'custom' {
  const normalized = provider.baseUrl.toLowerCase()
  const hit = VISION_PRESETS.find(
    (preset) =>
      preset.provider.baseUrl.toLowerCase() === normalized &&
      preset.provider.model === provider.model &&
      preset.provider.protocol === provider.protocol,
  )
  return hit ? hit.id : 'custom'
}

function resolveProvider(req: VisionApplyRequest): VisionProviderSettings | null {
  if (req.presetId === 'zhipu') return VISION_PRESETS[0]?.provider ?? null
  const custom = req.custom
  if (!custom) return null
  return { baseUrl: stripTrailingSlash(custom.baseUrl), model: custom.model, protocol: custom.protocol }
}

function failResult(code: ResultCode, detail?: string): VisionApplyResult {
  const entry = STRINGS.visionSetup.results[code]
  return {
    ok: false,
    code,
    title: entry.title,
    message: entry.message.replace('{detail}', detail ?? '未知'),
  }
}

function mapFetchError(error: unknown): VisionApplyResult {
  const name = error instanceof Error ? error.name : ''
  return name === 'AbortError' || name === 'TimeoutError' ? failResult('timeout') : failResult('network')
}

async function readErrorBody(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as SettingsEnvelope
    return typeof body.error?.message === 'string' ? body.error.message : null
  } catch {
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
