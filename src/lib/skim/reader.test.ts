import { describe, expect, it } from 'vitest'
import { SkimReader, type SkimIo } from './reader'

/** 메모리 파일 + 호출 횟수. `gate` 를 켜면 read 가 `release()` 를 부를 때까지 멈춘다 */
function fakeIo(files: Record<string, { text: string; mtime: number } | Error>) {
  const calls = { read: [] as string[], stat: [] as string[] }
  const watchers = new Set<(path: string | null) => void>()
  let gate = false
  let waiting: (() => void)[] = []
  let active = 0
  let peak = 0
  const io: SkimIo = {
    async stat(path) {
      calls.stat.push(path)
      const f = files[path]
      if (!f) throw new Error('읽지 못했습니다: 경로가 없습니다')
      return { mtime: f instanceof Error ? 5 : f.mtime }
    },
    async read(path) {
      calls.read.push(path)
      active++
      peak = Math.max(peak, active)
      if (gate) await new Promise<void>((r) => waiting.push(r))
      active--
      const f = files[path]
      if (!f) throw new Error('읽지 못했습니다: 경로가 없습니다')
      if (f instanceof Error) throw f
      return { text: f.text, mtime: f.mtime }
    },
    watch(handler) {
      watchers.add(handler)
      return () => { watchers.delete(handler) }
    },
  }
  return {
    io, calls, files, watchers,
    hold() { gate = true },
    release() { gate = false; const w = waiting; waiting = []; for (const r of w) r() },
    get waiting() { return waiting.length },
    get peak() { return peak },
    emit(path: string | null) { for (const w of [...watchers]) w(path) },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('SkimReader — 경로 + 수정 시각 캐시 (PLAN-skim SK4)', () => {
  it('처음에는 읽고, 수정 시각이 그대로면 다시 읽지 않는다', async () => {
    const f = fakeIo({ 'a.md': { text: '\ufeff# a\r\n', mtime: 10 } })
    const r = new SkimReader(f.io)
    expect(r.peek('a.md')).toBeUndefined()
    const first = await r.load('a.md')
    // 디스크의 글 그대로 (BOM · CRLF 를 건드리지 않는다)
    expect(first).toEqual({ ok: true, text: '\ufeff# a\r\n', mtime: 10, encoding: 'utf-8' })
    expect(r.peek('a.md')).toBe(first)
    const second = await r.load('a.md')
    expect(second).toBe(first)
    expect(f.calls.read).toEqual(['a.md'])
    expect(f.calls.stat).toEqual(['a.md', 'a.md'])
  })

  it('수정 시각이 바뀌면 다시 읽는다', async () => {
    const f = fakeIo({ 'a.md': { text: '1', mtime: 10 } })
    const r = new SkimReader(f.io)
    await r.load('a.md')
    f.files['a.md'] = { text: '2', mtime: 20 }
    const next = await r.load('a.md')
    expect(next).toEqual({ ok: true, text: '2', mtime: 20, encoding: 'utf-8' })
    expect(f.calls.read.length).toBe(2)
  })

  it('못 읽는 파일은 이유를 들고 있고, 수정 시각이 그대로면 다시 읽어 보지 않는다', async () => {
    const f = fakeIo({ 'big.txt': new Error('파일이 너무 큽니다 (7.2 MB, 최대 5 MB)') })
    const r = new SkimReader(f.io)
    const first = await r.load('big.txt')
    expect(first).toEqual({ ok: false, error: '파일이 너무 큽니다 (7.2 MB, 최대 5 MB)', mtime: 5 })
    expect(await r.load('big.txt')).toBe(first)
    expect(f.calls.read.length).toBe(1)
  })

  it('없는 파일은 오류로 남고 다음에 다시 확인한다 — 생기면 읽는다', async () => {
    const f = fakeIo({})
    const r = new SkimReader(f.io)
    const miss = await r.load('x.md')
    expect(miss).toEqual({ ok: false, error: '읽지 못했습니다: 경로가 없습니다', mtime: null })
    expect(f.calls.read.length).toBe(0)
    // 그대로면 같은 객체 (다시 그리지 않는다)
    expect(await r.load('x.md')).toBe(miss)
    f.files['x.md'] = { text: 'x', mtime: 1 }
    expect(await r.load('x.md')).toMatchObject({ ok: true, text: 'x' })
  })

  it('같은 경로를 동시에 청하면 한 번만 읽는다', async () => {
    const f = fakeIo({ 'a.md': { text: 'a', mtime: 1 } })
    const r = new SkimReader(f.io)
    const [x, y] = await Promise.all([r.load('a.md'), r.load('a.md')])
    expect(x).toBe(y)
    expect(f.calls.stat.length).toBe(1)
    expect(f.calls.read.length).toBe(1)
  })

  it('최근 max 개만 남긴다 — 다시 쓴 것은 살아남는다', async () => {
    const files: Record<string, { text: string; mtime: number }> = {}
    for (let i = 0; i < 5; i++) files[`${i}.md`] = { text: String(i), mtime: 1 }
    const f = fakeIo(files)
    const r = new SkimReader(f.io, { max: 3 })
    await r.load('0.md')
    await r.load('1.md')
    await r.load('2.md')
    await r.load('0.md') // 0 을 다시 썼다 → 가장 오래된 것은 1
    await r.load('3.md')
    expect(r.size).toBe(3)
    expect(r.peek('1.md')).toBeUndefined()
    expect(r.peek('0.md')).toBeDefined()
    await r.load('4.md')
    expect(r.peek('2.md')).toBeUndefined()
    expect([r.peek('0.md'), r.peek('3.md'), r.peek('4.md')].every(Boolean)).toBe(true)
  })

  it('기본은 200개', async () => {
    const files: Record<string, { text: string; mtime: number }> = {}
    for (let i = 0; i < 205; i++) files[`${i}.md`] = { text: '', mtime: 1 }
    const r = new SkimReader(fakeIo(files).io)
    for (let i = 0; i < 205; i++) await r.load(`${i}.md`)
    expect(r.size).toBe(200)
    expect(r.peek('4.md')).toBeUndefined()
    expect(r.peek('5.md')).toBeDefined()
  })

  it('구독 중인 경로는 버리지 않는다 (구독을 풀면 버린다)', async () => {
    const files: Record<string, { text: string; mtime: number }> = {}
    for (let i = 0; i < 4; i++) files[`${i}.md`] = { text: String(i), mtime: 1 }
    const r = new SkimReader(fakeIo(files).io, { max: 2 })
    const off = r.subscribe('0.md', () => {})
    for (let i = 0; i < 4; i++) await r.load(`${i}.md`)
    expect(r.peek('0.md')).toBeDefined()
    expect(r.peek('1.md')).toBeUndefined()
    expect(r.size).toBe(2)
    off()
    await r.load('1.md')
    expect(r.peek('0.md')).toBeUndefined()
  })

  it('한 번에 concurrency 개까지만 읽는다', async () => {
    const files: Record<string, { text: string; mtime: number }> = {}
    for (let i = 0; i < 10; i++) files[`${i}.md`] = { text: String(i), mtime: 1 }
    const f = fakeIo(files)
    const r = new SkimReader(f.io, { concurrency: 4 })
    f.hold()
    const all = Promise.all(Object.keys(files).map((p) => r.load(p)))
    await tick()
    expect(f.waiting).toBe(4)
    while (f.waiting > 0) { f.release(); f.hold(); await tick() }
    f.release()
    expect((await all).every((x) => x.ok)).toBe(true)
    expect(f.peak).toBe(4)
    expect(f.calls.read.length).toBe(10)
  })

  it('구독자는 값이 바뀔 때만 불린다', async () => {
    const f = fakeIo({ 'a.md': { text: '1', mtime: 10 } })
    const r = new SkimReader(f.io)
    let n = 0
    r.subscribe('a.md', () => { n++ })
    await r.load('a.md')
    expect(n).toBe(1)
    await r.load('a.md')
    expect(n).toBe(1)
    f.files['a.md'] = { text: '2', mtime: 20 }
    await r.load('a.md')
    expect(n).toBe(2)
  })

  it('구독자가 있는 동안만 바깥 변경을 듣고, 구독 중인 경로만 다시 확인한다', async () => {
    const f = fakeIo({ 'a.md': { text: '1', mtime: 10 }, 'b.md': { text: 'b', mtime: 10 } })
    const r = new SkimReader(f.io)
    expect(f.watchers.size).toBe(0)
    let n = 0
    const off = r.subscribe('a.md', () => { n++ })
    expect(f.watchers.size).toBe(1)
    await r.load('a.md')
    await r.load('b.md')
    const stats = f.calls.stat.length

    // 구독하지 않은 경로의 변경은 지금 확인하지 않는다
    f.emit('b.md')
    await tick()
    expect(f.calls.stat.length).toBe(stats)

    f.files['a.md'] = { text: '2', mtime: 20 }
    f.emit('a.md')
    await tick()
    expect(r.peek('a.md')).toMatchObject({ text: '2' })
    expect(n).toBe(2)

    // 무엇이 바뀌었는지 모를 때(null)는 구독 중인 것을 모두 본다
    f.files['a.md'] = { text: '3', mtime: 30 }
    f.emit(null)
    await tick()
    expect(r.peek('a.md')).toMatchObject({ text: '3' })

    off()
    expect(f.watchers.size).toBe(0)
  })

  it('clear 는 캐시를 비운다', async () => {
    const f = fakeIo({ 'a.md': { text: '1', mtime: 10 }, 'b.md': { text: 'b', mtime: 10 } })
    const r = new SkimReader(f.io)
    await r.load('a.md')
    await r.load('b.md')
    r.clear('a.md')
    expect(r.peek('a.md')).toBeUndefined()
    expect(r.peek('b.md')).toBeDefined()
    r.clear()
    expect(r.size).toBe(0)
  })
})
