/**
 * 글을 클립보드에 넣는다. 먼저 Clipboard API, 막히면(권한 · 포커스) 옛 방식(`execCommand('copy')`)으로 한 번 더.
 * 둘 다 안 되면 false — 부른 쪽이 글을 화면에 보여 손으로 복사하게 한다.
 * 옛 방식은 사용자 동작(클릭 · 키) 안에서만 된다.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return copyByCommand(text)
  }
}

function copyByCommand(text: string): boolean {
  if (typeof document === 'undefined') return false
  const before = document.activeElement as HTMLElement | null
  const box = document.createElement('textarea')
  box.value = text
  box.setAttribute('readonly', '')
  box.style.position = 'fixed'
  box.style.opacity = '0'
  box.style.pointerEvents = 'none'
  document.body.append(box)
  box.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  box.remove()
  before?.focus?.()
  return ok
}
