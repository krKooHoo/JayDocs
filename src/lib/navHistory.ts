/**
 * 뒤로 · 앞으로 (`Alt+,` · `Alt+.`, ADOPT B5 · DESIGN §50) — 문서를 오가고 제목으로 뛸 때 떠난 자리를 적어 두고 되짚어 간다.
 *
 * - **기록하는 때**: 지금 문서가 바뀔 때(파일 열기 · 탭 · 창 전환 — Workbench), 문서 안에서 제목으로 뛸 때(목차 · 경로 막대의
 *   제목 · `Ctrl+P` 의 `#제목` · `이름:12` · 전체 검색 결과). 떠나는 자리(문서 + 커서 줄)를 정확히 적고, 도착한 자리는 대강 적는다 —
 *   거기서 다시 떠날 때(새로 뛰거나 뒤로 갈 때) 그때의 줄로 고쳐 적는다.
 * - 표(그리드)는 줄을 적지 않는다 — 탭이 제 활성 셀을 지닌다 (원칙 3).
 * - 앞으로 갈 것이 있는데 새로 뛰면 앞쪽은 버린다 (브라우저와 같다). 50개까지.
 * - 화면 상태라 저장하지 않는다. 문서 폴더를 바꾸면 비운다.
 */

export interface NavLoc {
  path: string
  /** 글 문서의 커서 줄 (1부터). 표 · 모르면 없음 */
  line?: number
}

export interface NavHistory {
  entries: NavLoc[]
  /** 지금 자리 (entries[index]) */
  index: number
}

export const NAV_MAX = 50
export const EMPTY_HISTORY: NavHistory = { entries: [], index: -1 }

const same = (a: NavLoc, b: NavLoc) => a.path === b.path && (a.line ?? 0) === (b.line ?? 0)

/** from 을 떠나 to 로 — 앞쪽(앞으로 갈 것)은 버린다 */
export function navJump(h: NavHistory, from: NavLoc, to: NavLoc): NavHistory {
  const entries = h.entries.slice(0, h.index + 1)
  if (entries.length) entries[entries.length - 1] = from
  else entries.push(from)
  if (!same(from, to)) entries.push(to)
  const trimmed = entries.slice(-NAV_MAX)
  return { entries: trimmed, index: trimmed.length - 1 }
}

/** 뒤로(-1) · 앞으로(+1). current: 지금 자리(떠나는 자리로 고쳐 적는다). 없어진 문서는 건너뛴다 */
export function navStep(h: NavHistory, dir: -1 | 1, current: NavLoc | null, exists: (path: string) => boolean): { history: NavHistory; target: NavLoc } | null {
  let i = h.index + dir
  while (i >= 0 && i < h.entries.length && !exists(h.entries[i].path)) i += dir
  if (i < 0 || i >= h.entries.length) return null
  const entries = h.entries.slice()
  if (current && h.index >= 0) entries[h.index] = current
  return { history: { entries, index: i }, target: entries[i] }
}

export function navCan(h: NavHistory, dir: -1 | 1): boolean {
  const i = h.index + dir
  return i >= 0 && i < h.entries.length
}

/** 이름 바꾸기 · 옮기기 — 그 경로(폴더면 그 아래도)를 새 경로로 */
export function navRename(h: NavHistory, from: string, to: string): NavHistory {
  const move = (p: string) => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p)
  return { ...h, entries: h.entries.map((e) => ({ ...e, path: move(e.path) })) }
}

// ---- 앱의 기록 하나 (Workbench · 편집기 · 목차 · App 이 같이 쓴다)
let history: NavHistory = EMPTY_HISTORY
/** 뒤로 · 앞으로가 여는 문서 — 그 문서로 바뀌는 것은 새로 뛴 것으로 적지 않는다 */
let expected: { path: string; at: number } | null = null
/** 이름을 바꿔 탭의 경로가 바뀐 것 — 뛴 것이 아니다 */
const renamed = new Map<string, string>()
const listeners = new Set<() => void>()
const notify = () => { for (const l of listeners) l() }

export function navHistory(): NavHistory {
  return history
}
export function resetNavHistory() {
  history = EMPTY_HISTORY
  expected = null
  renamed.clear()
  notify()
}
export function onNavHistory(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

// 글 편집기의 커서 줄 — 편집기(MarkdownPane)가 문서마다 넣는다. 같은 문서가 두 창이면 포커스가 있는 쪽
interface LineSource {
  line: () => number
  focused: () => boolean
}
const sources = new Map<string, Set<LineSource>>()

export function registerLineSource(path: string, src: LineSource): () => void {
  let set = sources.get(path)
  if (!set) sources.set(path, (set = new Set()))
  set.add(src)
  return () => { set!.delete(src); if (!set!.size) sources.delete(path) }
}

export function currentLine(path: string): number | undefined {
  const set = sources.get(path)
  if (!set) return undefined
  const list = [...set]
  return (list.find((s) => s.focused()) ?? list[0]).line()
}

const locOf = (path: string, line = currentLine(path)): NavLoc => (line ? { path, line } : { path })

/** 지금 문서가 바뀌었다 (Workbench) */
export function noteDocChange(prev: string | null, next: string | null) {
  if (!next) return
  if (expected && expected.path === next && Date.now() - expected.at < 3000) { expected = null; return }
  if (prev && renamed.get(prev) === next) { renamed.delete(prev); return }
  history = prev ? navJump(history, locOf(prev), locOf(next)) : navJump(history, locOf(next), locOf(next))
  notify()
}

/** 문서 안에서 그 줄로 뛴다 (목차 · 경로 막대 · `#제목` · 줄 이동). fromLine: 뛰기 전 커서 줄 (모르면 편집기에서 읽는다) */
export function noteLineJump(path: string, toLine: number, fromLine?: number) {
  const from = locOf(path, fromLine ?? currentLine(path))
  if (from.line === toLine) return
  history = navJump(history, from, { path, line: toLine })
  notify()
}

/** 앱에서 이름을 바꿨다 */
export function noteRename(from: string, to: string) {
  history = navRename(history, from, to)
  renamed.set(from, to)
  notify()
}

/**
 * 뒤로 · 앞으로 한 걸음. active: 지금 문서. open: 그 자리를 연다 (문서가 다르면 열고, 줄이 있으면 그 줄로).
 * 갈 곳이 없으면 false
 */
export function navGo(dir: -1 | 1, active: string | null, exists: (path: string) => boolean, open: (loc: NavLoc, sameDoc: boolean) => void): boolean {
  const step = navStep(history, dir, active ? locOf(active) : null, exists)
  if (!step) return false
  history = step.history
  const sameDoc = step.target.path === active
  if (!sameDoc) expected = { path: step.target.path, at: Date.now() }
  notify()
  open(step.target, sameDoc)
  return true
}
