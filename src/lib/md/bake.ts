import type { TsvTable } from '../tsv/model'
import { isNumericType, type TableSchema } from '../tsv/schema'
import { applyTsvView, compileWhere, parseTsvViewSpec, resolveViewPath, type TsvViewSpec } from './tsvView'

/**
 * `bake: true` 인 tsv-view 펜스 바로 아래에 파이프 표를 다시 생성한다 (DESIGN §7.1).
 * GitHub 에서도 진짜 표가 보이게 하는 대신 파생 내용이 diff 에 섞인다 — 기본값은 꺼짐.
 *
 *   ```tsv-view
 *   file: …
 *   bake: true
 *   ```
 *   <!-- tsv-view:baked -->
 *   | Key | … |
 *   <!-- /tsv-view -->
 */
export const BAKE_START = '<!-- tsv-view:baked -->'
export const BAKE_END = '<!-- /tsv-view -->'

export interface TsvViewFence {
  /** 펜스 시작(``` 줄의 첫 글자) */
  from: number
  /** 닫는 ``` 줄의 끝 (줄바꿈 제외) */
  to: number
  body: string
  spec: TsvViewSpec
  /** 펜스 뒤에 이미 있는 baked 블록 (있으면 마커 포함 범위) */
  baked: { from: number; to: number } | null
}

const FENCE = /^([ \t]{0,3})(`{3,}|~{3,})[ \t]*tsv-view[ \t]*$/

/** 문서 안의 tsv-view 펜스를 모두 찾는다. 줄바꿈은 \n 기준 (CRLF 도 \n 위치로 찾는다) */
export function findTsvViewFences(text: string): TsvViewFence[] {
  const out: TsvViewFence[] = []
  const lines = text.split('\n')
  const starts: number[] = []
  let pos = 0
  for (const l of lines) { starts.push(pos); pos += l.length + 1 }
  const lineEnd = (i: number) => starts[i] + lines[i].replace(/\r$/, '').length

  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i].replace(/\r$/, ''))
    if (!m) continue
    const fenceChars = m[2]
    let j = i + 1
    while (j < lines.length) {
      const l = lines[j].replace(/\r$/, '')
      if (l.trim().startsWith(fenceChars[0].repeat(3)) && l.trim().replace(/[`~]/g, '') === '' && l.trim().length >= fenceChars.length) break
      j++
    }
    if (j >= lines.length) break // 닫히지 않은 펜스
    const body = lines.slice(i + 1, j).map((l) => l.replace(/\r$/, '')).join('\n')
    const fence: TsvViewFence = { from: starts[i], to: lineEnd(j), body, spec: parseTsvViewSpec(body), baked: null }
    // 바로 다음 줄(빈 줄 하나까지 허용)에 baked 블록이 있나
    let k = j + 1
    if (k < lines.length && lines[k].trim() === '') k++
    if (k < lines.length && lines[k].trim() === BAKE_START) {
      let e = k + 1
      while (e < lines.length && lines[e].trim() !== BAKE_END) e++
      if (e < lines.length) fence.baked = { from: starts[k], to: lineEnd(e) }
    }
    out.push(fence)
    i = fence.baked ? Math.max(j, lines.findIndex((_, idx) => idx > j && starts[idx] > fence.baked!.to) - 1) : j
  }
  return out
}

