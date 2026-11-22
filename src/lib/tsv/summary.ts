import { useSyncExternalStore } from 'react'
import type { CellRange } from './edits'
import type { TsvTable } from './model'
import { isNumericType, type TableSchema } from './schema'

/**
 * 선택 요약 (ADOPT A2 · DESIGN §32). 그리드에서 여러 칸을 고르면 상태 줄 오른쪽에 개수 · 합 · 평균 · 최소 · 최대.
 *
 * - 머리글 행(타입 행 · 머리글)은 넣지 않는다.
 * - 개수는 비지 않은 칸 (Sheets 의 COUNTA).
 * - 숫자: 타입 행이 있는 표는 숫자 타입 열(byte · uint · int · float)만, 타입 행이 없는 표(CSV 등)는 숫자로 읽히는 칸 — Sheets 와 같다.
 *   `001` 같은 키를 string 열에 둔 표가 합에 섞이지 않게.
 * - 칸이 `SUMMARY_LIMIT` 보다 많으면 세지 않는다 — 큰 표를 통째로 고를 때 화면이 멈추지 않게.
 */

export const SUMMARY_LIMIT = 200_000

export interface RangeSummary {
  /** 고른 칸 수 (머리글 행 제외) */
  cells: number
  /** 너무 커서 세지 않았다 */
  skipped: boolean
  /** 비지 않은 칸 */
  count: number
  /** 숫자 칸 수 — 0 이면 합 · 평균 · 최소 · 최대가 없다 */
  numbers: number
  sum: number
  min: number
  max: number
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/

export function summarizeRange(table: TsvTable, schema: TableSchema, range: CellRange): RangeSummary {
  const r1 = Math.max(range.r1, schema.headerRows)
  const r2 = Math.min(range.r2, table.rows.length - 1)
  const c1 = Math.max(0, range.c1)
  const c2 = Math.min(range.c2, table.width - 1)
  const rows = Math.max(0, r2 - r1 + 1)
  const cols = Math.max(0, c2 - c1 + 1)
  const out: RangeSummary = { cells: rows * cols, skipped: false, count: 0, numbers: 0, sum: 0, min: Infinity, max: -Infinity }
  if (out.cells > SUMMARY_LIMIT) { out.skipped = true; return out }
  const numericCol: boolean[] = []
  for (let c = c1; c <= c2; c++) numericCol[c] = schema.typed ? isNumericType(schema.columns[c]?.type ?? 'unknown') : true
  for (let r = r1; r <= r2; r++) {
    const cells = table.rows[r].cells
    for (let c = c1; c <= c2; c++) {
      const v = (cells[c] ?? '').trim()
      if (v === '') continue
      out.count++
      if (!numericCol[c] || !NUMBER.test(v)) continue
      const n = Number(v)
      if (!Number.isFinite(n)) continue
      out.numbers++
      out.sum += n
      if (n < out.min) out.min = n
      if (n > out.max) out.max = n
    }
  }
  return out
}

/** 요약 숫자 — 소수 끝의 부동소수 찌꺼기(0.1 + 0.2)를 떼고 천 단위 쉼표 */
export function formatNumber(n: number): string {
  const clean = Number(n.toPrecision(12))
  return clean.toLocaleString('ko-KR', { maximumFractionDigits: 6 })
}

// ---------------------------------------------------------------- 보일 계산 고르기
export type SummaryKey = 'count' | 'sum' | 'avg' | 'min' | 'max'
export const SUMMARY_KEYS: readonly SummaryKey[] = ['count', 'sum', 'avg', 'min', 'max']
export const SUMMARY_LABELS: Record<SummaryKey, string> = { count: '개수', sum: '합', avg: '평균', min: '최소', max: '최대' }
const DEFAULT_KEYS: readonly SummaryKey[] = ['count', 'sum', 'avg']
const PREF_KEY = 'jaydocs.selSummary'

function loadKeys(): readonly SummaryKey[] {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    if (raw) {
      const list = JSON.parse(raw) as unknown
      if (Array.isArray(list)) return SUMMARY_KEYS.filter((k) => list.includes(k))
    }
  } catch { /* 깨진 값은 버린다 */ }
  return DEFAULT_KEYS
}

let shown: readonly SummaryKey[] = loadKeys()
const listeners = new Set<() => void>()

/** 상태 줄에 보일 계산들 (순서는 늘 개수 → 합 → 평균 → 최소 → 최대) */
export function summaryKeys(): readonly SummaryKey[] {
  return shown
}

export function toggleSummaryKey(k: SummaryKey) {
  const on = new Set(shown)
  if (on.has(k)) on.delete(k)
  else on.add(k)
  shown = SUMMARY_KEYS.filter((x) => on.has(x))
  try { localStorage.setItem(PREF_KEY, JSON.stringify(shown)) } catch { /* 저장 못 해도 이번 실행에는 된다 */ }
  for (const l of [...listeners]) l()
}

export function useSummaryKeys(): readonly SummaryKey[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, summaryKeys)
}

/** 요약을 보일 글 조각들 — `["개수 4", "합 14"]`. 고른 칸이 하나면 빈 배열 */
export function summaryParts(s: RangeSummary, keys: readonly SummaryKey[]): string[] {
  if (s.skipped) return [`${s.cells.toLocaleString('ko-KR')}칸 — 요약은 ${SUMMARY_LIMIT.toLocaleString('ko-KR')}칸까지`]
  const parts: string[] = []
  for (const k of keys) {
    if (k === 'count') parts.push(`개수 ${s.count.toLocaleString('ko-KR')}`)
    else if (s.numbers > 0) {
      const v = k === 'sum' ? s.sum : k === 'avg' ? s.sum / s.numbers : k === 'min' ? s.min : s.max
      parts.push(`${SUMMARY_LABELS[k]} ${formatNumber(v)}`)
    }
  }
  return parts
}
