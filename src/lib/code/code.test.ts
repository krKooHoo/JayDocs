import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { CODE_LANGS, codeLangOf } from './langs'
import { CODE_MAX_LINES, isPlainToken, loadCodeLang, tokenStyle, tokenizeCode, type CodeLines } from './highlight'
import { codeBlocksIn, codeMarks } from './cmColors'

const CS = [
  '// 주사위 결과 연출',
  'private async UniTaskVoid ResolveTurnAsync(string playerId, int d1)',
  '{',
  '    await Turn.ShowDiceResultAsync(d1, 42, "문자열");',
  '}',
].join('\n')

/** 낱말이 든 토막 */
const tokenOf = (lines: CodeLines, word: string) => {
  const t = lines.flat().find((x) => x.text.includes(word))
  if (!t) throw new Error(`토막이 없다: ${word}`)
  return t
}

describe('코드 언어 표', () => {
  it('이름 · 별칭이 겹치지 않는다', () => {
    const names = CODE_LANGS.flatMap((l) => [l.id, ...l.aliases])
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n).toBe(n.toLowerCase())
  })

  it('펜스의 언어 표기를 읽는다 — 첫 낱말, 대소문자 무시, 별칭', () => {
    expect(codeLangOf('csharp')).toBe('csharp')
    expect(codeLangOf('cs')).toBe('csharp')
    expect(codeLangOf('C#')).toBe('csharp')
    expect(codeLangOf('  CSharp title="GameManager.cs"')).toBe('csharp')
    expect(codeLangOf('js {1,3}')).toBe('javascript')
    expect(codeLangOf('bash')).toBe('shellscript')
  })

  it('표에 없는 언어 · 앱이 따로 그리는 펜스는 null', () => {
    for (const info of ['', undefined, null, 'mermaid', 'tsv-view', 'cpp', 'c', 'text']) expect(codeLangOf(info)).toBeNull()
  })

  it('표의 모든 언어가 실리고 글을 나눈다', async () => {
    for (const l of CODE_LANGS) {
      await loadCodeLang(l.id)
      const lines = tokenizeCode('a = 1\n"x"', l.id)
      expect(lines, l.id).not.toBeNull()
      expect(lines!.map((line) => line.map((t) => t.text).join('')).join('\n'), l.id).toBe('a = 1\n"x"')
    }
  }, 60_000)
})

describe('코드 나누기', () => {
  it('문법을 받기 전에는 null 이고, 다 받으면 알린다', async () => {
    // 앞의 테스트가 이미 받아 두었으므로 모듈을 새로 읽어 처음 상태에서 본다
    vi.resetModules()
    const fresh = await import('./highlight')
    const told = new Promise<void>((resolve) => { fresh.onCodeReady(resolve) })
    const before = fresh.codeVersion()
    expect(fresh.tokenizeCode('SELECT 1', 'sql')).toBeNull()
    await told
    expect(fresh.codeVersion()).toBeGreaterThan(before)
    expect(fresh.tokenizeCode('SELECT 1', 'sql')).not.toBeNull()
  })

  it('C# — 키워드 · 타입 · 메서드 · 변수 · 주석 · 문자열 · 숫자가 VS 색으로 갈린다', async () => {
    await loadCodeLang('csharp')
    const lines = tokenizeCode(CS, 'csharp')!
    expect(lines).toHaveLength(5)
    // 글자는 그대로다
    expect(lines.map((line) => line.map((t) => t.text).join('')).join('\n')).toBe(CS)
    const colors = (word: string) => { const t = tokenOf(lines, word); return [t.dark, t.light] }
    expect(colors('주사위')).toEqual(['#6a9955', '#008000'])
    expect(colors('private')).toEqual(['#569cd6', '#0000ff'])
    expect(colors('UniTaskVoid')).toEqual(['#4ec9b0', '#267f99'])
    expect(colors('ResolveTurnAsync')).toEqual(['#dcdcaa', '#795e26'])
    expect(colors('playerId')).toEqual(['#9cdcfe', '#001080'])
    expect(colors('ShowDiceResultAsync')).toEqual(['#dcdcaa', '#795e26'])
    expect(colors('42')).toEqual(['#b5cea8', '#098658'])
    expect(colors('문자열')).toEqual(['#ce9178', '#a31515'])
  })

  it('기본 글자색인 토막은 색을 들지 않는다 (코드 상자의 글자색을 따른다)', async () => {
    await loadCodeLang('csharp')
    const brace = tokenizeCode(CS, 'csharp')![2]
    expect(brace).toHaveLength(1)
    expect(isPlainToken(brace[0])).toBe(true)
    expect(tokenStyle(tokenOf(tokenizeCode(CS, 'csharp')!, 'private'))).toBe('--tk-l:#0000ff;--tk-d:#569cd6;')
  })

  it('같은 글은 다시 나누지 않는다', async () => {
    await loadCodeLang('csharp')
    expect(tokenizeCode(CS, 'csharp')).toBe(tokenizeCode(CS, 'csharp'))
  })

  it('너무 긴 블록 · 표에 없는 언어는 null', async () => {
    await loadCodeLang('csharp')
    expect(tokenizeCode(Array.from({ length: CODE_MAX_LINES + 1 }, () => 'int a;').join('\n'), 'csharp')).toBeNull()
    expect(tokenizeCode(Array.from({ length: CODE_MAX_LINES }, () => 'int a;').join('\n'), 'csharp')).not.toBeNull()
    await expect(loadCodeLang('cobol')).rejects.toThrow()
    await expect(loadCodeLang('cs')).rejects.toThrow() // 별칭이 아니라 id 로 부른다
  })
})

