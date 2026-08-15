/**
 * Wires the shell together and owns the startup/teardown order.
 *
 * Startup: settings -> auto-launch -> main window -> backend -> pet -> tray ->
 * hotkey. The main window starts on a light placeholder and swaps to the dsh
 * web UI the moment the backend reports ready. Teardown (shutdown) marks the
 * window as quitting, kills the hotkey/tray/pet, stops the backend, and flushes
 * settings.
 */

import { app } from 'electron'
import { AutoLaunch } from './auto-launch'
import { BackendManager } from './backend-manager'
import { BootOverlayGuard } from './boot-overlay-guard'
import { CompletionWatcher } from './completion-watcher'
import { Hotkey } from './hotkey'
import { registerIpc } from './ipc'
import { NotificationService } from './notification-service'
import { OpenWithService } from './open-with'
import { PetController } from './pet/pet-controller'
import { bundledSkillsDir, dshBinPath, nodeRuntimePath, runtimeContext, type RuntimeContext } from './runtime'
import { ensureVisionToolkit } from './vision-toolkit'
import { SettingsStore } from './settings-store'
import { TrayController } from './tray'
import { VisionService } from './vision-service'
import { WindowRegistry } from './window-registry'
import { MainWindow } from './windows/main-window'
import { VisionSetupWindow } from './windows/vision-setup-window'
import { WelcomeWindow } from './windows/welcome-window'
import { IPC } from '../shared/channels'
import { APP } from '../shared/constants'
import { dshHome } from '../shared/paths'
import { sanitizeSettingsPatch } from '../shared/settings'
import { STRINGS } from '../shared/strings'

export class AppBootstrap {
  private readonly settings: SettingsStore
  private readonly registry = new WindowRegistry()
  private readonly notifications = new NotificationService()
  private readonly autoLaunch = new AutoLaunch()
  private readonly hotkey = new Hotkey()
  private readonly openWith = new OpenWithService()
  private openWithInstalled = false
  private readonly tray = new TrayController()
  private readonly mainWindow: MainWindow
  private readonly pet: PetController
  private readonly welcome: WelcomeWindow
  private readonly visionService: VisionService
  private readonly visionSetup: VisionSetupWindow
  private readonly completionWatcher: CompletionWatcher
  private readonly bootGuard: BootOverlayGuard
  private backend: BackendManager | null = null

  constructor(userDataDir: string) {
    this.settings = new SettingsStore(userDataDir)
    this.settings.onRecover = (message) => this.notifications.show(APP.productName, message)

    this.mainWindow = new MainWindow({
      registry: this.registry,
      getBaseUrl: () => this.backend?.getBaseUrl() ?? null,
      shouldHideToTray: () => this.settings.get().minimizeToTray,
      onLog: (line) => console.log(`[${APP.name}] ${line}`),
    })

    this.pet = new PetController({
      registry: this.registry,
      onSummon: () => this.focusMain(),
      onToggle: () => this.togglePet(),
      getPetPosition: () => this.settings.get().petPosition,
      setPetPosition: (position) => this.settings.update({ petPosition: position }),
    })

    this.welcome = new WelcomeWindow(this.registry)

    this.visionService = new VisionService({
      getBaseUrl: () => this.backend?.getBaseUrl() ?? null,
      getBackendState: () => this.backend?.getState() ?? 'stopped',
    })
    this.visionSetup = new VisionSetupWindow(this.registry)

    this.completionWatcher = new CompletionWatcher({
      dir: dshHome(),
      onComplete: () => this.onTaskComplete(),
      onBusy: () => this.pet.setWorking(true),
      onError: (message) => console.error(`[${APP.name}] ${message}`),
    })

    this.bootGuard = new BootOverlayGuard({
      getBaseUrl: () => this.backend?.getBaseUrl() ?? null,
      onLog: (line) => console.log(`[${APP.name}] ${line}`),
    })
  }

