/**
 * 훑어보기용 파일 읽기 · 캐시 (PLAN-skim SK4). 열지 않은 파일을 디스크에서 읽어 들고 있는다 — 스토어에는 올리지 않는다.
 *
 * - 캐시 열쇠는 경로 + 수정 시각. `load` 는 먼저 수정 시각만 보고(`stat`), 같으면 캐시를 그대로 돌려준다(내용을 다시 읽지 않는다).
 * - 읽지 못한 것(바이너리 · 5 MB 초과 · 권한)도 이유와 함께 들고 있는다 — 수정 시각이 그대로면 다시 읽어 보지 않는다.
 * - 최근 `max` 개(기본 200)만 남긴다. 지금 화면이 보고 있는(구독 중인) 경로는 버리지 않는다.
 * - 한 번에 `concurrency` 개(기본 4)까지만 읽는다. 같은 경로를 동시에 여러 번 청하면 한 번만 읽는다.
 * - 구독자가 있는 동안 바깥 변경(`io.watch`)을 듣고, 구독 중인 경로가 바뀌면 다시 확인한다.
 *
 * 파일 접근은 `io` 로 받는다 — 앱에서는 `backend()` (lib/skim/index.ts), 시험에서는 가짜.
 */
export interface SkimIo {
  read(path: string): Promise<{ text: string; mtime: number; encoding?: string }>
  /** 수정 시각만. 파일이 없으면 거부 */
  stat(path: string): Promise<{ mtime: number }>
  /** 바깥 변경 알림. 바뀐 경로를 주고, 무엇이 바뀌었는지 모르면 null. 돌려주는 함수로 그만 듣는다 */
  watch?(handler: (path: string | null) => void): () => void
}

export type SkimFile =
  /** text 는 디스크의 글 그대로다 (BOM · 줄바꿈 포함). encoding 이 'utf-8' 이 아니면 EUC-KR 로 읽은 것 */
  | { ok: true; text: string; mtime: number; encoding: string }
  /** mtime 이 null 이면 수정 시각도 못 읽었다 (파일 없음 등) — 다음 load 때 늘 다시 확인한다 */
  | { ok: false; error: string; mtime: number | null }

export interface SkimReaderOptions {
  /** 들고 있을 파일 수 (기본 200) */
  max?: number
  /** 한 번에 읽는 수 (기본 4) */
  concurrency?: number
}

const sameTime = (a: number, b: number) => Math.abs(a - b) < 1

export class SkimReader {
  private max: number
  private concurrency: number
  /** 순서 = 쓴 순서 (앞이 가장 오래됨) */
  private cache = new Map<string, SkimFile>()
  private pending = new Map<string, Promise<SkimFile>>()
  private listeners = new Map<string, Set<() => void>>()
  private running = 0
  private queue: (() => void)[] = []
  private unwatch: (() => void) | null = null

  constructor(private io: SkimIo, opts: SkimReaderOptions = {}) {
    this.max = opts.max ?? 200
    this.concurrency = opts.concurrency ?? 4
  }

  /** 캐시에 있는 것 (디스크를 보지 않는다). 내용이 그대로면 같은 객체다 — useSyncExternalStore 의 스냅샷으로 쓸 수 있다 */
  peek(path: string): SkimFile | undefined {
    return this.cache.get(path)
  }

  /** 들고 있는 파일 수 */
  get size() {
    return this.cache.size
  }

  /**
   * 수정 시각을 보고, 캐시와 같으면 캐시를, 다르면 다시 읽어 돌려준다. 거부하지 않는다 — 실패는 `{ ok: false }`.
   * 값이 바뀌면 그 경로의 구독자를 부른다.
   */
  load(path: string): Promise<SkimFile> {
    const going = this.pending.get(path)
    if (going) return going
    const p = this.slot(() => this.fetch(path)).finally(() => { this.pending.delete(path) })
    this.pending.set(path, p)
    return p
  }

  private async fetch(path: string): Promise<SkimFile> {
    let mtime: number
    try {
      mtime = (await this.io.stat(path)).mtime
    } catch (e) {
      return this.put(path, { ok: false, error: message(e), mtime: null })
    }
    const hit = this.cache.get(path)
    if (hit && hit.mtime !== null && sameTime(hit.mtime, mtime)) {
      // 방금 쓴 것으로 올린다
      this.cache.delete(path)
      this.cache.set(path, hit)
      return hit
    }
    try {
      const f = await this.io.read(path)
      return this.put(path, { ok: true, text: f.text, mtime: f.mtime, encoding: f.encoding ?? 'utf-8' })
    } catch (e) {
      return this.put(path, { ok: false, error: message(e), mtime })
    }
  }

  private put(path: string, file: SkimFile): SkimFile {
    const prev = this.cache.get(path)
    // 못 읽는 상태가 그대로면 같은 객체를 남긴다 (화면을 다시 그리지 않게)
    if (prev && !prev.ok && !file.ok && prev.error === file.error && prev.mtime === file.mtime) return prev
    this.cache.delete(path)
    this.cache.set(path, file)
    this.trim()
    for (const l of [...(this.listeners.get(path) ?? [])]) l()
    return file
  }

  /** 오래 안 쓴 것부터 버린다. 구독 중인 경로는 남긴다 (그래서 구독이 많으면 max 를 넘을 수 있다) */
  private trim() {
    if (this.cache.size <= this.max) return
    for (const key of [...this.cache.keys()]) {
      if (this.cache.size <= this.max) break
      if (!this.listeners.has(key)) this.cache.delete(key)
    }
  }

  /** 동시 실행 수를 지킨다 */
  private slot<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.running++
        task().then(resolve, reject).finally(() => {
          this.running--
          this.queue.shift()?.()
        })
      }
      if (this.running < this.concurrency) run()
      else this.queue.push(run)
    })
  }

  /** 이 경로의 캐시 값이 바뀔 때 부른다. 구독자가 하나라도 있는 동안 바깥 변경을 듣는다 */
  subscribe(path: string, listener: () => void): () => void {
    let set = this.listeners.get(path)
    if (!set) this.listeners.set(path, (set = new Set()))
    set.add(listener)
    if (!this.unwatch && this.io.watch) this.unwatch = this.io.watch((changed) => this.onExternal(changed))
    return () => {
      set.delete(listener)
      if (set.size === 0 && this.listeners.get(path) === set) this.listeners.delete(path)
      if (this.listeners.size === 0 && this.unwatch) {
        this.unwatch()
        this.unwatch = null
      }
      this.trim()
    }
  }

  /** 바깥 변경: 구독 중인 경로만 다시 확인한다. 나머지는 다음에 load 할 때 수정 시각으로 걸러진다 */
  private onExternal(changed: string | null) {
    if (changed === null) { for (const p of [...this.listeners.keys()]) void this.load(p) }
    else if (this.listeners.has(changed)) void this.load(changed)
  }

  /** 캐시를 비운다 (path 를 주면 그것만). 구독자에게는 알리지 않는다 */
  clear(path?: string) {
    if (path === undefined) this.cache.clear()
    else this.cache.delete(path)
  }
}

function message(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String(e)
}
