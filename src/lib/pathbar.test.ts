import { describe, expect, it } from 'vitest'
import { crumbsOf, filterByLabel, listDir, listRoots, parentDir } from './pathbar'

const FILES = [
  'README.md',
  '10-World/Tile/Tile.md',
  '10-World/Tile/Tile_Table.tsv',
  '10-World/Map.md',
  '20-Note.md',
  '@수업자료/03주차/과제.md',
  '@수업자료/개요.md',
  '@b/x.tsv',
]

describe('경로 막대 — 단계', () => {
  it('주 폴더 경로는 문서 별칭이 루트', () => {
    expect(crumbsOf('10-World/Tile/Tile.md', 'Docs')).toEqual([
      { kind: 'root', label: 'Docs', path: '', parent: null },
      { kind: 'dir', label: '10-World', path: '10-World', parent: '' },
      { kind: 'dir', label: 'Tile', path: '10-World/Tile', parent: '10-World' },
      { kind: 'file', label: 'Tile.md', path: '10-World/Tile/Tile.md', parent: '10-World/Tile' },
    ])
  })
  it('루트 바로 아래 파일', () => {
    expect(crumbsOf('README.md', 'Docs').map((c) => [c.kind, c.path, c.parent])).toEqual([['root', '', null], ['file', 'README.md', '']])
  })
  it('가져온 폴더는 @별칭 이 루트', () => {
    expect(crumbsOf('@수업자료/03주차/과제.md', 'Docs')).toEqual([
      { kind: 'root', label: '@수업자료', path: '@수업자료', parent: null },
      { kind: 'dir', label: '03주차', path: '@수업자료/03주차', parent: '@수업자료' },
      { kind: 'file', label: '과제.md', path: '@수업자료/03주차/과제.md', parent: '@수업자료/03주차' },
    ])
  })
})

describe('경로 막대 — 목록', () => {
  it('주 폴더 루트는 가져온 폴더를 빼고 폴더 먼저', () => {
    expect(listDir(FILES, '').map((e) => e.name)).toEqual(['10-World', '20-Note.md', 'README.md'])
  })
  it('폴더 아래 — 폴더는 한 번만', () => {
    expect(listDir(FILES, '10-World')).toEqual([
      { name: 'Tile', path: '10-World/Tile', isDir: true },
      { name: 'Map.md', path: '10-World/Map.md', isDir: false },
    ])
  })
  it('가져온 폴더 루트', () => {
    expect(listDir(FILES, '@수업자료').map((e) => e.path)).toEqual(['@수업자료/03주차', '@수업자료/개요.md'])
  })
  it('이름이 앞부분만 같은 폴더는 섞지 않는다', () => {
    expect(listDir(['a/x.md', 'ab/y.md'], 'a').map((e) => e.path)).toEqual(['a/x.md'])
  })
  it('루트 목록 — 주 폴더 먼저, 가져온 폴더는 트리 순서', () => {
    expect(listRoots(FILES, 'Docs')).toEqual([
      { name: 'Docs', path: '', isDir: true },
      { name: '@수업자료', path: '@수업자료', isDir: true },
      { name: '@b', path: '@b', isDir: true },
    ])
  })
  it('상위 폴더', () => {
    expect(parentDir('10-World/Tile')).toBe('10-World')
    expect(parentDir('10-World')).toBe('')
    expect(parentDir('')).toBeNull()
    expect(parentDir('@a/x')).toBe('@a')
    expect(parentDir('@a')).toBeNull()
  })
})

describe('경로 막대 — 거르기', () => {
  const names = ['Tile', 'Map.md', 'Tile_Table.tsv', 'notes.txt']
  it('글자가 없으면 그대로', () => {
    expect(filterByLabel(names, '', (s) => s)).toEqual(names)
  })
  it('맞는 것만, 앞에서 맞은 것 먼저', () => {
    expect(filterByLabel(names, 'ta', (s) => s)).toEqual(['Tile_Table.tsv'])
    expect(filterByLabel(names, 't', (s) => s)).toEqual(['Tile', 'Tile_Table.tsv', 'notes.txt'])
  })
})
