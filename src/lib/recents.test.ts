import { describe, expect, it } from 'vitest'
import { parseRecents, pushRecent, recentRanks } from './recents'

describe('최근 목록 (팔레트)', () => {
  it('새로 쓴 것이 맨 앞으로 온다', () => {
    expect(pushRecent(['a', 'b'], 'c', 10)).toEqual(['c', 'a', 'b'])
  })

  it('이미 있던 것은 옮겨지고 겹치지 않는다', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c', 10)).toEqual(['c', 'a', 'b'])
    expect(pushRecent(['a', 'b', 'c'], 'a', 10)).toEqual(['a', 'b', 'c'])
  })

  it('개수를 넘으면 오래된 것부터 버린다', () => {
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
    expect(pushRecent(['a'], 'b', 0)).toEqual([])
  })

  it('순위는 앞에서부터 0', () => {
    const r = recentRanks(['x', 'y'])
    expect(r.get('x')).toBe(0)
    expect(r.get('y')).toBe(1)
    expect(r.has('z')).toBe(false)
  })

  it('깨진 저장분은 빈 목록', () => {
    expect(parseRecents(null, 5)).toEqual([])
    expect(parseRecents('{', 5)).toEqual([])
    expect(parseRecents('{"a":1}', 5)).toEqual([])
  })

  it('문자열만, 겹치지 않게, 개수 안에서 읽는다', () => {
    expect(parseRecents(JSON.stringify(['a', 1, '', 'a', 'b', null, 'c']), 2)).toEqual(['a', 'b'])
  })
})
