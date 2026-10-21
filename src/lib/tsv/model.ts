/**
 * TSV 문서 모델. DESIGN §6.1.
 *
 * 행은 불변이다. `raw` 가 null 이 아니면 파일에서 읽은 그대로이고 저장 때 그 바이트를 그대로 쓴다.
 * 셀을 고치면 그 행만 `raw: null` 인 새 행 객체로 바뀐다 — 그래서 건드리지 않은 행은 바이트가 같다.
 * 표(TsvTable) 도 불변이라 되돌리기는 이전 표 객체를 그대로 쌓으면 된다.
 */
export type Eol = '\n' | '\r\n'

export interface TsvRow {
  /** 파일에서 읽은 원문 줄(CSV 는 원문 레코드 — 따옴표 안 줄바꿈 포함). 수정하면 null */
  readonly raw: string | null
  readonly cells: readonly string[]
  /**
   * CSV 만: 파일에서 따옴표로 감싸져 있던 칸. 고친 레코드를 다시 쓸 때 그 칸은 계속 감싼다.
   * 길이가 곧 원래 칸 수다 (고친 레코드는 원래 칸 수를 지킨다). 열을 넣고 빼면 버린다.
   */
  readonly quoted?: readonly boolean[]
}

/** 파일 형식 — 셀 모델은 같고 읽고 쓰는 법만 다르다 */
export type TableFormat = 'tsv' | 'csv'

export interface TsvTable {
  /** 없으면 tsv */
  readonly format?: TableFormat
  /** CSV 만: 따옴표가 맞지 않아 너그럽게 읽은 칸 수 (열 때 경고) */
  readonly malformedCells?: number
  readonly bom: boolean
  readonly eol: Eol
  /** CRLF 와 LF 가 섞여 있었다 — 저장하면 다수 쪽으로 통일된다 */
  readonly mixedEol: boolean
  /** 마지막 줄 뒤에 개행이 있었나 */
  readonly trailingNewline: boolean
  /** 열 수 = 파일 안 최대 탭 수 + 1. 수정한 행은 이 너비로 채운다 */
  readonly width: number
  readonly rows: readonly TsvRow[]
}

export function cellAt(t: TsvTable, r: number, c: number): string {
  return t.rows[r]?.cells[c] ?? ''
}

export function emptyRow(width: number): TsvRow {
  return { raw: null, cells: new Array<string>(width).fill('') }
}
