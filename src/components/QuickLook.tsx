import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import type { TreeEntry } from '../lib/backend'
import { fileTypeOf } from '../lib/filetypes.mjs'
import { PAGE_RATIO, useSkimText } from '../lib/skim'
import { CARD_GAP, CARD_MIN_WIDTH, folderCounts, gridColumns, gridMove, isGridKey, pageRowsOf } from '../lib/skim/grid'
import { LOOK_MIN_HEIGHT, LOOK_MIN_WIDTH, LOOK_ZOOM_MAX, LOOK_ZOOM_MIN, fitLookSize, lookPrefs, lookResizeKey, lookZoomKey, setLookPrefs, stepLookZoom, useLookPrefs, type LookPrefs } from '../lib/skim/look'
import { DocFileView, DocThumb } from './DocView'
import { keysOf } from '../lib/commands'
import { store } from '../store/documents'
import './QuickLook.css'

/**
 * 훑어보기 창 (PLAN-skim Phase D · SK11). 트리 커서의 항목을 열지 않고 트리 오른쪽에 크게 보여 준다.
 *
 * - 틀(`QuickLook`)과 내용이 나뉜다: 파일이면 `QuickLookFile`(DocFileView, rich, inert), 폴더면 `QuickLookFolder`.
 * - 포커스는 트리에 남는다. 열고 닫기 · 키는 트리(FileTree)가 한다 — 이 창은 그리기와 스크롤만.
 * - 틀 안을 마우스로 눌러도 포커스가 트리를 떠나지 않는다(mousedown 기본 동작을 막는다).
 *   예외는 폴더 쪽 내용 안의 포커스 받는 요소(`button` · `a` · `input` · `[tabindex]`) — Phase E 의 격자가 `Tab` · 클릭으로 포커스를 받는다.
 * - 폴더면 너비를 넓힌다(`FOLDER_MAX_WIDTH`). 격자에 포커스가 있는 동안은 항목을 늦추지 않고 바로 바꾼다.
 */

/** 커서가 빠르게 움직일 때(↓ 를 누르고 있을 때) 파일마다 읽고 그리지 않게 이만큼 늦춘다 */
export const QUICKLOOK_DELAY = 100
/** `Ctrl+↑` `Ctrl+↓` 한 번에 움직이는 높이(px) — 글 서너 줄. 누르고 있으면 키 반복으로 이어진다 */
export const QUICKLOOK_STEP = 60

export interface QuickLookHandle {
  /** 창 안을 한 화면 위(-1) · 아래(1)로 */
  scrollPage(dir: 1 | -1): void
  /** 창 안을 조금(`QUICKLOOK_STEP`) 위(-1) · 아래(1)로 — 트리의 `Ctrl+↑` `Ctrl+↓` */
  scrollStep(dir: 1 | -1): void
  /** 한 단계 확대(1) · 축소(-1) — 파일은 글자 크기, 폴더 격자는 카드 크기. 이 브라우저에 남는다 (`lib/skim/look.ts`) */
  zoomBy(dir: 1 | -1): void
  /** 창 크기를 `dw` · `dh` px 만큼 (화면 안에서). 이 브라우저에 남는다 */
  resizeBy(dw: number, dh: number): void
  /** 그 노드가 창 안에 있는가 — 트리가 포커스를 잃을 때 "창으로 간 것"인지 가린다 */
  contains(node: Node | null): boolean
  /**
   * 폴더 격자의 첫 카드로 포커스 (Phase E — 트리의 `Tab`, 팔레트 "폴더 훑어보기").
   * 늦게 따라가는 중이어도 지금 항목으로 바로 바꾼다. 항목이 폴더가 아니면 아무것도 하지 않고 false
   */
  focusGrid(): boolean
}

