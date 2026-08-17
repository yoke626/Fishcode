/**
 * Auto-update via electron-updater with a generic feed (see electron-builder.yml
 * `publish`). Checks GitHub's "latest release" asset root on startup (delayed, so
 * it never competes with backend boot) and offers a manual "check for updates"
 * from the tray. Everything runs in the main process: native dialogs + system
 * notifications, so the renderer stays untouched.
 *
 * Gating:
 * - Dev builds (`app.isPackaged === false`) are skipped.
 * - macOS is skipped entirely: the unsigned build would be blocked by
 *   Gatekeeper, and users install the .dmg manually.
 *
 * Network:
 * - The generic provider hits github.com directly (no api.github.com), which is
 *   far more reachable from mainland China. If the feed is unreachable the
 *   manual check surfaces an error dialog with a browser link; the background
 *   startup check stays silent to avoid nagging on every boot.
 *
 * First-update caveat: the very first updater-enabled build must be installed
 * manually — releases before it carry no latest.yml, so older versions simply
 * report "no update" (or a fetch error) and fall back to the manual link.
 */

import { app, dialog, shell, type BrowserWindow } from 'electron'
import { CancellationToken, autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { URLS } from '../shared/constants'
import { STRINGS } from '../shared/strings'
import type { NotificationService } from './notification-service'

export interface UpdateServiceDeps {
  /** System notifications for download progress / errors. */
  notifications: NotificationService
  /** Parent for update dialogs; undefined on macOS (gated anyway). */
  getParentWindow: () => BrowserWindow | null
  /** Structured log sink; typically console.log with a tag. */
  onLog: (line: string) => void
}

// Optional escape hatch for local E2E and future China mirrors: a full feed URL
// overrides the baked-in `publish.url` from electron-builder.yml.
const UPDATE_URL_ENV = 'FISHCODE_UPDATE_URL'
// Force-enable the updater in an unpackaged (dev) run. Used by scripts/
// update-e2e.mjs to drive the real service against a local feed; electron-updater
// still requires autoUpdater.forceDevUpdateConfig = true in that mode.
const FORCE_ENV = 'FISHCODE_UPDATE_FORCE'

// Give the backend its head start before we touch the network.
const STARTUP_DELAY_MS = 5_000

/** Minimum progress advance between download-progress notifications. */
const PROGRESS_STEP = 10

export class UpdateService {
  private readonly deps: UpdateServiceDeps
  private readonly enabled: boolean
  private readonly token = new CancellationToken()
  private started = false
  private checking = false
  /** True while a user-initiated (tray) check is in flight. */
  private manualPending = false
  private lastProgressBucket = -1

  constructor(deps: UpdateServiceDeps) {
    this.deps = deps
    this.enabled = (app.isPackaged || process.env[FORCE_ENV] === '1') && process.platform !== 'darwin'

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
    // Never fall back to the web installer for NSIS — we ship a real setup.exe.
    autoUpdater.disableWebInstaller = true
    // electron-updater defaults to `console`; keep its logs on our own sink.
    autoUpdater.logger = {
      info: (m: unknown) => this.deps.onLog(String(m)),
      warn: (m: unknown) => this.deps.onLog(String(m)),
      error: (m: unknown) => this.deps.onLog(String(m)),
    }

    const override = process.env[UPDATE_URL_ENV]
    if (override) {
      autoUpdater.setFeedURL({ provider: 'generic', url: override })
      this.deps.onLog(`update feed overridden: ${override}`)
    }
  }

  /** Register listeners and schedule the background check. No-op when gated. */
  start(): void {
    if (!this.enabled || this.started) return
    this.started = true

    autoUpdater.on('update-available', (info) => this.onUpdateAvailable(info))
    autoUpdater.on('update-not-available', () => this.onUpdateNotAvailable())
    autoUpdater.on('download-progress', (info) => this.onDownloadProgress(info))
    autoUpdater.on('update-downloaded', (info) => this.onUpdateDownloaded(info))
    autoUpdater.on('error', (error) => this.onUpdateError(error))

    // Late enough that backend boot / balance query already own the network.
    setTimeout(() => void this.check(false), STARTUP_DELAY_MS)
  }

  /** Manual check, from the tray item. */
  async check(manual: boolean): Promise<void> {
    if (!this.enabled || this.checking) return
    this.checking = true
    this.manualPending = manual
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      // The 'error' event already surfaced this; log only, never re-throw.
      this.deps.onLog(`update check rejected: ${String(error)}`)
    } finally {
      this.checking = false
    }
  }

  dispose(): void {
    this.token.cancel()
    autoUpdater.removeAllListeners('update-available')
    autoUpdater.removeAllListeners('update-not-available')
    autoUpdater.removeAllListeners('download-progress')
    autoUpdater.removeAllListeners('update-downloaded')
    autoUpdater.removeAllListeners('error')
  }

  private onUpdateAvailable(info: UpdateInfo): void {
    this.manualPending = false
    void this.promptDownload(info)
  }

  private onUpdateNotAvailable(): void {
    const manual = this.manualPending
    this.manualPending = false
    if (!manual) return // background check: stay silent
    this.deps.notifications.show(STRINGS.update.title, STRINGS.update.upToDate)
  }

  private onDownloadProgress(info: ProgressInfo): void {
    const bucket = Math.floor(info.percent / PROGRESS_STEP)
    if (bucket === this.lastProgressBucket) return
    this.lastProgressBucket = bucket
    const percent = Math.min(100, Math.floor(info.percent))
    this.deps.notifications.show(
      STRINGS.update.title,
      STRINGS.update.downloading.replace('{percent}', String(percent)),
    )
  }

  private onUpdateDownloaded(info: UpdateDownloadedLike): void {
    this.lastProgressBucket = -1
    void this.promptInstall(info)
  }

  private onUpdateError(error: Error): void {
    const manual = this.manualPending
    this.manualPending = false
    this.deps.onLog(`update error: ${error.stack ?? String(error)}`)
    if (manual) {
      void this.showManualDownloadFallback(STRINGS.update.checkFailed)
    } else if (this.checking) {
      // Download failed after the user accepted — surface it so they are not
      // left waiting forever.
      void this.showManualDownloadFallback(STRINGS.update.checkFailed)
    }
  }

  private async promptDownload(info: UpdateInfo): Promise<void> {
    const { response } = await this.showMessageBox({
      type: 'info',
      title: STRINGS.update.title,
      message: STRINGS.update.available
        .replace('{version}', info.version)
        .replace('{current}', app.getVersion()),
      detail: STRINGS.update.availableDetail,
      buttons: [STRINGS.update.downloadNow, STRINGS.update.later, STRINGS.update.manualDownload],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response === 0) {
      void autoUpdater.downloadUpdate(this.token)
    } else if (response === 2) {
      void shell.openExternal(URLS.releases)
    }
  }

  private async promptInstall(_info: UpdateDownloadedLike): Promise<void> {
    const { response } = await this.showMessageBox({
      type: 'info',
      title: STRINGS.update.title,
      message: STRINGS.update.downloaded,
      detail: STRINGS.update.downloadedDetail,
      buttons: [STRINGS.update.installNow, STRINGS.update.later],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response !== 0) return
    this.dispose()
    autoUpdater.quitAndInstall(false, true)
  }

  private async showManualDownloadFallback(detail: string): Promise<void> {
    const { response } = await this.showMessageBox({
      type: 'warning',
      title: STRINGS.update.title,
      message: STRINGS.update.checkFailed,
      detail,
      buttons: [STRINGS.update.close, STRINGS.update.manualDownload],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (response === 1) void shell.openExternal(URLS.releases)
  }

  /** dialog.showMessageBox with an optional parent window. */
  private async showMessageBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
    const win = this.deps.getParentWindow()
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
  }
}

/**
 * electron-updater's `UpdateDownloadedEvent` extends `UpdateInfo` with
 * `downloadedFile`. We never read those fields here, so a minimal shape keeps
 * the import list tight (the full type lives in electron-updater, but importing
 * it drags in builder-util-runtime type gymnastics for no value).
 */
interface UpdateDownloadedLike {
  version: string
}
