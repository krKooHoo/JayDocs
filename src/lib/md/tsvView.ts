import type { TsvTable } from '../tsv/model'
import type { ColumnSchema, TableSchema } from '../tsv/schema'

/**
 * `tsv-view` 코드펜스 (DESIGN §7). 본문은 YAML 의 아주 작은 부분집합이다:
 *   key: 값           스칼라 (따옴표 가능)
 *   key: [a, b, c]    목록
 *   key:              블록 목록
 *     - a
 *   key: |            여러 줄 (들여쓴 줄들)
 * 그 밖의 YAML 문법은 지원하지 않는다 — 옵션이 이 정도라 라이브러리를 들이지 않았다.
 */
export interface TsvViewSpec {
  file: string | null
  columns: string[] | null
  where: string | null
  sort: string[]
  limit: number | null
  render: string | null
  template: string | null
  bake: boolean
  /** 알 수 없는 키 등, 치명적이지 않은 문제 */
  warnings: string[]
}

type YamlValue = string | string[]

function unquote(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1)
  return t
}

function splitList(s: string): string[] {
  return s.split(',').map((x) => unquote(x)).filter((x) => x !== '')
}

function parseYamlSubset(body: string): { values: Map<string, YamlValue>; warnings: string[] } {
  const values = new Map<string, YamlValue>()
  const warnings: string[] = []
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    i++
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!m) { warnings.push(`읽을 수 없는 줄: ${line.trim()}`); continue }
    const key = m[1]
    const rest = m[2].trim()
    if (rest === '|' || rest === '|-' || rest === '>') {
      const block: string[] = []
      while (i < lines.length && (lines[i].trim() === '' || /^\s/.test(lines[i]))) block.push(lines[i++])
      while (block.length && block[block.length - 1].trim() === '') block.pop()
      const indent = Math.min(...block.filter((l) => l.trim() !== '').map((l) => /^\s*/.exec(l)![0].length))
      values.set(key, block.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join(rest === '>' ? ' ' : '\n'))
      continue
    }
    if (rest === '') {
      const items: string[] = []
      while (i < lines.length && /^\s*-\s*/.test(lines[i])) items.push(unquote(lines[i++].replace(/^\s*-\s*/, '')))
      values.set(key, items)
      continue
    }
    if (rest.startsWith('[') && rest.endsWith(']')) {
      values.set(key, splitList(rest.slice(1, -1)))
      continue
    }
    values.set(key, unquote(rest.replace(/\s+#.*$/, '')))
  }
  return { values, warnings }
}

const KNOWN = new Set(['file', 'columns', 'where', 'sort', 'limit', 'render', 'template', 'bake'])

export function parseTsvViewSpec(body: string): TsvViewSpec {
  const { values, warnings } = parseYamlSubset(body)
  const str = (k: string) => { const v = values.get(k); return typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : null }
  const list = (k: string) => { const v = values.get(k); return Array.isArray(v) ? v : typeof v === 'string' ? splitList(v) : null }
  for (const k of values.keys()) if (!KNOWN.has(k)) warnings.push(`모르는 옵션: ${k}`)
  const limitRaw = str('limit')
  const limit = limitRaw !== null && /^\d+$/.test(limitRaw) ? Number(limitRaw) : null
  if (limitRaw !== null && limit === null) warnings.push(`limit 은 정수여야 합니다: ${limitRaw}`)
  const bakeRaw = str('bake')
  return {
    file: str('file'),
    columns: list('columns'),
    where: str('where'),
    sort: list('sort') ?? [],
    limit,
    render: str('render'),
    template: str('template'),
    bake: bakeRaw !== null && /^(true|yes|1)$/i.test(bakeRaw),
    warnings,
  }
}

// ---------------------------------------------------------------- where 식
type Row = Record<string, string>
type Node =
  | { t: 'str'; v: string }
  | { t: 'num'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'col'; v: string }
  | { t: 'list'; v: Node[] }
  | { t: 'not'; a: Node }
  | { t: 'and' | 'or'; a: Node; b: Node }
  | { t: 'cmp'; op: '==' | '!=' | '>' | '<' | '>=' | '<='; a: Node; b: Node }
  | { t: 'in'; neg: boolean; a: Node; b: Node }

interface Token { k: 'str' | 'num' | 'id' | 'op'; v: string }

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === '"' || ch === "'") {
      const j = src.indexOf(ch, i + 1)
      if (j < 0) throw new Error('닫히지 않은 따옴표')
      out.push({ k: 'str', v: src.slice(i + 1, j) })
      i = j + 1
      continue
    }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i))
    if (num && !/[A-Za-z_]/.test(src[i + num[0].length] ?? '')) { out.push({ k: 'num', v: num[0] }); i += num[0].length; continue }
    const op = /^(==|!=|>=|<=|&&|\|\||[><!()[\],])/.exec(src.slice(i))
    if (op) { out.push({ k: 'op', v: op[0] }); i += op[0].length; continue }
    const id = /^[A-Za-z_][\w-]*/.exec(src.slice(i))
    if (id) { out.push({ k: 'id', v: id[0] }); i += id[0].length; continue }
    throw new Error(`알 수 없는 글자: ${ch}`)
  }
  return out
}

