/**
 * Detects "the model finished" without any backend hook: it watches the harness
 * session store (`$DSH_HOME/sessions`) for file activity and treats a busy ->
 * idle gap (no writes for `COMPLETION.idleSettleMs`) as one completion. It
 * never blocks the main thread: Windows/macOS use recursive `fs.watch`; Linux
 * falls back to a lightweight async poll because its `fs.watch` is not
 * recursive.
 *
 * The watch is deliberately scoped to `sessions/`, not the whole home: backend
 * boot noise (cordis snapshots, and in particular the vision toolkit's minutes
 * long Python-runtime extraction under `cache/` on first launch) writes
 * sustained bursts that look exactly like a task. Session logs are the only
 * reliable task signal.
 *
 * Two further guards:
 *   - the watcher is only ARMED once the backend reports ready (before that,
 *     any boot write is ignored entirely), and
 *   - a single write burst is never treated as a task: busy is only confirmed
 *     when a second burst follows within `COMPLETION.confirmMs`. One-off
 *     writes (first-session bootstrap) stay idle.
 */

import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { COMPLETION } from '../shared/constants'

export interface CompletionWatcherDeps {
  dir: string
  onComplete: () => void
  /** Called once per idle -> busy transition (drives the pet's working state). */
  onBusy?: () => void
  onError?: (message: string) => void
}

const POLL_INTERVAL_MS = 2_000

export class CompletionWatcher {
  private watcher: FSWatcher | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private settleTimer: NodeJS.Timeout | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private confirmTimer: NodeJS.Timeout | null = null
  private busy = false
  private armed = false
  private lastSnapshot: string | null = null
  private stopped = false

  constructor(private readonly deps: CompletionWatcherDeps) {}

  /** The session store: `$DSH_HOME/sessions` (the only reliable task signal). */
  private get watchDir(): string {
    return join(this.deps.dir, 'sessions')
  }

  start(): void {
    if (this.stopped) return
    try {
      // Ensure the session store exists so fs.watch doesn't throw ENOENT on
      // first run (dsh creates it lazily with the first session).
      mkdirSync(this.watchDir, { recursive: true })
    } catch (error) {
      this.deps.onError?.(`could not create ${this.watchDir}: ${(error as Error).message}`)
      return
    }

    try {
      this.watcher = watch(
        this.watchDir,
        { recursive: process.platform !== 'linux' },
        () => this.onActivity(),
      )
      this.watcher.on('error', (error) => this.deps.onError?.(`watcher: ${error.message}`))
    } catch (error) {
      this.deps.onError?.(`could not watch ${this.watchDir}: ${(error as Error).message}`)
    }

    if (process.platform === 'linux') this.startPolling()
  }

  /**
   * Start honoring activity. Call once the backend is actually serving
   * (`BackendManager` state 'ready'); boot writes before that are ignored.
   */
  arm(): void {
    this.armed = true
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    this.watcher?.close()
    this.watcher = null
  }

  private onActivity(): void {
    if (this.stopped || !this.armed) return
    // Coalesce a burst of writes into one tick.
    if (this.debounceTimer !== null) return
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.registerActivity()
    }, COMPLETION.debounceMs)
  }

  /** A debounced activity tick: extend the busy phase or open a confirm window. */
  private registerActivity(): void {
    if (this.busy) {
      this.clearSettle()
      this.settleTimer = setTimeout(() => this.settle(), COMPLETION.idleSettleMs)
      return
    }
    if (this.confirmTimer !== null) {
      // Second burst inside the confirm window: a real task is running.
      this.clearConfirm()
      this.markBusy()
      return
    }
    // First burst after an idle stretch: hold off. Single bursts are backend
    // init noise (first-session bootstrap, cordis snapshots), and a real task
    // keeps writing within the confirm window.
    this.confirmTimer = setTimeout(() => {
      this.confirmTimer = null
    }, COMPLETION.confirmMs)
  }

  private markBusy(): void {
    // Always called from the idle state (confirmed by registerActivity).
    this.busy = true
    this.clearSettle()
    this.deps.onBusy?.()
    this.settleTimer = setTimeout(() => this.settle(), COMPLETION.idleSettleMs)
  }

  private settle(): void {
    this.settleTimer = null
    if (this.busy) {
      this.busy = false
      this.deps.onComplete()
    }
  }

  /** Linux fallback: poll a shallow snapshot of the home and diff it. */
  private startPolling(): void {
    if (this.pollTimer !== null) return
    const tick = async (): Promise<void> => {
      if (this.stopped) return
      try {
        const snapshot = await this.snapshot()
        if (this.lastSnapshot !== null && snapshot !== this.lastSnapshot) {
          this.onActivity()
        }
        this.lastSnapshot = snapshot
      } catch {
        // The home may be mid-creation; retry on the next tick.
      }
      this.pollTimer = setTimeout(() => void tick(), POLL_INTERVAL_MS)
    }
    void tick()
  }

  private async snapshot(): Promise<string> {
    const entries = await readdir(this.watchDir)
    const parts = await Promise.all(
      entries.map(async (name) => {
        try {
          const info = await stat(join(this.watchDir, name))
          return `${name}:${info.isDirectory() ? 'd' : 'f'}:${Math.round(info.mtimeMs)}:${info.size}`
        } catch {
          return `${name}:gone`
        }
      }),
    )
    return parts.sort().join('|')
  }

  private clearSettle(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer)
      this.settleTimer = null
    }
  }

  private clearConfirm(): void {
    if (this.confirmTimer !== null) {
      clearTimeout(this.confirmTimer)
      this.confirmTimer = null
    }
  }

  private clearTimers(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    this.clearSettle()
    this.clearConfirm()
  }
}
