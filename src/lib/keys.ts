/**
 * 키보드 이벤트 ↔ `Ctrl+Shift+P` 같은 문자열. 단축키 표(shortcuts-table.mjs)와 같은 표기를 쓴다.
 * 글자 키는 `code` 로 읽어 키보드 배열(한글 자판 등)에 흔들리지 않게 한다. Mac 의 ⌘ 는 Ctrl 로 본다.
 */
const CODE_KEYS: Record<string, string> = {
  Equal: '=',
  Minus: '-',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Slash: '/',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS', 'Process', 'Dead'])

export function comboFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  let key: string | null = null
  const code = e.code ?? ''
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5)
  else if (/^F([1-9]|1[0-2])$/.test(code)) key = code
  else if (CODE_KEYS[code]) key = CODE_KEYS[code]
  else if (e.key.length === 1) key = e.key.toUpperCase()
  else if (e.key === 'Escape') key = 'Esc'
  else key = e.key
  if (!key) return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

const ORDER = ['Ctrl', 'Alt', 'Shift']

/** `shift+ctrl+p` → `Ctrl+Shift+P` */
export function normalizeCombo(s: string): string {
  const raw = s.trim().split('+').map((p) => p.trim()).filter(Boolean)
  // 'Ctrl+\\' 처럼 마지막이 '+' 자체인 경우
  if (s.trim().endsWith('+') && raw[raw.length - 1] !== '+') raw.push('+')
  const mods: string[] = []
  let key = ''
  for (const p of raw) {
    const lower = p.toLowerCase()
    if (lower === 'ctrl' || lower === 'cmd' || lower === 'meta' || lower === '⌘') mods.push('Ctrl')
    else if (lower === 'alt' || lower === 'option') mods.push('Alt')
    else if (lower === 'shift') mods.push('Shift')
    else key = p.length === 1 ? p.toUpperCase() : p
  }
  if (key.toLowerCase() === 'escape') key = 'Esc'
  mods.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  return [...new Set(mods), key].join('+')
}

/** 입력 중인 곳(에디터·입력란)에 포커스가 있나 — 글자 키 단축키를 피할 때 */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
