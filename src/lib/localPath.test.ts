import { describe, expect, it } from 'vitest'
import { explorerUrl } from './explorer'
import { newestFirst } from './fsa/workspace'
import { checkPath, cleanPath, guessPath, joinLocal } from './localPath'

describe('cleanPath', () => {
  it.each([
    ['  "C:\\Users\\jay\\SagaDocs"  ', 'C:\\Users\\jay\\SagaDocs'],
    ['C:/Users/jay/SagaDocs/', 'C:\\Users\\jay\\SagaDocs'],
    ['C:\\Users\\jay\\\\', 'C:\\Users\\jay'],
    ['D:\\', 'D:\\'],
    ['/Users/jay/docs/', '/Users/jay/docs'],
    ['/', '/'],
  ])('%s → %s', (raw, out) => expect(cleanPath(raw)).toBe(out))
})

describe('checkPath', () => {
  it('끝 이름이 고른 폴더와 맞으면 통과 (대소문자 무시, 자모 분리 형태도)', () => {
    expect(checkPath('C:\\a\\SagaDocs', 'sagadocs')).toBeNull()
    expect(checkPath('/Users/jay/문서', '문서'.normalize('NFD'))).toBeNull()
    expect(checkPath('\\\\서버\\공유\\문서', '문서')).toBeNull()
  })
  it('드라이브 루트는 이름을 비교하지 않는다', () => {
    expect(checkPath('D:\\', 'D:\\')).toBeNull()
  })
  it('끝 이름이 다르면 거부', () => {
    expect(checkPath('C:\\a\\SagaDocs', 'Project-SAGA')).toContain('"Project-SAGA"')
  })
  it.each(['SagaDocs', 'a\\b', '.\\a', 'C:', 'C:a'])('%s 는 전체 경로가 아니다', (p) => {
    expect(checkPath(p, 'a')).toContain('전체 경로')
  })
  it('Windows 에서 못 쓰는 글자를 거부', () => {
    expect(checkPath('C:\\a"b\\c', 'c')).toContain('쓸 수 없는')
  })
})

describe('joinLocal', () => {
  it('구분자를 OS 경로에 맞춘다', () => {
    expect(joinLocal('C:\\a\\Docs', '00-jay/saga/x.md')).toBe('C:\\a\\Docs\\00-jay\\saga\\x.md')
    expect(joinLocal('/Users/jay/Docs', '00-jay/x.md')).toBe('/Users/jay/Docs/00-jay/x.md')
  })
  it('드라이브 루트에 구분자를 겹치지 않는다', () => {
    expect(joinLocal('D:\\', 'a/b.md')).toBe('D:\\a\\b.md')
  })
  it('빈 경로는 폴더 자체', () => {
    expect(joinLocal('C:\\a', '')).toBe('C:\\a')
  })
})

describe('guessPath', () => {
  it('아는 경로의 옆 폴더로 채운다', () => {
    expect(guessPath('C:\\Users\\jay\\GitHub\\SagaDocs', 'Project-SAGA')).toBe('C:\\Users\\jay\\GitHub\\Project-SAGA')
    expect(guessPath('C:\\Docs', 'b')).toBe('C:\\b')
    expect(guessPath('/Users/jay/a', 'b')).toBe('/Users/jay/b')
  })
  it('드라이브 루트만 알면 채우지 않는다', () => {
    expect(guessPath('D:\\', 'b')).toBe('')
  })
})

describe('탐색기 주소', () => {
  it('한글 · 공백 · 특수문자가 그대로 돌아온다', () => {
    const p = 'C:\\문서 모음\\50%&#a+b\\표.tsv'
    const url = explorerUrl(p)
    expect(url).toMatch(/^jaydocs-open:[A-Za-z0-9%._~!*'()-]+$/)
    expect(decodeURIComponent(url.replace('jaydocs-open:', ''))).toBe(p)
  })
})

describe('최근 폴더 순서', () => {
  it('최근 순. 기록이 없는 옛 항목은 뒤로', () => {
    const list = newestFirst([{ id: 'old' }, { id: 'a', openedAt: 1 }, { id: 'b', openedAt: 2 }])
    expect(list.map((x) => x.id)).toEqual(['b', 'a', 'old'])
  })
})
