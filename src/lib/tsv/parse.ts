import type { Eol, TsvRow, TsvTable } from './model'

/**
 * 텍스트 → 표. 따옴표는 해석하지 않는다 (DESIGN §2: Google Sheets TSV 는 따옴표를 쓰지 않는다).
 * BOM · 줄바꿈 종류 · 끝 개행 유무를 기록해 두고, 행마다 원문을 보관한다.
 */
export function parseTsv(input: string): TsvTable {
  let text = input
  const bom = text.charCodeAt(0) === 0xfeff
  if (bom) text = text.slice(1)

  const crlf = count(text, '\r\n')
  const lf = count(text, '\n')
  // 다수 쪽을 파일의 줄바꿈으로 본다. 섞여 있으면 저장 때 통일된다 (mixedEol 로 알린다).
  const eol: Eol = crlf > 0 && crlf * 2 >= lf ? '\r\n' : '\n'
  const mixedEol = crlf > 0 && crlf !== lf

  let lines: string[]
  let trailingNewline = false
  if (text === '') {
    lines = []
  } else {
    lines = text.split(/\r\n|\n/)
    if (lines[lines.length - 1] === '') {
      trailingNewline = true
      lines.pop()
    }
  }

  const rows: TsvRow[] = lines.map((line) => ({ raw: line, cells: line.split('\t') }))
  let width = 0
  for (const r of rows) if (r.cells.length > width) width = r.cells.length
  return { bom, eol, mixedEol, trailingNewline, width, rows }
}

function count(s: string, needle: string): number {
  let n = 0
  let i = 0
  for (;;) {
    i = s.indexOf(needle, i)
    if (i < 0) return n
    n++
    i += needle.length
  }
}

/** 파일을 열 때 한 번 보여 줄 경고 (DESIGN §6.1) */
export function openWarnings(t: TsvTable): string[] {
  const out: string[] = []
  if (t.mixedEol) out.push(`CRLF 와 LF 가 섞여 있습니다. 저장하면 ${t.eol === '\r\n' ? 'CRLF' : 'LF'} 로 통일됩니다`)
  let quoted = 0
  for (const r of t.rows) for (const c of r.cells) if (c.startsWith('"')) quoted++
  if (quoted) out.push(`따옴표로 시작하는 셀이 ${quoted}개 있습니다. JayDocs 는 따옴표를 해석하지 않고 글자 그대로 둡니다`)
  return out
}
