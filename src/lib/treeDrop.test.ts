import { describe, expect, it } from 'vitest'
import { dropZone, droppedHandles } from './treeDrop'

/** 탐색기에서 끌어 온 항목 흉내 — 브라우저는 놓은 뒤에야 핸들을 준다 */
const item = (name: string, kind: 'file' | 'directory', opts: { itemKind?: string; noHandle?: boolean } = {}) => ({
  kind: opts.itemKind ?? 'file',
  ...(opts.noHandle ? {} : { getAsFileSystemHandle: async () => ({ kind, name }) }),
})
const drop = (items: unknown[]) => ({ dataTransfer: { items, types: ['Files'] } }) as unknown as DragEvent
/** closest(selector) 가 그 선택자에만 걸리는 요소 흉내 */
const inside = (...selectors: string[]) => ({ closest: (s: string) => (selectors.includes(s) ? {} : null) }) as unknown as Element

describe('끌어다 놓기 (DESIGN §28)', () => {
  it('놓는 곳 — 트리 · 편집기 · 그 밖', () => {
    expect(dropZone(inside('.tree'))).toBe('tree')
    expect(dropZone(inside('.cm-editor'))).toBe('editor')
    expect(dropZone(inside())).toBe('elsewhere')
    expect(dropZone(null)).toBe('elsewhere')
  })

  it('파일 · 폴더의 핸들을 놓은 순서대로 (글자 끌기는 뺀다)', async () => {
    const hs = await droppedHandles(drop([item('a.md', 'file'), item('글', 'file', { itemKind: 'string' }), item('수업자료', 'directory')]))
    expect(hs?.map((h) => [h.kind, h.name])).toEqual([['file', 'a.md'], ['directory', '수업자료']])
  })

  it('핸들을 주지 않는 브라우저 · 빈 drop 은 null', () => {
    expect(droppedHandles(drop([item('a.md', 'file', { noHandle: true })]))).toBeNull()
    expect(droppedHandles(drop([]))).toBeNull()
    expect(droppedHandles({ dataTransfer: null } as unknown as DragEvent)).toBeNull()
  })
})
