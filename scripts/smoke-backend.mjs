// Temporary smoke test: boot the bundled dsh web backend and report readiness.
import { spawn, execFile } from 'node:child_process'
import { createServer } from 'node:net'
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

const BIN = new URL('../dsh-bundle/node_modules/@deepseek-ai/dsh/lib/bin.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const HOST = '127.0.0.1'

function findFreePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.on('error', reject)
    s.listen(0, HOST, () => {
      const p = s.address().port
      s.close((e) => (e ? reject(e) : resolve(p)))
    })
  })
}

function probe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: '/', timeout: 2000 }, (res) => {
      res.resume()
      resolve(res.statusCode ?? null)
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

const port = await findFreePort()
console.log(`[smoke] spawning dsh web on ${HOST}:${port}`)
const child = spawn(process.execPath, [BIN, 'web', '--host', HOST, '--port', String(port)], {
  env: { ...process.env, DSH_BUNDLED_SKILL_DIR: new URL('../out/skills', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let out = ''
child.stdout.on('data', (c) => { out += c })
child.stderr.on('data', (c) => { out += c })

const deadline = Date.now() + 45000
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
  console.log(out.slice(-4000))
}

// teardown
if (child.exitCode === null) {
  try { await execFile('taskkill', ['/PID', String(child.pid), '/T', '/F']) } catch {}
}
process.exit(ready ? 0 : 1)
