import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorState, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import { backend } from '../lib/backend'
import { baseExtensions, normalizeForEditor, remote } from '../lib/cm'
import { openPath } from '../lib/nav'
import { diffTables } from '../lib/tsv/diff'
import { parseTsv } from '../lib/tsv/parse'
import { deriveSchema } from '../lib/tsv/schema'
import { store, useStoreVersion, type TsvDoc } from '../store/documents'
import { git, useGitVersion } from '../store/git'

/**
 * HEAD 와 비교 (DESIGN D5 ②). md 는 @codemirror/merge (오른쪽이 현재 문서, 청크 되돌리기 가능),
 * tsv 는 Key 로 행을 맞춘 셀 단위 비교.
 */
type Head = { text: string } | { missing: true }

function useHead(path: string, rev: string) {
  useGitVersion()
  const headVersion = git.headVersion
  const [head, setHead] = useState<Head | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setHead(null)
    setError(null)
    backend().gitShow(path, rev)
      .then((r) => { if (alive) setHead({ text: r.text }) })
      .catch((e) => {
        if (!alive) return
        const msg = (e as Error).message
        if (/없습니다|404/.test(msg)) setHead({ missing: true })
        else setError(msg)
      })
    return () => { alive = false }
  }, [path, rev, headVersion])
  return { head, error }
}

// ---------------------------------------------------------------- 텍스트 diff
function TextDiff({ path, headText }: { path: string; headText: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const doc = store.get(path)
    if (!host.current || !doc || doc.kind !== 'text' || doc.status !== 'ready') return
    const source = Symbol(path)
    const mv = new MergeView({
      a: { doc: normalizeForEditor(headText), extensions: baseExtensions(path, { readOnly: true, compact: true }) },
      b: {
        doc: doc.text,
        extensions: [
          ...baseExtensions(path, { compact: true, save: () => void store.save(path) }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            for (const tr of u.transactions) {
              if (tr.docChanged && !tr.annotation(remote)) store.applyChanges(path, tr.changes, source)
            }
          }),
        ],
      },
      parent: host.current,
      revertControls: 'a-to-b',
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 4 },
    })
    const unsubscribe = store.onChanges(path, (changes, from) => {
      if (from === source) return
      mv.b.dispatch({ changes, annotations: [remote.of(true), Transaction.addToHistory.of(false)] })
    })
    return () => { unsubscribe(); mv.destroy() }
  }, [path, headText])
  return (
    <>
      <div className="diff-legend"><span>HEAD</span><span>현재 (편집 가능 · 화살표로 청크 되돌리기)</span></div>
      <div className="diff-host" ref={host} />
    </>
  )
}

