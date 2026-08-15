/**
 * The global "summon the shell" shortcut. Registration can fail (another app
 * holds the accelerator, or the OS rejects it), so register() returns a boolean
 * and the caller is responsible for surfacing that to the user.
 */

import { globalShortcut } from 'electron'
import { GLOBAL_ACCELERATOR } from '../shared/constants'

export class Hotkey {
  private active = false

  register(onToggle: () => void): boolean {
    if (this.active) return true
    this.active = globalShortcut.register(GLOBAL_ACCELERATOR, onToggle)
    return this.active
  }

  unregister(): void {
    if (this.active) {
      globalShortcut.unregister(GLOBAL_ACCELERATOR)
      this.active = false
    }
  }
}