export interface QuickLookProps {
  /** 보여 줄 항목 (트리 커서). 바뀌면 `QUICKLOOK_DELAY` 뒤에 따라간다 — 처음 열 때 · 포커스가 창 안에 있을 때는 바로 */
  entry: TreeEntry
  /** 이 요소의 오른쪽에 뜬다 (파일 트리) */
  anchor: HTMLElement | null
  /** 포커스가 창 밖으로 나갔을 때 (Phase E: 격자에 들어간 포커스가 트리도 창도 아닌 곳으로 갔을 때) */
  onFocusOut?: (to: Element | null) => void
  /** 격자에서 카드를 골랐다 (`Enter` · 더블클릭). 폴더면 트리 커서를 그 폴더로 — 격자는 그 폴더로 바뀌고 포커스는 첫 카드에 남는다 */
  onPick?: (entry: TreeEntry) => void
  /** 격자에서 `Backspace` — 상위 폴더로 (폴더 카드를 고른 것과 같이). 옮겼으면 true (주 폴더 루트에서는 false) */
  onUp?: () => boolean
  /** 격자에서 `Esc` · `Shift+Tab` — 트리로 포커스를 돌려준다 (창은 열린 채) */
  onBack?: () => void
  /** 문서가 없는 폴더의 "새 문서" (DESIGN §35) — 그 폴더 아래에 새 문서 창 */
  onNewFile?: (dir: string) => void
}

/** React 18 은 inert 를 모르는 속성으로 넘긴다 — 빈 문자열이어야 붙는다 (DocView 의 DocThumb 과 같다) */
const INERT = { inert: '' } as HTMLAttributes<HTMLDivElement>

const GAP = 8
const MIN_WIDTH = LOOK_MIN_WIDTH
/** 폴더 격자일 때의 너비 상한 — 남은 너비가 이만큼 되면 이 너비 (Phase E). 파일일 때의 창은 그대로 */
const FOLDER_MAX_WIDTH = 900

/** roomW · roomH = 지금 화면에서 창이 가질 수 있는 가장 큰 너비 · 높이 (크기를 바꿀 때의 상한) */
interface Box { left: number; top: number; width: number; height: number; roomW: number; roomH: number }

/**
 * 트리 오른쪽 · 화면 높이의 대부분 · 너비는 세로 A4 비율(높이 ÷ 1.414). 좁으면 남은 너비로 줄인다.
 * 폴더(wide)는 격자가 읽기 좋게 남은 너비 안에서 `FOLDER_MAX_WIDTH` 까지 넓힌다.
 * 사용자가 크기를 정해 두었으면(`size`) 화면 안에서 그 크기를 쓴다
 */
function placeBox(anchor: HTMLElement | null, wide: boolean, size: { width: number | null; height: number | null }): Box {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const r = anchor?.getBoundingClientRect()
  const top = Math.max(GAP, r ? r.top : GAP)
  const roomH = Math.max(LOOK_MIN_HEIGHT, vh - top - GAP * 2)
  const height = fitLookSize(size.height, roomH, LOOK_MIN_HEIGHT, roomH)
  let left = (r ? r.right : 0) + GAP
  let roomW = vw - left - GAP * 2
  // 정해 둔 너비가 없으면 화면 높이에 맞춘 세로 A4 폭 (창 높이를 줄여도 너비는 그대로)
  const auto = Math.max(MIN_WIDTH, Math.round(roomH / PAGE_RATIO), wide ? FOLDER_MAX_WIDTH : 0)
  let width = fitLookSize(size.width, auto, MIN_WIDTH, roomW)
  // 트리가 넓어 오른쪽에 자리가 없으면 화면 안으로 당긴다 (트리를 일부 가린다)
  if (roomW < MIN_WIDTH) {
    width = Math.min(MIN_WIDTH, vw - GAP * 2)
    left = Math.max(GAP, vw - width - GAP)
    roomW = width
  }
  return { left, top, width, height, roomW, roomH }
}

function useBox(anchor: HTMLElement | null, wide: boolean, width: number | null, height: number | null): Box {
  const [box, setBox] = useState<Box>(() => placeBox(anchor, wide, { width, height }))
  useLayoutEffect(() => {
    const update = () => setBox((b) => {
      const n = placeBox(anchor, wide, { width, height })
      return n.left === b.left && n.top === b.top && n.width === b.width && n.height === b.height && n.roomW === b.roomW && n.roomH === b.roomH ? b : n
    })
    update()
    window.addEventListener('resize', update)
    const ro = anchor && typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    if (anchor) ro?.observe(anchor)
    return () => { window.removeEventListener('resize', update); ro?.disconnect() }
  }, [anchor, wide, width, height])
  return box
}

type ResizeEdge = 'e' | 's' | 'se'

/**
 * 커서를 늦게 따라간다. 같은 경로의 새 객체(트리를 다시 읽음)는 바로 바꾼다.
 * `immediate` (포커스가 창 안 — 격자에서 폴더를 옮겨 다닐 때)면 늦추지 않는다. `jump()` 는 지금 항목으로 바로 바꾼다
 */
