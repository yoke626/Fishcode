/**
 * Thin wrapper over Electron's Notification that keeps a strong reference to
 * every in-flight notification so it cannot be garbage-collected out from
 * under the OS before the user dismisses it.
 */

import { Notification } from 'electron'

export class NotificationService {
  private readonly active = new Set<Notification>()

  show(title: string, body: string): void {
    if (!Notification.isSupported()) return
    const notification = new Notification({ title, body })
    notification.on('close', () => this.active.delete(notification))
    notification.on('click', () => this.active.delete(notification))
    this.active.add(notification)
    notification.show()
  }
}
