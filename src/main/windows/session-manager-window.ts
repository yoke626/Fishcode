/**
 * The session-manager window: FISHCODE's own tool for deleting dsh sessions
 * that the web UI cannot remove (its session row menu only has
 * rename/fork/archive — see dsh-client-ui-workspace). Same hardening as the
 * vision-setup window: no navigation, no popups, sandboxed renderer. Tray
 * re-opens focus the existing window instead of duplicating it.
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { APP, WINDOW } from '../../shared/constants'
import type { WindowRegistry } from '../window-registry'

export class SessionManagerWindow {
  private win: BrowserWindow | null = null

  constructor(private readonly registry: WindowRegistry) {}

  create(): BrowserWindow {
    if (this.win) {
      if (this.win.isMinimized()) this.win.restore()
      this.win.show()
      this.win.focus()
      return this.win
    }

    const win = new BrowserWindow({
      ...WINDOW.sessionManager,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        preload: join(app.getAppPath(), 'out', 'preload', 'session-manager.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    this.win = win
    this.registry.track(win)

    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 3) {
        console.error(`[session renderer] ${message} (${sourceId}:${line})`)
      }
    })
    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(`[session preload] ${preloadPath}: ${error.message}`)
    })

    win.once('ready-to-show', () => win.show())
    win.webContents.once('did-finish-load', () => {
      console.log(`[${APP.name}] session manager window loaded`)
    })
    win.on('closed', () => {
      this.win = null
    })

    void win.loadFile(join(app.getAppPath(), 'out', 'renderer', 'session-manager', 'index.html'))
    return win
  }

  get browserWindow(): BrowserWindow | null {
    return this.win
  }

  close(): void {
    this.win?.close()
  }
}
