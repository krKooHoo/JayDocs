import { describe, expect, it } from 'vitest'
import { pinnedConfig, toggleTransientTabs, transientSlot, transientTabsOn, type TabInfo } from './transientTabs'

/** 임시 탭 (ADOPT D2 · DESIGN §58) */

const tab = (id: string, transient = false, dirty = false): TabInfo => ({ id, path: id + '.md', transient, dirty })

describe('임시 탭', () => {
  it('임시 탭이 있으면 그 자리를 바꾼다', () => {
    expect(transientSlot([tab('a'), tab('b', true), tab('c')])).toEqual({ replace: 'b', index: 1 })
  })
  it('임시 탭이 없거나 고친 채로 남아 있으면 새로 붙인다', () => {
    expect(transientSlot([tab('a'), tab('c')])).toBeNull()
    expect(transientSlot([tab('a'), tab('b', true, true)])).toBeNull()
    expect(transientSlot([])).toBeNull()
  })
  it('고정 — 임시 표시만 뺀다', () => {
    expect(pinnedConfig({ path: 'a.md', transient: true })).toEqual({ path: 'a.md' })
    expect(pinnedConfig(undefined)).toEqual({})
  })
  it('기본 켜짐, 켜고 끄기', () => {
    expect(transientTabsOn()).toBe(true)
    expect(toggleTransientTabs()).toBe(false)
    expect(toggleTransientTabs()).toBe(true)
  })
})
