import type { TsvRow, TsvTable } from './model'

/**
 * 표 → 텍스트. 수정하지 않은 행(raw) 은 그대로, 수정한 행만 너비에 맞춰 다시 조립한다.
 * BOM · 줄바꿈 · 끝 개행을 읽을 때 기록한 대로 되돌린다.
 */
export function serializeTsv(t: TsvTable): string {
  const body = t.rows.map((r) => r.raw ?? joinCells(r, t.width)).join(t.eol)
  return (t.bom ? '﻿' : '') + body + (t.trailingNewline ? t.eol : '')
}

function joinCells(r: TsvRow, width: number): string {
  const cells = r.cells.length >= width ? r.cells : [...r.cells, ...new Array<string>(width - r.cells.length).fill('')]
  return cells.join('\t')
}

/** 셀에 들어가면 TSV 로 표현할 수 없는 글자를 치운다. 바뀐 게 있으면 두 번째 값이 true (CSV 는 table.ts 의 sanitizeFor) */
export function sanitizeCell(v: string): [string, boolean] {
  if (!/[\t\r\n]/.test(v)) return [v, false]
  return [v.replace(/\r\n|\r|\n/g, ' ').replace(/\t/g, ' '), true]
}
