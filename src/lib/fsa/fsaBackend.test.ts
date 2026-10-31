import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError, type ChangeEvent, type TreeEntry } from '../backend'
import { MOUNT_SCAN_LIMIT } from '../roots.mjs'
import { FakeDir, FakeFile, asDir } from './fake'
import { FsaBackend, decodeText } from './fsaBackend'
import type { Workspace } from './workspace'

function setup(Observer: typeof FileSystemObserver | null = null) {
  const root = new FakeDir('Docs')
  const ws: Workspace = { id: 'w1', primary: asDir(root), mounts: [], recent: [] }
  const save = vi.fn(async () => {})
  return { root, ws, save, b: new FsaBackend(ws, { save, Observer }) }
}

const flat = (es: TreeEntry[], out: string[] = []) => {
  for (const e of es) { out.push(e.path); if (e.children) flat(e.children, out) }
  return out
}

afterEach(() => { FakeFile.moveBlocked = false })

describe('읽기 · 인코딩', () => {
  it('BOM 과 줄바꿈을 그대로 돌려준다', async () => {
    const { root, b } = setup()
    const f = root.put('a.md', new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a]))
    const r = await b.read('a.md')
    expect(r.text).toBe('﻿a\r\n')
    expect(r.encoding).toBe('utf-8')
    expect(r.mtime).toBe(f.lastModified)
  })
  it('UTF-8 이 아니면 EUC-KR 로 읽고 알린다', () => {
    expect(decodeText(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb, 0x0a]))).toEqual({ text: '한글\n', encoding: 'euc-kr' })
  })
  it('UTF-16 · 바이너리는 거부한다', () => {
    expect(() => decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))).toThrow('UTF-16')
    expect(() => decodeText(new Uint8Array([0x41, 0x00, 0x42]))).toThrow('바이너리')
  })
  it('5 MB 를 넘으면 열지 않는다', async () => {
    const { root, b } = setup()
    root.put('big.tsv', new Uint8Array(5 * 1024 * 1024 + 1).fill(0x61))
    await expect(b.read('big.tsv')).rejects.toThrow('너무 큽니다')
  })
  it('없는 파일은 알아들을 수 있는 말로', async () => {
    const { b } = setup()
    await expect(b.read('없음.md')).rejects.toThrow('경로가 없습니다')
  })
})

describe('경로 검사', () => {
  it.each(['../x.md', 'a/../x.md', './x.md', 'C:/x.md', '.git/config', 'a/.git/hooks/x', 'a//b.md', ''])('%s 거부', async (p) => {
    const { b } = setup()
    await expect(b.read(p)).rejects.toThrow()
    await expect(b.write(p, 'x', null)).rejects.toThrow()
  })
  it('없는 별칭은 거부, 주 폴더의 진짜 @폴더는 허용', async () => {
    const { root, b } = setup()
    await expect(b.read('@없음/a.md')).rejects.toThrow('가져온 폴더가 없습니다')
    root.put('@진짜/a.md', 'A')
    expect((await b.read('@진짜/a.md')).text).toBe('A')
  })
})

describe('저장', () => {
  it('글자 하나 안 바꾸고 바이트 왕복', async () => {
    const { root, b } = setup()
    const raw = '﻿# 제목\r\n본문\nc\r마지막'
    root.put('a.md', raw)
    const { text, mtime } = await b.read('a.md')
    await b.write('a.md', text, mtime)
    expect(root.text('a.md')).toBe(raw)
  })
  it('새 파일과 없는 폴더를 만든다', async () => {
    const { root, b } = setup()
    const r = await b.write('새/폴더/a.md', 'x', null)
    expect(root.text('새/폴더/a.md')).toBe('x')
    expect(r.mtime).toBe((root.at('새/폴더/a.md') as FakeFile).lastModified)
  })
  it('디스크가 더 새로우면 충돌 — 디스크 내용을 같이 주고 덮어쓰지 않는다', async () => {
    const { root, b } = setup()
    const f = root.put('a.md', '처음')
    const { mtime } = await b.read('a.md')
    f.bytes = new TextEncoder().encode('외부 수정')
    f.lastModified = mtime + 5000
    const err = await b.write('a.md', '내 수정', mtime).catch((e) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.text).toBe('외부 수정')
    expect(err.mtime).toBe(mtime + 5000)
    expect(root.text('a.md')).toBe('외부 수정')
  })
  it('이미 있는 파일을 baseMtime 없이 쓰면 충돌 (새 파일 이름이 겹칠 때)', async () => {
    const { root, b } = setup()
    root.put('a.md', '있음')
    await expect(b.write('a.md', '', null)).rejects.toBeInstanceOf(ConflictError)
    expect(root.text('a.md')).toBe('있음')
  })
  it('UTF-8 이 아닌 파일은 convert 때만 덮어쓴다', async () => {
    const { root, b } = setup()
    root.put('a.txt', new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]))
    const { mtime } = await b.read('a.txt')
    await expect(b.write('a.txt', '한글', mtime)).rejects.toThrow('UTF-8 이 아닌')
    await b.write('a.txt', '한글', mtime, { convert: true })
    expect(root.text('a.txt')).toBe('한글')
  })
  it('잠긴 파일: 이해할 수 있는 오류, 원본 유지', async () => {
    const { root, b } = setup()
    const f = root.put('a.tsv', '원본')
    const { mtime } = await b.read('a.tsv')
    f.locked = true
    await expect(b.write('a.tsv', '새 내용', mtime)).rejects.toThrow('다른 프로그램이 파일을 열고')
    expect(root.text('a.tsv')).toBe('원본')
  })
  it('폴더 자리에 쓰지 않는다', async () => {
    const { root, b } = setup()
    root.put('d/x.md', 'x')
    await expect(b.write('d', 'x', null)).rejects.toThrow('파일이 아닙니다')
  })
})

