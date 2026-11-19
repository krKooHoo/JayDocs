import { describe, expect, it } from 'vitest'
import { headText, normalizeText } from './head'

describe('normalizeText', () => {
  it('BOM 을 떼고 줄바꿈을 LF 로 — 줄 수는 그대로', () => {
    expect(normalizeText('\ufeffa\r\nb\rc\n')).toBe('a\nb\nc\n')
    expect(normalizeText('a\nb')).toBe('a\nb')
    expect(normalizeText('')).toBe('')
  })
})

describe('headText — 앞 N줄', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `줄 ${i + 1}`).join('\n')

  it('짧으면 그대로', () => {
    const t = lines(3)
    expect(headText(t, 3)).toBe(t)
    expect(headText(t, 10)).toBe(t)
    expect(headText('a\nb\n', 2)).toBe('a\nb\n')
    expect(headText('', 5)).toBe('')
  })

  it('길면 앞 N줄만', () => {
    expect(headText('a\nb\nc', 2)).toBe('a\nb')
    expect(headText(lines(100), 10)).toBe(lines(10))
    expect(headText('a\nb', 0)).toBe('')
  })

  it('md: 펜스 한가운데에서는 자르지 않고 닫히는 줄까지 간다', () => {
    const md = ['# 제목', '```mermaid', 'graph LR', '  A --> B', '```', '뒤 1', '뒤 2'].join('\n')
    expect(headText(md, 3, 'md')).toBe(['# 제목', '```mermaid', 'graph LR', '  A --> B', '```'].join('\n'))
    // 평문이면 그냥 자른다
    expect(headText(md, 3, 'text')).toBe(['# 제목', '```mermaid', 'graph LR'].join('\n'))
    // 펜스가 이미 닫혔으면 N줄에서
    expect(headText(md, 6, 'md')).toBe(md.split('\n').slice(0, 6).join('\n'))
  })

  it('md: ~~~ 펜스 · 더 긴 닫는 펜스 · 펜스 안의 다른 펜스 글자', () => {
    const md = ['~~~', '```', 'x', '~~~~', '뒤', '끝'].join('\n')
    expect(headText(md, 2, 'md')).toBe(['~~~', '```', 'x', '~~~~'].join('\n'))
    const longer = ['````', '```', 'x', '````', '뒤', '끝'].join('\n')
    expect(headText(longer, 2, 'md')).toBe(['````', '```', 'x', '````'].join('\n'))
  })

  it('md: 닫히지 않는 펜스는 2배에서 끊는다', () => {
    const md = '```\n' + lines(100)
    expect(headText(md, 10, 'md').split('\n').length).toBe(20)
  })
})
