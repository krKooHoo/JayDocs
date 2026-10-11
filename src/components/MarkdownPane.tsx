import { useEffect, useRef } from 'react'
import { Annotation, EditorState, Transaction } from '@codemirror/state'
import { EditorView, drawSelection, dropCursor, highlightActiveLine, highlightSpecialChars, keymap, rectangularSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { tags as t } from '@lezer/highlight'
import { store, useStoreVersion } from '../store/documents'

/** 다른 창(또는 디스크)에서 온 변경 표시. 되돌리기 이력에 넣지 않고, 스토어로 되돌려 보내지도 않는다. */
const remote = Annotation.define<boolean>()

const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.6em', fontWeight: '700' },
  { tag: t.heading2, fontSize: '1.35em', fontWeight: '700' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '700' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.monospace, fontFamily: 'var(--mono)', fontSize: '0.92em', background: 'var(--code-bg)', borderRadius: '3px' },
  { tag: t.quote, color: 'var(--muted)' },
  { tag: t.processingInstruction, color: 'var(--muted)' },
  { tag: t.contentSeparator, color: 'var(--muted)' },
  { tag: t.labelName, color: 'var(--accent)' },
])

const proseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '15px', backgroundColor: 'var(--bg)' },
  '.cm-scroller': { fontFamily: 'var(--font)', lineHeight: '1.7', padding: '14px 0 40vh' },
  '.cm-content': { padding: '0 28px', maxWidth: '920px', caretColor: 'var(--fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
})

const plainTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px', backgroundColor: 'var(--bg)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6', padding: '12px 0 40vh' },
  '.cm-content': { padding: '0 16px', caretColor: 'var(--fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
})

function extensionsFor(path: string, save: () => void) {
  const isMarkdown = /\.md$/i.test(path)
  return [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    bracketMatching(),
    indentOnInput(),
    ...(isMarkdown ? [markdown({ base: markdownLanguage }), syntaxHighlighting(mdHighlight), EditorView.lineWrapping, proseTheme] : [plainTheme]),
    keymap.of([
      { key: 'Mod-s', run: () => { save(); return true } },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
  ]
}

export function MarkdownPane({ path, onSplit }: { path: string; onSplit: () => void }) {
  useStoreVersion()
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    store.retain(path)
    return () => store.release(path)
  }, [path])

  const d = store.get(path)
  const ready = d?.status === 'ready'

  useEffect(() => {
    if (!ready || !host.current) return
    const doc = store.get(path)
    if (!doc) return
    const source = Symbol(path)
    const view = new EditorView({
      state: EditorState.create({
        doc: doc.text,
        extensions: [
          ...extensionsFor(path, () => void store.save(path)),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            for (const tr of u.transactions) {
              if (tr.docChanged && !tr.annotation(remote)) store.applyChanges(path, tr.changes, source)
            }
          }),
        ],
      }),
      parent: host.current,
    })
    const unsubscribe = store.onChanges(path, (changes, from) => {
      if (from === source) return
      view.dispatch({ changes, annotations: [remote.of(true), Transaction.addToHistory.of(false)] })
    })
    return () => {
      unsubscribe()
      view.destroy()
    }
  }, [ready, path])

  const dirty = store.isDirty(path)
  const status = d?.saving ? '저장 중…' : d?.conflict ? '충돌' : dirty ? '● 수정됨' : '저장됨'

  return (
    <div className="pane">
      <div className="pane-bar">
        <span className="pane-path" title={path}>{path}</span>
        <span className={'pane-status' + (dirty ? ' is-dirty' : '')}>{status}</span>
        <button onClick={() => void store.save(path)} disabled={!dirty || !!d?.conflict || !!d?.saving} title="Ctrl+S">저장</button>
        <button onClick={onSplit} title="이 문서를 오른쪽 창에도 연다 (Ctrl+\)">오른쪽에 분할</button>
      </div>
      {d?.conflict && (
        <div className="banner">
          디스크의 파일이 바뀌었습니다. 어느 쪽을 쓸까요?
          <button onClick={() => store.takeDisk(path)}>디스크 내용 받기 (내 수정 버림)</button>
          <button onClick={() => void store.overwrite(path)}>내 내용으로 덮어쓰기</button>
        </div>
      )}
      {d?.status === 'error' && <div className="banner is-error">{d.error}</div>}
      {d?.status === 'loading' && <div className="pane-empty">불러오는 중…</div>}
      <div className="editor-host" ref={host} />
    </div>
  )
}
