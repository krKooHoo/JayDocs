import { useSyncExternalStore } from 'react'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, highlightTrailingWhitespace, highlightWhitespace, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/**
 * 보이지 않는 문자 보이기 (ADOPT C4 · DESIGN §55) — 몰래 들어간 탭 · 앞뒤 공백 · 줄 끝을 기호로. 기본은 꺼짐, 앱 전체에 하나,
 * 이 브라우저에 남긴다. 화면에만 그린다 — 파일은 그대로 (원칙 7).
 *
 * - 편집기: 공백 `·` · 탭 `→`(CodeMirror `highlightWhitespace`), 줄 끝 공백은 칠하고, 줄 끝마다 `↵`.
 * - 그리드: 셀 앞뒤 공백 `·`, 칸 안 탭 `→` (칸 안 줄바꿈 `↵` 는 늘 보인다).
 */
const KEY = 'jaydocs.invisibles'
let on: boolean | null = null
const listeners = new Set<() => void>()

export function invisiblesOn(): boolean {
  if (on === null) { try { on = localStorage.getItem(KEY) === '1' } catch { on = false } }
  return on
}

export function toggleInvisibles(): boolean {
  on = !invisiblesOn()
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* 저장 못 해도 이 창에서는 된다 */ }
  for (const l of listeners) l()
  return on
}

export function onInvisibles(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useInvisibles(): boolean {
  return useSyncExternalStore(onInvisibles, invisiblesOn)
}

// ---- 편집기
class EolWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-eol'
    s.textContent = '↵'
    s.setAttribute('aria-hidden', 'true')
    return s
  }
  ignoreEvent() { return true }
}
const EOL = Decoration.widget({ widget: new EolWidget(), side: 1 })

function eolMarks(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos)
      if (line.number < doc.lines) b.add(line.to, line.to, EOL) // 마지막 줄 뒤에는 줄바꿈이 없다
      pos = line.to + 1
    }
  }
  return b.finish()
}

const eolPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = eolMarks(view) }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = eolMarks(u.view) }
}, { decorations: (v) => v.decorations })

const invisibleTheme = EditorView.baseTheme({
  '.cm-eol': { color: 'var(--muted)', opacity: '0.6', paddingLeft: '1px', pointerEvents: 'none' },
  '.cm-highlightSpace': { backgroundImage: 'radial-gradient(circle at 50% 55%, var(--muted) 15%, transparent 20%)', opacity: '0.7' },
  '.cm-highlightTab': { opacity: '0.7' },
  '.cm-trailingSpace': { backgroundColor: 'var(--warn-bg, rgba(255, 170, 0, 0.25))' },
})

/** 켜져 있을 때 편집기에 넣는 것 */
export function invisiblesExtension(): Extension {
  return [highlightWhitespace(), highlightTrailingWhitespace(), eolPlugin, invisibleTheme]
}

// ---- 그리드
/** 셀 글 → [앞 공백 수, 가운데, 뒤 공백 수]. 가운데의 탭은 → 로 */
export function splitCellSpaces(v: string): [number, string, number] {
  const lead = /^ */.exec(v)![0].length
  if (lead === v.length) return [lead, '', 0]
  const trail = / *$/.exec(v)![0].length
  return [lead, v.slice(lead, v.length - trail).replace(/\t/g, '→'), trail]
}
