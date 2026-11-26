import { useEffect, useMemo, useRef, useState } from 'react'
import type { MountInfo, TreeEntry } from '../lib/backend'
import { keysOf, registerCommands, runCommand, tip } from '../lib/commands'
import { registerSpotReader, type SpotReader, type TreeSpot } from '../lib/contextMenu'
import { DOC_EXTS_LABEL, fileTypeOf } from '../lib/filetypes.mjs'
import { splitRootPath } from '../lib/roots.mjs'
import { onQuickLookRequest, onTreeCursor, onTreeOpenSide, type QuickLookMode } from '../lib/nav'
import { ancestorDirs, loadExpanded, pruneExpanded, saveExpanded } from '../lib/treeState'
import { lookResizeKey, lookZoomKey } from '../lib/skim/look'
import { QuickLook, type QuickLookHandle } from './QuickLook'

/** 트리 맥락 메뉴(팔레트 명령)의 폴더·경로 동작 */
export type RootAction = 'unmount' | 'toggleReadOnly' | 'refresh' | 'copyPath' | 'editRoot'

interface Props {
  /** 펼친 폴더를 기억하는 열쇠 (작업 공간 id) */
  stateKey: string
  entries: TreeEntry[]
  activePath: string | null
  dirtyPaths: ReadonlySet<string>
  /** focus: 연 문서의 편집기로 포커스 (훑어보기 창에서 열 때) */
  onOpen: (path: string, focus?: boolean) => void
  /** 오른쪽 창에 열기 (`Ctrl+Enter`, DESIGN §38) — 포커스는 연 창으로 */
  onOpenSide?: (path: string) => void
  onNewFile: (dir: string) => void
  onNewFolder: (dir: string) => void
  onRename: (path: string, isDir: boolean) => void
  onDelete: (path: string, isDir: boolean) => void
  onRefresh: () => void
  onRootAction: (action: RootAction, path: string) => void
  /** 트리에서 고른 폴더가 바뀔 때 — 새 파일·새 폴더 단축키의 기본 위치가 된다 */
  onSelectDir?: (dir: string) => void
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
  /** 키보드 커서 (경로) */
  const [cursor, setCursor] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)
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
  const mountOfRef = useRef(mountOf)
  mountOfRef.current = mountOf

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

  /** 오른쪽 클릭한 항목으로 커서 · 고른 폴더를 옮긴다 — 맥락 메뉴의 명령이 그 항목에 돈다 */
  const pointAt = (path: string, isDir: boolean) => {
    setLookRoot(false)
    if (path) setCursor(path)
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
  /** 훑어보기 창 머리의 "열기" · "오른쪽에 열기", 트리 · 격자의 Ctrl+Enter — 창을 닫고 그 문서 창으로 (DESIGN §38) */
  const openFrom = (path: string, side: boolean) => {
    setQuickLook(false)
    setSelectedDir(parentOf(path))
    if (side && p.onOpenSide) p.onOpenSide(path)
    else p.onOpen(path, true)
  }
  // 팔레트 "트리 커서의 파일을 오른쪽 창에 열기" — 커서가 파일일 때만 (폴더면 알리지 않고 그대로)
  const sideRef = useRef<() => void>(() => {})
  sideRef.current = () => { if (cursorRow?.entry.type === 'file') openFrom(cursorRow.entry.path, true) }
  useEffect(() => onTreeOpenSide(() => sideRef.current()), [])
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

  // ---- 맥락 메뉴 (DESIGN §40). 메뉴는 앱이 띄우고, 트리는 "지금 자리" 와 커서 항목에 도는 팔레트 명령을 준다
  /** 커서(오른쪽 클릭이면 누른 항목)의 자리. 트리의 빈 자리 · 빈 트리는 주 폴더 루트('') */
  const readSpot = (target: Element, point: { x: number; y: number } | null): TreeSpot => {
    let path: string | null = cursorRow?.entry.path ?? null
    let isDir = cursorRow?.entry.type === 'dir'
    if (point && body.current?.contains(target)) {
      const rowEl = target.closest<HTMLElement>('[data-path]')
      const hit = rowEl ? rows.find((r) => r.entry.path === rowEl.dataset.path) : undefined
      path = hit ? hit.entry.path : ''
      isDir = hit ? hit.entry.type === 'dir' : true
      pointAt(path, isDir)
    }
    if (path === null) { path = ''; isDir = true }
    const { mount, isRoot } = mountOf(path)
    const rowEl = path ? body.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`) : null
    const rect = rowEl?.getBoundingClientRect()
    return {
      zone: 'tree',
      title: path === '' ? '(루트)' : isRoot ? mount!.path ?? mount!.folder : path,
      anchor: rect && rect.height ? { x: rect.left + 40, y: rect.bottom } : undefined,
      path,
      isDir,
      mountAlias: mount?.alias ?? null,
      isMountRoot: isRoot,
      fileMount: !!mount?.file,
      writable: !mount?.readOnly,
    }
  }
  const spotRef = useRef<SpotReader>(() => null)
  spotRef.current = readSpot
  useEffect(() => (treeBox ? registerSpotReader(treeBox, (t, pt) => spotRef.current(t, pt)) : undefined), [treeBox])

  /** 커서 항목에 도는 팔레트 명령 (맥락 메뉴의 항목도 이것). 가져온 폴더의 루트는 이름 바꾸기 · 지우기가 없다 (해제는 따로) */
  const cursorRef = useRef(cursorRow)
  cursorRef.current = cursorRow
  const actRef = useRef(p)
  actRef.current = p
  useEffect(() => {
    const cur = () => cursorRef.current?.entry ?? null
    const changeable = () => { const e = cur(); return !!e && !e.mount && !mountOfRef.current(e.path).mount?.readOnly }
    return registerCommands([
      { id: 'treeRename', label: '파일 트리: 커서 항목 이름 바꾸기 / 옮기기', run: () => { const e = cur(); if (e && !e.mount) { setQuickLook(false); actRef.current.onRename(e.path, e.type === 'dir') } }, enabled: changeable },
      { id: 'treeDelete', label: '파일 트리: 커서 항목 삭제', run: () => { const e = cur(); if (e && !e.mount) { setQuickLook(false); actRef.current.onDelete(e.path, e.type === 'dir') } }, enabled: changeable },
      { id: 'treeCopyPath', label: '파일 트리: 커서 항목의 전체 경로 복사', run: () => { const e = cur(); if (e) actRef.current.onRootAction('copyPath', e.path) }, enabled: () => !!cur() },
    ])
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
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
    // 훑어보기 창의 확대 · 축소(Ctrl+= · Ctrl+-)와 크기(Shift+방향키). 바꾼 값은 이 브라우저에 남는다 (lib/skim/look.ts).
    // 창이 없을 때는 건드리지 않는다 — Ctrl+= · Ctrl+- 는 브라우저의 페이지 확대, Shift+방향키는 지금처럼 커서 이동
    if (quickLook) {
      const z = lookZoomKey(e)
      const size = z ? null : lookResizeKey(e)
      if (z || size) {
        e.preventDefault()
        if (z) quickLookBox.current?.zoomBy(z)
        else if (size) quickLookBox.current?.resizeBy(size[0], size[1])
        return
      }
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
        // Alt+Enter 는 맥락 메뉴 (전역 — DESIGN §40)
        if (e.altKey) return
        e.preventDefault()
        // Ctrl+Enter — 파일을 오른쪽 창에 (훑어보기 창이 떠 있으면 닫는다). 폴더는 그냥 Enter 와 같다
        if (cursorRow && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && cursorRow.entry.type === 'file') {
          openFrom(cursorRow.entry.path, true)
          return
        }
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
          title={m ? `${m.file ? '가져온 파일 — 그 파일을 고치는 것만 됩니다' : '가져온 폴더'}${m.readOnly ? ' (읽기 전용)' : ''}\n${m.path ?? m.folder}` : undefined}
          onClick={() => activate(row)}
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
      >
        <span className="tree-icon">{fileIcon(e.name)}</span>
        <span className="tree-name">{e.name}</span>
        {dirty && <span className="dirty-dot">●</span>}
      </div>
    )
  }

  return (
    <div className="tree" ref={setTreeBox}>
      {/* 명령 막대 — 단추마다 data-command (lib/paneCommands.ts, paneCommands.test) */}
      <button className="tree-search" data-command="fileSearch" onClick={() => runCommand('fileSearch')} title={tip('파일 이름으로 찾아 열기', 'fileSearch')}>
        <span className="tree-search-icon">🔍</span>
        <span className="tree-search-label">파일 검색</span>
        <kbd>{keysOf('fileSearch')}</kbd>
      </button>
      <div className="tree-bar">
        <span className="tree-dir" title={selectedDir || '(루트)'}>{selectedDir || '(루트)'}</span>
        <button data-command="newFile" onClick={() => p.onNewFile(selectedDir)} title={tip('선택한 폴더에 새 문서', 'newFile')}>＋파일</button>
        <button data-command="newFolder" onClick={() => p.onNewFolder(selectedDir)} title={tip('선택한 폴더에 새 폴더', 'newFolder')}>＋폴더</button>
        <button data-command="refreshTree" onClick={p.onRefresh} title={tip('파일 트리 새로고침', 'refreshTree')}>↻</button>
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
      >
        {p.entries.length === 0 && (
          // 빈 문서 폴더 (DESIGN §35): 무엇을 할 수 있는지 키와 함께. 단추는 Tab 순서에 넣지 않는다 — 키보드는 적힌 키로
          <div className="tree-empty">
            <p>{DOC_EXTS_LABEL} 파일이 없습니다</p>
            <button tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => p.onNewFile('')}>새 문서 <kbd>{keysOf('newFile')}</kbd></button>
            <button tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand('importFolder')}>폴더 가져오기 <kbd>{keysOf('importFolder')}</kbd></button>
            <p className="tree-empty-hint">파일 탐색기에서 폴더 · 파일을 여기로 끌어다 놓아도 됩니다</p>
          </div>
        )}
        {rows.map(renderRow)}
      </div>
      {quickLook && lookEntry && (
        <QuickLook ref={quickLookBox} entry={lookEntry} anchor={treeBox} onFocusOut={onFocusLeave} onPick={onLookPick} onUp={onLookUp} onBack={() => body.current?.focus()} onNewFile={p.onNewFile} onOpenFile={openFrom} />
      )}
    </div>
  )
}