function useLagging(entry: TreeEntry, immediate: boolean): [TreeEntry, () => void] {
  const [lagged, setLagged] = useState(entry)
  const now = immediate || entry.path === lagged.path
  useEffect(() => {
    if (now) { if (entry !== lagged) setLagged(entry); return }
    const t = window.setTimeout(() => setLagged(entry), QUICKLOOK_DELAY)
    return () => window.clearTimeout(t)
  }, [entry, lagged, now])
  const latest = useRef(entry)
  latest.current = entry
  const jump = useCallback(() => setLagged(latest.current), [])
  return [now ? entry : lagged, jump]
}

export const QuickLook = forwardRef<QuickLookHandle, QuickLookProps>(function QuickLook({ entry, anchor, onFocusOut, onPick, onUp, onBack, onNewFile }, ref) {
  /** 포커스가 창 안(격자)에 있는가 */
  const [inside, setInside] = useState(false)
  const [shown, jump] = useLagging(entry, inside)
  const isDir = shown.type === 'dir'
  // 크기 · 배율 — 사용자가 바꾼 값은 이 브라우저에 남는다 (lib/skim/look.ts). 너비는 파일 · 폴더가 따로, 높이는 같이
  const prefs = useLookPrefs()
  const box = useBox(anchor, isDir, isDir ? prefs.folderWidth : prefs.fileWidth, prefs.height)
  const zoom = isDir ? prefs.gridZoom : prefs.zoom
  /** 키 · 휠 · 끌기가 읽는 지금 값 (다시 그리기 전에 연달아 와도 맞게) */
  const live = useRef({ box, isDir })
  live.current = { box, isDir }
  const frame = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  /** 올리면 격자가 (지금 그린 폴더의) 첫 카드로 포커스를 옮긴다 */
  const [focusToken, setFocusToken] = useState(0)
  const entryRef = useRef(entry)
  entryRef.current = entry

  const zoomBy = useCallback((dir: 1 | -1) => {
    const p = lookPrefs()
    setLookPrefs(live.current.isDir ? { gridZoom: stepLookZoom(p.gridZoom, dir) } : { zoom: stepLookZoom(p.zoom, dir) })
  }, [])
  /** 지금 그려진 크기에서 `dw` · `dh` 만큼. 0 인 쪽은 건드리지 않는다. 화면에 들어가는 만큼만 */
  const resizeTo = useCallback((width: number | null, height: number | null) => {
    const { box: b, isDir: dir } = live.current
    const patch: Partial<LookPrefs> = {}
    if (width !== null) patch[dir ? 'folderWidth' : 'fileWidth'] = fitLookSize(width, width, LOOK_MIN_WIDTH, b.roomW)
    if (height !== null) patch.height = fitLookSize(height, height, LOOK_MIN_HEIGHT, b.roomH)
    setLookPrefs(patch)
  }, [])
  const resizeBy = useCallback((dw: number, dh: number) => {
    const b = live.current.box
    resizeTo(dw ? b.width + dw : null, dh ? b.height + dh : null)
  }, [resizeTo])
  /** 가장자리 · 모서리 끌기. 두 번 누르면 그 방향의 크기를 처음으로 */
  const startResize = (edge: ResizeEdge) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const b = live.current.box
    const start = { x: e.clientX, y: e.clientY, w: b.width, h: b.height }
    // 창(window)에서 듣는다 — 빠르게 끌어 손잡이 밖으로 나가도 따라온다
    const move = (ev: PointerEvent) => resizeTo(edge === 's' ? null : start.w + ev.clientX - start.x, edge === 'e' ? null : start.h + ev.clientY - start.y)
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
  const resetSize = (edge: ResizeEdge) => () => {
    const patch: Partial<LookPrefs> = {}
    if (edge !== 's') patch[live.current.isDir ? 'folderWidth' : 'fileWidth'] = null
    if (edge !== 'e') patch.height = null
    setLookPrefs(patch)
  }

  // Ctrl+휠 = 확대 · 축소 (브라우저의 페이지 확대 대신). React 의 onWheel 은 passive 라 막을 수 없어 직접 건다
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  useImperativeHandle(ref, () => ({
    scrollPage(dir) {
      const s = scroller.current
      if (s) s.scrollBy({ top: dir * Math.max(40, s.clientHeight - 40) })
    },
    scrollStep(dir) {
      scroller.current?.scrollBy({ top: dir * QUICKLOOK_STEP })
    },
    zoomBy,
    resizeBy,
    contains(node) {
      return !!node && !!frame.current?.contains(node)
    },
    focusGrid() {
      if (entryRef.current.type !== 'dir') return false
      jump()
      setFocusToken((t) => t + 1)
      return true
    },
  }), [jump, zoomBy, resizeBy])

  // 폴더 카드를 고르거나 Backspace 로 옮기면 새 폴더의 첫 카드로 포커스 (트리 커서가 바뀌어 entry 가 오면 그려진다)
  const pick = useCallback((e: TreeEntry) => {
    if (e.type === 'dir') setFocusToken((t) => t + 1)
    onPick?.(e)
  }, [onPick])
  const up = useCallback(() => {
    const moved = onUp?.() ?? false
    if (moved) setFocusToken((t) => t + 1)
    return moved
  }, [onUp])

  // 항목이 바뀌면 맨 위부터
  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = 0 }, [shown.path])

  return createPortal(
    <div
      className="quicklook"
      ref={frame}
      role="dialog"
      aria-label={`훑어보기 — ${shown.path || '(루트)'}`}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onMouseDown={(e) => {
        // 포커스는 트리에 남긴다. 폴더 쪽 내용 안의 포커스 받는 요소만 예외 (Phase E)
        const t = e.target as Element
        if (t.closest('[inert]') || !t.closest('.quicklook-folder button, .quicklook-folder a, .quicklook-folder input, .quicklook-folder [tabindex]')) e.preventDefault()
      }}
      onFocus={() => setInside(true)}
      onBlur={(e) => {
        const to = e.relatedTarget as Element | null
        if (to && frame.current?.contains(to)) return
        setInside(false)
        onFocusOut?.(to)
      }}
      onKeyDown={(e) => {
        // 포커스가 창 안(격자)에 있을 때의 확대 · 축소와 크기 — 트리에 있을 때는 FileTree 가 같은 키로 부른다
        const z = lookZoomKey(e)
        const size = z ? null : lookResizeKey(e)
        if (!z && !size) return
        e.preventDefault()
        if (z) zoomBy(z)
        else if (size) resizeBy(size[0], size[1])
      }}
    >
      <QuickLookHeader entry={shown} zoom={zoom} onZoom={zoomBy} onZoomReset={() => setLookPrefs(isDir ? { gridZoom: 1 } : { zoom: 1 })} />
      <div className="quicklook-scroll" ref={scroller}>
        {isDir ? <QuickLookFolder entry={shown} focusToken={focusToken} zoom={zoom} onPick={pick} onUp={up} onBack={onBack} onNewFile={onNewFile} /> : <QuickLookFile path={shown.path} zoom={zoom} />}
      </div>
      <div className="quicklook-resize is-e" title="끌어서 너비 바꾸기 (Shift+← →) · 두 번 누르면 처음 너비" onPointerDown={startResize('e')} onDoubleClick={resetSize('e')} />
      <div className="quicklook-resize is-s" title="끌어서 높이 바꾸기 (Shift+↑ ↓) · 두 번 누르면 처음 높이" onPointerDown={startResize('s')} onDoubleClick={resetSize('s')} />
      <div className="quicklook-resize is-se" title="끌어서 크기 바꾸기 · 두 번 누르면 처음 크기" onPointerDown={startResize('se')} onDoubleClick={resetSize('se')} />
    </div>,
    document.body,
  )
})

