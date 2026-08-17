/**
 * ipcMain bindings for the shell-owned windows (welcome + settings). Every
 * handler is gated by isTrustedSender: only the top-level frame of a tracked
 * window may talk to the main process. The pet's handlers live in
 * PetController; this module owns the invoke/whitelist surface.
 */

import { ipcMain } from 'electron'
import { IPC } from '../shared/channels'
import { URLS } from '../shared/constants'
import { STRINGS } from '../shared/strings'
import { parseVisionApplyRequest } from '../shared/vision'
import { isTrustedSender, safeOpenExternal } from './security'
import type { SessionManager } from './session-manager'
import type { SettingsStore } from './settings-store'
import type { VisionService } from './vision-service'
import type { WindowRegistry } from './window-registry'

export interface IpcDeps {
  registry: WindowRegistry
  settings: SettingsStore
  onCompleteOnboarding: (payload: unknown) => void
  vision: VisionService
  onOpenVisionSetup: () => void
  onLoadingRetry: () => void
  sessionManager: SessionManager
  /** Native confirm before an irreversible session delete; resolves to the user's choice. */
  confirmSessionDelete: (title: string | null) => Promise<boolean>
  /** System notification for delete refusals/failures (no renderer in the dsh page flow). */
  notifySession: (message: string) => void
}

interface SessionDeleteRequest {
  sessionId: string
  isCurrent: boolean
  title: string | null
}

/** Validate the dsh-side delete payload (`{ sessionId, isCurrent, title? }`). */
function parseSessionDeleteRequest(value: unknown): SessionDeleteRequest | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const normalized = typeof v.sessionId === 'string' ? v.sessionId.replace(/^session-/, '') : ''
  if (!/^[0-9A-Za-z-]{8,64}$/.test(normalized)) return null
  return {
    sessionId: typeof v.sessionId === 'string' ? v.sessionId : '',
    isCurrent: v.isCurrent === true,
    title: typeof v.title === 'string' && v.title.length > 0 ? v.title.slice(0, 200) : null,
  }
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle(IPC.welcomeGetCopy, (event) => {
    if (!isTrustedSender(event, deps.registry)) return null
    return STRINGS.welcome
  })

  ipcMain.handle(IPC.settingsGet, (event) => {
    if (!isTrustedSender(event, deps.registry)) return null
    return deps.settings.get()
  })

  ipcMain.on(IPC.welcomeOpenApiKey, (event) => {
    if (!isTrustedSender(event, deps.registry)) return
    void safeOpenExternal(URLS.apiKey)
  })

  ipcMain.on(IPC.welcomeComplete, (event, payload: unknown) => {
    if (!isTrustedSender(event, deps.registry)) return
    deps.onCompleteOnboarding(payload)
  })

  ipcMain.handle(IPC.visionGetCopy, (event) => {
    if (!isTrustedSender(event, deps.registry)) return null
    return STRINGS.visionSetup
  })

  ipcMain.handle(IPC.visionGetState, (event) => {
    if (!isTrustedSender(event, deps.registry)) return null
    return deps.vision.getState()
  })

  ipcMain.handle(IPC.visionApply, (event, payload: unknown) => {
    if (!isTrustedSender(event, deps.registry)) return null
    const request = parseVisionApplyRequest(payload)
    if (request === null) {
      const entry = STRINGS.visionSetup.results['invalid-request']
      return { ok: false, code: 'invalid-request', title: entry.title, message: entry.message }
    }
    // The payload contains an API key — never log it.
    return deps.vision.apply(request)
  })

  ipcMain.on(IPC.visionOpenConsole, (event) => {
    if (!isTrustedSender(event, deps.registry)) return
    deps.vision.openConsole()
  })

  ipcMain.on(IPC.welcomeOpenVisionSetup, (event) => {
    if (!isTrustedSender(event, deps.registry)) return
    deps.onOpenVisionSetup()
  })

  ipcMain.on(IPC.loadingRetry, (event) => {
    if (!isTrustedSender(event, deps.registry)) return
    deps.onLoadingRetry()
  })

  ipcMain.handle(IPC.sessionDeleteById, async (event, payload: unknown) => {
    if (!isTrustedSender(event, deps.registry)) return null
    const request = parseSessionDeleteRequest(payload)
    if (!request) return { ok: false, reason: 'invalid-request' }

    try {
      // The page itself reports whether this row is the currently-open session.
      if (request.isCurrent) {
        deps.notifySession(STRINGS.sessionDelete.refusedCurrent)
        return { ok: false, reason: 'current' }
      }
      const found = await deps.sessionManager.findFolder(request.sessionId)
      if (found.length === 0) {
        deps.notifySession(STRINGS.sessionDelete.missing)
        return { ok: false, reason: 'missing' }
      }
      if (found.some((entry) => entry.active)) {
        deps.notifySession(STRINGS.sessionDelete.refusedActive)
        return { ok: false, reason: 'active' }
      }

      // Deleting wipes the whole session history — confirm before rm -rf.
      const confirmed = await deps.confirmSessionDelete(request.title)
      if (!confirmed) return { ok: false, reason: 'cancelled' }

      const result = await deps.sessionManager.deleteById(request.sessionId, false)
      if (result.deleted.length > 0) {
        deps.sessionManager.refreshMainWindow()
        return { ok: true }
      }
      const reason = result.failed[0]?.reason ?? 'unknown'
      deps.notifySession(
        reason === 'current'
          ? STRINGS.sessionDelete.refusedCurrent
          : reason === 'active'
            ? STRINGS.sessionDelete.refusedActive
            : STRINGS.sessionDelete.failed.replace('{detail}', reason),
      )
      return { ok: false, reason }
    } catch (error) {
      console.error('[session] delete-by-id failed:', error)
      deps.notifySession(STRINGS.sessionDelete.failed.replace('{detail}', String(error)))
      return { ok: false, reason: String(error) }
    }
  })
}
