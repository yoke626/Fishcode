/**
 * Application menu bar. FISHCODE replaces Electron's DEFAULT menu: its Help
 * dropdown links to electronjs.org and github.com/electron issues/discussions,
 * none of which open reliably on mainland networks. Our menu is Chinese
 * throughout, keeps the useful standard roles (undo/copy/zoom/…), and the Help
 * dropdown only points at DeepSeek's own docs site plus an About dialog.
 */

import { app, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { APP } from '../shared/constants'
import { STRINGS } from '../shared/strings'

function showAbout(): void {
  void dialog.showMessageBox({
    type: 'info',
    title: STRINGS.menu.about,
    message: `${APP.productName} ${app.getVersion()}`,
    detail: STRINGS.menu.aboutBody,
  })
}

export function installAppMenu(): void {
  const m = STRINGS.menu
  const template: MenuItemConstructorOptions[] = [
    {
      label: m.file,
      submenu: [{ label: m.quit, role: 'quit' }],
    },
    {
      label: m.edit,
      submenu: [
        { label: m.undo, role: 'undo' },
        { label: m.redo, role: 'redo' },
        { type: 'separator' },
        { label: m.cut, role: 'cut' },
        { label: m.copy, role: 'copy' },
        { label: m.paste, role: 'paste' },
        { label: m.delete, role: 'delete' },
        { type: 'separator' },
        { label: m.selectAll, role: 'selectAll' },
      ],
    },
    {
      label: m.view,
      submenu: [
        { label: m.reload, role: 'reload' },
        { label: m.forceReload, role: 'forceReload' },
        { type: 'separator' },
        { label: m.actualSize, role: 'resetZoom' },
        { label: m.zoomIn, role: 'zoomIn' },
        { label: m.zoomOut, role: 'zoomOut' },
        { type: 'separator' },
        { label: m.fullScreen, role: 'togglefullscreen' },
      ],
    },
    {
      label: m.window,
      submenu: [
        { label: m.minimize, role: 'minimize' },
        { label: m.maximize, role: 'zoom' },
        { label: m.close, role: 'close' },
      ],
    },
    {
      label: m.help,
      submenu: [
        {
          label: m.docs,
          click: () => void shell.openExternal(STRINGS.menu.docsUrl),
        },
        { type: 'separator' },
        {
          label: m.about,
          click: () => showAbout(),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