interface HeaderProps { entry: TreeEntry; zoom: number; onZoom: (dir: 1 | -1) => void; onZoomReset: () => void }

function QuickLookHeader({ entry, zoom, onZoom, onZoomReset }: HeaderProps) {
  const isDir = entry.type === 'dir'
  const type = isDir ? null : fileTypeOf(entry.path)
  // 디스크 인코딩 — 읽기는 DocFileView 와 같은 캐시라 한 번만 읽는다
  const file = useSkimText(isDir || !type ? null : entry.path)
  const encoding = file.source === 'disk' && file.encoding && file.encoding !== 'utf-8' ? file.encoding.toUpperCase() : null
  return (
    <div className="quicklook-head">
      <span className="quicklook-path" title={entry.path || '(루트)'}>{entry.path || '(루트)'}</span>
      <span className="quicklook-kind">{isDir ? '폴더' : type?.label ?? '지원하지 않는 형식'}</span>
      {encoding && <span className="quicklook-enc" title="UTF-8 이 아닌 파일 — 읽기 전용으로 열린다">{encoding}</span>}
      {/* 확대 · 축소 — 버튼은 포커스를 받지 않는다 (포커스는 트리에 남는다). 키는 Ctrl+= · Ctrl+-, Ctrl+휠 */}
      <span className="quicklook-zoom" title={isDir ? '카드 크기' : '글자 크기'}>
        <button type="button" tabIndex={-1} disabled={zoom <= LOOK_ZOOM_MIN} onClick={() => onZoom(-1)} title="축소 (Ctrl+-)" aria-label="축소">−</button>
        <button type="button" tabIndex={-1} className="quicklook-zoom-value" onClick={onZoomReset} title="100% 로 되돌리기">{Math.round(zoom * 100)}%</button>
        <button type="button" tabIndex={-1} disabled={zoom >= LOOK_ZOOM_MAX} onClick={() => onZoom(1)} title="확대 (Ctrl+=)" aria-label="확대">＋</button>
      </span>
    </div>
  )
}

