/**
 * The transparent, frameless, always-on-top desktop pet window. It starts out
 * fully click-through; the renderer asks for interactivity (pet:hover) only
 * while the cursor is over the sprite.
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { WINDOW } from '../../shared/constants'
import type { WindowRegistry } from '../window-registry'

export class PetWindow {
  private win: BrowserWindow | null = null

  constructor(
    private readonly registry: WindowRegistry,
    /** Fires after the renderer loaded — the pet re-sends its current state. */
    private readonly onReady?: () => void,
  ) {}

  create(): BrowserWindow {
    if (this.win) return this.win

    const win = new BrowserWindow({
      width: WINDOW.pet.width,
      height: WINDOW.pet.height,
      transparent: true,
      frame: false,
      resizable: false,
      fullscreenable: false,
      maximizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: join(app.getAppPath(), 'out', 'preload', 'pet.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    this.win = win
    this.registry.track(win)

    // Pass clicks through; pet.js re-enables interaction on hover.
    win.setIgnoreMouseEvents(true, { forward: true })

    win.on('closed', () => {
      this.win = null
    })

    void win.loadFile(join(app.getAppPath(), 'out', 'renderer', 'pet', 'index.html'))
    if (this.onReady) {
      win.webContents.once('did-finish-load', () => this.onReady?.())
    }
    return win
  }

  get browserWindow(): BrowserWindow | null {
    return this.win
  }

  isAlive(): boolean {
    return this.win !== null && !this.win.isDestroyed()
  }

  isVisible(): boolean {
    return this.win?.isVisible() ?? false
  }

  show(): void {
    this.win?.showInactive()
  }

  hide(): void {
    this.win?.hide()
  }

  setPosition(x: number, y: number): void {
    this.win?.setPosition(x, y)
  }

  getPosition(): [number, number] {
    const [x = 0, y = 0] = this.win?.getPosition() ?? []
    return [x, y]
  }

  send(channel: string, ...args: unknown[]): void {
    this.win?.webContents.send(channel, ...args)
  }

  setIgnoreMouseEvents(ignore: boolean): void {
    this.win?.setIgnoreMouseEvents(ignore, { forward: true })
  }

  destroy(): void {
    this.win?.destroy()
    this.win = null
  }
}
