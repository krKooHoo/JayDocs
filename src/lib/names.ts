/**
 * 새 파일 · 새 폴더 · 이름 바꾸기에서 입력한 경로의 검사 (순수 함수, 파일 접근 없음).
 * 대화상자가 닫히기 전에 칸 아래에 이유를 보여 주려는 것이다 — 마지막 판단은 여전히 `fsaBackend` 가 한다.
 */
import { DOC_EXTS_LABEL, isDocName } from './filetypes.mjs'

/** 입력한 글 → 앱 경로. `\` 는 `/` 로, 앞뒤 공백과 `/` 는 뗀다 */
export function cleanEntryPath(input: string): string {
  return input.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

/** Windows 가 이름에 받지 않는 글자 (별칭 검사 `roots.mjs` 와 같은 집합에서 경로 구분자만 뺐다) */
const BAD_CHARS = /[<>:"|?*\u0000-\u001f]/g

export interface EntryCheck {
  kind: 'file' | 'dir'
  /** 이미 있는 경로인가. 소문자로 바꾼 경로를 받는다 — Windows 는 대소문자를 가리지 않는다 */
  exists: (lowerPath: string) => boolean
  /** 이름 바꾸기일 때의 지금 경로. 대소문자만 바꾸는 것은 "이미 있음" 으로 보지 않는다 */
  current?: string
}

/** 경로(`cleanEntryPath` 를 거친 것)에 문제가 있으면 그 이유, 없으면 null */
export function checkEntryPath(path: string, o: EntryCheck): string | null {
  if (path === '') return '이름을 입력하세요'
  if (/^[a-zA-Z]:/.test(path)) return '절대 경로는 쓸 수 없습니다 — 문서 폴더 안의 경로를 넣으세요'
  const parts = path.split('/')
  if (parts.some((s) => s === '' || s === '.' || s === '..')) return '경로에 빈 이름 · "." · ".." 은 쓸 수 없습니다'
  const bad = [...new Set(path.match(BAD_CHARS) ?? [])]
  if (bad.length) return `이름에 쓸 수 없는 글자가 있습니다: ${bad.map((c) => (c < ' ' ? '(제어 문자)' : c)).join(' ')}`
  if (parts.some((s) => /[. ]$/.test(s))) return '이름은 점이나 공백으로 끝날 수 없습니다'
  if (parts.some((s) => s.toLowerCase() === '.git')) return '.git 폴더는 건드릴 수 없습니다'
  if (o.kind === 'file') {
    if (!isDocName(path)) return `${DOC_EXTS_LABEL} 중 하나로 끝나야 합니다`
    const name = parts[parts.length - 1]
    if (name.lastIndexOf('.') === 0) return '확장자 앞에 이름이 있어야 합니다'
  }
  const lower = path.toLowerCase()
  if (o.exists(lower) && lower !== o.current?.toLowerCase()) return `이미 있는 이름입니다: ${path}`
  return null
}

/**
 * 이름 입력 칸에서 처음 선택할 범위 — 마지막 `/` 뒤부터 확장자 앞까지 [시작, 끝).
 * 바로 치면 폴더와 확장자는 남고 이름만 바뀐다. 확장자가 없으면(폴더) 이름 전체.
 */
export function nameStemRange(path: string): [number, number] {
  const start = path.lastIndexOf('/') + 1
  const dot = path.lastIndexOf('.')
  return [start, dot > start ? dot : path.length]
}
