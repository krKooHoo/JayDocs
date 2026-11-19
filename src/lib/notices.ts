/**
 * 알림 줄 — 방금 한 동작의 결과와 실패를 화면 오른쪽 아래에 보인다 (DESIGN §24.6).
 * App · 그리드 · 마크다운 창이 따로 갖고 있던 notice 와 `window.alert` 를 여기 하나로 모았다.
 * 여기는 목록과 시간만 다룬다(순수 로직). 그리는 것은 `components/NoticeHost.tsx` 하나.
 *
 * - info: 몇 초 뒤 사라진다 (동작 버튼이 달리면 조금 더 오래).
 * - error: 사라지지 않는다 — 닫기 버튼, `Ctrl+Alt+X`, 또는 같은 key 의 다음 알림이 지운다.
 * - key: 같은 곳에서 온 알림은 하나만 남는다 (그리드에서 연달아 붙여 넣을 때 쌓이지 않게).
 */

export interface NoticeAction {
  label: string
  /** 버튼 툴팁 (같은 일을 하는 단축키 등) */
  hint?: string
  run: () => void
}

export interface Notice {
  id: number
  kind: 'info' | 'error'
  text: string
  /** 본문 아래 목록 (저장 안 한 문서들 …) */
  items?: string[]
  /** 동작 버튼 하나 ("되돌리기") */
  action?: NoticeAction
  key?: string
}

export interface NoticeOptions {
  kind?: 'info' | 'error'
  items?: string[]
  action?: NoticeAction
  key?: string
}

/** 화면에 남는 시간 (ms) */
export const NOTICE_MS = 5000
export const NOTICE_ACTION_MS = 10000
/** 한 번에 보이는 최대 개수. 넘으면 오래된 것부터 내린다 */
export const NOTICE_MAX = 4

let list: readonly Notice[] = []
let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function drop(ids: Iterable<number>) {
  const gone = new Set(ids)
  if (!gone.size) return false
  for (const id of gone) {
    const t = timers.get(id)
    if (t !== undefined) { clearTimeout(t); timers.delete(id) }
  }
  const next = list.filter((n) => !gone.has(n.id))
  if (next.length === list.length) return false
  list = next
  return true
}

/** 알림을 띄운다. 돌려주는 번호로 닫을 수 있다 */
export function notify(text: string, opts: NoticeOptions = {}): number {
  const n: Notice = { id: nextId++, kind: opts.kind ?? 'info', text, items: opts.items?.length ? opts.items : undefined, action: opts.action, key: opts.key }
  if (n.key !== undefined) drop(list.filter((x) => x.key === n.key).map((x) => x.id))
  list = [...list, n]
  if (list.length > NOTICE_MAX) drop(list.slice(0, list.length - NOTICE_MAX).map((x) => x.id))
  if (n.kind === 'info') {
    timers.set(n.id, setTimeout(() => { timers.delete(n.id); if (drop([n.id])) emit() }, n.action ? NOTICE_ACTION_MS : NOTICE_MS))
  }
  emit()
  return n.id
}

/** 실패 · 막힌 동작 — 닫을 때까지 남는다 */
export function notifyError(text: string, opts: Omit<NoticeOptions, 'kind'> = {}): number {
  return notify(text, { ...opts, kind: 'error' })
}

/** 번호(하나) 또는 key(그 key 의 전부)로 닫는다 */
export function dismissNotice(idOrKey: number | string) {
  const ids = typeof idOrKey === 'number' ? [idOrKey] : list.filter((n) => n.key === idOrKey).map((n) => n.id)
  if (drop(ids)) emit()
}

export function dismissAllNotices() {
  if (drop(list.map((n) => n.id))) emit()
}

/** 동작 버튼을 누른다 — 알림을 닫고 동작을 실행한다 */
export function runNoticeAction(id: number) {
  const n = list.find((x) => x.id === id)
  if (!n?.action) return
  if (drop([id])) emit()
  n.action.run()
}

/** 지금 떠 있는 알림들. 바뀔 때만 새 배열이다 (useSyncExternalStore 의 스냅샷) */
export function noticeList(): readonly Notice[] {
  return list
}

export function subscribeNotices(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