function parseWhere(src: string): Node {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const take = () => toks[p++]
  const isOp = (v: string) => peek()?.k === 'op' && peek().v === v
  const isId = (v: string) => peek()?.k === 'id' && peek().v.toLowerCase() === v

  function primary(): Node {
    const t = take()
    if (!t) throw new Error('식이 끝났습니다')
    if (t.k === 'str') return { t: 'str', v: t.v }
    if (t.k === 'num') return { t: 'num', v: Number(t.v) }
    if (t.k === 'op' && t.v === '(') { const e = or(); if (!isOp(')')) throw new Error("')' 가 필요합니다"); take(); return e }
    if (t.k === 'op' && t.v === '[') {
      const items: Node[] = []
      while (!isOp(']')) { items.push(primary()); if (isOp(',')) take(); else if (!isOp(']')) throw new Error("']' 가 필요합니다") }
      take()
      return { t: 'list', v: items }
    }
    if (t.k === 'id') {
      const lower = t.v.toLowerCase()
      if (lower === 'true') return { t: 'bool', v: true }
      if (lower === 'false') return { t: 'bool', v: false }
      return { t: 'col', v: t.v }
    }
    throw new Error(`예상치 못한 토큰: ${t.v}`)
  }
  function cmp(): Node {
    const a = primary()
    const t = peek()
    if (t?.k === 'op' && ['==', '!=', '>', '<', '>=', '<='].includes(t.v)) { take(); return { t: 'cmp', op: t.v as never, a, b: primary() } }
    if (isId('in')) { take(); return { t: 'in', neg: false, a, b: primary() } }
    if (isId('not')) { take(); if (!isId('in')) throw new Error("'not' 다음엔 'in'"); take(); return { t: 'in', neg: true, a, b: primary() } }
    return a
  }
  function not(): Node {
    if (isOp('!')) { take(); return { t: 'not', a: not() } }
    if (isId('not')) { take(); return { t: 'not', a: not() } }
    return cmp()
  }
  function and(): Node {
    let a = not()
    while (isOp('&&') || isId('and')) { take(); a = { t: 'and', a, b: not() } }
    return a
  }
  function or(): Node {
    let a = and()
    while (isOp('||') || isId('or')) { take(); a = { t: 'or', a, b: and() } }
    return a
  }
  const node = or()
  if (p < toks.length) throw new Error(`식 끝에 남은 토큰: ${toks[p].v}`)
  return node
}

type Val = string | number | boolean | Val[]

function value(n: Node, row: Row): Val {
  switch (n.t) {
    case 'str': return n.v
    case 'num': return n.v
    case 'bool': return n.v
    case 'col': return row[n.v] ?? ''
    case 'list': return n.v.map((x) => value(x, row))
    default: return truthy(evaluate(n, row))
  }
}

function truthy(v: Val): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (Array.isArray(v)) return v.length > 0
  return v !== '' && !/^(false|0)$/i.test(v)
}

function compare(a: Val, b: Val): number {
  const na = typeof a === 'number' ? a : typeof a === 'string' && a.trim() !== '' && !Number.isNaN(Number(a)) ? Number(a) : null
  const nb = typeof b === 'number' ? b : typeof b === 'string' && b.trim() !== '' && !Number.isNaN(Number(b)) ? Number(b) : null
  if (na !== null && nb !== null) return na - nb
  const sa = String(a)
  const sb = String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

function equalsLoose(a: Val, b: Val): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return truthy(a) === truthy(b)
  return compare(a, b) === 0
}

