import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { activeIndex, outlineOf, plainHeading, sameOutline } from './outline'

const state = (text: string) => EditorState.create({ doc: text, extensions: [markdown({ base: markdownLanguage })] })
const brief = (text: string) => outlineOf(state(text), 1000).map((i) => [i.level, i.text, i.line])

describe('목차 — 제목 뽑기', () => {
  it('ATX 제목의 단계 · 글 · 줄', () => {
    expect(brief('# 개요\n\n본문\n\n## 1.1 소개\n### 깊이\n#### 넷\n')).toEqual([[1, '개요', 1], [2, '1.1 소개', 5], [3, '깊이', 6], [4, '넷', 7]])
  })

  it('코드 펜스 안의 # 은 제목이 아니다', () => {
    expect(brief('# 위\n\n```cs\n# 주석 아님\n## 이것도\n```\n\n    # 들여쓴 코드\n\n## 아래\n')).toEqual([[1, '위', 1], [2, '아래', 10]])
  })

  it('Setext 제목 (=== · ---)', () => {
    expect(brief('큰 제목\n===\n\n작은 제목\n---\n')).toEqual([[1, '큰 제목', 1], [2, '작은 제목', 4]])
  })

  it('닫는 # 과 인라인 표식을 뗀다', () => {
    expect(brief('## **굵게** 와 `코드` ##\n### [링크](a.md) 와 ~~취소~~\n')).toEqual([[2, '굵게 와 코드', 1], [3, '링크 와 취소', 2]])
  })

  it('# 뒤에 공백이 없으면 제목이 아니다 · 빈 문서', () => {
    expect(brief('#태그\n')).toEqual([])
    expect(brief('')).toEqual([])
  })

  it('누르면 갈 자리는 제목 글의 처음', () => {
    const [h] = outlineOf(state('본문\n## 제목\n'), 1000)
    expect(h.from).toBe(3)
    expect(h.textFrom).toBe(6)
  })

  it('인용 · 목록 안의 제목도 넣는다', () => {
    expect(brief('> # 인용 제목\n\n- ## 목록 제목\n')).toEqual([[1, '인용 제목', 1], [2, '목록 제목', 3]])
  })
})

describe('목차 — 지금 절', () => {
  const items = outlineOf(state('앞\n# A\n본문\n## B\n본문\n## C\n'), 1000)
  it('그 줄이나 위의 마지막 제목', () => {
    expect(activeIndex(items, 1)).toBe(-1)
    expect(activeIndex(items, 2)).toBe(0)
    expect(activeIndex(items, 3)).toBe(0)
    expect(activeIndex(items, 4)).toBe(1)
    expect(activeIndex(items, 99)).toBe(2)
    expect(activeIndex([], 5)).toBe(-1)
  })
  it('같은 목차인지', () => {
    expect(sameOutline(items, outlineOf(state('앞\n# A\n본문\n## B\n본문\n## C\n'), 1000))).toBe(true)
    expect(sameOutline(items, outlineOf(state('앞\n# A\n본문\n## B\n본문\n## D\n'), 1000))).toBe(false)
  })
})

describe('제목 글 다듬기', () => {
  it('강조 · 그림 · 이스케이프', () => {
    expect(plainHeading('*기울임* 과 _밑줄_')).toBe('기울임 과 밑줄')
    expect(plainHeading('![그림](a.png) 설명')).toBe('그림 설명')
    expect(plainHeading('1\\. 번호')).toBe('1. 번호')
    expect(plainHeading('snake_case_name')).toBe('snake_case_name')
  })
})
