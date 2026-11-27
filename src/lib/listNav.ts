/**
 * 목록에서 ↑ / ↓ 한 칸 — 끝에서 더 가면 반대쪽 끝으로 돈다 (팔레트 · 맥락 메뉴 · 빠른 열기, 2026-11-27 Jay).
 * `PageUp / PageDown` 은 돌지 않는다(끝에서 멈춘다). 목록이 비면 0
 */
export function stepWrap(index: number, delta: 1 | -1, length: number): number {
  if (length <= 0) return 0
  const i = Math.min(Math.max(index, 0), length - 1)
  return (i + delta + length) % length
}
