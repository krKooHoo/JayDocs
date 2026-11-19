import { describe, expect, it } from 'vitest'
import { askConfirm, askText, currentDialog, dialogCount, dialogOpen, settleDialog, subscribeDialogs } from './dialogs'

describe('대화상자 줄 세우기', () => {
  it('한 번에 하나만 뜨고, 닫히면 다음 것이 뜬다', async () => {
    expect(dialogOpen()).toBe(false)
    const a = askText({ title: '첫째' })
    const b = askConfirm({ title: '둘째', message: '지울까요?' })
    const c = askText({ title: '셋째' })
    expect(dialogCount()).toBe(3)
    expect(currentDialog()?.opts.title).toBe('첫째')

    settleDialog(currentDialog()!.id, 'a.md')
    expect(await a).toBe('a.md')
    expect(currentDialog()?.opts.title).toBe('둘째')

    settleDialog(currentDialog()!.id, true)
    expect(await b).toBe(true)
    expect(currentDialog()?.opts.title).toBe('셋째')

    settleDialog(currentDialog()!.id, null)
    expect(await c).toBeNull()
    expect(dialogOpen()).toBe(false)
    expect(currentDialog()).toBeNull()
  })

  it('떠 있는 것이 아니면 답을 받지 않는다 (줄에 선 것 · 이미 닫힌 것)', async () => {
    const a = askConfirm({ title: 'a', message: '' })
    const b = askConfirm({ title: 'b', message: '' })
    const first = currentDialog()!.id
    expect(settleDialog(first + 1, true)).toBe(false) // 아직 줄에 서 있는 b
    expect(dialogCount()).toBe(2)
    expect(settleDialog(first, false)).toBe(true)
    expect(settleDialog(first, true)).toBe(false) // 두 번 눌린 버튼
    expect(await a).toBe(false)
    expect(dialogCount()).toBe(1)
    settleDialog(currentDialog()!.id, true)
    expect(await b).toBe(true)
  })

  it('취소는 글 입력이면 null, 확인이면 false', async () => {
    const t = askText({ title: 't', value: '그대로' })
    settleDialog(currentDialog()!.id, null)
    expect(await t).toBeNull()
    const k = askConfirm({ title: 'k', message: '' })
    settleDialog(currentDialog()!.id, false)
    expect(await k).toBe(false)
    // 확인 창에 true 가 아닌 값이 와도 예로 치지 않는다
    const k2 = askConfirm({ title: 'k2', message: '' })
    settleDialog(currentDialog()!.id, 'yes')
    expect(await k2).toBe(false)
  })

  it('줄이 바뀔 때마다 구독자에게 알린다', () => {
    let calls = 0
    const off = subscribeDialogs(() => { calls++ })
    void askText({ title: 'x' })
    expect(calls).toBe(1)
    settleDialog(currentDialog()!.id, null)
    expect(calls).toBe(2)
    off()
    void askText({ title: 'y' })
    expect(calls).toBe(2)
    settleDialog(currentDialog()!.id, null)
  })
})