  async start(): Promise<void> {
    // Spawn the backend FIRST — it takes ~10s to boot and needs nothing from
    // settings or windows, so its countdown starts immediately and overlaps
    // with everything below. It reports progress via onStateChange, which
    // drives the loading page and eventually the real UI.
    void this.startBackend()

    await this.settings.load()

    registerIpc({
      registry: this.registry,
      settings: this.settings,
      onCompleteOnboarding: (payload) => this.completeOnboarding(payload),
      vision: this.visionService,
      onOpenVisionSetup: () => this.openVisionSetup(),
      onLoadingRetry: () => this.retryBackend(),
    })

    this.settings.onChange((next) => {
      void this.applyAutoLaunch(next.autoLaunch)
      this.applyPet(next.petEnabled && next.onboardingDone)
    })

    // Everything user-visible comes up right away: the loading page renders
    // locally (the window appears within ~a second), and tray/hotkey/pet/wizard
    // no longer wait for the backend.
    this.mainWindow.create()
    void this.applyAutoLaunch(this.settings.get().autoLaunch)
    this.completionWatcher.start()
    const firstRun = !this.settings.get().onboardingDone
    this.applyPet(this.settings.get().petEnabled && !firstRun)

    this.setupTray()
    this.setupHotkey()
    this.showWelcomeIfNeeded()

    void this.refreshOpenWithState()
    const openPath = OpenWithService.parseOpenPath(process.argv)
    if (openPath) void this.forwardOpenPath(openPath)
  }

  /** Bring the main window forward (second instance / macOS activate). */
  focusMain(): void {
    const existed = this.mainWindow.browserWindow !== null
    this.mainWindow.create()
    if (!existed) {
      this.mainWindow.loadBackend()
      this.bootGuard.arm(this.mainWindow.browserWindow)
    }
    this.mainWindow.show()
  }

  /** A second launch (e.g. "Open with") hands its argv to the running instance. */
  onSecondInstance(argv: string[]): void {
    const openPath = OpenWithService.parseOpenPath(argv)
    if (openPath) void this.forwardOpenPath(openPath)
    this.focusMain()
  }

  private async refreshOpenWithState(): Promise<void> {
    if (!this.openWith.isSupported()) return
    try {
      this.openWithInstalled = await this.openWith.isInstalled()
    } catch (error) {
      console.error(`[${APP.name}] open-with query failed:`, error)
    }
    this.tray.rebuild()
  }

  private async installOpenWith(): Promise<void> {
    try {
      await this.openWith.install()
      this.openWithInstalled = true
      this.tray.rebuild()
      this.notifications.show(STRINGS.notify.openWithInstalledTitle, STRINGS.notify.openWithInstalledBody)
    } catch (error) {
      console.error(`[${APP.name}] open-with install failed:`, error)
      this.notifications.show(STRINGS.notify.openWithFailedTitle, STRINGS.notify.openWithFailedBody)
    }
  }

  private async forwardOpenPath(path: string): Promise<void> {
    if (!(await OpenWithService.validatePath(path))) return
    console.log(`[${APP.name}] open path: ${path}`)
    this.focusMain()
    const wc = this.mainWindow.browserWindow?.webContents
    if (wc && !wc.isDestroyed()) wc.send(IPC.openPath, path)
  }

  /** Sync + async teardown; called once from main.ts before quit. */
  async shutdown(): Promise<void> {
    this.mainWindow.markQuitting()
    this.bootGuard.disarm()
    this.hotkey.unregister()
    this.tray.destroy()
    this.completionWatcher.stop()
    this.pet.destroy()
    this.visionSetup.close()
    await this.backend?.stop()
    await this.settings.flush()
  }

  private togglePet(): void {
    this.settings.update({ petEnabled: !this.settings.get().petEnabled })
  }

  private showWelcomeIfNeeded(): void {
    if (!this.settings.get().onboardingDone) {
      this.welcome.create()
    }
  }

  private completeOnboarding(payload: unknown): void {
    const patch = sanitizeSettingsPatch(payload)
    console.log(`[${APP.name}] onboarding completed:`, JSON.stringify(patch))
    this.settings.update({ ...patch, onboardingDone: true })
    this.welcome.close()
  }

  private applyPet(enabled: boolean): void {
    if (enabled) this.pet.show()
    else this.pet.hide()
    // The tray's manual pet-action submenu is only enabled while visible.
    this.tray.rebuild()
  }

