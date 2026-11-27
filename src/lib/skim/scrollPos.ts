import { EditorView } from '@codemirror/view'
import { LINE_ATTR } from '../md/sourceLines'
import { buildLineMap, type LineBlock, type LineMap } from './lineMap'

/**
 * 편집기 · 미리보기의 스크롤 위치 ↔ 원문 줄 (DOM 을 잰다). 훑어보기 패널(PLAN-skim SK7)과
 * 분할 보기 스크롤 맞추기(DESIGN §56)가 같이 쓴다. 계산은 `lineMap.ts`.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 문서 맨 위에서 `h` px 아래의 줄 (소수). 블록 하나가 여러 줄이면(하이브리드의 표 · 그림) 그 안을 고르게 나눈다 */
export function editorLineAt(view: EditorView, h: number): number {
  const doc = view.state.doc
  if (h <= 0) return 1
  if (h >= view.contentHeight) return doc.lines + 1
  const b = view.lineBlockAtHeight(h)
  const from = doc.lineAt(b.from).number
  const to = doc.lineAt(b.to).number
  const f = b.height > 0 ? clamp((h - b.top) / b.height, 0, 1) : 0
  return from + f * (to - from + 1)
}

/** 편집기가 지금 보여 주는 줄 범위 (소수 줄). 화면에 없으면 null */
export function editorRange(view: EditorView): { first: number; last: number } | null {
  const rect = view.scrollDOM.getBoundingClientRect()
  if (rect.height <= 0) return null
  const top = view.documentTop
  return { first: editorLineAt(view, rect.top - top), last: editorLineAt(view, rect.bottom - top) }
}

/** 그 줄(소수)이 편집기 맨 위에 오게 스크롤한다 */
export function editorScrollToLine(view: EditorView, line: number): void {
  const doc = view.state.doc
  const b = view.lineBlockAt(doc.line(clamp(Math.floor(line), 1, doc.lines)).from)
  const from = doc.lineAt(b.from).number
  const to = doc.lineAt(b.to).number
  const h = b.top + clamp((line - from) / (to - from + 1), 0, 1) * b.height
  view.scrollDOM.scrollTop += view.documentTop + h - view.scrollDOM.getBoundingClientRect().top
}

/**
 * 미리보기(`.preview`)의 조각 위치를 잰다 — 미리보기가 `data-line` 을 찍고 있어야 한다(`PreviewPane` 의 `lines`).
 * 위치는 미리보기 스크롤 내용의 px. 스크롤할 때마다 부르지 말고 내용 · 크기가 바뀔 때만 다시 잰다.
 */
export function measurePreview(el: HTMLElement, lines: number): LineMap {
  const inner = el.querySelector<HTMLElement>('.preview-body')
  const base = el.getBoundingClientRect().top - el.scrollTop
  const blocks: LineBlock[] = []
  for (const b of inner?.querySelectorAll<HTMLElement>(`:scope > [${LINE_ATTR}]`) ?? []) {
    const r = b.getBoundingClientRect()
    blocks.push({ line: Number(b.getAttribute(LINE_ATTR)), top: r.top - base, bottom: r.bottom - base })
  }
  // 아래의 빈 여백(40vh)은 글이 아니다 — 마지막 조각의 줄이 그 여백까지 늘어나지 않게 뺀다
  let height = el.scrollHeight
  if (inner) height = inner.getBoundingClientRect().bottom - base - (parseFloat(getComputedStyle(inner).paddingBottom) || 0)
  return buildLineMap(blocks, height, lines)
}
