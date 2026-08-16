/**
 * The desktop pet: a small always-on-top mascot that idles, celebrates, works,
 * and can be dragged (persisting its position), clicked (summoning the main
 * window), or right-clicked (context menu).
 *
 * The animation is a self-cancelling setTimeout chain; every callback re-checks
 * that the window is still alive and visible before touching it.
 *
 * The available states come from assets/pet/manifest.json (written by
 * `npm run pet:prepare`): a state without art is simply never scheduled, and
 * states with several "variants" (e.g. a handful of idle dances) get a random
 * one per entry — the renderer picks the variant. Without a manifest the
 * controller falls back to the legacy full state set.
 */

import { app, ipcMain, Menu, screen } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '../../shared/channels'
import { WINDOW } from '../../shared/constants'
import { STRINGS } from '../../shared/strings'
import type { PetPosition } from '../../shared/settings'
import { isTrustedSender } from '../security'
import type { WindowRegistry } from '../window-registry'
import { PetWindow } from '../windows/pet-window'

export type PetState = 'idle' | 'eat' | 'sleep' | 'walk-left' | 'walk-right' | 'working' | 'ciallo'
const PET_STATES: readonly PetState[] = ['idle', 'eat', 'sleep', 'walk-left', 'walk-right', 'working', 'ciallo']
/** Menu order for the manual "play one animation" picker. */
const ACTION_ORDER: readonly PetState[] = ['idle', 'walk-left', 'walk-right', 'eat', 'sleep', 'working', 'ciallo']

export interface PetControllerDeps {
  registry: WindowRegistry
  onSummon: () => void
  onToggle: () => void
  getPetPosition: () => PetPosition | null
  setPetPosition: (position: PetPosition) => void
}

export class PetController {
  private readonly window: PetWindow
  private state: PetState = 'idle'
  private timer: NodeJS.Timeout | null = null
  private working = false
  private launched = false
  /** States the shipped art can render (from the pet manifest). */
  private available: Set<PetState> = new Set(['idle', 'eat', 'sleep', 'walk-left', 'walk-right', 'working'])

  constructor(private readonly deps: PetControllerDeps) {
    this.loadManifest()
    // The renderer may load after the controller already pushed a state (e.g.
    // a task started while the pet window was being created) — re-send it.
    this.window = new PetWindow(deps.registry, () => this.resendState())
    this.wireIpc()
  }

  show(): void {
    this.ensureWindow()
    this.window.show()
    if (this.launched) {
      // Already rotating: re-shows must not reset the animation timer (e.g.
      // settings.onChange re-applies the pet after a position save).
      if (this.timer === null) this.scheduleNext(800)
      return
    }
    this.launched = true
    // Launch animation (e.g. "ciallo!"), then the normal idle rotation.
    if (this.has('ciallo')) {
      this.setState('ciallo')
      this.scheduleNext(8_000)
    } else {
      this.scheduleNext(800)
    }
  }

  hide(): void {
    this.clearTimer()
    this.window.hide()
  }

  isVisible(): boolean {
    return this.window.isVisible()
  }

  /**
   * Play one animation on demand (tray/context-menu picker), then resume the
   * normal rotation — or the sticky 'working' state if the backend is busy.
   */
  play(state: PetState): void {
    if (!this.has(state)) return
    this.ensureWindow()
    this.window.show()
    this.clearTimer()
    this.setState(state)
    this.scheduleNext(this.manualDuration(state))
  }

  /** The states the shipped art supports, in menu order, with labels. */
  actionItems(): Array<{ state: PetState; label: string }> {
    return ACTION_ORDER.filter((state) => this.has(state)).map((state) => ({
      state,
      label: STRINGS.pet.actions[state],
    }))
  }

  /** Speech bubble + a happy wiggle; driven by the completion watcher. */
  say(text: string): void {
    if (!this.window.isAlive() || !this.window.isVisible()) return
    this.window.send(IPC.petSay, text)
    // While the backend is busy the pet keeps working; the bubble alone
    // carries the message (onTaskComplete ends the work state first). Without
    // celebrate art the bubble still shows.
    if (this.working || !this.has('eat')) return
    this.setState('eat')
    this.scheduleNext(4_000)
  }

  /**
   * Sticky override while the backend is busy (completion watcher's onBusy).
   * While active the idle state machine is parked on 'working' (when working
   * art exists); the completion bubble/celebration via say() resumes it.
   */
  setWorking(active: boolean): void {
    if (active) {
      this.working = true
      this.clearTimer()
      if (this.has('working')) this.setState('working')
    } else if (this.working) {
      this.working = false
      this.setState('idle')
      this.scheduleNext(2_000)
    }
  }

  destroy(): void {
    this.clearTimer()
    this.window.destroy()
  }

  private ensureWindow(): void {
    if (this.window.isAlive()) return
    this.window.create()
    this.position()
  }

  private position(): void {
    const saved = this.deps.getPetPosition()
    if (saved) {
      // The saved spot can end up off-screen (a monitor was unplugged, the
      // resolution changed, or an older build let it be dragged past an edge)
      // — clamp it back into the current work area rather than leave the pet
      // invisible.
      this.window.setPosition(...this.clampToWorkArea(saved.x, saved.y))
      return
    }
    const { workArea } = screen.getPrimaryDisplay()
    this.window.setPosition(
      workArea.x + workArea.width - WINDOW.pet.width - 24,
      workArea.y + workArea.height - WINDOW.pet.height - 24,
    )
  }

