import { describe, expect, it } from 'vitest'
import { SHORTCUTS } from './shortcuts-table.mjs'
import { displayKeys, hintFooter, hintPlace, keyHints, MAX_HINTS, PLACE_TITLE, type HintPlace } from './keyHints'
import type { ContextSpot, GridSpot, MarkdownSpot, TreeSpot } from './contextMenu'

/** 단축키 안내 창 (ADOPT K7 · DESIGN §46) — 자리 → 자주 쓰는 키. 자리 판단은 K1 맥락 메뉴의 것 */

const grid = (o: Partial<GridSpot> = {}): GridSpot => ({ zone: 'grid', title: 'a.tsv · A1', editing: false, readOnly: false, empty: false, wholeCols: false, ...o })
const md = (o: Partial<MarkdownSpot> = {}): MarkdownSpot => ({
  zone: 'md', title: 'a.md', markdown: true, json: false, readOnly: false, mode: 'hybrid', table: false, link: null, tsvView: null, mermaid: false, ...o,
})
const tree = (o: Partial<TreeSpot> = {}): TreeSpot => ({
  zone: 'tree', title: 'a.md', path: 'a.md', isDir: false, mountAlias: null, isMountRoot: false, fileMount: false, writable: true, ...o,
})
const keysAt = (place: HintPlace, spot: ContextSpot) => keyHints(place, spot).map((h) => h.keys)

describe('단축키 표의 hint', () => {
  const places = new Set(Object.keys(PLACE_TITLE))
  const rows = SHORTCUTS.flatMap((g) => g.items).filter((s) => s.hint)

  it('at 은 아는 자리, when 은 아는 조건, 이름은 짧다', () => {
    for (const s of rows) {
      const at = typeof s.hint!.at === 'string' ? [s.hint!.at] : s.hint!.at
      for (const p of at) expect(places.has(p), `${s.keys} → ${p}`).toBe(true)
      if (s.hint!.when) expect(['markdown', 'hybrid', 'mermaid', 'writable']).toContain(s.hint!.when)
      expect(s.hint!.label.length, s.keys).toBeLessThanOrEqual(24)
    }
  })

  it('모든 자리에 줄이 있다', () => {
    const spots: [HintPlace, ContextSpot][] = [
      ['app', { zone: 'app', title: 'JayDocs' }], ['tab', { zone: 'tab', title: 'a.md', path: 'a.md' }],
      ['tree', tree()], ['quickLook', tree()], ['folderGrid', tree()], ['pathBar', md()], ['outline', md()],
      ['md', md()], ['mdTable', md({ table: true })], ['mdPreview', md({ mode: 'preview' })],
      ['grid', grid()], ['gridCols', grid({ wholeCols: true })], ['gridEdit', grid({ editing: true })],
    ]
    for (const [p, s] of spots) {
      const items = keyHints(p, s)
      expect(items.length, p).toBeGreaterThanOrEqual(3)
      expect(items.length, p).toBeLessThanOrEqual(MAX_HINTS)
      expect(new Set(items.map((h) => h.keys)).size, p).toBe(items.length)
    }
  })
})

describe('자리', () => {
  it('좁은 자리가 영역보다 먼저', () => {
    expect(hintPlace(md(), 'pathBar')).toBe('pathBar')
    expect(hintPlace(md(), 'outline')).toBe('outline')
    expect(hintPlace(tree(), 'folderGrid')).toBe('folderGrid')
    expect(hintPlace(tree(), 'quickLookOpen')).toBe('quickLook')
    expect(hintPlace(tree(), null)).toBe('tree')
  })
  it('그리드 — 편집 중 · 열 전체', () => {
    expect(hintPlace(grid(), null)).toBe('grid')
    expect(hintPlace(grid({ editing: true }), null)).toBe('gridEdit')
    expect(hintPlace(grid({ wholeCols: true }), null)).toBe('gridCols')
  })
  it('마크다운 — 표 칸 · 미리보기', () => {
    expect(hintPlace(md({ table: true }), null)).toBe('mdTable')
    expect(hintPlace(md({ mode: 'preview' }), null)).toBe('mdPreview')
    expect(hintPlace(md({ mode: 'split' }), 'preview')).toBe('mdPreview')
    expect(hintPlace(md({ mode: 'split' }), null)).toBe('md')
  })
})

