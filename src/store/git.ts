import { useSyncExternalStore } from 'react'
import { backend, type GitCode } from '../lib/backend'

/** git 상태 (배지용). 사이드카의 `git status` 를 받아 경로 → 코드 맵으로 든다. 파일이 바뀔 때마다 뭉쳐서 다시 읽는다. */
class GitStore {
  version = 0
  repo = false
  branch: string | null = null
  status = new Map<string, GitCode>()
  error: string | null = null
  loading = false
  /** 커밋·복원처럼 HEAD 가 바뀐 횟수 — diff 창이 HEAD 를 다시 읽는 기준 */
  headVersion = 0
  /** "현재 문서의 기록" 명령이 git 패널에 보내는 요청 (패널이 n 이 바뀌면 받는다) */
  logRequest: { path: string; n: number } | null = null

  requestLog(path: string) {
    this.logRequest = { path, n: (this.logRequest?.n ?? 0) + 1 }
    this.emit()
  }

  private listeners = new Set<() => void>()
  private timer: number | undefined
  private inflight = false
  private again = false

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => { this.listeners.delete(l) }
  }
  getVersion = () => this.version
  private emit() {
    this.version++
    for (const l of this.listeners) l()
  }

  codeOf(path: string): GitCode | undefined {
    return this.status.get(path)
  }
  /** 폴더 아래에 바뀐 파일이 있나 */
  dirHasChanges(dir: string): boolean {
    const prefix = dir ? dir + '/' : ''
    for (const p of this.status.keys()) if (p.startsWith(prefix)) return true
    return false
  }
  changedPaths(): string[] {
    return [...this.status.keys()].sort()
  }

  async refresh() {
    if (this.inflight) { this.again = true; return }
    this.inflight = true
    this.loading = true
    this.emit()
    try {
      const s = await backend().gitStatus()
      this.repo = s.repo
      this.branch = s.branch
      this.status = new Map(s.entries.map((e) => [e.path, e.status]))
      this.error = null
    } catch (e) {
      this.error = (e as Error).message
    } finally {
      this.inflight = false
      this.loading = false
      this.emit()
      if (this.again) { this.again = false; void this.refresh() }
    }
  }

  /** 파일 변경 알림이 몰려올 때 한 번만 */
  scheduleRefresh(delay = 400) {
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.refresh(), delay)
  }

  headChanged() {
    this.headVersion++
    void this.refresh()
  }
}

export const git = new GitStore()

export function useGitVersion() {
  return useSyncExternalStore(git.subscribe, git.getVersion)
}
