import { codeFolding, foldEffect, foldable, foldedRanges, unfoldEffect } from '@codemirror/language'
import type { EditorState, Extension, StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { outlineOf, type OutlineItem } from './outline'

/**
 * 제목 접기 (ADOPT C1 · DESIGN §52) — 마크다운 제목 아래 절을 접고 편다. 화면 상태만, 파일은 그대로 (원칙 7).
 *
 * - 절의 범위는 `@codemirror/lang-markdown` 의 제목 접기(`foldable` — 제목 줄 끝 ~ 같거나 높은 단계의 다음 제목 앞)를 쓴다.
 *   코드 펜스 안의 `#` 은 제목이 아니다(구문 트리).
 * - `Ctrl+Alt+[` 는 커서가 든 절을 접는다. 이미 접혀 있으면 한 단계 위 절을 접는다 (거듭 누르면 바깥으로).
 *   `Ctrl+Alt+]` 는 커서가 든 절을 편다 — 그 제목이 접혀 있지 않으면 절 안의 접힌 것을 모두 편다.
 * - 접힌 제목은 문서마다 이 브라우저에 남겨 다시 열 때 복원한다 — 제목 단계 · 글 · 같은 제목 중 몇 번째로 찾는다.
 */

/** 마크다운 편집기에 넣는 접기 — 접힌 자리에는 `…` (누르면 편다) */
export function mdFolding(): Extension {
  return codeFolding({ placeholderText: '…' })
}

/** 그 제목 절의 접기 범위 (제목 줄 끝 ~ 절 끝). 절이 비었으면 null */
export function sectionRange(state: EditorState, h: OutlineItem): { from: number; to: number } | null {
  const line = state.doc.lineAt(h.from)
  return foldable(state, line.from, line.to)
}

/** 접힌 범위 중 from 이 그 자리인 것 */
function foldedAt(state: EditorState, from: number): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null
  foldedRanges(state).between(from, from, (a, b) => { if (a === from) { hit = { from: a, to: b }; return false } return undefined })
  return hit
}

/** 커서(pos)가 든 절의 제목 — pos 앞의 마지막 제목. 첫 제목 앞이면 null */
export function headingAt(items: readonly OutlineItem[], pos: number): number {
  let i = -1
  for (let k = 0; k < items.length; k++) { if (items[k].from <= pos) i = k; else break }
  return i
}

/** 그 제목의 바로 위 단계 제목 (없으면 -1) */
export function parentHeading(items: readonly OutlineItem[], i: number): number {
  for (let k = i - 1; k >= 0; k--) if (items[k].level < items[i].level) return k
  return -1
}

export function isSectionFolded(state: EditorState, h: OutlineItem): boolean {
  const r = sectionRange(state, h)
  return !!r && !!foldedAt(state, r.from)
}

/** 접힌 제목들의 줄 번호 — 목차가 ▸ 로 보인다 */
export function foldedHeadingLines(state: EditorState, items: readonly OutlineItem[]): Set<number> {
  const out = new Set<number>()
  for (const h of items) if (isSectionFolded(state, h)) out.add(h.line)
  return out
}

/** 그 제목 절을 접는다 — 커서는 제목 글 끝으로 (접힌 안에 남지 않게) */
export function foldHeading(view: EditorView, h: OutlineItem): boolean {
  const r = sectionRange(view.state, h)
  if (!r || foldedAt(view.state, r.from)) return false
  const head = view.state.selection.main.head
  const moveCursor = head > r.from && head <= r.to
  view.dispatch({ effects: foldEffect.of(r), selection: moveCursor ? { anchor: r.from } : undefined })
  return true
}

/** 그 제목 절을 편다 */
export function unfoldHeading(view: EditorView, h: OutlineItem): boolean {
  const r = sectionRange(view.state, h)
  const f = r && foldedAt(view.state, r.from)
  if (!f) return false
  view.dispatch({ effects: unfoldEffect.of(f) })
  return true
}

