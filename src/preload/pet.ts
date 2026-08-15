import { contextBridge, ipcRenderer } from 'electron'

/**
 * Pet preload. A sandboxed preload may only `require('electron')`, so the
 * channel names are inlined here (keep in sync with src/shared/channels.ts).
 */

type PetState = 'idle' | 'eat' | 'sleep' | 'walk-left' | 'walk-right' | 'working' | 'ciallo'

const CH = {
  petState: 'pet:state',
  petSay: 'pet:say',
  petSummon: 'pet:summon',
  petHover: 'pet:hover',
  petDrag: 'pet:drag',
  petDrop: 'pet:drop',
  petMenu: 'pet:menu',
} as const

contextBridge.exposeInMainWorld('petAPI', {
  /** Toggle click-through: false to pass clicks through, true to grab the sprite. */
  hover: (over: boolean): void => ipcRenderer.send(CH.petHover, over),
  /** A click (no drag) summons the main window. */
  summon: (): void => ipcRenderer.send(CH.petSummon),
  /** Move the window by a cursor delta while dragging. */
  dragBy: (dx: number, dy: number): void => ipcRenderer.send(CH.petDrag, { dx, dy }),
  /** Drag finished; persist the window position. */
  drop: (): void => ipcRenderer.send(CH.petDrop),
  /** Right-click: show the context menu. */
  menu: (): void => ipcRenderer.send(CH.petMenu),
  onState: (callback: (state: PetState) => void): void => {
    ipcRenderer.on(CH.petState, (_event, state: PetState) => callback(state))
  },
  onSay: (callback: (text: string) => void): void => {
    ipcRenderer.on(CH.petSay, (_event, text: string) => callback(text))
  },
})
