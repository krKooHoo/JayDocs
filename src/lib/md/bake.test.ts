import { describe, expect, it } from 'vitest'
import { applyChanges, bakeMarkdown, bakeTargets, findTsvViewFences, renderPipeTable, stripBaked } from './bake'
import { parseTsv } from '../tsv/parse'
import { deriveSchema } from '../tsv/schema'
import { parseTsvViewSpec } from './tsvView'

const table = parseTsv('#string\tenum\tbyte\t\nKey\tTerrain\tCost\t#메모\nA\tPeak\t9\tm\nB|x\tHill\t3\t\n')
const schema = deriveSchema(table, 'X_Table.tsv', [])
const resolve = (file: string) => (file === 'X_Table.tsv' ? { table, schema } : null)

describe('펜스 찾기', () => {
  it('여러 펜스 · baked 블록 감지', () => {
    const md = '# 제목\n\n```tsv-view\nfile: X_Table.tsv\nbake: true\n```\n<!-- tsv-view:baked -->\n| a |\n<!-- /tsv-view -->\n\n```tsv-view\nfile: y.tsv\n```\n끝'
    const f = findTsvViewFences(md)
    expect(f.length).toBe(2)
    expect(f[0].spec.bake).toBe(true)
    expect(f[0].baked).not.toBeNull()
    expect(md.slice(f[0].baked!.from, f[0].baked!.to)).toBe('<!-- tsv-view:baked -->\n| a |\n<!-- /tsv-view -->')
    expect(md.slice(f[0].from, f[0].to)).toBe('```tsv-view\nfile: X_Table.tsv\nbake: true\n```')
    expect(f[1].baked).toBeNull()
    expect(f[1].spec.file).toBe('y.tsv')
  })
  it('닫히지 않은 펜스 · CRLF', () => {
    expect(findTsvViewFences('```tsv-view\nfile: a\n').length).toBe(0)
    const f = findTsvViewFences('```tsv-view\r\nfile: a.tsv\r\n```\r\nx')
    expect(f.length).toBe(1)
    expect(f[0].spec.file).toBe('a.tsv')
  })
})

describe('파이프 표', () => {
  it('열 · 정렬 표식 · | 이스케이프 · 주석 열 제외', () => {
    const { markdown, error } = renderPipeTable(parseTsvViewSpec('file: X_Table.tsv\nsort: Key'), table, schema)
    expect(error).toBeNull()
    expect(markdown).toBe('| Key | Terrain | Cost |\n| --- | --- | ---: |\n| A | Peak | 9 |\n| B\\|x | Hill | 3 |')
  })
})

describe('bake', () => {
  it('새로 넣기 → 다시 저장하면 변경 없음 → 표가 바뀌면 교체', () => {
    const md = '위\n\n```tsv-view\nfile: X_Table.tsv\nbake: true\n```\n\n아래'
    const r1 = bakeMarkdown(md, 'doc.md', resolve)
    expect(r1.count).toBe(1)
    expect(r1.errors).toEqual([])
    expect(r1.changes.length).toBe(1)
    const baked = applyChanges(md, r1.changes)
    expect(baked).toBe('위\n\n```tsv-view\nfile: X_Table.tsv\nbake: true\n```\n<!-- tsv-view:baked -->\n| Key | Terrain | Cost |\n| --- | --- | ---: |\n| A | Peak | 9 |\n| B\\|x | Hill | 3 |\n<!-- /tsv-view -->\n\n아래')
    const r2 = bakeMarkdown(baked, 'doc.md', resolve)
    expect(r2.changes.length).toBe(0)
    const table2 = parseTsv('#string\tenum\tbyte\t\nKey\tTerrain\tCost\t#메모\nA\tPeak\t10\tm\n')
    const r3 = bakeMarkdown(baked, 'doc.md', () => ({ table: table2, schema: deriveSchema(table2, 'X_Table.tsv', []) }))
    expect(r3.changes.length).toBe(1)
    expect(applyChanges(baked, r3.changes)).toContain('| A | Peak | 10 |')
    expect(applyChanges(baked, r3.changes)).not.toContain('| B\\|x')
  })
  it('bake 가 아니면 건드리지 않고, 못 읽으면 오류만', () => {
    expect(bakeMarkdown('```tsv-view\nfile: X_Table.tsv\n```', 'doc.md', resolve).changes.length).toBe(0)
    const r = bakeMarkdown('```tsv-view\nfile: nope.tsv\nbake: true\n```', 'doc.md', resolve)
    expect(r.changes.length).toBe(0)
    expect(r.errors[0]).toContain('nope.tsv')
  })
  it('CRLF 문서에는 CRLF 로', () => {
    const md = '```tsv-view\r\nfile: X_Table.tsv\r\nbake: true\r\n```\r\n'
    const r = bakeMarkdown(md, 'doc.md', resolve, '\r\n')
    expect(r.changes[0].insert.startsWith('\r\n<!-- tsv-view:baked -->\r\n| Key')).toBe(true)
  })
  it('대상 파일 · 미리보기용 제거', () => {
    expect(bakeTargets('```tsv-view\nfile: ./X_Table.tsv\nbake: true\n```', 'a/doc.md')).toEqual(['a/X_Table.tsv'])
    expect(stripBaked('x\n<!-- tsv-view:baked -->\n| a |\n<!-- /tsv-view -->\ny')).toBe('x\ny')
  })
})