describe('이름 바꾸기', () => {
  it('move 로 바꾸고 다른 폴더로 옮긴다', async () => {
    const { root, b } = setup()
    root.put('a.md', 'A')
    await b.rename('a.md', 'b.md')
    expect(root.names()).toEqual(['b.md'])
    await b.rename('b.md', '새폴더/c.md')
    expect(root.text('새폴더/c.md')).toBe('A')
    expect(root.at('b.md')).toBeUndefined()
  })
  it('있는 파일을 덮어쓰지 않는다 (move 는 덮어쓴다)', async () => {
    const { root, b } = setup()
    root.put('a.md', 'A')
    root.put('b.md', 'B')
    await expect(b.rename('a.md', 'b.md')).rejects.toThrow('대상이 이미 있습니다')
    await expect(b.rename('a.md', 'B.MD')).rejects.toThrow('대상이 이미 있습니다')
    expect(root.text('a.md')).toBe('A')
    expect(root.text('b.md')).toBe('B')
  })
  it('대소문자만 바꿀 수 있다', async () => {
    const { root, b } = setup()
    root.put('a.md', 'A')
    await b.rename('a.md', 'A.md')
    expect(root.names()).toEqual(['A.md'])
  })
  it('move 가 막히면 복사 후 삭제 (Chrome)', async () => {
    FakeFile.moveBlocked = true
    const { root, b } = setup()
    root.put('a.md', '﻿내용\r\n')
    await b.rename('a.md', 'sub/b.md')
    expect(root.text('sub/b.md')).toBe('﻿내용\r\n')
    expect(root.at('a.md')).toBeUndefined()
  })
  it('move 가 막혀도 있는 파일을 덮어쓰지 않는다', async () => {
    FakeFile.moveBlocked = true
    const { root, b } = setup()
    root.put('a.md', 'A')
    root.put('b.md', 'B')
    await expect(b.rename('a.md', 'b.md')).rejects.toThrow('대상이 이미 있습니다')
    expect(root.text('b.md')).toBe('B')
  })
  it('move 가 막혀도 대소문자만 바꿀 때 내용을 잃지 않는다', async () => {
    FakeFile.moveBlocked = true
    const { root, b } = setup()
    root.put('a.md', 'A')
    await b.rename('a.md', 'A.md')
    expect(root.names()).toEqual(['A.md'])
    expect(root.text('A.md')).toBe('A')
  })
  it('복사가 잘못되면 원본을 지우지 않는다', async () => {
    FakeFile.moveBlocked = true
    const { root, b } = setup()
    root.put('a.md', 'A')
    const dst = root.put('sub/x.md', 'x')
    dst.parent.children = []
    const orig = FakeDir.prototype.getFileHandle
    vi.spyOn(FakeDir.prototype, 'getFileHandle').mockImplementation(async function (this: FakeDir, name: string, opts?: { create?: boolean }) {
      if (name === 'b.md') { const f = new FakeFile(name, this); f.locked = true; return f }
      return orig.call(this, name, opts)
    })
    await expect(b.rename('a.md', 'sub/b.md')).rejects.toThrow()
    vi.restoreAllMocks()
    expect(root.text('a.md')).toBe('A')
  })
  it('폴더는 바꾸지 않는다', async () => {
    const { root, b } = setup()
    root.put('d/x.md', 'x')
    await expect(b.rename('d', 'e')).rejects.toThrow('탐색기')
    expect(root.text('d/x.md')).toBe('x')
  })
  it('루트를 넘나들 수 없다', async () => {
    const { root, b, ws } = setup()
    root.put('a.md', 'A')
    ws.mounts.push({ alias: 'm', handle: asDir(new FakeDir('M')), readOnly: false })
    await expect(b.rename('a.md', '@m/a.md')).rejects.toThrow('옮길 수 없습니다')
  })
})

