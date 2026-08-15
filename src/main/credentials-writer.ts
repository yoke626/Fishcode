/**
 * Writer for $DSH_HOME/.credentials.yaml — FISHCODE owns exactly one entry:
 * the VISION_API_KEY credential reference the vision-toolkit plugin reads.
 *
 * The file is parsed by dsh-credentials-local as a strict YAML document with
 * `uniqueKeys: true`: a duplicate key or a corrupt document fails plugin
 * activation at the next backend boot. The writer therefore follows a
 * replace-or-refuse rule:
 *   - the key line (plain or quoted ref, top level only) is replaced in place;
 *   - block-scalar values and duplicate occurrences are refused outright;
 *   - appending happens only when the key is verified absent at the top level;
 *   - everything else in the document is preserved byte-for-byte, so a
 *     previously valid document stays valid.
 *
 * The raw key is never logged. Writes are atomic (same-directory tmp file +
 * rename, which replaces on Windows) and verified by re-reading once.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from '../shared/paths'
import { VISION_CREDENTIAL_REF } from '../shared/vision'

const CREDENTIALS_FILENAME = '.credentials.yaml'
// Top-level key line only: zero leading whitespace, optional quoting of the ref.
const KEY_LINE_RE = /^(VISION_API_KEY|['"]VISION_API_KEY['"])\s*:/

export class CredentialWriteError extends Error {
  constructor(public readonly code: 'unsafe' | 'failed') {
    super(code)
    this.name = 'CredentialWriteError'
  }
}

export function writeCredentialKey(rawKey: string): void {
  const file = join(dshHome(), CREDENTIALS_FILENAME)
  const escaped = `'${rawKey.replace(/'/g, "''")}'`
  const line = `${VISION_CREDENTIAL_REF}: ${escaped}`

  try {
    mkdirSync(dshHome(), { recursive: true })
  } catch {
    throw new CredentialWriteError('failed')
  }

  // Write-verify loop: dsh's own writer can interleave (it patches under a
  // cross-process lock), so re-read after rename and retry once if our line
  // is not exactly present. A persistently lost write surfaces later as
  // `credential-missing` via the health check — never as a corrupt document.
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CredentialWriteError('failed')
      text = ''
    }

    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const lines = text.split(/\r\n|\n/)
    const keyIndexes: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (KEY_LINE_RE.test(lines[i])) keyIndexes.push(i)
    }

    if (keyIndexes.length > 1) throw new CredentialWriteError('unsafe') // already violates uniqueKeys
    if (keyIndexes.length === 1) {
      const valueTail = lines[keyIndexes[0]].replace(/^[^:]*:\s*/, '')
      if (/^[>|]/.test(valueTail)) throw new CredentialWriteError('unsafe') // block scalar — orphans would follow
      lines[keyIndexes[0]] = line
      text = lines.join(eol)
    } else {
      if (text !== '' && !text.endsWith('\n')) text += eol
      text += line + eol
    }

    try {
      const tmp = `${file}.fishcode-${process.pid}.tmp`
      writeFileSync(tmp, text, { mode: 0o600 })
      renameSync(tmp, file) // same directory = same volume; replaces on Windows
    } catch {
      throw new CredentialWriteError('failed')
    }

    const verifyLines = readFileSync(file, 'utf8').split(/\r\n|\n/)
    if (verifyLines.some((l) => l === line)) {
      console.log(`[Fishcode] vision credential written: ${file}`)
      return
    }
  }
  // Verified-lost after one retry: report through health instead of lying.
  console.error(`[Fishcode] vision credential write could not be verified: ${file}`)
}
