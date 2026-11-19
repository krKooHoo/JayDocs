/**
 * 새 문서 창의 템플릿 표 — 한 곳에서 관리한다 (PLAN-skim SK9, 내용은 §3).
 * 형식 표(`filetypes.mjs`)의 모든 형식에 빈 문서 하나 · 예시 하나가 있다 (테스트가 검사한다).
 *
 * - 새 파일은 LF · 끝 개행 · BOM 없음. **CSV 예시만 맨 앞에 BOM** (Excel 이 한글을 바로 읽게 — UTF-8 로 바꿔 저장할 때와 같은 이유).
 * - 빈 `.md` · `.txt` 는 0바이트, 빈 `.json` 은 `{}`.
 * - 빈 `.tsv` · `.csv` 는 0바이트가 아니라 그리드의 "타입 행·헤더 행 만들기" / "머리글 행 만들기" 버튼이 만드는 것과 같은 가장 작은 표 —
 *   0바이트 표는 그 버튼을 누르기 전에는 입력할 칸이 없다 (§5 확인).
 * - 내 템플릿(SK10)은 주 폴더의 `_templates/` 바로 아래 파일이다. 표는 여기 없고 트리에서 찾는다(`userTemplatePaths`).
 */
import type { TreeEntry } from './backend'
import { fileTypeOf } from './filetypes.mjs'
import { cleanEntryPath } from './names'
import { seedHeaderTable, seedTypedTable } from './tsv/edits'
import { parseTable, serializeTable } from './tsv/table'

export type TemplateGroup = 'blank' | 'sample'

export interface DocTemplate {
  id: string
  /** 만들 파일의 확장자 (`.md` …) — 형식 표의 ext */
  ext: string
  group: TemplateGroup
  title: string
  /** 카드 아래 한 줄 설명 */
  desc: string
  /** 파일에 그대로 써질 글 */
  body: string
}

/** 그리드의 빈 표 버튼과 같은 함수로 만든 가장 작은 표 + 끝 개행 */
function seededTable(ext: '.tsv' | '.csv'): string {
  const empty = parseTable('', `새 문서${ext}`)
  const seeded = ext === '.tsv' ? seedTypedTable(empty) : seedHeaderTable(empty)
  return serializeTable({ ...seeded, trailingNewline: true })
}

const lines = (...ls: string[]) => ls.join('\n') + '\n'

const SAMPLE_MD = lines(
  '# 문서 제목',
  '',
  '마크다운 문서다. 위의 보기 모드에서 소스 · 하이브리드 · 분할 · 미리보기를 고른다.',
  '',
  '## 글',
  '',
  '**굵게**, *기울임*, `코드`, [링크](https://example.com)',
  '',
  '- 목록',
  '- [ ] 할 일',
  '- [x] 끝낸 일',
  '',
  '> 인용',
  '',
  '## 표',
  '',
  '| 이름 | 값 |',
  '|---|---|',
  '| 가 | 1 |',
  '| 나 | 2 |',
  '',
  '## 그림',
  '',
  '```mermaid',
  'graph LR',
  '  기획 --> 제작 --> 검수',
  '```',
  '',
  '## 표 파일 연결',
  '',
  '`tsv-view` 코드 블록에 `file: 표.tsv` 를 적으면 표 파일의 내용이 이 자리에 보인다.',
)

// 칸 사이는 탭. 타입이 빈 마지막 열은 주석 열.
// enum 열 이름은 §3 초안의 `Category` 가 아니라 `FoodGroup` — enum 후보는 같은 루트의 모든 `_Field` 파일에서 열 이름과 같은 블록을 찾는다.
// `Category` 는 게임 데이터에 흔한 블록 이름이라(개발 샘플 `Item_Field.tsv` 에도 있다) 겹치면 Fruit · Vegetable 이 검증 오류가 된다
const SAMPLE_TSV = lines(
  '#string\tstring\tenum\tbool\tuint\tfloat\t',
  'Key\tDisplayName\tFoodGroup\tEnabled\tCount\tRate\t#메모',
  'Apple\t사과\tFruit\tTRUE\t10\t0.5\t1행은 타입, 2행은 머리글',
  'Carrot\t당근\tVegetable\tTRUE\t4\t1.25\tKey 는 파일 안에서 유일',
  'Salt\t소금\tEtc\tFALSE\t0\t0\t머리글이 # 로 시작하면 주석 열',
)

const SAMPLE_CSV = '﻿' + lines(
  '이름,분류,수량,메모',
  '사과,과일,10,"쉼표, 줄바꿈이 든 칸은 따옴표로 감싼다"',
  '당근,채소,4,',
  '소금,기타,0,Alt+Enter 로 칸 안에서 줄을 바꾼다',
)

const SAMPLE_TXT = lines(
  '메모',
  '',
  '꾸밈 없는 글이다. 쓴 그대로 저장된다.',
  '- 줄바꿈과 띄어쓰기가 그대로 남는다.',
  '- 제목 · 표 · 그림이 필요하면 마크다운(.md)으로 만든다.',
)

