import { EditorSelection, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { isolateHistory } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { comboFromEvent } from '../lib/keys'
import { NEW_TABLE, TABLE_OP_KEYS, applyChanges, cellAtOffset, cellCaret, tableOpChanges, type TableOp } from '../lib/md/tableEdit'
import { focusTableCellAt, hybridOn, runHybridTableOp } from './hybrid'

/**
 * 마크다운 표의 구조 편집 · `|||` 로 표 만들기 (DESIGN §23 H9 · H11). 소스 · 하이브리드 모드 모두.
 *
 * - 행 · 열 넣기 · 지우기는 그리드(TSV)와 같은 키 — 커서가 표 안에 있을 때만 (하이브리드의 표 칸은 `HybridTable` 이 직접 받는다).
 * - 팔레트 명령은 마지막으로 쓴 마크다운 편집기에서 돈다: 하이브리드 표 칸을 고치다 열었으면 그 칸, 아니면 커서.
 */

/** 마지막으로 포커스를 받은 마크다운 편집기 — 팔레트를 열면 포커스가 빠지므로 여기서 찾는다 */
let lastView: EditorView | null = null

/** 마지막으로 포커스를 받은 마크다운 편집기 — 팔레트 · 맥락 메뉴의 "커서의 링크 열기" 등이 쓴다 (mdContext.ts) */
export function lastMdView(): EditorView | null {
  return lastView
}

/** 커서 자리의 GFM 표: 표 원문의 시작(줄 처음)과 원문 */
function tableAtCursor(view: EditorView): { from: number; src: string; offset: number } | null {
  const { state } = view
  const pos = state.selection.main.head
  const tree = syntaxTree(state)
  const find = (side: -1 | 1) => {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) if (n.name === 'Table') return n
    return null
  }
  const node = find(1) ?? find(-1)
  if (!node) return null
  const from = state.doc.lineAt(node.from).from
  const to = state.doc.lineAt(node.to).to
  return { from, src: state.sliceDoc(from, to), offset: pos - from }
}

/** 커서 기준 표 동작. 커서가 표 밖이면 false */
function runCursorTableOp(view: EditorView, op: TableOp): boolean {
  const at = tableAtCursor(view)
  const cell = at && cellAtOffset(at.src, at.offset)
  if (!at || !cell) return false
  const r = tableOpChanges(at.src, op, cell.row, cell.col)
  // 못 하는 동작(머리글 행 · 하나 남은 열 지우기)은 키를 먹고 아무것도 하지 않는다
  if (!r) return true
  const next = applyChanges(at.src, r.changes)
  const caret = cellCaret(next, r.next.row, r.next.col) ?? 0
  view.dispatch({
    changes: r.changes.map((c) => ({ from: at.from + c.from, to: at.from + c.to, insert: c.insert })),
    selection: EditorSelection.cursor(at.from + caret),
    userEvent: 'input.table',
    scrollIntoView: true,
  })
  return true
}

/** 팔레트의 표 명령. 할 수 없으면 알릴 말을 돌려준다 */
export function runTableCommand(op: TableOp): string | null {
  const view = lastView
  if (!view || !view.dom.isConnected) return '마크다운 표 칸이나 표 안에 커서를 두고 실행하세요'
  if (view.state.readOnly) return '읽기 전용 문서입니다'
  if (runHybridTableOp(view, op)) return null
  if (runCursorTableOp(view, op)) { view.focus(); return null }
  return '마크다운 표 칸이나 표 안에 커서를 두고 실행하세요'
}

/** 줄이 `|||` 가 되게 치면 빈 표 (2열 · 본문 1행) 로 바꾼다. 코드 블록 · 표 안은 그대로 */
function tripleBar(view: EditorView, from: number, to: number, text: string): boolean {
  if (!text.endsWith('|') || view.state.readOnly) return false
  const { state } = view
  const line = state.doc.lineAt(from)
  // 친 뒤의 줄이 `|||` 이고 커서가 줄 끝 (한 번에 여러 글자가 들어오는 입력기 · 자동화도)
  if (to !== line.to || line.text.slice(0, from - line.from) + text !== '|||') return false
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(line.from, 1); n; n = n.parent) {
    if (n.name === 'FencedCode' || n.name === 'CodeBlock' || n.name === 'Table' || n.name === 'HTMLBlock') return false
  }
  // 1) `|` 는 평소대로 친다 — 되돌리기 한 번이면 표가 `|||` 로 돌아간다
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.type' })
  // 2) 줄을 표로. 앞 줄이 글이면 빈 줄을 두어 표가 문단에 붙지 않게, 뒤에도 빈 줄 (하이브리드는 커서를 거기 둔다)
  const s = view.state
  const ln = s.doc.lineAt(from)
  const prevBlank = ln.number === 1 || s.doc.line(ln.number - 1).text.trim() === ''
  const nextLine = ln.number < s.doc.lines ? s.doc.line(ln.number + 1) : null
  const before = prevBlank ? '' : '\n'
  const after = nextLine && nextLine.text.trim() === '' ? '' : '\n'
  const insert = before + NEW_TABLE + after
  const tableFrom = ln.from + before.length
  const hybrid = s.facet(hybridOn)
  // 하이브리드: 커서를 표 아래 빈 줄로 (표가 위젯으로 그려지게) → 머리글 첫 칸으로. 소스: 머리글 첫 칸에 커서
  const caret = hybrid ? tableFrom + NEW_TABLE.length + 1 : tableFrom + (cellCaret(NEW_TABLE, 0, 0) ?? 0)
  view.dispatch({
    changes: { from: ln.from, to: ln.to, insert },
    selection: { anchor: caret },
    userEvent: 'input.table',
    annotations: isolateHistory.of('before'),
    scrollIntoView: true,
  })
  if (hybrid) {
    // 위젯은 이 다음 그리기에서 생긴다
    requestAnimationFrame(() => { if (!focusTableCellAt(view, tableFrom, { row: 0, col: 0 })) view.focus() })
  }
  return true
}

/** 마크다운 편집기에 넣는 확장 — 표 키 · `|||` · 팔레트가 쓸 편집기 기억 */
export function mdTableExtension(): Extension {
  return [
    EditorView.inputHandler.of(tripleBar),
    // 본문이든 하이브리드 표 칸이든 이 편집기 안에 포커스가 오면 (focus 는 위젯 안에서 본문으로 오지 않아 focusin 으로)
    ViewPlugin.define((view) => {
      const note = () => { lastView = view }
      view.dom.addEventListener('focusin', note)
      return { destroy: () => { view.dom.removeEventListener('focusin', note); if (lastView === view) lastView = null } }
    }),
    EditorView.domEventHandlers({
      keydown: (e, view) => {
        if (e.isComposing || view.state.readOnly) return false
        const op = TABLE_OP_KEYS[comboFromEvent(e) ?? '']
        if (!op || !runCursorTableOp(view, op)) return false
        e.preventDefault()
        return true
      },
    }),
  ]
}
