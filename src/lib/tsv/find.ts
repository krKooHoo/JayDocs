import type { TsvTable } from './model'
import { setCells, type CellEdit } from './edits'

/**
 * 그리드 찾기 / 바꾸기 — 순수 함수. 모든 행(타입 행·헤더 행 포함)을 위→아래, 왼→오 순서로 본다.
 * 찾을 말은 글자 그대로다 (정규식 아님). 찾을 말이 비면 아무것도 찾지 않는다.
 */
export interface FindOptions {
  /** 대소문자 구분 */
  matchCase: boolean
  /** 셀 전체 일치 — 셀 값 전체가 찾을 말과 같아야 걸린다 */
  wholeCell: boolean
}

export interface FindHit {
  r: number
  c: number
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 찾을 말 → 정규식(g). 빈 말이면 null */
function pattern(query: string, opts: FindOptions): RegExp | null {
  if (query === '') return null
  const body = escapeRegExp(query)
  return new RegExp(opts.wholeCell ? `^${body}$` : body, opts.matchCase ? 'g' : 'gi')
}

function test(re: RegExp, v: string): boolean {
  re.lastIndex = 0
  return re.test(v)
}

/** 셀 값 하나가 걸리나 */
export function cellMatches(v: string, query: string, opts: FindOptions): boolean {
  const re = pattern(query, opts)
  return re !== null && v !== '' && test(re, v)
}

/** 걸린 셀 전부 (위→아래, 왼→오) */
export function findMatches(t: TsvTable, query: string, opts: FindOptions): FindHit[] {
  const re = pattern(query, opts)
  const out: FindHit[] = []
  if (!re) return out
  for (let r = 0; r < t.rows.length; r++) {
    const cells = t.rows[r].cells
    for (let c = 0; c < t.width; c++) {
      const v = cells[c]
      if (v && test(re, v)) out.push({ r, c })
    }
  }
  return out
}

/** 셀 안의 걸린 부분을 전부 바꾼다 (셀 전체 일치면 셀 전체). 안 걸리면 그대로 */
export function replaceInCell(v: string, query: string, replacement: string, opts: FindOptions): string {
  const re = pattern(query, opts)
  if (!re || v === '') return v
  // 함수로 넘겨 `$&` 같은 치환 패턴을 글자 그대로 쓴다
  return v.replace(re, () => replacement)
}

/** 모두 바꾸기 — setCells 한 번 (되돌리기 한 단계). count 는 값이 실제로 바뀐 셀 수 */
export function replaceAll(t: TsvTable, query: string, replacement: string, opts: FindOptions): { table: TsvTable; count: number } {
  const re = pattern(query, opts)
  if (!re) return { table: t, count: 0 }
  const edits: CellEdit[] = []
  for (let r = 0; r < t.rows.length; r++) {
    const cells = t.rows[r].cells
    for (let c = 0; c < t.width; c++) {
      const v = cells[c]
      if (!v || !test(re, v)) continue
      const next = v.replace(re, () => replacement)
      if (next !== v) edits.push({ r, c, v: next })
    }
  }
  return { table: setCells(t, edits), count: edits.length }
}

/** pos 가 몇 번째 결과인지. 결과가 아니면 -1 */
export function matchIndex(hits: readonly FindHit[], pos: FindHit): number {
  return hits.findIndex((h) => h.r === pos.r && h.c === pos.c)
}

/** from 다음(dir 1) / 이전(dir -1) 결과의 번호. 끝에 닿으면 반대쪽 처음으로 돈다. 결과가 없으면 -1 */
export function stepMatch(hits: readonly FindHit[], from: FindHit, dir: 1 | -1): number {
  if (hits.length === 0) return -1
  if (dir > 0) {
    const i = hits.findIndex((h) => h.r > from.r || (h.r === from.r && h.c > from.c))
    return i < 0 ? 0 : i
  }
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]
    if (h.r < from.r || (h.r === from.r && h.c < from.c)) return i
  }
  return hits.length - 1
}
