import { useEffect, useRef, useState } from 'react'
import { backend, type MountInfo, type RecentMount } from '../lib/backend'
import { DOC_EXTS } from '../lib/filetypes.mjs'
import { guessPath } from '../lib/localPath'

type Picked = FileSystemDirectoryHandle | FileSystemFileHandle

/**
 * 가져오기 — 폴더(PLAN-folder-import F3) 또는 파일 하나(DESIGN §28)를 원래 자리에서 `@별칭` 으로 연다.
 * 키는 `Ctrl+Shift+O` 하나 — 창 안의 "폴더 고르기…" · "파일 고르기…" 중 고른다 (DESIGN §44, K4). 팔레트 "파일 가져오기…" 는 파일 고르기에 포커스를 두고 연다.
 * 브라우저의 선택 창으로 고르거나, 파일 탐색기에서 파일 트리에 끌어다 놓는다(`initial`).
 * 권한은 가져올 때 묻는다(읽기 전용이면 읽기만) — 그래서 읽기 전용을 바꿔도 고른 것이 남는다.
 *
 * 키: Enter 가져오기 (아직 안 골랐으면 선택 창) · Esc 닫기
 */
export function ImportDialog({ initial, pick = 'folder', onClose, onImported }: {
  /** 끌어다 놓은 폴더 · 파일 */
  initial?: Picked
  /** 처음 포커스를 둘 고르기 버튼 */
  pick?: 'folder' | 'file'
  onClose: () => void
  onImported: (m: MountInfo) => void
}) {
  const [handle, setHandle] = useState<Picked | null>(null)
  const [alias, setAlias] = useState('')
  const [path, setPath] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [recent, setRecent] = useState<RecentMount[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const folderButton = useRef<HTMLButtonElement>(null)
  const fileButton = useRef<HTMLButtonElement>(null)
  const importButton = useRef<HTMLButtonElement>(null)

  const loadRoots = () => backend().roots().then((r) => setRecent(r.recent)).catch(() => { /* 목록이 없어도 가져오기는 된다 */ })

  useEffect(() => {
    void loadRoots()
    if (!initial) (pick === 'file' ? fileButton : folderButton).current?.focus()
  }, [])

  const choose = (picked: Picked) => {
    setError(null)
    setHandle(picked)
    const known = backend().rootDetail(null).path
    setPath(known ? guessPath(known, picked.name) : '')
  }

  // 끌어다 놓은 것 — 창이 떠 있는 동안 또 놓으면 그것으로 바꾼다
  useEffect(() => { if (initial) choose(initial) }, [initial])

  // 정해지면 포커스를 "가져오기" 로 — 고르기 버튼에 남아 있으면 Enter 가 선택 창을 또 연다
  useEffect(() => { if (handle) importButton.current?.focus() }, [handle])

  const browse = async (kind: 'folder' | 'file') => {
    setError(null)
    try {
      if (kind === 'folder') {
        choose(await window.showDirectoryPicker({ id: 'jaydocs-import', mode: readOnly ? 'read' : 'readwrite', startIn: 'documents' }))
      } else {
        const [f] = await window.showOpenFilePicker({ id: 'jaydocs-import-file', multiple: false, startIn: 'documents', types: [{ description: '문서', accept: { 'text/plain': [...DOC_EXTS] } }] })
        if (f) choose(f)
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    }
  }

  const run = async (add: () => Promise<MountInfo>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onImported(await add())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submit = () => {
    if (!handle) { void browse(pick); return }
    void run(() => backend().addRoot(handle, { alias: alias.trim() || undefined, readOnly, path }))
  }

  const forget = async (r: RecentMount) => {
    await backend().forgetRoot(r.alias).catch(() => {})
    void loadRoots()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); submit() }
  }

  const isFile = handle?.kind === 'file'
  const stem = handle ? (isFile ? handle.name.replace(/\.[^.]+$/, '') : handle.name) : ''

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette import" role="dialog" aria-label="가져오기" onKeyDown={onKeyDown}>
        <div className="palette-title">가져오기 — 폴더나 파일을 원래 자리에서 열고 고친다 (복사하지 않음)</div>
        <div className="import-row">
          <label className="import-check">
            <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> 읽기 전용
          </label>
          <button ref={folderButton} onClick={() => void browse('folder')} disabled={busy}>폴더 고르기…</button>
          <button ref={fileButton} onClick={() => void browse('file')} disabled={busy}>파일 고르기…</button>
          <span className="import-picked" title={handle?.name}>{handle ? `${isFile ? '📄' : '📁'} ${handle.name}` : '아직 고르지 않음'}</span>
        </div>
        <div className="import-row">
          <label className="import-field">
            별칭 <span className="import-at">@</span>
            <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder={stem || '폴더 · 파일 이름'} spellCheck={false} />
          </label>
          <span className="spacer" />
          <button ref={importButton} className="is-primary" onClick={submit} disabled={busy || !handle}>가져오기</button>
        </div>
        <label className="info-field">
          상세 경로
          <input className="is-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder={isFile ? '(선택) 파일의 전체 경로 — 파일 탐색기로 열 때 씁니다' : '(선택) 파일 탐색기로 열 때 씁니다'} spellCheck={false} />
        </label>
        <div className="import-hint">
          파일 탐색기에서 폴더나 파일을 <b>파일 트리에 끌어다 놓아도</b> 이 창이 열립니다.
          저장은 바로 디스크에 쓰입니다. 수강생 제출물처럼 보기만 할 것은 <b>읽기 전용</b>을 켜고 가져오세요.
          Unity 프로젝트의 Library · Temp 등은 저절로 빠집니다.
          파일 하나만 가져오면 그 파일을 고치는 것만 됩니다 — 옆의 그림 · 표(tsv-view)는 읽지 못하니, 필요하면 폴더째 가져오세요.
        </div>
        {error && <div className="banner is-error">{error}</div>}
        {recent.length > 0 && (
          <div className="import-recent">
            <div className="palette-title">최근 — 해제한 폴더 · 파일 (누르면 다시 가져온다)</div>
            {recent.map((r) => (
              <div key={r.alias} className="palette-item" onClick={() => void run(() => backend().restoreRoot(r.alias))} title={r.path ?? r.folder}>
                <span className="palette-label">{r.file ? '📄 ' : ''}@{r.alias}{r.readOnly ? ' 🔒' : ''} <span className="palette-hint">{r.path ?? r.folder}</span></span>
                <button className="import-forget" onClick={(e) => { e.stopPropagation(); void forget(r) }} title="목록에서 지우기">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
