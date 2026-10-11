import { useEffect, useMemo, useRef, useState } from 'react'
import type { GitCode, TreeEntry } from '../lib/backend'

interface Props {
  entries: TreeEntry[]
  activePath: string | null
  dirtyPaths: Set<string>
  gitStatus: Map<string, GitCode>
  onOpen: (path: string) => void
  onNewFile: (dir: string) => void
  onNewFolder: (dir: string) => void
  onRename: (path: string, isDir: boolean) => void
  onDelete: (path: string, isDir: boolean) => void
  onRefresh: () => void
}

interface Menu {
  x: number
  y: number
  path: string
  isDir: boolean
}

interface FlatRow {
  entry: TreeEntry
  depth: number
  parent: string
}

function allDirs(entries: TreeEntry[], out: string[] = []) {
  for (const e of entries) if (e.type === 'dir') { out.push(e.path); allDirs(e.children ?? [], out) }
  return out
}

function fileIcon(name: string) {
  if (/\.tsv$/i.test(name)) return '⊞'
  if (/\.md$/i.test(name)) return '≡'
  return '·'
}

function dirHasChange(dir: string, status: Map<string, GitCode>) {
  const prefix = dir + '/'
  for (const p of status.keys()) if (p.startsWith(prefix)) return true
  return false
}

function parentOf(path: string) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

/** 펼친 상태대로 평평하게 — 키보드 이동은 이 순서를 따른다 */
function flatten(entries: TreeEntry[], expanded: Set<string>, depth = 0, parent = '', out: FlatRow[] = []): FlatRow[] {
  for (const e of entries) {
    out.push({ entry: e, depth, parent })
    if (e.type === 'dir' && expanded.has(e.path)) flatten(e.children ?? [], expanded, depth + 1, e.path, out)
  }
  return out
}

