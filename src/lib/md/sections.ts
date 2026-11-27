import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { ChangeSpec, EditorState, Text, TransactionSpec } from '@codemirror/state'

/**
 * 절 옮기기 · 단계 바꾸기 (ADOPT C2 · DESIGN §53) — 목차에서 제목을 골라 그 절 전체를 위 · 아래로, `#` 단계를 올리고 내린다.
 *
 * - **절**: 문서 바로 아래(인용 · 목록 밖)의 제목 줄부터 같거나 높은 단계의 다음 제목 앞까지. 제목은 구문 트리에서 읽는다 —
 *   코드 펜스(tsv-view 포함) 안의 `#` 은 제목이 아니다.
 * - **옮기기**: 같은 부모 안의 바로 위 · 아래 형제 절과 자리를 바꾼다. 두 절을 이어 붙인 범위를 한 번에 바꿔 쓴다 — 바뀐 줄만
 *   diff 에 나오고 `Ctrl+Z` 한 번으로 되돌린다. 첫 제목 앞의 글(머리말)은 어느 절에도 들지 않아 움직이지 않는다.
 * - **단계**: 그 제목과 그 아래 하위 제목을 함께 `#` 하나씩 더하고 뺀다 (구조가 그대로 내려가고 올라간다). 1 위로 · 6 아래로는 안 된다.
 *   밑줄 제목(Setext)이 들어 있으면 하지 않는다 — `#` 제목으로 바꾸라고 알린다.
 * - 순수 계산이라 테스트한다. 편집기에 넣는 것은 `applySectionMove` · `applySectionLevel`.
 */

export interface TopHeading {
  level: number
  /** 제목이 시작하는 줄의 처음 */
  from: number
  /** `#` 이 있는 자리 (ATX). Setext 는 -1 */
  hashFrom: number
  setext: boolean
}

const HEADING = /^(?:ATXHeading([1-6])|SetextHeading([12]))$/

/** 문서 바로 아래의 제목들 (인용 · 목록 · 코드 펜스 안은 빼고) */
export function topHeadings(state: EditorState, budgetMs = 200): TopHeading[] {
  const tree = ensureSyntaxTree(state, state.doc.length, budgetMs) ?? syntaxTree(state)
  const out: TopHeading[] = []
  const cur = tree.topNode.firstChild
  for (let n = cur; n; n = n.nextSibling) {
    const m = HEADING.exec(n.name)
    if (!m) continue
    const line = state.doc.lineAt(n.from)
    const setext = !m[1]
    out.push({ level: m[1] ? Number(m[1]) : Number(m[2]), from: line.from, hashFrom: setext ? -1 : n.from + (/^[ \t]*/.exec(state.doc.sliceString(n.from, n.to))?.[0].length ?? 0), setext })
  }
  return out
}

/** 그 제목 절의 끝 (다음 같거나 높은 단계 제목의 처음, 없으면 문서 끝) */
export function sectionEnd(hs: readonly TopHeading[], i: number, docLength: number): number {
  for (let k = i + 1; k < hs.length; k++) if (hs[k].level <= hs[i].level) return hs[k].from
  return docLength
}

/** 그 제목의 하위 제목 (절 안의 더 깊은 제목) 순번들 */
function subtree(hs: readonly TopHeading[], i: number): number[] {
  const out = [i]
  for (let k = i + 1; k < hs.length && hs[k].level > hs[i].level; k++) out.push(k)
  return out
}

export type SectionError = 'notTop' | 'noSibling' | 'levelLimit' | 'setext'

export interface SectionPlan {
  changes: ChangeSpec
  /** 옮긴 뒤 그 제목 줄의 처음 (커서 · 목차가 따라간다) */
  headingFrom: number
}

/** 위치 → 문서 바로 아래 제목의 순번 (그 자리가 제목 줄이 아니면 -1) */
export function topIndexAt(hs: readonly TopHeading[], lineFrom: number): number {
  return hs.findIndex((h) => h.from === lineFrom)
}

/**
 * 절을 위(-1) · 아래(+1) 형제 절과 바꾼다. 형제가 없으면(부모의 처음 · 끝) noSibling.
 * 문서 끝에 개행이 없으면 바꾼 뒤에도 끝에 개행을 더하지 않는다
 */
