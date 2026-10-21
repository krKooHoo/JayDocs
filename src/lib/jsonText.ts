/**
 * JSON 파일 도우미 — 문법 오류 확인과 "JSON 정렬" 명령.
 * 정렬은 사용자가 고를 때만 한다 (자동으로 하면 diff 가 통째로 바뀐다).
 */

/** 문법 오류 메시지. 문제없거나 빈 파일이면 null */
export function jsonError(text: string): string | null {
  if (text.trim() === '') return null
  try {
    JSON.parse(text)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

/**
 * 값 토큰을 순서대로 — 문자열은 뜻(이스케이프를 푼 값), 숫자는 원문 그대로(`1.0`, `1e3`, 큰 정수).
 * 정렬 전후가 같으면 들여쓰기·공백만 바뀐 것이다.
 */
export function valueTokens(text: string): string[] {
  const out: string[] = []
  const re = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
  for (const m of text.matchAll(re)) out.push(m[0][0] === '"' ? 's' + (JSON.parse(m[0]) as string) : 'n' + m[0])
  return out
}

export type FormatResult = { ok: true; text: string } | { ok: false; error: string }

/**
 * 들여쓰기 2칸으로 다시 쓴다. 끝 개행 유무는 원래대로.
 * JSON.parse 를 거치면 `1.0` → `1`, 큰 정수의 자릿수 손실, 중복 키 제거, 숫자 모양 키("2","1")의 순서 바뀜이
 * 일어난다 — 값 토큰이 하나라도 달라지면 거부한다.
 */
export function formatJson(text: string): FormatResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `JSON 문법 오류: ${(e as Error).message}` }
  }
  let out = JSON.stringify(value, null, 2)
  if (/\r?\n$/.test(text)) out += '\n'
  const a = valueTokens(text)
  const b = valueTokens(out)
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
    return { ok: false, error: '정렬하면 내용이 바뀝니다 (1.0 → 1, 큰 정수, 중복 키, 숫자 키 순서 등) — 정렬하지 않았습니다' }
  }
  return { ok: true, text: out }
}
