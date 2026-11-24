import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { APP_VERSION } from '../lib/pwa'
import { setCurrentWorkspace } from '../lib/fsa/workspace'
import { store } from '../store/documents'
import './CrashScreen.css'

/**
 * 검은 화면 대신 (DESIGN §22 U11 · U12).
 *
 * - `AppErrorBoundary`: 앱 전체를 감싼다. 렌더 중 오류가 나면 React 가 화면을 통째로 내려 어두운 배경만 남던 것을
 *   오류 내용과 빠져나갈 길(저장 · 다시 불러오기 · 열린 탭 비우기 · 시작 화면)로 바꾼다.
 *   문서 스토어는 React 밖에 있다. 창들이 내려가며 문서를 놓기 전에 저장 안 한 문서를 붙잡아(`store.holdDirty`) 여기서 저장할 수 있다.
 * - `BootWait`: 시작(작업 공간 읽기 · 권한 확인)이 BOOT_WAIT_MS 넘게 끝나지 않으면 안내를 띄운다. 그 전에는 아무것도 그리지 않는다.
 *
 * JS 자체를 받지 못했을 때의 안내는 index.html 에 있다(U13).
 */

/** 시작이 이만큼(ms) 넘게 끝나지 않으면 안내를 띄운다 */
const BOOT_WAIT_MS = 5000

/** 열린 탭 · 창 배치(Workbench 의 `jaydocs.layout.v<N>:<작업 공간>`) */
const LAYOUT_PREFIX = 'jaydocs.layout.'

function clearLayouts() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(LAYOUT_PREFIX)) localStorage.removeItem(k)
  } catch { /* 못 지워도 다시 불러오기는 한다 */ }
}

/** IndexedDB 가 멈춰 있어도 버튼이 아무 일도 안 하는 일이 없게 — 기다리다 그냥 넘어간다 */
function within<T>(p: Promise<T>, ms: number) {
  return Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))])
}

async function toStartScreen() {
  await within(setCurrentWorkspace(null).catch(() => {}), 2000)
  location.reload()
}

function reportOf(error: Error, componentStack: string) {
  return [
    `JayDocs ${APP_VERSION}`,
    navigator.userAgent,
    '',
    // V8 의 stack 은 첫 줄이 "이름: 메시지" 다 — 겹치지 않게
    error.stack?.startsWith(error.name) ? error.stack : `${error.name}: ${error.message}\n${error.stack ?? ''}`,
    componentStack ? `\n컴포넌트:${componentStack}` : '',
  ].join('\n').trim()
}

interface BoundaryState {
  error: Error | null
  componentStack: string
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, componentStack: '' }

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    // 창들이 내려가며 store.release 를 부르기 전(렌더 단계)에 — 그러지 않으면 저장 안 한 문서가 메모리에서 내려간다
    store.holdDirty()
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('JayDocs 화면 오류:', error)
    this.setState({ componentStack: info.componentStack ?? '' })
  }

  render() {
    if (!this.state.error) return this.props.children
    return <CrashScreen error={this.state.error} componentStack={this.state.componentStack} />
  }
}

function CrashScreen({ error, componentStack }: { error: Error; componentStack: string }) {
  const [dirty, setDirty] = useState(() => [...store.dirtyPaths()])
  const [saving, setSaving] = useState(false)
  /** 저장하지 못한 문서와 까닭 */
  const [failed, setFailed] = useState<string[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const reloadRef = useRef<HTMLButtonElement>(null)
  const report = reportOf(error, componentStack)

  const saveAll = async () => {
    setSaving(true)
    await store.saveAll().catch(() => {})
    const left = [...store.dirtyPaths()]
    setFailed(left.map((p) => {
      const d = store.get(p)
      if (d?.conflict) return `${p} — 디스크의 파일이 바뀌어 저장하지 않았어요`
      if (store.isReadOnly(p)) return `${p} — 읽기 전용이라 저장할 수 없어요`
      return `${p} — ${d?.error ?? '저장하지 못했어요'}`
    }))
    setDirty(left)
    setSaving(false)
    // 다 저장했으면 저장 상자가 사라지므로 포커스를 다음 할 일로
    if (left.length === 0) window.setTimeout(() => reloadRef.current?.focus(), 0)
  }

  const copy = () => {
    navigator.clipboard.writeText(report).then(
      () => setCopied('복사했어요.'),
      (e) => setCopied(`복사하지 못했어요: ${(e as Error).message} — 아래 "자세히" 를 열어 직접 고르세요.`),
    )
  }

  return (
    <div className="app-message crash" role="alert">
      <h1>JayDocs</h1>
      <p>화면을 그리다 오류가 나서 멈췄어요.</p>
      <p className="crash-error">{error.message || error.name}</p>

      {dirty.length > 0 && (
        <div className="crash-box">
          <p>저장하지 않은 문서가 {dirty.length}개 있어요. 다시 불러오기 전에 저장하세요.</p>
          <ul className="crash-list">{dirty.map((p) => <li key={p}>{p}</li>)}</ul>
          <button className="is-primary" onClick={() => void saveAll()} disabled={saving} autoFocus>{saving ? '저장하는 중…' : '모두 저장'}</button>
          {failed.length > 0 && <ul className="crash-list is-error">{failed.map((f) => <li key={f}>{f}</li>)}</ul>}
        </div>
      )}

      <div className="crash-actions">
        <button ref={reloadRef} className={dirty.length ? '' : 'is-primary'} onClick={() => location.reload()} autoFocus={dirty.length === 0}>다시 불러오기</button>
        <button onClick={() => { clearLayouts(); location.reload() }} title="열어 둔 탭과 창 배치를 비운다. 문서 파일은 그대로다">열린 탭을 비우고 다시 불러오기</button>
        <button onClick={() => void toStartScreen()} title="마지막에 연 폴더를 바로 열지 않고 시작 화면에서 고른다">시작 화면으로</button>
        <button onClick={copy}>오류 내용 복사</button>
      </div>
      {dirty.length > 0 && <p className="muted">다시 불러오면 저장하지 않은 수정은 사라져요.</p>}
      {copied && <p className="muted">{copied}</p>}
      <p className="muted">같은 일이 되풀이되면 "오류 내용 복사" 로 내용을 알려 주세요. 다시 불러와도 안 되면 "열린 탭을 비우고 다시 불러오기" → "시작 화면으로" 순서로 해 보세요.</p>

      <details className="crash-detail">
        <summary>자세히</summary>
        <pre>{report}</pre>
      </details>
    </div>
  )
}

/** 시작 단계(작업 공간 읽기 · 권한 확인) 동안. 오래 걸리면 안내를 띄운다 */
export function BootWait({ onSkip }: { onSkip: () => void }) {
  const [late, setLate] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setLate(true), BOOT_WAIT_MS)
    return () => window.clearTimeout(t)
  }, [])
  if (!late) return null
  return (
    <div className="app-message crash" role="alert">
      <h1>JayDocs</h1>
      <p>시작이 늦어지고 있어요. 마지막에 연 폴더를 읽는 중에 멈췄을 수 있어요.</p>
      <div className="crash-actions">
        <button className="is-primary" onClick={onSkip} autoFocus>시작 화면으로</button>
        <button onClick={() => location.reload()}>다시 불러오기</button>
      </div>
      <p className="muted">JayDocs 를 연 다른 창이나 탭이 있으면 닫고 다시 불러와 보세요.</p>
    </div>
  )
}
