/**
 * Session deletion for the dsh sidebar's three-dot menu.
 *
 * dsh web has no session-delete RPC, so FISHCODE owns cleanup itself: sessions
 * live on disk at `~/.dsh/sessions/<scope>/session-<uuid>/session.jsonl.zstd`,
 * and the backend's `session.list` merges cold sessions straight from disk on
 * every call. Deleting a folder therefore removes the row from the sidebar on
 * the next list pull — we force that pull by reloading the main window after a
 * deletion.
 *
 * The heavy lifting runs in the BUNDLED standalone Node via
 * scripts/session-helper.mjs (it needs `node:zstd`, absent from Electron's
 * Node 20; the standalone runtime is Node 24). This module only resolves the
 * runtime + helper paths, spawns the helper, and layers the shell-level
 * guards: the currently-open session and any actively-written log are never
 * deletable.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { runtimeContext } from './runtime'

export interface SessionInfo {
  sessionId: string
  scope: string
  folder: string
  title: string | null
  createdAt: number | null
  updatedAt: number
  mtimeMs: number
  /** Log written within the last minute — likely a live task. */
  active: boolean
  eventCount: number
  fileBytes: number
}

export interface DeleteResult {
  deleted: string[]
  failed: Array<{ folder: string; reason: string }>
}

export interface SessionManagerDeps {
  /** The main window hosting the dsh UI (used to detect the open session + refresh). */
  getMainWindow: () => BrowserWindow | null
  onLog: (line: string) => void
}

const HELPER_TIMEOUT_MS = 30_000

export class SessionManager {
  private readonly runtimeExe: string | null
  private readonly helperScript: string | null

  constructor(private readonly deps: SessionManagerDeps) {
    const ctx = runtimeContext()
    const exe = process.platform === 'win32' ? 'node.exe' : 'node'

    const runtimeCandidates = ctx.isPackaged
      ? [join(ctx.resourcesPath, 'node-runtime', exe)]
      : [join(ctx.appPath, 'node-runtime', exe), process.env.DSH_NODE ?? 'node']
    this.runtimeExe = runtimeCandidates.find((p) => existsSync(p)) ?? null

    const helper = ctx.isPackaged
      ? join(ctx.resourcesPath, 'session-helper.mjs')
      : join(ctx.appPath, 'scripts', 'session-helper.mjs')
    this.helperScript = existsSync(helper) ? helper : null
  }

  get ready(): boolean {
    return this.runtimeExe !== null && this.helperScript !== null
  }

  /** The node runtime that actually has `node:zstd` (for diagnostics). */
  get runtimeLabel(): string {
    return this.runtimeExe ?? '(未找到独立运行时)'
  }

  /** Enumerate every on-disk session across all scopes (newest first). */
  async list(): Promise<SessionInfo[]> {
    const out = await this.runHelper(['list'])
    const parsed = JSON.parse(out) as { sessions: SessionInfo[] }
    return Array.isArray(parsed.sessions) ? parsed.sessions : []
  }

  /** Locate a session id (bare or `session-<uuid>`) on disk, without decoding its log. */
  async findFolder(
    sessionId: string,
  ): Promise<Array<{ folder: string; scope: string; active: boolean }>> {
    const out = await this.runHelper(['find', sessionId])
    const parsed = JSON.parse(out) as {
      folders: Array<{ folder: string; scope: string; active: boolean }>
    }
    return Array.isArray(parsed.folders) ? parsed.folders : []
  }

  /**
   * Delete a session by id — the dsh sidebar three-dot flow. Refuses the
   * currently-open session (as reported by the page itself) and any log
   * written in the last minute (a live task).
   */
  async deleteById(sessionId: string, isCurrent: boolean): Promise<DeleteResult> {
    const failed: DeleteResult['failed'] = []
    if (isCurrent) return { deleted: [], failed: [{ folder: sessionId, reason: 'current' }] }
    const found = await this.findFolder(sessionId)
    if (found.length === 0) return { deleted: [], failed: [{ folder: sessionId, reason: 'missing' }] }
    if (found.some((entry) => entry.active)) {
      return { deleted: [], failed: [{ folder: sessionId, reason: 'active' }] }
    }
    return this.delete([found[0].folder], null)
  }

  /**
   * Delete session folders, refusing anything that is currently open or has
   * been written in the last minute (a live task). Returns the effective
   * result; refused folders land in `failed` with a reason.
   */
  async delete(folders: string[], currentSessionId: string | null): Promise<DeleteResult> {
    const allowed: string[] = []
    const failed: DeleteResult['failed'] = []

    const current = currentSessionId ? `session-${currentSessionId.replace(/^session-/, '')}` : null
    for (const folder of folders) {
      const sessionId = folder.split(/[\\/]/).filter(Boolean).pop() ?? ''
      if (current && sessionId === current) {
        failed.push({ folder, reason: 'current' })
        continue
      }
      if (!existsSync(join(folder, 'session.jsonl.zstd')) && !existsSync(join(folder, 'session.jsonl'))) {
        failed.push({ folder, reason: 'missing' })
        continue
      }
      allowed.push(folder)
    }

    if (allowed.length === 0) return { deleted: [], failed }

    const out = await this.runHelper(['delete', ...allowed])
    const parsed = JSON.parse(out) as DeleteResult
    parsed.failed.push(...failed)
    return parsed
  }

  /**
   * The session currently open in the dsh UI, read from the renderer's own
   * persisted selection (`dsh.sessions.current`, JSON with a `sessionId`).
   * Returns null when the main window isn't on the dsh page or can't respond.
   * Bounded by a 2s timeout so a busy/hung dsh renderer can never stall an
   * IPC handler forever.
   */
  async currentSessionId(): Promise<string | null> {
    const win = this.deps.getMainWindow()
    if (!win || win.isDestroyed()) return null
    try {
      const raw = (await Promise.race([
        win.webContents.executeJavaScript('localStorage.getItem("dsh.sessions.current")', true),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ])) as string | null
      if (!raw) return null
      const parsed = JSON.parse(raw) as { sessionId?: unknown }
      return typeof parsed.sessionId === 'string' ? parsed.sessionId : null
    } catch {
      return null
    }
  }

  /** Reload the main window so the dsh UI re-pulls session.list from disk. */
  refreshMainWindow(): void {
    const win = this.deps.getMainWindow()
    if (!win || win.isDestroyed()) return
    this.deps.onLog('session cleanup: reloading main window')
    void win.webContents.reload()
  }

  private runHelper(args: string[]): Promise<string> {
    if (!this.runtimeExe || !this.helperScript) {
      return Promise.reject(new Error('session helper unavailable'))
    }
    return new Promise((resolve, reject) => {
      execFile(
        this.runtimeExe!,
        [this.helperScript!, ...args],
        { windowsHide: true, timeout: HELPER_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr?.trim() || String(error.message || error)))
            return
          }
          resolve(stdout)
        },
      )
    })
  }
}
