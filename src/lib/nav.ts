/**
 * 창 사이 이동. 미리보기의 tsv-view 행을 누르면 그리드 창을 열고 그 행으로 가야 하는데,
 * 미리보기는 레이아웃(Workbench)을 모른다. Workbench 가 여기에 열기 함수를 등록해 둔다.
 * 전역 명령이 특정 문서 창에 시키는 일(보기 모드 순환 등)도 같은 길로 보낸다.
 */
export interface CellPos {
  r: number
  c: number
}

type Opener = (path: string, focus?: boolean) => void
type SelectListener = (pos: CellPos) => void
export type PaneAction = 'cycleMdMode' | 'focus' | 'calc' | 'formatJson' | 'focusOutline'
type ActionListener = (action: PaneAction) => void

let opener: Opener | null = null
const pendingSelect = new Map<string, CellPos>()
const selectListeners = new Map<string, Set<SelectListener>>()
const actionListeners = new Map<string, Set<ActionListener>>()

export function setOpener(fn: Opener | null) {
  opener = fn
}

/** 문서를 탭으로 연다. pos 를 주면 (그리드 문서일 때) 그 셀을 활성으로. focus: 연 문서 창으로 포커스 */
export function openPath(path: string, pos?: CellPos, focus = false) {
  if (pos) requestCell(path, pos)
  opener?.(path, focus)
}

/** 그 표의 창(들)에 그 셀을 고르게 한다 — 창이 아직 없으면 켜질 때 받는다. 열기는 하지 않는다 (오른쪽 창에 열 때) */
export function requestCell(path: string, pos: CellPos) {
  const ls = selectListeners.get(path)
  if (ls && ls.size) for (const l of ls) l(pos)
  else pendingSelect.set(path, pos)
}

/** 그리드 창이 켜질 때 — 미리 요청된 셀이 있으면 받고, 이후 요청을 구독한다 */
export function onSelectRequest(path: string, l: SelectListener): () => void {
  let set = selectListeners.get(path)
  if (!set) selectListeners.set(path, (set = new Set()))
  set.add(l)
  const pending = pendingSelect.get(path)
  if (pending) { pendingSelect.delete(path); l(pending) }
  return () => { set!.delete(l) }
}

/** 그 경로를 보여 주는 창들에 동작을 시킨다 (같은 문서가 여러 창에 열려 있으면 전부) */
export function paneAction(path: string, action: PaneAction) {
  for (const l of actionListeners.get(path) ?? []) l(action)
}

// ---- 파일 트리의 커서. 이름을 바꾼 뒤처럼 앱이 "이 항목에 커서를" 시킬 때 — 트리의 커서는 트리 안의 state 라 이 길로 보낸다
type TreeCursorListener = (path: string) => void
const treeCursorListeners = new Set<TreeCursorListener>()

/** 트리 커서를 그 경로로 옮긴다 (접힌 상위 폴더는 편다). 트리가 그 경로를 아직 모르면 다음에 트리를 읽을 때 보인다 */
export function setTreeCursor(path: string) {
  for (const l of treeCursorListeners) l(path)
}

export function onTreeCursor(l: TreeCursorListener): () => void {
  treeCursorListeners.add(l)
  return () => { treeCursorListeners.delete(l) }
}

// ---- 훑어보기 창 (PLAN-skim Phase D). 창의 열림은 트리 안의 state 라 팔레트 명령은 이 길로 보낸다
/** item: 트리 커서의 항목 (Phase D) · folder: 트리에서 고른 폴더의 격자, 포커스는 첫 카드 (Phase E) */
export type QuickLookMode = 'item' | 'folder'
const quickLookListeners = new Set<(mode: QuickLookMode) => void>()

/** 훑어보기 창을 연다 — 트리가 포커스를 받으면(이미 있으면 바로) 열린다 */
export function requestQuickLook(mode: QuickLookMode = 'item') {
  for (const l of quickLookListeners) l(mode)
}

export function onQuickLookRequest(l: (mode: QuickLookMode) => void): () => void {
  quickLookListeners.add(l)
  return () => { quickLookListeners.delete(l) }
}

export function onPaneAction(path: string, l: ActionListener): () => void {
  let set = actionListeners.get(path)
  if (!set) actionListeners.set(path, (set = new Set()))
  set.add(l)
  return () => { set!.delete(l) }
}

// ---- 창 하나에만 보내는 명령 (DESIGN §36). paneAction 은 그 경로의 모든 창에 가서, 같은 표를 두 창에 열면 행 넣기가 두 번 된다
export const PANE_COMMAND_EVENT = 'jaydocs-pane-command'

/** 탭(id)의 문서 창(`.pane`)에 명령을 보낸다. 창이 없으면 false */
export function sendToPane(tabId: string, commandId: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(tabId)}"] > .pane`)
  if (!el) return false
  el.dispatchEvent(new CustomEvent(PANE_COMMAND_EVENT, { detail: commandId }))
  return true
}

// ---- 트리 커서의 파일을 오른쪽 창에 (팔레트 명령, DESIGN §38). 커서는 트리 안의 state 라 이 길로 보낸다
const treeSideListeners = new Set<() => void>()

export function requestTreeOpenSide() {
  for (const l of treeSideListeners) l()
}

export function onTreeOpenSide(l: () => void): () => void {
  treeSideListeners.add(l)
  return () => { treeSideListeners.delete(l) }
}

// ---- 글 문서의 그 줄로 (빠른 열기 `이름:12` · `#제목`, 전체 검색 결과 — DESIGN §47). 편집기는 창 안의 state 라 이 길로 보낸다
/** line: 1부터 세는 줄. col · len: 그 줄 안에서 고를 자리 (없으면 줄 앞에 커서) */
export interface LineTarget {
  line: number
  col?: number
  len?: number
}
type LineListener = (t: LineTarget) => void
const pendingLine = new Map<string, LineTarget>()
const lineListeners = new Map<string, Set<LineListener>>()

/** 글 문서(.md · .txt · .json)를 열고 그 줄로. 창이 아직 없으면 창이 켜질 때 받는다. 표는 openPath(path, { r, c }) */
export function openAtLine(path: string, target: LineTarget) {
  requestLine(path, target)
  opener?.(path, true)
}

/** 그 문서의 편집기(들)에 그 줄을 고르게 한다 — 열기는 하지 않는다 (오른쪽 창에 열 때) */
export function requestLine(path: string, target: LineTarget) {
  const ls = lineListeners.get(path)
  if (ls && ls.size) for (const l of ls) l(target)
  else pendingLine.set(path, target)
}

/** 편집기가 켜질 때 — 미리 요청된 줄이 있으면 받고, 이후 요청을 구독한다 */
export function onLineRequest(path: string, l: LineListener): () => void {
  let set = lineListeners.get(path)
  if (!set) lineListeners.set(path, (set = new Set()))
  set.add(l)
  const pending = pendingLine.get(path)
  if (pending) { pendingLine.delete(path); l(pending) }
  return () => { set!.delete(l) }
}
