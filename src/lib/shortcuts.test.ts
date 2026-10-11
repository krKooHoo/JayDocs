import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { SHORTCUTS, renderShortcutsMarkdown } from './shortcuts-table.mjs'
import { comboFromEvent, normalizeCombo } from './keys'

describe('단축키 표', () => {
  it('SHORTCUTS.md 가 표와 같다 (다르면 npm run shortcuts)', () => {
    const md = fs.readFileSync(path.resolve(__dirname, '../../SHORTCUTS.md'), 'utf8').replace(/\r\n/g, '\n')
    expect(md).toBe(renderShortcutsMarkdown())
  })
  it('명령이 달린 키는 전역에서 서로 겹치지 않는다', () => {
    const seen = new Map<string, string>()
    for (const g of SHORTCUTS) {
      for (const s of g.items) {
        if (!s.command || s.keys.includes('…')) continue
        const key = normalizeCombo(s.keys)
        const prev = seen.get(key)
        if (prev && prev !== s.command) throw new Error(`${s.keys}: ${prev} 와 ${s.command} 가 겹친다`)
        seen.set(key, s.command)
      }
    }
    expect(seen.size).toBeGreaterThan(10)
  })
})

describe('키 조합 표기', () => {
  const ev = (init: Partial<KeyboardEvent> & { key: string; code?: string }) => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code: '', ...init }) as KeyboardEvent
  it('이벤트 → 문자열', () => {
    expect(comboFromEvent(ev({ key: 'p', ctrlKey: true, shiftKey: true, code: 'KeyP' }))).toBe('Ctrl+Shift+P')
    expect(comboFromEvent(ev({ key: ']', altKey: true, code: 'BracketRight' }))).toBe('Alt+]')
    expect(comboFromEvent(ev({ key: '+', ctrlKey: true, altKey: true, shiftKey: true, code: 'Equal' }))).toBe('Ctrl+Alt+Shift+=')
    expect(comboFromEvent(ev({ key: 'F1', code: 'F1' }))).toBe('F1')
    expect(comboFromEvent(ev({ key: '\\', ctrlKey: true, code: 'Backslash' }))).toBe('Ctrl+\\')
    expect(comboFromEvent(ev({ key: '1', altKey: true, code: 'Digit1' }))).toBe('Alt+1')
    expect(comboFromEvent(ev({ key: 's', metaKey: true, code: 'KeyS' }))).toBe('Ctrl+S')
    expect(comboFromEvent(ev({ key: 'Shift', shiftKey: true, code: 'ShiftLeft' }))).toBeNull()
  })
  it('표기 정규화', () => {
    expect(normalizeCombo('ctrl+shift+p')).toBe('Ctrl+Shift+P')
    expect(normalizeCombo('Shift+Ctrl+P')).toBe('Ctrl+Shift+P')
    expect(normalizeCombo('Ctrl+\\')).toBe('Ctrl+\\')
  })
})
