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
}
