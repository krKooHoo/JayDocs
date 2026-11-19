/**
 * 렌더된 마크다운의 최상위 조각마다 원문 줄 번호를 찍는 rehype 플러그인 (PLAN-skim SK5).
 *
 * react-markdown 의 `rehypePlugins` 에 넣는다:
 *
 *   <ReactMarkdown rehypePlugins={[[rehypeSourceLines, { lines }]]}>{source}</ReactMarkdown>
 *
 * - 최상위 엘리먼트(문단 · 제목 · 목록 · 표 · 펜스 …)에 `data-line="N"` 이 붙는다. N 은 그 조각이 시작하는 줄(1부터).
 * - `lines` 를 주면 그린 글의 줄을 원문 줄로 바꿔 적는다 — `stripBakedWithLines(원문).lines` 를 넣는다.
 * - 최상위 HTML 블록(`<div>…</div>`, `<!-- 주석 -->`)은 이 단계에서 엘리먼트가 아니라 `raw` 노드다
 *   (react-markdown 이 뒤에 글자 그대로의 텍스트로 바꾼다). 속성을 붙일 곳이 없으므로 `<div data-line>` 으로 감싼다.
 * - 위치가 없는 최상위 노드(각주 묶음 `<section data-footnotes>` 처럼 만들어 낸 것, 조각 사이의 줄바꿈 텍스트)는 건드리지 않는다.
 *   → `data-line` 이 없는 조각이 있을 수 있다. 줄 → 조각을 찾을 때는 "그 줄 이하에서 가장 큰 data-line" 으로 찾는다.
 *
 * hast 타입 패키지에 기대지 않으려고 필요한 모양만 여기 적는다.
 */
interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
  position?: { start?: { line?: number } }
}

export interface SourceLinesOptions {
  /** 그린 글의 줄 → 원문 줄 (`lines[i]` = (i + 1)번째 줄의 원문 줄 번호). 없으면 그린 글의 줄 번호 그대로 */
  lines?: readonly number[] | null
}

/** DOM 에 찍히는 속성 이름 */
export const LINE_ATTR = 'data-line'

export function rehypeSourceLines(options?: SourceLinesOptions | null) {
  const map = options?.lines ?? null
  const toSource = (line: number) => map?.[line - 1] ?? line
  return (tree: HastNode) => {
    const children = tree.children
    if (!children) return
    for (let i = 0; i < children.length; i++) {
      const node = children[i]
      const line = node.position?.start?.line
      if (typeof line !== 'number') continue
      if (node.type === 'element') {
        node.properties = { ...node.properties, dataLine: toSource(line) }
      } else if (node.type === 'raw') {
        children[i] = { type: 'element', tagName: 'div', properties: { dataLine: toSource(line) }, children: [node], position: node.position }
      }
    }
  }
}

/**
 * 조각(또는 그 안의 요소)에서 원문 줄 번호를 읽는다 — 클릭한 곳에서 위로 올라가며 `data-line` 을 찾는다.
 * `within` 을 주면 그 요소 밖으로는 나가지 않는다. 없으면 null
 */
export function sourceLineOf(el: Element | null, within?: Element | null): number | null {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const v = cur.getAttribute(LINE_ATTR)
    if (v !== null) {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    if (cur === within) break
  }
  return null
}
