import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StateField, type EditorState, type Extension, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { redo, undo } from '@codemirror/commands'
import type { SyntaxNode } from '@lezer/common'
import ReactMarkdown from 'react-markdown'
import { Mermaid, REMARK_PLUGINS, TsvView, imageSrc } from './PreviewPane'
import { HybridTable } from './HybridTable'
import { appendRowChange, cellChange, parseTable, type TextChange } from '../lib/md/tableEdit'

/**
 * 하이브리드 Live Preview (DESIGN D2 v2, §11 Phase 3). Obsidian 식 — 커서가 있는 줄은 원문, 나머지는 렌더.
 *
 * - 문법 표식(`#`, `**`, `` ` ``, `~~`, 링크의 `[]()`, `>`)은 커서 밖 줄에서 숨긴다. 글자 자체는 그대로다 (텍스트 = 모델).
 * - ```mermaid · ```tsv-view 펜스, GFM 표는 커서가 밖에 있으면 블록 위젯(미리보기와 같은 React 컴포넌트)으로 바꾼다.
 *   위젯의 "원문" 버튼이 커서를 그 블록으로 옮겨 다시 원문이 보이게 한다.
 * - 표 위젯은 칸을 눌러 바로 고친다 (DESIGN §23, `HybridTable`). 문서가 바뀌어도 위젯 DOM 을 다시 만들지 않고
 *   (updateDOM) 같은 React 트리에 새 원문을 넘긴다 — 입력 칸의 포커스·조합이 끊기지 않게.
 * - 그 밖의 ``` 코드 블록은 위젯으로 바꾸지 않는다. 글자는 그대로 두고 줄마다 코드 상자 모양을 입히며,
 *   커서가 밖에 있으면 펜스(```)를 숨기고 언어 이름만 보인다 — 원문을 그 자리에서 바로 고친다.
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
  return createElement('div', { className: 'preview-body is-inline' }, createElement(ReactMarkdown, { remarkPlugins: REMARK_PLUGINS }, code))
}

/** 위젯 DOM 하나에 붙은 React 트리와 지금 원문. 표는 문서가 바뀌어도 이 DOM 을 계속 쓴다 (updateDOM) */
interface Holder {
  root: Root
  kind: BlockKind
  mdPath: string
  code: string
  render: () => void
}
const holders = new WeakMap<HTMLElement, Holder>()

/** 표 위젯이 가리키는 원문 위치. 위젯이 들고 있는 원문과 문서가 어긋났으면 null (그 사이 다른 변경) */
function tableAt(view: EditorView, wrap: HTMLElement, h: Holder) {
  const from = view.posAtDOM(wrap)
  if (view.state.sliceDoc(from, from + h.code.length) !== h.code) return null
  const table = parseTable(h.code)
  return table ? { from, table } : null
}

function applyAt(view: EditorView, from: number, c: TextChange | null) {
  if (!c) return
  view.dispatch({ changes: { from: from + c.from, to: from + c.to, insert: c.insert }, userEvent: 'input.type' })
}

/** 표 칸에서 되돌리기 — 커서(표 밖)로 화면이 튀지 않게 스크롤을 그대로 둔다 */
function undoInPlace(view: EditorView, isRedo: boolean) {
  const snap = view.scrollSnapshot()
  if ((isRedo ? redo : undo)(view)) view.dispatch({ effects: snap })
}

function addRow(view: EditorView, wrap: HTMLElement, h: Holder) {
  const at = tableAt(view, wrap, h)
  if (at) applyAt(view, at.from, appendRowChange(at.table))
}

function tableElement(view: EditorView, wrap: HTMLElement, h: Holder) {
  return createElement(HybridTable, {
    source: h.code,
    readOnly: view.state.readOnly,
    onEdit: (row: number, col: number, text: string) => {
      const at = tableAt(view, wrap, h)
      if (at) applyAt(view, at.from, cellChange(at.table, row, col, text))
    },
    onAddRow: () => addRow(view, wrap, h),
    onUndo: (isRedo: boolean) => undoInPlace(view, isRedo),
    onLeave: () => view.focus(),
  })
}