describe('지우기 · 폴더', () => {
  it('파일 · 빈 폴더 · 재귀', async () => {
    const { root, b } = setup()
    root.put('a.md', 'A')
    root.put('d/x.md', 'x')
    await b.remove('a.md')
    await expect(b.remove('d')).rejects.toThrow('비어 있지 않은')
    await b.remove('d', true)
    expect(root.names()).toEqual([])
    await expect(b.remove('없음.md')).rejects.toThrow('파일이 없습니다')
  })
  it('mkdir 는 중간 폴더까지', async () => {
    const { root, b } = setup()
    await b.mkdir('a/b/c')
    expect(root.at('a/b/c')?.kind).toBe('directory')
  })
})

describe('트리', () => {
  it('문서만, 숨김·node_modules 제외, 폴더 먼저 가나다순', async () => {
    const { root, b } = setup()
    for (const p of ['나.md', '가.tsv', 'x.png', '.hidden/a.md', 'node_modules/a.md', '폴더/다.csv', '폴더/x.exe', '빈폴더/x.png', 'Library/a.md']) root.put(p, 'x')
    const t = await b.tree()
    expect(flat(t.entries)).toEqual(['빈폴더', '폴더', '폴더/다.csv', 'Library', 'Library/a.md', '가.tsv', '나.md'])
    expect(t.truncated).toBe(false)
    expect(t.root).toBe('Docs')
  })
  it('가져온 폴더는 @별칭 경로, 빈 폴더 접기, Unity 폴더 제외', async () => {
    const { b, ws } = setup()
    const m = new FakeDir('Unity')
    for (const p of ['Library/a.md', 'Temp/a.md', 'Assets/a.md', 'Assets/Art/x.png']) m.put(p, 'x')
    ws.mounts.push({ alias: 'u', handle: asDir(m), readOnly: true })
    const t = await b.tree()
    expect(flat(t.mounts[0].entries)).toEqual(['@u/Assets', '@u/Assets/a.md'])
    expect(t.mounts[0]).toMatchObject({ alias: 'u', folder: 'Unity', readOnly: true, error: null })
  })
  it('항목이 많으면 잘린 것을 알린다', async () => {
    const { root, b } = setup()
    const dir = root
    for (let i = 0; i <= MOUNT_SCAN_LIMIT; i++) dir.children.push(new FakeFile(`f${i}.md`, dir))
    expect((await b.tree()).truncated).toBe(true)
  })
  it('가져온 폴더가 사라져도 나머지는 보인다', async () => {
    const { root, b, ws } = setup()
    root.put('a.md', 'A')
    const m = new FakeDir('M')
    m.entries = async function* () { throw Object.assign(new Error('x'), { name: 'NotFoundError' }) }
    ws.mounts.push({ alias: 'm', handle: asDir(m), readOnly: false })
    const t = await b.tree()
    expect(flat(t.entries)).toEqual(['a.md'])
    expect(t.mounts[0].error).toContain('경로가 없습니다')
  })
  it('안쪽 폴더를 못 읽으면 건너뛴다', async () => {
    const { root, b } = setup()
    root.put('a.md', 'A')
    const d = root.put('d/x.md', 'x').parent
    d.entries = async function* () { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }) }
    expect(flat((await b.tree()).entries)).toEqual(['d', 'a.md'])
  })
})

