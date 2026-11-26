import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react'
import { EditorView } from '@codemirror/view'
import { activeIndex, outlineOf, sameOutline, type OutlineItem } from '../lib/md/outline'
import { noteLineJump } from '../lib/navHistory'
import { mdViewPathOf } from './mdContext'
import './OutlinePanel.css'

/**
 * 목차 띠 (DESIGN §29). 마크다운 창이 하이브리드 모드일 때 `.md-body` 왼쪽에 붙는다.
 *
 * - 제목은 편집기의 구문 트리에서 뽑는다(`lib/md/outline.ts`). 글이 바뀌면 잠시 뒤(THROTTLE_MS) 다시 뽑는다.
 * - 편집기 스크롤의 맨 위 줄이 든 절의 제목을 칠한다.
 * - 누르면 그 제목을 편집기 맨 위로 올리고 커서를 제목 글 앞에 둔다. 포커스는 편집기.
 * - 키보드: `Ctrl+Alt+T` 로 들어와 ↑ ↓ Home End PageUp PageDown 으로 고르고, Enter 는 가서 편집기로,
 *   Space 는 가기만 하고 목차에 남고, Esc 는 그냥 편집기로.
 * - 창이 좁으면 CSS(container query)가 숨긴다 — 그때 `focusRef` 는 false 를 돌려준다.
 */

export interface OutlinePanelProps {
  /** 이 창의 편집기. 아직 없으면 null */
  view: EditorView | null
  /** 글 · 구문 트리가 바뀌면 불릴 함수를 띠가 여기에 넣는다 — `MarkdownPane` 의 updateListener 가 부른다 */
  ping: MutableRefObject<(() => void) | null>
  /** 목차로 포커스를 옮기는 함수를 띠가 여기에 넣는다. 띠가 숨겨져 있으면 false */
  focusRef: MutableRefObject<(() => boolean) | null>
}

/** 글을 친 뒤 목차를 다시 뽑기까지 (ms) — 치는 동안에도 이 간격으로는 따라온다 */
const THROTTLE_MS = 150
/** 편집기 맨 위에서 이만큼(px) 아래의 줄로 지금 절을 정한다 — 눌러서 올린 제목이 바로 칠해지게 */
const TOP_SLACK = 12
/** 단계 하나의 들여쓰기 (px) */
const INDENT = 14
const PAGE = 10

