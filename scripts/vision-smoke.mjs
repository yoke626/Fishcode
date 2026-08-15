/**
 * Live smoke test for VisionService against a RUNNING dsh backend.
 *   node scripts/vision-smoke.mjs http://127.0.0.1:<port>/
 * Reads the real Zhipu key from ~/.dsh/.credentials.yaml (ZHIPU_API_KEY line),
 * runs getState + a real apply through the compiled VisionService, then the
 * wrong-key failure path, then restores the real key. Never prints the key.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { VisionService } = require('../out/main/main/vision-service.js')
const { parseVisionApplyRequest } = require('../out/main/shared/vision.js')

const baseUrl = process.argv[2]
if (!baseUrl) {
  console.error('usage: node scripts/vision-smoke.mjs http://127.0.0.1:<port>/')
  process.exit(2)
}

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`ok   ${name}`)
  else {
    failures++
    console.error(`FAIL ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`)
  }
}

// --- IPC validator ---------------------------------------------------------
const good = parseVisionApplyRequest({ rawKey: '  sk-abc  ', presetId: 'zhipu' })
check('validator: zhipu request ok', good !== null && good.rawKey === 'sk-abc' && good.custom === undefined)
check('validator: rejects empty key', parseVisionApplyRequest({ rawKey: '   ', presetId: 'zhipu' }) === null)
check('validator: rejects control chars', parseVisionApplyRequest({ rawKey: 'sk\nx', presetId: 'zhipu' }) === null)
check('validator: rejects long key', parseVisionApplyRequest({ rawKey: 'k'.repeat(513), presetId: 'zhipu' }) === null)
check('validator: rejects unknown preset', parseVisionApplyRequest({ rawKey: 'sk', presetId: 'gemini' }) === null)
check(
  'validator: custom request ok',
  JSON.stringify(
    parseVisionApplyRequest({
      rawKey: 'sk',
      presetId: 'custom',
      custom: { baseUrl: ' https://x/v1/ ', model: ' m ', protocol: 'openai' },
    }),
  ) === JSON.stringify({ rawKey: 'sk', presetId: 'custom', custom: { baseUrl: 'https://x/v1/', model: 'm', protocol: 'openai' } }),
)
check(
  'validator: rejects custom without provider',
  parseVisionApplyRequest({ rawKey: 'sk', presetId: 'custom' }) === null,
)

// --- read the real Zhipu key (never printed) --------------------------------
const credentialsText = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
const keyMatch = /^ZHIPU_API_KEY:\s*['"]?([^'"#\r\n]+)['"]?/m.exec(credentialsText)
if (!keyMatch) {
  console.error('FAIL could not read ZHIPU_API_KEY from ~/.dsh/.credentials.yaml')
  process.exit(1)
}
const realKey = keyMatch[1].trim()

// --- live service -----------------------------------------------------------
const service = new VisionService({
  getBaseUrl: () => baseUrl,
  getBackendState: () => 'ready',
})

const state = await service.getState()
console.log(`state: ${JSON.stringify(state)}`)
check('getState: available', state.available === true)
check('getState: configured', state.configured === true)
check('getState: currentProvider', state.currentProvider === 'zhipu' || state.currentProvider === 'custom')

const result = await service.apply({ rawKey: realKey, presetId: 'zhipu' })
console.log(`apply(real key): ${JSON.stringify(result)}`)
check('apply: ok', result.ok === true)
check('apply: healthy', result.healthy === true)
check('apply: service ok', result.serviceStatus === 'ok' || result.serviceStatus === 'warning')

// --- wrong-key failure path, then restore -----------------------------------
const wrongKey = 'sk-not-a-real-key-12345'
const wrong = await service.apply({ rawKey: wrongKey, presetId: 'zhipu' })
console.log(`apply(wrong key): ${JSON.stringify(wrong)}`)
check('apply: wrong key fails', wrong.ok === false)
check('apply: wrong key code', wrong.code === 'key-rejected' || wrong.code === 'credential-missing')

const restore = await service.apply({ rawKey: realKey, presetId: 'zhipu' })
console.log(`apply(restore): ${JSON.stringify(restore)}`)
check('apply: restore ok', restore.ok === true)

const finalText = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
const visionLines = finalText.split(/\r\n|\n/).filter((l) => /^VISION_API_KEY\s*:/.test(l))
check('credentials: exactly one VISION_API_KEY line', visionLines.length === 1)
check('credentials: value is the real key', visionLines[0]?.includes("'") && visionLines[0].length > 30)
check('credentials: ZHIPU line untouched', /^ZHIPU_API_KEY:/m.test(finalText))

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('vision smoke test passed')