describe('가져온 폴더', () => {
  it('가져오기 · 읽기 · 저장 · 저장소에 남기기', async () => {
    const { b, ws, save } = setup()
    const m = new FakeDir('수업자료')
    m.put('a.md', 'A')
    const info = await b.addRoot(asDir(m))
    expect(info).toMatchObject({ alias: '수업자료', folder: '수업자료', readOnly: false })
    expect(save).toHaveBeenCalledWith(ws)
    expect((await b.read('@수업자료/a.md')).text).toBe('A')
    const { mtime } = await b.read('@수업자료/a.md')
    await b.write('@수업자료/a.md', 'B', mtime)
    expect(m.text('a.md')).toBe('B')
  })
  it('겹치는 폴더를 거부한다', async () => {
    const { root, b } = setup()
    const inner = await root.getDirectoryHandle('안쪽', { create: true })
    await expect(b.addRoot(asDir(inner))).rejects.toThrow('주 문서 폴더 안의 폴더')
    await expect(b.addRoot(asDir(root))).rejects.toThrow('주 문서 폴더 안의 폴더')
    const outer = new FakeDir('밖')
    Object.assign(root, { parent: outer })
    await expect(b.addRoot(asDir(outer))).rejects.toThrow('겹칩니다')
  })
  it('별칭 규칙', async () => {
    const { root, b } = setup()
    await b.addRoot(asDir(new FakeDir('A')))
    await expect(b.addRoot(asDir(new FakeDir('B')), { alias: 'a' })).rejects.toThrow('이미 쓰는 별칭')
    await expect(b.addRoot(asDir(new FakeDir('C')), { alias: 'x/y' })).rejects.toThrow('쓸 수 없습니다')
    root.put('@D/x.md', 'x')
    await expect(b.addRoot(asDir(new FakeDir('D')))).rejects.toThrow('그 별칭은')
    expect((await b.addRoot(asDir(new FakeDir('A')))).alias).toBe('A-2')
  })
  it('권한을 거절하면 가져오지 않는다', async () => {
    const { b, ws } = setup()
    const m = new FakeDir('M')
    m.permission = 'denied'
    await expect(b.addRoot(asDir(m))).rejects.toThrow('허용하지 않았습니다')
    expect(ws.mounts).toEqual([])
  })
  it('읽기 전용이면 쓰기를 모두 거부하고, 끄면 된다', async () => {
    const { b } = setup()
    const m = new FakeDir('M')
    m.put('a.md', 'A')
    await b.addRoot(asDir(m), { readOnly: true })
    const { mtime } = await b.read('@M/a.md')
    await expect(b.write('@M/a.md', 'B', mtime)).rejects.toThrow('읽기 전용')
    await expect(b.mkdir('@M/d')).rejects.toThrow('읽기 전용')
    await expect(b.rename('@M/a.md', '@M/b.md')).rejects.toThrow('읽기 전용')
    await expect(b.remove('@M/a.md')).rejects.toThrow('읽기 전용')
    expect(m.text('a.md')).toBe('A')
    await b.setRootReadOnly('M', false)
    await b.write('@M/a.md', 'B', mtime)
    expect(m.text('a.md')).toBe('B')
  })
  it('쓰기 권한을 거절하면 읽기 전용을 끄지 않는다', async () => {
    const { b } = setup()
    const m = new FakeDir('M')
    await b.addRoot(asDir(m), { readOnly: true })
    m.permission = 'denied'
    await expect(b.setRootReadOnly('M', false)).rejects.toThrow('허용하지 않았습니다')
    expect((await b.roots()).mounts[0].readOnly).toBe(true)
  })
  it('해제하면 최근 목록으로 가고, 다시 가져오거나 지울 수 있다', async () => {
    const { b } = setup()
    const m = new FakeDir('M')
    m.put('a.md', 'A')
    await b.addRoot(asDir(m), { readOnly: true })
    await b.removeRoot('M')
    expect((await b.roots()).mounts).toEqual([])
    expect((await b.roots()).recent).toEqual([{ alias: 'M', folder: 'M', readOnly: true }])
    await expect(b.read('@M/a.md')).rejects.toThrow('가져온 폴더가 없습니다')
    expect(m.text('a.md')).toBe('A')
    await b.restoreRoot('M')
    expect((await b.roots()).recent).toEqual([])
    expect((await b.roots()).mounts[0]).toMatchObject({ alias: 'M', readOnly: true })
    await b.removeRoot('M')
    await b.forgetRoot('M')
    expect((await b.roots()).recent).toEqual([])
  })
  it('가져온 폴더 자체에는 쓸 수 없다', async () => {
    const { b } = setup()
    await b.addRoot(asDir(new FakeDir('M')))
    await expect(b.write('@M', 'x', null)).rejects.toThrow('자체에는')
  })
})

