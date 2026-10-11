/**
 * 창 사이 이동. 미리보기의 tsv-view 행을 누르면 그리드 창을 열고 그 행으로 가야 하는데,
 * 미리보기는 레이아웃(Workbench)을 모른다. Workbench 가 여기에 열기 함수를 등록해 둔다.
 * 전역 명령이 특정 문서 창에 시키는 일(보기 모드 순환 등)도 같은 길로 보낸다.
 */
export interface CellPos {
  r: number
  c: number
}

type Opener = (path: string) => void
type SelectListener = (pos: CellPos) => void
export type PaneAction = 'cycleMdMode' | 'focus'
type ActionListener = (action: PaneAction) => void

let opener: Opener | null = null
const pendingSelect = new Map<string, CellPos>()
const selectListeners = new Map<string, Set<SelectListener>>()
const actionListeners = new Map<string, Set<ActionListener>>()

export function setOpener(fn: Opener | null) {
  opener = fn
}

/** 문서를 탭으로 연다. pos 를 주면 (그리드 문서일 때) 그 셀을 활성으로 */
export function openPath(path: string, pos?: CellPos) {
  if (pos) {
    const ls = selectListeners.get(path)
    if (ls && ls.size) for (const l of ls) l(pos)
    else pendingSelect.set(path, pos)
  }
  opener?.(path)
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

export function onPaneAction(path: string, l: ActionListener): () => void {
  let set = actionListeners.get(path)
  if (!set) actionListeners.set(path, (set = new Set()))
  set.add(l)
  return () => { set!.delete(l) }
}
