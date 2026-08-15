import { contextBridge, ipcRenderer } from 'electron'

/**
 * Vision-setup preload. Sandboxed: channel names are inlined (keep in sync
 * with src/shared/channels.ts). Payloads are `unknown` at this boundary — the
 * main process validates every value it receives.
 */

const CH = {
  visionGetCopy: 'vision:get-copy',
  visionGetState: 'vision:get-state',
  visionApply: 'vision:apply',
  visionOpenConsole: 'vision:open-console',
} as const

contextBridge.exposeInMainWorld('visionSetupAPI', {
  getCopy: (): Promise<unknown> => ipcRenderer.invoke(CH.visionGetCopy),
  getState: (): Promise<unknown> => ipcRenderer.invoke(CH.visionGetState),
  apply: (request: unknown): Promise<unknown> => ipcRenderer.invoke(CH.visionApply, request),
  openConsole: (): void => ipcRenderer.send(CH.visionOpenConsole),
})
