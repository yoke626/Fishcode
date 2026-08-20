// Smoke test: boot dsh web with every FISHCODE bundled plugin overlay mounted,
// exactly like the app's BackendManager does. Useful after upgrading dsh or
// adding a bundled plugin.
// Usage: node scripts/smoke-bundled-backend.mjs
import { spawn, execFile } from 'node:child_process'
import { createServer } from 'node:net'
import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const HOST = '127.0.0.1'
const OVERLAYS = [
  'vision-toolkit.patch.yml',
  'dsh-super-injector.patch.yml',
  'dsh-genui.patch.yml',
  'dsh-better-sidebar.patch.yml',
  'dsh-pet.patch.yml',
  'dsh-skin-center.patch.yml',
  'dshmarket.patch.yml',
]

const nodeExe = join(root, 'node-runtime', 'node.exe')
const dshPkg = join(root, 'dsh-bundle', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
const bin = join(root, 'dsh-bundle', 'node_modules', '@deepseek-ai', 'dsh', JSON.parse(readFileSync(dshPkg, 'utf8')).bin?.dsh ?? 'lib/bin.js')
const skillsDir = join(root, 'out', 'skills')

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const s = createServer()
    s.on('error', reject)
    s.listen(0, HOST, () => {
      const p = s.address().port
      s.close((e) => (e ? reject(e) : resolvePort(p)))
    })
  })
}

function probe(port) {
  return new Promise((resolveStatus) => {
    const req = http.get({ host: HOST, port, path: '/', timeout: 2000 }, (res) => {
      res.resume()
      resolveStatus(res.statusCode ?? null)
    })
    req.on('error', () => resolveStatus(null))
    req.on('timeout', () => { req.destroy(); resolveStatus(null) })
  })
}

const port = await findFreePort()
const overlayArgs = OVERLAYS.flatMap((name) => {
  const p = join(homedir(), '.dsh', name)
  if (!existsSync(p)) throw new Error(`missing overlay ${p} — run scripts/check-bundled-plugins.js first`)
  return ['--patch', p]
})

console.log(`[smoke] spawning dsh web on ${HOST}:${port} with ${OVERLAYS.length} bundled plugin overlays`)
const child = spawn(nodeExe, [bin, 'web', ...overlayArgs, '--host', HOST, '--port', String(port)], {
  env: { ...process.env, DSH_BUNDLED_SKILL_DIR: skillsDir },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
let out = ''
child.stdout.on('data', (c) => { out += c })
child.stderr.on('data', (c) => { out += c })

const deadline = Date.now() + 120000
let ready = false
while (Date.now() < deadline) {
  if (child.exitCode !== null) break
  const status = await probe(port)
  if (status !== null && status >= 200 && status < 300) { ready = true; break }
  await delay(250)
}

if (ready) {
  console.log(`[smoke] READY http://${HOST}:${port}/`)
} else {
  console.log(`[smoke] NOT READY (exitCode=${child.exitCode})`)
  console.log(out.slice(-8000))
}

if (child.exitCode === null) {
  try { await execFile('taskkill', ['/PID', String(child.pid), '/T', '/F']) } catch {}
}
process.exit(ready ? 0 : 1)
