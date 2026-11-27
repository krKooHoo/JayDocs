import { describe, expect, it } from 'vitest'
import { createEchoGuard, scrollSyncOn, scrollTurn, toggleScrollSync } from './scrollSync'

/** 분할 보기 스크롤 맞추기 (ADOPT C5 · DESIGN §56) */

describe('분할 보기 스크롤 맞추기', () => {
  it('되울림 막기 — 써 넣은 쪽만, 잠깐만', () => {
    let t = 0
    const g = createEchoGuard(100, () => t)
    expect(g.echo('preview')).toBe(false)
    g.wrote('preview')
    t = 50
    expect(g.echo('preview')).toBe(true)
    expect(g.echo('editor')).toBe(false)
    t = 100
    expect(g.echo('preview')).toBe(false)
  })
  it('계속 써 넣으면 그동안은 계속 되울림', () => {
    let t = 0
    const g = createEchoGuard(100, () => t)
    for (t = 0; t < 500; t += 16) {
      g.wrote('editor')
      expect(g.echo('editor')).toBe(true)
    }
  })
  it('사람이 만지는 쪽의 스크롤은 늘 따른다, 반대쪽은 맞춰 준 것이면 무시', () => {
    // 편집기를 굴리는 중 — 맞춰 준 미리보기의 스크롤은 되울림
    expect(scrollTurn('editor', 'editor', false)).toBe('editor')
    expect(scrollTurn('preview', 'editor', true)).toBeNull()
    // 맞춰 준 직후라도 사람이 미리보기를 굴리면(lead 가 미리보기) 따른다
    expect(scrollTurn('preview', 'preview', true)).toBe('preview')
    // 목차 · 찾기로 편집기가 뛰었다 — 되울림이 아니면 그쪽이 새 기준
    expect(scrollTurn('editor', 'preview', false)).toBe('editor')
  })
  it('기본 켜짐, 켜고 끄기', () => {
    expect(scrollSyncOn()).toBe(true)
    expect(toggleScrollSync()).toBe(false)
    expect(scrollSyncOn()).toBe(false)
    expect(toggleScrollSync()).toBe(true)
  })
})