// ---------------------------------------------------------------- 표 diff
function TsvDiff({ path, headText, doc }: { path: string; headText: string; doc: TsvDoc }) {
  const before = useMemo(() => parseTsv(headText), [headText])
  const fields = store.fieldFiles()
  const schema = useMemo(() => deriveSchema(doc.table, path, fields), [doc.table, path, fields])
  const diff = useMemo(() => diffTables(before, doc.table, schema), [before, doc.table, schema])
  const go = (r: number | null, c = 0) => { if (r !== null) openPath(path, { r, c }) }
  return (
    <div className="tsvdiff">
      <div className="tsvdiff-summary">
        <span>{diff.keyed ? 'Key 로 행 맞춤' : '행 번호로 비교'}</span>
        <span className="is-add">+{diff.added}</span>
        <span className="is-del">−{diff.removed}</span>
        <span className="is-chg">~{diff.changed}</span>
        {diff.columnsChanged && <span className="is-err">열 수가 바뀌었습니다 ({before.width} → {doc.table.width}) — 모든 행이 diff 에 나옵니다</span>}
        {diff.rows.length === 0 && <span className="muted">HEAD 와 같습니다</span>}
      </div>
      <div className="tsvdiff-list">
        {diff.rows.map((row, i) => (
          <div key={i} className={'tsvdiff-row is-' + row.kind} onClick={() => go(row.r, row.cells[0]?.c ?? 0)} title={row.r !== null ? `${row.r + 1}행 — 그리드에서 열기` : '삭제된 행'}>
            <span className="tsvdiff-kind">{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : '~'}</span>
            <span className="tsvdiff-key">{row.key}</span>
            <span className="tsvdiff-cells">
              {row.kind === 'removed' && row.removedCells && (
                <span className="tsvdiff-cell">{row.removedCells.filter((v) => v !== '').join(' · ')}</span>
              )}
              {row.kind === 'added' && row.cells.filter((c) => c.after !== '').map((c) => (
                <span key={c.c} className="tsvdiff-cell"><b>{c.name}</b> {c.after}</span>
              ))}
              {row.kind === 'changed' && row.cells.map((c) => (
                <span key={c.c} className="tsvdiff-cell"><b>{c.name}</b> <s>{c.before || '∅'}</s> → {c.after || '∅'}</span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 창
export function DiffPane({ path }: { path: string }) {
  useStoreVersion()
  useEffect(() => {
    store.retain(path)
    return () => store.release(path)
  }, [path])
  const { head, error } = useHead(path, 'HEAD')
  const d = store.get(path)
  const dirty = store.isDirty(path)
  const status = d?.saving ? '저장 중…' : dirty ? '● 수정됨' : '저장됨'

  let body
  if (error) body = <div className="banner is-error">{error}</div>
  else if (!d || d.status === 'loading' || head === null) body = <div className="pane-empty">불러오는 중…</div>
  else if (d.status === 'error') body = <div className="banner is-error">{d.error}</div>
  else if ('missing' in head) body = <div className="pane-empty">HEAD 에 없는 새 파일입니다. 커밋하면 전체가 추가됩니다.</div>
  else if (d.kind === 'tsv') body = <TsvDiff path={path} headText={head.text} doc={d} />
  else body = <TextDiff path={path} headText={head.text} />

  return (
    <div className="pane">
      <div className="pane-bar">
        <span className="pane-path" title={path}>HEAD ↔ {path}</span>
        <span className={'pane-status' + (dirty ? ' is-dirty' : '')}>{status}</span>
        <button onClick={() => void store.save(path)} disabled={!dirty || !!d?.saving} title="Ctrl+S">저장</button>
        <button onClick={() => openPath(path)}>문서 열기</button>
      </div>
      {body}
    </div>
  )
}

// ---------------------------------------------------------------- 이전 버전 보기
export function RevPane({ path, rev, label }: { path: string; rev: string; label: string }) {
  const { head, error } = useHead(path, rev)
  const host = useRef<HTMLDivElement>(null)
  const text = head && 'text' in head ? head.text : null
  useEffect(() => {
    if (!host.current || text === null) return
    const view = new EditorView({
      state: EditorState.create({ doc: normalizeForEditor(text), extensions: baseExtensions(path, { readOnly: true }) }),
      parent: host.current,
    })
    return () => view.destroy()
  }, [path, text])

  const putIntoDoc = async () => {
    if (text === null) return
    if (!window.confirm(`"${path}" 의 현재 내용을 ${label} 시점 내용으로 바꿉니다. 저장은 따로 합니다. 계속할까요?`)) return
    openPath(path)
    const d = await store.whenReady(path)
    if (d?.status === 'ready') store.setText(path, text)
  }

  return (
    <div className="pane">
      <div className="pane-bar">
        <span className="pane-path" title={`${path} @ ${rev}`}>{path} @ {label}</span>
        <span className="pane-status">읽기 전용</span>
        <button onClick={() => void putIntoDoc()} disabled={text === null}>이 내용을 현재 문서에 넣기</button>
        <button onClick={() => openPath(path)}>문서 열기</button>
      </div>
      {error && <div className="banner is-error">{error}</div>}
      {head && 'missing' in head && <div className="pane-empty">그 리비전에 파일이 없습니다</div>}
      {head === null && !error && <div className="pane-empty">불러오는 중…</div>}
      <div className="editor-host" ref={host} />
    </div>
  )
}
