import { describe, expect, it } from 'vitest'
import { FIT, SAVED_KEY, SAVED_MAX, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, diagramKey, fromSaved, isFit, loadDiagramView, panBy, panKey, saveDiagramView, toSaved, zoomAt, zoomKey } from './diagramZoom'

describe('다이어그램 확대 · 이동', () => {
  it('맞춤에서 가운데로 확대하면 그 점이 제자리에 있다', () => {
    const v = zoomAt(FIT, 2, 100, 50)
    expect(v.s).toBe(2)
    // 화면의 (100, 50) 에 있던 내용 점 (100, 50) 은 확대 뒤에도 (100, 50) 에 보인다: x + 100 * s = 100
    expect(v.x + 100 * v.s).toBeCloseTo(100)
    expect(v.y + 50 * v.s).toBeCloseTo(50)
  })
  it('확대 → 축소를 같은 점에서 하면 맞춤으로 돌아온다', () => {
    const v = zoomAt(zoomAt(FIT, ZOOM_STEP, 120, 80), 1 / ZOOM_STEP, 120, 80)
    expect(v).toEqual(FIT)
    expect(isFit(v)).toBe(true)
  })
  it('배율은 위아래 한계에서 멈춘다', () => {
    let v = FIT
    for (let i = 0; i < 50; i++) v = zoomAt(v, ZOOM_STEP, 0, 0)
    expect(v.s).toBe(ZOOM_MAX)
    for (let i = 0; i < 80; i++) v = zoomAt(v, 1 / ZOOM_STEP, 0, 0)
    expect(v.s).toBe(ZOOM_MIN)
    expect(zoomAt(v, 1 / ZOOM_STEP, 0, 0)).toBe(v)
  })
  it('옮기기 · 방향키', () => {
    expect(panBy(FIT, 0, 0)).toBe(FIT)
    expect(panBy({ s: 2, x: 10, y: 0 }, -40, 5)).toEqual({ s: 2, x: -30, y: 5 })
    expect(panKey('ArrowRight', false)).toEqual([-40, 0])
    expect(panKey('ArrowUp', true)).toEqual([0, 160])
    expect(panKey('Enter', false)).toBeNull()
  })
  it('확대 키 — Ctrl+= · Ctrl+- (Alt 가 섞이면 아니다)', () => {
    const k = (code: string, key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = { ctrlKey: true }) =>
      zoomKey({ code, key, ctrlKey: false, metaKey: false, altKey: false, ...mods })
    expect(k('Equal', '=')).toBe(1)
    expect(k('Minus', '-')).toBe(-1)
    expect(k('NumpadAdd', '+')).toBe(1)
    expect(k('Equal', '=', { metaKey: true })).toBe(1)
    expect(k('Equal', '=', { ctrlKey: true, altKey: true })).toBe(0)
    expect(k('Equal', '=', {})).toBe(0)
  })
})

describe('다이어그램 확대 — 기억하기', () => {
  const memStore = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, m }
  }
  it('열쇠 — 같은 문서 · 같은 글이면 같고, 글이나 문서가 다르면 다르다', () => {
    expect(diagramKey('a.md', 'graph LR\n A-->B')).toBe(diagramKey('a.md', 'graph LR\n A-->B'))
    expect(diagramKey('a.md', 'graph LR\n A-->B')).not.toBe(diagramKey('a.md', 'graph LR\n A-->C'))
    expect(diagramKey('a.md', 'x')).not.toBe(diagramKey('b.md', 'x'))
  })
  it('자리는 상자 크기에 대한 비율 — 상자가 커지면 같은 비율로', () => {
    const saved = toSaved({ s: 2, x: -100, y: -20 }, 400, 100)
    expect(saved).toEqual([2, -0.25, -0.2])
    expect(fromSaved(saved, 800, 200)).toEqual({ s: 2, x: -200, y: -40 })
  })
  it('남기고 · 다시 읽고 · 맞춤이면 지운다', () => {
    const st = memStore()
    const key = diagramKey('docs/a.md', 'graph LR')
    saveDiagramView(key, { s: 1.5625, x: -40, y: -10 }, 400, 100, st)
    expect(loadDiagramView(key, 400, 100, st)).toEqual({ s: 1.5625, x: -40, y: -10 })
    expect(loadDiagramView(diagramKey('docs/a.md', 'graph TD'), 400, 100, st)).toEqual(FIT)
    saveDiagramView(key, FIT, 400, 100, st)
    expect(loadDiagramView(key, 400, 100, st)).toEqual(FIT)
    expect(JSON.parse(st.m.get(SAVED_KEY)!)).toEqual({})
  })
  it('최근 것만 남긴다 · 깨진 값은 맞춤', () => {
    const st = memStore()
    for (let i = 0; i < SAVED_MAX + 5; i++) saveDiagramView(`k${i}`, { s: 2, x: 0, y: 0 }, 100, 100, st)
    const all = JSON.parse(st.m.get(SAVED_KEY)!)
    expect(Object.keys(all).length).toBe(SAVED_MAX)
    expect(all.k0).toBeUndefined()
    expect(all[`k${SAVED_MAX + 4}`]).toEqual([2, 0, 0])
    st.m.set(SAVED_KEY, '{"x":[99,0,0],"y":"bad"}')
    expect(loadDiagramView('x', 100, 100, st)).toEqual(FIT)
    expect(loadDiagramView('y', 100, 100, st)).toEqual(FIT)
    st.m.set(SAVED_KEY, 'not json')
    expect(loadDiagramView('x', 100, 100, st)).toEqual(FIT)
  })
})
