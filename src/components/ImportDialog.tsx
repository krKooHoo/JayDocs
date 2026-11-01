import { useEffect, useRef, useState } from 'react'
import { backend, type MountInfo, type RecentMount } from '../lib/backend'
import { guessPath } from '../lib/localPath'

/**
 * 폴더 가져오기 (Ctrl+Shift+O) — PLAN-folder-import F3.
 * 브라우저의 폴더 선택 창으로 고른다. 읽기 전용이면 처음부터 읽기 권한만 받는다.
 *
 * 키: Enter 가져오기 (폴더를 아직 안 골랐으면 선택 창) · Esc 닫기
 */
export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (m: MountInfo) => void }) {
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [alias, setAlias] = useState('')
  const [path, setPath] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [recent, setRecent] = useState<RecentMount[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pickButton = useRef<HTMLButtonElement>(null)

  const loadRoots = () => backend().roots().then((r) => setRecent(r.recent)).catch(() => { /* 목록이 없어도 가져오기는 된다 */ })

  useEffect(() => { void loadRoots(); pickButton.current?.focus() }, [])

  const browse = async () => {
    setError(null)
    try {
      const picked = await window.showDirectoryPicker({ id: 'jaydocs-import', mode: readOnly ? 'read' : 'readwrite', startIn: 'documents' })
      setHandle(picked)
      const known = backend().rootDetail(null).path
      setPath(known ? guessPath(known, picked.name) : '')
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
    if (!handle) { void browse(); return }
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

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette import" role="dialog" aria-label="폴더 가져오기" onKeyDown={onKeyDown}>
        <div className="palette-title">폴더 가져오기 — 원래 자리에서 열고 고친다 (복사하지 않음)</div>
        <div className="import-row">
          <label className="import-check">
            <input type="checkbox" checked={readOnly} onChange={(e) => { setReadOnly(e.target.checked); setHandle(null) }} /> 읽기 전용
          </label>
          <button ref={pickButton} onClick={() => void browse()} disabled={busy}>폴더 고르기…</button>
          <span className="import-picked" title={handle?.name}>{handle ? `📁 ${handle.name}` : '아직 고르지 않음'}</span>
        </div>
        <div className="import-row">
          <label className="import-field">
            별칭 <span className="import-at">@</span>
            <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder={handle?.name || '폴더 이름'} spellCheck={false} />
          </label>
          <span className="spacer" />
          <button className="is-primary" onClick={submit} disabled={busy || !handle}>가져오기</button>
        </div>
        <label className="info-field">
          상세 경로
          <input className="is-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="(선택) 파일 탐색기로 열 때 씁니다" spellCheck={false} />
        </label>
        <div className="import-hint">
          저장은 바로 디스크에 쓰입니다. 수강생 제출물처럼 보기만 할 폴더는 먼저 <b>읽기 전용</b>을 켜고 고르세요.
          Unity 프로젝트의 Library · Temp 등은 저절로 빠집니다.
        </div>
        {error && <div className="banner is-error">{error}</div>}
        {recent.length > 0 && (
          <div className="import-recent">
            <div className="palette-title">최근 폴더 — 해제한 폴더 (누르면 다시 가져온다)</div>
            {recent.map((r) => (
              <div key={r.alias} className="palette-item" onClick={() => void run(() => backend().restoreRoot(r.alias))} title={r.path ?? r.folder}>
                <span className="palette-label">@{r.alias}{r.readOnly ? ' 🔒' : ''} <span className="palette-hint">{r.path ?? r.folder}</span></span>
                <button className="import-forget" onClick={(e) => { e.stopPropagation(); void forget(r) }} title="목록에서 지우기">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
