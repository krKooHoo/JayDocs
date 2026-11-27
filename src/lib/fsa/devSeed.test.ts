import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeDir, asDir } from './fake'
import { DEV_DOCS, DEV_MOUNT, seedDevWorkspace } from './devSeed'

/** 개발용 `?opfs` 샘플 폴더 (DESIGN §24.7 X14) — 깨진 샘플 폴더는 지우고 다시 깐다 */

const notFound = () => Object.assign(new Error('A requested file or directory could not be found'), { name: 'NotFoundError' })

afterEach(() => { vi.restoreAllMocks() })

describe('seedDevWorkspace', () => {
  it('빈 저장소에 샘플을 깔고 작업 공간을 돌려준다', async () => {
    const opfs = new FakeDir('')
    const ws = await seedDevWorkspace(asDir(opfs))
    expect(opfs.names()).toEqual([DEV_DOCS, DEV_MOUNT])
    expect(opfs.text(`${DEV_DOCS}/docs/개요.md`)).toContain('# 개요')
    expect(opfs.text(`${DEV_DOCS}/메모.txt`)).toBe('메모\r\n')
    expect(opfs.text(`${DEV_MOUNT}/가져온 문서.md`)).toBe('# 가져온 문서\n')
    expect(ws.mounts.map((m) => m.alias)).toEqual(['가져온폴더'])
  })

  it('내용이 있는 샘플 · 시험 파일은 그대로 둔다', async () => {
    const opfs = new FakeDir('')
    opfs.put(`${DEV_DOCS}/docs/개요.md`, '고친 글')
    opfs.put(`${DEV_DOCS}/시험.md`, '시험')
    await seedDevWorkspace(asDir(opfs))
    expect(opfs.text(`${DEV_DOCS}/docs/개요.md`)).toBe('고친 글')
    expect(opfs.text(`${DEV_DOCS}/시험.md`)).toBe('시험')
  })

  it('샘플 하나를 만들 때 NotFoundError 가 나면 두 폴더를 지우고 다시 깐다 (전에는 시작 화면으로 떨어졌다)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const opfs = new FakeDir('')
    // 관찰한 상태: docs 에 개요.md 만 남고, 다음 샘플을 만들 때 NotFoundError
    opfs.put(`${DEV_DOCS}/docs/개요.md`, '# 개요\n')
    opfs.put(`${DEV_DOCS}/data/Item/.keep`, '')
    const docs = opfs.at(`${DEV_DOCS}/docs`) as FakeDir
    const real = docs.getFileHandle.bind(docs)
    docs.getFileHandle = async (name, opts) => { if (name === '표.tsv') throw notFound(); return real(name, opts) }

    await seedDevWorkspace(asDir(opfs))

    expect(opfs.text(`${DEV_DOCS}/docs/표.tsv`)).toContain('이름\t값')
    expect(opfs.text(`${DEV_MOUNT}/가져온 문서.md`)).toBe('# 가져온 문서\n')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain(`NotFoundError: ${DEV_DOCS}/docs/표.tsv`)
  })

  it('지우고 다시 깔아도 안 되면 어느 샘플인지 붙여 실패를 넘긴다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const opfs = new FakeDir('')
    const real = opfs.getDirectoryHandle.bind(opfs)
    opfs.getDirectoryHandle = async (name, opts) => {
      const d = await real(name, opts)
      if (name === DEV_MOUNT) (d as FakeDir).getFileHandle = async () => { throw notFound() }
      return d
    }
    await expect(seedDevWorkspace(asDir(opfs))).rejects.toMatchObject({ name: 'NotFoundError', message: expect.stringContaining(`${DEV_MOUNT}/가져온 문서.md`) })
  })
})
