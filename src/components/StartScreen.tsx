import { useCallback, useEffect, useState } from 'react'
import { APP_VERSION, usePwa } from '../lib/pwa'
import { guessPath } from '../lib/localPath'
import { forgetWorkspace, listWorkspaces, queryRoot, requestRoot, setWorkspaceInfo, workspaceFor, workspaceLabel, type StoredRoot, type Workspace } from '../lib/fsa/workspace'
import { FolderInfoDialog } from './FolderInfoDialog'
import { UpdateButton } from './UpdateButton'

/** 앱 설치 안내 · 버전과 업데이트 */
function AppFooter() {
  const app = usePwa()
  const [message, setMessage] = useState<string | null>(null)
  return (
    <>
      {app.canInstall && (
        <p className="start-hint">
          앱으로 설치하면 시작 메뉴에서 바로 열 수 있고 폴더 권한도 유지됩니다.{' '}
          <button onClick={() => void app.install()}>앱으로 설치</button>
        </p>
      )}
      {app.canCheck && (
        <p className="start-hint start-update">
          <span>버전 {APP_VERSION}</span>
          <UpdateButton notify={setMessage} />
          {message && <span>{message}</span>}
        </p>
      )}
    </>
  )
}

/** `별칭 | 상세 경로` 한 줄 */
function FolderLabel({ alias, path }: { alias: string; path?: string | null }) {
  return (
    <>
      <span className="recent-alias">{alias}</span>
      <span className="recent-sep">|</span>
      <span className={'recent-path' + (path ? '' : ' is-empty')}>{path || '상세 경로 없음'}</span>
    </>
  )
}

