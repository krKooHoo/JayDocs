import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PANE_COMMANDS, PANE_COMMAND_IDS } from './paneCommands'
import { cmdTitle, keysOf } from './commands'

/**
 * 막대의 단추마다 팔레트 명령이 있는가 (ADOPT A6 · DESIGN §36). 팔레트가 Mac 메뉴 막대 역할이라 모든 동작이 거기 있어야 한다.
 * 소스를 읽어 검사한다 — 막대 구간 안의 `<button` 은 모두 `data-command="id"` 를 달고, 그 id 는 등록된 명령이어야 한다.
 */
const SRC = path.resolve(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')

/** 파일 · 막대 구간 (시작 글 ~ 끝 글) */
const BARS: [string, string, string][] = [
  ['App.tsx', '<header className="topbar">', '</header>'],
  ['components/FileTree.tsx', '<button className="tree-search"', 'className="tree-body"'],
  ['components/MarkdownPane.tsx', '<div className="pane-bar">', '{d?.conflict && ('],
  ['components/grid/GridPane.tsx', '<div className="pane-bar">', '{doc?.conflict && ('],
  ['components/grid/GridPane.tsx', '<div className="grid-toolbar">', '{calcErrors.length > 0 && ('],
]

/** 소스에 등록된 명령 id — `registerCommands([{ id: '…' …` 와 이 표 */
function registeredIds(): Set<string> {
  const ids = new Set<string>(PANE_COMMAND_IDS)
  for (const f of ['App.tsx', 'components/Workbench.tsx']) for (const m of read(f).matchAll(/\bid: '([\w:]+)'/g)) ids.add(m[1])
  return ids
}

function buttonsIn(src: string): string[] {
  const out: string[] = []
  let i = src.indexOf('<button')
  while (i >= 0) {
    const end = src.indexOf('</button>', i)
    out.push(src.slice(i, end < 0 ? undefined : end))
    i = src.indexOf('<button', i + 1)
  }
  return out
}

describe('막대 단추 = 팔레트 명령', () => {
  const ids = registeredIds()

  for (const [file, start, end] of BARS) {
    it(`${file} — ${start.slice(0, 32)} 의 단추는 모두 명령이 있다`, () => {
      const src = read(file)
      const a = src.indexOf(start)
      const b = src.indexOf(end, a)
      expect(a, `${start} 를 찾지 못했다`).toBeGreaterThanOrEqual(0)
      expect(b, `${end} 를 찾지 못했다`).toBeGreaterThan(a)
      const buttons = buttonsIn(src.slice(a, b))
      expect(buttons.length).toBeGreaterThan(0)
      for (const btn of buttons) {
        const m = /data-command="([\w:]+)"/.exec(btn)
        expect(m, `data-command 가 없는 단추: ${btn.slice(0, 120)}`).not.toBeNull()
        expect(ids.has(m![1]), `등록되지 않은 명령: ${m![1]}`).toBe(true)
      }
    })
  }

  it('창 명령은 모두 단추가 있다 (찾기 단추가 함께 맡는 바꾸기만 빼고)', () => {
    const all = BARS.map(([f]) => read(f)).join('\n') + read('components/grid/GridPane.tsx')
    for (const c of PANE_COMMANDS) {
      if (c.id === 'gridReplace') continue
      expect(all.includes(`data-command="${c.id}"`), `${c.id} 의 단추가 없다`).toBe(true)
    }
  })

  it('툴팁은 `설명 (키)` — 키는 단축키 표에서', () => {
    expect(keysOf('gridRowBelow')).toBe('Ctrl+Alt+=')
    expect(cmdTitle('gridRowBelow')).toBe('선택한 행 아래에 빈 행 — 선택한 행 수만큼 (Ctrl+Alt+=)')
    expect(cmdTitle('gridUndo')).toBe('되돌리기 (Ctrl+Z)')
    expect(cmdTitle('gridRowAbove')).toBe('선택한 행 위에 빈 행 — 선택한 행 수만큼')
  })
})
