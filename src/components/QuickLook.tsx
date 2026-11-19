import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import type { TreeEntry } from '../lib/backend'
import { fileTypeOf } from '../lib/filetypes.mjs'
import { PAGE_RATIO, useSkimText } from '../lib/skim'
import { DocFileView } from './DocView'
import './QuickLook.css'

/**
 * 훑어보기 창 (PLAN-skim Phase D · SK11). 트리 커서의 항목을 열지 않고 트리 오른쪽에 크게 보여 준다.
 *
 * - 틀(`QuickLook`)과 내용이 나뉜다: 파일이면 `QuickLookFile`(DocFileView, rich, inert), 폴더면 `QuickLookFolder`.
 * - 포커스는 트리에 남는다. 열고 닫기 · 키는 트리(FileTree)가 한다 — 이 창은 그리기와 스크롤만.
 * - 틀 안을 마우스로 눌러도 포커스가 트리를 떠나지 않는다(mousedown 기본 동작을 막는다).
 *   예외는 폴더 쪽 내용 안의 포커스 받는 요소(`button` · `a` · `input` · `[tabindex]`) — Phase E 의 격자가 `Tab` · 클릭으로 포커스를 받는다.
 */

/** 커서가 빠르게 움직일 때(↓ 를 누르고 있을 때) 파일마다 읽고 그리지 않게 이만큼 늦춘다 */
export const QUICKLOOK_DELAY = 100

export interface QuickLookHandle {
  /** 창 안을 한 화면 위(-1) · 아래(1)로 */
  scrollPage(dir: 1 | -1): void
  /** 그 노드가 창 안에 있는가 — 트리가 포커스를 잃을 때 "창으로 간 것"인지 가린다 */
  contains(node: Node | null): boolean
}

export interface QuickLookProps {
  /** 보여 줄 항목 (트리 커서). 바뀌면 `QUICKLOOK_DELAY` 뒤에 따라간다 — 처음 열 때는 바로 */
  entry: TreeEntry
  /** 이 요소의 오른쪽에 뜬다 (파일 트리) */
  anchor: HTMLElement | null
  /** 포커스가 창 밖으로 나갔을 때 (Phase E: 격자에 들어간 포커스가 트리도 창도 아닌 곳으로 갔을 때) */
  onFocusOut?: (to: Element | null) => void
}

/** React 18 은 inert 를 모르는 속성으로 넘긴다 — 빈 문자열이어야 붙는다 (DocView 의 DocThumb 과 같다) */
const INERT = { inert: '' } as HTMLAttributes<HTMLDivElement>

const GAP = 8
const MIN_WIDTH = 280

interface Box { left: number; top: number; width: number; height: number }

/** 트리 오른쪽 · 화면 높이의 대부분 · 너비는 세로 A4 비율(높이 ÷ 1.414). 좁으면 남은 너비로 줄인다 */
function placeBox(anchor: HTMLElement | null): Box {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const r = anchor?.getBoundingClientRect()
  const top = Math.max(GAP, r ? r.top : GAP)
  const height = Math.max(160, vh - top - GAP * 2)
  let left = (r ? r.right : 0) + GAP
  const room = vw - left - GAP * 2
  let width = Math.min(Math.max(MIN_WIDTH, Math.round(height / PAGE_RATIO)), room)
  // 트리가 넓어 오른쪽에 자리가 없으면 화면 안으로 당긴다 (트리를 일부 가린다)
  if (room < MIN_WIDTH) {
    width = Math.min(MIN_WIDTH, vw - GAP * 2)
    left = Math.max(GAP, vw - width - GAP)
  }
  return { left, top, width, height }
}

function useBox(anchor: HTMLElement | null): Box {
  const [box, setBox] = useState<Box>(() => placeBox(anchor))
  useLayoutEffect(() => {
    const update = () => setBox((b) => {
      const n = placeBox(anchor)
      return n.left === b.left && n.top === b.top && n.width === b.width && n.height === b.height ? b : n
    })
    update()
    window.addEventListener('resize', update)
    const ro = anchor && typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    if (anchor) ro?.observe(anchor)
    return () => { window.removeEventListener('resize', update); ro?.disconnect() }
  }, [anchor])
  return box
}

/** 커서를 늦게 따라간다. 같은 경로의 새 객체(트리를 다시 읽음)는 바로 바꾼다 */
function useLagging(entry: TreeEntry): TreeEntry {
  const [shown, setShown] = useState(entry)
  useEffect(() => {
    if (entry.path === shown.path) { if (entry !== shown) setShown(entry); return }
    const t = window.setTimeout(() => setShown(entry), QUICKLOOK_DELAY)
    return () => window.clearTimeout(t)
  }, [entry, shown])
  return shown
}

