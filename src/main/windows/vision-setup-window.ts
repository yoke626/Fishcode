/**
 * The vision-service setup window: a small fixed white window where the user
 * picks a provider preset (or custom fields) and pastes one API key. Same
 * hardening as the welcome wizard: no navigation, no popups, sandboxed
 * renderer. Tray re-opens are the primary entry path, so create() focuses an
 * existing window instead of duplicating it.
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { APP, WINDOW } from '../../shared/constants'
import type { WindowRegistry } from '../window-registry'

export class VisionSetupWindow {
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
      ...WINDOW.visionSetup,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        preload: join(app.getAppPath(), 'out', 'preload', 'vision-setup.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    this.win = win
    this.registry.track(win)

    // No navigation, no popups — the setup page is a single self-contained document.
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    // Surface renderer/preload failures in the main-process log (level 3 = error).
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 3) {
        console.error(`[vision renderer] ${message} (${sourceId}:${line})`)
      }
    })
    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(`[vision preload] ${preloadPath}: ${error.message}`)
    })

    win.once('ready-to-show', () => win.show())
    win.webContents.once('did-finish-load', () => {
      console.log(`[${APP.name}] vision setup window loaded`)
    })
    win.on('closed', () => {
      this.win = null
    })

    void win.loadFile(join(app.getAppPath(), 'out', 'renderer', 'vision-setup', 'index.html'))
    return win
  }

  get browserWindow(): BrowserWindow | null {
    return this.win
  }

  close(): void {
    this.win?.close()
  }
}
