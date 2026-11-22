import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { backend } from '../lib/backend'
import { openPath } from '../lib/nav'
import { crumbsOf, filterByLabel, listDir, listRoots, parentDir } from '../lib/pathbar'
import { isMountPath } from '../lib/roots.mjs'
import { store } from '../store/documents'
import './PathBar.css'

/**
 * 경로 막대 (ADOPT A1 · DESIGN §31). 문서 창 막대의 `루트 › 폴더 › 파일 › 제목` 한 줄.
 *
 * - 단계를 누르면(키보드는 `Enter` · `↓`) 그 단계의 이웃 목록이 뜬다 — 폴더 · 파일은 같은 폴더의 항목, 마지막 단계는
 *   마크다운의 제목 · 표의 열 · `_Field` 의 블록. 글자를 치면 거른다.
 * - 목록에서 폴더를 고르면 그 안으로 들어가고(`→` 도), `←` · `Backspace`(거르는 글자가 없을 때)는 상위 폴더로.
 *   파일을 고르면 그 문서를 열고 그 창으로 포커스.
 * - 막대 안: `← / →` 단계 이동, `Esc` 편집기로. `Ctrl+Shift+.` 로 들어오면 마지막 단계에 포커스.
 * - 폴더 목록은 트리의 파일 경로(`store.filePaths()`)에서 목록을 열 때만 뽑는다 — 평소에는 아무것도 계산하지 않는다.
 */

export interface TailItem {
  label: string
  /** 들여쓰기 단계 (제목 단계) */
  depth?: number
  /** 고르면 할 일 — 그 자리로 가고 문서 창으로 포커스 */
  run: () => void
}

/** 마지막 단계 — 문서 안의 자리 (제목 · 열 · 블록) */
export interface PathTail {
  /** 목록의 이름 (`제목` · `열` · `블록`) */
  name: string
  /** 지금 자리. 없으면 null — `empty` 를 흐리게 보인다 */
  label: string | null
  empty: string
  /** 목록을 열 때 부른다 */
  list(): { items: TailItem[]; current: number }
}

interface Props {
  path: string
  tail?: PathTail | null
  /** `Esc` — 이 창의 편집기 · 그리드로 */
  onExit: () => void
}

/** 목록에 그리는 최대 항목 수 — Unity 폴더처럼 큰 폴더에서도 가볍게. 나머지는 글자로 거른다 */
const MAX_SHOWN = 300
const PAGE = 10

type Open = { kind: 'dir'; seg: number; dir: string | null } | { kind: 'tail'; seg: number }

interface Row {
  key: string
  label: string
  depth: number
  isDir: boolean
  /** 지금 문서가 이 항목(또는 그 아래)에 있다 */
  current: boolean
  act: () => void
}

