/**
 * Local-feed E2E for the UpdateService (see src/main/update-service.ts).
 *
 * Serves a crafted generic feed over 127.0.0.1 (version bumped above the app's),
 * drives the REAL compiled service with stubbed dialogs, and asserts the full
 * flow: check -> update-available -> download -> update-downloaded -> install
 * prompt (which we decline, so nothing is installed).
 *
 * This never touches GitHub or a real installation. Run from the repo root
 * after `npm run build`:
 *
 *   npm run build && npx electron scripts/update-e2e.js
 *
 * Exit code 0 = PASS, 1 = FAIL.
 */

'use strict'

const { app, dialog } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// --- 1. Build a local generic feed from the last dist output -----------------

const repoRoot = path.resolve(__dirname, '..')
const releaseDir = path.join(repoRoot, 'release')
const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishcode-update-feed-'))

function buildFeed() {
  // Newest Fishcode Setup *.exe in release/ (dist:win output).
  const setups = fs
    .readdirSync(releaseDir)
    .filter((f) => f.startsWith('Fishcode Setup ') && f.endsWith('.exe'))
    .sort()
  if (setups.length === 0) throw new Error('release/ has no Fishcode Setup *.exe — run npm run dist:win first')
  const setup = setups[setups.length - 1]

  const exe = path.join(releaseDir, setup)
  const blockmap = path.join(releaseDir, `${setup}.blockmap`)
  const feedExe = path.join(feedDir, setup)
  fs.copyFileSync(exe, feedExe)
  if (fs.existsSync(blockmap)) fs.copyFileSync(blockmap, path.join(feedDir, `${setup}.blockmap`))

  // latest.yml from release/ with the version bumped so the app sees an update.
  // First line of the generated file is always "version: <semver>".
  const latestPath = path.join(releaseDir, 'latest.yml')
  if (!fs.existsSync(latestPath)) throw new Error('release/latest.yml missing — run npm run dist:win first')
  const raw = fs.readFileSync(latestPath, 'utf-8')
  const bump = process.env.FISHCODE_E2E_FEED_VERSION || '99.0.0'
  if (!/^version: .+$/m.test(raw)) throw new Error('release/latest.yml has no version line')
  fs.writeFileSync(path.join(feedDir, 'latest.yml'), raw.replace(/^version: .+$/m, `version: ${bump}`))
  return { setup, bump }
}

// --- 2. Minimal static HTTP server for the feed ------------------------------

function startFeedServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '')
    const file = path.join(feedDir, rel)
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(file).size })
      fs.createReadStream(file).pipe(res)
    } else {
      res.writeHead(404)
      res.end('not found')
    }
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

// --- 3. Main flow ------------------------------------------------------------

function run(server, feedUrl, feedVersion) {
  // eslint-disable-next-line global-require
  const { UpdateService } = require(path.join(repoRoot, 'out', 'main', 'main', 'update-service.js'))
  // eslint-disable-next-line global-require
  const { autoUpdater } = require('electron-updater')
  // Dev runs are unpackaged; electron-updater would skip the check without this.
  autoUpdater.forceDevUpdateConfig = true

  const logs = []
  let dialogCalls = 0
  let finished = false

  // Stub dialogs: call #1 = download prompt -> accept (下载并安装); call #2 =
  // install prompt -> decline (稍后), so nothing is installed.
  dialog.showMessageBox = async () => {
    dialogCalls += 1
    console.log(`[e2e] dialog #${dialogCalls} shown`)
    return { response: dialogCalls === 1 ? 0 : 1, checkboxChecked: false }
  }

  const notifications = {
    show: (title, body) => console.log(`[notify] ${title} | ${body}`),
  }

  const service = new UpdateService({
    notifications,
    getParentWindow: () => null,
    onLog: (line) => {
      logs.push(line)
      console.log(`[svc] ${line}`)
    },
  })

  function finish(pass, reason) {
    if (finished) return
    finished = true
    service.dispose()
    server.close()
    if (pass) {
      console.log(`[e2e] PASS ${reason} (feed ${feedVersion}, dialogs ${dialogCalls})`)
      app.exit(0)
    } else {
      console.error(`[e2e] FAIL ${reason}`)
      app.exit(1)
    }
  }

  // Timeout safety: the background check is scheduled ~5s after start().
  setTimeout(() => finish(false, `timed out (dialogs=${dialogCalls}, logs=${logs.length})`), 90_000)

  service.start()

  // Poll for the terminal state instead of threading callbacks through the stub.
  const poll = setInterval(() => {
    if (dialogCalls >= 2) {
      clearInterval(poll)
      const foundUpdate = logs.some((l) => l.includes(`Found version ${feedVersion}`))
      setTimeout(() => {
        if (!foundUpdate) return finish(false, 'update-available never fired with the feed version')
        finish(true, 'update detected -> downloaded -> install prompt declined')
      }, 1500) // let the download-promise settle before quitting
    }
  }, 500)
}

// --- 4. Entry point ----------------------------------------------------------

app.whenReady().then(async () => {
  console.log(`[e2e] app.getVersion() = ${app.getVersion()} (repo package.json ${require(path.join(repoRoot, 'package.json')).version})`)
  const { setup, bump } = buildFeed()
  const server = await startFeedServer()
  const port = server.address().port
  const feedUrl = `http://127.0.0.1:${port}/`
  process.env.FISHCODE_UPDATE_URL = feedUrl
  process.env.FISHCODE_UPDATE_FORCE = '1'

  // In dev, electron-updater's download helper reads updaterCacheDirName from
  // the on-disk config (dev-app-update.yml next to the app). Point it at a
  // temp copy so nothing touches the repo.
  const devConfig = path.join(feedDir, 'dev-app-update.yml')
  fs.writeFileSync(
    devConfig,
    `provider: generic\nurl: ${feedUrl}\nupdaterCacheDirName: fishcode-updater\n`,
  )
  // eslint-disable-next-line global-require
  const { autoUpdater } = require('electron-updater')
  autoUpdater.updateConfigPath = devConfig

  console.log(`[e2e] feed http://127.0.0.1:${port}/ (installer "${setup}", version ${bump})`)
  run(server, feedUrl, bump)
})
