/**
 * FISHCODE vendored patches for @anionex/dsh-vision-toolkit:
 *
 * 1. Python snapshot (vendor/agent-vision-toolkit): the upstream vision
 *    client hard-codes max_tokens 4096/8192, but free vision providers in
 *    reach of Chinese users cap output tokens much lower (e.g. Zhipu
 *    GLM-4V-Flash rejects anything above 1024 with HTTP 400 [1210], so every
 *    remote vision tool fails). The plugin exposes no max_tokens setting.
 *    Fix: clamp max_tokens to 1024 in vision_client.describe_image (one place
 *    covers glance/ground/detect and all protocols), then regenerate
 *    UPSTREAM_MANIFEST.json so the plugin's own hash verification (which runs
 *    on every backend start and every settings save) still passes.
 *
 * 2. Web client (lib/client.js): the plugin intercepts PASTED images in
 *    capture phase and serializes them as text references that resolve to
 *    local file paths (the paste-images upload route). Dropped images are NOT
 *    intercepted, so DSH's own drop handler sends them as inline image
 *    content — which text-only models (deepseek-chat) reject with "does not
 *    support image content". Fix: intercept `drop` in capture phase the same
 *    way and feed the files through the exact same reference pipeline, so
 *    dragging an image into the composer behaves like pasting it. DSH also
 *    arms a full-page drop overlay ("图片拖动到此处即可添加") from document
 *    dragenter/dragover and dismisses it from its own drop handler — since
 *    our interception stops that handler, the overlay would stay stuck. So
 *    the patch additionally suppresses dragenter/dragover in capture phase
 *    while files are dragged (overlay never appears) and dispatches a
 *    synthetic `dragend` after intercepting (dismiss any lingering overlay).
 *
 * 3. Web client (lib/client.js): Zhipu GLM-4V-Flash rejects any image over
 *    5 MB with HTTP 400 [1210] "API 调用参数有误" — and the plugin's own
 *    default caps (20 MB client / 10 MB server) exceed that, so oversized
 *    images sail through every local check and die remotely with a cryptic
 *    error (measured: a 6.98 MB PNG fails, the same image compressed to
 *    1.9 MB passes). The plugin never compresses, so fix it at the single
 *    upload funnel both paste and drop feed into: wrap PasteImageController.
 *    upload to re-encode oversized files in-browser (canvas, PNG first for
 *    screenshots/text, JPEG fallback, long edge capped at 2048 px) with the
 *    extension renamed to match the encoding (the toolkit verifies extension
 *    ↔ decoded format). The threshold is PROVIDER-AWARE: the configured
 *    server-side maxImageBytes is read fresh from the toolkit's own settings
 *    route at send time, so providers with generous caps (custom setups at
 *    10/20 MB) keep receiving images untouched — only files that would be
 *    rejected locally anyway get compressed.
 *
 * Usage: node scripts/patch-vision-vendor.mjs [vendorRoot]
 *   vendorRoot defaults to <repo>/dsh-bundle/node_modules/@anionex/
 *   dsh-vision-toolkit/vendor/agent-vision-toolkit (the web client is found
 *   relative to it).
 *
 * Idempotent. Re-run after `npm ci` in dsh-bundle (npm re-extracts the
 * pristine tarball) and after updating @anionex/dsh-vision-toolkit.
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultVendor = join(
  repoRoot,
  'dsh-bundle',
  'node_modules',
  '@anionex',
  'dsh-vision-toolkit',
  'vendor',
  'agent-vision-toolkit',
)
const vendorRoot = resolve(process.argv[2] ?? defaultVendor)

const MAX_TOKENS = 1024
const CLIENT_PATH = join(vendorRoot, 'vision_client.py')
const MANIFEST_PATH = join(vendorRoot, 'UPSTREAM_MANIFEST.json')
// vendorRoot is .../dsh-vision-toolkit/vendor/agent-vision-toolkit; the web
// client is two levels up in lib/client.js (same package).
const WEB_CLIENT_PATH = resolve(vendorRoot, '..', '..', 'lib', 'client.js')

function exists(path) {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

// Anchors and snippets are written with \n and re-joined with the file's own
// EOL so the patch works whether the vendored bundle uses LF or CRLF.
function eolify(text, eol) {
  return eol === '\n' ? text : text.split('\n').join(eol)
}

/**
 * handleDrop mirrors handlePaste minus the clipboard-text insertion: dropped
 * files go through the exact same validateImages + insertRecords pipeline, so
 * dragging an image into the composer produces the same path reference as
 * pasting it. DSH accepts full-page drops, so the drop may land anywhere:
 * the card is resolved from event.target, falling back to the composer
 * textarea. After interception a synthetic `dragend` is dispatched on window —
 * DSH hides its full-page drop overlay from its own drop/dragend handlers,
 * which the stopImmediatePropagation below just bypassed (without this the
 * overlay stays stuck on screen).
 */
