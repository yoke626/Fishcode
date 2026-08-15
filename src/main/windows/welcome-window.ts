/**
 * The first-run onboarding wizard. A small fixed white window that walks the
 * user through API-key setup and shell preferences, then completes. It never
 * navigates away from its local page; the one external action (the API-key
 * link) goes through the whitelisted IPC handler instead.
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { APP, WINDOW } from '../../shared/constants'
import type { WindowRegistry } from '../window-registry'

export class WelcomeWindow {
  private win: BrowserWindow | null = null

  constructor(private readonly registry: WindowRegistry) {}

  create(): BrowserWindow {
    if (this.win) return this.win

    const win = new BrowserWindow({
      ...WINDOW.welcome,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        preload: join(app.getAppPath(), 'out', 'preload', 'welcome.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    this.win = win
    this.registry.track(win)

    // No navigation, no popups — the wizard is a single self-contained page.
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    // Surface renderer/preload failures in the main-process log (level 3 = error).
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 3) {
        console.error(`[welcome renderer] ${message} (${sourceId}:${line})`)
      }
    })
    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(`[welcome preload] ${preloadPath}: ${error.message}`)
    })

    win.once('ready-to-show', () => win.show())
    win.webContents.once('did-finish-load', () => {
      console.log(`[${APP.name}] welcome window loaded`)
    })
    win.on('closed', () => {
      this.win = null
    })

    void win.loadFile(join(app.getAppPath(), 'out', 'renderer', 'welcome', 'index.html'))
    return win
  }

  get browserWindow(): BrowserWindow | null {
    return this.win
  }

  close(): void {
    this.win?.close()
  }
}
