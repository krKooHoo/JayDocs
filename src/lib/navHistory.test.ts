import { beforeEach, describe, expect, it } from 'vitest'
import {
  EMPTY_HISTORY, NAV_MAX, navCan, navGo, navHistory, navJump, navRename, navStep, noteDocChange, noteLineJump, noteRename,
  registerLineSource, resetNavHistory, type NavLoc,
} from './navHistory'

/** 뒤로 · 앞으로 (ADOPT B5 · DESIGN §50) */

const all = () => true

describe('기록 규칙', () => {
  it('뛰면 떠난 자리와 간 자리, 뒤로 · 앞으로', () => {
    let h = navJump(EMPTY_HISTORY, { path: 'a.md', line: 10 }, { path: 'b.tsv' })
    h = navJump(h, { path: 'b.tsv' }, { path: 'c.md', line: 1 })
    expect(h.entries.map((e) => e.path)).toEqual(['a.md', 'b.tsv', 'c.md'])
    expect(navCan(h, -1)).toBe(true)
    expect(navCan(h, 1)).toBe(false)
    const back = navStep(h, -1, { path: 'c.md', line: 40 }, all)!
    expect(back.target).toEqual({ path: 'b.tsv' })
    // 떠난 자리(c.md 40줄)로 고쳐 적어 둔다 — 앞으로 오면 거기로
    const fwd = navStep(back.history, 1, { path: 'b.tsv' }, all)!
    expect(fwd.target).toEqual({ path: 'c.md', line: 40 })
  })

  it('뒤로 간 뒤 새로 뛰면 앞쪽은 버린다', () => {
    let h = navJump(EMPTY_HISTORY, { path: 'a.md' }, { path: 'b.md' })
    h = navJump(h, { path: 'b.md' }, { path: 'c.md' })
    h = navStep(h, -1, { path: 'c.md' }, all)!.history
    h = navJump(h, { path: 'b.md', line: 3 }, { path: 'd.md' })
    expect(h.entries).toEqual([{ path: 'a.md' }, { path: 'b.md', line: 3 }, { path: 'd.md' }])
    expect(navCan(h, 1)).toBe(false)
  })

  it('같은 자리로는 적지 않는다, 50개까지', () => {
    expect(navJump(EMPTY_HISTORY, { path: 'a.md', line: 2 }, { path: 'a.md', line: 2 }).entries).toHaveLength(1)
    let h = EMPTY_HISTORY
    for (let i = 0; i < NAV_MAX + 10; i++) h = navJump(h, { path: `${i}.md` }, { path: `${i + 1}.md` })
    expect(h.entries).toHaveLength(NAV_MAX)
    expect(h.index).toBe(NAV_MAX - 1)
  })

  it('없어진 문서는 건너뛰고, 갈 곳이 없으면 null', () => {
    let h = navJump(EMPTY_HISTORY, { path: 'a.md' }, { path: 'gone.md' })
    h = navJump(h, { path: 'gone.md' }, { path: 'c.md' })
    expect(navStep(h, -1, null, (p) => p !== 'gone.md')!.target).toEqual({ path: 'a.md' })
    expect(navStep(h, 1, null, all)).toBeNull()
    expect(navStep(EMPTY_HISTORY, -1, null, all)).toBeNull()
  })

  it('이름 바꾸기 — 그 경로와 폴더 아래', () => {
    const h = navJump(EMPTY_HISTORY, { path: 'docs/a.md', line: 3 }, { path: 'docsx/b.md' })
    expect(navRename(h, 'docs', 'notes').entries.map((e) => e.path)).toEqual(['notes/a.md', 'docsx/b.md'])
  })
})

describe('앱의 기록', () => {
  beforeEach(() => resetNavHistory())

  it('문서 바꾸기 · 줄 뛰기 · 뒤로 가기는 새로 적지 않는다', () => {
    let aLine = 5
    const un = registerLineSource('a.md', { line: () => aLine, focused: () => true })
    noteDocChange(null, 'a.md')
    noteLineJump('a.md', 30)
    aLine = 30
    noteDocChange('a.md', 'b.tsv')
    expect(navHistory().entries).toEqual([{ path: 'a.md', line: 5 }, { path: 'a.md', line: 30 }, { path: 'b.tsv' }])

    const opened: NavLoc[] = []
    expect(navGo(-1, 'b.tsv', all, (loc) => opened.push(loc))).toBe(true)
    expect(opened).toEqual([{ path: 'a.md', line: 30 }])
    noteDocChange('b.tsv', 'a.md') // 뒤로 가기가 연 문서 — 적지 않는다
    expect(navHistory().entries).toHaveLength(3)
    expect(navHistory().index).toBe(1)

    expect(navGo(-1, 'a.md', all, (loc, sameDoc) => opened.push({ ...loc, path: sameDoc ? 'same' : loc.path }))).toBe(true)
    expect(opened[1]).toEqual({ path: 'same', line: 5 })
    un()
  })

  it('이름을 바꿔 탭 경로가 바뀐 것은 뛴 것이 아니다', () => {
    noteDocChange(null, 'a.md')
    noteDocChange('a.md', 'b.md')
    noteRename('b.md', 'c.md')
    noteDocChange('b.md', 'c.md')
    expect(navHistory().entries.map((e) => e.path)).toEqual(['a.md', 'c.md'])
  })
})
