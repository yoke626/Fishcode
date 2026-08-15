/**
 * Tracks every shell-owned BrowserWindow so IPC handlers can verify that a
 * message actually came from one of our windows (see security.isTrustedSender).
 */

import type { BrowserWindow } from 'electron'

export class WindowRegistry {
  private readonly ids = new Set<number>()

  /** Register a window; its id is dropped automatically once the renderer dies. */
  track(win: BrowserWindow): void {
    const id = win.webContents.id
    this.ids.add(id)
    win.webContents.once('destroyed', () => {
      this.ids.delete(id)
    })
  }

  isTracked(webContentsId: number): boolean {
    return this.ids.has(webContentsId)
  }
}
