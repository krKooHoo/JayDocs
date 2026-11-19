/**
 * 글의 앞부분만 — 썸네일은 문서 앞쪽만 보이므로 긴 글을 통째로 그리지 않는다 (PLAN-skim SK3).
 * 줄은 `\n` 으로 센다 (먼저 `normalizeText` 로 맞춘 글을 넣는다).
 */

/** BOM 을 떼고 줄바꿈을 LF 로 맞춘다. 줄 수와 줄 번호는 편집기(CodeMirror)와 같다 — `\r\n` · `\r` · `\n` 이 각각 한 줄바꿈 */
export function normalizeText(raw: string): string {
  const s = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return s.includes('\r') ? s.replace(/\r\n?/g, '\n') : s
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * 앞 `maxLines` 줄. 그보다 짧으면 받은 글 그대로(같은 문자열).
 * `md` 면 코드 펜스 한가운데에서 자르지 않는다 — 열린 펜스가 닫히는 줄까지 더 간다(최대 `maxLines` 의 2배).
 * 잘린 뒤쪽에 있는 참조 링크 정의 · 각주는 반영되지 않는다 (썸네일에서는 보이지 않는 차이다).
 */
export function headText(text: string, maxLines: number, kind: 'md' | 'text' = 'text'): string {
  if (!(maxLines > 0)) return ''
  let pos = 0
  let count = 0
  /** 열린 펜스의 글자와 길이 */
  let fence: { ch: string; len: number } | null = null
  const hard = maxLines * 2
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos)
    const end = nl < 0 ? text.length : nl
    if (kind === 'md') {
      const m = FENCE.exec(text.slice(pos, Math.min(end, pos + 200)))
      if (m) {
        if (!fence) fence = { ch: m[1][0], len: m[1].length }
        else if (m[1][0] === fence.ch && m[1].length >= fence.len && text.slice(pos, end).trim() === m[1]) fence = null
      }
    }
    count++
    if (nl < 0) return text
    pos = nl + 1
    if ((count >= maxLines && !fence) || count >= hard) return pos >= text.length ? text : text.slice(0, nl)
  }
  return text
}
