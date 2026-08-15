import { contextBridge, ipcRenderer } from 'electron'

/**
 * Welcome-wizard preload. Sandboxed: channel names are inlined (keep in sync
 * with src/shared/channels.ts). Payloads are `unknown` at this boundary — the
 * main process validates every value it receives.
 */

const CH = {
  welcomeGetCopy: 'welcome:get-copy',
  welcomeOpenApiKey: 'welcome:open-api-key',
  welcomeComplete: 'welcome:complete',
  settingsGet: 'settings:get',
  welcomeOpenVisionSetup: 'welcome:open-vision-setup',
} as const

contextBridge.exposeInMainWorld('welcomeAPI', {
  getCopy: (): Promise<unknown> => ipcRenderer.invoke(CH.welcomeGetCopy),
  getSettings: (): Promise<unknown> => ipcRenderer.invoke(CH.settingsGet),
  openApiKey: (): void => ipcRenderer.send(CH.welcomeOpenApiKey),
  complete: (settings: unknown): void => ipcRenderer.send(CH.welcomeComplete, settings),
  openVisionSetup: (): void => ipcRenderer.send(CH.welcomeOpenVisionSetup),
})
