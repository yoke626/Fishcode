/**
 * Entry point: applies the diagnostic GPU switch early, enforces the
 * single-instance lock, installs crash handlers, and hands off to AppBootstrap.
 */

import { app, dialog } from 'electron'
import { APP, DISABLE_GPU_ENV } from '../shared/constants'
import { AppBootstrap } from './bootstrap'
import { installAppMenu } from './menu'

function applyDiagnosticSwitches(): void {
  if (process.env[DISABLE_GPU_ENV]) {
    app.commandLine.appendSwitch('disable-gpu')
    console.warn(`[${APP.name}] ${DISABLE_GPU_ENV} set: disabling GPU (diagnostic escape hatch)`)
  }
}

function logGpuStatus(): void {
  try {
    console.log(`[${APP.name}] GPU feature status:`, JSON.stringify(app.getGPUFeatureStatus()))
  } catch (error) {
    console.warn(`[${APP.name}] getGPUFeatureStatus() failed:`, error)
  }
}

function installCrashHandlers(): void {
  let fatalShown = false
  process.on('uncaughtException', (error) => {
    console.error(`[${APP.name}] uncaughtException:`, error)
    if (!fatalShown) {
      fatalShown = true
      dialog.showErrorBox(`${APP.name} 遇到未处理的错误`, String(error))
    }
  })
  process.on('unhandledRejection', (reason) => {
    console.error(`[${APP.name}] unhandledRejection:`, reason)
  })
}

// The GPU switch must be appended before the GPU process boots (import time).
applyDiagnosticSwitches()

// The hosted dsh UI resolves its UI language from Chromium's locale (which
// follows the OS), so an English Windows shows an English toolbar. Pin zh-CN
// before the renderer boots; FISHCODE's own pages are Chinese regardless.
app.commandLine.appendSwitch('lang', 'zh-CN')

if (!app.requestSingleInstanceLock()) {
  console.warn(`[${APP.name}] another instance holds the lock; quitting`)
  app.quit()
} else {
  installCrashHandlers()

  let bootstrap: AppBootstrap | null = null
  let quitting = false

  app.on('second-instance', (_event, argv) => bootstrap?.onSecondInstance(argv))

  void app.whenReady().then(async () => {
    logGpuStatus()
    // Replace Electron's default menu (its Help dropdown links to blocked
    // sites) with FISHCODE's own Chinese menu bar.
    installAppMenu()
    bootstrap = new AppBootstrap(app.getPath('userData'))
    await bootstrap.start()
  })

  app.on('activate', () => bootstrap?.focusMain())

  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    if (!bootstrap) {
      app.quit()
      return
    }
    void bootstrap.shutdown().finally(() => app.quit())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      console.log(`[${APP.name}] all windows closed; quitting`)
      app.quit()
    }
  })
}
