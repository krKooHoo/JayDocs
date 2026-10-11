import { describe, expect, it } from 'vitest'
import { compileTemplate, renderTemplate } from './template'

describe('템플릿', () => {
  it('변수 · this · ../ · @index', () => {
    const out = renderTemplate('{{#each rows}}{{@index}}:{{Key}}/{{../title}};{{/each}}', { title: 'T', rows: [{ Key: 'A' }, { Key: 'B' }] })
    expect(out).toBe('0:A/T;1:B/T;')
    expect(renderTemplate('{{#each xs}}[{{this}}]{{/each}}', { xs: ['a', 'b'] })).toBe('[a][b]')
  })
  it('.list · .id · .length', () => {
    expect(renderTemplate('{{#each Req.list}}{{this}}|{{/each}}', { Req: 'Cow[20], Wood[30]' })).toBe('Cow[20]|Wood[30]|')
    expect(renderTemplate('{{Key.id}}', { Key: 'Agricultural-District' })).toBe('Agricultural_District')
    expect(renderTemplate('{{rows.length}}', { rows: [1, 2, 3] })).toBe('3')
    expect(renderTemplate('{{Req.list.length}}', { Req: '' })).toBe('0')
  })
  it('if / else', () => {
    const t = compileTemplate('{{#if On}}yes{{else}}no{{/if}}')
    expect(t({ On: 'TRUE' })).toBe('yes')
    expect(t({ On: 'FALSE' })).toBe('no')
    expect(t({ On: '' })).toBe('no')
    expect(t({})).toBe('no')
  })
  it('블록 태그만 있는 줄은 빈 줄을 남기지 않는다', () => {
    const src = 'flowchart LR\n{{#each rows}}\n  {{Key}}["{{Name}}"]\n{{/each}}\nend'
    const out = renderTemplate(src, { rows: [{ Key: 'A', Name: 'a' }, { Key: 'B', Name: 'b' }] })
    expect(out).toBe('flowchart LR\n  A["a"]\n  B["b"]\nend')
  })
  it('DESIGN §7.2 예시', () => {
    const src = `flowchart LR
{{#each rows}}
{{Key.id}}["{{DisplayName}}"]
{{#each RequiredBuildingKey.list}}{{this.id}} --> {{../Key.id}}
{{/each}}{{/each}}`
    const out = renderTemplate(src, { rows: [
      { Key: 'Farm', DisplayName: 'Farm', RequiredBuildingKey: '' },
      { Key: 'Mill', DisplayName: 'Mill', RequiredBuildingKey: 'Farm, Water-Wheel' },
    ] })
    expect(out).toBe('flowchart LR\nFarm["Farm"]\nMill["Mill"]\nFarm --> Mill\nWater_Wheel --> Mill\n')
  })
  it('문법 오류', () => {
    expect(() => compileTemplate('{{#each rows}}x')).toThrow()
    expect(() => compileTemplate('{{/if}}')).toThrow()
    expect(() => compileTemplate('{{#each rows}}{{else}}{{/each}}')).toThrow()
  })
  it('없는 값은 빈 문자열, 주석은 사라진다', () => {
    expect(renderTemplate('[{{nope}}]{{! comment }}', {})).toBe('[]')
  })
})