const HANDLE_DROP_V2_SNIPPET = `    handleDrop(event) {
        const files = imageFiles(event.dataTransfer);
        if (files.length === 0)
            return false;
        const droppedOn = event.target;
        let target = droppedOn instanceof HTMLElement
            ? (droppedOn.closest('[data-composer-card]')?.querySelector('textarea') ?? null)
            : null;
        if (target === null)
            target = document.querySelector('[data-composer-card] textarea') ?? null;
        if (target === null)
            return false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        window.dispatchEvent(new Event('dragend'));
        const sessionId = this.ctx.sessions.list.getSnapshot().current;
        if (sessionId === undefined)
            return true;
        const input = this.inputFor(sessionId);
        const snapshot = input.state.getSnapshot();
        if (snapshot.phase !== 'plain')
            return true;
        const start = Math.max(0, Math.min(target.selectionStart ?? snapshot.draft.length, snapshot.draft.length));
        try {
            validateImages(files);
            const cursor = this.insertRecords(String(sessionId), input, files, start);
            requestAnimationFrame(() => {
                target.focus({ preventScroll: true });
                target.setSelectionRange(cursor, cursor);
            });
        }
        catch (error) {
            input.notify('error', message(error));
        }
        return true;
    }
`

// The first version of the drop patch (no overlay handling) — kept only so an
// already-patched checkout upgrades in place instead of needing a fresh
// `npm ci` in dsh-bundle.
const HANDLE_DROP_V1_SNIPPET = `    handleDrop(event) {
        const files = imageFiles(event.dataTransfer);
        if (files.length === 0)
            return false;
        const droppedOn = event.target;
        const card = droppedOn instanceof HTMLElement
            ? droppedOn.closest('[data-composer-card]')
            : null;
        const target = card === null ? null : (card.querySelector('textarea') ?? null);
        if (card === null || target === null)
            return false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const sessionId = this.ctx.sessions.list.getSnapshot().current;
        if (sessionId === undefined)
            return true;
        const input = this.inputFor(sessionId);
        const snapshot = input.state.getSnapshot();
        if (snapshot.phase !== 'plain')
            return true;
        const start = Math.max(0, Math.min(target.selectionStart ?? snapshot.draft.length, snapshot.draft.length));
        try {
            validateImages(files);
            const cursor = this.insertRecords(String(sessionId), input, files, start);
            requestAnimationFrame(() => {
                target.focus({ preventScroll: true });
                target.setSelectionRange(cursor, cursor);
            });
        }
        catch (error) {
            input.notify('error', message(error));
        }
        return true;
    }
`

const HANDLE_DROP_V2_MARKER = "window.dispatchEvent(new Event('dragend'))"
const HANDLE_DROP_V1_MARKER = 'const card = droppedOn instanceof HTMLElement'

/**
 * Capture-effect replacement: pristine paste interception plus the drop
 * interception and the dragenter/dragover suppression that keeps DSH's
 * full-page drop overlay out of the way while files are dragged (mirrors
 * DSH's own `types.includes('Files')` condition — file lists are not
 * populated on dragenter, so only the types flag is reliable there).
 */
