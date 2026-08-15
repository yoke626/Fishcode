// Tracks which WebContents ids belong to windows we created, so IPC handlers
// can reject messages from any other renderer (e.g. the backend page).

import type { WebContents } from 'electron';

export class WindowRegistry {
  private readonly byId = new Map<number, string>();

  track(name: string, wc: WebContents): void {
    this.byId.set(wc.id, name);
    if (!wc.isDestroyed()) {
      wc.once('destroyed', () => this.drop(wc.id));
    }
  }

  has(id: number): boolean {
    return this.byId.has(id);
  }

  drop(id: number): void {
    this.byId.delete(id);
  }
}
