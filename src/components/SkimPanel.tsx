import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type MutableRefObject, type RefObject } from 'react'
import { EditorView } from '@codemirror/view'
import { LINE_ATTR } from '../lib/md/sourceLines'
import { editorRange, editorScrollToLine, measurePreview } from '../lib/skim/scrollPos'
import { PAGE_WIDTH } from '../lib/skim'
import { blockAtLine, blockLineAtY, buildLineMap, followScroll, lineAtY, rangeBox, yAtLine, type LineBlock, type LineMap } from '../lib/skim/lineMap'
import { SKIM_WIDTH_BIG_STEP, SKIM_WIDTH_MAX, SKIM_WIDTH_MIN, SKIM_WIDTH_STEP, nudgeSkimPanelWidth, setSkimPanelWidth, useSkimPanelState } from '../lib/skim/panel'
import { store, useDocVersion } from '../store/documents'
import { DocView } from './DocView'
import './SkimPanel.css'

/**
 * 훑어보기 패널 (PLAN-skim Phase C · SK5 ~ SK7). md · txt 편집 중 `.md-body` 오른쪽에 붙는 띠.
 *
 * 문서 전체를 종이 너비(794px)로 그려 패널 너비에 맞게 줄인 긴 한 장이다. 패널 안에서 스크롤한다.
 * - 누르면 그 조각의 원문 줄로 편집기 커서를 옮긴다 (포커스는 편집기).
 * - 편집기가 지금 보여 주는 줄 범위를 상자로 그린다. 편집기를 스크롤하면 상자가 움직이고 패널이 따라온다.
 * - 상자를 끌면 편집기가 스크롤된다.
 * - 커서가 든 조각 옆에 얇은 선.
 * - 미리보기 전용 모드에서는 편집기 대신 미리보기의 스크롤을 따른다 (미리보기가 그때만 `data-line` 을 찍는다).
 *
 * 줄 ↔ 위치 계산은 `lib/skim/lineMap.ts` (순수 함수). 여기는 재고(조각의 위치) 그리는 일만 한다.
 * 상자 · 커서 선 · 높이는 state 를 거치지 않고 DOM 에 바로 쓴다 — 스크롤할 때마다 다시 그리지 않게.
 */

export type SkimPanelMode = 'source' | 'hybrid' | 'preview' | 'split'

export interface SkimPanelProps {
  path: string
  mode: SkimPanelMode
  /** 이 창의 편집기. 아직 없으면 null */
  view: EditorView | null
  /** 편집기가 바뀌었을 때(글 · 커서 · 줄 높이) 불릴 함수를 패널이 여기에 넣는다 — `MarkdownPane` 의 updateListener 가 부른다 */
  ping: MutableRefObject<(() => void) | null>
  /** `.md-body` — 미리보기 전용 모드의 미리보기(`.preview`)를 여기서 찾는다 */
  body: RefObject<HTMLElement | null>
}

/** 글자를 친 뒤 패널을 다시 그리기까지 기다리는 시간 (ms). 마지막 렌더가 오래 걸렸으면 그 3배까지 늘린다 */
export const SKIM_DEBOUNCE_MS = 300
export const SKIM_DEBOUNCE_MAX_MS = 1500
/**
 * 다시 그리는 데 이보다 오래 걸리는 문서는 자동으로 다시 그리지 않는다 (ms) — 안내와 "새로 고침" 버튼을 띄운다.
 * 문서 통째로 다시 그리므로(SK5) 긴 md 는 그릴 때마다 입력이 그만큼 멎는다. 크기가 아니라 잰 시간으로 정한다 — 같은 줄 수라도 내용 · 기계에 따라 다르다
 */
export const SKIM_PAUSE_MS = 400
/** 범위 상자의 가장 작은 높이 (px) — 너무 얇으면 잡을 수 없다 */
const BOX_MIN = 10
/** 패널이 상자를 따라갈 때 상자 위아래에 두는 여유 (px) */
const FOLLOW_MARGIN = 12
/** 이만큼(px) 움직여야 끌기다. 그보다 적으면 클릭 */
const DRAG_SLOP = 4

