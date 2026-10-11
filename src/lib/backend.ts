export interface TreeEntry {
  type: 'dir' | 'file'
  name: string
  path: string
  children?: TreeEntry[]
}
export interface FileData {
  path: string
  text: string
  mtime: number
}
export interface ChangeEvent {
  type: 'change'
  event: 'rename' | 'change'
  path: string
}

export type GitCode = 'M' | 'A' | 'D' | 'R' | 'U' | '?'
export interface GitStatus {
  repo: boolean
  branch: string | null
  /** 원격 추적 브랜치 (없으면 null) */
  upstream?: string | null
  /** 원격보다 앞선 / 뒤처진 커밋 수 (upstream 이 있을 때) */
  ahead?: number
  behind?: number
  entries: { path: string; status: GitCode; origPath?: string }[]
}
export interface GitSyncResult {
  ok: boolean
  /** git 의 출력 (stdout + stderr) */
  output: string
}
export interface GitLogEntry {
  hash: string
  shortHash: string
  date: string
  author: string
  subject: string
}

/** 저장하려는 파일이 디스크에서 더 새로울 때 (낙관적 잠금 실패). 디스크 내용을 같이 돌려준다. */
export class ConflictError extends Error {
  constructor(public mtime: number, public text: string) {
    super('디스크의 파일이 더 새롭습니다')
    this.name = 'ConflictError'
  }
}

/** 파일·폴더 접근. 지금은 사이드카(HTTP) 하나, 나중에 File System Access 등을 붙일 수 있게 인터페이스로 둔다. */
export interface Backend {
  info(): Promise<{ root: string; git?: boolean; branch?: string | null }>
  tree(): Promise<{ root: string; entries: TreeEntry[] }>
  read(path: string): Promise<FileData>
  write(path: string, text: string, baseMtime: number | null): Promise<{ mtime: number }>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string, recursive?: boolean): Promise<void>
  gitStatus(): Promise<GitStatus>
  gitShow(path: string, rev?: string): Promise<{ text: string }>
  gitLog(path?: string, limit?: number): Promise<{ entries: GitLogEntry[] }>
  gitCommit(paths: string[], message: string): Promise<{ hash: string; shortHash: string; summary: string }>
  gitRestore(path: string): Promise<void>
  gitPush(): Promise<GitSyncResult>
  gitPull(): Promise<GitSyncResult>
  /** 이미지 같은 원본 파일을 <img src> 로 쓸 수 있는 주소 */
  rawUrl(path: string): string
  subscribe(handler: (e: ChangeEvent) => void): () => void
}

export class HttpBackend implements Backend {
  constructor(private token: string) {}

  private async call<T>(method: string, url: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'X-Token': this.token }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.status === 409) throw new ConflictError(Number(data.mtime), String(data.text ?? ''))
    if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`)
    return data as T
  }

  info() {
    return this.call<{ root: string; git?: boolean; branch?: string | null }>('GET', '/api/info')
  }
  async rename(from: string, to: string) {
    await this.call<unknown>('POST', '/api/rename', { from, to })
  }
  async remove(path: string, recursive = false) {
    await this.call<unknown>('POST', '/api/delete', { path, recursive })
  }
  gitStatus() {
    return this.call<GitStatus>('GET', '/api/git/status')
  }
  gitShow(path: string, rev = 'HEAD') {
    return this.call<{ text: string }>('GET', `/api/git/show?path=${encodeURIComponent(path)}&rev=${encodeURIComponent(rev)}`)
  }
  gitLog(path?: string, limit = 100) {
    const q = path ? `path=${encodeURIComponent(path)}&` : ''
    return this.call<{ entries: GitLogEntry[] }>('GET', `/api/git/log?${q}limit=${limit}`)
  }
  gitCommit(paths: string[], message: string) {
    return this.call<{ hash: string; shortHash: string; summary: string }>('POST', '/api/git/commit', { paths, message })
  }
  async gitRestore(path: string) {
    await this.call<unknown>('POST', '/api/git/restore', { path })
  }
  gitPush() {
    return this.call<GitSyncResult>('POST', '/api/git/push', {})
  }
  gitPull() {
    return this.call<GitSyncResult>('POST', '/api/git/pull', {})
  }
  rawUrl(path: string) {
    // <img> 는 헤더를 못 보내니 토큰을 쿼리로. 로컬 전용 주소라 괜찮다
    return `/api/raw?path=${encodeURIComponent(path)}&token=${encodeURIComponent(this.token)}`
  }
  tree() {
    return this.call<{ root: string; entries: TreeEntry[] }>('GET', '/api/tree')
  }
  read(path: string) {
    return this.call<FileData>('GET', `/api/file?path=${encodeURIComponent(path)}`)
  }
  write(path: string, text: string, baseMtime: number | null) {
    return this.call<{ mtime: number }>('PUT', `/api/file?path=${encodeURIComponent(path)}`, { text, baseMtime })
  }
  async mkdir(path: string) {
    await this.call<unknown>('POST', `/api/mkdir?path=${encodeURIComponent(path)}`)
  }
  subscribe(handler: (e: ChangeEvent) => void) {
    const es = new EventSource(`/api/events?token=${encodeURIComponent(this.token)}`)
    es.onmessage = (ev) => {
      try { handler(JSON.parse(ev.data) as ChangeEvent) } catch { /* 형식이 아니면 무시 */ }
    }
    return () => es.close()
  }
}

let current: Backend | null = null
export function setBackend(b: Backend) {
  current = b
}
export function backend(): Backend {
  if (!current) throw new Error('backend 가 설정되지 않았습니다')
  return current
}
