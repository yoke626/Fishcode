/**
 * Central home for every magic number, color, size, URL, registry root, and
 * accelerator used across the app. User-facing copy lives in strings.ts; this
 * file holds only structural constants.
 */

export const APP = {
  id: 'com.fishcode.app',
  name: 'Fishcode',
  productName: 'Fishcode',
} as const

export const WINDOW = {
  main: {
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    // Light background aligned with the dsh web UI. A dark value here reads as
    // a "black screen" whenever GPU compositing lags or fails, so keep it light.
    backgroundColor: '#f5f5f7',
    // Keep the window title branded; the hosted dsh UI would otherwise set it
    // to its own site title.
    title: 'FISHCODE',
  },
  pet: {
    width: 240,
    height: 240,
  },
  welcome: {
    width: 520,
    height: 640,
    backgroundColor: '#ffffff',
  },
  visionSetup: {
    width: 520,
    height: 760,
    backgroundColor: '#ffffff',
  },
  sessionManager: {
    width: 760,
    height: 620,
    backgroundColor: '#ffffff',
  },
} as const

export const DSH = {
  // `web` is a hardcoded alias for `--profile web` in the dsh CLI.
  profile: 'web',
  host: '127.0.0.1',
  // Fallback home when the harness default (~/.dsh) is not resolvable.
  homeFallback: '.dsh',
  // Readiness poll: only a 2xx counts as ready (a 404 must never be "ready").
  readyTimeoutMs: 30_000,
  readyPollIntervalMs: 250,
  // Bounded restart after an unexpected backend exit.
  maxRestarts: 3,
  restartDelayMs: 1_000,
} as const

export const GLOBAL_ACCELERATOR = 'CommandOrControl+Shift+D'

// win32 registry roots for the "Open with FISHCODE" context-menu entry.
export const OPEN_WITH_REG = {
  root: 'HKCU',
  key: 'Software\\Classes\\*\\shell\\Fishcode',
  commandKey: 'Software\\Classes\\*\\shell\\Fishcode\\command',
  valueName: 'Fishcode',
} as const

export const URLS = {
  // The only origin the welcome wizard may open in the external browser.
  apiKey: 'https://platform.deepseek.com',
  // Zhipu console key-management page, opened by the vision setup window.
  zhipuConsole: 'https://open.bigmodel.cn/usercenter/apikeys',
  // GitHub release page, opened for a manual download when the in-app updater
  // cannot reach the feed (see update-service.ts).
  releases: 'https://github.com/yoke626/Fishcode/releases',
} as const

export const COMPLETION = {
  // A busy -> idle gap longer than this triggers one completion notification.
  idleSettleMs: 30_000,
  debounceMs: 200,
  // A single write burst is not a task; busy is confirmed only when a second
  // burst follows within this window (see CompletionWatcher.registerActivity).
  confirmMs: 5_000,
} as const

// Optional diagnostic escape hatch: set to a truthy value to disable GPU
// compositing for the MAIN window only (the transparent pet stays GPU-backed).
export const DISABLE_GPU_ENV = 'FISHCODE_DISABLE_GPU'