describe('자리의 키', () => {
  it('그리드 — 행 넣기 · 옮기기 · 찾기, 읽기 전용이면 고치는 키를 뺀다', () => {
    expect(keysAt('grid', grid())).toEqual(expect.arrayContaining(['Enter · F2', 'Ctrl+Alt+=', 'Ctrl+Alt+-', 'Alt+↑ / ↓', 'Ctrl+F']))
    const ro = keysAt('grid', grid({ readOnly: true }))
    expect(ro).toContain('Ctrl+F')
    for (const k of ['Enter · F2', 'Ctrl+Alt+=', 'Alt+↑ / ↓', 'Ctrl+D', 'Ctrl+H']) expect(ro).not.toContain(k)
  })
  it('열을 골랐으면 Ctrl+Alt+= 는 열 넣기 (한 번만)', () => {
    const items = keyHints('gridCols', grid({ wholeCols: true }))
    expect(items.filter((h) => h.keys === 'Ctrl+Alt+=')).toEqual([{ keys: 'Ctrl+Alt+=', label: '오른쪽에 열 넣기' }])
  })
  it('셀 편집 중 — 확정 · 취소 · 칸 안 줄바꿈, 맨 아래에 Alt+Enter 메뉴가 없다', () => {
    expect(keysAt('gridEdit', grid({ editing: true }))).toEqual(expect.arrayContaining(['Enter / Shift+Enter', 'Esc', 'Alt+Enter']))
    const foot = hintFooter('gridEdit').map((h) => h.keys)
    expect(foot).toEqual(['F1'])
    expect(hintFooter('grid').map((h) => h.keys)).toEqual(['Alt+Enter', 'F1'])
  })
  it('마크다운 — 하이브리드만 목차, .txt 는 보기 모드가 없다', () => {
    expect(keysAt('md', md())).toContain('Ctrl+Alt+T')
    expect(keysAt('md', md({ mode: 'source' }))).not.toContain('Ctrl+Alt+T')
    const txt = keysAt('md', md({ markdown: false, mode: 'source' }))
    expect(txt).not.toContain('Ctrl+Shift+V')
    expect(txt).toContain('Ctrl+F')
  })
  it('마크다운 표 칸 — 표의 키가 먼저, 그다음 편집기', () => {
    const k = keysAt('mdTable', md({ table: true }))
    expect(k.slice(0, 3)).toEqual(['Tab / Shift+Tab', 'Ctrl+Alt+=', 'Ctrl+Alt+-'])
    expect(k).toContain('Ctrl+F')
  })
  it('미리보기 — 찾기는 없고 tsv-view · 다이어그램은 그 자리일 때만', () => {
    expect(keysAt('mdPreview', md({ mode: 'preview' }))).not.toContain('Ctrl+F')
    expect(keysAt('mdPreview', md({ mode: 'preview' }))).not.toContain('Ctrl+Enter')
    expect(keysAt('mdPreview', md({ mode: 'preview', tsvView: 'a.tsv' }))).toContain('Ctrl+Enter')
    expect(keysAt('mdPreview', md({ mode: 'preview', mermaid: true }))).toContain('Ctrl+= / -')
  })
  it('트리 — 가져온 폴더의 루트 · 읽기 전용에서는 이름 바꾸기 · 삭제가 없다', () => {
    expect(keysAt('tree', tree())).toEqual(expect.arrayContaining(['Enter', 'Ctrl+Enter', 'F2', 'Delete', 'Space', 'Ctrl+F']))
    const ro = keysAt('tree', tree({ writable: false, mountAlias: 'a' }))
    expect(ro).not.toContain('F2')
    expect(ro).not.toContain('Delete')
  })
  it('전역 명령은 지금 쓸 수 없으면 뺀다', () => {
    const k = keyHints('md', md(), { available: (id) => id !== 'toggleSkim' }).map((h) => h.keys)
    expect(k).not.toContain('Ctrl+Alt+M')
  })
})

describe('키 표기', () => {
  it('끝의 자리 표기를 빼고, Mac 은 Ctrl → ⌘', () => {
    expect(displayKeys('Enter (목차)')).toBe('Enter')
    expect(displayKeys('Ctrl+Shift+P')).toBe('Ctrl+Shift+P')
    expect(displayKeys('Ctrl+Alt+=', true)).toBe('⌘+Alt+=')
  })
})