export function PathBar({ path, tail, onExit }: Props) {
  const mainLabel = backend().rootDetail(null).label
  const crumbs = useMemo(() => crumbsOf(path, mainLabel), [path, mainLabel])
  const tailSeg = tail ? crumbs.length : -1
  const last = crumbs.length - (tail ? 0 : 1)
  /** 키보드 커서가 있는 단계. null 은 마지막 단계 — 막대 밖에 있을 때 (마지막 단계는 편집기가 준비된 뒤에 생기기도 한다) */
  const [cur, setCur] = useState<number | null>(null)
  const seg = cur === null ? last : Math.min(cur, last)
  const [open, setOpen] = useState<Open | null>(null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listEl = useRef<HTMLDivElement>(null)
  // 부모는 글 · 커서가 바뀔 때마다 새 tail 을 만든다 — 목록은 열 때의 것을 쓴다
  const tailRef = useRef(tail)
  tailRef.current = tail

  const segButton = (i: number) => bar.current?.querySelector<HTMLElement>(`[data-seg="${i}"]`) ?? null

  const close = (refocus: boolean) => {
    const at = open?.seg
    setOpen(null)
    setQuery('')
    if (refocus && at !== undefined) segButton(at)?.focus()
  }

  const openSeg = (i: number) => {
    setCur(i)
    setQuery('')
    if (i === tailSeg) setOpen({ kind: 'tail', seg: i })
    else setOpen({ kind: 'dir', seg: i, dir: crumbs[i].parent })
  }

  const descend = (dir: string | null) => {
    if (!open) return
    setOpen({ kind: 'dir', seg: open.seg, dir })
    setQuery('')
  }

  const rows = useMemo((): Row[] => {
    if (!open) return []
    if (open.kind === 'tail') {
      const t = tailRef.current
      if (!t) return []
      const { items, current } = t.list()
      return items.map((it, i) => ({ key: String(i), label: it.label, depth: it.depth ?? 0, isDir: false, current: i === current, act: () => { setOpen(null); setQuery(''); it.run() } }))
    }
    const files = store.filePaths()
    const entries = open.dir === null ? listRoots(files, mainLabel) : listDir(files, open.dir)
    const onPath = (p: string) => (p === '' ? !isMountPath(path) : path === p || path.startsWith(p + '/'))
    return entries.map((e) => ({
      key: e.path,
      label: e.name,
      depth: 0,
      isDir: e.isDir,
      current: onPath(e.path),
      act: e.isDir
        ? () => descend(e.path)
        : () => {
          setOpen(null)
          setQuery('')
          if (e.path === path) onExit()
          else openPath(e.path, undefined, true)
        },
    }))
    // descend · onExit 는 열린 상태(open)만 읽는다 — open 이 바뀌면 다시 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, path, mainLabel])

  const filtered = useMemo(() => filterByLabel(rows, query, (r) => r.label), [rows, query])
  const shown = filtered.length > MAX_SHOWN ? filtered.slice(0, MAX_SHOWN) : filtered

  // 목록이 바뀌면(열기 · 폴더 이동) 지금 문서가 있는 항목에 커서. 거르는 글자가 바뀌면 맨 위
  useEffect(() => { setIndex(0) }, [query])
  useEffect(() => { setIndex(Math.max(0, rows.findIndex((r) => r.current))) }, [rows])

  // 목록 자리 — 누른 단계 바로 아래. 창 오른쪽을 넘지 않게
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const r = segButton(open.seg)?.getBoundingClientRect()
    if (!r) return
    setPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - 340)), top: r.bottom + 2 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.seg, open !== null])
  // 목록은 자리(pos)를 잰 다음 렌더에 생긴다 — 그때 입력 칸으로
  useEffect(() => { if (open && pos) input.current?.focus() }, [open, pos])

  useEffect(() => {
    const el = listEl.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [index, shown])

  // 막대 안에서 단계를 옮기면 그 단추로 포커스
  useEffect(() => {
    if (open || !bar.current?.contains(document.activeElement)) return
    segButton(seg)?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seg])

  /** 포커스가 막대 밖으로 나가면 목록을 닫고 커서를 마지막 단계로 (다음에 들어올 때 거기서 시작) */
  const onBlur = (e: FocusEvent) => {
    if (bar.current?.contains(e.relatedTarget as Node | null)) return
    setOpen(null)
    setQuery('')
    setCur(null)
  }

  const onSegKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target === input.current) return
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); setCur(Math.max(0, seg - 1)); break
      case 'ArrowRight': e.preventDefault(); setCur(Math.min(last, seg + 1)); break
      case 'Home': e.preventDefault(); setCur(0); break
      case 'End': e.preventDefault(); setCur(null); break
      case 'Enter': case 'ArrowDown': case ' ': e.preventDefault(); openSeg(seg); break
      case 'Escape': e.preventDefault(); e.stopPropagation(); onExit(); break
    }
  }

  const up = () => {
    if (open?.kind === 'dir' && open.dir !== null) descend(parentDir(open.dir))
  }

  const onListKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    const n = shown.length
    const move = (to: number) => { e.preventDefault(); setIndex(Math.max(0, Math.min(n - 1, to))) }
    const row = shown[index]
    switch (e.key) {
      case 'ArrowDown': move(index + 1); break
      case 'ArrowUp': move(index - 1); break
      case 'PageDown': move(index + PAGE); break
      case 'PageUp': move(index - PAGE); break
      case 'Home': if (!query) move(0); break
      case 'End': if (!query) move(n - 1); break
      case 'Enter': e.preventDefault(); row?.act(); break
      case 'ArrowRight': if (!query && row?.isDir) { e.preventDefault(); row.act() } break
      case 'ArrowLeft': case 'Backspace': if (!query && open?.kind === 'dir' && open.dir !== null) { e.preventDefault(); up() } break
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(true); break
      case 'Tab': e.preventDefault(); close(true); break
    }
  }

  const dirTitle = (dir: string | null) => (dir === null ? '루트' : dir === '' ? mainLabel : isMountPath(dir) ? dir : `${mainLabel}/${dir}`)

  return (
    <div className="path-bar" ref={bar} onBlur={onBlur}>
      <div className="path-crumbs" role="toolbar" aria-label="경로 막대 — ← → 로 단계, Enter 로 목록" onKeyDown={onSegKey}>
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="path-sep" aria-hidden>›</span>}
            <button
              className={`path-seg is-${c.kind}` + (open?.seg === i ? ' is-open' : '')}
              data-seg={i}
              tabIndex={i === seg ? 0 : -1}
              title={c.kind === 'file' ? path : `${c.label} — 눌러서 같은 단계의 항목 보기`}
              onMouseDown={(e) => { if (open?.seg === i) e.preventDefault() }}
              onClick={() => (open?.seg === i ? close(true) : openSeg(i))}
            >
              {c.label}
            </button>
          </Fragment>
        ))}
        {tail && (
          <>
            <span className="path-sep" aria-hidden>›</span>
            <button
              className={'path-seg is-tail' + (tail.label === null ? ' is-empty' : '') + (open?.seg === tailSeg ? ' is-open' : '')}
              data-seg={tailSeg}
              tabIndex={tailSeg === seg ? 0 : -1}
              title={`${tail.label ?? tail.empty} — 눌러서 ${tail.name} 목록`}
              onMouseDown={(e) => { if (open?.seg === tailSeg) e.preventDefault() }}
              onClick={() => (open?.seg === tailSeg ? close(true) : openSeg(tailSeg))}
            >
              {tail.label ?? tail.empty}
            </button>
          </>
        )}
      </div>
      {open && pos && (
        <div className="path-pop" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label={open.kind === 'tail' ? `${tail?.name ?? ''} 목록` : '폴더 항목'}>
          <div className="path-pop-head">
            {open.kind === 'dir' && open.dir !== null && (
              <button className="path-pop-up" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={up} title="상위 폴더 (← · Backspace)">↑</button>
            )}
            <span className="path-pop-title">{open.kind === 'tail' ? tail?.name : dirTitle(open.dir)}</span>
          </div>
          <input
            ref={input}
            className="path-pop-input"
            value={query}
            placeholder="글자로 거르기"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onListKey}
            spellCheck={false}
            autoComplete="off"
            aria-activedescendant={shown.length ? `path-item-${index}` : undefined}
          />
          <div className="path-pop-list" ref={listEl} role="listbox">
            {shown.length === 0 && <div className="path-pop-empty">{rows.length === 0 ? (open.kind === 'tail' ? `${tail?.name ?? ''}이 없습니다` : '비어 있습니다') : '맞는 항목이 없습니다'}</div>}
            {shown.map((r, i) => (
              <div
                key={r.key}
                id={`path-item-${i}`}
                data-i={i}
                role="option"
                aria-selected={i === index}
                className={'path-item' + (i === index ? ' is-hl' : '') + (r.current ? ' is-current' : '') + (r.isDir ? ' is-dir' : '')}
                style={r.depth ? { paddingLeft: 12 + r.depth * 14 } : undefined}
                title={r.label}
                onMouseEnter={() => setIndex(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => r.act()}
              >
                {r.label}{r.isDir ? '/' : ''}
              </div>
            ))}
            {filtered.length > shown.length && <div className="path-pop-empty">… {filtered.length - shown.length}개 더 — 글자로 거르세요</div>}
          </div>
        </div>
      )}
    </div>
  )
}