export const QuickLook = forwardRef<QuickLookHandle, QuickLookProps>(function QuickLook({ entry, anchor, onFocusOut }, ref) {
  const shown = useLagging(entry)
  const box = useBox(anchor)
  const frame = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    scrollPage(dir) {
      const s = scroller.current
      if (s) s.scrollBy({ top: dir * Math.max(40, s.clientHeight - 40) })
    },
    contains(node) {
      return !!node && !!frame.current?.contains(node)
    },
  }), [])

  // 항목이 바뀌면 맨 위부터
  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = 0 }, [shown.path])

  const isDir = shown.type === 'dir'
  return createPortal(
    <div
      className="quicklook"
      ref={frame}
      role="dialog"
      aria-label={`훑어보기 — ${shown.path}`}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onMouseDown={(e) => {
        // 포커스는 트리에 남긴다. 폴더 쪽 내용 안의 포커스 받는 요소만 예외 (Phase E)
        const t = e.target as Element
        if (t.closest('[inert]') || !t.closest('.quicklook-folder button, .quicklook-folder a, .quicklook-folder input, .quicklook-folder [tabindex]')) e.preventDefault()
      }}
      onBlur={(e) => {
        const to = e.relatedTarget as Element | null
        if (to && frame.current?.contains(to)) return
        onFocusOut?.(to)
      }}
    >
      <QuickLookHeader entry={shown} />
      <div className="quicklook-scroll" ref={scroller}>
        {isDir ? <QuickLookFolder entry={shown} /> : <QuickLookFile path={shown.path} />}
      </div>
    </div>,
    document.body,
  )
})

function QuickLookHeader({ entry }: { entry: TreeEntry }) {
  const isDir = entry.type === 'dir'
  const type = isDir ? null : fileTypeOf(entry.path)
  // 디스크 인코딩 — 읽기는 DocFileView 와 같은 캐시라 한 번만 읽는다
  const file = useSkimText(isDir || !type ? null : entry.path)
  const encoding = file.source === 'disk' && file.encoding && file.encoding !== 'utf-8' ? file.encoding.toUpperCase() : null
  return (
    <div className="quicklook-head">
      <span className="quicklook-path" title={entry.path}>{entry.path}</span>
      <span className="quicklook-kind">{isDir ? '폴더' : type?.label ?? '지원하지 않는 형식'}</span>
      {encoding && <span className="quicklook-enc" title="UTF-8 이 아닌 파일 — 읽기 전용으로 열린다">{encoding}</span>}
    </div>
  )
}

/** 파일 내용 — 문서 전체를 rich 로 (표는 DocView 가 앞 60행만). 보기만 한다(inert) */
export function QuickLookFile({ path }: { path: string }) {
  return (
    <div className="quicklook-file" {...INERT}>
      <DocFileView path={path} weight="rich" />
    </div>
  )
}

export interface QuickLookFolderProps {
  /** 폴더 항목 (트리의 TreeEntry — `children` 이 바로 아래 항목) */
  entry: TreeEntry
}

/**
 * 폴더 내용 — Phase D 는 자리만: 폴더 이름과 바로 아래 항목(폴더 · 문서) 이름 목록.
 * Phase E 가 이것을 썸네일 격자(DocThumb light)로 바꾼다. 틀은 이 안의 포커스 받는 요소를 막지 않는다.
 */
export function QuickLookFolder({ entry }: QuickLookFolderProps) {
  const children = entry.children ?? []
  const dirs = children.filter((c) => c.type === 'dir')
  const files = children.filter((c) => c.type === 'file')
  return (
    <div className="quicklook-folder">
      <div className="quicklook-folder-name">📁 {entry.name}</div>
      {children.length === 0 ? (
        <div className="quicklook-folder-empty">비어 있는 폴더</div>
      ) : (
        <ul className="quicklook-folder-list">
          {[...dirs, ...files].map((c) => (
            <li key={c.path} className={c.type === 'dir' ? 'is-dir' : 'is-file'}>
              <span className="quicklook-folder-icon">{c.type === 'dir' ? '📁' : fileTypeOf(c.name)?.icon ?? '·'}</span>
              {c.name}
            </li>
          ))}
        </ul>
      )}
      <div className="quicklook-folder-count">폴더 {dirs.length} · 문서 {files.length}</div>
    </div>
  )
}
