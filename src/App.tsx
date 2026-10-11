import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HttpBackend, backend, setBackend, type TreeEntry } from './lib/backend'
import { getToken } from './lib/token'
import { store, useStoreVersion } from './store/documents'
import { Workbench, type WorkbenchHandle } from './components/Workbench'

export default function App() {
  const token = useMemo(getToken, [])
  // 토큰 없이 열린 뒤 주소에 #token=… 이 붙으면(해시만 바뀌면 새로고침이 없다) 다시 시작한다.
  useEffect(() => {
    const onHash = () => { if (location.hash.includes('token=')) location.reload() }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  if (!token) {
    return (
      <div className="app-message">
        <h1>JayDocs</h1>
        <p>접속 토큰이 없습니다. <code>start.cmd</code> 로 실행하면 토큰이 붙은 주소로 열립니다.</p>
        <p>터미널에 찍힌 주소(<code>http://127.0.0.1:…/#token=…</code>)를 그대로 여세요.</p>
      </div>
    )
  }
  setBackend(new HttpBackend(token))
  return <Workspace />
}

function Workspace() {
  useStoreVersion()
  const [root, setRoot] = useState<string | null>(null)
  const [tree, setTree] = useState<TreeEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const bench = useRef<WorkbenchHandle>(null)

  const refreshTree = useCallback(async () => {
    try {
      const t = await backend().tree()
      setTree(t.entries)
      store.setTree(t.entries)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    backend().info().then((i) => setRoot(i.root)).catch((e) => setError((e as Error).message))
    void refreshTree()
  }, [refreshTree])

  // 파일 변경 알림: 열린 문서는 스토어가, 트리는 이름 변경(생성·삭제·이동)일 때 다시 읽는다.
  useEffect(() => {
    let timer: number | undefined
    const unsubscribe = backend().subscribe((e) => {
      setConnected(true)
      void store.handleExternal(e)
      if (e.event === 'rename') {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => void refreshTree(), 300)
      }
    })
    return () => { unsubscribe(); window.clearTimeout(timer) }
  }, [refreshTree])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) void store.saveAll()
        else bench.current?.saveActive()
      } else if (e.ctrlKey && e.key === '\\') {
        e.preventDefault()
        bench.current?.splitActive()
      }
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (store.anyDirty()) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  const newFile = useCallback(async (dir: string) => {
    const name = window.prompt('새 파일 이름 (.md 또는 .tsv)', dir ? `${dir}/새 문서.md` : '새 문서.md')
    if (!name) return
    const path = name.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!/\.(md|tsv)$/i.test(path)) { window.alert('.md 또는 .tsv 로 끝나야 합니다'); return }
    try {
      await backend().write(path, '', null)
      await refreshTree()
      bench.current?.openFile(path)
    } catch (e) {
      window.alert(`만들지 못했습니다: ${(e as Error).message}`)
    }
  }, [refreshTree])

  const newFolder = useCallback(async (dir: string) => {
    const name = window.prompt('새 폴더 이름', dir ? `${dir}/새 폴더` : '새 폴더')
    if (!name) return
    try {
      await backend().mkdir(name.replace(/\\/g, '/'))
      await refreshTree()
    } catch (e) {
      window.alert(`만들지 못했습니다: ${(e as Error).message}`)
    }
  }, [refreshTree])

  const dirtyCount = store.dirtyPaths().size

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">JayDocs</span>
        <span className="root" title={root ?? ''}>{root ?? '…'}</span>
        <span className="spacer" />
        {error && <span className="topbar-error" title={error}>오류: {error}</span>}
        <span className={'conn' + (connected ? ' is-on' : '')} title={connected ? '파일 변경 감시 중' : '감시 연결 대기'}>●</span>
        <button onClick={() => bench.current?.saveActive()} title="Ctrl+S">저장</button>
        <button onClick={() => void store.saveAll()} disabled={dirtyCount === 0} title="Ctrl+Shift+S">
          모두 저장{dirtyCount ? ` (${dirtyCount})` : ''}
        </button>
        <button onClick={() => bench.current?.splitActive()} title="Ctrl+\">오른쪽에 분할</button>
      </header>
      <main className="workbench">
        {root && (
          <Workbench ref={bench} root={root} tree={tree} onRefresh={() => void refreshTree()} onNewFile={(d) => void newFile(d)} onNewFolder={(d) => void newFolder(d)} />
        )}
      </main>
    </div>
  )
}
