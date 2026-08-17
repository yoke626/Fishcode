import { contextBridge, ipcRenderer } from 'electron'

/**
 * Session-manager preload. Sandboxed: channel names are inlined (keep in sync
 * with src/shared/channels.ts). Payloads are `unknown` at this boundary — the
 * main process validates every value it receives.
 */

const CH = {
  sessionGetCopy: 'session:get-copy',
  sessionList: 'session:list',
  sessionDelete: 'session:delete',
  sessionRefreshMain: 'session:refresh-main',
} as const

contextBridge.exposeInMainWorld('sessionManagerAPI', {
  getCopy: (): Promise<unknown> => ipcRenderer.invoke(CH.sessionGetCopy),
  list: (): Promise<unknown> => ipcRenderer.invoke(CH.sessionList),
  delete: (folders: unknown): Promise<unknown> => ipcRenderer.invoke(CH.sessionDelete, folders),
  refreshMain: (): void => ipcRenderer.send(CH.sessionRefreshMain),
})
