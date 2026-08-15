/**
 * Platform-aware "start on login": Electron's login-item API on Windows and
 * macOS, and an XDG autostart .desktop file on Linux (where that API is a
 * no-op).
 */

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { APP } from '../shared/constants'

const LINUX_AUTOSTART_DIR = join(homedir(), '.config', 'autostart')
const LINUX_AUTOSTART_FILE = join(LINUX_AUTOSTART_DIR, 'fishcode.desktop')

export class AutoLaunch {
  /** Apply the user's auto-launch preference to the OS. */
  async setEnabled(enabled: boolean): Promise<void> {
    if (process.platform === 'linux') {
      await this.setLinux(enabled)
      return
    }
    if (process.platform === 'darwin') {
      app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true })
      return
    }
    app.setLoginItemSettings({ openAtLogin: enabled })
  }

  private async setLinux(enabled: boolean): Promise<void> {
    if (!enabled) {
      await fs.rm(LINUX_AUTOSTART_FILE, { force: true })
      return
    }
    await fs.mkdir(LINUX_AUTOSTART_DIR, { recursive: true })
    const content = [
      '[Desktop Entry]',
      'Type=Application',
      `Name=${APP.productName}`,
      `Exec="${process.execPath}" %U`,
      'X-GNOME-Autostart-enabled=true',
      'Terminal=false',
    ].join('\n')
    await fs.writeFile(LINUX_AUTOSTART_FILE, content, 'utf8')
  }
}
