import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 글자 대비 (ADOPT A7 · DESIGN §37). `styles.css` 의 테마 변수를 읽어 WCAG 대비를 잰다 — 색을 바꾸다 기준 밑으로 가면 실패한다.
 * 기준: 본문 · 흐린 글자 모두 4.5:1 (AA 일반 글자). 흐린 글자는 패널 · 고른 행 바탕 위에도 쓰인다.
 */
const css = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8')

function varsOf(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`${selector} 블록이 없다`)
  const body = css.slice(start, css.indexOf('\n}', start))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2]
  return out
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** 흐린 글자가 놓이는 바탕 */
const GROUNDS = ['bg', 'elev', 'panel', 'panel2', 'hover', 'accent-soft', 'active-row', 'code-bg']

describe('글자 대비 (WCAG AA 4.5:1)', () => {
  const light = varsOf(':root')
  const dark = { ...light, ...varsOf(":root[data-theme='dark']") }

  for (const [name, vars] of [['라이트', light], ['다크', dark]] as const) {
    it(`${name} — 본문 · 흐린 글자가 모든 바탕에서`, () => {
      for (const g of GROUNDS) {
        expect(contrast(vars.fg, vars[g]), `fg / ${g}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(vars.muted, vars[g]), `muted ${vars.muted} / ${g} ${vars[g]}`).toBeGreaterThanOrEqual(4.5)
      }
    })
    it(`${name} — 강조 · 수정됨 · 오류 글자가 바탕 · 패널에서`, () => {
      for (const fg of ['accent', 'dirty', 'danger']) {
        for (const g of ['bg', 'panel']) expect(contrast(vars[fg], vars[g]), `${fg} / ${g}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  it('잰 값이 알려진 값과 맞다', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
  })
})
