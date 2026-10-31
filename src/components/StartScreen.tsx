import { useEffect, useState } from 'react'
import { usePwa } from '../lib/pwa'
import { forgetWorkspace, listWorkspaces, queryRoot, requestRoot, workspaceFor, type StoredRoot, type Workspace } from '../lib/fsa/workspace'

function InstallHint() {
  const app = usePwa()
  if (!app.canInstall) return null
  return (
    <p className="start-hint">
      앱으로 설치하면 시작 메뉴에서 바로 열 수 있고 폴더 권한도 유지됩니다.{' '}
      <button onClick={() => void app.install()}>앱으로 설치</button>
    </p>
  )
}

/** 처음 실행 또는 "문서 폴더 바꾸기" — 폴더를 고르거나 전에 연 폴더로 돌아간다 */
export function StartScreen({ onOpen }: { onOpen: (w: Workspace) => void }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void listWorkspaces().then(setWorkspaces).catch((e) => setError((e as Error).message)) }, [])

  const pick = async () => {
    setError(null)
    try {
      const handle = await window.showDirectoryPicker({ id: 'jaydocs-primary', mode: 'readwrite', startIn: 'documents' })
      onOpen(await workspaceFor(handle))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(`폴더를 열지 못했습니다: ${(e as Error).message}`)
    }
  }

  const forget = async (w: Workspace) => {
    await forgetWorkspace(w.id)
    setWorkspaces((list) => list.filter((x) => x.id !== w.id))
  }

  return (
    <div className="app-message">
      <h1>JayDocs</h1>
      <p>Markdown 과 TSV 를 나란히 편집합니다. 문서는 이 PC 의 폴더에 그대로 있고, 어디에도 올라가지 않습니다.</p>
      <p><button className="is-primary" onClick={() => void pick()}>문서 폴더 열기</button></p>
      {error && <div className="banner is-error">{error}</div>}
      {workspaces.length > 0 && (
        <div className="start-list">
          <div className="start-list-title">전에 연 폴더</div>
          {workspaces.map((w) => (
            <div key={w.id} className="start-row">
              <button className="start-open" onClick={() => onOpen(w)}>
                📁 {w.primary.name}
                {w.mounts.length > 0 && <span className="start-sub"> + 가져온 폴더 {w.mounts.length}개</span>}
              </button>
              <button onClick={() => void forget(w)} title="목록에서 지우기 (폴더와 파일은 그대로)">×</button>
            </div>
          ))}
        </div>
      )}
      <InstallHint />
    </div>
  )
}

/** 폴더 접근 권한을 다시 받는 화면. 권한은 사용자가 눌러야만 물을 수 있다 */
export function GrantScreen({ workspace, onReady, onSwitch }: { workspace: Workspace; onReady: () => void; onSwitch: () => void }) {
  const roots: { key: string; label: string; root: Pick<StoredRoot, 'handle' | 'readOnly'> }[] = [
    { key: '', label: workspace.primary.name, root: { handle: workspace.primary, readOnly: false } },
    ...workspace.mounts.map((m) => ({ key: m.alias, label: `@${m.alias}${m.readOnly ? ' (읽기 전용)' : ''}`, root: m })),
  ]
  const [granted, setGranted] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

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
        if ((e as Error).name !== 'SecurityError') setError(`${r.label}: ${(e as Error).message}`)
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
            <span className="start-open">{granted[r.key] ? '✓' : '○'} {r.label}</span>
          </div>
        ))}
      </div>
      <p className="start-actions">
        <button className="is-primary" onClick={() => void allow()} disabled={missing.length === 0}>허용{missing.length > 1 ? ` (${missing.length}개)` : ''}</button>
        {primaryOk && missing.length > 0 && <button onClick={onReady}>허용한 폴더만 열기</button>}
        <button onClick={onSwitch}>다른 폴더 열기</button>
      </p>
      {error && <div className="banner is-error">{error}</div>}
      <InstallHint />
    </div>
  )
}
