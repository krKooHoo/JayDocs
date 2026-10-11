import { describe, expect, it } from 'vitest'
import { parseTsv } from './parse'
import { serializeTsv } from './serialize'
import { cellMatches, findMatches, matchIndex, replaceAll, replaceInCell, stepMatch, type FindOptions } from './find'

const loose: FindOptions = { matchCase: false, wholeCell: false }
const exact: FindOptions = { matchCase: true, wholeCell: false }
const whole: FindOptions = { matchCase: false, wholeCell: true }

describe('찾기', () => {
  const t = parseTsv('#string\tenum\nKey\tTerrain\nA\tPlains\nB\tplains, Hill\nC\t\n')

  it('빈 찾을 말은 아무것도 찾지 않는다', () => {
    expect(findMatches(t, '', loose)).toEqual([])
    expect(cellMatches('abc', '', loose)).toBe(false)
  })
  it('헤더 행까지 위→아래, 왼→오 순서로', () => {
    expect(findMatches(t, 'e', loose)).toEqual([{ r: 0, c: 1 }, { r: 1, c: 0 }, { r: 1, c: 1 }])
    expect(findMatches(t, 'in', loose)).toEqual([{ r: 0, c: 0 }, { r: 1, c: 1 }, { r: 2, c: 1 }, { r: 3, c: 1 }])
  })
  it('대소문자 구분', () => {
    expect(findMatches(t, 'plains', loose)).toEqual([{ r: 2, c: 1 }, { r: 3, c: 1 }])
    expect(findMatches(t, 'plains', exact)).toEqual([{ r: 3, c: 1 }])
  })
  it('셀 전체 일치', () => {
    expect(findMatches(t, 'plains', whole)).toEqual([{ r: 2, c: 1 }])
    expect(findMatches(t, 'plains', { matchCase: true, wholeCell: true })).toEqual([])
    expect(cellMatches('Hill', 'hil', whole)).toBe(false)
  })
  it('정규식 글자는 글자 그대로', () => {
    expect(cellMatches('a.b', '.', loose)).toBe(true)
    expect(cellMatches('ab', 'a.', loose)).toBe(false)
    expect(cellMatches('(x)*', '(x)*', whole)).toBe(true)
  })
  it('한글', () => {
    expect(findMatches(parseTsv('평지\t언덕\n산\t평원'), '평', loose)).toEqual([{ r: 0, c: 0 }, { r: 1, c: 1 }])
  })
})

describe('바꾸기', () => {
  it('셀 안의 걸린 부분을 전부', () => {
    expect(replaceInCell('Plains, plains', 'plains', 'Hill', loose)).toBe('Hill, Hill')
    expect(replaceInCell('Plains, plains', 'plains', 'Hill', exact)).toBe('Plains, Hill')
    expect(replaceInCell('Plains', 'x', 'y', loose)).toBe('Plains')
  })
  it('셀 전체 일치면 셀 전체를', () => {
    expect(replaceInCell('PLAINS', 'plains', 'Hill', whole)).toBe('Hill')
    expect(replaceInCell('Plains2', 'plains', 'Hill', whole)).toBe('Plains2')
  })
  it('바꿀 말의 $& 같은 치환 패턴은 글자 그대로', () => {
    expect(replaceInCell('a-b', '-', '$&$1', loose)).toBe('a$&$1b')
  })
  it('모두 바꾸기: 한 번의 setCells, 바뀐 셀 수, 건드리지 않은 행은 raw 유지', () => {
    const t = parseTsv('Key\tT\nA\tPlains\nB\tHill\nC\tplains, Hill')
    const { table, count } = replaceAll(t, 'plains', 'Flat', loose)
    expect(count).toBe(2)
    expect(serializeTsv(table)).toBe('Key\tT\nA\tFlat\nB\tHill\nC\tFlat, Hill')
    expect(table.rows[0]).toBe(t.rows[0])
    expect(table.rows[2]).toBe(t.rows[2])
    expect(table.rows[1].raw).toBeNull()
  })
  it('모두 바꾸기: 바뀌는 게 없으면 같은 표', () => {
    const t = parseTsv('a\tb')
    expect(replaceAll(t, 'zz', 'y', loose)).toEqual({ table: t, count: 0 })
    expect(replaceAll(t, '', 'y', loose).table).toBe(t)
    // 대소문자만 다른 같은 값으로 바꾸면 바뀐 셀이 아니다
    expect(replaceAll(t, 'A', 'a', loose).count).toBe(0)
  })
})

describe('다음 / 이전', () => {
  const hits = [{ r: 0, c: 1 }, { r: 2, c: 0 }, { r: 2, c: 3 }, { r: 5, c: 2 }]
  it('다음은 지금 셀 뒤의 첫 결과, 끝이면 처음으로', () => {
    expect(stepMatch(hits, { r: 0, c: 0 }, 1)).toBe(0)
    expect(stepMatch(hits, { r: 0, c: 1 }, 1)).toBe(1)
    expect(stepMatch(hits, { r: 2, c: 1 }, 1)).toBe(2)
    expect(stepMatch(hits, { r: 5, c: 2 }, 1)).toBe(0)
  })
  it('이전은 지금 셀 앞의 마지막 결과, 처음이면 끝으로', () => {
    expect(stepMatch(hits, { r: 2, c: 3 }, -1)).toBe(1)
    expect(stepMatch(hits, { r: 3, c: 0 }, -1)).toBe(2)
    expect(stepMatch(hits, { r: 0, c: 1 }, -1)).toBe(3)
  })
  it('결과가 없으면 -1', () => {
    expect(stepMatch([], { r: 0, c: 0 }, 1)).toBe(-1)
    expect(matchIndex(hits, { r: 2, c: 3 })).toBe(2)
    expect(matchIndex(hits, { r: 9, c: 9 })).toBe(-1)
  })
})
