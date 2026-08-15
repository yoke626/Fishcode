/**
 * First-launch white screen guard, driven from the MAIN process.
 *
 * On a fresh harness home the backend can block its event loop for minutes
 * (profile materialization, vision runtime extraction), so after the loading
 * page hands off to the dsh UI the window may sit on a blank document for a
 * long while. This guard polls the main window every second and:
 *
 *   - injects a branded "still starting" overlay whenever the dsh UI has not
 *     actually mounted (no document at all, or `#root` without content), and
 *   - re-issues the backend URL with a gentle backoff while it stays blank,
 *     because the parked load may never resume on its own once the server
 *     unblocks.
 *
 * It lives in the main process on purpose: `executeJavaScript`/`insertCSS` do
 * not depend on the preload, so the guard keeps working even if a reload lands
 * while `out/preload` is being rebuilt (dev) or the preload fails for any
 * other reason.
 *
 * Lifecycle: the overlay only appears after a few seconds of continuous
 * blankness (a normal cold render mounts in 1-3s and never triggers it), and
 * the guard disarms itself for good once the UI has been stable for a while.
 */

import { BrowserWindow } from 'electron'

export interface BootOverlayGuardDeps {
  getBaseUrl: () => string | null
  onLog?: (line: string) => void
}

const TICK_MS = 1_000
/** Overlay appears only after this long a stretch of no UI (hides brief boots). */
const SHOW_AFTER_MS = 3_000
/** Consecutive healthy ticks before the overlay fades out. */
const HEALTHY_TICKS = 3
/** Post-fade verification window; a regression re-shows the overlay. */
const VERIFY_MS = 10_000
/** Reload ladder: first nudge after 30s, doubling up to the cap. */
const FIRST_RELOAD_MS = 30_000
const MAX_RELOAD_MS = 240_000
/** First-launch hint after a minute of blankness. */
const HINT_AFTER_MS = 60_000
/** A mounted dsh app renders ~45KB into #root; blank/parked = nothing there. */
const HEALTHY_MIN_HTML = 1_000

const INJECT_SNIPPET = `
(() => {
  if (document.getElementById('fishcode-boot-overlay')) return 'present'
  const style = document.createElement('style')
  style.id = 'fishcode-boot-overlay-style'
  style.textContent = \`
    #fishcode-boot-overlay { position: fixed; inset: 0; z-index: 2147483000; background: #f5f5f7;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
      font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; color: #334155;
      text-align: center; user-select: none; opacity: 1; transition: opacity .35s; }
    #fishcode-boot-overlay .fc-brand { font-size: 14px; letter-spacing: .35em; color: #64748b; }
    #fishcode-boot-overlay .fc-waves { display: flex; gap: 8px; height: 12px; align-items: flex-end; }
    #fishcode-boot-overlay .fc-waves span { width: 10px; height: 10px; border-radius: 50%;
      background: #14b8a6; animation: fc-wave 1.2s ease-in-out infinite; }
    #fishcode-boot-overlay .fc-waves span:nth-child(2) { animation-delay: .15s; }
    #fishcode-boot-overlay .fc-waves span:nth-child(3) { animation-delay: .3s; }
    @keyframes fc-wave { 0%, 100% { transform: translateY(0); opacity: .45; } 50% { transform: translateY(-8px); opacity: 1; } }
    #fishcode-boot-overlay .fc-status { font-size: 16px; font-weight: 600; }
    #fishcode-boot-overlay .fc-hint { font-size: 13px; color: #64748b; display: none; }
    #fishcode-boot-overlay.fc-show-hint .fc-hint { display: block; }
  \`
  const overlay = document.createElement('div')
  overlay.id = 'fishcode-boot-overlay'
  overlay.innerHTML = \`
    <div class="fc-brand">FISHCODE</div>
    <div class="fc-waves" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="fc-status">正在打开工作台…</div>
    <div class="fc-hint">首次启动需要准备本地环境，可能需要几分钟，请稍候</div>
  \`
  document.documentElement.appendChild(style)
  document.documentElement.appendChild(overlay)
  return 'injected'
})()`

const FADE_SNIPPET = `
(() => {
  const el = document.getElementById('fishcode-boot-overlay')
  if (!el) return 'absent'
  el.style.opacity = '0'
  setTimeout(() => el.remove(), 400)
  const s = document.getElementById('fishcode-boot-overlay-style')
  if (s) s.remove()
  return 'fading'
})()`

const HINT_SNIPPET = `
(() => {
  const el = document.getElementById('fishcode-boot-overlay')
  if (el) el.classList.add('fc-show-hint')
  return 'ok'
})()`

const STATE_SNIPPET = `
JSON.stringify((() => {
  const root = document.getElementById('root')
  return {
    url: location.href,
    healthy: !!root && root.innerHTML.length > ${HEALTHY_MIN_HTML}
  }
})())`

