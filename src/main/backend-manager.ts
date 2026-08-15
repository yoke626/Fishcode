/**
 * Owns the lifecycle of the local `dsh web` backend.
 *
 * Responsibilities, per the audit-derived fixes:
 *   - find a free port (with an EADDRINUSE retry via a fresh port on restart)
 *   - spawn `<node> <dshBin> web --host 127.0.0.1 --port <port>`
 *   - fast-fail on spawn errors (ENOENT/EACCES) instead of hanging
 *   - single-flight readiness poll: only a 2xx response counts, and each tick
 *     first asserts the child is still alive
 *   - bounded restart on post-ready crash, with a stability window that resets
 *     the restart counter
 *   - stop() that actually confirms the process tree is gone before clearing
 *     our reference (taskkill /T /F on Windows, SIGTERM→SIGKILL elsewhere)
 */

import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import { once } from 'node:events'
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { DSH } from '../shared/constants'
import { dshHome } from '../shared/paths'

export type BackendState = 'stopped' | 'starting' | 'ready' | 'restarting' | 'failed'

export interface BackendOptions {
  node: string
  bin: string
  skillsDir: string
  /** Extra `--patch <path>` overlays passed to dsh before the inner args. */
  patchFiles?: string[]
  host?: string
  readyTimeoutMs?: number
  pollIntervalMs?: number
  maxRestarts?: number
  restartDelayMs?: number
  onLog?: (line: string) => void
  onStateChange?: (state: BackendState, port: number | null) => void
  onError?: (message: string) => void
}

const STABILITY_MS = 30_000
const STOP_TIMEOUT_MS = 5_000
const STDERR_TAIL_LINES = 40

export class BackendManager {
  private child: ChildProcess | null = null
  private port: number | null = null
  private state: BackendState = 'stopped'
  private restartCount = 0
  private stopping = false
  private spawnError: Error | null = null
  private stabilityTimer: NodeJS.Timeout | undefined
  private readonly stderrTail: string[] = []

  private readonly host: string
  private readonly readyTimeoutMs: number
  private readonly pollIntervalMs: number
  private readonly maxRestarts: number
  private readonly restartDelayMs: number

  constructor(private readonly opts: BackendOptions) {
    this.host = opts.host ?? DSH.host
    this.readyTimeoutMs = opts.readyTimeoutMs ?? DSH.readyTimeoutMs
    this.pollIntervalMs = opts.pollIntervalMs ?? DSH.readyPollIntervalMs
    this.maxRestarts = opts.maxRestarts ?? DSH.maxRestarts
    this.restartDelayMs = opts.restartDelayMs ?? DSH.restartDelayMs
  }

  getState(): BackendState {
    return this.state
  }

  getPort(): number | null {
    return this.port
  }

  /** The URL the main window should load once the backend is ready. */
  getBaseUrl(): string | null {
    return this.port === null ? null : `http://${this.host}:${this.port}/`
  }

  /** Bring the backend up. Resolves once ready; rejects on startup failure. */
  async start(signal?: AbortSignal): Promise<void> {
    if (this.state === 'starting' || this.state === 'ready' || this.state === 'restarting') return
    this.stopping = false
    this.restartCount = 0
    await this.spawnAndWait(signal)
  }

  /** Tear the backend down and confirm the process tree is gone. */
  async stop(): Promise<void> {
    this.stopping = true
    this.clearStabilityTimer()
    const child = this.child
    this.child = null
    this.port = null

    if (child && child.pid !== undefined && child.exitCode === null) {
      await this.killTree(child)
    }
    this.setState('stopped')
  }

