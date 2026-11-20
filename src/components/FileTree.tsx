import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MountInfo, TreeEntry } from '../lib/backend'
import { keysOf, runCommand, tip } from '../lib/commands'
import { explorerSupported } from '../lib/explorer'
import { DOC_EXTS_LABEL, fileTypeOf } from '../lib/filetypes.mjs'
import { splitRootPath } from '../lib/roots.mjs'
import { onQuickLookRequest, onTreeCursor, type QuickLookMode } from '../lib/nav'
import { ancestorDirs, loadExpanded, pruneExpanded, saveExpanded } from '../lib/treeState'
import { QuickLook, type QuickLookHandle } from './QuickLook'

/** 트리 오른쪽 클릭의 폴더·경로 동작 */
export type RootAction = 'unmount' | 'toggleReadOnly' | 'refresh' | 'reveal' | 'copyPath' | 'editRoot'

interface Props {
  /** 펼친 폴더를 기억하는 열쇠 (작업 공간 id) */
  stateKey: string
  entries: TreeEntry[]
  activePath: string | null
  dirtyPaths: ReadonlySet<string>
  /** focus: 연 문서의 편집기로 포커스 (훑어보기 창에서 열 때) */
  onOpen: (path: string, focus?: boolean) => void
  onNewFile: (dir: string) => void
  onNewFolder: (dir: string) => void
  onRename: (path: string, isDir: boolean) => void
  onDelete: (path: string, isDir: boolean) => void
  onRefresh: () => void
  onRootAction: (action: RootAction, path: string) => void
  /** 트리에서 고른 폴더가 바뀔 때 — 새 파일·새 폴더 단축키의 기본 위치가 된다 */
  onSelectDir?: (dir: string) => void
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
  return fileTypeOf(name)?.icon ?? '·'
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
  const menuBox = useRef<HTMLDivElement>(null)
  /** 훑어보기 창 (PLAN-skim Phase D) — 커서의 항목을 열지 않고 트리 오른쪽에 크게. 포커스는 트리에 남는다 */
  const [quickLook, setQuickLook] = useState(false)
  const quickLookBox = useRef<QuickLookHandle>(null)
  /** 창이 붙는 자리 (트리 전체) */
  const [treeBox, setTreeBox] = useState<HTMLDivElement | null>(null)
  /** 팔레트 명령이 열라고 한 때 — 트리가 아직 포커스를 받기 전이면 받을 때 연다 */
  const quickLookAsked = useRef(0)
  const quickLookAskedMode = useRef<QuickLookMode>('item')
  /**
   * 폴더 훑어보기가 주 폴더 루트('')를 보여 주는 중 (Phase E). 루트는 트리에 항목이 없어 커서로 가리킬 수 없다 →
   * 이 동안 창은 트리 맨 위 단계 전체를 한 폴더로 보여 준다. 트리에서 커서를 옮기면 풀린다
   */
  const [lookRoot, setLookRoot] = useState(false)
  /** 창이 뜨면 격자의 첫 카드로 포커스를 옮길 것 (팔레트 "폴더 훑어보기") — 청한 때 */
  const gridFocusAsked = useRef(0)

  // 고른 폴더를 앱에 알린다 (Ctrl+Alt+N / Ctrl+Alt+Shift+N 이 이 폴더에 만든다)
  const onSelectDir = p.onSelectDir
  useEffect(() => { onSelectDir?.(selectedDir) }, [selectedDir, onSelectDir])

  // 메뉴가 창 밖으로 나가지 않게 + 열리면 첫 항목에 포커스 (키보드로 바로 고르게)
  useLayoutEffect(() => {
    if (!menu || !menuBox.current) return
    const { width, height } = menuBox.current.getBoundingClientRect()
    menuBox.current.style.left = `${Math.max(4, Math.min(menu.x, window.innerWidth - width - 4))}px`
    menuBox.current.style.top = `${Math.max(4, Math.min(menu.y, window.innerHeight - height - 4))}px`
    menuBox.current.querySelector<HTMLElement>('button')?.focus()
  }, [menu])

