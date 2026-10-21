import type { Eol, TsvRow, TsvTable } from './model'

/**
 * CSV (RFC 4180) ↔ 표. 셀 모델은 TSV 와 같고 (PLAN-folder-import F8) 왕복 규칙도 같다 —
 * 고치지 않은 레코드는 원문(raw) 그대로, 고친 레코드만 다시 조립한다.
 *
 * - 구분자는 쉼표. `"` 로 시작하는 칸은 따옴표 칸 — 안의 `""` 는 `"`, 쉼표·줄바꿈도 글자다.
 * - 레코드 끝은 따옴표 밖의 CRLF 또는 LF. 줄바꿈 종류는 레코드 끝만 세어 정한다(칸 안 줄바꿈은 그대로 둔다).
 * - 닫는 따옴표 뒤에 글자가 더 있거나 따옴표가 안 닫히면 너그럽게 읽고 경고한다.
 */
export function parseCsv(input: string): TsvTable {
  let text = input
  const bom = text.charCodeAt(0) === 0xfeff
  if (bom) text = text.slice(1)

  const rows: TsvRow[] = []
  let crlf = 0
  let lf = 0
  let malformed = 0
  let trailingNewline = false
  const n = text.length
  let i = 0

  while (i < n) {
    const start = i
    const cells: string[] = []
    const quoted: boolean[] = []
    let ended = false // 레코드 끝 줄바꿈을 만났나
    for (;;) {
      // 칸 하나
      if (text[i] === '"') {
        let v = ''
        i++
        let closed = false
        while (i < n) {
          const ch = text[i]
          if (ch === '"') {
            if (text[i + 1] === '"') { v += '"'; i += 2; continue }
            i++
            closed = true
            break
          }
          v += ch
          i++
        }
        if (!closed) malformed++
        // 닫는 따옴표 뒤 쉼표·줄바꿈 전까지의 찌꺼기는 붙인다 (Excel 과 같은 너그러움)
        let tail = ''
        while (i < n && text[i] !== ',' && text[i] !== '\n' && !(text[i] === '\r' && text[i + 1] === '\n')) tail += text[i++]
        if (tail) malformed++
        cells.push(v + tail)
        quoted.push(true)
      } else {
        let v = ''
        while (i < n && text[i] !== ',' && text[i] !== '\n' && !(text[i] === '\r' && text[i + 1] === '\n')) v += text[i++]
        cells.push(v)
        quoted.push(false)
      }
      // 구분자
      if (i >= n) break
      if (text[i] === ',') { i++; continue }
      const end = i
      if (text[i] === '\r') { crlf++; i += 2 } else { lf++; i++ }
      rows.push(row(text.slice(start, end), cells, quoted))
      ended = true
      break
    }
    if (!ended) { rows.push(row(text.slice(start), cells, quoted)); break }
    if (i >= n) trailingNewline = true
  }

  const eol: Eol = crlf > 0 && crlf >= lf ? '\r\n' : '\n'
  const mixedEol = crlf > 0 && lf > 0
  let width = 0
  for (const r of rows) if (r.cells.length > width) width = r.cells.length
  return { format: 'csv', bom, eol, mixedEol, trailingNewline, width, rows, ...(malformed ? { malformedCells: malformed } : {}) }
}

function row(raw: string, cells: string[], quoted: boolean[]): TsvRow {
  return { raw, cells, quoted }
}

/** 따옴표로 감싸야 하는 칸: 쉼표 · 따옴표 · 줄바꿈 */
function needsQuote(v: string) {
  return /[",\r\n]/.test(v)
}

function quote(v: string) {
  return `"${v.replace(/"/g, '""')}"`
}

/** 고친 레코드 하나를 다시 조립. 원래 칸 수를 지키되, 뒤에 값이 들어온 칸까지는 늘린다 */
export function joinCsvRow(r: TsvRow, width: number): string {
  let last = r.cells.length - 1
  while (last >= 0 && r.cells[last] === '') last--
  const n = r.quoted ? Math.max(r.quoted.length, last + 1) : Math.max(width, last + 1)
  const out: string[] = []
  for (let c = 0; c < n; c++) {
    const v = r.cells[c] ?? ''
    out.push(r.quoted?.[c] || needsQuote(v) ? quote(v) : v)
  }
  return out.join(',')
}

export function serializeCsv(t: TsvTable): string {
  const body = t.rows.map((r) => r.raw ?? joinCsvRow(r, t.width)).join(t.eol)
  return (t.bom ? '﻿' : '') + body + (t.trailingNewline ? t.eol : '')
}

/** 열 때 한 번 보여 줄 경고 */
export function csvOpenWarnings(t: TsvTable): string[] {
  const out: string[] = []
  if (t.mixedEol) out.push(`CRLF 와 LF 가 섞여 있습니다. 고친 줄은 ${t.eol === '\r\n' ? 'CRLF' : 'LF'} 로 씁니다`)
  const bad = t.malformedCells
  if (bad) out.push(`따옴표가 맞지 않는 칸이 ${bad}개 있습니다. 읽을 수 있는 만큼 읽었습니다 — 그 행을 고쳐 저장하면 정리된 모양으로 바뀝니다`)
  return out
}
