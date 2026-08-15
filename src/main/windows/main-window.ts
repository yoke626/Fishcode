/**
 * The main window hosting the dsh web UI.
 *
 *   - starts on a local loading page (logo + animation + backend status) so
 *     the window appears within ~a second and the backend wait never reads as
 *     a freeze; swaps to the dsh UI the moment the backend reports ready
 *   - light backgroundColor (aligned with the dsh UI) so a slow/failed GPU
 *     composite never reads as a "black screen"
 *   - navigation guard: stay on the backend origin; https links open in the
 *     default browser; everything else is refused
 *   - close hides to tray (unless actually quitting)
 *   - a crashed renderer reloads itself
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { IPC } from '../../shared/channels'
import { DSH, WINDOW } from '../../shared/constants'
import { isSafeExternalUrl, safeOpenExternal } from '../security'
import type { WindowRegistry } from '../window-registry'

export type LoadingState = 'starting' | 'restarting' | 'failed'

export interface MainWindowDeps {
  registry: WindowRegistry
  getBaseUrl: () => string | null
  shouldHideToTray: () => boolean
  onLog?: (line: string) => void
}

export class MainWindow {
  private win: BrowserWindow | null = null
  private quitting = false
  /** True once the dsh UI has been loaded; loading-state pushes stop after. */
  private backendLoaded = false

  constructor(private readonly deps: MainWindowDeps) {}

  get browserWindow(): BrowserWindow | null {
    return this.win
  }

  create(): BrowserWindow {
    if (this.win) return this.win

    const win = new BrowserWindow({
      ...WINDOW.main,
      show: false,
      webPreferences: {
        preload: join(app.getAppPath(), 'out', 'preload', 'main.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    this.win = win
    this.deps.registry.track(win)

    win.once('ready-to-show', () => win.show())

    // Backend already up (e.g. window recreated after close): skip the loading
    // page. Otherwise show the loading screen immediately — it renders locally,
    // so ready-to-show fires almost instantly and the user sees progress while
    // the backend boots.
    const baseUrl = this.deps.getBaseUrl()
    if (baseUrl) {
      this.backendLoaded = true
      void win.loadURL(baseUrl)
    } else {
      void win.loadFile(join(app.getAppPath(), 'out', 'renderer', 'loading', 'index.html'))
    }

    // The hosted dsh UI sets its own <title>; keep the window branded instead.
    win.on('page-title-updated', (event) => event.preventDefault())

    win.webContents.on('will-navigate', (event, url) => {
      if (this.isBackendUrl(url)) return
      event.preventDefault()
      if (isSafeExternalUrl(url)) void safeOpenExternal(url)
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) void safeOpenExternal(url)
      return { action: 'deny' }
    })

    win.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit' || details.reason === 'killed') return
      this.deps.onLog?.(`renderer gone (${details.reason}); reloading`)
      if (!this.quitting) void win.webContents.reload()
    })

    win.on('close', (event) => {
      if (!this.quitting && this.deps.shouldHideToTray()) {
        event.preventDefault()
        win.hide()
      }
    })

    win.on('closed', () => {
      this.deps.onLog?.('main window closed')
      this.win = null
    })

    return win
  }

  /** Call on `before-quit` so the close handler lets the window actually close. */
  markQuitting(): void {
    this.quitting = true
  }

  show(): void {
    this.win?.show()
    this.win?.focus()
  }

  hide(): void {
    this.win?.hide()
  }

  toggle(): void {
    if (this.win?.isVisible()) this.hide()
    else this.show()
  }

  isVisible(): boolean {
    return this.win?.isVisible() ?? false
  }

  /** Load the backend URL; call once the BackendManager reports ready. */
  loadBackend(): void {
    const url = this.deps.getBaseUrl()
    if (url && this.win) {
      this.backendLoaded = true
      void this.win.loadURL(url)
    }
  }

  /** Push backend progress to the loading page (no-op after the UI loaded). */
  sendLoading(state: LoadingState): void {
    if (this.backendLoaded || !this.win || this.win.isDestroyed()) return
    this.win.webContents.send(IPC.loadingState, state)
  }

  private isBackendUrl(raw: string): boolean {
    try {
      const url = new URL(raw)
      return url.protocol === 'http:' && url.hostname === DSH.host
    } catch {
      return false
    }
  }
}