const SAMPLE_JSON = lines(
  '{',
  '  "name": "예시",',
  '  "version": 1,',
  '  "enabled": true,',
  '  "tags": ["a", "b"],',
  '  "size": { "width": 1920, "height": 1080 }',
  '}',
)

/** 표의 순서가 창의 순서다. 첫 항목(빈 마크다운)이 처음 선택 */
export const TEMPLATES: readonly DocTemplate[] = [
  { id: 'blank-md', ext: '.md', group: 'blank', title: '빈 마크다운', desc: '아무것도 없는 문서', body: '' },
  { id: 'blank-tsv', ext: '.tsv', group: 'blank', title: '빈 TSV 표', desc: '타입 행 · 머리글 행 · 빈 행', body: seededTable('.tsv') },
  { id: 'blank-csv', ext: '.csv', group: 'blank', title: '빈 CSV 표', desc: '머리글 행 · 빈 행 (3열)', body: seededTable('.csv') },
  { id: 'blank-txt', ext: '.txt', group: 'blank', title: '빈 텍스트', desc: '아무것도 없는 글', body: '' },
  { id: 'blank-json', ext: '.json', group: 'blank', title: '빈 JSON', desc: '빈 객체 {}', body: '{}\n' },

  { id: 'sample-md', ext: '.md', group: 'sample', title: '마크다운', desc: '제목 · 목록 · 표 · 그림이 있는 글. 보기 모드로 소스와 렌더를 오간다.', body: SAMPLE_MD },
  { id: 'sample-tsv', ext: '.tsv', group: 'sample', title: 'TSV 표', desc: '타입이 있는 표. 1행은 타입, 2행은 머리글, Key 는 파일 안에서 유일하다.', body: SAMPLE_TSV },
  { id: 'sample-csv', ext: '.csv', group: 'sample', title: 'CSV 표', desc: 'Excel 과 주고받는 표. 첫 줄이 머리글이다.', body: SAMPLE_CSV },
  { id: 'sample-txt', ext: '.txt', group: 'sample', title: '텍스트', desc: '꾸밈 없는 글. 쓴 그대로 저장된다.', body: SAMPLE_TXT },
  { id: 'sample-json', ext: '.json', group: 'sample', title: 'JSON', desc: '설정 · 데이터. 문법을 검사하고 "정렬"로 들여쓰기를 맞춘다.', body: SAMPLE_JSON },
]

/** 그 형식의 빈 문서 (이름 끝에 확장자를 직접 쳤을 때 옮겨 갈 곳) */
export function blankTemplateFor(ext: string): DocTemplate | undefined {
  const e = ext.toLowerCase()
  return TEMPLATES.find((t) => t.group === 'blank' && t.ext === e)
}

// ---------------------------------------------------------------- 이름 칸 → 경로 (SK8)

/** 이름 칸 끝에 직접 친 지원 확장자 (`메모.txt` → `.txt`, 소문자). 없으면 undefined */
export function typedExt(input: string): string | undefined {
  return fileTypeOf(cleanEntryPath(input))?.ext
}

/**
 * 이름 칸의 글 + 고른 템플릿의 확장자 → 만들 경로. 이름 끝에 지원 확장자를 직접 쳤으면 붙이지 않는다.
 * 빈 칸은 '' (검사가 "이름을 입력하세요"), `/` 로 끝나면 빈 이름이 남게 둔다(검사가 거부한다). 나머지 검사는 `checkEntryPath`.
 */
export function newDocPath(input: string, ext: string): string {
  const raw = input.trim().replace(/\\/g, '/')
  const path = cleanEntryPath(raw)
  if (path === '') return ''
  if (raw.endsWith('/')) return path + '/'
  return fileTypeOf(path) ? path : path + ext
}

/** 이름 칸 끝의 지원 확장자를 뗀다 — 다른 형식의 템플릿으로 옮길 때 */
export function stripTypedExt(input: string): string {
  const ext = typedExt(input)
  if (!ext) return input
  const trimmed = input.trimEnd()
  return trimmed.slice(0, trimmed.length - ext.length)
}

// ---------------------------------------------------------------- 내 템플릿 (SK10)

/** 주 폴더 루트의 내 템플릿 폴더. 가져온 폴더(`@별칭`)의 것은 보지 않는다 */
export const TEMPLATES_DIR = '_templates'

/**
 * 트리에서 내 템플릿 파일 경로들 — 주 폴더의 `_templates/` 바로 아래(하위 폴더는 보지 않는다), 지원 형식만, 이름 순.
 * 폴더 이름은 대소문자를 가리지 않는다 (Windows). UTF-8 인지는 여기서 모른다 — 읽어 본 쪽이 거른다.
 */
export function userTemplatePaths(entries: readonly TreeEntry[]): string[] {
  const dir = entries.find((e) => e.type === 'dir' && !e.mount && e.path.toLowerCase() === TEMPLATES_DIR)
  if (!dir) return []
  return (dir.children ?? [])
    .filter((e) => e.type === 'file' && fileTypeOf(e.name) !== undefined)
    .map((e) => e.path)
    .sort((a, b) => a.localeCompare(b, 'ko'))
}

/** `a/b/메모.txt` → `메모.txt` */
export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