  private async spawnAndWait(signal?: AbortSignal): Promise<void> {
    this.setState('starting')
    const port = await this.findFreePort()
    this.port = port
    this.spawnError = null
    this.stderrTail.length = 0

    // Launcher flags come first: `--patch` must precede the web app's inner
    // args (`--host`/`--port`), which start at the first unrecognized token.
    const patchArgs = (this.opts.patchFiles ?? []).flatMap((p) => ['--patch', p])
    const child = spawn(
      this.opts.node,
      [this.opts.bin, 'web', ...patchArgs, '--host', this.host, '--port', String(port)],
      {
        env: { ...process.env, DSH_HOME: dshHome(), DSH_BUNDLED_SKILL_DIR: this.opts.skillsDir },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    this.child = child
    this.captureOutput(child)

    try {
      await this.waitForReady(child, port, signal)
    } catch (error) {
      if (!this.stopping) this.setState('failed')
      throw error
    }

    this.setState('ready')
    this.startStabilityTimer()

    // Only *after* ready does an exit mean "restart" (vs. a startup failure,
    // which waitForReady already surfaced).
    child.once('exit', (code, sig) => {
      void this.onExit(code, sig)
    })
  }

  private captureOutput(child: ChildProcess): void {
    child.stdout?.on('data', (chunk: Buffer) => this.emitLog(chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      this.emitLog(text)
      this.stderrTail.push(text)
      if (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail.shift()
    })
    child.on('error', (error) => {
      // Spawn failure (ENOENT/EACCES) surfaces here before any 'exit'.
      this.spawnError = error
      this.emitLog(`spawn error: ${error.message}`)
    })
  }

  private async waitForReady(
    child: ChildProcess,
    port: number,
    signal?: AbortSignal,
  ): Promise<void> {
    // The child being alive but silent is not a failure: on a fresh harness
    // home, dsh's first boot (profile materialization, vision runtime setup)
    // can block its event loop for minutes while it is in fact starting up.
    // A 'failed' verdict here would nag the user with a spurious error, so we
    // keep waiting while the child lives and only fail when it actually dies.
    let silentPolls = 0
    for (;;) {
      if (signal?.aborted) throw new Error('backend start aborted')
      if (this.spawnError) throw this.spawnError
      if (child.exitCode !== null) {
        const tail = this.stderrTail.join('')
        throw new Error(`dsh exited before ready (code ${child.exitCode})${tail ? `:\n${tail}` : ''}`)
      }
      const status = await this.probe(port)
      if (status !== null && status >= 200 && status < 300) return
      // Log only now and then — first boot can legitimately take minutes.
      silentPolls += 1
      const silentMs = silentPolls * this.pollIntervalMs
      if (silentPolls === 1 || silentMs >= this.readyTimeoutMs) {
        this.emitLog(`still booting (${Math.round(silentMs / 1000)}s without a response)`)
        silentPolls = 0
      }
      await delay(this.pollIntervalMs)
    }
  }

  /** HTTP probe of the backend; resolves null on any connect/read error. */
  private probe(port: number): Promise<number | null> {
    return new Promise((resolve) => {
      const req = http.get({ host: this.host, port, path: '/', timeout: 2000 }, (res) => {
        res.resume()
        resolve(res.statusCode ?? null)
      })
      req.on('error', () => resolve(null))
      req.on('timeout', () => {
        req.destroy()
        resolve(null)
      })
    })
  }

  private async onExit(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (this.stopping) return
    this.clearStabilityTimer()

    if (this.restartCount >= this.maxRestarts) {
      this.setState('failed')
      this.opts.onError?.(`backend exited repeatedly (code ${code}, signal ${signal})`)
      return
    }

    this.restartCount += 1
    this.setState('restarting')
    await delay(this.restartDelayMs)
    if (this.stopping) return

    try {
      await this.spawnAndWait()
    } catch (error) {
      this.setState('failed')
      this.opts.onError?.(`backend restart failed: ${(error as Error).message}`)
    }
  }

  private startStabilityTimer(): void {
    this.clearStabilityTimer()
    this.stabilityTimer = setTimeout(() => {
      this.stabilityTimer = undefined
      // Survived a full stability window; a future crash starts a fresh budget.
      this.restartCount = 0
    }, STABILITY_MS)
  }

  private clearStabilityTimer(): void {
    if (this.stabilityTimer !== undefined) {
      clearTimeout(this.stabilityTimer)
      this.stabilityTimer = undefined
    }
  }

  private async killTree(child: ChildProcess): Promise<void> {
    try {
      if (process.platform === 'win32') {
        await execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'])
      } else {
        child.kill('SIGTERM')
      }
    } catch {
      // The tree may already be gone; the exit-await below is authoritative.
    }

    try {
      await Promise.race([
        once(child, 'exit'),
        delay(STOP_TIMEOUT_MS).then(() => {
          throw new Error('stop timeout')
        }),
      ])
    } catch {
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server: Server = createServer()
      server.unref()
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address === null || typeof address === 'string') {
          server.close()
          reject(new Error('could not bind a free port'))
          return
        }
        const { port } = address
        server.close((err) => {
          if (err) reject(err)
          else resolve(port)
        })
      })
    })
  }

  private setState(state: BackendState): void {
    this.state = state
    this.opts.onStateChange?.(state, this.port)
  }

  private emitLog(line: string): void {
    if (this.opts.onLog) {
      const trimmed = line.replace(/\s+$/, '')
      if (trimmed) this.opts.onLog(trimmed)
    }
  }
}
