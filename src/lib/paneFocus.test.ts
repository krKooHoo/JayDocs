import { describe, expect, it } from 'vitest'
import { EMPTY_TRACK, notePaneFocus, otherPaneTarget } from './paneFocus'

/** 다른 창으로 포커스 — 직전 창 (ADOPT D1 · DESIGN §57) */

describe('다른 창으로 포커스', () => {
  it('포커스가 들어온 창을 적는다 — 같은 창이면 그대로', () => {
    let t = notePaneFocus(EMPTY_TRACK, 'A')
    expect(t).toEqual({ cur: 'A', prev: null })
    expect(notePaneFocus(t, 'A')).toBe(t)
    t = notePaneFocus(t, 'B')
    expect(t).toEqual({ cur: 'B', prev: 'A' })
  })
  it('같은 키로 두 창을 오간다', () => {
    const open = ['A', 'B', 'C']
    let t = notePaneFocus(notePaneFocus(EMPTY_TRACK, 'A'), 'C')
    expect(otherPaneTarget(t, 'C', open)).toBe('A')
    t = notePaneFocus(t, 'A')
    expect(otherPaneTarget(t, 'A', open)).toBe('C')
  })
  it('트리에 있으면 마지막으로 쓰던 문서 창', () => {
    const t = notePaneFocus(notePaneFocus(EMPTY_TRACK, 'A'), 'B')
    expect(otherPaneTarget(t, null, ['A', 'B'])).toBe('B')
    // 그 창이 닫혔으면 그 앞의 창
    expect(otherPaneTarget(t, null, ['A'])).toBe('A')
  })
  it('직전 창이 닫혔거나 아직 없으면 다른 창 중 첫째, 창이 하나뿐이면 없다', () => {
    const t = notePaneFocus(notePaneFocus(EMPTY_TRACK, 'A'), 'B')
    expect(otherPaneTarget(t, 'B', ['B', 'C'])).toBe('C')
    expect(otherPaneTarget(notePaneFocus(EMPTY_TRACK, 'B'), 'B', ['A', 'B'])).toBe('A')
    expect(otherPaneTarget(t, 'B', ['B'])).toBeNull()
    expect(otherPaneTarget(EMPTY_TRACK, null, [])).toBeNull()
  })
})