export function FileTree(p: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selectedDir, setSelectedDir] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [menu, setMenu] = useState<Menu | null>(null)
  /** 키보드 커서 (경로) */
  const [cursor, setCursor] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)

  // 처음 트리가 오면 전부 펼친다. 그 뒤로는 사용자가 접은 상태를 유지.
  useEffect(() => {
    if (!initialized && p.entries.length) { setExpanded(new Set(allDirs(p.entries))); setInitialized(true) }
  }, [p.entries, initialized])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onKey); window.removeEventListener('blur', close) }
  }, [menu])

  const rows = useMemo(() => flatten(p.entries, expanded), [p.entries, expanded])
  const cursorRow = rows.find((r) => r.entry.path === cursor) ?? null

  // 커서가 보이게
  useEffect(() => {
    if (!cursor || !body.current) return
    const el = body.current.querySelector<HTMLElement>(`[data-path="${CSS.escape(cursor)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const toggle = (path: string) =>
    setExpanded((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n })

  const openMenu = (x: number, y: number, path: string, isDir: boolean) => {
    setMenu({ x, y, path, isDir })
    setCursor(path)
    setSelectedDir(isDir ? path : parentOf(path))
  }

  const activate = (row: FlatRow) => {
    const e = row.entry
    setCursor(e.path)
    if (e.type === 'dir') { toggle(e.path); setSelectedDir(e.path) }
    else { p.onOpen(e.path); setSelectedDir(parentOf(e.path)) }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (menu) return
    const idx = cursorRow ? rows.indexOf(cursorRow) : -1
    const go = (i: number) => { const r = rows[Math.max(0, Math.min(rows.length - 1, i))]; if (r) { setCursor(r.entry.path); setSelectedDir(r.entry.type === 'dir' ? r.entry.path : r.parent) } }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(idx + 1); return
      case 'ArrowUp': e.preventDefault(); go(idx <= 0 ? 0 : idx - 1); return
      case 'Home': e.preventDefault(); go(0); return
      case 'End': e.preventDefault(); go(rows.length - 1); return
      case 'ArrowRight':
        e.preventDefault()
        if (!cursorRow) { go(0); return }
        if (cursorRow.entry.type === 'dir') { if (!expanded.has(cursorRow.entry.path)) toggle(cursorRow.entry.path); else go(idx + 1) }
        else p.onOpen(cursorRow.entry.path)
        return
      case 'ArrowLeft': {
        e.preventDefault()
        if (!cursorRow) return
        if (cursorRow.entry.type === 'dir' && expanded.has(cursorRow.entry.path)) { toggle(cursorRow.entry.path); return }
        const parentIdx = rows.findIndex((r) => r.entry.path === cursorRow.parent)
        if (parentIdx >= 0) go(parentIdx)
        return
      }
      case 'Enter':
        e.preventDefault()
        if (cursorRow) activate(cursorRow)
        return
      case 'F2':
        e.preventDefault()
        if (cursorRow) p.onRename(cursorRow.entry.path, cursorRow.entry.type === 'dir')
        return
      case 'Delete':
        e.preventDefault()
        if (cursorRow) p.onDelete(cursorRow.entry.path, cursorRow.entry.type === 'dir')
        return
      case 'F10':
      case 'ContextMenu':
        if (e.key === 'F10' && !e.shiftKey) return
        e.preventDefault()
        if (cursorRow && body.current) {
          const el = body.current.querySelector<HTMLElement>(`[data-path="${CSS.escape(cursorRow.entry.path)}"]`)
          const rect = el?.getBoundingClientRect()
          openMenu(rect ? rect.left + 40 : 100, rect ? rect.bottom : 100, cursorRow.entry.path, cursorRow.entry.type === 'dir')
        }
        return
      default:
        return
    }
  }

  const renderRow = (row: FlatRow) => {
    const e = row.entry
    const indent = { paddingLeft: `${8 + row.depth * 14}px` }
    const isCursor = cursor === e.path
    if (e.type === 'dir') {
      const open = expanded.has(e.path)
      return (
        <div
          key={e.path}
          data-path={e.path}
          className={'tree-row is-dir' + (selectedDir === e.path ? ' is-selected' : '') + (isCursor ? ' is-cursor' : '')}
          style={indent}
          onClick={() => activate(row)}
          onContextMenu={(ev) => { ev.preventDefault(); openMenu(ev.clientX, ev.clientY, e.path, true) }}
        >
          <span className="tree-caret">{open ? '▾' : '▸'}</span>
          <span className="tree-name">{e.name}</span>
          {!open && dirHasChange(e.path, p.gitStatus) && <span className="git-dot" title="아래에 바뀐 파일이 있음">●</span>}
        </div>
      )
    }
    const dirty = p.dirtyPaths.has(e.path)
    const code = p.gitStatus.get(e.path)
    return (
      <div
        key={e.path}
        data-path={e.path}
        className={'tree-row is-file' + (p.activePath === e.path ? ' is-active' : '') + (isCursor ? ' is-cursor' : '')}
        style={indent}
        title={e.path}
        onClick={() => activate(row)}
        onContextMenu={(ev) => { ev.preventDefault(); openMenu(ev.clientX, ev.clientY, e.path, false) }}
      >
        <span className="tree-icon">{fileIcon(e.name)}</span>
        <span className="tree-name">{e.name}</span>
        {dirty && <span className="dirty-dot">●</span>}
        {code && <span className={'git-badge is-' + code} title={gitTitle(code)}>{code}</span>}
      </div>
    )
  }

  return (
    <div className="tree">
      <div className="tree-bar">
        <span className="tree-dir" title={selectedDir || '(루트)'}>{selectedDir || '(루트)'}</span>
        <button onClick={() => p.onNewFile(selectedDir)} title="선택한 폴더에 새 파일 (Ctrl+Alt+N)">＋파일</button>
        <button onClick={() => p.onNewFolder(selectedDir)} title="선택한 폴더에 새 폴더 (Ctrl+Alt+Shift+N)">＋폴더</button>
        <button onClick={p.onRefresh} title="새로고침">↻</button>
      </div>
      <div
        className="tree-body"
        ref={body}
        tabIndex={0}
        role="tree"
        aria-label="파일"
        data-focus-target="tree"
        onKeyDown={onKeyDown}
        onFocus={() => { if (!cursor && rows.length) setCursor(p.activePath ?? rows[0].entry.path) }}
      >
        {p.entries.length === 0 && <div className="tree-empty">.md / .tsv 파일이 없습니다</div>}
        {rows.map(renderRow)}
      </div>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="ctx-title">{menu.path}</div>
          {menu.isDir && <button onClick={() => { setMenu(null); p.onNewFile(menu.path) }}>＋ 새 파일</button>}
          {menu.isDir && <button onClick={() => { setMenu(null); p.onNewFolder(menu.path) }}>＋ 새 폴더</button>}
          <button onClick={() => { setMenu(null); p.onRename(menu.path, menu.isDir) }}>이름 바꾸기 / 옮기기 <kbd>F2</kbd></button>
          <button className="is-danger" onClick={() => { setMenu(null); p.onDelete(menu.path, menu.isDir) }}>삭제 <kbd>Del</kbd></button>
        </div>
      )}
    </div>
  )
}

function gitTitle(code: GitCode) {
  switch (code) {
    case 'M': return 'git: 수정됨'
    case 'A': return 'git: 추가됨 (스테이지)'
    case 'D': return 'git: 삭제됨'
    case 'R': return 'git: 이름 바뀜'
    case 'U': return 'git: 충돌'
    default: return 'git: 추적되지 않음 (새 파일)'
  }
}
