import { describe, expect, it } from 'vitest'
import { stepWrap } from './listNav'

describe('목록 ↑ / ↓ — 끝에서 돈다', () => {
  it('가운데는 한 칸', () => {
    expect(stepWrap(2, 1, 5)).toBe(3)
    expect(stepWrap(2, -1, 5)).toBe(1)
  })
  it('마지막에서 ↓ 는 첫째, 첫째에서 ↑ 는 마지막', () => {
    expect(stepWrap(4, 1, 5)).toBe(0)
    expect(stepWrap(0, -1, 5)).toBe(4)
  })
  it('하나뿐이거나 비었으면 제자리 · 0, 범위 밖 번호는 끝에 맞춘다', () => {
    expect(stepWrap(0, 1, 1)).toBe(0)
    expect(stepWrap(0, -1, 0)).toBe(0)
    expect(stepWrap(9, 1, 3)).toBe(0)
  })
})
