import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StateField, type EditorState, type Extension, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { Mermaid, TsvView } from './PreviewPane'

/**
 * 하이브리드 Live Preview (DESIGN D2 v2, §11 Phase 3). Obsidian 식 — 커서가 있는 줄은 원문, 나머지는 렌더.
 *
 * - 문법 표식(`#`, `**`, `` ` ``, `~~`, 링크의 `[]()`, `>`)은 커서 밖 줄에서 숨긴다. 글자 자체는 그대로다 (텍스트 = 모델).
 * - ```mermaid · ```tsv-view 펜스는 커서가 밖에 있으면 블록 위젯(미리보기와 같은 React 컴포넌트)으로 바꾼다.
 *   위젯의 "원문" 버튼이 커서를 펜스로 옮겨 다시 원문이 보이게 한다.
 * - 한글 조합 중(input.type.compose)에는 장식을 다시 계산하지 않고 위치만 옮긴다 — 조합이 깨지지 않게.
 * - 블록 위젯은 StateField 로 제공해야 한다 (ViewPlugin 장식은 세로 레이아웃을 못 바꾼다).
 *
 * `@atomic-editor/editor` 를 쓰지 않은 이유: 의존성 하나와 그 수명에 묶이는 것보다 200줄 자체 구현이 싸고, 스토어 동기화·IME 규칙을 우리 것으로 둔다.
 */

type BlockKind = 'mermaid' | 'tsv-view'

function renderBlock(kind: BlockKind, code: string, mdPath: string): ReactNode {
  return kind === 'mermaid' ? createElement(Mermaid, { code }) : createElement(TsvView, { body: code, mdPath })
}

class BlockWidget extends WidgetType {
  private root: Root | null = null
  constructor(readonly kind: BlockKind, readonly code: string, readonly mdPath: string) {
    super()
  }
  eq(other: BlockWidget) {
    return other.kind === this.kind && other.code === this.code && other.mdPath === this.mdPath
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-hybrid-block'
    const bar = document.createElement('div')
    bar.className = 'cm-hybrid-bar'
    const label = document.createElement('span')
    label.textContent = this.kind
    const btn = document.createElement('button')
    btn.textContent = '원문'
    btn.title = '이 블록의 소스로 커서를 옮긴다'
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(wrap)
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
      view.focus()
    })
    bar.append(label, btn)
    const host = document.createElement('div')
    host.className = 'cm-hybrid-host'
    wrap.append(bar, host)
    this.root = createRoot(host)
    this.root.render(renderBlock(this.kind, this.code, this.mdPath))
    return wrap
  }
  updateDOM() {
    return false
  }
  ignoreEvent() {
    return true
  }
  destroy() {
    const root = this.root
    this.root = null
    if (root) window.setTimeout(() => root.unmount(), 0)
  }
  get estimatedHeight() {
    return 140
  }
}

class BulletWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-hybrid-bullet'
    s.textContent = '•'
    return s
  }
  ignoreEvent() { return false }
}
const bullet = new BulletWidget()
const hide = Decoration.replace({})
const quoteLine = Decoration.line({ class: 'cm-hybrid-quote' })

const MARKS = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'StrikethroughMark'])

