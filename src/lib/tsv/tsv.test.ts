import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseTsv } from './parse'
import { serializeTsv } from './serialize'
import { deleteColumn, deleteRows, duplicateRow, insertColumn, insertRows, pasteBlock, setCell, setCells } from './edits'
import { parseClipboardTsv } from './clipboard'
import { parseFieldBlocks } from './field'
import { deriveSchema, isTypeRow, siblingFieldPath, tablePrefix } from './schema'
import { validateTable } from './validate'

// ---------------------------------------------------------------- 실제 파일 (SagaDocs)
// HANDOFF §5-1: SagaDocs 의 TSV 7개 왕복 = 바이트 동일. 리포 위치는 PC 마다 다르니 환경변수 또는 후보 경로에서 찾는다.
function findSagaDocs(): string | null {
  const candidates = [
    process.env.SAGADOCS,
    path.resolve(__dirname, '../../../../../SagaDocs'),
    'C:/Users/user/SagaDocs',
    'C:/Users/gaber/Documents/GitHub/SagaDocs',
  ].filter((p): p is string => !!p)
  return candidates.find((p) => fs.existsSync(path.join(p, 'README.md'))) ?? null
}

function listTsv(dir: string, out: string[] = []): string[] {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue
    const p = path.join(dir, d.name)
    if (d.isDirectory()) listTsv(p, out)
    else if (/\.tsv$/i.test(d.name)) out.push(p)
  }
  return out
}

const saga = findSagaDocs()
const sagaFiles = saga ? listTsv(saga) : []
const describeSaga = saga ? describe : describe.skip

describeSaga('SagaDocs 실제 파일 왕복', () => {
  it('TSV 파일이 7개 이상 있다', () => {
    expect(sagaFiles.length).toBeGreaterThanOrEqual(7)
  })

  for (const file of sagaFiles) {
    const name = path.relative(saga ?? '', file).replace(/\\/g, '/')
    const original = fs.readFileSync(file, 'utf8')

    it(`${name}: 그대로 (LF 입력)`, () => {
      expect(serializeTsv(parseTsv(original))).toBe(original)
    })
    it(`${name}: CRLF 입력도 그대로`, () => {
      const crlf = original.replace(/\r?\n/g, '\r\n')
      const t = parseTsv(crlf)
      expect(t.eol).toBe('\r\n')
      expect(t.mixedEol).toBe(false)
      expect(serializeTsv(t)).toBe(crlf)
    })
    it(`${name}: BOM + 끝 개행 있는 변형도 그대로`, () => {
      const variant = '\uFEFF' + original + '\n'
      const t = parseTsv(variant)
      expect(t.bom).toBe(true)
      expect(t.trailingNewline).toBe(true)
      expect(serializeTsv(t)).toBe(variant)
    })
    it(`${name}: 셀 하나 수정 → 그 줄만 바뀐다`, () => {
      const t = parseTsv(original)
      const r = Math.min(2, t.rows.length - 1)
      const edited = setCell(t, r, 0, 'ZZZ-Changed')
      const a = original.split(/\r?\n/)
      const b = serializeTsv(edited).split(/\r?\n/)
      expect(b.length).toBe(a.length)
      const diff = a.map((line, i) => (line === b[i] ? null : i)).filter((i) => i !== null)
      expect(diff).toEqual([r])
      expect(b[r].startsWith('ZZZ-Changed\t') || b[r] === 'ZZZ-Changed').toBe(true)
    })
  }
})

// ---------------------------------------------------------------- 합성 입력
describe('parse / serialize', () => {
  it('빈 파일', () => {
    const t = parseTsv('')
    expect(t.rows).toEqual([])
    expect(t.width).toBe(0)
    expect(serializeTsv(t)).toBe('')
  })
  it('개행 하나뿐인 파일 = 빈 행 하나 + 끝 개행', () => {
    const t = parseTsv('\n')
    expect(t.rows.length).toBe(1)
    expect(t.trailingNewline).toBe(true)
    expect(serializeTsv(t)).toBe('\n')
  })
  it('마지막 빈 줄 보존', () => {
    for (const s of ['a\n\n', 'a\r\n\r\n', 'a\tb\n\t\n', 'a']) expect(serializeTsv(parseTsv(s))).toBe(s)
  })
  it('열 수가 들쭉날쭉해도 원문 유지, width 는 최대', () => {
    const s = 'a\tb\tc\nd\ne\tf\n'
    const t = parseTsv(s)
    expect(t.width).toBe(3)
    expect(serializeTsv(t)).toBe(s)
  })
  it('섞인 줄바꿈은 다수 쪽으로', () => {
    const t = parseTsv('a\r\nb\r\nc\nd')
    expect(t.eol).toBe('\r\n')
    expect(t.mixedEol).toBe(true)
    expect(serializeTsv(t)).toBe('a\r\nb\r\nc\r\nd')
  })
  it('따옴표는 해석하지 않는다', () => {
    const t = parseTsv('"a\tb"\t"c"')
    expect(t.rows[0].cells).toEqual(['"a', 'b"', '"c"'])
  })
})

