import { useSyncExternalStore } from 'react'
import type { EditorView } from '@codemirror/view'
import { LINE_ATTR } from './sourceLines'
import { lineAtY, yAtLine, type LineMap } from '../skim/lineMap'
import { editorRange, editorScrollToLine, measurePreview } from '../skim/scrollPos'

/**
 * 분할 보기 스크롤 맞추기 (ADOPT C5 · DESIGN §56) — 마크다운 분할 모드에서 소스를 스크롤하면 미리보기가, 미리보기를 스크롤하면
 * 소스가 같은 곳으로 따라온다. 기준은 각 칸 맨 위에 보이는 줄. 기본 켜짐, 앱 전체에 하나, 이 브라우저에 남긴다.
 *
 * - 줄 ↔ 위치는 훑어보기 패널과 같은 지도(`lib/skim/lineMap.ts`, 미리보기의 `data-line`).
 * - 미리보기 지도는 내용 · 크기가 바뀔 때만 다시 잰다(Mermaid · 그림이 늦게 그려져도). 스크롤에는 한 프레임에 한 번만 맞춘다.
 * - 사람이 만지는 쪽(휠 · 누르기 · 키)을 따라간다. 반대쪽에 맞춰 준 스크롤이 다시 이쪽을 움직이지 않게 막는다(`scrollTurn` · `createEchoGuard`).
 * - 한 문서 창 안의 두 칸만 — 다른 창의 스크롤은 건드리지 않는다.
 */
const KEY = 'jaydocs.splitScrollSync'
let on: boolean | null = null
const listeners = new Set<() => void>()

export function scrollSyncOn(): boolean {
  if (on === null) { try { on = localStorage.getItem(KEY) !== '0' } catch { on = true } }
  return on
}

export function toggleScrollSync(): boolean {
  on = !scrollSyncOn()
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* 저장 못 해도 이 창에서는 된다 */ }
  for (const l of listeners) l()
  return on
}

export function onScrollSync(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useScrollSync(): boolean {
  return useSyncExternalStore(onScrollSync, scrollSyncOn)
}

export type SyncSide = 'editor' | 'preview'

/** 맞춰 준 스크롤을 쓴 뒤 이만큼(ms)은 그쪽의 스크롤을 사람이 한 것으로 보지 않는다 — 편집기가 줄 높이를 재며 스크롤을 고치는 것까지 */
export const ECHO_MS = 100

/**
 * 되울림 막기: 한쪽에 스크롤을 써 넣으면(`wrote`) 그 뒤 잠깐 그쪽의 스크롤 이벤트는 되울림이다(`echo`).
 * 값으로 가리지 않고 시간으로 가린다 — 편집기는 써 넣은 뒤 보이게 된 줄의 높이를 재며 스크롤을 몇 px 고친다.
 */
export function createEchoGuard(ms = ECHO_MS, now: () => number = () => performance.now()) {
  const until: Record<SyncSide, number> = { editor: -Infinity, preview: -Infinity }
  return {
    wrote(side: SyncSide) { until[side] = now() + ms },
    echo(side: SyncSide) { return now() < until[side] },
  }
}

/**
 * 한쪽이 스크롤됐을 때 — 맞출 기준이 될 쪽을 돌려준다(null 이면 무시).
 * `lead` 는 사람이 마지막으로 만진 쪽(휠 · 누르기 · 키). 그쪽의 스크롤은 늘 따른다 — 맞춰 준 직후라도 사람이 바로 굴리면 따라간다.
 * 반대쪽의 스크롤은 방금 맞춰 준 것이면(`echo`) 무시하고, 아니면(목차 · 찾기로 뛰었다) 그쪽이 새 기준이다.
 */
export function scrollTurn(side: SyncSide, lead: SyncSide, echo: boolean): SyncSide | null {
  if (side === lead) return side
  return echo ? null : side
}

/**
 * 편집기와 미리보기(`.preview`, `data-line` 을 찍고 있어야 한다)의 스크롤을 잇는다. 돌려준 함수로 끊는다.
 * 붙이자마자 미리보기를 편집기에 맞춘다.
 */
export function attachScrollSync(view: EditorView, preview: HTMLElement): () => void {
  let map: LineMap | null = null
  const measure = () => (map ??= measurePreview(preview, view.state.doc.lines))
  const guard = createEchoGuard()
  /** 사람이 마지막으로 만진 쪽 — 내용 · 크기가 바뀌면 이쪽에 맞춘다(글을 치는 중이면 편집기) */
  let lead: SyncSide = 'editor'
  let pending: SyncSide | null = null
  let raf = 0

  const run = () => {
    raf = 0
    const from = pending
    pending = null
    if (!from || !view.dom.isConnected || preview.clientHeight <= 0) return
    if (from === 'editor') {
      const r = editorRange(view)
      if (!r) return
      const before = preview.scrollTop
      preview.scrollTop = yAtLine(measure(), r.first)
      if (preview.scrollTop !== before) guard.wrote('preview')
    } else {
      if (view.scrollDOM.clientHeight <= 0) return
      const before = view.scrollDOM.scrollTop
      editorScrollToLine(view, lineAtY(measure(), preview.scrollTop))
      if (view.scrollDOM.scrollTop !== before) guard.wrote('editor')
    }
  }
  const schedule = (from: SyncSide) => {
    pending = from
    if (!raf) raf = requestAnimationFrame(run)
  }
  const onScroll = (side: SyncSide) => () => {
    const from = scrollTurn(side, lead, guard.echo(side))
    if (!from) return
    lead = from
    schedule(from)
  }
  const onEditor = onScroll('editor')
  const onPreview = onScroll('preview')
  const changed = () => {
    map = null
    schedule(lead)
  }
  // 사람이 만지는 쪽 — 휠 · 누르기(스크롤 막대 포함) · 키(글 치기, PageDown)
  const touch = (side: SyncSide) => () => { lead = side }
  const onEditorTouch = touch('editor')
  const onPreviewTouch = touch('preview')
  const INTENT = ['wheel', 'pointerdown', 'keydown'] as const
  for (const t of INTENT) {
    view.dom.addEventListener(t, onEditorTouch, { capture: true, passive: true })
    preview.addEventListener(t, onPreviewTouch, { capture: true, passive: true })
  }

  view.scrollDOM.addEventListener('scroll', onEditor, { passive: true })
  preview.addEventListener('scroll', onPreview, { passive: true })
  const inner = preview.querySelector('.preview-body')
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(changed) : null
  ro?.observe(preview)
  ro?.observe(view.scrollDOM)
  if (inner) ro?.observe(inner)
  // 높이는 그대로인데 줄 번호만 바뀌는 편집도 있다 (빈 줄을 지운다)
  const mo = new MutationObserver(changed)
  if (inner) mo.observe(inner, { childList: true, subtree: true, attributes: true, attributeFilter: [LINE_ATTR] })
  schedule('editor')

  return () => {
    if (raf) cancelAnimationFrame(raf)
    for (const t of INTENT) {
      view.dom.removeEventListener(t, onEditorTouch, { capture: true })
      preview.removeEventListener(t, onPreviewTouch, { capture: true })
    }
    view.scrollDOM.removeEventListener('scroll', onEditor)
    preview.removeEventListener('scroll', onPreview)
    ro?.disconnect()
    mo.disconnect()
  }
}
