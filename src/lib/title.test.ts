import { describe, expect, it } from 'vitest'
import { windowTitle } from './title'

describe('창 제목', () => {
  it('활성 문서 · 루트 별칭 · 앱 이름', () => {
    expect(windowTitle({ rootLabel: 'dev-docs', activePath: 'docs/개요.md', dirty: false })).toBe('개요.md — dev-docs — JayDocs')
  })
  it('저장 안 한 문서가 있으면 앞에 ●', () => {
    expect(windowTitle({ rootLabel: 'dev-docs', activePath: 'docs/개요.md', dirty: true })).toBe('● 개요.md — dev-docs — JayDocs')
  })
  it('열린 문서가 없으면 루트 별칭만', () => {
    expect(windowTitle({ rootLabel: 'dev-docs', activePath: null, dirty: false })).toBe('dev-docs — JayDocs')
    expect(windowTitle({ rootLabel: 'dev-docs', activePath: null, dirty: true })).toBe('● dev-docs — JayDocs')
  })
  it('가져온 폴더의 문서도 파일 이름만', () => {
    expect(windowTitle({ rootLabel: 'Docs', activePath: '@수업자료/03주차/과제.md', dirty: false })).toBe('과제.md — Docs — JayDocs')
  })
})
