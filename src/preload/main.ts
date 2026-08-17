import { contextBridge, ipcRenderer } from 'electron'

/**
 * Main-window preload. Shared by the startup loading page and the hosted dsh
 * web UI. Sandboxed: channel names are inlined (keep in sync with
 * src/shared/channels.ts).
 *
 * The first-launch blank-screen guard lives in the MAIN process
 * (BootOverlayGuard), not here: it must keep working even when a reload lands
 * while this preload is unavailable (e.g. out/ being rebuilt in dev).
 */

const CH = {
  loadingState: 'loading:state',
  loadingRetry: 'loading:retry',
  sessionDeleteById: 'session:delete-by-id',
} as const

export type LoadingState = 'starting' | 'restarting' | 'failed'

contextBridge.exposeInMainWorld('loadingAPI', {
  /** Backend progress pushed by the main process until the dsh UI takes over. */
  onState: (callback: (state: LoadingState) => void): void => {
    ipcRenderer.on(CH.loadingState, (_event, state: LoadingState) => callback(state))
  },
  /** User clicked retry on the failure state. */
  retry: (): void => ipcRenderer.send(CH.loadingRetry),
})

/**
 * FISHCODE bridge on the dsh web page. The vendored dsh-client-ui-workspace
 * patch (scripts/patch-session-delete.mjs) calls `window.fishcode.deleteSession`
 * from the session row's three-dot menu; the main process confirms, deletes the
 * session folder via scripts/session-helper.mjs, and reloads the sidebar.
 */
contextBridge.exposeInMainWorld('fishcode', {
  deleteSession: (sessionId: string, isCurrent: boolean, title?: string): Promise<unknown> =>
    ipcRenderer.invoke(CH.sessionDeleteById, { sessionId, isCurrent, title }),
})
