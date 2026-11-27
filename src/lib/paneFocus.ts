/**
 * 다른 창으로 포커스 — 직전 창 (ADOPT D1 · DESIGN §57). 문서 창(탭 묶음)에 포커스가 들어올 때마다 적어 두고,
 * `Ctrl+Alt+O` 로 직전에 쓰던 문서 창으로 간다. 다시 누르면 돌아온다 — 시트 창 ↔ 문서 창을 한 키로 오간다.
 * 여기는 순수 계산만 — 포커스를 읽고 옮기는 것은 `Workbench`.
 */
export interface PaneFocusTrack {
  /** 마지막으로 포커스가 들어간 문서 창(탭 묶음 id) */
  cur: string | null
  /** 그 앞의 다른 문서 창 */
  prev: string | null
}

export const EMPTY_TRACK: PaneFocusTrack = { cur: null, prev: null }

/** 문서 창에 포커스가 들어왔다. 같은 창 안에서 옮겨 다니면 그대로 */
export function notePaneFocus(t: PaneFocusTrack, tabset: string): PaneFocusTrack {
  if (t.cur === tabset) return t
  return { cur: tabset, prev: t.cur }
}

/**
 * 갈 창. `focused` 는 지금 포커스가 든 문서 창(트리 · 팔레트에 있으면 null), `open` 은 문서가 열린 탭 묶음들(화면 순서).
 * - 문서 창에 있으면 그 앞에 쓰던 창. 그 창이 닫혔으면 다른 창 중 첫째.
 * - 문서 창 밖(트리 등)에 있으면 마지막으로 쓰던 문서 창.
 * 갈 곳이 없으면(창이 하나뿐인데 이미 거기) null.
 */
export function otherPaneTarget(t: PaneFocusTrack, focused: string | null, open: readonly string[]): string | null {
  const ok = (id: string | null): id is string => !!id && id !== focused && open.includes(id)
  const want = focused === null ? t.cur : focused === t.cur ? t.prev : t.cur
  if (ok(want)) return want
  if (focused === null && ok(t.prev)) return t.prev
  return open.find((id) => id !== focused) ?? null
}
