import { describe, expect, it } from 'vitest'
import { checkEntryPath, cleanEntryPath, nameStemRange } from './names'

const taken = new Set(['docs/표.tsv', 'docs', 'readme.md', '@수업/과제.md'])
const exists = (p: string) => taken.has(p)
const file = (path: string, current?: string) => checkEntryPath(cleanEntryPath(path), { kind: 'file', exists, current })
const dir = (path: string) => checkEntryPath(cleanEntryPath(path), { kind: 'dir', exists })

describe('입력한 경로 다듬기', () => {
  it('역슬래시는 슬래시로, 앞뒤 공백과 슬래시는 뗀다', () => {
    expect(cleanEntryPath('  docs\\새 문서.md ')).toBe('docs/새 문서.md')
    expect(cleanEntryPath('/docs/a.md/')).toBe('docs/a.md')
    expect(cleanEntryPath('   ')).toBe('')
  })
})

describe('새 이름 검사', () => {
  it('문제없는 이름은 null', () => {
    expect(file('docs/새 문서.md')).toBeNull()
    expect(file('새 표.TSV')).toBeNull()
    expect(file('@수업/3주차/메모.txt')).toBeNull()
    expect(dir('docs/새 폴더')).toBeNull()
  })

  it('빈 값', () => {
    expect(file('')).toBe('이름을 입력하세요')
    expect(dir('  / ')).toBe('이름을 입력하세요')
  })

  it('금지 문자 · 절대 경로 · 점 조각', () => {
    expect(file('a?b.md')).toContain('쓸 수 없는 글자')
    expect(file('a?b.md')).toContain('?')
    expect(file('표<1>.tsv')).toContain('< >')
    expect(file('C:\\Users\\a.md')).toContain('절대 경로')
    expect(file('docs/../a.md')).toContain('..')
    expect(file('docs//a.md')).toContain('빈 이름')
    expect(dir('새 폴더./안')).toContain('점이나 공백')
    expect(dir('docs/.git')).toContain('.git')
  })

  it('파일은 열 수 있는 확장자로 끝나야 하고 이름이 있어야 한다', () => {
    expect(file('메모.docx')).toContain('중 하나로 끝나야')
    expect(file('메모')).toContain('중 하나로 끝나야')
    expect(file('docs/.md')).toContain('확장자 앞에 이름')
    // 폴더는 확장자를 보지 않는다
    expect(dir('v1.2')).toBeNull()
  })

  it('이미 있는 이름은 대소문자를 가리지 않고 막는다', () => {
    expect(file('README.md')).toBe('이미 있는 이름입니다: README.md')
    expect(file('docs/표.tsv')).toContain('이미 있는 이름')
    expect(dir('Docs')).toContain('이미 있는 이름')
    expect(file('@수업/과제.md')).toContain('이미 있는 이름')
  })

  it('이름 바꾸기: 대소문자만 바꾸는 것은 된다, 다른 파일과 겹치면 안 된다', () => {
    expect(file('Readme.md', 'readme.md')).toBeNull()
    expect(file('docs/표.tsv', 'readme.md')).toContain('이미 있는 이름')
  })
})

describe('처음 선택할 범위 (확장자 앞의 이름)', () => {
  const picked = (p: string) => p.slice(...nameStemRange(p))
  it('마지막 / 뒤부터 확장자 앞까지', () => {
    expect(picked('docs/표.tsv')).toBe('표')
    expect(picked('새 문서.md')).toBe('새 문서')
    expect(picked('@수업/3주차/과제.v2.md')).toBe('과제.v2')
  })
  it('확장자가 없으면 이름 전체 (폴더, 점으로 시작하는 이름)', () => {
    expect(picked('docs/새 폴더')).toBe('새 폴더')
    expect(picked('v1.2/새 폴더')).toBe('새 폴더')
    expect(picked('.editorconfig')).toBe('.editorconfig')
  })
})
