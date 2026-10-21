import { describe, expect, it } from 'vitest'
import { inRootOf, isValidAlias, joinRootPath, makeAlias, rootPrefix, sameRoot, splitRootPath } from './roots.mjs'
import { resolveViewPath } from './md/tsvView'

describe('가져온 폴더 경로', () => {
  it('나누고 합친다', () => {
    expect(splitRootPath('10-World/Tile.md')).toEqual({ alias: null, rel: '10-World/Tile.md' })
    expect(splitRootPath('@수업자료/03주차/과제.md')).toEqual({ alias: '수업자료', rel: '03주차/과제.md' })
    expect(splitRootPath('@수업자료')).toEqual({ alias: '수업자료', rel: '' })
    expect(joinRootPath(null, 'a.md')).toBe('a.md')
    expect(joinRootPath('L', 'a/b.md')).toBe('@L/a/b.md')
    expect(joinRootPath('L', '')).toBe('@L')
  })
  it('같은 루트 안의 경로', () => {
    expect(rootPrefix('a/b.md')).toBe('')
    expect(rootPrefix('@L/a/b.md')).toBe('@L/')
    expect(inRootOf('@L/x/y.md', '/data/t.tsv')).toBe('@L/data/t.tsv')
    expect(inRootOf('x/y.md', 'data/t.tsv')).toBe('data/t.tsv')
    expect(sameRoot('@L/a.md', '@L/b/c.md')).toBe(true)
    expect(sameRoot('@L/a.md', 'a.md')).toBe(false)
    expect(sameRoot('@L/a.md', '@M/a.md')).toBe(false)
  })
  it('별칭 규칙', () => {
    expect(isValidAlias('수업자료')).toBe(true)
    expect(isValidAlias('Lecture 2026')).toBe(true)
    for (const bad of ['', ' a', 'a/b', 'a\\b', '.hidden', 'a:b', 'x'.repeat(41)]) expect(isValidAlias(bad)).toBe(false)
    expect(makeAlias('Lecture', [])).toBe('Lecture')
    expect(makeAlias('Lecture', ['lecture'])).toBe('Lecture-2')
    expect(makeAlias('Lecture', ['Lecture', 'Lecture-2'])).toBe('Lecture-3')
    expect(makeAlias('a:b', [])).toBe('a_b')
    expect(makeAlias('', [])).toBe('folder')
  })
  it('tsv-view·링크 경로는 그 md 의 루트 안에서 풀린다', () => {
    expect(resolveViewPath('data/t.tsv', '@L/doc/a.md')).toBe('@L/data/t.tsv')
    expect(resolveViewPath('/data/t.tsv', '@L/doc/a.md')).toBe('@L/data/t.tsv')
    expect(resolveViewPath('./t.tsv', '@L/doc/a.md')).toBe('@L/doc/t.tsv')
    expect(resolveViewPath('../t.tsv', '@L/doc/a.md')).toBe('@L/t.tsv')
    // 루트 밖으로는 못 나간다
    expect(resolveViewPath('../../../t.tsv', '@L/doc/a.md')).toBe('@L/t.tsv')
    expect(resolveViewPath('../../t.tsv', 'doc/a.md')).toBe('t.tsv')
  })
})
