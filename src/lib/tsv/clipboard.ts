/**
 * 클립보드 TSV. Google Sheets · Excel 은 `text/plain` 에 탭 구분 · 줄바꿈(CRLF 또는 LF) 으로 넣고
 * 마지막에 줄바꿈을 하나 더 붙인다.
 *
 * 따옴표는 원칙적으로 해석하지 않는다 (파일 규칙과 같다). 예외 하나 — Sheets·Excel 은 **칸 안에 줄바꿈이나 탭이
 * 있을 때만** 그 칸을 `"…"` 로 감싸고 안의 `"` 를 `""` 로 쓴다. 그래서 `"` 로 시작하는 칸이 그렇게 읽었을 때
 * 줄바꿈·탭을 담고 있고 바로 뒤가 칸 끝이면 따옴표 칸으로 읽는다. 그 밖의 `"` 는 글자 그대로.
 */
export function parseClipboardTsv(text: string): string[][] {
  if (text === '') return [['']]
  const rows: string[][] = []
  let row: string[] = []
  const n = text.length
  let i = 0
  for (;;) {
    let value: string | null = null
    if (text[i] === '"') {
      const q = readQuoted(text, i)
      if (q && /[\n\t]/.test(q.value) && (q.end >= n || text[q.end] === '\t' || text[q.end] === '\n' || text[q.end] === '\r')) {
        value = q.value
        i = q.end
      }
    }
    if (value === null) {
      let j = i
      while (j < n && text[j] !== '\t' && text[j] !== '\n' && text[j] !== '\r') j++
      value = text.slice(i, j)
      i = j
    }
    row.push(value)
    if (i >= n) { rows.push(row); break }
    if (text[i] === '\t') { i++; continue }
    // 줄 끝 (CRLF · LF · CR)
    i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1
    rows.push(row)
    row = []
    if (i >= n) break
  }
  // 끝의 줄바꿈 하나는 Sheets 가 붙인 것
  if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop()
  return rows
}

function readQuoted(text: string, start: number): { value: string; end: number } | null {
  let v = ''
  let i = start + 1
  while (i < text.length) {
    if (text[i] === '"') {
      if (text[i + 1] === '"') { v += '"'; i += 2; continue }
      return { value: v, end: i + 1 }
    }
    v += text[i++]
  }
  return null
}

/** 표 → 클립보드. 줄바꿈·탭이 든 칸만 Sheets 처럼 따옴표로 감싼다 (CSV 의 여러 줄 칸) */
export function formatClipboardTsv(block: readonly (readonly string[])[]): string {
  return block.map((r) => r.map((v) => (/[\t\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join('\t')).join('\n')
}
