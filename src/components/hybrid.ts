import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StateField, type EditorState, type Extension, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Mermaid, TsvView, imageSrc } from './PreviewPane'

/**
 * 하이브리드 Live Preview (DESIGN D2 v2, §11 Phase 3). Obsidian 식 — 커서가 있는 줄은 원문, 나머지는 렌더.
 *
 * - 문법 표식(`#`, `**`, `` ` ``, `~~`, 링크의 `[]()`, `>`)은 커서 밖 줄에서 숨긴다. 글자 자체는 그대로다 (텍스트 = 모델).
 * - ```mermaid · ```tsv-view 펜스, GFM 표는 커서가 밖에 있으면 블록 위젯(미리보기와 같은 React 컴포넌트)으로 바꾼다.
 *   위젯의 "원문" 버튼이 커서를 그 블록으로 옮겨 다시 원문이 보이게 한다.
 * - 이미지 `![alt](src)` 는 그 줄 아래에 그림을 보여 주고, 할 일 `- [ ]` 는 클릭할 수 있는 체크박스가 된다 (글자 `[ ]`↔`[x]` 를 고친다).
 * - 한글 조합 중(input.type.compose)에는 장식을 다시 계산하지 않고 위치만 옮긴다 — 조합이 깨지지 않게.
 * - 블록 위젯은 StateField 로 제공해야 한다 (ViewPlugin 장식은 세로 레이아웃을 못 바꾼다).
 *
 * `@atomic-editor/editor` 를 쓰지 않은 이유: 의존성 하나와 그 수명에 묶이는 것보다 자체 구현이 싸고, 스토어 동기화·IME 규칙을 우리 것으로 둔다.
 */

type BlockKind = 'mermaid' | 'tsv-view' | 'table'

function renderBlock(kind: BlockKind, code: string, mdPath: string): ReactNode {
  if (kind === 'mermaid') return createElement(Mermaid, { code })
  if (kind === 'tsv-view') return createElement(TsvView, { body: code, mdPath })
  return createElement('div', { className: 'preview-body is-inline' }, createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, code))
}

/** 위젯 안 React 트리. 같은 코드면 DOM 을 재사용한다 (eq) */
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
    wrap.className = 'cm-hybrid-block is-' + this.kind
    const bar = document.createElement('div')
    bar.className = 'cm-hybrid-bar'
    const label = document.createElement('span')
    label.textContent = this.kind === 'table' ? '표' : this.kind
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

/** 이미지 — 원문 줄은 그대로 두고 그 아래에 그림을 넣는다 (block widget, side 1) */
class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly mdPath: string, readonly alt: string) {
    super()
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.mdPath === this.mdPath && other.alt === this.alt
  }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-hybrid-image'
    const img = document.createElement('img')
    img.alt = this.alt
    img.loading = 'lazy'
    const fail = () => { wrap.classList.add('is-error'); wrap.textContent = `이미지를 불러오지 못했습니다: ${this.alt || this.src}` }
    img.onerror = fail
    // blob 주소는 그려진 뒤 필요 없다
    img.onload = () => { if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src) }
    imageSrc(this.src, this.mdPath).then((url) => { img.src = url }).catch(fail)
    wrap.appendChild(img)
    return wrap
  }
  ignoreEvent() {
    return true
  }
  get estimatedHeight() {
    return 120
  }
}

/** `- [ ]` / `- [x]` 를 체크박스로. 클릭하면 글자를 바꾼다 */
class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-hybrid-task'
    box.checked = this.checked
    box.addEventListener('mousedown', (e) => e.preventDefault())
    box.addEventListener('click', (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(box)
      // 위젯이 대신한 글자는 `[ ]` 또는 `[x]` 세 글자다
      const text = view.state.sliceDoc(pos, pos + 3)
      if (!/^\[[ xX]\]$/.test(text)) return
      view.dispatch({ changes: { from: pos, to: pos + 3, insert: this.checked ? '[ ]' : '[x]' } })
    })
    return box
  }
  ignoreEvent(e: Event) {
    return e.type !== 'click' && e.type !== 'mousedown' ? false : true
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
      if (name === 'Table') {
        if (!touchesActive(node.from, node.to)) {
          const from = doc.lineAt(node.from).from
          const to = doc.lineAt(node.to).to
          items.push({ from, to, deco: Decoration.replace({ widget: new BlockWidget('table', state.sliceDoc(from, to), mdPath), block: true }) })
        }
        return false
      }
      if (name === 'CodeBlock' || name === 'HTMLBlock') return false
      if (name === 'Image') {
        // 원문은 두고 줄 끝에 그림을 붙인다 (커서 줄이어도)
        const n = node.node
        const urlNode = n.getChild('URL')
        if (urlNode) {
          const src = state.sliceDoc(urlNode.from, urlNode.to)
          const alt = state.sliceDoc(node.from + 2, Math.max(node.from + 2, (n.getChildren('LinkMark')[1]?.from ?? node.from + 2)))
          const line = doc.lineAt(node.to)
          items.push({ from: line.to, to: line.to, deco: Decoration.widget({ widget: new ImageWidget(src, mdPath, alt), block: true, side: 1 }) })
        }
        return false
      }
      if (touchesActive(node.from, node.to) && (MARKS.has(name) || name === 'Link' || name === 'ListMark' || name === 'QuoteMark' || name === 'TaskMarker')) return
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
      if (name === 'TaskMarker') {
        const text = state.sliceDoc(node.from, node.to)
        items.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: new TaskWidget(/x/i.test(text)) }) })
        return
      }
      if (name === 'ListMark') {
        const mark = state.sliceDoc(node.from, node.to)
        if (/^[-*+]$/.test(mark)) {
          // 할 일 목록(`- [ ]`)이면 점 대신 체크박스만
          const next = state.sliceDoc(node.to, node.to + 4)
          items.push({ from: node.from, to: node.to, deco: /^ \[[ xX]\]/.test(next) ? hide : Decoration.replace({ widget: bullet }) })
        }
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

  return Decoration.set(items.map((it) => it.deco.range(it.from, it.to)), true)
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
  '.cm-hybrid-host .preview-body.is-inline': { padding: '4px 0', maxWidth: 'none', fontSize: 'inherit', lineHeight: 'inherit' },
  '.cm-hybrid-host .preview-body.is-inline table': { margin: '4px 0' },
  '.cm-hybrid-image': { padding: '4px 0 6px' },
  '.cm-hybrid-image img': { maxWidth: '100%', maxHeight: '60vh', borderRadius: '4px' },
  '.cm-hybrid-image.is-error': { color: 'var(--danger)', fontSize: '12px' },
  '.cm-hybrid-task': { margin: '0 6px 0 0', verticalAlign: 'middle' },
  '.cm-hybrid-quote': { borderLeft: '3px solid var(--border)', paddingLeft: '10px', color: 'var(--muted)' },
  '.cm-hybrid-bullet': { display: 'inline-block', width: '1em', color: 'var(--muted)' },
})