/** 파일 내용 — 문서 전체를 rich 로 (표는 DocView 가 앞 60행만). 보기만 한다(inert). `zoom` 은 글자 크기 — 너비 안에서 다시 줄바꿈된다 */
export function QuickLookFile({ path, zoom = 1 }: { path: string; zoom?: number }) {
  return (
    <div className="quicklook-file" style={zoom === 1 ? undefined : { zoom }} {...INERT}>
      <DocFileView path={path} weight="rich" />
    </div>
  )
}

export interface QuickLookFolderProps {
  /** 폴더 항목 (트리의 TreeEntry — `children` 이 바로 아래 항목). 주 폴더 루트는 path '' */
  entry: TreeEntry
  /** 올라가면 첫 카드로 포커스 (카드가 없으면 격자 상자로) */
  focusToken?: number
  /** 카드 크기의 배율 (1 = 카드 최소 너비 140px). 크게 하면 한 줄의 카드 수가 준다 */
  zoom?: number
  /** `Enter` · 더블클릭 */
  onPick?: (entry: TreeEntry) => void
  /** `Backspace` — 상위 폴더로 옮겼으면 true */
  onUp?: () => boolean
  /** `Esc` · `Shift+Tab` */
  onBack?: () => void
  /** 문서가 없는 폴더의 "새 문서" 단추 · `Enter` (DESIGN §35) */
  onNewFile?: (dir: string) => void
}

/** 스크롤 상자 위아래로 이만큼(상자 높이에 대한 비율) 안에 들어온 카드를 그린다 — 미리 읽어 두어 스크롤할 때 빈 틀이 덜 보이게 */
const NEAR_MARGIN = '100% 0px'
/** 이만큼 밖으로 멀어진 카드는 다시 빈 틀로 — 수백 개를 다 그려 두지 않게. 사이를 두어 경계에서 그렸다 비웠다 하지 않는다 */
const FAR_MARGIN = '300% 0px'

const pathOf = (e: IntersectionObserverEntry) => (e.target as HTMLElement).dataset.path ?? ''

/**
 * 폴더 훑어보기 (PLAN-skim Phase E · SK12) — 바로 아래 항목의 썸네일 격자. 순서는 트리와 같다.
 *
 * - 문서는 `DocThumb`(light), 하위 폴더는 폴더 카드(안의 폴더 · 문서 수).
 * - 화면 가까이 온 카드만 썸네일을 그린다(읽기도 그때). 멀어지면 빈 틀로 돌린다 — `NEAR_MARGIN` · `FAR_MARGIN`.
 * - 열 수는 너비로 정한다(`gridColumns`). 방향키 · `PageUp/PageDown` · `Home/End` 로 카드를 옮긴다(`gridMove`).
 * - 카드는 `[tabindex]` 라 클릭으로 포커스를 받는다(틀이 막지 않는다). 포커스 받은 카드 = 고른 카드.
 */