const DROP_EFFECT_V2_SNIPPET = `    ctx.effect(() => {
        const listener = (event) => { controller.handlePaste(event); };
        document.addEventListener('paste', listener, true);
        // FISHCODE vendored patch: capture image-file drops AND the dragenter/
        // dragover that arm DSH's full-page drop overlay. Dropped images go
        // through the same path-reference pipeline as paste; suppressing the
        // overlay keeps it from appearing (and getting stuck) at all.
        const dropListener = (event) => { controller.handleDrop(event); };
        document.addEventListener('drop', dropListener, true);
        const dragListener = (event) => {
            if (!(event.dataTransfer?.types.includes('Files') ?? false))
                return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (event.dataTransfer !== null)
                event.dataTransfer.dropEffect = 'copy';
        };
        document.addEventListener('dragenter', dragListener, true);
        document.addEventListener('dragover', dragListener, true);
        return () => {
            document.removeEventListener('paste', listener, true);
            document.removeEventListener('drop', dropListener, true);
            document.removeEventListener('dragenter', dragListener, true);
            document.removeEventListener('dragover', dragListener, true);
        };
    }, 'dsh-vision-toolkit: clipboard image capture');`

const DROP_EFFECT_V1_SNIPPET = `    ctx.effect(() => {
        const listener = (event) => { controller.handlePaste(event); };
        document.addEventListener('paste', listener, true);
        // FISHCODE vendored patch: capture DROPPED images too, so dragging a
        // picture into the composer becomes a path reference (same pipeline
        // as paste) instead of an inline attachment text-only models reject.
        const dropListener = (event) => { controller.handleDrop(event); };
        document.addEventListener('drop', dropListener, true);
        return () => {
            document.removeEventListener('paste', listener, true);
            document.removeEventListener('drop', dropListener, true);
        };
    }, 'dsh-vision-toolkit: clipboard image capture');`

const DROP_EFFECT_V2_MARKER = 'const dragListener = (event) =>'
const DROP_EFFECT_V1_MARKER = 'const dropListener = (event) =>'

const PRISTINE_DROP_EFFECT = `    ctx.effect(() => {
        const listener = (event) => { controller.handlePaste(event); };
        document.addEventListener('paste', listener, true);
        return () => { document.removeEventListener('paste', listener, true); };
    }, 'dsh-vision-toolkit: clipboard image capture');`

/**
 * Upload-funnel wrap (paste AND drop both serialize through upload()): files
 * over the provider's configured cap are re-encoded in-browser before the
 * POST. PNG first — screenshots and text stay sharp and usually shrink hard —
 * with a JPEG fallback for photos; if neither helps, the original bytes go
 * through (never a regression). The extension is renamed to match the
 * re-encoded content because the toolkit rejects extension/content
 * mismatches.
 */
const UPLOAD_WRAP_V4_SNIPPET = `
const DVT_UPLOAD_SETTINGS_ROUTE = '/_dsh/vision-toolkit/settings';
const DVT_UPLOAD_LONG_EDGE = 4096;
// FISHCODE vendored patch (3/3): compress oversized images before upload.
// The threshold is the vision provider's configured server-side cap
// (vision-toolkit maxImageBytes), read fresh from the toolkit's own settings
// route at send time: providers that accept large images (custom setups with
// a 10/20 MB cap) get files through untouched, while providers with a hard
// limit below that (Zhipu GLM-4V-Flash: 5 MB, HTTP 400 [1210] above it) get
// re-encoded under it. Only files the server would reject locally anyway
// are compressed.
async function dvtUploadCapBytes() {
    try {
        const response = await fetch(DVT_UPLOAD_SETTINGS_ROUTE, { credentials: 'same-origin' });
        const body = await response.json();
        const raw = body?.value?.settings?.value?.maxImageBytes;
        if (Number.isInteger(raw) && raw > 0)
            return raw;
    }
    catch {
        // fall through to the plugin default
    }
    return 10 * 1024 * 1024;
}
async function dvtEncodeImage(bitmap, scale, target) {
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (context === null)
        throw new Error('2d canvas unavailable');
    context.drawImage(bitmap, 0, 0, width, height);
    let blob = await canvas.convertToBlob({ type: 'image/png' });
    let extension = 'png';
    for (const quality of [0.85, 0.6]) {
        if (blob.size <= target)
            break;
        blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        extension = 'jpg';
    }
    return { blob, extension };
}
async function dvtCompressFile(file, cap) {
    if (file.size <= cap)
        return file;
    if (!/^image\\/(png|jpe?g|bmp|webp)$/i.test(file.type))
        return file;
    const target = Math.max(1, Math.floor(cap * 0.9));
    try {
        const bitmap = await createImageBitmap(file);
        const longest = Math.max(bitmap.width, bitmap.height);
        // Native resolution first: only files a full-size re-encode cannot
        // fit under the cap get downscaled (halved until they do).
        let scale = Math.min(1, DVT_UPLOAD_LONG_EDGE / longest);
        let result = await dvtEncodeImage(bitmap, scale, target);
        while (result.blob.size > target && scale > 0.05) {
            scale *= 0.5;
            result = await dvtEncodeImage(bitmap, scale, target);
        }
        if (result.blob.size >= file.size)
            return file;
        const base = (file.name || 'clipboard-image').replace(/\\.(png|jpe?g|webp|bmp|gif)$/i, '');
        return new File([result.blob], \`\${base}-compressed.\${result.extension}\`, { type: result.blob.type });
    }
    catch {
        return file;
    }
}
const dvtOriginalUpload = PasteImageController.prototype.upload;
PasteImageController.prototype.upload = async function (batch, signal) {
    const pending = batch.records.filter((record) => record.absolutePath === undefined);
    const cap = await dvtUploadCapBytes();
    await Promise.all(pending.map(async (record) => {
        if (record.file !== undefined && record.__dvtCompressed !== true) {
            record.file = await dvtCompressFile(record.file, cap);
            record.__dvtCompressed = true;
        }
    }));
    return dvtOriginalUpload.call(this, batch, signal);
};`