function build(state: EditorState, mdPath: string): DecorationSet {
  const doc = state.doc
  const active = new Set<number>()
  for (const r of state.selection.ranges) {
    const a = doc.lineAt(r.from).number
    const b = doc.lineAt(r.to).number
    for (let i = a; i <= b; i++) active.add(i)
  }
  const touchesActive = (from: number, to: number) => {
    const a = doc.lineAt(from).number
    const b = doc.lineAt(Math.max(from, to)).number
    for (let i = a; i <= b; i++) if (active.has(i)) return true
    return false
  }

  const items: { from: number; to: number; deco: Decoration }[] = []
  // 파서는 보이는 범위부터 느긋하게 돌므로 문서 끝의 펜스가 아직 트리에 없을 수 있다 → 끝까지 파싱해 둔다 (기획 문서 크기면 순간이다)
  const tree = ensureSyntaxTree(state, state.doc.length, 300) ?? syntaxTree(state)
  tree.iterate({
    enter: (node) => {
      const name = node.name
      if (name === 'FencedCode') {
        const info = node.node.getChild('CodeInfo')
        const lang = info ? state.sliceDoc(info.from, info.to).trim() : ''
        if ((lang === 'mermaid' || lang === 'tsv-view') && !touchesActive(node.from, node.to)) {
          const textNode = node.node.getChild('CodeText')
          const code = textNode ? state.sliceDoc(textNode.from, textNode.to) : ''
          const from = doc.lineAt(node.from).from
          const to = doc.lineAt(node.to).to
          items.push({ from, to, deco: Decoration.replace({ widget: new BlockWidget(lang, code, mdPath), block: true }) })
        }
        return false // 코드 블록 안의 표식은 건드리지 않는다
      }
      if (name === 'CodeBlock' || name === 'HTMLBlock') return false
      if (touchesActive(node.from, node.to) && (MARKS.has(name) || name === 'Link' || name === 'ListMark' || name === 'QuoteMark')) return
      if (MARKS.has(name)) {
        let to = node.to
        if (name === 'HeaderMark' && state.sliceDoc(to, to + 1) === ' ') to++
        items.push({ from: node.from, to, deco: hide })
        return
      }
      if (name === 'Link') {
        // [글자](주소) → 글자만. 표식과 주소를 숨긴다
        const n = node.node
        for (let ch = n.firstChild; ch; ch = ch.nextSibling) {
          if (ch.name === 'LinkMark' || ch.name === 'URL' || ch.name === 'LinkTitle') items.push({ from: ch.from, to: ch.to, deco: hide })
        }
        return false
      }
      if (name === 'ListMark') {
        const mark = state.sliceDoc(node.from, node.to)
        if (/^[-*+]$/.test(mark)) items.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: bullet }) })
        return
      }
      if (name === 'QuoteMark') {
        let to = node.to
        if (state.sliceDoc(to, to + 1) === ' ') to++
        items.push({ from: node.from, to, deco: hide })
        const line = doc.lineAt(node.from)
        items.push({ from: line.from, to: line.from, deco: quoteLine })
        return
      }
      return
    },
  })

  // RangeSetBuilder 는 정렬된 입력이 필요하다. 같은 위치면 줄 장식(line) 이 먼저
  items.sort((a, b) => a.from - b.from || a.to - b.to || (a.deco.spec.block ? -1 : 0))
  const dedup = items.filter((it, i) => i === 0 || !(it.from === items[i - 1].from && it.to === items[i - 1].to && it.deco === items[i - 1].deco))
  return Decoration.set(dedup.map((it) => it.deco.range(it.from, it.to)), true)
}

function isComposing(tr: Transaction) {
  return tr.isUserEvent('input.type.compose')
}

/** 하이브리드 장식. 문서나 선택이 바뀌면 다시 계산, 한글 조합 중엔 위치만 옮긴다 */
export function hybrid(mdPath: string): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state, mdPath),
    update: (decos, tr) => {
      if (isComposing(tr)) return decos.map(tr.changes)
      if (tr.docChanged || tr.selection) return build(tr.state, mdPath)
      return decos
    },
    provide: (f) => EditorView.decorations.from(f),
  })
  return [field, hybridTheme]
}

const hybridTheme = EditorView.baseTheme({
  '.cm-hybrid-block': { margin: '4px 0', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--panel2)', overflow: 'hidden' },
  '.cm-hybrid-bar': { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1px 8px', fontSize: '11px', color: 'var(--muted)', background: 'var(--panel)', borderBottom: '1px solid var(--border)' },
  '.cm-hybrid-bar button': { fontSize: '11px', padding: '0 6px', lineHeight: '16px' },
  '.cm-hybrid-host': { padding: '2px 10px' },
  '.cm-hybrid-host .tsv-view, .cm-hybrid-host .mermaid-box': { margin: '6px 0' },
  '.cm-hybrid-quote': { borderLeft: '3px solid var(--border)', paddingLeft: '10px', color: 'var(--muted)' },
  '.cm-hybrid-bullet': { display: 'inline-block', width: '1em', color: 'var(--muted)' },
})
