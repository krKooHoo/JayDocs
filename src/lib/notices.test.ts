import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTICE_ACTION_MS, NOTICE_MAX, NOTICE_MS, dismissAllNotices, dismissNotice, noticeList, notify, notifyError, runNoticeAction, subscribeNotices } from './notices'

const texts = () => noticeList().map((n) => n.text)

describe('알림 줄', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { dismissAllNotices(); vi.useRealTimers() })

  it('안내는 몇 초 뒤 사라지고 실패는 남는다', () => {
    notify('저장했습니다')
    notifyError('지우지 못했습니다')
    expect(texts()).toEqual(['저장했습니다', '지우지 못했습니다'])
    vi.advanceTimersByTime(NOTICE_MS - 1)
    expect(texts()).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(texts()).toEqual(['지우지 못했습니다'])
    vi.advanceTimersByTime(60_000)
    expect(texts()).toEqual(['지우지 못했습니다'])
  })

  it('동작 버튼이 달린 안내는 더 오래 남는다', () => {
    notify('열 2개를 지웠습니다', { action: { label: '되돌리기', run: () => {} } })
    vi.advanceTimersByTime(NOTICE_MS)
    expect(texts()).toHaveLength(1)
    vi.advanceTimersByTime(NOTICE_ACTION_MS - NOTICE_MS)
    expect(texts()).toHaveLength(0)
  })

  it('같은 key 의 알림은 하나만 남는다 (다른 key 는 그대로)', () => {
    notify('3×2 붙여넣음', { key: 'grid:a.tsv' })
    notifyError('먼저 저장하세요', { key: 'file', items: ['a.md'] })
    notify('행 1개 추가', { key: 'grid:a.tsv' })
    expect(texts()).toEqual(['먼저 저장하세요', '행 1개 추가'])
    // 바뀐 알림의 시계는 새로 돈다 — 앞의 것의 타이머가 뒤의 것을 지우지 않는다
    vi.advanceTimersByTime(NOTICE_MS - 1)
    expect(texts()).toContain('행 1개 추가')
  })

  it('번호 · key · 전부로 닫는다', () => {
    const a = notifyError('a')
    notifyError('b', { key: 'k' })
    notifyError('c', { key: 'k2' })
    dismissNotice(a)
    expect(texts()).toEqual(['b', 'c'])
    dismissNotice('k')
    expect(texts()).toEqual(['c'])
    dismissAllNotices()
    expect(texts()).toEqual([])
  })

  it('동작을 누르면 알림이 닫히고 동작이 한 번 돈다', () => {
    let ran = 0
    const id = notify('열 1개를 지웠습니다', { action: { label: '되돌리기', run: () => { ran++ } } })
    runNoticeAction(id)
    expect(ran).toBe(1)
    expect(texts()).toEqual([])
    runNoticeAction(id) // 이미 닫힌 알림
    expect(ran).toBe(1)
  })

  it(`${NOTICE_MAX}개를 넘으면 오래된 것부터 내린다`, () => {
    for (let i = 1; i <= NOTICE_MAX + 2; i++) notifyError(`오류 ${i}`)
    expect(texts()).toEqual(Array.from({ length: NOTICE_MAX }, (_, i) => `오류 ${i + 3}`))
  })

  it('목록이 그대로면 같은 배열을 준다 (useSyncExternalStore 의 스냅샷)', () => {
    notifyError('a')
    const snap = noticeList()
    let calls = 0
    const off = subscribeNotices(() => { calls++ })
    dismissNotice('없는 key')
    dismissNotice(99999)
    expect(noticeList()).toBe(snap)
    expect(calls).toBe(0)
    notify('b')
    expect(noticeList()).not.toBe(snap)
    expect(calls).toBe(1)
    off()
  })

  it('빈 목록(items)은 붙이지 않는다', () => {
    notifyError('먼저 저장하세요', { items: [] })
    expect(noticeList()[0].items).toBeUndefined()
  })
})