  /** Keep (x, y) inside the primary display's work area so the pet can't be lost. */
  private clampToWorkArea(x: number, y: number): [number, number] {
    const { workArea } = screen.getPrimaryDisplay()
    const maxX = workArea.x + workArea.width - WINDOW.pet.width
    const maxY = workArea.y + workArea.height - WINDOW.pet.height
    return [
      Math.min(Math.max(x, workArea.x), maxX),
      Math.min(Math.max(y, workArea.y), maxY),
    ]
  }

  private resendState(): void {
    if (this.window.isAlive()) this.window.send(IPC.petState, this.state)
  }

  private wireIpc(): void {
    ipcMain.on(IPC.petHover, (event, over: boolean) => {
      if (!isTrustedSender(event, this.deps.registry)) return
      this.window.setIgnoreMouseEvents(!over)
    })

    ipcMain.on(IPC.petDrag, (event, delta: { dx: number; dy: number }) => {
      if (!isTrustedSender(event, this.deps.registry)) return
      const [x, y] = this.window.getPosition()
      this.window.setPosition(
        ...this.clampToWorkArea(x + Math.round(delta.dx), y + Math.round(delta.dy)),
      )
    })

    ipcMain.on(IPC.petDrop, (event) => {
      if (!isTrustedSender(event, this.deps.registry)) return
      const [x, y] = this.window.getPosition()
      this.deps.setPetPosition({ x, y })
    })

    ipcMain.on(IPC.petSummon, (event) => {
      if (!isTrustedSender(event, this.deps.registry)) return
      this.deps.onSummon()
    })

    ipcMain.on(IPC.petMenu, (event) => {
      if (!isTrustedSender(event, this.deps.registry)) return
      this.popupMenu()
    })
  }

  private popupMenu(): void {
    const actions = this.actionItems().map(({ state, label }) => ({
      label,
      click: () => this.play(state),
    }))
    const menu = Menu.buildFromTemplate([
      { label: STRINGS.tray.show, click: () => this.deps.onSummon() },
      {
        label: STRINGS.pet.actionMenu,
        submenu: actions,
      },
      { type: 'separator' },
      { label: STRINGS.pet.hide, click: () => this.deps.onToggle() },
      { type: 'separator' },
      { label: STRINGS.tray.quit, click: () => app.quit() },
    ])
    menu.popup({ window: this.window.browserWindow ?? undefined })
  }

  // --- manifest (which states have art) ---

  private loadManifest(): void {
    try {
      const raw = JSON.parse(readFileSync(join(app.getAppPath(), 'out', 'assets', 'pet', 'manifest.json'), 'utf8'))
      const keys: unknown[] = Object.keys(raw.states ?? {})
      const available = new Set<PetState>()
      for (const key of keys) {
        if (typeof key === 'string' && (PET_STATES as readonly string[]).includes(key)) available.add(key as PetState)
      }
      // Mirror mode: the renderer reuses shared 'walk' frames for both
      // directions, so both become schedulable.
      if (keys.includes('walk')) {
        available.add('walk-left')
        available.add('walk-right')
      }
      if (available.size > 0) this.available = available
    } catch {
      // Missing/corrupt manifest -> keep the legacy full set.
    }
  }

  private has(state: PetState): boolean {
    return this.available.has(state)
  }

  // --- animation state machine ---

  private scheduleNext(delay: number): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.window.isAlive() || !this.window.isVisible()) return
      this.tick()
    }, delay)
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private tick(): void {
    // While the backend is busy the pet stays parked on 'working' — a manual
    // play (via play()) is a temporary diversion that ends back here.
    let next: PetState
    if (this.working && this.has('working')) {
      next = 'working'
    } else {
      next = this.nextState(this.state)
    }
    this.setState(next)
    this.scheduleNext(this.durationFor(next))
  }

  private setState(state: PetState): void {
    this.state = state
    this.window.send(IPC.petState, state)
  }

  private nextState(current: PetState): PetState {
    switch (current) {
      case 'ciallo':
      case 'walk-left':
      case 'walk-right':
      case 'eat':
      case 'sleep':
        return 'idle'
      case 'idle': {
        // Roll over the states the shipped art supports; anything without art
        // falls back to more idle time.
        const roll = Math.random()
        if (this.has('walk-left') && this.has('walk-right')) {
          if (roll < 0.3) return 'walk-left'
          if (roll < 0.55) return 'walk-right'
        }
        if (this.has('sleep') && roll < 0.65) return 'sleep'
        if (this.has('eat') && roll < 0.78) return 'eat'
        return 'idle'
      }
      case 'working':
        // Parked here by setWorking(true) via the sticky tick() branch; a
        // manual working play (sticky flag off) falls back to idle.
        return this.working ? 'working' : 'idle'
    }
  }

  /** How long each scheduled state plays before the next roll. */
  private durationFor(state: PetState): number {
    switch (state) {
      case 'idle':
        return 15_000 + Math.random() * 10_000
      case 'walk-left':
      case 'walk-right':
        return 8_000 + Math.random() * 4_000
      case 'eat':
        return 6_000
      case 'sleep':
        return 15_000 + Math.random() * 5_000
      case 'working':
        return 1_000
      case 'ciallo':
        return 8_000
    }
  }

  /** How long a manually picked animation plays before rotation resumes. */
  private manualDuration(state: PetState): number {
    switch (state) {
      case 'idle':
        return 12_000
      case 'eat':
      case 'working':
      case 'ciallo':
        return 8_000
      case 'sleep':
        return 10_000
      case 'walk-left':
      case 'walk-right':
        return 8_000
    }
  }
}