describe('편집기의 코드 블록', () => {
  const stateOf = (doc: string) => {
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    ensureSyntaxTree(state, doc.length, 5000)
    return state
  }

  it('표에 있는 언어의 펜스만 고른다', () => {
    const doc = ['글', '```cs', 'int a = 1;', '```', '```mermaid', 'graph TD', '```', '```', '언어 없음', '```', '```json', '{}', '```'].join('\n')
    const blocks = codeBlocksIn(stateOf(doc), 0, doc.length)
    expect(blocks.map((b) => [b.lang, b.code])).toEqual([['csharp', 'int a = 1;'], ['json', '{}']])
  })

  it('빈 펜스 · 범위 밖의 펜스는 빠진다', () => {
    const doc = ['```cs', '```', '', '글', '', '```cs', 'int a;', '```'].join('\n')
    const state = stateOf(doc)
    expect(codeBlocksIn(state, 0, doc.length).map((b) => b.code)).toEqual(['int a;'])
    expect(codeBlocksIn(state, 0, 5)).toEqual([])
  })

  it('토막의 위치가 문서의 그 글자와 맞는다', async () => {
    await loadCodeLang('csharp')
    const doc = ['# 제목', '', '```csharp', CS, '```', '끝'].join('\n')
    const state = stateOf(doc)
    const [block] = codeBlocksIn(state, 0, doc.length)
    expect(block.code).toBe(CS)
    const marks = codeMarks(block, tokenizeCode(block.code, block.lang)!)
    expect(marks.length).toBeGreaterThan(10)
    const texts = marks.map((m) => doc.slice(m.from, m.to))
    for (const word of ['private', 'UniTaskVoid', 'ResolveTurnAsync', 'playerId', '42', '"문자열"']) expect(texts).toContain(word)
    for (let i = 1; i < marks.length; i++) expect(marks[i].from).toBeGreaterThanOrEqual(marks[i - 1].to)
  })

  it('인용 · 목록 안의 펜스 — 줄 앞 표식 · 들여쓰기를 빼고 나누고, 위치는 문서 기준이다', async () => {
    await loadCodeLang('csharp')
    for (const doc of [
      ['> ```cs', '> int a = 1;', '> string s = "x";', '> ```'].join('\n'),
      ['- 항목', '  ```cs', '  int a = 1;', '  string s = "x";', '  ```'].join('\n'),
    ]) {
      const [block] = codeBlocksIn(stateOf(doc), 0, doc.length)
      expect(block.code).toBe('int a = 1;\nstring s = "x";')
      const texts = codeMarks(block, tokenizeCode(block.code, block.lang)!).map((m) => doc.slice(m.from, m.to))
      expect(texts).toEqual(expect.arrayContaining(['int', '1', 'string', '"x"']))
      expect(texts.join('')).not.toContain('>')
    }
  })
})