/** 패널 안은 포커스 · 클릭을 받지 않는다 (React 18 은 inert 를 모르는 속성으로 넘긴다 — 빈 문자열이어야 붙는다) */
const INERT = { inert: '' } as HTMLAttributes<HTMLDivElement>

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// ---------------------------------------------------------------- 편집기 · 미리보기 쪽
/** 패널이 따라가는 쪽 — 편집기, 미리보기 전용 모드에서는 미리보기 */
interface Driver {
  /** 지금 보이는 줄 범위 (소수 줄). 화면에 없으면 null */
  range(): { first: number; last: number } | null
  /** 커서가 있는 줄. 보여 줄 커서가 없으면 null */
  cursorLine(): number | null
  /** 그 줄(소수)이 화면 맨 위에 오게 스크롤한다 */
  scrollTo(line: number): void
  /** 그 줄로 커서를 옮기고 보이게 한 뒤 포커스를 준다 */
  reveal(line: number): void
}

function setCursor(view: EditorView, line: number, scroll: boolean) {
  const doc = view.state.doc
  const pos = doc.line(clamp(Math.floor(line), 1, doc.lines)).from
  view.dispatch({ selection: { anchor: pos }, effects: scroll ? EditorView.scrollIntoView(pos, { y: 'center' }) : undefined })
}

function editorDriver(view: EditorView): Driver {
  return {
    range: () => editorRange(view),
    cursorLine() {
      const s = view.state
      return s.doc.lineAt(s.selection.main.head).number
    },
    scrollTo: (line) => editorScrollToLine(view, line),
    reveal(line) {
      setCursor(view, line, true)
      view.focus()
    },
  }
}

/**
 * 미리보기 전용 모드 — 편집기가 숨겨져 있으니 미리보기의 스크롤을 따른다.
 * 미리보기의 조각 위치는 스크롤할 때마다 재지 않고, 내용 · 크기가 바뀔 때만 다시 잰다 (`invalidate`).
 */
function previewDriver(el: HTMLElement, view: EditorView | null): Driver & { invalidate(): void } {
  let map: LineMap | null = null
  const measure = (): LineMap => (map ??= measurePreview(el, view?.state.doc.lines ?? 1))
  return {
    invalidate() { map = null },
    range() {
      if (el.clientHeight <= 0) return null
      const m = measure()
      return { first: lineAtY(m, el.scrollTop), last: lineAtY(m, el.scrollTop + el.clientHeight) }
    },
    cursorLine: () => null,
    scrollTo(line) { el.scrollTop = yAtLine(measure(), line) },
    reveal(line) {
      // 보기 모드를 소스로 돌렸을 때 그 자리에 있게 편집기 커서도 옮겨 둔다 (숨겨져 있어 스크롤은 하지 않는다)
      if (view) setCursor(view, line, false)
      el.scrollTop = Math.max(0, yAtLine(measure(), line) - FOLLOW_MARGIN)
      el.focus({ preventScroll: true })
    },
  }
}

