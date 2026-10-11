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

/** 저장하려는 파일이 디스크에서 더 새로울 때 (낙관적 잠금 실패). 디스크 내용을 같이 돌려준다. */
export class ConflictError extends Error {
  constructor(public mtime: number, public text: string) {
    super('디스크의 파일이 더 새롭습니다')
    this.name = 'ConflictError'
  }
}

/** 파일·폴더 접근. 지금은 사이드카(HTTP) 하나, 나중에 File System Access 등을 붙일 수 있게 인터페이스로 둔다. */
export interface Backend {
  info(): Promise<{ root: string }>
  tree(): Promise<{ root: string; entries: TreeEntry[] }>
  read(path: string): Promise<FileData>
  write(path: string, text: string, baseMtime: number | null): Promise<{ mtime: number }>
  mkdir(path: string): Promise<void>
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
    return this.call<{ root: string }>('GET', '/api/info')
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
