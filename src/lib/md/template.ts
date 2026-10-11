/**
 * Mermaid 생성용 템플릿 (DESIGN §7.2). Mustache 의 아주 작은 부분집합을 직접 구현했다 — 라이브러리 없이 100줄 안팎.
 *
 *   {{name}}                 현재 문맥에서 값. 행 안에서는 열 이름, each 안에서는 항목(this)
 *   {{this}}                 each 의 현재 항목
 *   {{../name}}              한 단계 바깥 문맥
 *   {{@index}}               each 의 번호 (0부터)
 *   {{name.list}}            `Plains, Hill` 같은 리스트 셀을 항목 배열로 (each 에 쓴다)
 *   {{name.id}}              `Agricultural-District` → `Agricultural_District` (mermaid 노드 id 로 안전하게)
 *   {{#each expr}} … {{/each}}
 *   {{#if expr}} … {{else}} … {{/if}}
 *
 * 값은 HTML 이스케이프하지 않는다 (mermaid 텍스트다). 블록 태그만 있는 줄은 빈 줄을 남기지 않는다.
 */
export type TemplateValue = string | number | boolean | null | undefined | TemplateValue[] | { [k: string]: TemplateValue }

type Token =
  | { t: 'text'; v: string }
  | { t: 'var'; path: string }
  | { t: 'open'; kind: 'each' | 'if'; path: string }
  | { t: 'else' }
  | { t: 'close'; kind: 'each' | 'if' }

type Node =
  | { t: 'text'; v: string }
  | { t: 'var'; path: string }
  | { t: 'each'; path: string; body: Node[] }
  | { t: 'if'; path: string; body: Node[]; otherwise: Node[] }

const TAG = /\{\{\s*([^}]*?)\s*\}\}/g

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let last = 0
  for (const m of src.matchAll(TAG)) {
    const idx = m.index ?? 0
    if (idx > last) out.push({ t: 'text', v: src.slice(last, idx) })
    last = idx + m[0].length
    const inner = m[1]
    if (inner.startsWith('#each ')) out.push({ t: 'open', kind: 'each', path: inner.slice(6).trim() })
    else if (inner.startsWith('#if ')) out.push({ t: 'open', kind: 'if', path: inner.slice(4).trim() })
    else if (inner === 'else') out.push({ t: 'else' })
    else if (inner === '/each') out.push({ t: 'close', kind: 'each' })
    else if (inner === '/if') out.push({ t: 'close', kind: 'if' })
    else if (inner.startsWith('!')) continue // 주석
    else out.push({ t: 'var', path: inner })
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) })
  return trimStandalone(out)
}

/** 블록 태그만 있는 줄은 줄 전체를 지운다 (Mustache 의 standalone 규칙) */
function trimStandalone(tokens: Token[]): Token[] {
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]
    if (tk.t !== 'open' && tk.t !== 'close' && tk.t !== 'else') continue
    const prev = tokens[i - 1]
    const next = tokens[i + 1]
    const prevOk = !prev || (prev.t === 'text' && /(^|\n)[ \t]*$/.test(prev.v))
    const nextOk = !next || (next.t === 'text' && /^[ \t]*(\r?\n|$)/.test(next.v))
    if (!prevOk || !nextOk) continue
    if (prev && prev.t === 'text') prev.v = prev.v.replace(/[ \t]*$/, '')
    if (next && next.t === 'text') next.v = next.v.replace(/^[ \t]*(\r?\n)?/, '')
  }
  return tokens
}

function parse(tokens: Token[]): Node[] {
  let p = 0
  function block(until: 'each' | 'if' | null): { body: Node[]; otherwise: Node[]; closed: boolean } {
    const body: Node[] = []
    let otherwise: Node[] | null = null
    const push = (n: Node) => (otherwise ?? body).push(n)
    while (p < tokens.length) {
      const tk = tokens[p++]
      if (tk.t === 'text') push({ t: 'text', v: tk.v })
      else if (tk.t === 'var') push({ t: 'var', path: tk.path })
      else if (tk.t === 'open') {
        const inner = block(tk.kind)
        if (!inner.closed) throw new Error(`{{#${tk.kind} ${tk.path}}} 가 닫히지 않았습니다`)
        push(tk.kind === 'each' ? { t: 'each', path: tk.path, body: inner.body } : { t: 'if', path: tk.path, body: inner.body, otherwise: inner.otherwise })
      } else if (tk.t === 'else') {
        if (until !== 'if') throw new Error('{{else}} 는 {{#if}} 안에서만 쓸 수 있습니다')
        otherwise = []
      } else if (tk.t === 'close') {
        if (tk.kind !== until) throw new Error(`{{/${tk.kind}}} 의 짝이 맞지 않습니다`)
        return { body, otherwise: otherwise ?? [], closed: true }
      }
    }
    return { body, otherwise: otherwise ?? [], closed: until === null }
  }
  const root = block(null)
  return root.body
}

interface Frame {
  value: TemplateValue
  index: number
}

function isRecord(v: TemplateValue): v is { [k: string]: TemplateValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function lookup(frames: Frame[], path: string): TemplateValue {
  let depth = frames.length - 1
  let rest = path
  while (rest.startsWith('../')) { depth--; rest = rest.slice(3) }
  if (depth < 0) return undefined
  const frame = frames[depth]
  if (rest === '@index') return frame.index
  const parts = rest.split('.')
  let cur: TemplateValue = frame.value
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]
    if (key === 'this' && i === 0) continue
    if (key === 'list') { cur = String(cur ?? '').split(',').map((s) => s.trim()).filter(Boolean); continue }
    if (key === 'id') { cur = String(cur ?? '').replace(/[^A-Za-z0-9_]+/g, '_'); continue }
    if (key === 'length' && (Array.isArray(cur) || typeof cur === 'string')) { cur = cur.length; continue }
    if (isRecord(cur)) cur = cur[key]
    else return undefined
  }
  return cur
}

function truthy(v: TemplateValue): boolean {
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'string') return v !== '' && !/^(false|0)$/i.test(v)
  return !!v
}

function stringify(v: TemplateValue): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(stringify).join(', ')
  if (isRecord(v)) return ''
  return String(v)
}

function render(nodes: Node[], frames: Frame[], out: string[]) {
  for (const n of nodes) {
    switch (n.t) {
      case 'text': out.push(n.v); break
      case 'var': out.push(stringify(lookup(frames, n.path))); break
      case 'if': render(truthy(lookup(frames, n.path)) ? n.body : n.otherwise, frames, out); break
      case 'each': {
        const v = lookup(frames, n.path)
        const items = Array.isArray(v) ? v : typeof v === 'string' && v !== '' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []
        items.forEach((item, i) => render(n.body, [...frames, { value: item, index: i }], out))
        break
      }
    }
  }
}

/** 템플릿을 미리 파싱해 둔 것. 문법 오류는 compile 때 던진다 */
export interface CompiledTemplate {
  (root: TemplateValue): string
}

export function compileTemplate(src: string): CompiledTemplate {
  const nodes = parse(tokenize(src))
  return (root) => {
    const out: string[] = []
    render(nodes, [{ value: root, index: 0 }], out)
    return out.join('')
  }
}

export function renderTemplate(src: string, root: TemplateValue): string {
  return compileTemplate(src)(root)
}
