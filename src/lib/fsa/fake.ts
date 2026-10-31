/**
 * 시험용 메모리 파일 시스템 — FileSystemDirectoryHandle 의 쓰는 부분만.
 * 실제 브라우저에서 시험해 확인한 동작을 따른다: move() 는 있는 파일을 덮어쓰고, 이름은 대소문자를 가리지 않는다(Windows).
 */
type Node = FakeDir | FakeFile

function same(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase()
}

function domError(name: string) {
  return Object.assign(new Error(name), { name })
}

export class FakeFile {
  readonly kind = 'file' as const
  bytes: Uint8Array = new Uint8Array()
  lastModified = 1000
  /** true 면 다른 프로그램이 잠근 상태 — 쓰기 close 가 실패한다 */
  locked = false
  /** true 면 move() 가 막힌다 (Chrome) */
  static moveBlocked = false
  constructor(public name: string, public parent: FakeDir) {}

  async getFile() {
    return Object.assign(new Blob([this.bytes as Uint8Array<ArrayBuffer>]), { name: this.name, lastModified: this.lastModified }) as unknown as File
  }

  async createWritable() {
    let next: Uint8Array = new Uint8Array()
    return {
      write: async (data: string | Uint8Array) => {
        next = typeof data === 'string' ? new TextEncoder().encode(data) : data
      },
      close: async () => {
        if (this.locked) throw domError('InvalidStateError')
        this.bytes = next
        this.lastModified = FakeDir.tick()
      },
      abort: async () => { /* 원본은 그대로 */ },
    }
  }

  async move(a: string | FakeDir, b?: string) {
    if (FakeFile.moveBlocked) throw domError('NotAllowedError')
    const dir = typeof a === 'string' ? this.parent : a
    const name = typeof a === 'string' ? a : (b as string)
    this.parent.children = this.parent.children.filter((c) => c !== this)
    dir.children = dir.children.filter((c) => !same(c.name, name))
    this.name = name
    this.parent = dir
    dir.children.push(this)
  }

  async isSameEntry(other: unknown) {
    return other === this
  }
}

export class FakeDir {
  readonly kind = 'directory' as const
  children: Node[] = []
  private static clock = 2000
  static tick() { return ++FakeDir.clock }

  permission: PermissionState = 'granted'

  constructor(public name: string, public parent: FakeDir | null = null) {}

  private find(name: string) {
    return this.children.find((c) => same(c.name, name))
  }

  async getFileHandle(name: string, opts: { create?: boolean } = {}) {
    const hit = this.find(name)
    if (hit && hit.kind === 'directory') throw domError('TypeMismatchError')
    if (hit) return hit
    if (!opts.create) throw domError('NotFoundError')
    const f = new FakeFile(name, this)
    this.children.push(f)
    return f
  }

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}) {
    const hit = this.find(name)
    if (hit && hit.kind === 'file') throw domError('TypeMismatchError')
    if (hit) return hit
    if (!opts.create) throw domError('NotFoundError')
    const d = new FakeDir(name, this)
    this.children.push(d)
    return d
  }

  async removeEntry(name: string, opts: { recursive?: boolean } = {}) {
    const hit = this.find(name)
    if (!hit) throw domError('NotFoundError')
    if (hit.kind === 'directory' && hit.children.length && !opts.recursive) throw domError('InvalidModificationError')
    this.children = this.children.filter((c) => c !== hit)
  }

  async *entries(): AsyncGenerator<[string, Node]> {
    for (const c of [...this.children]) yield [c.name, c]
  }

  async *keys(): AsyncGenerator<string> {
    for (const c of [...this.children]) yield c.name
  }

  /** 자기 자신이면 [], 안에 있으면 경로 조각, 아니면 null */
  async resolve(other: Node): Promise<string[] | null> {
    const path: string[] = []
    let cur: Node | null = other
    while (cur) {
      if (cur === this) return path
      path.unshift(cur.name)
      cur = cur.parent
    }
    return null
  }

  async isSameEntry(other: unknown) {
    return other === this
  }

  async queryPermission() { return this.permission }
  async requestPermission() { return this.permission }

  // ---- 시험에서 파일을 깔 때
  put(path: string, content: string | Uint8Array): FakeFile {
    const parts = path.split('/')
    const name = parts.pop() as string
    let d: FakeDir = this
    for (const p of parts) {
      let next = d.children.find((c) => c.name === p)
      if (!next) { next = new FakeDir(p, d); d.children.push(next) }
      d = next as FakeDir
    }
    const f = new FakeFile(name, d)
    f.bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    d.children.push(f)
    return f
  }

  at(path: string): Node | undefined {
    let cur: Node | undefined = this
    for (const p of path.split('/')) cur = cur?.kind === 'directory' ? cur.children.find((c) => c.name === p) : undefined
    return cur
  }

  text(path: string) {
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode((this.at(path) as FakeFile).bytes)
  }

  names() {
    return this.children.map((c) => c.name).sort()
  }
}

export const asDir = (d: FakeDir) => d as unknown as FileSystemDirectoryHandle