export function planSectionMove(doc: Text, hs: readonly TopHeading[], i: number, dir: -1 | 1): SectionPlan | SectionError {
  if (i < 0 || i >= hs.length) return 'notTop'
  const L = hs[i].level
  let a: number
  let b: number
  if (dir < 0) {
    let k = i - 1
    while (k >= 0 && hs[k].level > L) k--
    if (k < 0 || hs[k].level < L) return 'noSibling'
    a = k
    b = i
  } else {
    const end = sectionEnd(hs, i, doc.length)
    const j = hs.findIndex((h, k) => k > i && h.from === end)
    if (j < 0 || hs[j].level < L) return 'noSibling'
    a = i
    b = j
  }
  const from = hs[a].from
  const mid = hs[b].from
  const to = sectionEnd(hs, b, doc.length)
  const first = doc.sliceString(from, mid)
  let second = doc.sliceString(mid, to)
  // 뒤 절이 문서 끝이고 개행이 없으면 — 앞으로 올 때 개행을 붙이고, 뒤로 간 앞 절에서 끝 개행을 뗀다
  let tail = first
  if (!second.endsWith('\n')) {
    second += '\n'
    tail = first.endsWith('\n') ? first.slice(0, -1) : first
  }
  const insert = second + tail
  return { changes: { from, to, insert }, headingFrom: dir < 0 ? from : from + second.length }
}

/** 단계 바꾸기 — delta +1 은 `#` 더하기(내리기), -1 은 빼기(올리기). 그 제목과 하위 제목 모두 */
export function planSectionLevel(hs: readonly TopHeading[], i: number, delta: 1 | -1): SectionPlan | SectionError {
  if (i < 0 || i >= hs.length) return 'notTop'
  const ks = subtree(hs, i)
  if (ks.some((k) => hs[k].setext)) return 'setext'
  if (ks.some((k) => hs[k].level + delta < 1 || hs[k].level + delta > 6)) return 'levelLimit'
  const changes = ks.map((k) => (delta > 0 ? { from: hs[k].hashFrom, insert: '#' } : { from: hs[k].hashFrom, to: hs[k].hashFrom + 1 }))
  return { changes, headingFrom: hs[i].from }
}

export const SECTION_ERROR_TEXT: Record<SectionError, string> = {
  notTop: '인용 · 목록 안의 제목은 옮기거나 단계를 바꿀 수 없습니다',
  noSibling: '그쪽에 같은 단계의 절이 없습니다',
  levelLimit: '제목 단계는 1 ~ 6 입니다 (하위 제목까지 함께 바뀝니다)',
  setext: '밑줄 제목(=== · ---)은 단계를 바꿀 수 없습니다 — # 제목으로 바꾸세요',
}

// ---- 편집기에 넣기
type View = { state: EditorState; dispatch: (spec: TransactionSpec) => void }

/** pos 가 든 절의 바로 아래 제목 순번 — 첫 제목 앞(머리말)이면 -1 */
export function topSectionAt(hs: readonly TopHeading[], pos: number): number {
  let i = -1
  for (let k = 0; k < hs.length; k++) { if (hs[k].from <= pos) i = k; else break }
  return i
}

export type SectionAction = 'up' | 'down' | 'demote' | 'promote'

/**
 * 절 명령을 편집기에 넣는다. headingFrom: 목차에서 고른 제목 줄의 처음 (없으면 커서가 든 절).
 * 한 트랜잭션이라 `Ctrl+Z` 한 번으로 되돌린다. 성공하면 옮긴 제목 줄의 처음, 아니면 알릴 글
 */
export function runSectionAction(view: View, action: SectionAction, headingFrom?: number): { at: number } | { error: string } {
  const { state } = view
  if (state.readOnly) return { error: '읽기 전용 문서입니다' }
  const hs = topHeadings(state)
  const i = headingFrom !== undefined ? topIndexAt(hs, headingFrom) : topSectionAt(hs, state.selection.main.head)
  if (i < 0) return { error: headingFrom !== undefined ? SECTION_ERROR_TEXT.notTop : '커서가 제목 아래에 있어야 합니다 — 첫 제목 앞의 글은 절이 아닙니다' }
  const plan = action === 'up' || action === 'down' ? planSectionMove(state.doc, hs, i, action === 'up' ? -1 : 1) : planSectionLevel(hs, i, action === 'demote' ? 1 : -1)
  if (typeof plan === 'string') return { error: SECTION_ERROR_TEXT[plan] }
  const next = state.update({ changes: plan.changes }).state
  const lineEnd = next.doc.lineAt(plan.headingFrom).to
  view.dispatch({ changes: plan.changes, selection: { anchor: lineEnd }, scrollIntoView: true, userEvent: action === 'up' || action === 'down' ? 'move.section' : 'input.section' })
  return { at: plan.headingFrom }
}
