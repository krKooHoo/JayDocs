import { describe, expect, it } from 'vitest'
import { ancestorDirs, parseExpanded, pruneExpanded } from './treeState'

describe('트리 펼침 상태', () => {
  it('저장분이 없거나 깨졌으면 null — 전부 펼친다', () => {
    expect(parseExpanded(null)).toBeNull()
    expect(parseExpanded('{')).toBeNull()
    expect(parseExpanded('"a"')).toBeNull()
  })

  it('빈 목록은 "전부 접음" 으로 남는다 (null 과 다르다)', () => {
    expect(parseExpanded('[]')).toEqual([])
  })

  it('문자열만 읽는다', () => {
    expect(parseExpanded(JSON.stringify(['a', 1, 'a/b', null]))).toEqual(['a', 'a/b'])
  })

  it('없어진 폴더의 기록은 버린다', () => {
    expect(pruneExpanded(['a', 'gone', 'a/b', 'a'], ['a', 'a/b', 'c'])).toEqual(['a', 'a/b'])
    expect(pruneExpanded(['a'], [])).toEqual([])
  })

  it('상위 폴더는 바깥부터', () => {
    expect(ancestorDirs('a/b/c.md')).toEqual(['a', 'a/b'])
    expect(ancestorDirs('c.md')).toEqual([])
    expect(ancestorDirs('@수업/1주/x.md')).toEqual(['@수업', '@수업/1주'])
  })
})
