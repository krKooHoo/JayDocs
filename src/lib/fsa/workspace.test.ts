import { describe, expect, it } from 'vitest'
import { queryRoot, within } from './workspace'

/** queryPermission 만 있는 가짜 핸들 */
const handle = (answer: Promise<PermissionState>) => ({ queryPermission: () => answer }) as unknown as FileSystemHandle

describe('권한 확인 시간 제한 (DESIGN §22 U14)', () => {
  it('답하면 그 값', async () => {
    expect(await queryRoot(handle(Promise.resolve('granted')), false, 50)).toBe('granted')
    expect(await queryRoot(handle(Promise.resolve('prompt')), true, 50)).toBe('prompt')
  })

  it('끝내 답하지 않으면 timeout — 시작이 멈추지 않는다', async () => {
    expect(await queryRoot(handle(new Promise(() => {})), false, 20)).toBe('timeout')
  })

  it('실패는 그대로 던진다', async () => {
    await expect(queryRoot(handle(Promise.reject(new Error('없음'))), false, 50)).rejects.toThrow('없음')
  })

  it('within: 시간 안이면 값, 아니면 timeout', async () => {
    expect(await within(Promise.resolve(false), 50)).toBe(false)
    expect(await within(new Promise<boolean>(() => {}), 20)).toBe('timeout')
  })
})