// Idempotency marker of the CURRENT upload-wrap block (provider-aware cap +
// native-resolution-first re-encode). Older block shapes carry no version
// marker; their start lines are matched below and the whole block is
// stripped and re-inserted, so no full historical copies live here.
const UPLOAD_WRAP_MARKER = 'async function dvtEncodeImage'
const UPLOAD_WRAP_V3_START = 'const DVT_UPLOAD_SOFT_CAP = 4 * 1024 * 1024;'
const UPLOAD_WRAP_V4_START = 'const DVT_UPLOAD_SETTINGS_ROUTE'

function patchWebClient() {
  if (!exists(WEB_CLIENT_PATH)) {
    console.log(`[patch-vision-vendor] web client not present at ${WEB_CLIENT_PATH}; skipping (run after dsh-bundle npm ci)`)
    return
  }
  let source = readFileSync(WEB_CLIENT_PATH, 'utf8')
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  let changed = false

  // 1) handleDrop method — insert before PasteImageController.remove, or
  //    upgrade the v1 drop patch (no overlay handling) in place.
  if (!source.includes(HANDLE_DROP_V2_MARKER)) {
    if (source.includes(HANDLE_DROP_V1_MARKER)) {
      const v1 = eolify(HANDLE_DROP_V1_SNIPPET, eol)
      if (!source.includes(v1)) {
        throw new Error(`v1 handleDrop body not found in ${WEB_CLIENT_PATH}; hand-check the vendored file`)
      }
      source = source.replace(v1, eolify(HANDLE_DROP_V2_SNIPPET, eol))
      changed = true
    } else {
      const anchor = '    remove(sessionId, occurrence) {'
      if (!source.includes(anchor)) {
        throw new Error(`patch anchor (PasteImageController.remove) not found in ${WEB_CLIENT_PATH}; @anionex/dsh-vision-toolkit may have changed`)
      }
      source = source.replace(anchor, eolify(HANDLE_DROP_V2_SNIPPET, eol) + anchor)
      changed = true
    }
  }

  // 2) Capture listeners — add drop + drag suppression next to the paste
  //    listener, or upgrade the v1 drop-only listener block in place.
  if (!source.includes(DROP_EFFECT_V2_MARKER)) {
    if (source.includes(DROP_EFFECT_V1_MARKER)) {
      const v1 = eolify(DROP_EFFECT_V1_SNIPPET, eol)
      if (!source.includes(v1)) {
        throw new Error(`v1 drop listener block not found in ${WEB_CLIENT_PATH}; hand-check the vendored file`)
      }
      source = source.replace(v1, eolify(DROP_EFFECT_V2_SNIPPET, eol))
      changed = true
    } else {
      const anchor = eolify(PRISTINE_DROP_EFFECT, eol)
      if (!source.includes(anchor)) {
        throw new Error(`patch anchor (paste capture listener) not found in ${WEB_CLIENT_PATH}; @anionex/dsh-vision-toolkit may have changed`)
      }
      source = source.replace(anchor, eolify(DROP_EFFECT_V2_SNIPPET, eol))
      changed = true
    }
  }

  // 3) Upload funnel — compress files over the provider's configured cap
  //    in-browser before the POST: providers with a hard image limit (Zhipu
  //    GLM-4V-Flash, 5 MB) never see 1210, and providers with generous caps
  //    keep receiving images untouched. Any earlier block (v3 hardcoded 4 MB
  //    soft cap, v4 unconditional downscale) is stripped whole and replaced
  //    by the current one.
  if (!source.includes(UPLOAD_WRAP_MARKER)) {
    const anchor = 'exports.PasteImageController = PasteImageController;'
    if (!source.includes(anchor)) {
      throw new Error(`patch anchor (PasteImageController export) not found in ${WEB_CLIENT_PATH}; @anionex/dsh-vision-toolkit may have changed`)
    }
    const v3Start = source.indexOf(UPLOAD_WRAP_V3_START)
    const v4Start = source.indexOf(UPLOAD_WRAP_V4_START)
    const start = v3Start >= 0 ? v3Start : v4Start
    if (start < 0) {
      source = source.replace(anchor, anchor + eol + eolify(UPLOAD_WRAP_V4_SNIPPET, eol))
    } else {
      // The block runs from its first const to the module-scope close of the
      // upload override ('};' on its own line).
      const wrapMark = source.indexOf('const dvtOriginalUpload = PasteImageController.prototype.upload', start)
      const end = wrapMark >= 0 ? source.indexOf(eol + '};', wrapMark) : -1
      if (end < 0) {
        throw new Error(`existing upload-wrap block not recognized in ${WEB_CLIENT_PATH}; hand-check the vendored file`)
      }
      source = source.slice(0, start) + eolify(UPLOAD_WRAP_V4_SNIPPET, eol).trim() + source.slice(end + eol.length + '};'.length)
    }
    changed = true
  }

  if (changed) {
    writeFileSync(WEB_CLIENT_PATH, source, 'utf8')
    console.log(`[patch-vision-vendor] patched ${WEB_CLIENT_PATH}`)
  } else {
    console.log(`[patch-vision-vendor] ${WEB_CLIENT_PATH} already patched`)
  }
}