function esc(v: string): string {
  // 파이프 표 칸은 한 줄이어야 한다 — CSV 칸 안 줄바꿈은 <br>
  return v.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

/** 결과를 GFM 파이프 표로 */
export function renderPipeTable(spec: TsvViewSpec, table: TsvTable, schema: TableSchema): { markdown: string; error: string | null } {
  const r = applyTsvView(spec, table, schema)
  if (r.columns.length === 0) return { markdown: '', error: r.error ?? '열이 없습니다' }
  const lines: string[] = []
  lines.push(`| ${r.columns.map((c) => esc(c.name || `${c.index + 1}열`)).join(' | ')} |`)
  lines.push(`| ${r.columns.map((c) => (isNumericType(c.type) ? '---:' : '---')).join(' | ')} |`)
  for (const row of r.rows) lines.push(`| ${row.cells.map(esc).join(' | ')} |`)
  return { markdown: lines.join('\n'), error: r.error }
}

export interface BakeSource {
  table: TsvTable
  schema: TableSchema
}
export interface BakeChange {
  from: number
  to: number
  insert: string
}
export interface BakeResult {
  changes: BakeChange[]
  errors: string[]
  /** 구운 펜스 수 */
  count: number
  /** bake 할 펜스가 참조하는 파일들 (불러와야 할 것) */
  files: string[]
}

/** bake 할 펜스들이 참조하는 TSV 경로 (리포 상대) */
export function bakeTargets(text: string, mdPath: string): string[] {
  const files = new Set<string>()
  for (const f of findTsvViewFences(text)) if (f.spec.bake && f.spec.file) files.add(resolveViewPath(f.spec.file, mdPath))
  return [...files]
}

/**
 * 문서 텍스트에 적용할 변경 목록을 만든다 (원문 기준 오프셋, 서로 겹치지 않음).
 * resolve 는 이미 불러온 표를 돌려준다 — 없으면 그 펜스는 건너뛰고 오류로 남긴다.
 */
export function bakeMarkdown(text: string, mdPath: string, resolve: (file: string) => BakeSource | null, eol = '\n'): BakeResult {
  const changes: BakeChange[] = []
  const errors: string[] = []
  const files: string[] = []
  let count = 0
  for (const f of findTsvViewFences(text)) {
    if (!f.spec.bake) continue
    if (!f.spec.file) { errors.push('bake: file 이 없는 tsv-view'); continue }
    const file = resolveViewPath(f.spec.file, mdPath)
    files.push(file)
    const src = resolve(file)
    if (!src) { errors.push(`bake: ${file} 을 읽지 못해 건너뜀`); continue }
    // where 식이 틀리면 걸러지지 않은 표 전체가 써지게 된다 → 이 펜스는 건너뛰고 지금 baked 표를 그대로 둔다
    if (f.spec.where) {
      try { compileWhere(f.spec.where) } catch (e) {
        errors.push(`bake: ${file} — where: ${(e as Error).message} (건너뜀, 기존 표 유지)`)
        continue
      }
    }
    const { markdown, error } = renderPipeTable(f.spec, src.table, src.schema)
    if (error) errors.push(`bake: ${file} — ${error}`)
    if (!markdown) continue
    const block = `${BAKE_START}${eol}${markdown.replace(/\n/g, eol)}${eol}${BAKE_END}`
    if (f.baked) {
      const current = text.slice(f.baked.from, f.baked.to)
      if (current !== block) changes.push({ from: f.baked.from, to: f.baked.to, insert: block })
    } else {
      changes.push({ from: f.to, to: f.to, insert: `${eol}${block}` })
    }
    count++
  }
  return { changes, errors, count, files }
}

export function applyChanges(text: string, changes: BakeChange[]): string {
  let out = ''
  let last = 0
  for (const c of [...changes].sort((a, b) => a.from - b.from)) {
    out += text.slice(last, c.from) + c.insert
    last = c.to
  }
  return out + text.slice(last)
}

/** 미리보기에서는 baked 블록을 숨긴다 (살아 있는 tsv-view 가 그 자리에 있다) */
export function stripBaked(text: string): string {
  return text.replace(/\n?<!-- tsv-view:baked -->[\s\S]*?<!-- \/tsv-view -->/g, '')
}

export interface StrippedText {
  /** baked 블록을 걷어 낸 글 — `stripBaked(원문)` 과 같다 */
  text: string
  /**
   * 걷어 낸 글의 줄 → 원문 줄. `lines[i]` 는 걷어 낸 글의 (i + 1)번째 줄이 시작하는 원문 줄 번호(1부터).
   * 길이는 걷어 낸 글의 줄 수와 같다. 줄은 `\n` 으로 센다 (CRLF 도 `\n` 위치로 세므로 번호는 같다).
   */
  lines: number[]
}

/**
 * `stripBaked` 와 같은 글을 돌려주면서, 그 글의 줄이 원문의 몇 번째 줄인지도 같이 준다 (PLAN-skim SK5).
 * 미리보기 · 훑어보기는 걷어 낸 글을 그리므로, 그린 조각의 줄 번호를 편집기(원문)의 줄로 되돌릴 때 쓴다.
 */
export function stripBakedWithLines(text: string): StrippedText {
  const re = /\n?<!-- tsv-view:baked -->[\s\S]*?<!-- \/tsv-view -->/g
  const lines: number[] = [1]
  let out = ''
  let last = 0
  /** 원문에서 지금 보고 있는 자리의 줄 번호 */
  let line = 1
  const keep = (seg: string) => {
    for (let i = seg.indexOf('\n'); i >= 0; i = seg.indexOf('\n', i + 1)) lines.push(++line)
    out += seg
  }
  for (const m of text.matchAll(re)) {
    keep(text.slice(last, m.index))
    for (let i = m[0].indexOf('\n'); i >= 0; i = m[0].indexOf('\n', i + 1)) line++
    last = m.index + m[0].length
    // 블록이 줄 맨 앞에서 시작해 앞 줄바꿈 없이 걷혔다(글의 맨 처음) → 이 줄에 남는 것은 닫는 표식 뒤의 글이다
    if (!m[0].startsWith('\n') && (out === '' || out.endsWith('\n'))) lines[lines.length - 1] = line
  }
  keep(text.slice(last))
  return { text: out, lines }
}
