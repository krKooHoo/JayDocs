import { csvOpenWarnings, parseCsv, serializeCsv } from './csv'
import type { TableFormat, TsvTable } from './model'
import { openWarnings, parseTsv } from './parse'
import { serializeTsv } from './serialize'
import { fileTypeOf } from '../filetypes.mjs'

/**
 * 표 파일 읽기·쓰기의 한 곳 — 경로의 형식(형식 표의 codec)에 따라 TSV 또는 CSV.
 * 스토어·diff·bake 는 parseTsv/serializeTsv 대신 이것을 부른다.
 */
export function tableFormatOf(path: string): TableFormat {
  return fileTypeOf(path)?.codec === 'csv' ? 'csv' : 'tsv'
}

export function parseTable(text: string, path: string): TsvTable {
  return tableFormatOf(path) === 'csv' ? parseCsv(text) : parseTsv(text)
}

export function serializeTable(t: TsvTable): string {
  return t.format === 'csv' ? serializeCsv(t) : serializeTsv(t)
}

export function tableOpenWarnings(t: TsvTable): string[] {
  return t.format === 'csv' ? csvOpenWarnings(t) : openWarnings(t)
}

/**
 * 셀에 넣을 값 정리. TSV 는 탭·줄바꿈을 표현할 수 없어 공백으로 바꾼다.
 * CSV 는 따옴표로 감싸면 되니 그대로 둔다(줄바꿈은 LF 로 맞춘다). 바뀐 게 있으면 두 번째 값이 true
 */
export function sanitizeFor(format: TableFormat | undefined, v: string): [string, boolean] {
  if (format === 'csv') {
    const n = v.replace(/\r\n?/g, '\n')
    return [n, false]
  }
  if (!/[\t\r\n]/.test(v)) return [v, false]
  return [v.replace(/\r\n|\r|\n/g, ' ').replace(/\t/g, ' '), true]
}