function evaluate(n: Node, row: Row): Val {
  switch (n.t) {
    case 'not': return !truthy(evaluate(n.a, row))
    case 'and': return truthy(evaluate(n.a, row)) && truthy(evaluate(n.b, row))
    case 'or': return truthy(evaluate(n.a, row)) || truthy(evaluate(n.b, row))
    case 'cmp': {
      const a = value(n.a, row)
      const b = value(n.b, row)
      switch (n.op) {
        case '==': return equalsLoose(a, b)
        case '!=': return !equalsLoose(a, b)
        case '>': return compare(a, b) > 0
        case '<': return compare(a, b) < 0
        case '>=': return compare(a, b) >= 0
        case '<=': return compare(a, b) <= 0
      }
      return false
    }
    case 'in': {
      const a = value(n.a, row)
      const b = value(n.b, row)
      const set = Array.isArray(b) ? b : [b]
      // 리스트 셀(`Plains, Hill`)은 항목 중 하나라도 들어 있으면 참
      const items = typeof a === 'string' && a.includes(',') ? a.split(',').map((s) => s.trim()) : [a]
      const hit = items.some((x) => set.some((y) => equalsLoose(x, y)))
      return n.neg ? !hit : hit
    }
    default: return value(n, row)
  }
}

export interface WhereFn {
  (row: Row): boolean
}

/** where 식을 한 번 파싱해 행 판별 함수로. 문법 오류면 Error 를 던진다 */
export function compileWhere(src: string): WhereFn {
  const ast = parseWhere(src)
  return (row) => truthy(evaluate(ast, row))
}

// ---------------------------------------------------------------- 적용
export interface TsvViewRow {
  /** 표 안의 실제 행 번호 (0부터, 헤더 포함) */
  index: number
  cells: string[]
}
export interface TsvViewResult {
  columns: ColumnSchema[]
  rows: TsvViewRow[]
  /** 필터 전 데이터 행 수 */
  total: number
  error: string | null
}

/** 행을 열 이름 → 값 레코드로 (where 식 · 템플릿이 쓴다). 이름 없는 열은 `_3` 처럼 번호로 */
export function rowRecord(cells: readonly string[], schema: TableSchema): Row {
  const row: Row = {}
  for (const col of schema.columns) row[col.name || `_${col.index + 1}`] = cells[col.index] ?? ''
  return row
}

export function applyTsvView(spec: TsvViewSpec, table: TsvTable, schema: TableSchema): TsvViewResult {
  const errors: string[] = []
  let columns: ColumnSchema[]
  if (spec.columns && spec.columns.length) {
    columns = []
    for (const name of spec.columns) {
      const col = schema.columns.find((c) => c.name === name)
      if (col) columns.push(col)
      else errors.push(`없는 열: ${name}`)
    }
  } else {
    columns = schema.columns.filter((c) => c.type !== 'comment')
  }

  let where: WhereFn | null = null
  if (spec.where) {
    try { where = compileWhere(spec.where) } catch (e) { errors.push(`where: ${(e as Error).message}`) }
  }

  const dataRows: { index: number; rec: Row; cells: readonly string[] }[] = []
  for (let r = schema.headerRows; r < table.rows.length; r++) {
    const cells = table.rows[r].cells
    if (cells.every((c) => c === '')) continue
    dataRows.push({ index: r, rec: rowRecord(cells, schema), cells })
  }
  const total = dataRows.length
  let rows = where ? dataRows.filter((d) => where!(d.rec)) : dataRows

  if (spec.sort.length) {
    const keys = spec.sort.map((s) => ({ name: s.replace(/^-/, ''), desc: s.startsWith('-') }))
    for (const k of keys) if (!schema.columns.some((c) => c.name === k.name)) errors.push(`sort: 없는 열 ${k.name}`)
    rows = [...rows].sort((a, b) => {
      for (const k of keys) {
        const d = compare(a.rec[k.name] ?? '', b.rec[k.name] ?? '')
        if (d !== 0) return k.desc ? -d : d
      }
      return a.index - b.index
    })
  }
  if (spec.limit !== null) rows = rows.slice(0, spec.limit)

  return {
    columns,
    rows: rows.map((d) => ({ index: d.index, cells: columns.map((c) => d.cells[c.index] ?? '') })),
    total,
    error: errors.length ? errors.join(' · ') : null,
  }
}

/** 펜스 안의 file 경로를 리포 상대 경로로. `./`, `../` 로 시작하면 md 파일 위치 기준 */
export function resolveViewPath(file: string, mdPath: string): string {
  const norm = file.replace(/\\/g, '/').trim()
  if (!norm.startsWith('./') && !norm.startsWith('../')) return norm.replace(/^\/+/, '')
  const base = mdPath.includes('/') ? mdPath.slice(0, mdPath.lastIndexOf('/')).split('/') : []
  for (const seg of norm.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') base.pop()
    else base.push(seg)
  }
  return base.join('/')
}
