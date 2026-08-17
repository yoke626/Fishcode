#!/usr/bin/env node
/**
 * FISHCODE vendored patch for @deepseek-ai/dsh-client-ui-workspace:
 *
 * dsh's session rows have no delete affordance — the three-dot menu only has
 * rename / fork / archive, and the backend has no session-delete RPC (the
 * host's persistence layer has no delete primitive either). FISHCODE owns
 * cleanup instead: the main process deletes the session folder on disk and
 * reloads the sidebar.
 *
 * To surface that behind the existing three-dot menu this patch makes three
 * small, surgical changes to the compiled row component (lib/client.js):
 *
 *  1. Stamp `data-session-id` onto both session-row variants (the sidebar
 *     tree row and the search-result flat row) so the DOM always carries the
 *     session id.
 *  2. Append a `delete` item to `sessionMenuItems` (the same item shape the
 *     workspace menu already uses for its delete row — trash icon, danger).
 *  3. Wire `onSelect("delete")` to the `window.fishcode.deleteSession`
 *     bridge that the FISHCODE main-window preload exposes; the main process
 *     confirms, deletes the folder via the bundled session-helper, and
 *     reloads the sidebar. `selected` is true when the row is the currently
 *     open session, so the shell can refuse that case.
 *
 * The patch is applied to the file IN PLACE. dsh serves each client plugin's
 * `lib/client.js` verbatim at `/plugins/<id>/client.js`, so the change takes
 * effect after the dsh backend restarts (no bundling step involved).
 *
 * Usage: node scripts/patch-session-delete.mjs
 *   Targets dsh-bundle/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js
 *
 * Idempotent: if a marker is already present the run is a no-op. Fails loudly
 * (non-zero exit) when any expected anchor is missing, so a bundle upgrade
 * that renames these internals surfaces instead of silently shipping a dead
 * menu item.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const clientPath = join(
  repoRoot,
  'dsh-bundle',
  'node_modules',
  '@deepseek-ai',
  'dsh-client-ui-workspace',
  'lib',
  'client.js',
)

const MARKER = '"data-session-id"' // any patch applied => this attribute exists

/** Apply one exact replacement; throws unless it matched exactly once. */
function replaceOnce(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1
  if (count === 0) throw new Error(`patch anchor not found: ${label}`)
  if (count > 1) throw new Error(`patch anchor not unique (${count}×): ${label}`)
  return source.replace(oldText, newText)
}

const PATCHES = [
  // 1a. Sidebar tree session row: stamp data-session-id.
  {
    label: 'session tree row',
    old: 'role: "treeitem",\n\t\t\t\t\t"aria-selected": selected,\n\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\tonOpen(node.id);\n\t\t\t\t\t},',
    new: 'role: "treeitem",\n\t\t\t\t\t"aria-selected": selected,\n\t\t\t\t\t"data-session-id": node.id,\n\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\tonOpen(node.id);\n\t\t\t\t\t},',
  },
  // 1b. Search-result flat row: same stamp (the delete item lives on the tree
  // row's menu, but keeping both rows stamped makes the data consistent).
  {
    label: 'search result row',
    old: 'role: "treeitem",\n\t\t\t\t"aria-selected": selected,\n\t\t\t\tonClick: () => {\n\t\t\t\t\tonOpen(result.id);\n\t\t\t\t},',
    new: 'role: "treeitem",\n\t\t\t\t"aria-selected": selected,\n\t\t\t\t"data-session-id": result.id,\n\t\t\t\tonClick: () => {\n\t\t\t\t\tonOpen(result.id);\n\t\t\t\t},',
  },
  // 2. Append the delete item to the session row menu (trash icon + danger,
  // the same shape dsh's own workspace delete row uses).
  {
    label: 'session menu items',
    old: 'icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })\n\t\t\t\t}\n\t\t\t];',
    new: 'icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })\n\t\t\t\t}, {\n\t\t\t\t\tid: "delete",\n\t\t\t\t\tlabel: "删除会话",\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),\n\t\t\t\t\tdanger: true\n\t\t\t\t}\n\t\t\t];',
  },
  // 3. Route the delete selection to the FISHCODE bridge. `selected` (this row
  // is the open session) and `row.title` are both in scope here.
  {
    label: 'session onSelect',
    old: '\t\t\t\t\t\t\t\tif (id === "archive") onArchive(node.id);',
    new: '\t\t\t\t\t\t\t\tif (id === "archive") onArchive(node.id);\n\t\t\t\t\t\t\t\tif (id === "delete") window.fishcode?.deleteSession(node.id, selected, row.title);',
  },
]

try {
  let source = readFileSync(clientPath, 'utf8')
  if (source.includes(MARKER)) {
    console.log('[patch-session-delete] already patched, no-op')
    process.exit(0)
  }
  for (const patch of PATCHES) {
    source = replaceOnce(source, patch.old, patch.new, patch.label)
  }
  writeFileSync(clientPath, source, 'utf8')
  console.log('[patch-session-delete] patched dsh-client-ui-workspace/lib/client.js')
} catch (error) {
  console.error(`[patch-session-delete] FAILED: ${error.message}`)
  process.exit(1)
}
