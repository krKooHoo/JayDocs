/**
 * 폴더의 전체 경로 (DESIGN §21). 브라우저는 폴더 이름만 알려 주므로 사용자가 넣고,
 * 앱은 경로 끝이 고른 폴더의 이름과 맞는지만 확인한다.
 */
const WIN_DRIVE = /^[A-Za-z]:[\\/]/
const WIN_UNC = /^\\\\[^\\]/
const WIN_BAD_CHARS = /[<>"|?*\u0000-\u001f]/

const isWindowsPath = (p: string) => WIN_DRIVE.test(p) || WIN_UNC.test(p)
const sepOf = (p: string) => (isWindowsPath(p) ? '\\' : '/')
const sameName = (a: string, b: string) => a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase()

/** 붙여 넣은 경로 다듬기: 앞뒤 공백·따옴표, Windows 경로의 `/`, 끝의 구분자 (드라이브 루트와 `/` 는 둔다) */
export function cleanPath(raw: string): string {
  let p = raw.trim().replace(/^"(.*)"$/, '$1').trim()
  if (isWindowsPath(p)) p = p.replace(/\//g, '\\')
  if (p === '/' || /^[A-Za-z]:\\$/.test(p)) return p
  return p.replace(/[\\/]+$/, '')
}

function lastSegment(p: string): string {
  const parts = p.split(sepOf(p)).filter(Boolean)
  return parts.length > 1 || !isWindowsPath(p) ? parts[parts.length - 1] ?? '' : ''
}

/** 다듬은 경로의 문제. 없으면 null */
export function checkPath(path: string, folder: string): string | null {
  if (!isWindowsPath(path) && !path.startsWith('/')) return '전체 경로를 넣으세요 — 탐색기 주소 표시줄의 경로를 복사해 붙여 넣으면 됩니다'
  if (isWindowsPath(path) && WIN_BAD_CHARS.test(path)) return '경로에 쓸 수 없는 글자가 있습니다 (< > " | ? *)'
  const last = lastSegment(path)
  // 드라이브 루트는 이름을 비교할 수 없다
  if (last && !sameName(last, folder)) return `고른 폴더는 "${folder}" 인데 경로는 "${last}" 로 끝납니다`
  return null
}

/** 전체 경로 + 그 안의 앱 경로(`/` 구분). rel 이 비면 폴더 자체 */
export function joinLocal(base: string, rel: string): string {
  if (!rel) return base
  const sep = sepOf(base)
  return (base.endsWith(sep) ? base : base + sep) + rel.split('/').join(sep)
}

/** 아는 경로와 같은 곳에 있다고 보고 미리 채울 값. 부모를 모르면 '' */
export function guessPath(known: string, folder: string): string {
  const sep = sepOf(known)
  const i = known.lastIndexOf(sep)
  if (i < 0 || !lastSegment(known)) return ''
  return known.slice(0, i + 1) + folder
}
