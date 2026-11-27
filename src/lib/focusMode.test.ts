import { describe, expect, it } from 'vitest'
import { focusEnterPlan, focusModeOn, onFocusMode, setFocusMode } from './focusMode'

/** 집중 모드 (ADOPT D3 · DESIGN §59) */

describe('집중 모드', () => {
  it('창이 여럿이면 포커스 창만 남긴다 — 이미 최대화돼 있거나 창이 하나면 건드리지 않는다', () => {
    expect(focusEnterPlan('A', 2, false, true)).toEqual({ treeOpen: true, maximized: 'A' })
    expect(focusEnterPlan('A', 1, false, false)).toEqual({ treeOpen: false, maximized: null })
    expect(focusEnterPlan('A', 3, true, true)).toEqual({ treeOpen: true, maximized: null })
  })
  it('켜고 끄기 — 같은 값이면 알리지 않는다', () => {
    let n = 0
    const off = onFocusMode(() => { n++ })
    setFocusMode(true)
    setFocusMode(true)
    expect(focusModeOn()).toBe(true)
    setFocusMode(false)
    expect(n).toBe(2)
    off()
  })
})
