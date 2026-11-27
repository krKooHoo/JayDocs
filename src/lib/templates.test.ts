import { describe, expect, it } from 'vitest'
import { FILE_TYPES } from './filetypes.mjs'
import { blankTemplateFor, fileNameOf, newDocPath, newFolderPath,stripTypedExt, TEMPLATES, typedExt, userTemplatePaths } from './templates'
import { parseTable, serializeTable } from './tsv/table'
import { deriveSchema } from './tsv/schema'
import { validateTable } from './tsv/validate'
import { parseFieldBlocks } from './tsv/field'
import type { TreeEntry } from './backend'

const byId = (id: string) => {
  const t = TEMPLATES.find((x) => x.id === id)
  if (!t) throw new Error(`템플릿 없음: ${id}`)
  return t
}

describe('템플릿 표', () => {
  it('형식 표의 모든 형식에 빈 문서 하나 · 예시 하나 이상 (마크다운은 결론 문서 틀도 — §54)', () => {
    for (const ft of FILE_TYPES) {
      expect(TEMPLATES.filter((t) => t.ext === ft.ext && t.group === 'blank').length, ft.ext).toBe(1)
      expect(TEMPLATES.filter((t) => t.ext === ft.ext && t.group === 'sample').length, ft.ext).toBeGreaterThanOrEqual(1)
    }
    // 형식 표에 없는 확장자는 없다
    for (const t of TEMPLATES) expect(FILE_TYPES.some((ft) => ft.ext === t.ext), t.id).toBe(true)
  })

  it('id 는 유일하고 첫 항목은 빈 마크다운', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length)
    expect(TEMPLATES[0].id).toBe('blank-md')
  })

  it('LF · 끝 개행 · BOM 없음 (CSV 예시만 BOM). 빈 md · txt 는 0바이트', () => {
    for (const t of TEMPLATES) {
      expect(t.body.includes('\r'), t.id).toBe(false)
      if (t.body !== '') expect(t.body.endsWith('\n'), t.id).toBe(true)
      expect(t.body.startsWith('﻿'), t.id).toBe(t.id === 'sample-csv')
    }
    expect(byId('blank-md').body).toBe('')
    expect(byId('blank-txt').body).toBe('')
    expect(byId('blank-json').body).toBe('{}\n')
  })

  it('빈 표는 그리드의 빈 표 버튼이 만드는 것과 같은 가장 작은 표', () => {
    expect(byId('blank-tsv').body).toBe('#string\tstring\nKey\t\n\t\n')
    expect(byId('blank-csv').body).toBe(',,\n,,\n')
    const tsv = parseTable(byId('blank-tsv').body, '새 문서.tsv')
    const schema = deriveSchema(tsv, '새 문서.tsv', [])
    expect([schema.typed, schema.headerRows, tsv.rows.length]).toEqual([true, 2, 3])
    expect(schema.columns[0].isKey).toBe(true)
    const csv = parseTable(byId('blank-csv').body, '새 문서.csv')
    expect([csv.rows.length, csv.width]).toEqual([2, 3])
  })

  it('TSV 예시는 §2 계약대로 읽힌다 — 타입 행 · 머리글 · Key 유일 · 검증 오류 없음', () => {
    const path = '예시.tsv'
    const t = parseTable(byId('sample-tsv').body, path)
    const schema = deriveSchema(t, path, [])
    expect(schema.typed).toBe(true)
    expect(schema.headerRows).toBe(2)
    expect(schema.columns.map((c) => c.name)).toEqual(['Key', 'DisplayName', 'FoodGroup', 'Enabled', 'Count', 'Rate', '#메모'])
    expect(schema.columns.map((c) => c.type)).toEqual(['string', 'string', 'enum', 'bool', 'uint', 'float', 'comment'])
    expect(schema.columns[0].isKey).toBe(true)
    const keys = t.rows.slice(2).map((r) => r.cells[0])
    expect(new Set(keys).size).toBe(keys.length)
    expect(validateTable(t, schema).count).toBe(0)
    expect(serializeTable(t)).toBe(byId('sample-tsv').body)
  })

  it('TSV 예시의 enum 열은 흔한 Field 블록(Category · Type …)과 이름이 겹치지 않는다', () => {
    // enum 후보는 같은 루트의 모든 _Field 파일에서 열 이름으로 찾는다 — 겹치면 예시 값이 검증 오류가 된다
    const field = parseTable('Category\t설명\nWeapon\t무기\n\nType\t설명\nA\t가\n', 'data/Item_Field.tsv')
    const fields = [parseFieldBlocks('data/Item_Field.tsv', field)]
    const t = parseTable(byId('sample-tsv').body, '예시.tsv')
    expect(validateTable(t, deriveSchema(t, '예시.tsv', fields)).count).toBe(0)
  })

  it('CSV 예시는 왕복된다 (읽고 다시 쓰면 같은 글)', () => {
    const body = byId('sample-csv').body
    const t = parseTable(body, '예시.csv')
    expect(t.format).toBe('csv')
    expect(t.bom).toBe(true)
    expect(t.rows[0].cells).toEqual(['이름', '분류', '수량', '메모'])
    expect(t.rows[1].cells[3]).toBe('쉼표, 줄바꿈이 든 칸은 따옴표로 감싼다')
    expect(t.malformedCells ?? 0).toBe(0)
    expect(serializeTable(t)).toBe(body)
  })

  it('결론 문서 — 절 순서, 번호 없는 절 제목, 링크 · 주석 안의 tsv-view 예 (§54)', () => {
    const body = byId('sample-conclusion').body
    const lines = body.split('\n')
    const h2 = lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3))
    expect(h2).toEqual(['문제 정의', '근거', '솔루션', '결론', '다음 행동'])
    expect(lines.filter((l) => l.startsWith('# '))).toHaveLength(1)
    expect(h2.some((t) => /^\d/.test(t))).toBe(false)
    expect(body).toMatch(/\[[^\]]+\]\([^)\s]+\.md\)/)
    // tsv-view 예는 ```text 블록 — 살아 있는 tsv-view 가 없는 표를 가리키면 미리보기에 오류가 뜬다. HTML 주석은 미리보기가 숨기지 않는다
    expect(body).not.toContain('```tsv-view')
    expect(body).not.toContain('<!--')
    expect(body).toMatch(/```text\nfile: [^\n]+\.tsv\n/)
  })

  it('JSON 예시 · 빈 JSON 은 문법에 맞다', () => {
    expect(() => JSON.parse(byId('sample-json').body)).not.toThrow()
    expect(JSON.parse(byId('blank-json').body)).toEqual({})
  })

  it('blankTemplateFor — 확장자(대소문자 무시)로 빈 문서', () => {
    expect(blankTemplateFor('.txt')?.id).toBe('blank-txt')
    expect(blankTemplateFor('.CSV')?.id).toBe('blank-csv')
    expect(blankTemplateFor('.png')).toBeUndefined()
  })
})

describe('이름 칸 → 경로', () => {
  it('확장자는 고른 템플릿을 따른다', () => {
    expect(newDocPath('새 문서', '.md')).toBe('새 문서.md')
    expect(newDocPath('  docs\\a/b  ', '.tsv')).toBe('docs/a/b.tsv')
    expect(newDocPath('버전.1', '.md')).toBe('버전.1.md')
  })

  it('이름 끝에 지원 확장자를 직접 치면 그것을 쓴다 (대소문자 무시)', () => {
    expect(newDocPath('메모.txt', '.md')).toBe('메모.txt')
    expect(newDocPath('표.CSV', '.md')).toBe('표.CSV')
    expect(typedExt('메모.txt')).toBe('.txt')
    expect(typedExt('표.CSV')).toBe('.csv')
    expect(typedExt('그림.png')).toBeUndefined()
    expect(typedExt('새 문서')).toBeUndefined()
  })

  it('빈 칸 · / 로 끝나는 이름은 검사가 거부하게 남긴다', () => {
    expect(newDocPath('   ', '.md')).toBe('')
    expect(newDocPath('docs/', '.md')).toBe('docs/')
  })

  it('newFolderPath — / 나 \\ 로 끝나면 새 폴더 (K3)', () => {
    expect(newFolderPath('docs/새 폴더/')).toBe('docs/새 폴더')
    expect(newFolderPath(' 자료\\ ')).toBe('자료')
    expect(newFolderPath('@MyGame/Assets//')).toBe('@MyGame/Assets')
    expect(newFolderPath('/')).toBe('')
    expect(newFolderPath('docs/메모')).toBeNull()
    expect(newFolderPath('메모.txt')).toBeNull()
  })

  it('stripTypedExt — 끝의 지원 확장자만 뗀다', () => {
    expect(stripTypedExt('docs/메모.txt')).toBe('docs/메모')
    expect(stripTypedExt('메모.TXT ')).toBe('메모')
    expect(stripTypedExt('그림.png')).toBe('그림.png')
  })
})

describe('내 템플릿 (_templates/)', () => {
  const file = (path: string): TreeEntry => ({ type: 'file', name: fileNameOf(path), path })
  const tree: TreeEntry[] = [
    { type: 'dir', name: 'docs', path: 'docs', children: [file('docs/a.md')] },
    {
      type: 'dir', name: '_Templates', path: '_Templates', children: [
        file('_Templates/회의록.md'),
        file('_Templates/그림.png'),
        file('_Templates/가 표.tsv'),
        { type: 'dir', name: 'old', path: '_Templates/old', children: [file('_Templates/old/x.md')] },
      ],
    },
    { type: 'dir', name: '@ext', path: '@ext', children: [{ type: 'dir', name: '_templates', path: '@ext/_templates', children: [file('@ext/_templates/y.md')] }], mount: { alias: 'ext', folder: 'ext', readOnly: false, truncated: false, path: null } },
  ]

  it('주 폴더의 _templates 바로 아래 지원 형식만, 이름 순 (대소문자 무시)', () => {
    expect(userTemplatePaths(tree)).toEqual(['_Templates/가 표.tsv', '_Templates/회의록.md'])
  })

  it('없으면 빈 목록 · 가져온 폴더의 것은 보지 않는다', () => {
    expect(userTemplatePaths(tree.filter((e) => !e.path.startsWith('_')))).toEqual([])
  })
})
