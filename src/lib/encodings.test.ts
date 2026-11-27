import { describe, expect, it } from 'vitest'
import { REOPEN_ENCODINGS, decoderName, encodingName, isReopenEncoding } from './encodings'
import { decodeText } from './fsa/fsaBackend'
import { splitCellSpaces } from './invisibles'

/** 다른 인코딩으로 다시 열기 · 보이지 않는 문자 (ADOPT C4 · DESIGN §55) */

describe('다른 인코딩으로 다시 열기', () => {
  // "가" 의 EUC-KR 바이트, Shift_JIS 의 "あ"
  const eucKr = new Uint8Array([0xb0, 0xa1])
  const sjis = new Uint8Array([0x82, 0xa0])

  it('짐작: UTF-8 이 아니면 EUC-KR', () => {
    expect(decodeText(eucKr)).toEqual({ text: '가', encoding: 'euc-kr' })
  })
  it('고른 인코딩으로 다시 읽는다 — 짐작하지 않는다', () => {
    expect(decodeText(sjis, 'shift_jis')).toEqual({ text: 'あ', encoding: 'shift_jis' })
    // 깨진 바이트가 든 UTF-8 — 그 자리만 �
    expect(decodeText(new Uint8Array([0x61, 0xff, 0x62]), 'utf-8-replace')).toEqual({ text: 'a�b', encoding: 'utf-8-replace' })
  })
  it('UTF-16 · 바이너리는 골라도 열지 않는다', () => {
    expect(() => decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0]), 'euc-kr')).toThrow()
    expect(() => decodeText(new Uint8Array([0x61, 0, 0x62]), 'euc-kr')).toThrow()
  })
  it('표의 인코딩은 모두 브라우저 디코더가 안다, 이름', () => {
    for (const e of REOPEN_ENCODINGS) expect(() => new TextDecoder(decoderName(e.id))).not.toThrow()
    expect(encodingName('euc-kr')).toBe('EUC-KR')
    expect(encodingName('utf-8-replace')).toBe('UTF-8 (깨짐 대체)')
    expect(isReopenEncoding('gbk')).toBe(true)
    expect(isReopenEncoding('utf-8')).toBe(false)
  })
})

describe('보이지 않는 문자 — 셀 앞뒤 공백', () => {
  it('앞 · 가운데 · 뒤, 가운데 탭은 →', () => {
    expect(splitCellSpaces('  가 나 ')).toEqual([2, '가 나', 1])
    expect(splitCellSpaces('a\tb')).toEqual([0, 'a→b', 0])
    expect(splitCellSpaces('   ')).toEqual([3, '', 0])
    expect(splitCellSpaces('')).toEqual([0, '', 0])
  })
})
