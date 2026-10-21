import { describe, expect, it } from 'vitest'
import { DOC_EXTS, fileTypeOf, isDocName } from './filetypes.mjs'
import { formatJson, jsonError, valueTokens } from './jsonText'

describe('형식 표', () => {
  it('확장자로 형식을 고른다 (대소문자 무시)', () => {
    expect(fileTypeOf('a/b/기획.md')?.kind).toBe('md')
    expect(fileTypeOf('Tile_Table.TSV')?.kind).toBe('table')
    expect(fileTypeOf('메모.txt')?.kind).toBe('text')
    expect(fileTypeOf('settings.json')?.lang).toBe('json')
  })
  it('모르는 확장자·확장자 없음·점 폴더는 문서가 아니다', () => {
    expect(isDocName('a.png')).toBe(false)
    expect(isDocName('README')).toBe(false)
    expect(isDocName('.hidden/x')).toBe(false)
    expect(isDocName('a.md.bak')).toBe(false)
  })
  it('사이드카가 쓰는 확장자 목록', () => {
    expect(DOC_EXTS).toEqual(['.md', '.tsv', '.csv', '.txt', '.json'])
    expect(fileTypeOf('a/점수.CSV')?.codec).toBe('csv')
  })
})

describe('JSON', () => {
  it('문법 오류만 알린다 (빈 파일은 괜찮음)', () => {
    expect(jsonError('{"a": 1}')).toBeNull()
    expect(jsonError('  \n')).toBeNull()
    expect(jsonError('{"a": 1,}')).not.toBeNull()
  })
  it('정렬은 들여쓰기 2칸, 끝 개행 유무는 원래대로', () => {
    expect(formatJson('{"a":1,"b":[true,null]}')).toEqual({ ok: true, text: '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}' })
    expect(formatJson('{"a":1}\n')).toEqual({ ok: true, text: '{\n  "a": 1\n}\n' })
  })
  it('이스케이프 모양만 다른 문자열은 같은 값으로 본다', () => {
    expect(formatJson('{"k":"\\u00e9\\/"}')).toEqual({ ok: true, text: '{\n  "k": "é/"\n}' })
  })
  it('내용이 바뀌는 정렬은 거부한다', () => {
    expect(formatJson('{"a": 1.0}').ok).toBe(false) // 1.0 → 1
    expect(formatJson('{"id": 12345678901234567890}').ok).toBe(false) // 자릿수 손실
    expect(formatJson('{"a": 1, "a": 2}').ok).toBe(false) // 중복 키
    expect(formatJson('{"2": "x", "1": "y"}').ok).toBe(false) // 숫자 키 순서
    expect(formatJson('{"a": ').ok).toBe(false)
  })
  it('문자열 안의 숫자는 숫자 토큰이 아니다', () => {
    expect(valueTokens('{"v1.0": 2}')).toEqual(['sv1.0', 'n2'])
  })
})
