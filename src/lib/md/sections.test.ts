import { describe, expect, it } from 'vitest'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { planSectionLevel, planSectionMove, sectionEnd, topHeadings, topIndexAt, type SectionPlan } from './sections'

/** 절 옮기기 · 단계 바꾸기 (ADOPT C2 · DESIGN §53) — 먼저 범위가 맞는지 */

const stateOf = (doc: string) => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
const apply = (doc: string, plan: SectionPlan | string) => {
  if (typeof plan === 'string') throw new Error(plan)
  return stateOf(doc).update({ changes: plan.changes }).state.doc.toString()
}
const idx = (doc: string, line: number) => {
  const st = stateOf(doc)
  return topIndexAt(topHeadings(st), st.doc.line(line).from)
}

const DOC = [
  '머리말', // 1
  '# 문제', // 2
  '문제 글', // 3
  '```sh', // 4
  '# 주석 — 제목 아님', // 5
  '```', // 6
  '## 원인', // 7
  '원인 글', // 8
  '# 해법', // 9
  '```tsv-view', // 10
  '# 이것도 아님', // 11
  '```', // 12
  '# 결론', // 13
  '끝', // 14
  '',
].join('\n')

describe('제목 · 절', () => {
  it('코드 펜스(tsv-view 포함) 안의 # 은 제목이 아니다', () => {
    const hs = topHeadings(stateOf(DOC))
    expect(hs.map((h) => h.level)).toEqual([1, 2, 1, 1])
    expect(sectionEnd(hs, 0, DOC.length)).toBe(hs[2].from)
    expect(sectionEnd(hs, 1, DOC.length)).toBe(hs[2].from)
  })
  it('인용 · 목록 안의 제목은 바로 아래 제목이 아니다', () => {
    const doc = '# 하나\n> # 인용\n- # 목록\n# 둘\n'
    expect(topHeadings(stateOf(doc)).map((h) => h.from)).toEqual([0, doc.indexOf('# 둘')])
    expect(idx(doc, 2)).toBe(-1)
  })
})

describe('절 옮기기', () => {
  it('위로 — 하위 절과 펜스까지 통째로, 머리말은 그대로', () => {
    const out = apply(DOC, planSectionMove(stateOf(DOC).doc, topHeadings(stateOf(DOC)), idx(DOC, 9), -1))
    expect(out).toBe(['머리말', '# 해법', '```tsv-view', '# 이것도 아님', '```', '# 문제', '문제 글', '```sh', '# 주석 — 제목 아님', '```', '## 원인', '원인 글', '# 결론', '끝', ''].join('\n'))
  })
  it('아래로 — 다시 아래로 하면 처음대로', () => {
    const st = stateOf(DOC)
    const plan = planSectionMove(st.doc, topHeadings(st), idx(DOC, 2), 1) as SectionPlan
    const once = apply(DOC, plan)
    expect(once.split('\n')[1]).toBe('# 해법')
    expect(once.slice(plan.headingFrom).startsWith('# 문제')).toBe(true)
    const st2 = stateOf(once)
    const back = planSectionMove(st2.doc, topHeadings(st2), topIndexAt(topHeadings(st2), plan.headingFrom), -1)
    expect(apply(once, back)).toBe(DOC)
  })
  it('형제가 없으면 하지 않는다 (부모의 처음 · 끝, 첫 · 마지막 절)', () => {
    const st = stateOf(DOC)
    const hs = topHeadings(st)
    expect(planSectionMove(st.doc, hs, idx(DOC, 7), -1)).toBe('noSibling') // ## 원인 — 위는 부모
    expect(planSectionMove(st.doc, hs, idx(DOC, 7), 1)).toBe('noSibling') // 아래는 # 해법 (높은 단계)
    expect(planSectionMove(st.doc, hs, idx(DOC, 2), -1)).toBe('noSibling')
    expect(planSectionMove(st.doc, hs, idx(DOC, 13), 1)).toBe('noSibling')
  })
  it('문서 끝에 개행이 없어도 줄이 붙지 않는다', () => {
    const doc = '# 가\n글\n# 나\n끝'
    const st = stateOf(doc)
    expect(apply(doc, planSectionMove(st.doc, topHeadings(st), 1, -1))).toBe('# 나\n끝\n# 가\n글')
    expect(apply(doc, planSectionMove(st.doc, topHeadings(st), 0, 1))).toBe('# 나\n끝\n# 가\n글')
  })
  it('CRLF 파일도 편집기 안은 LF — 바꾼 줄 밖은 그대로', () => {
    const doc = '머리\n# 가\n1\n# 나\n2\n# 다\n3\n'
    const st = stateOf(doc)
    const plan = planSectionMove(st.doc, topHeadings(st), 2, -1) as SectionPlan
    expect(apply(doc, plan)).toBe('머리\n# 가\n1\n# 다\n3\n# 나\n2\n')
    const c = plan.changes as { from: number; to: number }
    expect(doc.slice(0, c.from)).toBe('머리\n# 가\n1\n')
  })
})

describe('단계 바꾸기', () => {
  it('내리기 · 올리기 — 하위 제목까지', () => {
    const doc = '# 가\n## 나\n글\n# 다\n'
    const st = stateOf(doc)
    expect(apply(doc, planSectionLevel(topHeadings(st), 0, 1))).toBe('## 가\n### 나\n글\n# 다\n')
    const doc2 = '## 가\n### 나\n'
    expect(apply(doc2, planSectionLevel(topHeadings(stateOf(doc2)), 0, -1))).toBe('# 가\n## 나\n')
  })
  it('1 위 · 6 아래 · 밑줄 제목은 안 된다', () => {
    expect(planSectionLevel(topHeadings(stateOf('# 가\n')), 0, -1)).toBe('levelLimit')
    expect(planSectionLevel(topHeadings(stateOf('# 가\n###### 깊음\n')), 0, 1)).toBe('levelLimit')
    expect(planSectionLevel(topHeadings(stateOf('가\n===\n')), 0, 1)).toBe('setext')
  })
  it('들여 쓴 # 제목은 # 자리에서', () => {
    const doc = '  ## 가\n'
    expect(apply(doc, planSectionLevel(topHeadings(stateOf(doc)), 0, 1))).toBe('  ### 가\n')
  })
})

describe('편집기에 넣기', () => {
  const viewOf = (doc: string, cursor = 0) => {
    let state = stateOf(doc).update({ selection: { anchor: cursor } }).state
    return { get state() { return state }, dispatch(spec: TransactionSpec) { state = state.update(spec).state } }
  }
  it('커서가 든 절을 위로 — 한 트랜잭션, 커서는 옮긴 제목 줄 끝', async () => {
    const { runSectionAction } = await import('./sections')
    const doc = '# 가\n1\n# 나\n2\n'
    const v = viewOf(doc, doc.indexOf('2'))
    expect(runSectionAction(v, 'up')).toEqual({ at: 0 })
    expect(v.state.doc.toString()).toBe('# 나\n2\n# 가\n1\n')
    expect(v.state.selection.main.head).toBe('# 나'.length)
  })
  it('머리말 · 읽기 전용은 알린다', async () => {
    const { runSectionAction } = await import('./sections')
    expect(runSectionAction(viewOf('머리\n# 가\n', 0), 'down')).toHaveProperty('error')
    const ro = { state: EditorState.create({ doc: '# 가\n', extensions: [EditorState.readOnly.of(true)] }), dispatch() {} }
    expect(runSectionAction(ro, 'demote')).toEqual({ error: '읽기 전용 문서입니다' })
  })
})
