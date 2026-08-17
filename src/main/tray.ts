/**
 * System tray icon + context menu. The menu is rebuilt whenever "Open with"
 * state changes (install completes), so call rebuild() after that mutation.
 */

import { app, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { join } from 'node:path'
import { APP } from '../shared/constants'
import { STRINGS } from '../shared/strings'
import type { PetState } from './pet/pet-controller'

// Ultimate fallback: a non-empty 1x1 PNG so Tray construction never throws on
// Windows even if every icon file is missing.
const FALLBACK_TRAY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export interface TrayDeps {
  onShow: () => void
  onTogglePet: () => void
  onOpenVisionSetup: () => void
  onInstallOpenWith: () => void
  isOpenWithInstalled: () => boolean
  isOpenWithSupported: () => boolean
  /** Manual pet-animation picker: states with shipped art + their labels. */
  petActions: () => Array<{ state: PetState; label: string }>
  onPetAction: (state: PetState) => void
  isPetVisible: () => boolean
  /** Current one-line DeepSeek balance label (see deepseek-balance.ts). */
  balanceLabel: () => string
  onRefreshBalance: () => void
  onOpenBalanceConsole: () => void
  onCheckForUpdates: () => void
  onQuit: () => void
}

export class TrayController {
  private tray: Tray | null = null
  private deps: TrayDeps | null = null

  create(deps: TrayDeps): boolean {
    this.deps = deps
    const icon = this.loadIcon()
    if (!icon) return false

    this.tray = new Tray(icon)
    this.tray.setToolTip(APP.productName)
    if (process.platform !== 'darwin') {
      this.tray.on('click', deps.onShow)
    }
    this.rebuild()
    return true
  }

  rebuild(): void {
    if (!this.tray || !this.deps) return
    const petVisible = this.deps.isPetVisible()
    const petActions = this.deps.petActions()
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: STRINGS.tray.show, click: this.deps.onShow },
      { label: STRINGS.tray.togglePet, click: this.deps.onTogglePet },
      { label: this.deps.balanceLabel(), enabled: false },
      { label: STRINGS.tray.balanceRefresh, click: () => void this.deps?.onRefreshBalance() },
      { label: STRINGS.tray.balanceConsole, click: this.deps.onOpenBalanceConsole },
    ]

    if (petActions.length > 0) {
      template.push({
        label: STRINGS.pet.actionMenu,
        enabled: petVisible,
        submenu: petActions.map(({ state, label }) => ({
          label,
          click: () => this.deps?.onPetAction(state),
        })),
      })
    }

    template.push(
      { label: STRINGS.tray.visionSetup, click: this.deps.onOpenVisionSetup },
    )

    if (this.deps.isOpenWithSupported()) {
      template.push(
        this.deps.isOpenWithInstalled()
          ? { label: STRINGS.tray.openWithInstalled, enabled: false }
          : { label: STRINGS.tray.openWithInstall, click: this.deps.onInstallOpenWith },
      )
    }

    template.push(
      { label: STRINGS.tray.checkForUpdates, click: () => this.deps?.onCheckForUpdates() },
      { type: 'separator' },
      { label: STRINGS.tray.quit, click: this.deps.onQuit },
    )
    this.tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private loadIcon(): NativeImage | null {
    const filePath = join(app.getAppPath(), 'out', 'assets', 'tray.png')
    try {
      const fromFile = nativeImage.createFromPath(filePath)
      if (!fromFile.isEmpty()) return fromFile
    } catch {
      // fall through to the embedded fallback
    }

    const fallback = nativeImage.createFromBuffer(Buffer.from(FALLBACK_TRAY_PNG, 'base64'))
    return fallback.isEmpty() ? null : fallback
  }
}