describe('edits', () => {
  const src = '#string\tbyte\nKey\tN\nA\t1\nB\t2'
  const t = parseTsv(src)

  it('같은 값으로 바꾸면 같은 객체', () => {
    expect(setCell(t, 2, 1, '1')).toBe(t)
  })
  it('수정한 행만 raw 가 없어진다', () => {
    const e = setCell(t, 2, 1, '9')
    expect(e.rows[2].raw).toBeNull()
    expect(e.rows[3]).toBe(t.rows[3])
    expect(serializeTsv(e)).toBe('#string\tbyte\nKey\tN\nA\t9\nB\t2')
  })
  it('짧은 행을 수정하면 너비만큼 채운다', () => {
    const short = parseTsv('a\tb\tc\nd\n')
    const e = setCell(short, 1, 1, 'x')
    expect(serializeTsv(e)).toBe('a\tb\tc\nd\tx\t\n')
  })
  it('행 삽입 · 삭제 · 복제', () => {
    const ins = insertRows(t, 2, 1)
    expect(serializeTsv(ins)).toBe('#string\tbyte\nKey\tN\n\t\nA\t1\nB\t2')
    const del = deleteRows(ins, 2, 1)
    expect(serializeTsv(del)).toBe(src)
    const dup = duplicateRow(t, 2)
    expect(serializeTsv(dup)).toBe('#string\tbyte\nKey\tN\nA\t1\nA\t1\nB\t2')
    expect(dup.rows[2]).toBe(t.rows[2])
  })
  it('열 삽입 · 삭제는 모든 행을 다시 조립한다', () => {
    const ins = insertColumn(t, 1)
    expect(ins.width).toBe(3)
    expect(ins.rows.every((r) => r.raw === null)).toBe(true)
    expect(serializeTsv(ins)).toBe('#string\t\tbyte\nKey\t\tN\nA\t\t1\nB\t\t2')
    expect(serializeTsv(deleteColumn(ins, 1))).toBe(src)
  })
  it('표 끝 너머에 셀을 쓰면 행이 생긴다', () => {
    const e = setCells(t, [{ r: 5, c: 0, v: 'F' }])
    expect(e.rows.length).toBe(6)
    expect(serializeTsv(e)).toBe(src + '\n\t\nF\t')
  })
  it('붙여넣기: 너비를 넘는 열은 잘린다', () => {
    const { table, clippedCols, addedRows } = pasteBlock(t, 3, 1, [['x', 'y', 'z'], ['p', 'q', 'r']])
    expect(clippedCols).toBe(2)
    expect(addedRows).toBe(1)
    expect(serializeTsv(table)).toBe('#string\tbyte\nKey\tN\nA\t1\nB\tx\n\tp')
  })
})

describe('clipboard', () => {
  it('Sheets 형식(CRLF + 끝 개행)', () => {
    expect(parseClipboardTsv('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']])
  })
  it('한 셀', () => {
    expect(parseClipboardTsv('x')).toEqual([['x']])
    expect(parseClipboardTsv('')).toEqual([['']])
  })
})

