/**
 * 계산식 (DESIGN §17). 한 행 안의 열 값으로 다른 열의 값을 만든다. 결과는 파일에 **값으로** 써 넣는다 — 파일에는 식이 남지 않는다.
 *
 *   숫자 · "문자열" · 열이름 · ( ) · + - * / % · == != > < >= <= · && || ! · cond ? a : b
 *   함수: if(c, a, b) min max abs floor ceil round(x, n) len(s) upper(s) lower(s) trim(s) concat(a, b, …)
 *         contains(list, item)  — "Plains, Hill" 같은 리스트 셀에 항목이 있나
 *         count(list)           — 리스트 셀의 항목 수
 *         lookup("파일.tsv", key, "열")  — 다른 표에서 Key 로 행을 찾아 열 값을 (없으면 "")
 *         num(x)                — 숫자로 (못 바꾸면 0)
 *
 * 값은 문자열이지만 숫자로 읽히면 숫자로 계산한다. 빈 셀은 "" (숫자 문맥에선 0). 결과: 숫자는 소수점 찌꺼기를 지운 문자열, 불은 TRUE/FALSE.
 */
export type Value = string | number | boolean

type Token =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string }

type Node =
  | { t: 'lit'; v: Value }
  | { t: 'col'; name: string }
  | { t: 'un'; op: '-' | '!'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'cond'; c: Node; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] }

export interface CalcEnv {
  /** 열 이름 → 현재 행의 값 */
  get(name: string): string | undefined
  /** 다른 표에서 찾기. 파일을 모르면 null */
  lookup?(file: string, key: string, column: string): string | null
}

const OPS = ['==', '!=', '>=', '<=', '&&', '||', '>', '<', '+', '-', '*', '/', '%', '(', ')', ',', '?', ':', '!']

export function tokenize(src: string): Token[] {
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
    const num = /^\d+(\.\d+)?/.exec(src.slice(i))
    if (num && !/[A-Za-z_]/.test(src[i + num[0].length] ?? '')) { out.push({ k: 'num', v: Number(num[0]) }); i += num[0].length; continue }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) { out.push({ k: 'op', v: op }); i += op.length; continue }
    const id = /^[A-Za-z_][\w]*/.exec(src.slice(i))
    if (id) { out.push({ k: 'id', v: id[0] }); i += id[0].length; continue }
    throw new Error(`알 수 없는 글자: ${ch}`)
  }
  return out
}

const PREC: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '>': 4, '<': 4, '>=': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 }

export function parseExpr(src: string): Node {
  const toks = tokenize(src.replace(/^\s*=/, ''))
  let p = 0
  const peek = () => toks[p]
  const take = () => toks[p++]
  const isOp = (v: string) => peek()?.k === 'op' && peek().v === v
  const expect = (v: string) => { if (!isOp(v)) throw new Error(`'${v}' 가 필요합니다`); take() }

  function primary(): Node {
    const t = take()
    if (!t) throw new Error('식이 끝났습니다')
    if (t.k === 'num') return { t: 'lit', v: t.v }
    if (t.k === 'str') return { t: 'lit', v: t.v }
    if (t.k === 'op' && t.v === '(') { const e = ternary(); expect(')'); return e }
    if (t.k === 'op' && t.v === '-') return { t: 'un', op: '-', a: unary() }
    if (t.k === 'op' && t.v === '!') return { t: 'un', op: '!', a: unary() }
    if (t.k === 'id') {
      const lower = t.v.toLowerCase()
      if (lower === 'true') return { t: 'lit', v: true }
      if (lower === 'false') return { t: 'lit', v: false }
      if (isOp('(')) {
        take()
        const args: Node[] = []
        while (!isOp(')')) {
          args.push(ternary())
          if (isOp(',')) take()
          else if (!isOp(')')) throw new Error("')' 가 필요합니다")
        }
        take()
        return { t: 'call', name: lower, args }
      }
      return { t: 'col', name: t.v }
    }
    throw new Error(`예상치 못한 토큰: ${t.v}`)
  }
  function unary(): Node {
    if (isOp('-')) { take(); return { t: 'un', op: '-', a: unary() } }
    if (isOp('!')) { take(); return { t: 'un', op: '!', a: unary() } }
    return primary()
  }
  function binary(minPrec: number): Node {
    let left = unary()
    for (;;) {
      const t = peek()
      if (!t || t.k !== 'op' || PREC[t.v] === undefined || PREC[t.v] < minPrec) return left
      take()
      const right = binary(PREC[t.v] + 1)
      left = { t: 'bin', op: t.v, a: left, b: right }
    }
  }
  function ternary(): Node {
    const c = binary(1)
    if (isOp('?')) {
      take()
      const a = ternary()
      expect(':')
      const b = ternary()
      return { t: 'cond', c, a, b }
    }
    return c
  }
  const node = ternary()
  if (p < toks.length) throw new Error(`식 끝에 남은 토큰: ${toks[p].v}`)
  return node
}

function toNum(v: Value): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const s = v.trim()
  if (s === '') return 0
  const n = Number(s)
  if (Number.isNaN(n)) throw new Error(`숫자가 아닙니다: "${v}"`)
  return n
}
function isNumLike(v: Value): boolean {
  return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)))
}
export function truthy(v: Value): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return v !== '' && !/^(false|0)$/i.test(v)
}
function compare(a: Value, b: Value): number {
  if (isNumLike(a) && isNumLike(b)) return toNum(a) - toNum(b)
  const sa = String(a)
  const sb = String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}
