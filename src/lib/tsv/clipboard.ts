/**
 * 클립보드 TSV. Google Sheets · Excel 은 `text/plain` 에 탭 구분 · 줄바꿈(CRLF 또는 LF) 으로 넣고
 * 마지막에 줄바꿈을 하나 더 붙인다. 따옴표는 해석하지 않는다 (파일 규칙과 같다).
 */
export function parseClipboardTsv(text: string): string[][] {
  if (text === '') return [['']]
  const lines = text.split(/\r\n|\r|\n/)
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines.map((l) => l.split('\t'))
}

export function formatClipboardTsv(block: readonly (readonly string[])[]): string {
  return block.map((r) => r.join('\t')).join('\n')
}
