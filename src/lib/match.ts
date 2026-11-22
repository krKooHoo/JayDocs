/**
 * 글자로 거르기 — 팔레트 · 파일 검색 · 경로 막대 목록이 같이 쓴다.
 * 띄어쓰기 없이 글자 순서만 맞아도 찾는다. 점수가 낮을수록 좋고, 맞지 않으면 null.
 */
export function matchScore(query: string, text: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const idx = t.indexOf(q)
  if (idx >= 0) return idx
  let pos = 0
  let gaps = 0
  for (const ch of q) {
    const i = t.indexOf(ch, pos)
    if (i < 0) return null
    gaps += i - pos
    pos = i + 1
  }
  return 1000 + gaps
}
