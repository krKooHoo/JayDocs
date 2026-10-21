import { useEffect, useRef, useState } from 'react'
import { backend, type MountInfo, type RecentMount } from '../lib/backend'

/**
 * 폴더 가져오기 (Ctrl+Shift+O) — PLAN-folder-import F3.
 * 브라우저는 폴더의 절대 경로를 알려 주지 않으므로 경로를 붙여 넣는다(자동 완성은 사이드카가).
 * Windows 면 "찾아보기…" 가 사이드카의 폴더 대화상자를 띄운다.
 *
 * 키: 경로 칸에서 ↓/↑ 후보 고르기 · Tab 후보로 채우기 · Enter 가져오기 · Esc 닫기
 */
export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (m: MountInfo) => void }) {
  const [pathText, setPathText] = useState('')
  const [alias, setAlias] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [dirs, setDirs] = useState<string[]>([])
  const [hl, setHl] = useState(-1)
  const [platform, setPlatform] = useState('')
  const [recent, setRecent] = useState<(RecentMount & { missing?: boolean })[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const loadRoots = () => backend().roots().then((r) => {
    setPlatform(r.platform)
    setRecent([...r.missing.map((m) => ({ ...m, missing: true })), ...r.recent])
  }).catch(() => { /* 목록이 없어도 가져오기는 된다 */ })

  useEffect(() => { void loadRoots(); input.current?.focus() }, [])

  // 경로 자동 완성 (입력이 멈추면)
  useEffect(() => {
    let alive = true
    const t = window.setTimeout(() => {
      backend().listDirs(pathText).then((d) => { if (alive) { setDirs(d); setHl(-1) } }).catch(() => { if (alive) setDirs([]) })
    }, 120)
    return () => { alive = false; window.clearTimeout(t) }
  }, [pathText])

  const folderName = pathText.trim().replace(/^["']+|["']+$/g, '').split(/[\\/]/).filter(Boolean).pop() ?? ''

  const complete = (dir: string) => {
    const sep = dir.includes('\\') ? '\\' : '/'
    setPathText(dir.endsWith(sep) ? dir : dir + sep)
    input.current?.focus()
  }

  const submit = async () => {
    if (!pathText.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const m = await backend().addRoot(pathText, { alias: alias.trim() || undefined, readOnly })
      onImported(m)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const browse = async () => {
    setBusy(true)
    setError(null)
    try {
      const p = await backend().pickFolder(pathText)
      if (p) setPathText(p)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  const useRecent = (r: RecentMount) => {
    setPathText(r.path)
    setAlias(r.alias)
    setReadOnly(r.readOnly)
    input.current?.focus()
  }
  const forget = async (r: RecentMount) => {
    await backend().forgetRoot(r.path).catch(() => {})
    void loadRoots()
  }

  const onPathKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' && dirs.length) { e.preventDefault(); setHl((i) => Math.min(dirs.length - 1, i + 1)); return }
    if (e.key === 'ArrowUp' && dirs.length) { e.preventDefault(); setHl((i) => Math.max(-1, i - 1)); return }
    if (e.key === 'Tab' && !e.shiftKey && dirs.length) { e.preventDefault(); complete(dirs[Math.max(0, hl)]); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (hl >= 0 && dirs[hl]) { complete(dirs[hl]); return }
      void submit()
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit() }
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette import" role="dialog" aria-label="폴더 가져오기" onKeyDown={onKeyDown}>
        <div className="palette-title">폴더 가져오기 — 원래 자리에서 열고 고친다 (복사하지 않음)</div>
        <div className="import-row">
          <input
            ref={input}
            className="palette-input import-path"
            placeholder={platform === 'win32' ? '폴더 경로 (예: D:\\수업자료) — 탐색기 "경로로 복사" 를 붙여 넣어도 된다' : '폴더 경로'}
            value={pathText}
            onChange={(e) => { setPathText(e.target.value); setError(null) }}
            onKeyDown={onPathKey}
            spellCheck={false}
          />
          {platform === 'win32' && <button onClick={() => void browse()} disabled={busy} title="Windows 폴더 고르기 창">찾아보기…</button>}
        </div>
        {dirs.length > 0 && (
          <div className="palette-list import-dirs" role="listbox">
            {dirs.map((d, i) => (
              <div key={d} className={'palette-item' + (i === hl ? ' is-hl' : '')} title={d} onMouseDown={(e) => e.preventDefault()} onClick={() => complete(d)}>
                <span className="palette-label">📁 {d.split(/[\\/]/).filter(Boolean).pop() ?? d}</span>
              </div>
            ))}
          </div>
        )}
        <div className="import-row">
          <label className="import-field">
            별칭 <span className="import-at">@</span>
            <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder={folderName || '폴더 이름'} spellCheck={false} />
          </label>
          <label className="import-check">
            <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> 읽기 전용
          </label>
          <span className="spacer" />
          <button className="is-primary" onClick={() => void submit()} disabled={busy || !pathText.trim()}>가져오기</button>
        </div>
        <div className="import-hint">
          가져온 폴더엔 git 이 없어 저장하면 되돌릴 수 없습니다. 수강생 제출물처럼 보기만 할 폴더는 <b>읽기 전용</b>으로 가져오세요.
          Unity 프로젝트의 Library · Temp 등은 저절로 빠집니다.
        </div>
        {error && <div className="banner is-error">{error}</div>}
        {recent.length > 0 && (
          <div className="import-recent">
            <div className="palette-title">최근 폴더 — 해제했거나 이번에 찾지 못한 폴더 (누르면 위 칸에 채운다)</div>
            {recent.map((r) => (
              <div key={r.path} className="palette-item" onClick={() => useRecent(r)} title={r.path}>
                <span className="palette-label">@{r.alias}{r.readOnly ? ' 🔒' : ''} <span className="palette-hint">{r.path}</span></span>
                {r.missing && <span className="palette-hint">찾을 수 없음</span>}
                <button className="import-forget" onClick={(e) => { e.stopPropagation(); void forget(r) }} title="목록에서 지우기">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