/** 위젯 안 React 트리. 같은 코드면 DOM 을 재사용한다 (eq). 표는 원문이 바뀌어도 DOM 을 이어 쓴다 (updateDOM) */
class BlockWidget extends WidgetType {
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
    bar.append(label)
    const host = document.createElement('div')
    host.className = 'cm-hybrid-host'
    // 위아래 틈은 wrap 의 padding 으로 둔다 (margin 은 CM 높이 맵이 세지 않아 ↑↓ 가 엉뚱한 줄로 튄다, TC-210).
    // 테두리 · 배경은 안쪽 상자에
    const box = document.createElement('div')
    box.className = 'cm-hybrid-box'
    box.append(bar, host)
    wrap.append(box)
    const h: Holder = {
      root: createRoot(host),
      kind: this.kind,
      mdPath: this.mdPath,
      code: this.code,
      render: () => h.root.render(h.kind === 'table' ? tableElement(view, wrap, h) : renderBlock(h.kind, h.code, h.mdPath)),
    }
    holders.set(wrap, h)
    if (this.kind === 'table' && !view.state.readOnly) {
      const add = document.createElement('button')
      add.textContent = '＋ 행'
      add.title = '표 끝에 빈 행 추가 (마지막 칸에서 Tab 도 같다)'
      add.addEventListener('mousedown', (e) => { e.preventDefault(); addRow(view, wrap, h) })
      bar.append(add)
    }
    bar.append(btn)
    h.render()
    return wrap
  }
  /** 표만: 같은 DOM 에 새 원문을 넘긴다 (입력 중인 칸이 그대로 남는다) */
  updateDOM(dom: HTMLElement) {
    const h = holders.get(dom)
    if (!h || this.kind !== 'table' || h.kind !== 'table' || h.mdPath !== this.mdPath) return false
    h.code = this.code
    h.render()
    return true
  }
  ignoreEvent() {
    return true
  }
  destroy(dom: HTMLElement) {
    const h = holders.get(dom)
    holders.delete(dom)
    if (h) window.setTimeout(() => h.root.unmount(), 0)
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

/** 코드 블록 여는 펜스 자리 — 언어 이름만 작게 */
class CodeLabelWidget extends WidgetType {
  constructor(readonly lang: string) {
    super()
  }
  eq(other: CodeLabelWidget) { return other.lang === this.lang }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-hybrid-code-lang'
    s.textContent = this.lang
    return s
  }
  ignoreEvent() { return false }
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

  /** ``` 코드 블록: 줄마다 코드 상자 모양. 커서가 밖이면 펜스를 숨기고 언어 이름만 */
  const codeBlock = (n: SyntaxNode, lang: string) => {
    const first = doc.lineAt(n.from)
    const marks = n.getChildren('CodeMark')
    const closing = marks.length > 1 ? doc.lineAt(marks[marks.length - 1].from) : null
    const last = closing ?? doc.lineAt(n.to)
    const hideFences = !touchesActive(n.from, n.to)
    for (let i = first.number; i <= last.number; i++) {
      const line = doc.line(i)
      const isFence = i === first.number || (closing !== null && i === closing.number)
      let cls = 'cm-hybrid-code'
      if (i === first.number) cls += ' is-first'
      if (i === last.number) cls += ' is-last'
      if (isFence && hideFences) cls += ' is-fence'
      items.push({ from: line.from, to: line.from, deco: Decoration.line({ class: cls }) })
    }
    if (!hideFences) return
    items.push({ from: first.from, to: first.to, deco: Decoration.replace({ widget: new CodeLabelWidget(lang) }) })
    if (closing && closing.number !== first.number && closing.to > closing.from) items.push({ from: closing.from, to: closing.to, deco: hide })
  }
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
        } else if (lang !== 'mermaid' && lang !== 'tsv-view') {
          codeBlock(node.node, lang)
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
  // 블록 위젯에는 margin 을 주지 않는다 — CM 은 위젯 높이를 테두리 상자로 재므로 margin 만큼 줄 위치가 어긋난다
  '.cm-hybrid-block': { padding: '4px 0' },
  '.cm-hybrid-box': { border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--panel2)', overflow: 'hidden' },
  '.cm-hybrid-bar': { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1px 8px', fontSize: '11px', color: 'var(--muted)', background: 'var(--panel)', borderBottom: '1px solid var(--border)' },
  '.cm-hybrid-bar span': { flex: 1 },
  '.cm-hybrid-bar button': { fontSize: '11px', padding: '0 6px', lineHeight: '16px', marginLeft: '4px' },
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
  // 표 칸 편집
  '.cm-hybrid-table td.is-editable, .cm-hybrid-table th.is-editable': { cursor: 'text' },
  '.cm-hybrid-table td.is-editable:hover, .cm-hybrid-table th.is-editable:hover': { background: 'var(--hover)' },
  '.cm-hybrid-table .is-editing': { padding: '0', outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '.cm-hybrid-cell-input': {
    font: 'inherit', fontWeight: 'inherit', color: 'var(--fg)', background: 'var(--bg)', border: 'none', outline: 'none',
    padding: '4px 9px', width: '100%', minWidth: '6ch', boxSizing: 'border-box', fieldSizing: 'content', textAlign: 'inherit',
  },
  '.cm-hybrid-cell-empty': { display: 'inline-block', minWidth: '2ch' },
  // ``` 코드 블록 — 미리보기의 pre 와 같은 모양
  '.cm-line.cm-hybrid-code': { background: 'var(--code-bg)', fontFamily: 'var(--mono)', fontSize: '13px', lineHeight: '1.5', padding: '0 12px' },
  '.cm-line.cm-hybrid-code span:not([class*="cm-"])': { background: 'transparent', fontSize: 'inherit' },
  '.cm-line.cm-hybrid-code.is-first': { borderTopLeftRadius: '6px', borderTopRightRadius: '6px', paddingTop: '6px' },
  '.cm-line.cm-hybrid-code.is-last': { borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px', paddingBottom: '6px' },
  '.cm-line.cm-hybrid-code.is-fence': { fontSize: '11px', lineHeight: '1.2' },
  '.cm-hybrid-code-lang': { color: 'var(--muted)', fontFamily: 'var(--font)', fontSize: '11px' },
})
