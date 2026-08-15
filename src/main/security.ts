/**
 * Shell-side security policy:
 *   - only `https:` URLs may escape to the default browser
 *   - IPC messages must originate from the top-level frame of a tracked window
 */

import { shell, type IpcMainInvokeEvent } from 'electron'
import type { WindowRegistry } from './window-registry'

/**
 * Only plain `https:` links may leave the shell. `file:`, `javascript:`, custom
 * schemes, and unencrypted `http:` are all refused, so a compromised renderer
 * cannot trick the shell into launching a local handler.
 */
export function isSafeExternalUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return url.protocol === 'https:'
}

export async function safeOpenExternal(raw: string): Promise<void> {
  if (!isSafeExternalUrl(raw)) return
  await shell.openExternal(raw)
}

/**
 * Reject IPC unless it comes from the top-level frame of a window we created
 * (no iframes, no stray webContents).
 */
export function isTrustedSender(event: IpcMainInvokeEvent, registry: WindowRegistry): boolean {
  const frame = event.senderFrame
  if (!frame) return false
  if (frame !== frame.top) return false
  return registry.isTracked(event.sender.id)
}
