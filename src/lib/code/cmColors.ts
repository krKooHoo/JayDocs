import { StateEffect, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { codeLangOf } from './langs'
import { isPlainToken, onCodeReady, tokenClass, tokenStyle, tokenizeCode, type CodeLines } from './highlight'

/**
 * 마크다운 편집기(소스 · 하이브리드)의 코드 블록 색 (DESIGN §27 CC4 · CC5).
 * 글자는 그대로 두고 mark 장식으로 색만 입힌다 — 하이브리드의 줄 장식(코드 상자 모양)과 따로 돈다.
 *
 * - 보이는 범위에 걸친 블록만 나눈다. 스크롤하면 그때 나눈다(결과는 `tokenizeCode` 가 기억한다).
 * - 글자를 치는 동안에는 있던 색의 위치만 옮기고, 입력이 잠깐 멈추면 다시 나눈다.
 *   글자마다 블록을 통째로 다시 나누면 긴 블록에서 입력이 밀린다.
 * - 한글 조합 중에는 장식을 바꾸지 않는다(조합이 깨진다) — 조합이 끝난 뒤에 나눈다.
 */

/** 입력이 멈춘 뒤 다시 나누기까지 */
const IDLE_MS = 90
/** 보이는 범위 위아래로 더 보는 글자 수 — 조금 스크롤해도 색이 이미 있게 */
const MARGIN = 2000

const refresh = StateEffect.define<null>()

/** 코드 블록 하나 — 펜스 안 글과, 그 글의 위치를 문서 위치로 되돌릴 조각들 */
export interface CodeBlockRange {
  lang: string
  code: string
  /** 코드 안 위치 `at` 부터 `len` 글자가 문서의 `from` 부터다. 인용 · 목록 안의 펜스는 줄 앞 표식이 빠져 조각이 여럿이다 */
  parts: { at: number; from: number; len: number }[]
}

/** `from`~`to` 에 걸친 펜스 코드 블록 가운데 표에 있는 언어인 것 */
export function codeBlocksIn(state: EditorState, from: number, to: number): CodeBlockRange[] {
  const out: CodeBlockRange[] = []
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== 'FencedCode') return
      const info = node.node.getChild('CodeInfo')
      const lang = info ? codeLangOf(state.sliceDoc(info.from, info.to)) : null
      if (!lang) return false
      const parts: CodeBlockRange['parts'] = []
      let code = ''
      for (const t of node.node.getChildren('CodeText')) {
        parts.push({ at: code.length, from: t.from, len: t.to - t.from })
        code += state.sliceDoc(t.from, t.to)
      }
      if (code) out.push({ lang, code, parts })
      return false
    },
  })
  return out
}

const marks = new Map<string, Decoration>()
function markFor(cls: string, style: string) {
  const key = `${cls}|${style}`
  let m = marks.get(key)
  if (!m) {
    m = Decoration.mark({ class: cls, attributes: style ? { style } : undefined })
    marks.set(key, m)
  }
  return m
}

/** 나눈 토큰을 문서 위치의 mark 로. 순서대로(위치가 커지게) 돌려준다 */
export function codeMarks(block: CodeBlockRange, lines: CodeLines): Range<Decoration>[] {
  const out: Range<Decoration>[] = []
  let at = 0
  let p = 0
  for (const line of lines) {
    for (const t of line) {
      const len = t.text.length
      if (!isPlainToken(t)) {
        while (p < block.parts.length - 1 && block.parts[p + 1].at <= at) p++
        const part = block.parts[p]
        // 토막은 한 줄 안이고 한 줄의 글은 한 조각 안이다. 문법이 줄을 다르게 세어 어긋나면 그 토막은 건너뛴다
        if (at >= part.at && at + len <= part.at + part.len) {
          const from = part.from + (at - part.at)
          out.push(markFor(tokenClass(t), tokenStyle(t)).range(from, from + len))
        }
      }
      at += len
    }
    at += 1 // 줄바꿈
  }
  return out
}

function compute(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const seen = new Set<number>()
  for (const r of view.visibleRanges) {
    for (const b of codeBlocksIn(view.state, Math.max(0, r.from - MARGIN), Math.min(view.state.doc.length, r.to + MARGIN))) {
      const start = b.parts[0].from
      if (seen.has(start)) continue
      seen.add(start)
      const lines = tokenizeCode(b.code, b.lang)
      if (lines) for (const m of codeMarks(b, lines)) ranges.push(m)
    }
  }
  return Decoration.set(ranges, true)
}

/** 마크다운 편집기에 넣는다 (`lib/cm.ts` 의 `baseExtensions`) */
export function codeColors(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      private timer: ReturnType<typeof setTimeout> | null = null
      private off: () => void

      constructor(private view: EditorView) {
        this.decorations = compute(view)
        // 문법을 다 받으면 다시 그린다 (처음엔 색 없이 보이다가 칠해진다)
        this.off = onCodeReady(() => this.later(0))
      }

      update(u: ViewUpdate) {
        if (u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))) {
          this.decorations = compute(u.view)
        } else if (u.docChanged) {
          this.decorations = this.decorations.map(u.changes)
          this.later(IDLE_MS)
        } else if (u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          // 스크롤 · 뒤에서 파싱이 더 나아갔다. 조합 중이면 미룬다
          if (u.view.composing) this.later(IDLE_MS)
          else this.decorations = compute(u.view)
        }
      }

      private later(ms: number) {
        if (this.timer !== null) clearTimeout(this.timer)
        this.timer = setTimeout(() => {
          this.timer = null
          if (this.view.composing) { this.later(IDLE_MS); return }
          this.view.dispatch({ effects: refresh.of(null) })
        }, ms)
      }

      destroy() {
        if (this.timer !== null) clearTimeout(this.timer)
        this.off()
      }
    },
    { decorations: (v) => v.decorations },
  )
}