/** 연 적 있는 폴더 (최대 RECENT_WORKSPACES 개, 최근 순). exclude 는 목록에서 뺀다 */
function RecentFolders({ title, exclude, onOpen, onError }: { title: string; exclude?: string; onOpen: (w: Workspace) => void; onError: (msg: string) => void }) {
  const [list, setList] = useState<Workspace[]>([])
  const [editing, setEditing] = useState<Workspace | null>(null)

  const load = useCallback(() => {
    void listWorkspaces().then((all) => setList(all.filter((w) => w.id !== exclude))).catch((e) => onError((e as Error).message))
  }, [exclude, onError])
  useEffect(load, [load])

  const forget = async (w: Workspace) => {
    await forgetWorkspace(w.id)
    load()
  }

  if (list.length === 0) return null
  const known = list.find((w) => w.path)?.path
  return (
    <div className="start-list">
      <div className="start-list-title">{title}</div>
      {list.map((w) => (
        <div key={w.id} className="start-row">
          <button className="start-open" onClick={() => onOpen(w)} title={[workspaceLabel(w), w.path, w.mounts.length ? `가져온 폴더 ${w.mounts.length}개` : ''].filter(Boolean).join('\n')}>
            <FolderLabel alias={workspaceLabel(w)} path={w.path} />
          </button>
          <button onClick={() => setEditing(w)} title="별칭 · 상세 경로 편집">✎</button>
          <button onClick={() => void forget(w)} title="목록에서 지우기 (폴더와 파일은 그대로)">×</button>
        </div>
      ))}
      {editing && (
        <FolderInfoDialog
          title="폴더 정보"
          folder={editing.primary.name}
          label={editing.label ?? ''}
          path={editing.path ?? ''}
          guess={known ? guessPath(known, editing.primary.name) : ''}
          onClose={() => setEditing(null)}
          onSave={async (label, path) => {
            await setWorkspaceInfo(editing, label, path)
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

/** 처음 실행 또는 "문서 폴더 바꾸기" — 폴더를 고르거나 전에 연 폴더로 돌아간다 */
export function StartScreen({ onOpen }: { onOpen: (w: Workspace) => void }) {
  const [error, setError] = useState<string | null>(null)
  /** 상세 경로가 없는 폴더를 골랐다 — 저장하거나 건너뛰면 연다 */
  const [fresh, setFresh] = useState<{ ws: Workspace; guess: string } | null>(null)

  const pick = async () => {
    setError(null)
    try {
      const handle = await window.showDirectoryPicker({ id: 'jaydocs-primary', mode: 'readwrite', startIn: 'documents' })
      const ws = await workspaceFor(handle)
      if (ws.path) { onOpen(ws); return }
      const known = (await listWorkspaces()).find((w) => w.path)?.path
      setFresh({ ws, guess: known ? guessPath(known, handle.name) : '' })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(`폴더를 열지 못했습니다: ${(e as Error).message}`)
    }
  }

  return (
    <div className="app-message">
      <h1>JayDocs</h1>
      <p>Markdown 과 TSV 를 나란히 편집합니다. 문서는 이 PC 의 폴더에 그대로 있고, 어디에도 올라가지 않습니다.</p>
      <p><button className="is-primary" onClick={() => void pick()}>문서 폴더 열기</button></p>
      {error && <div className="banner is-error">{error}</div>}
      <RecentFolders title="최근 폴더" onOpen={onOpen} onError={setError} />
      <AppFooter />
      {fresh && (
        <FolderInfoDialog
          title="새 문서 폴더"
          folder={fresh.ws.primary.name}
          label={fresh.ws.label ?? ''}
          path=""
          guess={fresh.guess}
          closeLabel="나중에"
          onClose={() => onOpen(fresh.ws)}
          onSave={async (label, path) => {
            await setWorkspaceInfo(fresh.ws, label, path)
            onOpen(fresh.ws)
          }}
        />
      )}
    </div>
  )
}

/** 폴더 접근 권한을 다시 받는 화면. 권한은 사용자가 눌러야만 물을 수 있다 */
export function GrantScreen({ workspace, onReady, onSwitch, onOpen }: { workspace: Workspace; onReady: () => void; onSwitch: () => void; onOpen: (w: Workspace) => void }) {
  const roots: { key: string; alias: string; path?: string; note?: string; root: Pick<StoredRoot, 'handle' | 'readOnly'> }[] = [
    { key: '', alias: workspaceLabel(workspace), path: workspace.path, root: { handle: workspace.primary, readOnly: false } },
    ...workspace.mounts.map((m) => ({ key: m.alias, alias: `@${m.alias}`, path: m.path, note: m.readOnly ? '읽기 전용' : undefined, root: m })),
  ]
  const [granted, setGranted] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const missing = roots.filter((r) => !granted[r.key])
  const primaryOk = granted[''] === true

  useEffect(() => {
    let alive = true
    void (async () => {
      const next: Record<string, boolean> = {}
      for (const r of roots) next[r.key] = (await queryRoot(r.root.handle, r.root.readOnly)) === 'granted'
      if (alive) setGranted(next)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace])

  const allow = async () => {
    setError(null)
    const next = { ...granted }
    for (const r of missing) {
      try {
        next[r.key] = (await requestRoot(r.root.handle, r.root.readOnly)) === 'granted'
      } catch (e) {
        // 브라우저가 클릭 한 번에 한 폴더만 물어 볼 수 있다 — 남은 폴더는 다시 누르면 된다
        if ((e as Error).name !== 'SecurityError') setError(`${r.alias}: ${(e as Error).message}`)
        break
      }
    }
    setGranted(next)
    if (roots.every((r) => next[r.key])) onReady()
  }

  return (
    <div className="app-message">
      <h1>JayDocs</h1>
      <p>이 폴더들에 다시 접근하려면 허용이 필요합니다. 파일은 이 PC 안에서만 읽고 씁니다.</p>
      <div className="start-list">
        {roots.map((r) => (
          <div key={r.key} className="start-row">
            <span className="start-open" title={[r.alias, r.path, r.note].filter(Boolean).join('\n')}>
              <span className="recent-mark">{granted[r.key] ? '✓' : '○'}</span>
              <FolderLabel alias={r.note ? `${r.alias} (${r.note})` : r.alias} path={r.path} />
            </span>
            {r.key === '' && <button onClick={() => setEditing(true)} title="별칭 · 상세 경로 편집">✎</button>}
          </div>
        ))}
      </div>
      <p className="start-actions">
        <button className="is-primary" onClick={() => void allow()} disabled={missing.length === 0}>허용{missing.length > 1 ? ` (${missing.length}개)` : ''}</button>
        {primaryOk && missing.length > 0 && <button onClick={onReady}>허용한 폴더만 열기</button>}
        <button onClick={onSwitch}>다른 폴더 열기</button>
      </p>
      {error && <div className="banner is-error">{error}</div>}
      <RecentFolders title="다른 최근 폴더" exclude={workspace.id} onOpen={onOpen} onError={setError} />
      <AppFooter />
      {editing && (
        <FolderInfoDialog
          title="폴더 정보"
          folder={workspace.primary.name}
          label={workspace.label ?? ''}
          path={workspace.path ?? ''}
          onClose={() => setEditing(false)}
          onSave={async (label, path) => {
            await setWorkspaceInfo(workspace, label, path)
            setEditing(false)
          }}
        />
      )}
    </div>
  )
}
