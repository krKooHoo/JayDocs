// `npm run shortcuts` — src/lib/shortcuts-table.mjs 에서 SHORTCUTS.md 를 만든다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderShortcutsMarkdown } from '../src/lib/shortcuts-table.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, '..', 'SHORTCUTS.md')
fs.writeFileSync(out, renderShortcutsMarkdown(), 'utf8')
console.log('wrote', out)
