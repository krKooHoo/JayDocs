import type { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { store } from '../store/documents'

/**
 * 마지막 저장 상태로 되돌리기 (ADOPT A4 · DESIGN §34).
 *
 * 글 문서는 편집기에 **보통 트랜잭션 하나**로 넣는다 — 되돌리기 기록에 한 단계로 남아 `Ctrl+Z` 한 번이면 고친 글로 돌아온다.
 * 바뀐 곳만 바꾼다(앞 · 뒤의 같은 부분을 뺀 가운데) — 커서 · 스크롤이 고친 곳 밖이면 그대로 남는다.
 * 표는 `store.revertTable` 이 한다.
 */

/** 지금 글을 저장한 글로 바꾸는 가장 작은 한 덩어리 변경. 같으면 null */
export function revertChange(current: string, saved: string): { from: number; to: number; insert: string } | null {
  if (current === saved) return null
  const max = Math.min(current.length, saved.length)
  let head = 0
  while (head < max && current.charCodeAt(head) === saved.charCodeAt(head)) head++
  let tail = 0
  while (tail < max - head && current.charCodeAt(current.length - 1 - tail) === saved.charCodeAt(saved.length - 1 - tail)) tail++
  return { from: head, to: current.length - tail, insert: saved.slice(head, saved.length - tail) }
}

/**
 * 글 문서를 그 편집기에서 되돌린다. 편집기의 글이 스토어의 글과 같아야 한다(같은 문서의 창).
 * 되돌렸으면 true — 저장 안 한 수정이 없거나 충돌 중이면 false
 */
export function revertTextInView(view: EditorView, path: string): boolean {
  const d = store.get(path)
  if (!d || d.kind !== 'text' || d.status !== 'ready' || d.conflict || d.saving) return false
  const saved: Text = d.savedText
  if (view.state.doc.eq(saved)) return false
  const change = revertChange(view.state.doc.toString(), saved.toString())
  if (!change) return false
  view.dispatch({ changes: change, userEvent: 'revert', scrollIntoView: true })
  return true
}
