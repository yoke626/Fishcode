/**
 * Windows-only "Open with FISHCODE" context-menu integration, plus the `--open`
 * path it (or a second instance) hands back to us.
 *
 * The registry entry lives under HKCU so no elevation is needed. The menu
 * command runs `<exe> --open "%1"`; bootstrap forwards that path to the dsh
 * renderer over `app:open-path` (a documented integration point — the backend
 * may or may not consume it).
 */

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { OPEN_WITH_REG } from '../shared/constants'
import { STRINGS } from '../shared/strings'

const execFileAsync = promisify(execFile)

export class OpenWithService {
  /** The context-menu entry only makes sense for a packaged app on Windows. */
  isSupported(): boolean {
    return process.platform === 'win32' && app.isPackaged
  }

  async isInstalled(): Promise<boolean> {
    if (!this.isSupported()) return false
    try {
      await execFileAsync('reg', ['query', this.commandKey(), '/ve'], { windowsHide: true })
      return true
    } catch {
      return false
    }
  }

  async install(): Promise<void> {
    if (!this.isSupported()) throw new Error('not supported on this platform')
    await execFileAsync('reg', ['add', this.key(), '/ve', '/d', STRINGS.tray.openWithMenu, '/f'], {
      windowsHide: true,
    })
    await execFileAsync(
      'reg',
      ['add', this.commandKey(), '/ve', '/d', this.command(), '/f'],
      { windowsHide: true },
    )
  }

  async uninstall(): Promise<void> {
    if (!this.isSupported()) return
    try {
      await execFileAsync('reg', ['delete', this.key(), '/f'], { windowsHide: true })
    } catch {
      // Already absent — nothing to remove.
    }
  }

  /** Extract an absolute `--open <path>` value from argv, if present. */
  static parseOpenPath(argv: string[]): string | null {
    const index = argv.indexOf('--open')
    if (index === -1 || index + 1 >= argv.length) return null
    const value = argv[index + 1]
    if (!value || !isAbsolute(value)) return null
    return value
  }

  /** The menu may forward a path that no longer exists; only accept live files. */
  static async validatePath(path: string): Promise<boolean> {
    try {
      await fs.access(path)
      return true
    } catch {
      return false
    }
  }

  private key(): string {
    return `${OPEN_WITH_REG.root}\\${OPEN_WITH_REG.key}`
  }

  private commandKey(): string {
    return `${OPEN_WITH_REG.root}\\${OPEN_WITH_REG.commandKey}`
  }

  private command(): string {
    return `"${process.execPath}" --open "%1"`
  }
}
