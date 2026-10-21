/**
 * JayDocs 가 여는 파일 형식 — 한 곳에서 관리한다.
 * 사이드카(트리·감시·git 상태 걸러내기)와 앱(창 종류·아이콘·새 파일 검사)이 같이 읽는다.
 * 순수 데이터라 .mjs 다 (Vite 와 Node 둘 다 그대로 import 할 수 있게). 형식을 늘릴 때는 여기에 한 줄.
 *
 * kind — md: 마크다운 창(미리보기·하이브리드·bake) · table: 그리드 · text: 평문 에디터
 * lang — text 창의 구문 강조 (지금은 json 만)
 *
 * @typedef {'md' | 'table' | 'text'} FileKind
 * @typedef {{ ext: string; kind: FileKind; icon: string; label: string; lang?: 'json' }} FileType
 */

/** @type {FileType[]} */
export const FILE_TYPES = [
  { ext: '.md', kind: 'md', icon: '≡', label: '마크다운' },
  { ext: '.tsv', kind: 'table', icon: '⊞', label: 'TSV 표' },
  { ext: '.txt', kind: 'text', icon: '¶', label: '텍스트' },
  { ext: '.json', kind: 'text', icon: '{}', label: 'JSON', lang: 'json' },
]

/** 소문자 확장자 목록 (`.md` …) */
export const DOC_EXTS = FILE_TYPES.map((t) => t.ext)

/** 안내 문구용: `.md · .tsv · .txt · .json` */
export const DOC_EXTS_LABEL = DOC_EXTS.join(' · ')

/** 파일 텍스트를 열 수 있는 최대 크기 (그리드·에디터 보호) */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024

/**
 * 경로(또는 이름)의 형식. 모르는 확장자면 undefined.
 * @param {string} path
 * @returns {FileType | undefined}
 */
export function fileTypeOf(path) {
  const m = /\.[^./\\]+$/.exec(path)
  if (!m) return undefined
  const ext = m[0].toLowerCase()
  return FILE_TYPES.find((t) => t.ext === ext)
}

/**
 * 열 수 있는 문서인가
 * @param {string} path
 */
export function isDocName(path) {
  return fileTypeOf(path) !== undefined
}
