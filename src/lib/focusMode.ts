import { useSyncExternalStore } from 'react'

/**
 * 집중 모드 (ADOPT D3 · DESIGN §59) — 위 막대 · 파일 트리 · 탭 줄 · 창 막대 · 목차 · 훑어보기 패널을 한 번에 숨기고,
 * 분할 중이면 포커스가 있는 창만 남긴다(나머지 창은 그대로 있다가 나가면 돌아온다). 본문은 읽기 좋은 폭으로 가운데에.
 * `Ctrl+Alt+Enter` 로 들어가고 같은 키로 나온다. 숨기는 것은 `<html class="focus-mode">` 아래 CSS.
 * 새로고침하면 꺼진 채로 시작한다(남기지 않는다).
 */
let on = false
const listeners = new Set<() => void>()

export function focusModeOn(): boolean {
  return on
}

export function setFocusMode(next: boolean): void {
  if (on === next) return
  on = next
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('focus-mode', on)
  for (const l of listeners) l()
}

export function onFocusMode(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useFocusMode(): boolean {
  return useSyncExternalStore(onFocusMode, focusModeOn)
}

/** 들어갈 때 적어 두는 것 — 나올 때 그대로 되돌린다 */
export interface FocusRestore {
  /** 파일 트리가 펴져 있었나 */
  treeOpen: boolean
  /** 들어가며 창 하나만 남기려고 최대화한 탭 묶음 (원래 최대화돼 있었으면 null — 건드리지 않았다) */
  maximized: string | null
}

/**
 * 들어갈 때 할 일. `tabsets` 는 탭이 든 탭 묶음 수, `alreadyMaximized` 는 이미 최대화된 묶음이 있는지.
 * 창이 둘 이상이고 최대화된 것이 없을 때만 포커스 창을 최대화한다.
 */
export function focusEnterPlan(target: string, tabsets: number, alreadyMaximized: boolean, treeOpen: boolean): FocusRestore {
  return { treeOpen, maximized: tabsets > 1 && !alreadyMaximized ? target : null }
}
