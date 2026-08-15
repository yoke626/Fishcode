/**
 * Scratch edge-case tests for the .credentials.yaml writer. Points DSH_HOME at
 * a fresh temp dir and exercises the compiled writer directly:
 *   node scripts/test-cred-writer.mjs   (after `npm run build`)
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { writeCredentialKey, CredentialWriteError } = require('../out/main/main/credentials-writer.js')

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`ok   ${name}`)
  else {
    failures++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const root = mkdtempSync(join(tmpdir(), 'fishcode-cred-'))
process.env.DSH_HOME = root
const file = join(root, '.credentials.yaml')
const read = () => readFileSync(file, 'utf8')

// 1. missing file -> created with one line
writeCredentialKey('sk-abc123')
check('missing file created', read() === "VISION_API_KEY: 'sk-abc123'\n", JSON.stringify(read()))

// 2. existing value with a quote -> replaced, '' escape intact, other keys kept
writeFileSync(file, "DEEPSEEK_API_KEY: sk-other\nVISION_API_KEY: 'old''key' # comment\n", 'utf8')
writeCredentialKey("new'key")
check(
  'quoted value replaced + escaped',
  read().includes("VISION_API_KEY: 'new''key'\n") && read().includes('DEEPSEEK_API_KEY: sk-other'),
  JSON.stringify(read()),
)

// 3. quoted ref name -> replaced
writeFileSync(file, '"VISION_API_KEY": x\n', 'utf8')
writeCredentialKey('sk-z')
check('quoted ref replaced', read() === "VISION_API_KEY: 'sk-z'\n", JSON.stringify(read()))

// 4. CRLF file -> EOL preserved and used for the append
writeFileSync(file, 'A: 1\r\nB: 2\r\n', 'utf8')
writeCredentialKey('sk-crlf')
check('CRLF preserved', read() === "A: 1\r\nB: 2\r\nVISION_API_KEY: 'sk-crlf'\r\n", JSON.stringify(read()))

// 5. no trailing newline -> newline added before append
writeFileSync(file, 'A: 1', 'utf8')
writeCredentialKey('sk-nonl')
check('newline added before append', read() === "A: 1\nVISION_API_KEY: 'sk-nonl'\n", JSON.stringify(read()))

// 6. block scalar value -> refused
writeFileSync(file, 'VISION_API_KEY: |\n  line1\n', 'utf8')
let unsafe = false
try {
  writeCredentialKey('sk-x')
} catch (e) {
  unsafe = e instanceof CredentialWriteError && e.code === 'unsafe'
}
check('block scalar refused', unsafe)

// 7. duplicate keys -> refused
writeFileSync(file, "VISION_API_KEY: a\n'VISION_API_KEY': b\n", 'utf8')
unsafe = false
try {
  writeCredentialKey('sk-x')
} catch (e) {
  unsafe = e instanceof CredentialWriteError && e.code === 'unsafe'
}
check('duplicate keys refused', unsafe)

// 8. nested indented key -> untouched, top-level appended
writeFileSync(file, 'other:\n  VISION_API_KEY: nested\n', 'utf8')
writeCredentialKey('sk-top')
check(
  'nested untouched, top-level appended',
  read() === "other:\n  VISION_API_KEY: nested\nVISION_API_KEY: 'sk-top'\n",
  JSON.stringify(read()),
)

// 9. inline trailing comment on target line dropped, other lines byte-identical
writeFileSync(file, 'KEEP: 1 # keep me\nVISION_API_KEY: old # drop me\nKEEP2: 2\n', 'utf8')
writeCredentialKey('sk-comm')
check(
  'inline comment dropped on target line only',
  read() === "KEEP: 1 # keep me\nVISION_API_KEY: 'sk-comm'\nKEEP2: 2\n",
  JSON.stringify(read()),
)

rmSync(root, { recursive: true, force: true })
if (failures > 0) {
  console.error(`${failures} test(s) failed`)
  process.exit(1)
}
console.log('all credential-writer tests passed')