export function QuickLookFolder({ entry, focusToken = 0, zoom = 1, onPick, onUp, onBack, onNewFile }: QuickLookFolderProps) {
  const items = entry.children ?? []
  const { dirs, files } = folderCounts(items)
  const box = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(1)
  const [active, setActive] = useState(0)
  /** 썸네일을 그리는 카드 (경로) */
  const [live, setLive] = useState<ReadonlySet<string>>(() => new Set())
  // 다른 폴더로 바뀌면 처음부터
  const [forPath, setForPath] = useState(entry.path)
  if (forPath !== entry.path) {
    setForPath(entry.path)
    setActive(0)
    setLive(new Set())
  }

  const hasItems = items.length > 0
  /** 문서가 없는 폴더에서 새 문서를 못 만드는 이유 (DESIGN §35) — 읽기 전용으로 가져온 폴더 · 파일 하나만 가져온 곳 */
  const blocked = store.inFileRoot(entry.path) ? '파일 하나만 가져온 곳이라 새 문서를 만들 수 없습니다' : store.readOnlyReason(entry.path) === 'mount' ? '읽기 전용으로 가져온 폴더라 새 문서를 만들 수 없습니다 — 트리에서 폴더를 오른쪽 클릭 → 읽기 전용 끄기' : null
  const canCreate = files === 0 && !!onNewFile && !blocked
  const emptyNote = (text: string) => (
    <div className="quicklook-folder-empty">
      <p>{text}</p>
      {files === 0 && (blocked
        ? <p className="quicklook-folder-why">🔒 {blocked}</p>
        : onNewFile && (
          <button className="quicklook-folder-new" onMouseDown={(e) => e.preventDefault()} onClick={() => onNewFile(entry.path)} tabIndex={-1}>
            새 문서 <kbd>{hasItems ? keysOf('newFile') : 'Enter'}</kbd>
          </button>
        ))}
    </div>
  )
  // 열 수 = 격자 너비로
  useLayoutEffect(() => {
    const g = grid.current
    if (!g) return
    const update = () => setCols(gridColumns(g.clientWidth, CARD_MIN_WIDTH * zoom))
    update()
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(update)
    ro.observe(g)
    return () => ro.disconnect()
  }, [hasItems, zoom])

  // 보이는 카드만 그린다 (root = 창의 스크롤 상자)
  useEffect(() => {
    const g = grid.current
    if (!g || typeof IntersectionObserver !== 'function') return
    const root = box.current?.closest('.quicklook-scroll') ?? null
    const change = (add: string[], remove: string[]) => {
      if (!add.length && !remove.length) return
      setLive((s) => {
        let n: Set<string> | null = null
        for (const p of add) if (!s.has(p)) (n ??= new Set(s)).add(p)
        for (const p of remove) if ((n ?? s).has(p)) (n ??= new Set(s)).delete(p)
        return n ?? s
      })
    }
    const near = new IntersectionObserver((es) => change(es.filter((e) => e.isIntersecting).map(pathOf), []), { root, rootMargin: NEAR_MARGIN })
    const far = new IntersectionObserver((es) => change([], es.filter((e) => !e.isIntersecting).map(pathOf)), { root, rootMargin: FAR_MARGIN })
    for (const c of g.querySelectorAll<HTMLElement>('[data-card="file"]')) { near.observe(c); far.observe(c) }
    return () => { near.disconnect(); far.disconnect() }
  }, [items])

  const cardAt = (i: number) => grid.current?.querySelector<HTMLElement>(`[data-index="${i}"]`) ?? null
  const focusCard = (i: number) => {
    const el = cardAt(i)
    if (!el) return
    setActive(i)
    el.focus({ preventScroll: true })
    // 첫 줄이면 머리(폴더 이름 · 수)까지 보이게 맨 위로
    const view = box.current?.closest('.quicklook-scroll')
    if (view && i < cols) view.scrollTop = 0
    else el.scrollIntoView({ block: 'nearest' })
  }
  /** 지금 고른 카드 — 포커스된 카드에서 읽는다 (키 반복이 다시 그리기보다 빠르면 state 가 늦다) */
  const current = () => {
    const el = document.activeElement as HTMLElement | null
    const i = el && grid.current?.contains(el) && el.dataset.index !== undefined ? Number(el.dataset.index) : active
    return i >= 0 && i < items.length ? i : 0
  }

  // 들어올 때 (트리의 Tab · 폴더를 옮겼을 때) 첫 카드로
  useLayoutEffect(() => {
    if (!focusToken) return
    if (cardAt(0)) focusCard(0)
    else box.current?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken])

  /** 고른 카드가 사라지기 전에 포커스를 격자 상자로 옮겨 둔다 — 포커스가 body 로 빠지면 창이 닫힌다 */
  const hold = () => box.current?.focus({ preventScroll: true })
  const choose = (it: TreeEntry) => {
    onPick?.(it)
    if (it.type === 'dir') hold()
  }
  const indexOf = (t: EventTarget) => {
    const el = (t as Element).closest?.('[data-index]') as HTMLElement | null
    return el ? Number(el.dataset.index) : -1
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.ctrlKey || e.altKey || e.metaKey) return
    if (isGridKey(e.key) && !e.shiftKey) {
      e.preventDefault()
      if (!hasItems) return
      const view = box.current?.closest('.quicklook-scroll')
      const i = current()
      const card = cardAt(i)
      const rows = pageRowsOf(view?.clientHeight ?? 0, card ? card.offsetHeight + CARD_GAP : 0)
      focusCard(gridMove(i, items.length, cols, e.key, rows))
      return
    }
    switch (e.key) {
      case 'Enter': {
        e.preventDefault()
        // 빈 폴더는 Enter 가 새 문서 — 고를 카드가 없다
        if (!hasItems) { if (!e.repeat && canCreate) onNewFile?.(entry.path); return }
        const it = items[current()]
        if (!e.repeat && it) choose(it)
        return
      }
      case 'Backspace':
        e.preventDefault()
        if (!e.repeat && onUp?.()) hold()
        return
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        onBack?.()
        return
      case 'Tab':
        // 창은 body 끝에 붙어 있어 다음 Tab 이 브라우저 밖으로 나간다 → 격자 안에 둔다. Shift+Tab 은 트리로
        e.preventDefault()
        if (e.shiftKey) onBack?.()
        return
      case ' ':
        e.preventDefault()
        return
      default:
        return
    }
  }

  return (
    <div
      className="quicklook-folder"
      ref={box}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onFocus={(e) => { const i = indexOf(e.target); if (i >= 0) setActive(i) }}
      onDoubleClick={(e) => { const i = indexOf(e.target); if (i >= 0 && items[i]) choose(items[i]) }}
    >
      <div className="quicklook-folder-head">
        <span className="quicklook-folder-name">📁 {entry.path ? entry.name : '(루트)'}</span>
        <span className="quicklook-folder-count">폴더 {dirs} · 문서 {files}</span>
      </div>
      {!hasItems ? (
        emptyNote('이 폴더는 비어 있습니다')
      ) : (
        <>
          {files === 0 && emptyNote('이 폴더 바로 아래에는 문서가 없습니다')}
          <div
            className="ql-grid"
            ref={grid}
            role="listbox"
            aria-label={`${entry.path || '(루트)'} 의 항목`}
            // 100% 는 너비를 고르게 채운다. 그 밖의 배율은 카드 너비를 배율대로 고정한다 — 채우면 열 수가 바뀔 때만 크기가 달라져 한 단계가 눈에 안 보인다
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, ${zoom === 1 ? '1fr' : `min(${Math.round(CARD_MIN_WIDTH * zoom)}px, 100%)`}))`, gap: CARD_GAP }}
          >
            {items.map((it, i) => <GridCard key={it.path} item={it} index={i} active={i === active} live={live.has(it.path)} />)}
          </div>
        </>
      )}
    </div>
  )
}

interface GridCardProps { item: TreeEntry; index: number; active: boolean; live: boolean }

const GridCard = memo(function GridCard({ item, index, active, live }: GridCardProps) {
  const isDir = item.type === 'dir'
  const m = item.mount
  const icon = isDir ? (m ? (m.readOnly ? '🔒' : '🔗') : '📁') : fileTypeOf(item.name)?.icon ?? '·'
  return (
    <div
      className={'ql-card' + (isDir ? ' is-dir' : '')}
      role="option"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-index={index}
      data-path={item.path}
      data-card={isDir ? 'dir' : 'file'}
      title={item.path}
    >
      {isDir ? <DirFrame entry={item} icon={icon} /> : live ? <DocThumb path={item.path} weight="light" /> : <div className="doc-thumb ql-blank" />}
      <div className="ql-card-name"><span className="ql-card-icon">{isDir ? '' : icon}</span>{item.name}</div>
    </div>
  )
})

function DirFrame({ entry, icon }: { entry: TreeEntry; icon: string }) {
  const { dirs, files } = folderCounts(entry.children)
  return (
    <div className="doc-thumb ql-dir">
      <span className="ql-dir-icon">{icon}</span>
      <span className="ql-dir-count">{dirs > 0 && <>폴더 {dirs}<br /></>}문서 {files}</span>
    </div>
  )
}
