import { useEffect, useRef, useState } from 'react'
import { backend, type GitLogEntry } from '../lib/backend'
import { openPath } from '../lib/nav'
import { store, useStoreVersion } from '../store/documents'
import { git, useGitVersion } from '../store/git'

/**
 * git 패널 (DESIGN D5). 바뀐 파일 목록 · 선택 커밋 · 파일 기록 · 이전 버전 보기/복원 · HEAD 로 되돌리기.
 * 전부 사이드카의 git CLI 위임이다.
 */
interface Props {
  activePath: string | null
  onOpenDiff: (path: string) => void
  onOpenRev: (path: string, hash: string, shortHash: string) => void
}

export function GitPane({ activePath, onOpenDiff, onOpenRev }: Props) {
  useGitVersion()
  useStoreVersion()
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [logPath, setLogPath] = useState<string | null>(null)
  const [log, setLog] = useState<GitLogEntry[] | null>(null)
  const [logError, setLogError] = useState<string | null>(null)

  const paths = git.changedPaths()
  const selected = paths.filter((p) => !excluded.has(p))
  const headVersion = git.headVersion

  // "현재 문서의 기록" 명령
  const lastLogRequest = useRef(0)
  useEffect(() => {
    const req = git.logRequest
    if (req && req.n !== lastLogRequest.current) { lastLogRequest.current = req.n; setLogPath(req.path) }
  })

  useEffect(() => {
    if (!logPath) { setLog(null); return }
    let alive = true
    setLog(null)
    setLogError(null)
    backend().gitLog(logPath, 100)
      .then((r) => { if (alive) setLog(r.entries) })
      .catch((e) => { if (alive) setLogError((e as Error).message) })
    return () => { alive = false }
  }, [logPath, headVersion])

  const toggle = (p: string) =>
    setExcluded((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n })

  const commit = async () => {
    const msg = message.trim()
    if (!selected.length || !msg || busy) return
    const dirty = selected.filter((p) => store.isDirty(p))
    if (dirty.length && !window.confirm(`저장하지 않은 문서가 있습니다:\n${dirty.join('\n')}\n\n먼저 저장하고 커밋할까요?`)) return
    setBusy(true)
    setResult(null)
    try {
      for (const p of dirty) await store.save(p)
      const still = dirty.filter((p) => store.isDirty(p))
      if (still.length) throw new Error(`저장하지 못한 문서: ${still.join(', ')}`)
      const r = await backend().gitCommit(selected, msg)
      setMessage('')
      setResult({ ok: true, text: `커밋 ${r.shortHash} — ${r.summary}` })
      git.headChanged()
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const restore = async (p: string) => {
    if (!window.confirm(`"${p}" 의 변경을 버리고 HEAD 내용으로 되돌립니다. 계속할까요?`)) return
    try {
      await backend().gitRestore(p)
      await store.reload(p)
      setResult({ ok: true, text: `${p} 되돌림` })
      git.headChanged()
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message })
    }
  }

  const [syncing, setSyncing] = useState<'push' | 'pull' | null>(null)
  const sync = async (kind: 'push' | 'pull') => {
    if (syncing) return
    if (kind === 'pull' && store.anyDirty() && !window.confirm('저장하지 않은 문서가 있습니다. pull 로 파일이 바뀌면 충돌 배너가 뜹니다. 계속할까요?')) return
    setSyncing(kind)
    setResult(null)
    try {
      const r = kind === 'push' ? await backend().gitPush() : await backend().gitPull()
      const last = r.output.trim().split('\n').filter(Boolean).pop() ?? ''
      setResult({ ok: true, text: `${kind} 완료${last ? ' — ' + last : ''}` })
      git.headChanged()
    } catch (e) {
      setResult({ ok: false, text: `${kind} 실패: ${(e as Error).message}` })
    } finally {
      setSyncing(null)
    }
  }

  const restoreVersion = async (entry: GitLogEntry) => {
    if (!logPath) return
    if (!window.confirm(`"${logPath}" 를 ${entry.shortHash} (${entry.date.slice(0, 10)}) 시점 내용으로 바꿉니다. 저장은 따로 합니다. 계속할까요?`)) return
    try {
      const r = await backend().gitShow(logPath, entry.hash)
      openPath(logPath)
      const d = await store.whenReady(logPath)
      if (!d || d.status !== 'ready') throw new Error('문서를 열지 못했습니다')
      store.setText(logPath, r.text)
      setResult({ ok: true, text: `${logPath} ← ${entry.shortHash} (저장 전)` })
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message })
    }
  }

  return (
    <div className="gitpane">
      <div className="gitpane-col gitpane-files">
        <div className="gitpane-head">
          <span>변경 {paths.length}</span>
          {git.branch && <span className="muted">· {git.branch}</span>}
          {git.loading && <span className="muted">· 읽는 중</span>}
          <span className="spacer" />
          {git.repo && git.upstream && (
            <>
              <button onClick={() => void sync('pull')} disabled={!!syncing} title={`${git.upstream} 에서 pull (--ff-only)`}>
                {syncing === 'pull' ? 'pull…' : `pull${git.behind ? ` ↓${git.behind}` : ''}`}
              </button>
              <button onClick={() => void sync('push')} disabled={!!syncing || !git.ahead} title={`${git.upstream} 으로 push`}>
                {syncing === 'push' ? 'push…' : `push${git.ahead ? ` ↑${git.ahead}` : ''}`}
              </button>
            </>
          )}
          {git.repo && !git.upstream && <span className="muted" title="원격 추적 브랜치가 없어 push/pull 버튼이 없다 (터미널에서 git push -u origin <브랜치>)">원격 없음</span>}
          <button onClick={() => void git.refresh()} title="다시 읽기">↻</button>
        </div>
        <div className="gitpane-list">
          {!git.repo && <div className="gitpane-empty">{git.error ?? 'git 리포가 아닙니다'}</div>}
          {git.repo && paths.length === 0 && <div className="gitpane-empty">바뀐 파일이 없습니다</div>}
          {paths.map((p) => {
            const code = git.codeOf(p) ?? '?'
            return (
              <div key={p} className={'gitpane-row' + (p === activePath ? ' is-active' : '')}>
                <input type="checkbox" checked={!excluded.has(p)} onChange={() => toggle(p)} title="커밋에 포함" />
                <span className={'git-badge is-' + code}>{code}</span>
                <span className="gitpane-path" title={`${p} — HEAD 와 비교`} onClick={() => onOpenDiff(p)}>{p}</span>
                {store.isDirty(p) && <span className="dirty-dot">●</span>}
                <button onClick={() => onOpenDiff(p)} title="HEAD 와 비교">diff</button>
                <button onClick={() => setLogPath(p)} title="커밋 기록">기록</button>
                {code !== '?' && code !== 'A' && <button onClick={() => void restore(p)} title="HEAD 내용으로 되돌리기">되돌리기</button>}
              </div>
            )
          })}
        </div>
      </div>
      <div className="gitpane-col gitpane-commit">
        <textarea
          data-focus-target="git"
          placeholder="커밋 메시지 (Ctrl+Enter 로 커밋)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void commit() } }}
          disabled={!git.repo}
        />
        <div className="gitpane-actions">
          <button onClick={() => void commit()} disabled={busy || !git.repo || !selected.length || !message.trim()}>
            {busy ? '커밋 중…' : `커밋 (${selected.length})`}
          </button>
          {result && <span className={result.ok ? 'is-ok' : 'is-err'}>{result.text}</span>}
        </div>
      </div>
      <div className="gitpane-col gitpane-log">
        <div className="gitpane-head">
          <span className="gitpane-logpath" title={logPath ?? ''}>기록{logPath ? `: ${logPath}` : ''}</span>
          <span className="spacer" />
          {activePath && activePath !== logPath && <button onClick={() => setLogPath(activePath)} title={activePath}>현재 문서</button>}
          <button onClick={() => setLogPath('')} title="리포 전체">전체</button>
        </div>
        <div className="gitpane-list">
          {logPath === null && <div className="gitpane-empty">파일의 [기록] 또는 [현재 문서] 를 누르세요</div>}
          {logError && <div className="gitpane-empty is-err">{logError}</div>}
          {logPath !== null && !log && !logError && <div className="gitpane-empty">읽는 중…</div>}
          {log?.length === 0 && <div className="gitpane-empty">커밋이 없습니다</div>}
          {log?.map((e) => (
            <div key={e.hash} className="gitpane-row">
              <span className="mono">{e.shortHash}</span>
              <span className="muted">{e.date.slice(0, 10)}</span>
              <span className="gitpane-subject" title={`${e.author} · ${e.date}`}>{e.subject}</span>
              {logPath && <button onClick={() => onOpenRev(logPath, e.hash, e.shortHash)} title="이 버전 내용 보기 (읽기 전용)">보기</button>}
              {logPath && <button onClick={() => void restoreVersion(e)} title="이 버전 내용을 현재 문서에 넣기">이 버전으로</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