type Phase = 'covering' | 'verifying' | 'done'

export class BootOverlayGuard {
  private win: BrowserWindow | null = null
  private timer: NodeJS.Timeout | null = null
  private phase: Phase = 'done'
  private unhealthyMs = 0
  private healthyTicks = 0
  private verifyMs = 0
  private nextReloadMs = FIRST_RELOAD_MS
  private overlayUp = false
  private hintShown = false

  constructor(private readonly deps: BootOverlayGuardDeps) {}

  /** Start guarding a window; call after every `loadBackend()`. */
  arm(win: BrowserWindow | null): void {
    this.win = win
    if (!win) return
    this.phase = 'covering'
    this.unhealthyMs = 0
    this.healthyTicks = 0
    this.verifyMs = 0
    this.nextReloadMs = FIRST_RELOAD_MS
    this.overlayUp = false
    this.hintShown = false
    if (this.timer === null) this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  disarm(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.phase = 'done'
  }

  private log(line: string): void {
    this.deps.onLog?.(line)
  }

  private async evalJs(expression: string): Promise<string | null> {
    const wc = this.win?.webContents
    if (!this.win || !wc || wc.isDestroyed()) return null
    try {
      return (await wc.executeJavaScript(expression, true)) as string | null
    } catch {
      // No document to run against (navigation parked between documents).
      return null
    }
  }

  private reloadBackend(): void {
    const url = this.deps.getBaseUrl()
    if (!url) return
    this.log(`boot guard: still blank, reloading (${Math.round(this.unhealthyMs / 1000)}s)`)
    this.win?.webContents.loadURL(url)
  }

  private async tick(): Promise<void> {
    if (this.phase === 'done' || !this.win || this.win.isDestroyed()) return

    const state = await this.evalJs(STATE_SNIPPET)
    // evalJs returns null when there is no document at all (parked load).
    if (state === null) {
      this.onUnhealthyTick(false)
      return
    }

    let url = ''
    let healthy = false
    try {
      const parsed = JSON.parse(state) as { url: string; healthy: boolean }
      url = parsed.url
      healthy = parsed.healthy
    } catch {
      this.onUnhealthyTick(false)
      return
    }

    // Still on the loading page (backend URL not committed yet): its own UI
    // covers the wait, so no overlay — but the backend is already ready, so a
    // load parked in the server queue needs the same reload nudges.
    if (!url.startsWith('http')) {
      this.onUnhealthyTick(false)
      return
    }

    if (healthy) this.onHealthyTick()
    else this.onUnhealthyTick(true)
  }

  private onHealthyTick(): void {
    this.unhealthyMs = 0
    this.healthyTicks += 1
    this.hintShown = false

    if (this.phase === 'covering') {
      if (this.healthyTicks >= HEALTHY_TICKS) {
        this.phase = 'verifying'
        this.verifyMs = 0
        this.healthyTicks = 0
        if (this.overlayUp) {
          this.overlayUp = false
          void this.evalJs(FADE_SNIPPET)
          this.log('boot guard: UI mounted, overlay fading')
        }
      }
      return
    }

    // verifying: the fade is just cosmetic; the UI must stay up for a while
    // before the guard retires for good. A regression re-covers immediately.
    this.verifyMs += TICK_MS
    if (this.verifyMs >= VERIFY_MS) {
      this.phase = 'done'
      this.log('boot guard: UI stable, disarmed')
    }
  }

  private onUnhealthyTick(showOverlay: boolean): void {
    // Count blankness whether we can see a document or not: a parked load (no
    // document at all) is blankness too.
    this.unhealthyMs += TICK_MS
    this.healthyTicks = 0

    if (this.phase === 'verifying') {
      // The UI regressed right after mounting: cover again and keep waiting.
      this.phase = 'covering'
      this.verifyMs = 0
      this.nextReloadMs = FIRST_RELOAD_MS
      if (showOverlay) this.ensureOverlay()
    }

    if (this.phase !== 'covering') return

    if (showOverlay && this.unhealthyMs >= SHOW_AFTER_MS) this.ensureOverlay()
    if (showOverlay && this.unhealthyMs >= HINT_AFTER_MS && !this.hintShown && this.overlayUp) {
      this.hintShown = true
      void this.evalJs(HINT_SNIPPET)
    }
    if (this.unhealthyMs >= this.nextReloadMs) {
      this.reloadBackend()
      this.nextReloadMs = Math.min(this.nextReloadMs * 2, MAX_RELOAD_MS)
    }
  }

  private ensureOverlay(): void {
    if (this.overlayUp) return
    void this.evalJs(INJECT_SNIPPET).then((result) => {
      if (result !== null) {
        this.overlayUp = true
        this.log('boot guard: overlay up (UI not mounted yet)')
      }
    })
  }
}