  /** 메뉴를 닫고 트리로 포커스를 돌려준다 (Esc · 항목 실행) */
  const closeMenu = () => { setMenu(null); body.current?.focus() }

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(menuBox.current?.querySelectorAll<HTMLElement>('button') ?? [])]
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    const move = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length].focus() }
    switch (e.key) {
      case 'ArrowDown': move(i + 1); break
      case 'ArrowUp': move(i < 0 ? items.length - 1 : i - 1); break
      case 'Tab': move(e.shiftKey ? i - 1 : i + 1); break
      case 'Home': move(0); break
      case 'End': move(items.length - 1); break
      case 'Escape': e.preventDefault(); e.stopPropagation(); closeMenu(); break
      default: break
    }
  }

  // 팔레트 명령 "훑어보기" · "폴더 훑어보기" (lib/nav requestQuickLook) — 트리로 포커스를 보낸 뒤 오는 요청이다
  useEffect(() => onQuickLookRequest((mode) => {
    if (document.activeElement === body.current) openLookRef.current(mode)
    else { quickLookAsked.current = Date.now(); quickLookAskedMode.current = mode }
  }), [])

  /** 포커스가 트리를 떠날 때 — 트리 · 훑어보기 창 밖으로 갔으면 창을 닫는다 (다른 곳 클릭 · F6 · 팔레트 · 메뉴 …) */
  const onFocusLeave = (to: Element | null) => {
    const inside = (el: Element | null) => !!el && (!!body.current?.contains(el) || !!quickLookBox.current?.contains(el))
    if (inside(to)) return
    if (to) { setQuickLook(false); return }
    // 옮겨 간 곳이 없다: 창 전환(Alt+Tab — 포커스는 트리에 그대로) 또는 포커스 없는 곳을 누름(body 로) → 한 박자 뒤에 본다
    window.setTimeout(() => { if (!inside(document.activeElement)) setQuickLook(false) }, 0)
  }

  // 처음 트리가 오면 지난번에 펼쳐 둔 대로 (저장분이 없으면 전부) 펼친다. 그 뒤로는 사용자가 접고 편 상태를 유지하고 저장한다.
  // 트리에서 없어진 폴더는 펼침 목록 · 저장분에서 뺀다 (DESIGN §24.7 X7)
  const dirs = useMemo(() => allDirs(p.entries), [p.entries])
  useEffect(() => {
    if (!p.entries.length) return
    if (!initialized) {
      const saved = loadExpanded(p.stateKey)
      setExpanded(new Set(saved === null ? dirs : pruneExpanded(saved, dirs)))
      setInitialized(true)
      return
    }
    setExpanded((s) => {
      const kept = pruneExpanded(s, dirs)
      return kept.length === s.size ? s : new Set(kept)
    })
  }, [p.entries, dirs, initialized, p.stateKey])
  useEffect(() => {
    if (initialized) saveExpanded(p.stateKey, pruneExpanded(expanded, dirs))
  }, [expanded, dirs, initialized, p.stateKey])

  // 가져온 폴더 (트리 맨 위 단계의 `@별칭` 노드). 새로 가져온 폴더는 그 루트를 펼쳐 보여 준다
  const mounts = useMemo(() => new Map(p.entries.filter((e) => e.mount).map((e) => [e.mount!.alias, e.mount!])), [p.entries])
  const seenMounts = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!initialized) return
    if (!seenMounts.current) { seenMounts.current = new Set(mounts.keys()); return }
    const fresh = [...mounts.keys()].filter((a) => !seenMounts.current!.has(a))
    seenMounts.current = new Set(mounts.keys())
    if (fresh.length) setExpanded((s) => new Set([...s, ...fresh.map((a) => `@${a}`)]))
  }, [mounts, initialized])

  /** 경로가 속한 가져온 폴더 (주 폴더면 null) · 그 폴더의 루트 노드인가 */
  const mountOf = (path: string): { mount: MountInfo | null; isRoot: boolean } => {
    const { alias, rel } = splitRootPath(path)
    const mount = alias === null ? null : mounts.get(alias) ?? null
    return { mount, isRoot: !!mount && rel === '' }
  }

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('blur', close) }
  }, [menu])

  const rows = useMemo(() => flatten(p.entries, expanded), [p.entries, expanded])
  const cursorRow = rows.find((r) => r.entry.path === cursor) ?? null

  /** 앱이 커서를 옮기라고 한 경로 (이름을 바꾼 파일) — 트리를 다시 읽기 전이면 아직 행이 없다. 행이 생기면 보이게 스크롤하고 비운다 */
  const awaited = useRef<string | null>(null)
  /** 커서가 마지막으로 있던 줄 번호 — 그 항목이 사라지면(삭제) 같은 자리의 항목으로 옮긴다 */
  const lastIndex = useRef(0)
  /** 마지막으로 보이게 스크롤해 준 커서 */
  const shown = useRef<string | null>(null)

  // 앱이 시키는 커서 이동 (lib/nav 의 setTreeCursor): 접힌 상위 폴더를 펴고 커서와 "고른 폴더" 를 옮긴다
  useEffect(() => onTreeCursor((path) => {
    awaited.current = path
    setLookRoot(false)
    setCursor(path)
    setSelectedDir(parentOf(path))
    const up = ancestorDirs(path)
    setExpanded((s) => (up.every((d) => s.has(d)) ? s : new Set([...s, ...up])))
  }), [])

  // 커서가 보이게. 커서의 항목이 사라졌으면(지워짐 · 바깥에서 없어짐) 같은 자리의 항목으로 — ↓ 가 맨 위부터 다시 가지 않게 (TC-807)
  useEffect(() => {
    if (!cursor || !body.current) return
    const i = rows.findIndex((r) => r.entry.path === cursor)
    if (i < 0) {
      if (awaited.current !== cursor && initialized && rows.length) setCursor(rows[Math.min(lastIndex.current, rows.length - 1)].entry.path)
      return
    }
    lastIndex.current = i
    if (awaited.current === cursor) awaited.current = null
    // 스크롤은 커서가 옮겨졌을 때만 — 트리를 다시 읽을 때마다 끌어오면 휠로 넘겨 보던 자리를 잃는다
    if (shown.current === cursor) return
    shown.current = cursor
    const el = body.current.querySelector<HTMLElement>(`[data-path="${CSS.escape(cursor)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor, rows, initialized])

  const toggle = (path: string) =>
    setExpanded((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n })

  const openMenu = (x: number, y: number, path: string, isDir: boolean) => {
    setMenu({ x, y, path, isDir })
    setCursor(path)
    setSelectedDir(isDir ? path : parentOf(path))
  }

  const activate = (row: FlatRow) => {
    const e = row.entry
    setLookRoot(false)
    setCursor(e.path)
    if (e.type === 'dir') { toggle(e.path); setSelectedDir(e.path) }
    else { p.onOpen(e.path); setSelectedDir(parentOf(e.path)) }
  }

  // ---- 폴더 훑어보기 (PLAN-skim Phase E). 격자는 트리 커서의 폴더(또는 루트)를 보여 준다
  /** 주 폴더 루트 — 트리 맨 위 단계(가져온 폴더 `@별칭` 포함)를 바로 아래 항목으로 */
  const rootEntry = useMemo<TreeEntry>(() => ({ type: 'dir', name: '(루트)', path: '', children: p.entries }), [p.entries])
  const lookEntry = lookRoot ? rootEntry : cursorRow?.entry ?? null

  /** 트리 커서를 그 폴더로 (접힌 상위 폴더는 편다) — 격자가 그 폴더로 바뀐다 */
  const lookAtDir = (path: string) => {
    setLookRoot(false)
    setCursor(path)
    setSelectedDir(path)
    const up = ancestorDirs(path)
    setExpanded((s) => (up.every((d) => s.has(d)) ? s : new Set([...s, ...up])))
  }
  /** 격자에서 고른 카드 — 폴더는 그 폴더로, 문서는 열고 창을 닫는다(편집기로 포커스) */
  const onLookPick = (en: TreeEntry) => {
    if (en.type === 'dir') { lookAtDir(en.path); return }
    setQuickLook(false)
    setSelectedDir(parentOf(en.path))
    p.onOpen(en.path, true)
  }
  /** 격자에서 Backspace — 상위 폴더로. 맨 위 단계의 폴더에서는 루트로, 루트에서는 그대로 */
  const onLookUp = (): boolean => {
    if (lookRoot || !cursorRow || cursorRow.entry.type !== 'dir') return false
    if (cursorRow.parent === '') { setLookRoot(true); setSelectedDir(''); return true }
    lookAtDir(cursorRow.parent)
    return true
  }
  /** 창을 연다. folder: 트리에서 고른 폴더(루트면 루트)로 열고 격자의 첫 카드로 포커스 */
  const openLook = (mode: QuickLookMode) => {
    if (mode === 'folder') {
      if (selectedDir === '') { setLookRoot(true); setSelectedDir('') }
      else lookAtDir(selectedDir)
      gridFocusAsked.current = Date.now()
    } else setLookRoot(false)
    setQuickLook(true)
  }
  const openLookRef = useRef(openLook)
  openLookRef.current = openLook

  // 창이 뜨면 (팔레트 "폴더 훑어보기") 격자로 포커스 — 창이 그려진 뒤라야 한다
  useEffect(() => {
    if (!gridFocusAsked.current) return
    if (!quickLook || Date.now() - gridFocusAsked.current > 1000) { gridFocusAsked.current = 0; return }
    if (quickLookBox.current?.focusGrid()) gridFocusAsked.current = 0
  })
  // 창이 닫히면 루트 보기도 끝
  useEffect(() => { if (!quickLook) setLookRoot(false) }, [quickLook])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (menu) return
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey
    const idx = cursorRow ? rows.indexOf(cursorRow) : -1
    const go = (i: number) => { const r = rows[Math.max(0, Math.min(rows.length - 1, i))]; if (r) { setLookRoot(false); setCursor(r.entry.path); setSelectedDir(r.entry.type === 'dir' ? r.entry.path : r.parent) } }
    // 훑어보기 창이 떠 있으면 Ctrl+↑ · Ctrl+↓ 는 커서를 두고 창 안을 조금씩 스크롤한다 (누르고 있으면 이어진다).
    // 창이 없을 때는 지금처럼 커서를 옮긴다
    if (quickLook && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      quickLookBox.current?.scrollStep(e.key === 'ArrowDown' ? 1 : -1)
      return
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(idx + 1); return
      case 'ArrowUp': e.preventDefault(); go(idx <= 0 ? 0 : idx - 1); return
      case 'Home': e.preventDefault(); go(0); return
      case 'End': e.preventDefault(); go(rows.length - 1); return
      case 'ArrowRight':
        e.preventDefault()
        if (!cursorRow) { go(0); return }
        if (cursorRow.entry.type === 'dir') { if (!expanded.has(cursorRow.entry.path)) toggle(cursorRow.entry.path); else go(idx + 1) }
        else { p.onOpen(cursorRow.entry.path, quickLook); setQuickLook(false) }
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
        // 훑어보기 창에서 파일을 열면 창을 닫고 편집기로 간다 (폴더는 펼치기 · 접기라 그대로). 창이 없으면 지금처럼 포커스는 트리에
        if (cursorRow && quickLook && cursorRow.entry.type === 'file') {
          setQuickLook(false)
          setSelectedDir(cursorRow.parent)
          p.onOpen(cursorRow.entry.path, true)
          return
        }
        if (cursorRow) activate(cursorRow)
        return
      // 훑어보기 창 열기 · 닫기 (PLAN-skim SK11). 누르고 있어도 한 번만
      case ' ':
        if (!plain) return
        e.preventDefault()
        if (e.repeat) return
        if (quickLook) setQuickLook(false)
        else if (cursorRow) setQuickLook(true)
        return
      case 'Escape':
        if (!quickLook) return
        e.preventDefault()
        e.stopPropagation()
        setQuickLook(false)
        return
      // 창이 폴더 격자면 첫 카드로 들어간다 (Phase E). 그 밖에는 지금처럼 브라우저의 Tab
      case 'Tab':
        if (!quickLook || !plain) return
        if (quickLookBox.current?.focusGrid()) e.preventDefault()
        return
      // 창이 열려 있으면 창 안을 한 화면씩. 닫혀 있으면 지금처럼 트리를 스크롤한다(브라우저 기본)
      case 'PageUp':
      case 'PageDown':
        if (!quickLook || !plain) return
        e.preventDefault()
        quickLookBox.current?.scrollPage(e.key === 'PageDown' ? 1 : -1)
        return
      case 'F2':
        e.preventDefault()
        setQuickLook(false)
        if (cursorRow && !cursorRow.entry.mount) p.onRename(cursorRow.entry.path, cursorRow.entry.type === 'dir')
        return
      case 'Delete':
        e.preventDefault()
        setQuickLook(false)
        // 가져온 폴더의 루트는 지우지 않는다 (해제는 메뉴에서)
        if (cursorRow && !cursorRow.entry.mount) p.onDelete(cursorRow.entry.path, cursorRow.entry.type === 'dir')
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
      const m = e.mount
      return (
        <div
          key={e.path}
          data-path={e.path}
          className={'tree-row is-dir' + (m ? ' is-mount' : '') + (selectedDir === e.path ? ' is-selected' : '') + (isCursor ? ' is-cursor' : '')}
          style={indent}
          title={m ? `가져온 폴더${m.readOnly ? ' (읽기 전용)' : ''}\n${m.path ?? m.folder}` : undefined}
          onClick={() => activate(row)}
          onContextMenu={(ev) => { ev.preventDefault(); openMenu(ev.clientX, ev.clientY, e.path, true) }}
        >
          <span className="tree-caret">{open ? '▾' : '▸'}</span>
          {m && <span className="tree-mount-icon">{m.readOnly ? '🔒' : '🔗'}</span>}
          <span className="tree-name">{e.name}</span>
          {m?.truncated && <span className="tree-warn" title="항목이 너무 많아 일부만 보입니다 — 하위 폴더를 가져오세요">⚠</span>}
        </div>
      )
    }
    const dirty = p.dirtyPaths.has(e.path)
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
      </div>
    )
  }

  return (
    <div className="tree" ref={setTreeBox}>
      <button className="tree-search" onClick={() => runCommand('fileSearch')} title={tip('파일 이름으로 찾아 열기', 'fileSearch')}>
        <span className="tree-search-icon">🔍</span>
        <span className="tree-search-label">파일 검색</span>
        <kbd>{keysOf('fileSearch')}</kbd>
      </button>
      <div className="tree-bar">
        <span className="tree-dir" title={selectedDir || '(루트)'}>{selectedDir || '(루트)'}</span>
        <button onClick={() => p.onNewFile(selectedDir)} title={tip('선택한 폴더에 새 파일', 'newFile')}>＋파일</button>
        <button onClick={() => p.onNewFolder(selectedDir)} title={tip('선택한 폴더에 새 폴더', 'newFolder')}>＋폴더</button>
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
        onFocus={() => {
          if (!cursor && rows.length) setCursor(p.activePath ?? rows[0].entry.path)
          if (quickLookAsked.current && Date.now() - quickLookAsked.current < 1000) openLook(quickLookAskedMode.current)
          quickLookAsked.current = 0
        }}
        onBlur={(ev) => { if (quickLook) onFocusLeave(ev.relatedTarget as Element | null) }}
        onContextMenu={(ev) => { if (ev.target === ev.currentTarget) { ev.preventDefault(); openMenu(ev.clientX, ev.clientY, '', true) } }}
      >
        {p.entries.length === 0 && <div className="tree-empty">{DOC_EXTS_LABEL} 파일이 없습니다</div>}
        {rows.map(renderRow)}
      </div>
      {quickLook && lookEntry && (
        <QuickLook ref={quickLookBox} entry={lookEntry} anchor={treeBox} onFocusOut={onFocusLeave} onPick={onLookPick} onUp={onLookUp} onBack={() => body.current?.focus()} />
      )}
      {menu && (() => {
        const { mount, isRoot } = mountOf(menu.path)
        const writable = !mount?.readOnly
        const isPrimary = menu.path === ''
        const act = (a: RootAction) => { closeMenu(); p.onRootAction(a, menu.path) }
        return (
          <div className="ctx-menu" role="menu" ref={menuBox} style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onMenuKeyDown}>
            <div className="ctx-title">{isPrimary ? '(루트)' : isRoot ? mount!.path ?? mount!.folder : menu.path}</div>
            {!isPrimary && <button onClick={() => { closeMenu(); setQuickLook(true) }}>훑어보기 <kbd>Space</kbd></button>}
            {menu.isDir && writable && <button onClick={() => { closeMenu(); p.onNewFile(menu.path) }}>＋ 새 파일</button>}
            {menu.isDir && writable && <button onClick={() => { closeMenu(); p.onNewFolder(menu.path) }}>＋ 새 폴더</button>}
            {!isRoot && writable && !menu.isDir && <button onClick={() => { closeMenu(); p.onRename(menu.path, false) }}>이름 바꾸기 / 옮기기 <kbd>F2</kbd></button>}
            {explorerSupported() && <button onClick={() => act('reveal')}>파일 탐색기에서 열기</button>}
            <button onClick={() => act('copyPath')}>전체 경로 복사</button>
            {(isRoot || isPrimary) && <button onClick={() => act('editRoot')}>{isPrimary ? '별칭 · 상세 경로 편집' : '상세 경로 편집'}</button>}
            {!isRoot && !isPrimary && writable && <button className="is-danger" onClick={() => { closeMenu(); p.onDelete(menu.path, menu.isDir) }}>삭제 <kbd>Del</kbd></button>}
            {isRoot && <button onClick={() => act('toggleReadOnly')}>{mount!.readOnly ? '읽기 전용 끄기' : '읽기 전용 켜기'}</button>}
            {isRoot && <button onClick={() => act('refresh')}>새로 고침</button>}
            {isRoot && <button onClick={() => act('unmount')}>가져오기 해제 (파일은 그대로)</button>}
          </div>
        )
      })()}
    </div>
  )
}
