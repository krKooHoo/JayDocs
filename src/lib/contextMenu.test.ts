import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  contextIds, gridContextIds, markdownContextIds, registerSpotReader, spotAt, tabContextIds, treeContextIds,
  type ContextSpot, type GridSpot, type MarkdownSpot, type TreeSpot,
} from './contextMenu'
import { PANE_COMMAND_IDS } from './paneCommands'
import { keysOf } from './commands'

/**
 * 맥락 메뉴 (ADOPT K1 · DESIGN §40). 자리 판단 함수는 순수 함수라 여기서 본다.
 * "메뉴의 모든 항목은 팔레트에도 있다" — 자리 판단 함수가 내는 id 는 모두 소스에 등록된 명령이어야 한다.
 */
const SRC = path.resolve(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

/** 소스에 등록된 명령 id (`id: '…'`) · 가져온 폴더마다의 명령(`id: \`unmount:${…}\``) 앞머리 */
function registered(): { ids: Set<string>; prefixes: string[] } {
  const ids = new Set<string>(PANE_COMMAND_IDS)
  const prefixes: string[] = []
  for (const f of ['App.tsx', 'components/Workbench.tsx', 'components/FileTree.tsx']) {
    const src = read(f)
    for (const m of src.matchAll(/\bid: '([\w:]+)'/g)) ids.add(m[1])
    for (const m of src.matchAll(/\bid: `([\w]+:)\$\{/g)) prefixes.push(m[1])
  }
  // Workbench 의 마크다운 표 명령은 표([id, op, …])로 등록한다
  for (const m of read('components/Workbench.tsx').matchAll(/\['(mdTable\w+)'/g)) ids.add(m[1])
  return { ids, prefixes }
}

const grid = (o: Partial<GridSpot> = {}): GridSpot => ({ zone: 'grid', title: 'a.tsv · A1', editing: false, readOnly: false, empty: false, wholeCols: false, ...o })
const tree = (o: Partial<TreeSpot> = {}): TreeSpot => ({ zone: 'tree', title: 'a.md', path: 'a.md', isDir: false, mountAlias: null, isMountRoot: false, fileMount: false, writable: true, ...o })
const md = (o: Partial<MarkdownSpot> = {}): MarkdownSpot => ({ zone: 'md', title: 'a.md', markdown: true, json: false, readOnly: false, mode: 'source', table: false, link: null, tsvView: null, mermaid: false, ...o })

/** 자리마다 나올 수 있는 경우를 넓게 */
const SPOTS: ContextSpot[] = [
  grid(), grid({ wholeCols: true }), grid({ empty: true }), grid({ readOnly: true }),
  tree(), tree({ isDir: true, path: 'docs', title: 'docs' }), tree({ path: '', isDir: true }),
  tree({ path: '@Lib', isDir: true, mountAlias: 'Lib', isMountRoot: true }), tree({ path: '@Lib/x.md', mountAlias: 'Lib', writable: false }),
  md(), md({ mode: 'hybrid', table: true, link: 'b.md', tsvView: 'c.tsv', mermaid: true }), md({ markdown: false, json: true }), md({ readOnly: true, table: true }),
  { zone: 'tab', title: 'a.md', path: 'a.md' }, { zone: 'tab', title: 'x', path: null }, { zone: 'app', title: 'JayDocs' },
]

describe('자리 판단 함수', () => {
  it('메뉴의 모든 항목은 팔레트에도 있다 — 등록부에 있는 명령 id 만 낸다', () => {
    const { ids, prefixes } = registered()
    for (const s of SPOTS) {
      for (const id of contextIds(s)) {
        const ok = ids.has(id) || prefixes.some((p) => id.startsWith(p))
        expect(ok, `${s.zone}: 등록되지 않은 명령 ${id}`).toBe(true)
      }
    }
  })

  it('같은 자리에서 같은 명령이 두 번 나오지 않는다', () => {
    for (const s of SPOTS) {
      const list = contextIds(s)
      expect(new Set(list).size, `${s.zone} ${list.join(',')}`).toBe(list.length)
    }
  })

  it('그리드 — 편집 중이면 메뉴가 없다 (Alt+Enter 는 칸 안 줄바꿈)', () => {
    expect(gridContextIds(grid({ editing: true }))).toEqual([])
  })

  it('그리드 — 열 전체를 골랐으면 열 명령이 먼저, 아니면 행 명령이 먼저', () => {
    expect(gridContextIds(grid()).slice(0, 2)).toEqual(['gridRowAbove', 'gridRowBelow'])
    expect(gridContextIds(grid({ wholeCols: true })).slice(0, 3)).toEqual(['gridColLeft', 'gridColRight', 'gridColDel'])
  })

  it('그리드 — 빈 표는 타입 행 · 머리글 만들기가 맨 위, 채우기는 없다', () => {
    const ids = gridContextIds(grid({ empty: true }))
    expect(ids[0]).toBe('gridSeedHeader')
    expect(ids).not.toContain('gridFillDown')
  })

  it('읽기 전용이면 고치는 명령을 뺀다 (찾기 · 계산식 파일 · 내보내기는 남는다)', () => {
    const ids = gridContextIds(grid({ readOnly: true }))
    expect(ids).not.toContain('gridRowBelow')
    expect(ids).not.toContain('revertToSaved')
    expect(ids).toContain('gridFind')
    expect(ids).toContain('exportDto')
    expect(markdownContextIds(md({ readOnly: true, table: true }))).not.toContain('mdTableRowBelow')
  })

  it('파일 트리 — 예전 Shift+F10 메뉴의 항목 + 오른쪽 창에 열기', () => {
    expect(treeContextIds(tree())).toEqual(['openTreeCursorSide', 'quickLook', 'treeRename', 'treeCopyPath', 'newFile', 'newFolder', 'treeDelete', 'treeFilter', 'treeFilterDirty'])
    // 가져온 폴더의 루트: 상세 경로 · 읽기 전용 · 새로 고침 · 해제. 이름 바꾸기 · 삭제는 없다
    const root = treeContextIds(tree({ path: '@Lib', isDir: true, mountAlias: 'Lib', isMountRoot: true }))
    expect(root).toEqual(expect.arrayContaining(['editRoot:Lib', 'toggleReadOnly:Lib', 'refreshTree', 'unmount:Lib']))
    expect(root).not.toContain('treeDelete')
    // 주 폴더 루트 (빈 자리)
    expect(treeContextIds(tree({ path: '', isDir: true }))).toEqual(expect.arrayContaining(['newFile', 'newFolder', 'editRoot', 'copyRootPath']))
    // 읽기 전용으로 가져온 폴더 안: 만들기 · 이름 바꾸기 · 삭제 없음
    const ro = treeContextIds(tree({ path: '@Lib/x.md', mountAlias: 'Lib', writable: false }))
    expect(ro).not.toContain('treeRename')
    expect(ro).not.toContain('newFile')
    // 파일 하나만 가져온 곳의 루트: 새 파일 · 새 폴더 없음
    expect(treeContextIds(tree({ path: '@One', isDir: true, mountAlias: 'One', isMountRoot: true, fileMount: true }))).not.toContain('newFile')
  })

  it('마크다운 — 자리(표 · 링크 · tsv-view)의 명령이 먼저, 지금 보기 모드는 빼고, 문서 어디서나가 끝', () => {
    const ids = markdownContextIds(md({ mode: 'hybrid', table: true, link: 'b.md', tsvView: 'c.tsv' }))
    expect(ids.slice(0, 7)).toEqual(['mdTableRowBelow', 'mdTableColRight', 'mdTableDeleteRow', 'mdTableDeleteCol', 'openLinkAtCursor', 'openLinkAtCursorSide', 'openTsvViewGrid'])
    expect(ids).not.toContain('viewHybrid')
    expect(ids).toContain('viewSource')
    expect(ids).toContain('focusOutline')
    expect(ids.slice(-3)).toEqual(['copyActivePath', 'convertUtf8', 'saveAsTemplate'])
    // 표 · 링크가 아닌 자리에는 그 명령이 없다
    expect(markdownContextIds(md())).not.toContain('mdTableRowBelow')
    expect(markdownContextIds(md())).not.toContain('openLinkAtCursor')
    // 글 문서(.json)는 보기 모드가 없고 정렬이 있다
    const json = markdownContextIds(md({ markdown: false, json: true }))
    expect(json).toContain('formatJson')
    expect(json).not.toContain('viewSource')
  })

  it('탭 — 닫기 · 다른 탭 닫기 · 분할', () => {
    expect(tabContextIds({ zone: 'tab', title: 'a', path: 'a.md' }).slice(0, 3)).toEqual(['closeTab', 'closeOtherTabs', 'split'])
  })

  it('항목 옆 단축키는 단축키 표에서 (창이 직접 받는 키는 palette 로)', () => {
    expect(keysOf('contextMenu')).toBe('Alt+Enter')
    expect(keysOf('treeRename')).toBe('F2')
    expect(keysOf('treeDelete')).toBe('Delete')
    expect(keysOf('quickLook')).toBe('Space')
    expect(keysOf('gridFillDown')).toBe('Ctrl+D')
    expect(keysOf('openTreeCursorSide')).toBe('Ctrl+Enter')
  })
})

describe('자리 읽기', () => {
  /** DOM 없이 — parentElement 만 있는 가짜 요소 */
  const node = (parent: Element | null = null) => ({ parentElement: parent }) as unknown as Element

  it('요소에서 위로 올라가며 처음 만난 영역의 자리. 읽기 함수가 null 이면 더 위로', () => {
    const root = node()
    const pane = node(root)
    const leaf = node(pane)
    const offRoot = registerSpotReader(root, () => ({ zone: 'tab', title: 't', path: null }))
    const offPane = registerSpotReader(pane, () => null)
    expect(spotAt(leaf).zone).toBe('tab')
    offPane()
    const off2 = registerSpotReader(pane, () => tree())
    expect(spotAt(leaf).zone).toBe('tree')
    off2()
    offRoot()
    expect(spotAt(leaf).zone).toBe('app')
    expect(spotAt(null).zone).toBe('app')
  })
})
