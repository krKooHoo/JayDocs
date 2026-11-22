/**
 * 줄을 바꾸는 표 칸의 최소 폭 (하이브리드 표 DESIGN §23 H10 · tsv-view).
 * 칸은 아무 데서나 줄을 바꿀 수 있게 두므로(overflow-wrap: anywhere) 최소 폭이 없으면
 * 긴 칸 옆의 짧은 칸이 한두 글자 폭으로 눌린다. 칸 글이 짧으면 한 줄에 다 들어갈 만큼, 길면 maxEm 까지 —
 * 짧은 칸은 꺾이지 않고 긴 칸만 줄을 바꾼다. 넓은 글자 1.1em, 나머지 0.65em 으로 넉넉히 어림한다.
 *
 * pad: 칸의 좌우 여백 + 테두리 · 반올림 몫(px).
 */
export function minCellWidth(raw: string, pad: number, maxEm = 10): string | undefined {
  let w = 0
  for (const ch of raw) {
    w += (ch.codePointAt(0) ?? 0) >= 0x1100 ? 1.1 : 0.65
    if (w >= maxEm) break
  }
  return w > 0 ? `calc(${Math.min(w, maxEm).toFixed(1)}em + ${pad}px)` : undefined
}
