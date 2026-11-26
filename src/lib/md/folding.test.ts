import { describe, expect, it } from 'vitest'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { foldedRanges } from '@codemirror/language'
import { outlineOf } from './outline'
import {
  foldAllSections, foldSectionAtCursor, foldedHeadingLines, foldedKeys, headingAt, headingKeys, mdFolding, parentHeading,
  restoreFolds, unfoldAllSections, unfoldSectionAtCursor,
} from './folding'

/** 제목 접기 (ADOPT C1 · DESIGN §52) — 편집기 없이 상태만 (dispatch 는 state.update) */

const DOC = [
  '# 개요', // 1
  '본문', // 2
  '## 문제', // 3
  '문제 글', // 4
  '```sh', // 5
  '# 주석 — 제목이 아니다', // 6
  '```', // 7
  '## 해법', // 8
  '해법 글', // 9
  '# 결론', // 10
  '끝', // 11
].join('\n')

function fakeView(doc = DOC, cursorLine = 1) {
  let state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), mdFolding()] })
  state = state.update({ selection: { anchor: state.doc.line(cursorLine).from } }).state
  const view = {
    get state() { return state },
    dispatch(spec: TransactionSpec) { state = state.update(spec).state },
  }
  return view as unknown as EditorView & { state: EditorState }
}

const folds = (v: EditorView) => {
  const out: [number, number][] = []
  foldedRanges(v.state).between(0, v.state.doc.length, (a, b) => { out.push([v.state.doc.lineAt(a).number, v.state.doc.lineAt(b).number]) })
  return out
}
const cursorLine = (v: EditorView) => v.state.doc.lineAt(v.state.selection.main.head).number

describe('절 찾기', () => {
  it('커서가 든 절 · 위 단계', () => {
    const items = outlineOf(fakeView().state)
    expect(items.map((h) => h.text)).toEqual(['개요', '문제', '해법', '결론'])
    expect(headingAt(items, items[1].from + 2)).toBe(1)
    expect(headingAt(items, 0)).toBe(0)
    expect(parentHeading(items, 2)).toBe(0)
    expect(parentHeading(items, 3)).toBe(-1)
  })
})

describe('접기 · 펴기', () => {
  it('커서가 든 절 — 코드 펜스 안의 # 은 절을 끊지 않는다, 커서는 제목 줄로', () => {
    const v = fakeView(DOC, 4)
    expect(foldSectionAtCursor(v)).toBe(true)
    expect(folds(v)).toEqual([[3, 7]])
    expect(cursorLine(v)).toBe(3)
  })
  it('거듭 접으면 바깥 절, 펴기는 커서의 절부터', () => {
    const v = fakeView(DOC, 4)
    foldSectionAtCursor(v)
    foldSectionAtCursor(v)
    expect(folds(v)).toEqual([[1, 9], [3, 7]]) // 안의 접힌 절은 그대로 — 바깥을 펴면 접힌 채로 보인다
    expect(cursorLine(v)).toBe(1)
    expect(foldedHeadingLines(v.state, outlineOf(v.state))).toEqual(new Set([1, 3]))
    expect(unfoldSectionAtCursor(v)).toBe(true)
    expect(folds(v)).toEqual([[3, 7]])
    // 커서의 제목(개요)은 펴져 있다 → 절 안의 접힌 것을 편다
    expect(unfoldSectionAtCursor(v)).toBe(true)
    expect(folds(v)).toEqual([])
    expect(unfoldSectionAtCursor(v)).toBe(false)
  })
  it('모두 접기 · 모두 펴기', () => {
    const v = fakeView(DOC, 9)
    expect(foldAllSections(v)).toBe(true)
    expect(foldedHeadingLines(v.state, outlineOf(v.state))).toEqual(new Set([1, 3, 8, 10]))
    expect(cursorLine(v)).toBe(1)
    expect(unfoldAllSections(v)).toBe(true)
    expect(folds(v)).toEqual([])
  })
  it('첫 제목 앞 · 빈 절은 접지 않는다', () => {
    expect(foldSectionAtCursor(fakeView('머리말\n# 제목\n', 1))).toBe(false)
    expect(foldSectionAtCursor(fakeView('# 하나\n# 둘\n글', 1))).toBe(false)
  })
})

describe('남기기 · 복원', () => {
  it('같은 제목은 몇 번째로 가린다', () => {
    const items = outlineOf(fakeView('# 메모\n가\n# 메모\n나\n## 메모\n다').state)
    expect(headingKeys(items)).toEqual(['1\u0001메모\u00010', '1\u0001메모\u00011', '2\u0001메모\u00010'])
  })
  it('접힌 열쇠로 다시 연 문서를 접는다', () => {
    const v = fakeView(DOC, 9)
    foldSectionAtCursor(v)
    const keys = foldedKeys(v.state)
    expect(keys).toEqual(['2\u0001해법\u00010'])
    const w = fakeView(DOC, 1)
    restoreFolds(w, keys)
    expect(folds(w)).toEqual([[8, 9]])
  })
})