// ---------------------------------------------------------------- 패널
export function SkimPanel({ path, mode, view, ping, body }: SkimPanelProps) {
  useDocVersion(path)
  const { width, refresh: refreshTick } = useSkimPanelState()
  const d = store.get(path)
  // 스토어의 지금 글 (저장 전 편집 포함). Text 는 불변이라 편집마다 새 객체다
  const text = d?.kind === 'text' && d.status === 'ready' ? d.text : null
  const latest = useRef(text)
  latest.current = text

  /** 마지막으로 패널을 다시 그리는 데 걸린 시간 (ms) — 파싱 + React 렌더 + DOM 반영 + 배치 */
  const cost = useRef(0)
  /** 지금 그려져 있는 글. 글자를 칠 때마다가 아니라 치다가 멈춘 뒤에 따라간다 (디바운스) */
  const [shown, setShown] = useState(text)
  /** 다시 그리는 데 `SKIM_PAUSE_MS` 넘게 걸린 문서 — 자동으로 다시 그리지 않고 "새로 고침"을 기다린다 (그릴 때마다 입력이 그만큼 멎는다) */
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (text === shown || paused) return
    // 마지막 렌더가 오래 걸렸으면 그 3배까지 기다린다 — 느린 문서일수록 드물게 그린다
    const t = window.setTimeout(() => setShown(text), clamp(cost.current * 3, SKIM_DEBOUNCE_MS, SKIM_DEBOUNCE_MAX_MS))
    return () => window.clearTimeout(t)
  }, [text, shown, paused])
  const refresh = useCallback(() => setShown(latest.current), [])
  // 팔레트의 "훑어보기 패널 새로 고침" (켜져 있는 패널 모두)
  const seenTick = useRef(refreshTick)
  useEffect(() => {
    if (seenTick.current === refreshTick) return
    seenTick.current = refreshTick
    refresh()
  }, [refreshTick, refresh])
  const stale = text !== shown

  const source = useMemo(() => (shown ? shown.toString() : ''), [shown])
  const lineCount = shown ? shown.lines : 1

  const panel = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const boxEl = useRef<HTMLDivElement>(null)
  const cursorEl = useRef<HTMLDivElement>(null)

  const scale = useRef(0)
  /** 조각 위치 지도. null 이면 다음에 쓸 때 다시 잰다 */
  const map = useRef<LineMap | null>(null)
  const lines = useRef(lineCount)
  lines.current = lineCount
  const driver = useRef<Driver | null>(null)
  /** 지금 그려진 범위 상자 (패널 내용 좌표). 없으면 null */
  const box = useRef<{ top: number; height: number } | null>(null)
  /**
   * 패널이 상자를 따라가고 있는가. 편집기가 움직이면 켜지고, 패널을 직접 굴리면(휠 · 터치) 꺼진다.
   * 켜져 있는 동안에는 내용 높이가 뒤늦게 바뀌어도(화면 밖 조각이 그려질 때 · 그림이 뜰 때) 상자가 패널 안에 남게 다시 따라간다
   */
  const pinned = useRef(true)

  // 그리는 데 걸린 시간을 잰다: 새 글로 렌더가 시작될 때부터 DOM 에 반영될 때까지
  const renderedFor = useRef<typeof shown | undefined>(undefined)
  const renderStart = useRef(0)
  if (renderedFor.current !== shown) renderStart.current = performance.now()

  const measure = useCallback((): LineMap => {
    if (map.current) return map.current
    const p = page.current
    const s = scale.current
    const blocks: LineBlock[] = []
    if (p && s > 0) {
      for (const el of p.querySelectorAll<HTMLElement>(`.doc-view > [${LINE_ATTR}]`)) {
        const top = el.offsetTop
        blocks.push({ line: Number(el.getAttribute(LINE_ATTR)), top: top * s, bottom: (top + el.offsetHeight) * s })
      }
    }
    map.current = buildLineMap(blocks, (p?.offsetHeight ?? 0) * s, lines.current)
    return map.current
  }, [])

  /** 축소 배율과 바깥 상자의 높이를 맞춘다 — transform 은 자리를 줄이지 않으므로 높이는 직접 준다 */
  const fit = useCallback(() => {
    const sc = scroller.current
    const p = page.current
    const sh = sheet.current
    if (!sc || !p || !sh) return
    const w = sc.clientWidth
    if (w <= 0) return // 숨은 탭 — 보이게 되면 ResizeObserver 가 다시 부른다
    const s = w / PAGE_WIDTH
    if (s !== scale.current) {
      scale.current = s
      p.style.transform = `scale(${s})`
    }
    sh.style.height = `${Math.ceil(p.offsetHeight * s)}px`
    map.current = null
  }, [])

  /** 범위 상자와 커서 선을 지금 상태에 맞춘다. follow: 상자가 패널 밖이면 패널을 스크롤한다 */
  const sync = useCallback((follow: boolean) => {
    const sc = scroller.current
    const bx = boxEl.current
    const cur = cursorEl.current
    if (!sc || !bx || !cur || sc.clientWidth <= 0 || scale.current <= 0) return
    // 읽기를 모두 먼저 하고 쓰기는 뒤에 몰아서 한다 — 쓰고 나서 읽으면 그때마다 브라우저가 배치를 다시 잡는다 (스크롤할 때마다 도는 길이다)
    const m = measure()
    const drv = driver.current
    const range = drv?.range() ?? null
    const line = drv?.cursorLine() ?? null
    const b = range ? rangeBox(m, range.first, range.last, BOX_MIN) : null
    box.current = b
    if (follow) pinned.current = true
    if (b && pinned.current) {
      const top = sc.scrollTop
      const viewHeight = sc.clientHeight
      const next = followScroll(top, viewHeight, b.top, b.height, sc.scrollHeight - viewHeight, FOLLOW_MARGIN)
      if (Math.abs(next - top) >= 1) sc.scrollTop = next
    }
    if (!b) bx.hidden = true
    else {
      bx.hidden = false
      bx.style.top = `${b.top}px`
      bx.style.height = `${b.height}px`
    }
    const blk = line === null ? null : blockAtLine(m, line)
    if (!blk) cur.hidden = true
    else {
      cur.hidden = false
      cur.style.top = `${blk.top}px`
      cur.style.height = `${Math.max(2, blk.bottom - blk.top)}px`
    }
  }, [measure])

  // 한 프레임에 한 번만 맞춘다 (스크롤 · 커서 · 크기 변화가 한꺼번에 와도)
  const raf = useRef(0)
  const wantFollow = useRef(false)
  const schedule = useCallback((follow: boolean) => {
    if (follow) wantFollow.current = true
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      const f = wantFollow.current
      wantFollow.current = false
      sync(f)
    })
  }, [sync])
  // 0 으로 돌려 놓아야 한다 — 개발 빌드의 StrictMode 는 effect 를 한 번 내렸다 다시 올리는데, 번호가 남으면 그 뒤로 영영 예약되지 않는다
  useEffect(() => () => { cancelAnimationFrame(raf.current); raf.current = 0 }, [])

  // 새 글을 그렸으면(화면에 나오기 전에) 걸린 시간을 적고 크기를 맞춘다.
  // 이 컴포넌트는 글자를 칠 때마다 다시 그려지지만(스토어 구독) 그때는 아무것도 재지 않는다 — 글(shown) · 너비가 바뀔 때만
  useLayoutEffect(() => {
    const fresh = renderedFor.current !== shown
    const t0 = performance.now()
    fit()
    sync(false)
    if (fresh) {
      // 파싱 + React 렌더 + DOM 반영, 그리고 배치를 다시 잡아 조각을 재는 데 걸린 시간 — 다음 디바운스가 이 값을 본다.
      // 재 볼 수 있게 패널에 적어 둔다 (data-render-ms · data-fit-ms)
      const t1 = performance.now()
      const first = renderedFor.current === undefined
      renderedFor.current = shown
      cost.current = t1 - renderStart.current
      if (panel.current) {
        panel.current.dataset.renderMs = (t0 - renderStart.current).toFixed(1)
        panel.current.dataset.fitMs = (t1 - t0).toFixed(1)
      }
      // 오래 걸렸으면 자동 갱신을 멈춘다. 새로 고친 뒤 빨라졌으면(글이 줄었다) 다시 따라간다.
      // 처음 그릴 때는 한 번뿐인 일(Mermaid 불러오기 등)이 섞이므로 두 배를 넘을 때만 멈춘다 — 그 사이의 문서는 한 번 다시 그려 보고 정한다
      // 한번 멈춘 문서는 새로 고친 렌더가 절반 아래로 내려와야 다시 따라간다 — 경계에 걸친 문서가 켜졌다 꺼졌다 하지 않게
      const ms = cost.current
      setPaused((was) => ms > (first ? SKIM_PAUSE_MS * 2 : was ? SKIM_PAUSE_MS / 2 : SKIM_PAUSE_MS))
    }
  }, [shown, width, fit, sync])

  // 패널 너비가 바뀌거나 내용 높이가 뒤늦게 바뀌면(Mermaid · 그림 · tsv-view · 화면 밖 조각이 그려질 때) 다시 맞춘다
  useEffect(() => {
    const sc = scroller.current
    const p = page.current
    if (!sc || !p || typeof ResizeObserver !== 'function') return
    let id = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(id)
      id = requestAnimationFrame(() => { fit(); sync(false) })
    })
    ro.observe(sc)
    ro.observe(p)
    return () => {
      cancelAnimationFrame(id)
      ro.disconnect()
    }
  }, [fit, sync])

  // 따라갈 쪽을 고르고 그 스크롤 · 변화를 구독한다
  useEffect(() => {
    const preview = mode === 'preview' ? body.current?.querySelector<HTMLElement>('.preview') ?? null : null
    if (preview) {
      const drv = previewDriver(preview, view)
      driver.current = drv
      const onScroll = () => schedule(true)
      const changed = () => { drv.invalidate(); schedule(false) }
      preview.addEventListener('scroll', onScroll, { passive: true })
      const inner = preview.querySelector('.preview-body')
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(changed) : null
      ro?.observe(preview)
      if (inner) ro?.observe(inner)
      // 높이는 그대로인데 줄 번호만 바뀌는 편집도 있다 (빈 줄을 지운다)
      const mo = new MutationObserver(changed)
      if (inner) mo.observe(inner, { childList: true, subtree: true, attributes: true, attributeFilter: [LINE_ATTR] })
      ping.current = changed
      schedule(true)
      return () => {
        preview.removeEventListener('scroll', onScroll)
        ro?.disconnect()
        mo.disconnect()
        ping.current = null
        driver.current = null
      }
    }
    if (!view || mode === 'preview') {
      driver.current = null
      schedule(false)
      return
    }
    driver.current = editorDriver(view)
    const onScroll = () => schedule(true)
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    ping.current = () => schedule(true)
    schedule(true)
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScroll)
      ping.current = null
      driver.current = null
    }
  }, [mode, view, body, ping, schedule])

  // ---- 누르기 · 끌기. 안의 내용은 inert 라 눌린 조각을 이벤트로는 알 수 없다 → 누른 높이로 찾는다
  const drag = useRef<{ id: number; startY: number; grab: number; onBox: boolean; moved: boolean } | null>(null)
  const sheetY = (clientY: number) => clientY - (sheet.current?.getBoundingClientRect().top ?? 0)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const y = sheetY(e.clientY)
    const b = box.current
    const onBox = !!b && y >= b.top && y <= b.top + b.height
    drag.current = { id: e.pointerId, startY: e.clientY, grab: b ? y - b.top : 0, onBox, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = drag.current
    if (!g || g.id !== e.pointerId) return
    if (!g.moved) {
      if (Math.abs(e.clientY - g.startY) < DRAG_SLOP) return
      g.moved = true
      if (g.onBox) panel.current?.classList.add('is-dragging')
    }
    // 상자를 끈다 → 상자의 위 끝이 놓일 줄로 편집기를 스크롤한다 (편집기의 scroll 이벤트가 상자를 다시 그린다)
    if (g.onBox) driver.current?.scrollTo(lineAtY(measure(), sheetY(e.clientY) - g.grab))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = drag.current
    if (!g || g.id !== e.pointerId) return
    drag.current = null
    panel.current?.classList.remove('is-dragging')
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (e.type === 'pointercancel' || g.moved) return
    driver.current?.reveal(blockLineAtY(measure(), sheetY(e.clientY)))
  }

  // ---- 너비 손잡이 (왼쪽 가장자리). 끌거나, 포커스를 주고 ← →
  const resize = useRef<{ id: number; startX: number; startWidth: number } | null>(null)
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    resize.current = { id: e.pointerId, startX: e.clientX, startWidth: panel.current?.offsetWidth ?? width }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resize.current
    if (r && r.id === e.pointerId) setSkimPanelWidth(r.startWidth + r.startX - e.clientX)
  }
  const onResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (resize.current?.id !== e.pointerId) return
    resize.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const onResizeKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    const step = e.shiftKey ? SKIM_WIDTH_BIG_STEP : SKIM_WIDTH_STEP
    // 손잡이는 패널의 왼쪽 가장자리다 — ← 는 손잡이를 왼쪽으로(넓힌다), → 는 오른쪽으로(좁힌다)
    if (e.key === 'ArrowLeft') nudgeSkimPanelWidth(step)
    else if (e.key === 'ArrowRight') nudgeSkimPanelWidth(-step)
    else if (e.key === 'Home') setSkimPanelWidth(SKIM_WIDTH_MAX)
    else if (e.key === 'End') setSkimPanelWidth(SKIM_WIDTH_MIN)
    else return
    e.preventDefault()
  }

  return (
    <div className="skim-panel" ref={panel} style={{ width }} role="complementary" aria-label="훑어보기 패널">
      <div
        className="skim-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="훑어보기 패널 너비 — ← 넓히기, → 좁히기"
        aria-valuemin={SKIM_WIDTH_MIN}
        aria-valuemax={SKIM_WIDTH_MAX}
        aria-valuenow={width}
        tabIndex={0}
        title="끌어서 너비를 바꾼다 (포커스를 주고 ← →)"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
        onKeyDown={onResizeKey}
      />
      {paused && (
        // 버튼을 마우스로 눌러도 포커스는 편집기에 남는다. 키보드로는 Tab 으로 버튼에 오거나 팔레트의 "훑어보기 패널 새로 고침"
        <div className="skim-paused" role="status" onMouseDown={(e) => e.preventDefault()}>
          <span>문서가 커서 자동으로 다시 그리지 않습니다.{stale ? ' 바뀐 내용이 있습니다.' : ''}</span>
          <button onClick={refresh} disabled={!stale} title="지금 내용으로 패널을 다시 그린다 (명령 팔레트: 훑어보기 패널 새로 고침)">새로 고침</button>
        </div>
      )}
      {/* mousedown 을 막아 포커스가 편집기에 남게 한다 (패널은 포커스를 받지 않는다) */}
      <div
        className="skim-scroll"
        ref={scroller}
        onMouseDown={(e) => e.preventDefault()}
        onWheel={() => { pinned.current = false }}
        onTouchMove={() => { pinned.current = false }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="skim-sheet" ref={sheet}>
          <div className="skim-page" ref={page} style={{ width: PAGE_WIDTH }} {...INERT}>
            <DocView path={path} text={source} lines />
          </div>
          <div className="skim-cursor" ref={cursorEl} hidden />
          <div className="skim-range" ref={boxEl} hidden />
        </div>
      </div>
    </div>
  )
}