function equals(a: Value, b: Value): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return truthy(a) === truthy(b)
  return compare(a, b) === 0
}
function listOf(v: Value): string[] {
  return String(v).split(',').map((s) => s.trim()).filter(Boolean)
}

function call(name: string, args: Value[], env: CalcEnv): Value {
  const n = (i: number) => toNum(args[i] ?? '')
  const need = (k: number) => { if (args.length < k) throw new Error(`${name}() 에는 인자 ${k}개가 필요합니다`) }
  switch (name) {
    case 'if': need(2); return truthy(args[0]) ? args[1] : (args[2] ?? '')
    case 'min': need(1); return Math.min(...args.map((_, i) => n(i)))
    case 'max': need(1); return Math.max(...args.map((_, i) => n(i)))
    case 'abs': need(1); return Math.abs(n(0))
    case 'floor': need(1); return Math.floor(n(0))
    case 'ceil': need(1); return Math.ceil(n(0))
    case 'round': { need(1); const d = args.length > 1 ? n(1) : 0; const m = 10 ** d; return Math.round(n(0) * m) / m }
    case 'num': need(1); return isNumLike(args[0]) ? toNum(args[0]) : 0
    case 'len': need(1); return String(args[0]).length
    case 'upper': need(1); return String(args[0]).toUpperCase()
    case 'lower': need(1); return String(args[0]).toLowerCase()
    case 'trim': need(1); return String(args[0]).trim()
    case 'concat': return args.map((a) => format(a)).join('')
    case 'contains': need(2); return listOf(args[0]).some((x) => equals(x, args[1]))
    case 'count': need(1); return listOf(args[0]).length
    case 'lookup': {
      need(3)
      if (!env.lookup) throw new Error('lookup 을 쓸 수 없습니다')
      const v = env.lookup(String(args[0]), format(args[1]), String(args[2]))
      if (v === null) throw new Error(`lookup: ${String(args[0])} 을 읽지 못했습니다`)
      return v
    }
    default:
      throw new Error(`모르는 함수: ${name}`)
  }
}

export function evaluate(node: Node, env: CalcEnv): Value {
  switch (node.t) {
    case 'lit': return node.v
    case 'col': {
      const v = env.get(node.name)
      if (v === undefined) throw new Error(`없는 열: ${node.name}`)
      return v
    }
    case 'un': {
      const a = evaluate(node.a, env)
      return node.op === '-' ? -toNum(a) : !truthy(a)
    }
    case 'cond': return truthy(evaluate(node.c, env)) ? evaluate(node.a, env) : evaluate(node.b, env)
    case 'call': return call(node.name, node.args.map((a) => evaluate(a, env)), env)
    case 'bin': {
      if (node.op === '&&') return truthy(evaluate(node.a, env)) && truthy(evaluate(node.b, env))
      if (node.op === '||') return truthy(evaluate(node.a, env)) || truthy(evaluate(node.b, env))
      const a = evaluate(node.a, env)
      const b = evaluate(node.b, env)
      switch (node.op) {
        case '+': return isNumLike(a) && isNumLike(b) ? toNum(a) + toNum(b) : format(a) + format(b)
        case '-': return toNum(a) - toNum(b)
        case '*': return toNum(a) * toNum(b)
        case '/': { const d = toNum(b); if (d === 0) throw new Error('0 으로 나눌 수 없습니다'); return toNum(a) / d }
        case '%': return toNum(a) % toNum(b)
        case '==': return equals(a, b)
        case '!=': return !equals(a, b)
        case '>': return compare(a, b) > 0
        case '<': return compare(a, b) < 0
        case '>=': return compare(a, b) >= 0
        case '<=': return compare(a, b) <= 0
      }
      throw new Error(`모르는 연산자: ${node.op}`)
    }
  }
}

/** 셀에 써 넣을 문자열로 */
export function format(v: Value): string {
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('결과가 숫자가 아닙니다')
    return String(Math.round(v * 1e10) / 1e10)
  }
  return v
}

export interface CompiledExpr {
  (env: CalcEnv): string
  /** 식에 나온 lookup 파일 (문자열 리터럴인 것만) */
  lookupFiles: string[]
  /** 식이 읽는 열 이름 */
  columns: string[]
}

export function compileExpr(src: string): CompiledExpr {
  const ast = parseExpr(src)
  const lookupFiles: string[] = []
  const columns: string[] = []
  const walk = (n: Node) => {
    switch (n.t) {
      case 'col': if (!columns.includes(n.name)) columns.push(n.name); break
      case 'un': walk(n.a); break
      case 'bin': walk(n.a); walk(n.b); break
      case 'cond': walk(n.c); walk(n.a); walk(n.b); break
      case 'call':
        if (n.name === 'lookup' && n.args[0]?.t === 'lit' && typeof n.args[0].v === 'string') lookupFiles.push(n.args[0].v)
        n.args.forEach(walk)
        break
      default: break
    }
  }
  walk(ast)
  const fn = ((env: CalcEnv) => format(evaluate(ast, env))) as CompiledExpr
  fn.lookupFiles = lookupFiles
  fn.columns = columns
  return fn
}
