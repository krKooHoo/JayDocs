import { describe, expect, it } from 'vitest'
import { droppedFolders } from './folderDrop'
import { previewSummary } from '../components/FolderPreviewList'

/** 탐색기에서 끌어 온 항목 흉내 — 브라우저는 놓은 뒤에야 폴더인지 알려 준다 */
const item = (name: string, isDirectory: boolean, opts: { kind?: string; noHandle?: boolean } = {}) => ({
  kind: opts.kind ?? 'file',
  webkitGetAsEntry: () => ({ isDirectory }),
  ...(opts.noHandle ? {} : { getAsFileSystemHandle: async () => ({ kind: isDirectory ? 'directory' : 'file', name }) }),
})
const drop = (items: unknown[]) => ({ dataTransfer: { items, types: ['Files'] } }) as unknown as DragEvent

describe('끌어다 놓은 폴더', () => {
  it('폴더만 고른다 (파일 · 글자는 뺀다)', async () => {
    const dirs = await droppedFolders(drop([item('a.md', false), item('수업자료', true), item('글', false, { kind: 'string' }), item('제출물', true)]))
    expect(dirs?.map((d) => d.name)).toEqual(['수업자료', '제출물'])
  })

  it('폴더가 없으면 null — 파일만 놓은 것은 건드리지 않는다', () => {
    expect(droppedFolders(drop([item('a.md', false), item('b.tsv', false)]))).toBeNull()
    expect(droppedFolders(drop([]))).toBeNull()
    expect(droppedFolders({ dataTransfer: null } as unknown as DragEvent)).toBeNull()
  })

  it('핸들을 주지 않는 브라우저에서는 null', () => {
    expect(droppedFolders(drop([item('수업자료', true, { noHandle: true })]))).toBeNull()
  })
})

describe('폴더 미리보기의 요약', () => {
  it('형식 표의 순서로 수를 적는다', () => {
    expect(previewSummary({ files: ['a.md', 'b.md', 'c.json', 'd.tsv'], byExt: { '.json': 1, '.md': 2, '.tsv': 1 }, truncated: false })).toBe('문서 4개 — 마크다운 2 · TSV 표 1 · JSON 1')
  })
  it('다 훑지 못했으면 "이상"', () => {
    expect(previewSummary({ files: ['a.md'], byExt: { '.md': 1 }, truncated: true })).toBe('문서 1개 이상 — 마크다운 1')
  })
  it('문서가 없으면 빈 글', () => {
    expect(previewSummary({ files: [], byExt: {}, truncated: false })).toBe('')
  })
})
