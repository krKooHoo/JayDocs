import { useEffect, useRef, useState } from 'react'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { baseExtensions, isMarkdownPath, remote } from '../lib/cm'
import { onPaneAction } from '../lib/nav'
import { store, useStoreVersion } from '../store/documents'
import { PreviewPane } from './PreviewPane'
import { hybrid } from './hybrid'

type Mode = 'source' | 'hybrid' | 'preview' | 'split'
const MODES: Mode[] = ['source', 'hybrid', 'split', 'preview']

function modeKey(path: string) {
  return `jaydocs.mdmode:${path}`
}
function loadMode(path: string): Mode {
  if (!isMarkdownPath(path)) return 'source'
  try {
    const m = localStorage.getItem(modeKey(path))
    if (m === 'source' || m === 'hybrid' || m === 'preview' || m === 'split') return m
  } catch { /* 무시 */ }
  return 'source'
}

export function MarkdownPane({ path, onSplit }: { path: string; onSplit: () => void }) {
  useStoreVersion()
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const hybridComp = useRef(new Compartment())
  const [mode, setModeState] = useState<Mode>(() => loadMode(path))
  const setMode = (m: Mode) => {
    setModeState(m)
    try { localStorage.setItem(modeKey(path), m) } catch { /* 무시 */ }
  }

  useEffect(() => {
    store.retain(path)
    return () => store.release(path)
  }, [path])
  useEffect(() => { setModeState(loadMode(path)) }, [path])

  // 전역 명령(보기 모드 순환 · 포커스)
  useEffect(() => onPaneAction(path, (a) => {
    if (a === 'cycleMdMode' && isMarkdownPath(path)) {
      setModeState((m) => {
        const next = MODES[(MODES.indexOf(m) + 1) % MODES.length]
        try { localStorage.setItem(modeKey(path), next) } catch { /* 무시 */ }
        return next
      })
    }
    if (a === 'focus') window.setTimeout(() => viewRef.current?.focus(), 0)
  }), [path])

  const d = store.get(path)
  const ready = d?.status === 'ready' && d.kind === 'text'
  const isMd = isMarkdownPath(path)

  useEffect(() => {
    if (!ready || !host.current) return
    const doc = store.get(path)
    if (!doc || doc.kind !== 'text') return
    const source = Symbol(path)
    const view = new EditorView({
      state: EditorState.create({
        doc: doc.text,
        extensions: [
          ...baseExtensions(path, { save: () => void store.save(path) }),
          hybridComp.current.of(isMd && loadMode(path) === 'hybrid' ? hybrid(path) : []),
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
    viewRef.current = view
    const unsubscribe = store.onChanges(path, (changes, from) => {
      if (from === source) return
      view.dispatch({ changes, annotations: [remote.of(true), Transaction.addToHistory.of(false)] })
    })
    return () => {
      unsubscribe()
      view.destroy()
      viewRef.current = null
    }
  }, [ready, path, isMd])

  // 하이브리드 장식 켜고 끄기
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: hybridComp.current.reconfigure(isMd && mode === 'hybrid' ? hybrid(path) : []) })
  }, [mode, path, isMd])

  const dirty = store.isDirty(path)
  const status = d?.saving ? '저장 중…' : d?.conflict ? '충돌' : dirty ? '● 수정됨' : '저장됨'
  const bakeErrors = d?.kind === 'text' ? d.bakeErrors : []

  return (
    <div className="pane">
      <div className="pane-bar">
        <span className="pane-path" title={path}>{path}</span>
        {isMd && (
          <span className="seg" title="보기 모드 (Ctrl+Shift+V 로 순환)">
            <button className={mode === 'source' ? 'is-on' : ''} onClick={() => setMode('source')} title="소스만">소스</button>
            <button className={mode === 'hybrid' ? 'is-on' : ''} onClick={() => setMode('hybrid')} title="커서 줄은 원문, 나머지는 렌더 (Obsidian 식)">하이브리드</button>
            <button className={mode === 'split' ? 'is-on' : ''} onClick={() => setMode('split')} title="소스 + 미리보기">분할</button>
            <button className={mode === 'preview' ? 'is-on' : ''} onClick={() => setMode('preview')} title="미리보기만">미리보기</button>
          </span>
        )}
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
      {bakeErrors.map((e) => <div key={e} className="banner">{e}</div>)}
      {d?.status === 'loading' && <div className="pane-empty">불러오는 중…</div>}
      <div className={'md-body is-' + mode}>
        <div className="editor-host" ref={host} style={{ display: mode === 'preview' ? 'none' : undefined }} />
        {(mode === 'split' || mode === 'preview') && ready && <PreviewPane path={path} />}
      </div>
    </div>
  )
}