describe('schema', () => {
  it('타입 행 판정', () => {
    expect(isTypeRow(['#string', 'enum', '', 'bool'])).toBe(true)
    expect(isTypeRow(['#String', 'Enum'])).toBe(true)
    expect(isTypeRow(['#헥스타일의 설명', ''])).toBe(false)
    expect(isTypeRow(['Key', 'Name'])).toBe(false)
    expect(isTypeRow(['#string', 'what'])).toBe(false)
  })
  it('이름 짝짓기', () => {
    expect(tablePrefix('10-World/Tile/Tile_Table.tsv')).toBe('Tile')
    expect(siblingFieldPath('10-World/Tile/Tile_Table.tsv')).toBe('10-World/Tile/Tile_Field.tsv')
    expect(siblingFieldPath('Foo.tsv')).toBe('Foo_Field.tsv')
  })
  it('타입 · 주석 열 · Key · enum(열 값 대체) · 리스트', () => {
    const t = parseTsv('#string\tstring\t\tenum\tbool\tbyte\nKey\tName\t#메모\tTerrain\tOn\tN\nA\tx\tm\tPlains, Hill\tTRUE\t3\nB\ty\t\tHill\tFALSE\t9')
    const s = deriveSchema(t, 'X_Table.tsv', [])
    expect(s.typed).toBe(true)
    expect(s.headerRows).toBe(2)
    expect(s.columns.map((c) => c.type)).toEqual(['string', 'string', 'comment', 'enum', 'bool', 'byte'])
    expect(s.columns[0].isKey).toBe(true)
    expect(s.columns[3].list).toBe(true)
    expect(s.columns[3].enumSource).toBe('column')
    expect(s.columns[3].enumValues).toEqual(['Hill', 'Plains'])
  })
  it('Field 블록에서 설명과 enum 후보', () => {
    const field = parseFieldBlocks('X_Field.tsv', parseTsv('XDef\t설명\tNote\nKey\t고유 키\t메모\nTerrain\t지형\t\n\t\t\nTerrain\t설명\nPlains\t평지\nHill\t언덕\n'))
    expect(field.blocks.map((b) => b.name)).toEqual(['XDef', 'Terrain'])
    const t = parseTsv('#string\tenum\nKey\tTerrain\nA\tPlains\nB\tSwamp')
    const s = deriveSchema(t, 'X_Table.tsv', [field])
    expect(s.defBlock).toEqual({ file: 'X_Field.tsv', name: 'XDef' })
    expect(s.columns[0].description).toBe('고유 키')
    expect(s.columns[0].notes).toEqual([{ label: 'Note', text: '메모' }])
    expect(s.columns[1].enumSource).toBe('field')
    expect(s.columns[1].enumValues).toEqual(['Plains', 'Hill'])
    const v = validateTable(t, s)
    expect(v.count).toBe(1)
    expect([...v.issues.values()][0]).toContain('Swamp')
  })
  it('타입 행이 없으면 스키마 없음', () => {
    const s = deriveSchema(parseTsv('TileDef\t설명\nKey\t키'), 'Tile_Field.tsv', [])
    expect(s.typed).toBe(false)
    expect(s.headerRows).toBe(0)
  })
})

describe('validate', () => {
  it('타입 검사와 Key 중복', () => {
    const t = parseTsv('#string\tbyte\tuint\tfloat\tbool\nKey\tB\tU\tF\tO\nA\t300\t-1\tx\tyes\nA\t\t\t1.5\tTRUE\n\t\t\t\t')
    const s = deriveSchema(t, 'X_Table.tsv', [])
    const v = validateTable(t, s)
    const msgs = [...v.issues.values()]
    expect(msgs.some((m) => m.includes('255'))).toBe(true)
    expect(msgs.some((m) => m.includes('정수'))).toBe(true)
    expect(msgs.some((m) => m.includes('숫자'))).toBe(true)
    expect(msgs.some((m) => m.includes('TRUE'))).toBe(true)
    expect(msgs.filter((m) => m.includes('중복')).length).toBe(2)
    // 완전히 빈 행은 Key 검사에서 뺀다
    expect(msgs.some((m) => m.includes('비었'))).toBe(false)
  })
})

describeSaga('SagaDocs 스키마', () => {
  it('Tile_Table: TerrainType enum 은 Tile_Field 에서, 설명은 TileDef 에서', () => {
    const root = saga ?? ''
    const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
    const fields = ['10-World/Tile/Tile_Field.tsv', '20-Settlement/District/District_Field.tsv'].map((p) => parseFieldBlocks(p, parseTsv(read(p))))
    const t = parseTsv(read('10-World/Tile/Tile_Table.tsv'))
    const s = deriveSchema(t, '10-World/Tile/Tile_Table.tsv', fields)
    expect(s.typed).toBe(true)
    const terrain = s.columns.find((c) => c.name === 'TerrainType')
    expect(terrain?.enumSource).toBe('field')
    expect(terrain?.enumValues).toContain('Peak')
    expect(s.columns[0].description).toBeTruthy()
    expect(validateTable(t, s).count).toBe(0)

    // Building_Table 의 설명은 다른 폴더의 District_Field 안 BuildingDef 블록에서 온다 (DESIGN §14 운영 규칙)
    const b = parseTsv(read('20-Settlement/Building/Building_Table.tsv'))
    const bs = deriveSchema(b, '20-Settlement/Building/Building_Table.tsv', fields)
    expect(bs.defBlock?.name).toBe('BuildingDef')
    expect(bs.columns.find((c) => c.name === 'DistrictKey')?.description).toBeTruthy()
  })
})