/** `Ctrl+Alt+[` — 커서가 든 절을 접는다. 이미 접혀 있으면(커서가 제목 줄에 있다) 한 단계 위 절 */
export function foldSectionAtCursor(view: EditorView): boolean {
  const items = outlineOf(view.state)
  let i = headingAt(items, view.state.selection.main.head)
  while (i >= 0) {
    if (foldHeading(view, items[i])) return true
    i = parentHeading(items, i)
  }
  return i >= 0
}

/** `Ctrl+Alt+]` — 커서가 든 절을 편다. 접혀 있지 않으면 그 절 안의 접힌 것을 모두 */
export function unfoldSectionAtCursor(view: EditorView): boolean {
  const items = outlineOf(view.state)
  const i = headingAt(items, view.state.selection.main.head)
  if (i < 0) return false
  if (unfoldHeading(view, items[i])) return true
  const r = sectionRange(view.state, items[i])
  if (!r) return false
  const effects: StateEffect<unknown>[] = []
  foldedRanges(view.state).between(r.from, r.to, (a, b) => { effects.push(unfoldEffect.of({ from: a, to: b })) })
  if (!effects.length) return false
  view.dispatch({ effects })
  return true
}

/** 모든 제목 절을 접는다 (팔레트) — 펴면 그 아래 제목들이 접힌 채로 보인다, 개요처럼 */
export function foldAllSections(view: EditorView): boolean {
  const effects: StateEffect<unknown>[] = []
  for (const h of outlineOf(view.state)) {
    const r = sectionRange(view.state, h)
    if (r && !foldedAt(view.state, r.from)) effects.push(foldEffect.of(r))
  }
  if (!effects.length) return false
  const head = view.state.selection.main.head
  const items = outlineOf(view.state)
  const at = headingAt(items, head)
  // 커서는 맨 바깥 접힌 절의 제목으로
  let top = at
  while (top >= 0 && parentHeading(items, top) >= 0) top = parentHeading(items, top)
  const anchor = top >= 0 ? view.state.doc.lineAt(items[top].from).to : undefined
  view.dispatch({ effects, selection: anchor !== undefined && head > anchor ? { anchor } : undefined })
  return true
}

/** 모두 펴기 (팔레트) */
export function unfoldAllSections(view: EditorView): boolean {
  const effects: StateEffect<unknown>[] = []
  foldedRanges(view.state).between(0, view.state.doc.length, (a, b) => { effects.push(unfoldEffect.of({ from: a, to: b })) })
  if (!effects.length) return false
  view.dispatch({ effects })
  return true
}

// ---- 문서마다 남기기
/** 제목의 열쇠 — 단계 · 글 · 같은 열쇠 중 몇 번째 */
export function headingKeys(items: readonly OutlineItem[]): string[] {
  const seen = new Map<string, number>()
  return items.map((h) => {
    const base = `${h.level}\u0001${h.text}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return `${base}\u0001${n}`
  })
}

/** 접힌 제목들의 열쇠 */
export function foldedKeys(state: EditorState): string[] {
  const items = outlineOf(state, 0)
  const keys = headingKeys(items)
  return items.flatMap((h, i) => (isSectionFolded(state, h) ? [keys[i]] : []))
}

/** 남겨 둔 열쇠의 제목들을 접는다 (문서를 열 때) */
export function restoreFolds(view: EditorView, keys: readonly string[]): void {
  if (!keys.length) return
  const want = new Set(keys)
  const items = outlineOf(view.state, 200)
  const all = headingKeys(items)
  const effects: StateEffect<unknown>[] = []
  items.forEach((h, i) => {
    if (!want.has(all[i])) return
    const r = sectionRange(view.state, h)
    if (r) effects.push(foldEffect.of(r))
  })
  if (effects.length) view.dispatch({ effects })
}

function key(path: string) {
  return `jaydocs.folds:${path}`
}
export function loadFolds(path: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key(path)) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}
export function saveFolds(path: string, keys: readonly string[]): void {
  try {
    if (keys.length) localStorage.setItem(key(path), JSON.stringify(keys))
    else localStorage.removeItem(key(path))
  } catch { /* 저장 못 해도 이 창에서는 동작한다 */ }
}

/** 트랜잭션에 접기 · 펴기가 들어 있나 */
export function hasFoldEffects(effects: readonly StateEffect<unknown>[]): boolean {
  return effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect))
}
