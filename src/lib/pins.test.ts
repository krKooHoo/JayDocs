import { describe, expect, it } from 'vitest'
import { PINS_MAX, parsePins, removePins, renamePins, togglePin } from './pins'

/** 고정 (ADOPT B4 · DESIGN §49) */

describe('고정 목록', () => {
  it('고정은 끝에, 다시 하면 해제', () => {
    expect(togglePin(['a.md'], 'b.md')).toEqual(['a.md', 'b.md'])
    expect(togglePin(['a.md', 'b.md'], 'a.md')).toEqual(['b.md'])
  })

  it('가져온 폴더 경로는 주 폴더의 같은 이름과 따로', () => {
    expect(togglePin(['docs/a.md'], '@ref/docs/a.md')).toEqual(['docs/a.md', '@ref/docs/a.md'])
  })

  it('이름 바꾸기 · 옮기기 — 자리는 그대로, 폴더면 그 아래도', () => {
    expect(renamePins(['x.md', 'docs/a.md', 'y.md'], 'docs/a.md', 'notes/b.md')).toEqual(['x.md', 'notes/b.md', 'y.md'])
    expect(renamePins(['docs', 'docs/a.md', 'docsx/c.md'], 'docs', 'doc')).toEqual(['doc', 'doc/a.md', 'docsx/c.md'])
  })

  it('지우기 — 그 경로와 그 아래', () => {
    expect(removePins(['docs', 'docs/a.md', 'docsx/c.md', 'b.md'], 'docs')).toEqual(['docsx/c.md', 'b.md'])
  })

  it('저장분 읽기 — 깨진 것 · 겹친 것 · 너무 많은 것', () => {
    expect(parsePins(null)).toEqual([])
    expect(parsePins('{')).toEqual([])
    expect(parsePins('{"a":1}')).toEqual([])
    expect(parsePins('["a.md", 3, "", "a.md", "b.md"]')).toEqual(['a.md', 'b.md'])
    expect(parsePins(JSON.stringify(Array.from({ length: PINS_MAX + 5 }, (_, i) => `${i}.md`)))).toHaveLength(PINS_MAX)
  })
})
