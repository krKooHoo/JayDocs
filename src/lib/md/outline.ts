import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

/**
 * 마크다운의 목차 (DESIGN §29). 하이브리드 모드의 왼쪽 띠(`OutlinePanel`)가 쓴다.
 *
 * 제목은 편집기의 구문 트리(lezer markdown)에서 뽑는다 — 코드 펜스 안의 `#` 은 제목이 아니다.
 * ATX(`# 제목`)와 Setext(밑줄 `===` · `---`) 둘 다. 인용 · 목록 안의 제목도 넣는다.
 */

export interface OutlineItem {
  /** 1 ~ 6 */
  level: number
  /** 표식(`#` · 강조 · 링크 문법)을 뗀 글 */
  text: string
  /** 제목이 시작하는 줄 (1부터) */
  line: number
  /** 제목 줄의 처음 (문서 위치) */
  from: number
  /** 제목 글이 시작하는 자리 — 누르면 커서를 여기에 둔다 */
  textFrom: number
}

/** 이 노드 안에는 제목이 없다 — 내려가지 않는다 */
const LEAF_BLOCKS = new Set(['FencedCode', 'CodeBlock', 'Paragraph', 'Table', 'HTMLBlock', 'CommentBlock', 'ProcessingInstructionBlock', 'LinkReference', 'HorizontalRule'])

const HEADING = /^(?:ATXHeading([1-6])|SetextHeading([12]))$/

/** 제목 글에서 인라인 문법 표식을 뗀다 — 그림 · 링크는 글만, 코드 · 강조 · 취소선 표식은 지운다 */
export function plainHeading(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!~|<>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 문서의 제목들. 문서가 커서 구문 트리가 아직 다 만들어지지 않았으면 만들어진 데까지만 — 트리가 자라면 다시 부른다
 * (`budgetMs` 만큼은 기다려서 더 만든다).
 */
export function outlineOf(state: EditorState, budgetMs = 50): OutlineItem[] {
  const tree = ensureSyntaxTree(state, state.doc.length, budgetMs) ?? syntaxTree(state)
  const doc = state.doc
  const items: OutlineItem[] = []
  tree.iterate({
    enter(node) {
      const m = HEADING.exec(node.name)
      if (!m) return !LEAF_BLOCKS.has(node.name)
      const level = m[1] ? Number(m[1]) : Number(m[2])
      const line = doc.lineAt(node.from)
      let text: string
      let textFrom: number
      if (m[1]) {
        // ATX — 여는 # 들과 닫는 # 들(앞에 공백이 있을 때만)을 뗀다
        const s = doc.sliceString(node.from, node.to)
        const open = /^#{1,6}[ \t]*/.exec(s)![0].length
        text = s.slice(open).replace(/(^|[ \t]+)#+[ \t]*$/, '')
        textFrom = node.from + open
      } else {
        // Setext — 밑줄(마지막 줄) 앞까지가 글. 여러 줄이면 한 줄로 잇는다
        const mark = node.node.getChild('HeaderMark')
        const end = mark ? mark.from : node.to
        text = doc.sliceString(node.from, end)
        textFrom = node.from + (/^[ \t]*/.exec(text)?.[0].length ?? 0)
      }
      items.push({ level, text: plainHeading(text), line: line.number, from: line.from, textFrom })
      return false
    },
  })
  return items
}

/** `line` 이 든 절의 제목 — 그 줄이나 그 위에 있는 마지막 제목의 순번. 첫 제목보다 위면 -1 */
export function activeIndex(items: readonly OutlineItem[], line: number): number {
  let lo = 0
  let hi = items.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (items[mid].line <= line) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  return found
}

/** 두 목차가 같은가 — 같으면 띠를 다시 그리지 않는다 (글자를 칠 때마다 위치만 바뀐다) */
export function sameOutline(a: readonly OutlineItem[], b: readonly OutlineItem[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.level !== y.level || x.text !== y.text || x.line !== y.line || x.from !== y.from || x.textFrom !== y.textFrom) return false
  }
  return true
}
