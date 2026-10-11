import { useSyncExternalStore } from 'react'
import { SHORTCUTS } from './shortcuts-table.mjs'
import { normalizeCombo } from './keys'

/**
 * 명령 레지스트리. 단축키 표의 `command` 와 명령 팔레트가 여기서 실행할 것을 찾는다.
 * 창(Workbench 등)이 마운트될 때 자기 명령을 등록하고 내릴 때 뺀다.
 */
export interface Command {
  id: string
  label: string
  /** 표시용. 단축키 표에서 자동으로 채운다 */
  keys?: string
  run: (arg?: unknown) => void
  enabled?: () => boolean
  /** 팔레트에 보이지 않게 (Alt+1 처럼 인자가 필요한 것) */
  hidden?: boolean
}

const registry = new Map<string, Command>()
const listeners = new Set<() => void>()
let version = 0

function emit() {
  version++
  for (const l of listeners) l()
}

/** 단축키 표에서 command → keys (첫 번째 것) */
const keysByCommand = new Map<string, string>()
/** 정규화한 키 → command (전역 처리기용). `…` 가 든 항목(Alt+1 … Alt+9)은 뺀다 */
export const commandByCombo = new Map<string, string>()
for (const g of SHORTCUTS) {
  for (const s of g.items) {
    if (!s.command) continue
    if (!keysByCommand.has(s.command)) keysByCommand.set(s.command, s.keys)
    if (!s.keys.includes('…')) commandByCombo.set(normalizeCombo(s.keys), s.command)
  }
}
for (let n = 1; n <= 9; n++) commandByCombo.set(`Alt+${n}`, `tab${n}`)

export function registerCommands(cmds: Command[]): () => void {
  for (const c of cmds) registry.set(c.id, { ...c, keys: c.keys ?? keysByCommand.get(c.id) })
  emit()
  return () => {
    for (const c of cmds) if (registry.get(c.id)?.run === c.run) registry.delete(c.id)
    emit()
  }
}

export function runCommand(id: string, arg?: unknown): boolean {
  const c = registry.get(id)
  if (!c || (c.enabled && !c.enabled())) return false
  c.run(arg)
  return true
}

export function hasCommand(id: string) {
  return registry.has(id)
}

export function allCommands(): Command[] {
  return [...registry.values()].filter((c) => !c.hidden).sort((a, b) => a.label.localeCompare(b.label, 'ko'))
}

export function useCommandsVersion() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => version,
  )
}
