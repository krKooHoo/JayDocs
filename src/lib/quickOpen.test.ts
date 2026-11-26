import { describe, expect, it } from 'vitest'
import { findInText, headingsOf, parseQuickOpen, snippetOf, tsvColumnAt } from './quickOpen'

/** 빠른 열기 확장 · 전체 검색 (ADOPT B1 · B2, DESIGN §47) */

describe('빠른 열기 입력 규칙', () => {
  it('이름 · 이름:줄 · #제목', () => {
    expect(parseQuickOpen('개요')).toEqual({ kind: 'name', name: '개요' })
    expect(parseQuickOpen('개요.md:12')).toEqual({ kind: 'line', name: '개요.md', line: 12 })
    expect(parseQuickOpen(' 표:0 ')).toEqual({ kind: 'line', name: '표', line: 1 })
    expect(parseQuickOpen('#설계')).toEqual({ kind: 'heading', text: '설계' })
    expect(parseQuickOpen('## 설계')).toEqual({ kind: 'heading', text: '설계' })
    expect(parseQuickOpen('#')).toEqual({ kind: 'heading', text: '' })
  })
  it('숫자만이거나 줄이 숫자가 아니면 이름', () => {
    expect(parseQuickOpen(':12')).toEqual({ kind: 'name', name: ':12' })
    expect(parseQuickOpen('a:b')).toEqual({ kind: 'name', name: 'a:b' })
  })
})

describe('제목', () => {
  it('ATX 제목 · 줄 번호, 코드 펜스 안은 빼고 끝의 # 은 뗀다', () => {
    const text = '﻿# 개요\n본문\n## 설계 ##\n```sh\n# 주석\n```\n~~~\n# 아님\n~~~\n### 끝\n#해시태그'
    expect(headingsOf(text)).toEqual([
      { level: 1, text: '개요', line: 1 },
      { level: 2, text: '설계', line: 3 },
      { level: 3, text: '끝', line: 10 },
    ])
  })
  it('CRLF', () => {
    expect(headingsOf('a\r\n# 제목\r\n')).toEqual([{ level: 1, text: '제목', line: 2 }])
  })
})

describe('본문 찾기', () => {
  it('대소문자를 가리지 않고 줄마다 첫 자리', () => {
    const hits = findInText('Alpha beta\nno\r\nBETA beta\n끝 beta', 'beta')
    expect(hits.map((h) => [h.line, h.col, h.text])).toEqual([[1, 6, 'Alpha beta'], [3, 0, 'BETA beta'], [4, 2, '끝 beta']])
  })
  it('max 줄에서 멈춘다, 빈 글자는 없음', () => {
    expect(findInText('a\na\na\na', 'a', 2)).toHaveLength(2)
    expect(findInText('abc', '')).toEqual([])
  })
  it('마지막 줄 · 개행 없는 끝', () => {
    expect(findInText('x\ny', 'y')).toEqual([{ line: 2, col: 0, len: 1, text: 'y' }])
  })
  it('긴 줄은 맞은 자리 둘레만', () => {
    const long = 'x'.repeat(300) + '찾기' + 'y'.repeat(300)
    const [h] = findInText(long, '찾기')
    const s = snippetOf(h)
    expect(s.text.slice(s.col, s.col + 2)).toBe('찾기')
    expect(s.text.startsWith('…')).toBe(true)
    expect(s.text.endsWith('…')).toBe(true)
  })
  it('TSV 줄의 글자 자리 → 열', () => {
    expect(tsvColumnAt('a\tbb\tccc', 0)).toBe(0)
    expect(tsvColumnAt('a\tbb\tccc', 3)).toBe(1)
    expect(tsvColumnAt('a\tbb\tccc', 6)).toBe(2)
  })
})
