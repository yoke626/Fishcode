// Diagnostic: run the same bundled-plugin registration the app performs at
// startup, without booting a full dsh backend. Verifies that every bundled
// plugin's package + closure can be linked into ~/.dsh/profiles/node_modules
// and that its cordis.patch.yml overlay is written.
// Usage: npm run build && npx electron scripts/check-bundled-plugins.js
'use strict'

const { app } = require('electron')
const path = require('node:path')

app.whenReady().then(() => {
  const root = path.resolve(__dirname, '..')
  const { ensureBundledPlugins } = require(path.join(root, 'out', 'main', 'main', 'vision-toolkit.js'))

  // Running `electron scripts/check-bundled-plugins.js` makes app.getAppPath()
  // point at scripts/, so build the same dev RuntimeContext manually.
  const ctx = {
    isPackaged: false,
    appPath: root,
    resourcesPath: process.resourcesPath,
  }

  try {
    const results = ensureBundledPlugins(ctx)
    for (const result of results) {
      const bad = result.linked.filter((link) => link.status === 'missing' || link.status === 'conflict')
      console.log(`[bundled-plugin] ${result.id} (${result.packageName}) overlay=${result.overlayPath} links=${result.linked.length}${bad.length ? ` BAD=${bad.map((b) => b.name).join(',')}` : ''}`)
      if (bad.length > 0) process.exitCode = 1
    }
    app.exit(process.exitCode || 0)
  } catch (error) {
    console.error('[bundled-plugin] failed:', error)
    app.exit(1)
  }
})
