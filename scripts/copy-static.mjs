// Copy the static renderer pages, bundled skills, and assets into out/ so the
// packaged app and dev run resolve them from the same `app.getAppPath()/out`
// anchor. Missing sources are skipped, not fatal: renderer/skills/assets are
// created as their features land.
import { cp, mkdir, access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'out')

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

await mkdir(out, { recursive: true })

for (const dir of ['renderer', 'skills', 'assets']) {
  const src = join(root, dir)
  if (!(await exists(src))) {
    console.log(`[copy-static] skip missing ${dir}/`)
    continue
  }
  if (dir === 'assets') {
    // Source art is BUILD INPUT, not runtime content: pet-source/ (raw frames
    // consumed by prepare-pet-assets.mjs) and icon-source.png (consumed by
    // make-icons.mjs) must never ship inside the app.
    await cp(src, join(out, dir), {
      recursive: true,
      force: true,
      filter: (path) => path !== join(root, 'assets', 'pet-source') && path !== join(root, 'assets', 'icon-source.png'),
    })
  } else {
    await cp(src, join(out, dir), { recursive: true, force: true })
  }
  console.log(`[copy-static] ${dir}/ -> out/${dir}/`)
}