describe('변경 감지', () => {
  class FakeObserver {
    static all: FakeObserver[] = []
    observed: unknown = null
    disconnected = false
    constructor(public cb: (records: FileSystemChangeRecord[], ob: FileSystemObserver) => void) { FakeObserver.all.push(this) }
    async observe(h: unknown) { this.observed = h }
    disconnect() { this.disconnected = true }
    fire(type: FileSystemChangeRecord['type'], segs: string[], from: string[] | null = null) {
      this.cb([{ type, relativePathComponents: segs, relativePathMovedFrom: from, root: this.observed as FileSystemHandle }], this as unknown as FileSystemObserver)
    }
  }
  const Observer = FakeObserver as unknown as typeof FileSystemObserver

  beforeEach(() => { vi.useFakeTimers(); FakeObserver.all = [] })
  afterEach(() => { vi.useRealTimers() })

  function start() {
    const s = setup(Observer)
    const events: ChangeEvent[] = []
    const stop = s.b.subscribe((e) => events.push(e))
    return { ...s, events, stop, ob: FakeObserver.all[0] }
  }

  it('수정은 change, 생성·삭제는 rename', async () => {
    const { ob, events } = start()
    ob.fire('modified', ['a.md'])
    ob.fire('appeared', ['d', 'b.md'])
    ob.fire('disappeared', ['c.md'])
    await vi.advanceTimersByTimeAsync(200)
    expect(events).toEqual([
      { type: 'change', event: 'change', path: 'a.md' },
      { type: 'change', event: 'rename', path: 'd/b.md' },
      { type: 'change', event: 'rename', path: 'c.md' },
    ])
  })
  it('저장 한 번에 몰려오는 이벤트를 하나로 뭉친다', async () => {
    const { ob, events } = start()
    for (let i = 0; i < 4; i++) ob.fire('modified', ['a.md'])
    await vi.advanceTimersByTimeAsync(200)
    expect(events).toHaveLength(1)
  })
  it('생성 뒤 수정이 와도 트리를 다시 읽게 rename 을 유지한다', async () => {
    const { ob, events } = start()
    ob.fire('appeared', ['a.md'])
    ob.fire('modified', ['a.md'])
    await vi.advanceTimersByTimeAsync(200)
    expect(events).toEqual([{ type: 'change', event: 'rename', path: 'a.md' }])
  })
  it('이동은 양쪽 경로 모두 알린다', async () => {
    const { ob, events } = start()
    ob.fire('moved', ['b.md'], ['a.md'])
    await vi.advanceTimersByTimeAsync(200)
    expect(events.map((e) => e.path).sort()).toEqual(['a.md', 'b.md'])
  })
  it('임시 파일 · 숨김 · node_modules 는 무시한다', async () => {
    const { ob, events } = start()
    ob.fire('appeared', ['a.md.crswap'])
    ob.fire('modified', ['.git', 'index'])
    ob.fire('modified', ['node_modules', 'x', 'a.md'])
    await vi.advanceTimersByTimeAsync(200)
    expect(events).toEqual([])
  })
  it('무엇이 바뀌었는지 모르면 rescan, 오류면 다시 감시', async () => {
    const { ob, events } = start()
    ob.fire('unknown', [])
    expect(events).toEqual([{ type: 'change', event: 'rescan', path: '' }])
    ob.fire('errored', [])
    expect(ob.disconnected).toBe(true)
    expect(FakeObserver.all).toHaveLength(2)
  })
  it('가져온 폴더는 @별칭 경로로, Unity 폴더는 무시', async () => {
    const { b, events } = start()
    await b.addRoot(asDir(new FakeDir('M')))
    events.length = 0
    const ob = FakeObserver.all[FakeObserver.all.length - 1]
    ob.fire('modified', ['a.md'])
    ob.fire('modified', ['Library', 'a.md'])
    await vi.advanceTimersByTimeAsync(200)
    expect(events).toEqual([{ type: 'change', event: 'change', path: '@M/a.md' }])
    await b.removeRoot('M')
    expect(ob.disconnected).toBe(true)
  })
  it('구독을 다 끊으면 감시도 끝난다', () => {
    const { ob, stop } = start()
    stop()
    expect(ob.disconnected).toBe(true)
  })
  it('감지 API 가 없으면 주기적으로 다시 확인한다', async () => {
    const s = setup(null)
    const events: ChangeEvent[] = []
    const stop = s.b.subscribe((e) => events.push(e))
    expect(s.b.watching()).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(events).toEqual([{ type: 'change', event: 'rescan', path: '' }])
    stop()
  })
})

describe('이미지', () => {
  it('허용한 형식만 주소로 준다', async () => {
    const { root, b } = setup()
    root.put('a.png', new Uint8Array([1, 2]))
    root.put('a.md', 'x')
    expect(await b.rawUrl('a.png')).toMatch(/^blob:/)
    await expect(b.rawUrl('a.md')).rejects.toThrow('허용되지 않은')
  })
})
