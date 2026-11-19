import { describe, expect, it } from 'vitest'
import { applyChanges, bakeMarkdown, bakeTargets, findTsvViewFences, renderPipeTable, stripBaked, stripBakedWithLines } from './bake'
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
  it('where 가 틀리면 그 펜스는 건너뛰고 기존 baked 표를 그대로 둔다 (걸러지지 않은 표를 쓰지 않는다)', () => {
    const old = '<!-- tsv-view:baked -->\n| Key |\n| --- |\n| A |\n<!-- /tsv-view -->'
    const md = `\`\`\`tsv-view\nfile: X_Table.tsv\nwhere: Cost >\nbake: true\n\`\`\`\n${old}\n`
    const r = bakeMarkdown(md, 'doc.md', resolve)
    expect(r.changes).toEqual([])
    expect(r.count).toBe(0)
    expect(r.errors.length).toBe(1)
    expect(r.errors[0]).toContain('where:')
    expect(r.errors[0]).toContain('X_Table.tsv')
    // baked 블록이 아직 없을 때도 아무것도 넣지 않는다
    const fresh = bakeMarkdown('```tsv-view\nfile: X_Table.tsv\nwhere: Terrain == \nbake: true\n```\n', 'doc.md', resolve)
    expect(fresh.changes).toEqual([])
    expect(fresh.errors[0]).toContain('where:')
  })
  it('한글 열 이름 where 로 bake', () => {
    const kt = parseTsv('#string\tenum\tbyte\n키\t지형\t비용\nA\t산\t9\nB\t언덕\t3\n')
    const ks = deriveSchema(kt, 'K_Table.tsv', [])
    const r = bakeMarkdown('```tsv-view\nfile: K_Table.tsv\nwhere: 지형 == "산"\nbake: true\n```\n', 'doc.md', () => ({ table: kt, schema: ks }))
    expect(r.errors).toEqual([])
    const out = applyChanges('```tsv-view\nfile: K_Table.tsv\nwhere: 지형 == "산"\nbake: true\n```\n', r.changes)
    expect(out).toContain('| A | 산 | 9 |')
    expect(out).not.toContain('| B |')
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

describe('걷어 낸 글의 줄 → 원문 줄 (PLAN-skim SK5)', () => {
  const BAKED = '<!-- tsv-view:baked -->\n| a |\n| - |\n<!-- /tsv-view -->'
  /** 지도가 맞는지: 걷어 낸 글의 줄마다, 가리키는 원문 줄이 그 줄로 시작해야 한다 */
  const check = (src: string) => {
    const r = stripBakedWithLines(src)
    expect(r.text).toBe(stripBaked(src))
    const stripped = r.text.split('\n')
    const original = src.split('\n')
    expect(r.lines.length).toBe(stripped.length)
    stripped.forEach((l, i) => {
      const from = original[r.lines[i] - 1]
      // 닫는 표식과 같은 줄에 남은 글은 그 줄의 끝부분이다
      expect(from.startsWith(l) || from.endsWith(l)).toBe(true)
    })
    return r
  }

  it('baked 블록이 없으면 그대로', () => {
    expect(stripBakedWithLines('')).toEqual({ text: '', lines: [1] })
    expect(stripBakedWithLines('a\nb\n')).toEqual({ text: 'a\nb\n', lines: [1, 2, 3] })
  })
  it('블록 뒤의 줄은 걷어 낸 줄 수만큼 밀린다', () => {
    const r = check(`x\n${BAKED}\ny\nz`)
    expect(r.text).toBe('x\ny\nz')
    expect(r.lines).toEqual([1, 6, 7])
  })
  it('펜스 + baked 블록이 둘 — 뒤로 갈수록 더 밀린다', () => {
    const src = ['# 제목', '', '```tsv-view', 'file: a.tsv', 'bake: true', '```', ...BAKED.split('\n'), '', '가운데', '', '```tsv-view', 'file: b.tsv', 'bake: true', '```', ...BAKED.split('\n'), '', '끝'].join('\n')
    const r = check(src)
    // 걷어 낸 글: 1 제목 · 3~6 펜스 · 7 빈 줄 · 8 가운데 · 10~13 펜스 · 14 빈 줄 · 15 끝
    expect(r.lines[7]).toBe(12) // 가운데
    expect(r.lines[9]).toBe(14) // 두 번째 펜스의 ```
    expect(r.lines[14]).toBe(23) // 끝
  })
  it('빈 줄 뒤의 블록 · 글의 맨 처음 블록 · CRLF', () => {
    expect(check(`a\n\n${BAKED}\nb`).lines).toEqual([1, 2, 7])
    expect(check(`${BAKED}\nb`).lines).toEqual([4, 5])
    const crlf = `x\r\n${BAKED.replace(/\n/g, '\r\n')}\r\ny`
    // CRLF 는 `\n` 만 걷혀 `\r` 이 남는다(stripBaked 의 원래 동작) — 줄 수는 `\n` 으로 세어 2줄. 그리는 쪽(DocView)은 먼저 LF 로 맞춘다
    expect(stripBakedWithLines(crlf).text).toBe(stripBaked(crlf))
    expect(stripBakedWithLines(crlf).lines).toEqual([1, 6])
  })
  it('닫히지 않은 블록은 걷지 않는다', () => {
    const src = 'a\n<!-- tsv-view:baked -->\n| a |\nb'
    expect(stripBakedWithLines(src)).toEqual({ text: src, lines: [1, 2, 3, 4] })
  })
})