export function OutlinePanel({ view, ping, focusRef }: OutlinePanelProps) {
  const [items, setItems] = useState<OutlineItem[]>([])
  const [active, setActive] = useState(-1)
  /** 키보드로 고른 항목. 목차에 포커스가 있을 때만 보인다 */
  const [cursor, setCursor] = useState(0)
  const [focused, setFocused] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  // 제목 뽑기 — 처음 한 번, 그 뒤로는 글 · 트리가 바뀔 때 THROTTLE_MS 에 한 번
  useEffect(() => {
    if (!view) { setItems([]); return }
    let timer: ReturnType<typeof setTimeout> | null = null
    const recompute = () => {
      timer = null
      const next = outlineOf(view.state)
      setItems((prev) => (sameOutline(prev, next) ? prev : next))
    }
    recompute()
    ping.current = () => { if (timer === null) timer = setTimeout(recompute, THROTTLE_MS) }
    return () => {
      ping.current = null
      if (timer !== null) clearTimeout(timer)
    }
  }, [view, ping])

  // 지금 절 — 편집기를 스크롤할 때 (한 프레임에 한 번)
  useEffect(() => {
    if (!view) return
    const scroller = view.scrollDOM
    let raf = 0
    const update = () => {
      raf = 0
      if (!view.dom.isConnected || scroller.clientHeight === 0) return
      const y = scroller.getBoundingClientRect().top - view.documentTop + TOP_SLACK
      const block = view.lineBlockAtHeight(Math.max(0, y))
      setActive(activeIndex(itemsRef.current, view.state.doc.lineAt(block.from).number))
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [view, items])

  // 목차가 줄었으면 키보드 커서를 안으로
  useEffect(() => { setCursor((c) => Math.min(c, Math.max(0, items.length - 1))) }, [items])

  // 칠한 항목(목차에 포커스가 있으면 키보드 커서)이 띠 안에 보이게 — 띠만 스크롤한다
  const shown = focused ? cursor : active
  useLayoutEffect(() => {
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>(`[data-i="${shown}"]`)
    if (!list || !el) return
    const top = el.offsetTop
    const bottom = top + el.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top - 4
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4
  }, [shown, items])

  useEffect(() => {
    focusRef.current = () => {
      const list = listRef.current
      if (!list || list.offsetParent === null) return false
      list.focus()
      return true
    }
    return () => { focusRef.current = null }
  }, [focusRef])

  const minLevel = useMemo(() => items.reduce((m, i) => Math.min(m, i.level), 6), [items])

  /** 그 제목으로 — 편집기 맨 위에 올리고 커서를 제목 글 앞에 */
  const go = (i: number, focusEditor: boolean) => {
    const it = items[i]
    if (!view || !it) return
    const pos = Math.min(it.textFrom, view.state.doc.length)
    // 뒤로 · 앞으로 (DESIGN §50) — 제목으로 뛴 것을 적는다
    const path = mdViewPathOf(view)
    if (path) noteLineJump(path, view.state.doc.lineAt(pos).number, view.state.doc.lineAt(view.state.selection.main.head).number)
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(Math.min(it.from, view.state.doc.length), { y: 'start', yMargin: 4 }) })
    setActive(i)
    if (focusEditor) view.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const last = items.length - 1
    const move = (to: number) => { e.preventDefault(); setCursor(Math.max(0, Math.min(last, to))) }
    switch (e.key) {
      case 'ArrowDown': move(cursor + 1); break
      case 'ArrowUp': move(cursor - 1); break
      case 'Home': move(0); break
      case 'End': move(last); break
      case 'PageDown': move(cursor + PAGE); break
      case 'PageUp': move(cursor - PAGE); break
      case 'Enter': if (e.altKey) break; e.preventDefault(); go(cursor, true); break // Alt+Enter 는 맥락 메뉴
      case ' ': e.preventDefault(); go(cursor, false); break
      case 'Escape': e.preventDefault(); e.stopPropagation(); view?.focus(); break
    }
  }

  return (
    <nav className="outline-panel" aria-label="목차">
      <div className="outline-head">목차</div>
      <div
        ref={listRef}
        className="outline-list"
        tabIndex={0}
        role="listbox"
        aria-label="목차 — ↑ ↓ 로 고르고 Enter 로 이동"
        aria-activedescendant={focused && items.length ? `outline-${cursor}` : undefined}
        onKeyDown={onKeyDown}
        onFocus={() => { setFocused(true); setCursor((c) => (active >= 0 ? active : Math.min(c, Math.max(0, items.length - 1)))) }}
        onBlur={() => setFocused(false)}
      >
        {items.length === 0 && <div className="outline-empty">제목이 없습니다 — <code>#</code> 으로 시작하는 줄이 목차에 나옵니다</div>}
        {items.map((it, i) => {
          const depth = it.level - minLevel
          return (
            <div
              key={i}
              id={`outline-${i}`}
              data-i={i}
              role="option"
              aria-selected={i === active}
              className={'outline-item' + (depth === 0 ? ' is-top' : '') + (i === active ? ' is-active' : '') + (focused && i === cursor ? ' is-cursor' : '')}
              style={{ paddingLeft: 10 + depth * INDENT }}
              title={it.text}
              // 누를 때 목차가 포커스를 가져가지 않게 — 포커스는 편집기로 간다
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setCursor(i); go(i, true) }}
            >
              {it.text || '(빈 제목)'}
            </div>
          )
        })}
      </div>
    </nav>
  )
}