  private async startBackend(): Promise<void> {
    const ctx = runtimeContext()
    const backend = new BackendManager({
      node: nodeRuntimePath(ctx),
      bin: dshBinPath(ctx),
      skillsDir: bundledSkillsDir(ctx),
      patchFiles: this.prepareVisionToolkit(ctx),
      onLog: (line) => console.log(`[dsh] ${line}`),
      onStateChange: (state) => {
        if (state === 'ready') {
          console.log(`[${APP.name}] backend ready at ${backend.getBaseUrl()}`)
          // Boot writes (cordis snapshots etc.) must never read as a task.
          this.completionWatcher.arm()
          this.mainWindow.loadBackend()
          this.bootGuard.arm(this.mainWindow.browserWindow)
        } else if (state === 'failed') {
          this.mainWindow.sendLoading('failed')
          this.notifyBackendFailed()
        } else if (state === 'restarting') {
          this.mainWindow.sendLoading('restarting')
        } else {
          this.mainWindow.sendLoading('starting')
        }
      },
      onError: (message) => {
        console.error(`[dsh] ${message}`)
        this.notifyBackendFailed()
      },
    })
    this.backend = backend

    try {
      await backend.start()
    } catch (error) {
      console.error(`[${APP.name}] backend failed to start:`, error)
      this.mainWindow.sendLoading('failed')
      this.notifyBackendFailed()
    }
  }

  /** Retry after a failed start (loading page button). */
  private retryBackend(): void {
    const backend = this.backend
    if (!backend) {
      void this.startBackend()
      return
    }
    const state = backend.getState()
    if (state === 'ready' || state === 'starting' || state === 'restarting') return
    this.mainWindow.sendLoading('starting')
    backend.start().catch((error) => {
      console.error(`[${APP.name}] backend retry failed:`, error)
      this.mainWindow.sendLoading('failed')
      this.notifyBackendFailed()
    })
  }

  /**
   * Junction the bundled vision-toolkit bundle into the profile fallback and
   * return the `--patch` overlay that registers it. A failure degrades to a
   * backend without vision tools rather than blocking startup.
   */
  private prepareVisionToolkit(ctx: RuntimeContext): string[] {
    try {
      const result = ensureVisionToolkit(ctx)
      for (const link of result.linked) {
        if (link.status === 'created' || link.status === 'kept') continue
        console.warn(`[${APP.name}] vision-toolkit link ${link.name}: ${link.status}`)
      }
      console.log(`[${APP.name}] vision-toolkit overlay: ${result.overlayPath}`)
      return [result.overlayPath]
    } catch (error) {
      console.error(`[${APP.name}] vision-toolkit registration failed:`, error)
      return []
    }
  }

  private setupTray(): void {
    const ok = this.tray.create({
      onShow: () => this.mainWindow.show(),
      onTogglePet: () => this.togglePet(),
      onOpenVisionSetup: () => this.openVisionSetup(),
      onInstallOpenWith: () => void this.installOpenWith(),
      isOpenWithInstalled: () => this.openWithInstalled,
      isOpenWithSupported: () => this.openWith.isSupported(),
      petActions: () => this.pet.actionItems(),
      onPetAction: (state) => this.pet.play(state),
      isPetVisible: () => this.pet.isVisible(),
      onQuit: () => app.quit(),
    })
    if (!ok) console.error(`[${APP.name}] tray icon unavailable`)
  }

  private openVisionSetup(): void {
    this.visionSetup.create()
  }

  private setupHotkey(): void {
    const ok = this.hotkey.register(() => this.mainWindow.toggle())
    if (!ok) {
      console.warn(`[${APP.name}] global shortcut registration failed`)
      this.notifications.show(STRINGS.notify.hotkeyFailedTitle, STRINGS.notify.hotkeyFailedBody)
    }
  }

  private notifyBackendFailed(): void {
    this.notifications.show(STRINGS.notify.backendFailedTitle, STRINGS.notify.backendFailedBody)
  }

  private onTaskComplete(): void {
    console.log(`[${APP.name}] task completion detected`)
    this.notifications.show(STRINGS.notify.completeTitle, STRINGS.notify.completeBody)
    // End the sticky working state before say(), which celebrates via 'eat'.
    this.pet.setWorking(false)
    const done = STRINGS.pet.done
    this.pet.say(done[Math.floor(Math.random() * done.length)])
  }

  private async applyAutoLaunch(enabled: boolean): Promise<void> {
    try {
      await this.autoLaunch.setEnabled(enabled)
    } catch (error) {
      console.error(`[${APP.name}] auto-launch failed:`, error)
    }
  }
}
