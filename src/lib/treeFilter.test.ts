import { describe, expect, it } from 'vitest'
import type { TreeEntry } from './backend'
import { filterActive, filterTree } from './treeFilter'

/** 트리 필터 (ADOPT B3 · DESIGN §48) */

const f = (path: string): TreeEntry => ({ type: 'file', name: path.split('/').pop()!, path })
const d = (path: string, children: TreeEntry[]): TreeEntry => ({ type: 'dir', name: path.split('/').pop()!, path, children })

const tree: TreeEntry[] = [
  d('docs', [f('docs/개요.md'), f('docs/Setup.md'), d('docs/설계', [f('docs/설계/전투.md'), d('docs/설계/빈', [])])]),
  d('data', [f('data/Item.tsv'), f('data/Monster.tsv')]),
  f('README.md'),
  d('@ref', [f('@ref/전투 메모.md')]),
]

/** 걸러진 트리를 경로 목록으로 */
const paths = (list: TreeEntry[], out: string[] = []): string[] => {
  for (const e of list) { out.push(e.path); if (e.children) paths(e.children, out) }
  return out
}

describe('트리 필터', () => {
  it('빈 글자는 그대로', () => {
    const r = filterTree(tree, { query: '  ' })
    expect(r.entries).toBe(tree)
    expect(r.open.size).toBe(0)
    expect(filterActive({ query: '' })).toBe(false)
  })

  it('이름에 든 글자 — 대소문자 무시, 상위 폴더는 남기고 펼친다', () => {
    const r = filterTree(tree, { query: 'SETUP' })
    expect(paths(r.entries)).toEqual(['docs', 'docs/Setup.md'])
    expect([...r.open]).toEqual(['docs'])
    expect(r.hits).toEqual(['docs/Setup.md'])
  })

  it('여러 폴더 · 가져온 폴더에서', () => {
    const r = filterTree(tree, { query: '전투' })
    expect(paths(r.entries)).toEqual(['docs', 'docs/설계', 'docs/설계/전투.md', '@ref', '@ref/전투 메모.md'])
    expect(r.open).toEqual(new Set(['docs/설계', 'docs', '@ref']))
  })

  it('이름이 맞은 폴더는 안을 거르지 않고, 펼침은 사용자에게', () => {
    const r = filterTree(tree, { query: '설계' })
    expect(paths(r.entries)).toEqual(['docs', 'docs/설계', 'docs/설계/전투.md', 'docs/설계/빈'])
    expect(r.open).toEqual(new Set(['docs']))
    expect(r.hits).toEqual(['docs/설계'])
  })

  it('한글 NFD 이름도 맞는다', () => {
    const nfd: TreeEntry[] = [f('개요'.normalize('NFD') + '.md')]
    expect(filterTree(nfd, { query: '개요' }).entries).toHaveLength(1)
  })

  it('/ 가 있으면 경로에서', () => {
    expect(paths(filterTree(tree, { query: 'data/m' }).entries)).toEqual(['data', 'data/Monster.tsv'])
  })

  it('저장 안 한 것만 — 글자와 같이 쓰면 둘 다', () => {
    const dirty = new Set(['docs/설계/전투.md', 'data/Item.tsv'])
    const all = filterTree(tree, { query: '', dirty })
    expect(paths(all.entries)).toEqual(['docs', 'docs/설계', 'docs/설계/전투.md', 'data', 'data/Item.tsv'])
    expect(all.open).toEqual(new Set(['docs/설계', 'docs', 'data']))
    expect(paths(filterTree(tree, { query: '전투', dirty }).entries)).toEqual(['docs', 'docs/설계', 'docs/설계/전투.md'])
    // 이름이 맞은 폴더라도 저장 안 한 파일이 없으면 뺀다
    expect(filterTree(tree, { query: 'docs', dirty: new Set(['data/Item.tsv']) }).entries).toEqual([])
  })

  it('맞는 것이 없으면 빈 목록', () => {
    const r = filterTree(tree, { query: '없는글자' })
    expect(r.entries).toEqual([])
    expect(r.hits).toEqual([])
  })
})
