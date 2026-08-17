#!/usr/bin/env node
/**
 * Session enumeration + deletion helper for the FISHCODE session-manager
 * window. Runs under the BUNDLED standalone Node (see node-runtime/) rather
 * than Electron's own Node 20: it needs `node:zlib`'s zstd builtins
 * (`zstdDecompressSync`), which shipped in Node 24 and are absent from the
 * Electron runtime. The helper is deliberately self-contained — it inlines the
 * zstd frame-scan loop from dsh-session-persistence-jsonl (same MIT origin)
 * instead of importing @deepseek-ai packages, so it never depends on the
 * dsh-bundle layout surviving packaging.
 *
 * The dsh backend writes each durable batch as one independent, checksummed
 * Zstandard frame appended to `session.jsonl.zstd`; a log is therefore a
 * sequence of frames that must each be decoded separately (a one-shot
 * zstdDecompressSync only returns the FIRST frame — verified against real
 * logs: a 23 KB session had 25 frames).
 *
 * Usage:
 *   node session-helper.mjs list
 *   node session-helper.mjs delete <abs-session-folder> [...]
 *
 * Output is a single JSON line on stdout; diagnostics go to stderr. Exit 0 on
 * success, 1 on any failure.
 */

import { zstdDecompressSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

const ZSTD_MAGIC = 4247762216 // 0xFD2FB528 little-endian
const ACTIVE_WINDOW_MS = 60_000 // log written in the last minute => likely live

/** Session home root (mirrors src/shared/paths.ts dshHome). */
function sessionsRoot() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
}

/**
 * Locate complete zstd frames without decompressing their blocks (adapted from
 * dsh-session-persistence-jsonl's scanZstdFrames). Returns ranges; an
 * incomplete final frame (crash tail) is silently dropped, never an error.
 */
function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) break
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid frame magic at byte ${offset}`)
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) break
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) break
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) break
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/**
 * Decode a whole compressed log: concatenate every complete frame's text.
 * A log that is unreadable as zstd (bad magic, torn header) returns a
 * `corrupt` marker instead of throwing — the session still shows up in the
 * list (as untitled) so the user can delete it, and one bad file never breaks
 * the whole enumeration.
 */
function decodeLog(folder) {
  const zstdPath = join(folder, 'session.jsonl.zstd')
  const plainPath = join(folder, 'session.jsonl')
  const stat = statSync(zstdPath, { throwIfNoEntry: false }) ?? statSync(plainPath, { throwIfNoEntry: false })
  if (!stat) return null
  const isZstd = statSync(zstdPath, { throwIfNoEntry: false }) !== undefined

  try {
    if (!isZstd) {
      return { text: readFileSync(plainPath, 'utf8'), bytes: stat.size, mtimeMs: stat.mtimeMs }
    }

    const buffer = readFileSync(zstdPath)
    let text = ''
    for (const frame of scanZstdFrames(buffer)) {
      try {
        text += zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8')
      } catch {
        // A frame with a bad checksum is a torn crash tail — keep the good ones.
      }
    }
    return { text, bytes: buffer.length, mtimeMs: stat.mtimeMs }
  } catch (error) {
    return { corrupt: true, bytes: stat.size, mtimeMs: stat.mtimeMs, error: String(error?.message ?? error) }
  }
}

/** Fold one session's metadata from its decoded JSONL (same rules dsh uses). */
function summarize(folder, scope) {
  const sessionId = basename(folder)
  const decoded = decodeLog(folder)
  if (decoded === null) return null

  if (decoded.corrupt) {
    // Unreadable log: surface it as an untitled session so it stays deletable.
    return {
      sessionId,
      scope,
      folder,
      title: null,
      createdAt: null,
      updatedAt: decoded.mtimeMs,
      mtimeMs: decoded.mtimeMs,
      active: false,
      eventCount: 0,
      fileBytes: decoded.bytes,
      corrupt: true,
      corruptReason: decoded.error,
    }
  }

  let header = null
  let title = null
  let firstUserText = null
  let lastTime = null
  let eventCount = 0

  for (const raw of decoded.text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    eventCount += 1
    if (header === null) header = record
    if (typeof record.time === 'number' && lastTime === null) lastTime = record.time
    if (record.type === 'session/title' && record.data && typeof record.data.title === 'string') {
      title = record.data.title
    }
    if (record.type === 'user/message' && firstUserText === null) {
      const content = record.data?.content
      if (Array.isArray(content)) {
        const text = content
          .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (text) firstUserText = text.slice(0, 80)
      }
    }
  }

  const active = Date.now() - decoded.mtimeMs < ACTIVE_WINDOW_MS
  return {
    sessionId,
    scope,
    folder,
    title: title ?? firstUserText ?? null,
    createdAt: header && typeof header.createdAt === 'number' ? header.createdAt : null,
    updatedAt: lastTime ?? decoded.mtimeMs,
    mtimeMs: decoded.mtimeMs,
    active,
    eventCount,
    fileBytes: decoded.bytes,
  }
}

/** Enumerate every session folder under the sessions root, per scope. */
function listSessions() {
  const root = sessionsRoot()
  const sessions = []
  let rootMissing = false
  let scopeDir = null
  try {
    scopeDir = readdirSync(root, { withFileTypes: true })
  } catch {
    rootMissing = true
  }
  if (!rootMissing) {
    for (const entry of scopeDir) {
      if (!entry.isDirectory() || !entry.name.startsWith('--')) continue
      const scopePath = join(root, entry.name)
      let sessionEntries
      try {
        sessionEntries = readdirSync(scopePath, { withFileTypes: true })
      } catch {
        continue
      }
      for (const session of sessionEntries) {
        if (!session.isDirectory() || !/^session-/.test(session.name)) continue
        const summary = summarize(join(scopePath, session.name), entry.name)
        if (summary) sessions.push(summary)
      }
    }
  }
  sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return { sessions }
}

/** Guard: a session folder must sit directly under the sessions root. */
function isSessionFolder(folder) {
  const root = resolve(sessionsRoot())
  const resolved = resolve(folder)
  const parent = resolve(join(resolved, '..'))
  if (parent !== root && !parent.startsWith(root + sep)) return false
  if (!/^session-[0-9A-Za-z-]+$/.test(basename(resolved))) return false
  return true
}

/** Delete the given session folders (paths validated by the caller, re-checked here). */
async function deleteSessions(folders) {
  const deleted = []
  const failed = []
  for (const folder of folders) {
    if (typeof folder !== 'string' || !isSessionFolder(folder)) {
      failed.push({ folder, reason: 'invalid-session-folder' })
      continue
    }
    try {
      await rm(folder, { recursive: true, force: true })
      deleted.push(folder)
    } catch (error) {
      failed.push({ folder, reason: String(error?.message ?? error) })
    }
  }
  return { deleted, failed }
}

const [command, ...args] = process.argv.slice(2)

if (command === 'list') {
  try {
    process.stdout.write(JSON.stringify(listSessions()))
  } catch (error) {
    process.stderr.write(`session-helper list failed: ${error?.message ?? error}\n`)
    process.exit(1)
  }
} else if (command === 'delete') {
  if (args.length === 0) {
    process.stderr.write('session-helper delete: no folders given\n')
    process.exit(1)
  }
  try {
    process.stdout.write(JSON.stringify(await deleteSessions(args)))
  } catch (error) {
    process.stderr.write(`session-helper delete failed: ${error?.message ?? error}\n`)
    process.exit(1)
  }
} else {
  process.stderr.write(`session-helper: unknown command "${command}" (expected list|delete)\n`)
  process.exit(1)
}
