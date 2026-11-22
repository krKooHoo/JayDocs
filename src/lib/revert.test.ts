import { describe, expect, it } from 'vitest'
import { revertChange } from './revert'

const apply = (s: string, c: { from: number; to: number; insert: string } | null) => (c ? s.slice(0, c.from) + c.insert + s.slice(c.to) : s)

describe('마지막 저장 상태로 — 바뀐 곳만', () => {
  it('같으면 바꿀 것이 없다', () => {
    expect(revertChange('abc', 'abc')).toBeNull()
  })
  it('가운데만 바꾼다', () => {
    const c = revertChange('# 제목\n고친 줄\n끝\n', '# 제목\n원래 줄\n끝\n')
    expect(c).toEqual({ from: 5, to: 7, insert: '원래' })
  })
  it('덧붙인 글은 지운다 · 지운 글은 되살린다', () => {
    expect(apply('abc더함', revertChange('abc더함', 'abc'))).toBe('abc')
    expect(apply('ac', revertChange('ac', 'abc'))).toBe('abc')
    expect(revertChange('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' })
  })
  it('어떤 두 글이든 결과는 저장한 글', () => {
    const pairs: [string, string][] = [['', 'x'], ['x', ''], ['abab', 'ab'], ['한글 문서', '한 문서'], ['xyz', 'abc'], ['aXa', 'aYYa']]
    for (const [cur, saved] of pairs) expect(apply(cur, revertChange(cur, saved))).toBe(saved)
  })
})
