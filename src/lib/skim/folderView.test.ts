import { describe, expect, it } from 'vitest'
import { cleanFolderPrefs, dateGroup, folderSections, formatSize, formatTime, sectionMove, sectionRows, type FileStat } from './folderView'
import { gridMove } from './grid'

/** 폴더 격자 보기 전환 · 정렬 (ADOPT B6 · DESIGN §51) */

const NOW = new Date(2026, 10, 26, 15, 0).getTime()
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()

describe('설정', () => {
  it('깨진 값은 기본', () => {
    expect(cleanFolderPrefs(null)).toEqual({ view: 'grid', sort: 'name' })
    expect(cleanFolderPrefs({ view: 'list', sort: 'time' })).toEqual({ view: 'list', sort: 'time' })
    expect(cleanFolderPrefs({ view: 'x', sort: 3 })).toEqual({ view: 'grid', sort: 'name' })
  })
})

describe('날짜 묶음', () => {
  it('자정 경계', () => {
    expect(dateGroup(at(2026, 11, 26, 0), NOW)).toBe('오늘')
    expect(dateGroup(at(2026, 11, 25, 23), NOW)).toBe('어제')
    expect(dateGroup(at(2026, 11, 25, 0), NOW)).toBe('어제')
    expect(dateGroup(at(2026, 11, 20), NOW)).toBe('지난 7일')
    expect(dateGroup(at(2026, 11, 18), NOW)).toBe('그 전')
  })
})

describe('보일 순서', () => {
  const items = [
    { type: 'dir' as const, path: 'd/sub' },
    { type: 'file' as const, path: 'd/a.md' },
    { type: 'file' as const, path: 'd/b.md' },
    { type: 'file' as const, path: 'd/c.md' },
    { type: 'file' as const, path: 'd/x.md' },
  ]
  const stats = new Map<string, FileStat | null>([
    ['d/a.md', { mtime: at(2026, 11, 1) }],
    ['d/b.md', { mtime: at(2026, 11, 26, 9) }],
    ['d/c.md', { mtime: at(2026, 11, 26, 14) }],
    ['d/x.md', null],
  ])
  const titles = (r: ReturnType<typeof folderSections>) => r.sections.map((s) => [s.title, s.items.map((i) => i.path)])

  it('이름 정렬은 그대로 한 묶음', () => {
    expect(titles(folderSections(items, 'name', new Map(), NOW))).toEqual([[null, items.map((i) => i.path)]])
  })
  it('시각 정렬 — 폴더, 새것부터 날짜 묶음, 못 읽은 것은 끝', () => {
    expect(titles(folderSections(items, 'time', stats, NOW))).toEqual([
      ['폴더', ['d/sub']],
      ['오늘', ['d/c.md', 'd/b.md']],
      ['그 전', ['d/a.md']],
      ['시각을 못 읽음', ['d/x.md']],
    ])
  })
  it('다 읽기 전에는 이름 순서 그대로, 남은 수', () => {
    const r = folderSections(items, 'time', new Map([['d/a.md', { mtime: 1 }]]), NOW)
    expect(r.pending).toBe(3)
    expect(r.sections).toHaveLength(1)
  })
})

describe('묶음 격자 이동', () => {
  it('묶음마다 새 줄', () => {
    expect(sectionRows([1, 5], 3)).toEqual([[0], [1, 2, 3], [4, 5]])
  })
  it('↑ ↓ 는 같은 칸, 짧은 줄이면 마지막', () => {
    const rows = sectionRows([1, 5], 3)
    expect(sectionMove(0, rows, 'ArrowDown')).toBe(1)
    expect(sectionMove(3, rows, 'ArrowDown')).toBe(5)
    expect(sectionMove(3, rows, 'ArrowUp')).toBe(0)
    expect(sectionMove(5, rows, 'ArrowUp')).toBe(2)
    expect(sectionMove(0, rows, 'ArrowRight')).toBe(1)
    expect(sectionMove(4, rows, 'End')).toBe(5)
    expect(sectionMove(4, rows, 'PageUp', 5)).toBe(0)
  })
  it('묶음이 하나면 gridMove 와 같다', () => {
    const rows = sectionRows([10], 4)
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'] as const) {
      for (let i = 0; i < 10; i++) expect(sectionMove(i, rows, key)).toBe(gridMove(i, 10, 4, key))
    }
  })
  it('카드가 없으면 -1', () => {
    expect(sectionMove(0, [], 'ArrowDown')).toBe(-1)
  })
})

describe('표시', () => {
  it('크기 · 시각', () => {
    expect(formatSize(812)).toBe('812 B')
    expect(formatSize(2048)).toBe('2.0 KB')
    expect(formatSize(20480)).toBe('20 KB')
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(formatSize(undefined)).toBe('')
    expect(formatTime(at(2026, 11, 26, 9), NOW)).toBe('09:00')
    expect(formatTime(at(2026, 11, 2, 9), NOW)).toBe('2026-11-02 09:00')
  })
})