// Web client patch is independent of the Python snapshot: run it first.
patchWebClient()

if (!exists(CLIENT_PATH) || !exists(MANIFEST_PATH)) {
  console.log(`[patch-vision-vendor] python snapshot not present at ${vendorRoot}; skipping (run after dsh-bundle npm ci)`)
  process.exit(0)
}

const CLAMP_SNIPPET = `    # FISHCODE vendored patch: cap max_tokens at ${MAX_TOKENS} so providers with
    # tight output limits (e.g. Zhipu GLM-4V-Flash, [1,1024]) accept every
    # tool call. The tools' structured outputs are short, so ${MAX_TOKENS} is ample.
    max_tokens = min(max_tokens if max_tokens is not None else 4096, ${MAX_TOKENS})\n`

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function patchClient() {
  let source = readFileSync(CLIENT_PATH, 'utf8')
  if (source.includes('FISHCODE vendored patch')) {
    console.log(`[patch-vision-vendor] ${CLIENT_PATH} already patched`)
    return
  }
  const anchor = '    """Describe one data/http image URL (str) or several (list) in a single call."""\n    validate_vision_config()\n'
  if (!source.includes(anchor)) {
    throw new Error(`patch anchor not found in ${CLIENT_PATH}; @anionex/dsh-vision-toolkit may have changed upstream snapshot`)
  }
  source = source.replace(anchor, anchor + CLAMP_SNIPPET)
  writeFileSync(CLIENT_PATH, source, 'utf8')
  console.log(`[patch-vision-vendor] patched ${CLIENT_PATH}`)
}

function regenerateManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${MANIFEST_PATH} has no file list`)
  }
  const rows = []
  for (const entry of manifest.files) {
    const bytes = readFileSync(join(vendorRoot, ...entry.path.split('/')))
    entry.bytes = bytes.length
    entry.sha256 = sha256(bytes)
    rows.push(`${entry.path}\0${entry.sha256}\n`)
  }
  manifest.contentSha256 = sha256(rows.join(''))
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`[patch-vision-vendor] regenerated ${MANIFEST_PATH} (${manifest.files.length} files, content ${manifest.contentSha256.slice(0, 16)}…)`)
}

patchClient()
regenerateManifest()
