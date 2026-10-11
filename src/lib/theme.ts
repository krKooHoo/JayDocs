import { useSyncExternalStore } from 'react'

/** 라이트 / 다크. `<html data-theme>` 로 적용하고 localStorage 에 남긴다. 처음엔 OS 설정을 따른다. */
export type Theme = 'light' | 'dark'

const KEY = 'jaydocs.theme'
const listeners = new Set<() => void>()
let current: Theme = load()

function load(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch { /* 무시 */ }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
  document.documentElement.style.colorScheme = t
}

export function getTheme(): Theme {
  return current
}

export function setTheme(t: Theme) {
  current = t
  apply(t)
  try { localStorage.setItem(KEY, t) } catch { /* 무시 */ }
  for (const l of listeners) l()
}

export function toggleTheme() {
  setTheme(current === 'dark' ? 'light' : 'dark')
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => current,
  )
}

apply(current)
