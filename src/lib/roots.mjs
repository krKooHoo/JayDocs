/**
 * 가져온 폴더(마운트)의 경로 규칙 — 사이드카와 앱이 같이 쓴다 (PLAN-folder-import F1).
 *
 *   주 폴더    `10-World/Tile/Tile.md`          (지금 그대로)
 *   가져온 폴더 `@수업자료/03주차/과제.md`        (`@별칭/` + 그 폴더 안 상대 경로)
 *
 * 순수 함수만 둔다 (fs 없음). 절대 경로 겹침 검사 같은 OS 일은 사이드카가 한다.
 */

/** 앱 경로가 가져온 폴더 쪽인가 */
export function isMountPath(path) {
  return typeof path === 'string' && path.startsWith('@')
}

/**
 * 앱 경로 → { alias, rel }. 주 폴더면 alias 가 null.
 * `@a` 만 있으면 rel 은 '' (그 폴더 자체).
 * @param {string} path
 * @returns {{ alias: string | null; rel: string }}
 */
export function splitRootPath(path) {
  if (!isMountPath(path)) return { alias: null, rel: path }
  const i = path.indexOf('/')
  return i < 0 ? { alias: path.slice(1), rel: '' } : { alias: path.slice(1, i), rel: path.slice(i + 1) }
}

/**
 * { alias, rel } → 앱 경로
 * @param {string | null} alias
 * @param {string} rel
 */
export function joinRootPath(alias, rel) {
  if (alias === null) return rel
  return rel ? `@${alias}/${rel}` : `@${alias}`
}

/** 경로의 루트 접두 (`@a/` 또는 주 폴더면 '') */
export function rootPrefix(path) {
  const { alias } = splitRootPath(path)
  return alias === null ? '' : `@${alias}/`
}

/** 두 경로가 같은 루트(주 폴더 또는 같은 가져온 폴더)에 있는가 */
export function sameRoot(a, b) {
  return splitRootPath(a).alias === splitRootPath(b).alias
}

/**
 * `base` 와 같은 루트 안의 경로. rel 은 그 루트 기준 (앞의 `/` 는 무시).
 * tsv-view 의 `file:`, lookup 파일, `/` 로 시작하는 링크가 이 규칙을 따른다.
 * @param {string} base 기준 문서 경로
 * @param {string} rel  루트 기준 경로
 */
export function inRootOf(base, rel) {
  return rootPrefix(base) + rel.replace(/^\/+/, '')
}

/** 별칭으로 쓸 수 없는 글자: 경로 구분자, Windows 금지 문자, 제어 문자 */
const BAD_ALIAS = /[\\/:*?"<>|\u0000-\u001f]/

/**
 * 별칭이 올바른가. 비어 있지 않고, 점으로 시작하지 않고, 40자 이하, 경로 구분자·금지 문자 없음
 * @param {string} alias
 */
export function isValidAlias(alias) {
  return typeof alias === 'string' && alias.trim() === alias && alias.length > 0 && alias.length <= 40 && !alias.startsWith('.') && !BAD_ALIAS.test(alias)
}

/**
 * 폴더 이름에서 별칭을 만든다. 쓸 수 없는 글자는 `_`, 이미 있는 별칭이면 `-2`, `-3` …
 * @param {string} folderName
 * @param {Iterable<string>} taken 이미 쓰는 별칭 (대소문자 무시)
 */
export function makeAlias(folderName, taken) {
  let base = String(folderName).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/^\.+/, '').slice(0, 36)
  if (!base) base = 'folder'
  const used = new Set([...taken].map((t) => t.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const cand = `${base}-${n}`
    if (!used.has(cand.toLowerCase())) return cand
  }
}

/** Unity 프로젝트 등을 통째로 가져와도 가볍게 — 가져온 폴더에서만 기본으로 빼는 폴더 이름 */
export const MOUNT_IGNORE_DIRS = ['Library', 'Temp', 'Logs', 'obj', 'Build', 'Builds', 'UserSettings', 'MemoryCaptures']

/** 가져온 폴더 하나에서 훑는 최대 항목 수 (폴더 + 파일) */
export const MOUNT_SCAN_LIMIT = 20000
