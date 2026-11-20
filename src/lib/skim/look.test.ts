import { describe, expect, it } from 'vitest'
import { LOOK_DEFAULT, LOOK_MIN_HEIGHT, LOOK_MIN_WIDTH, LOOK_SIZE_STEP, LOOK_ZOOM_MAX, LOOK_ZOOM_MIN, LOOK_ZOOM_STEPS, clampLookZoom, cleanLookPrefs, fitLookSize, isLookDefault, lookPrefs, lookResizeKey, lookZoomKey, resetLookPrefs, setLookPrefs, stepLookZoom } from './look'

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })

describe('훑어보기 창의 배율', () => {
  it('단계는 100% 를 지나고 오름차순이다', () => {
    expect(LOOK_ZOOM_STEPS).toContain(1)
    expect([...LOOK_ZOOM_STEPS].sort((a, b) => a - b)).toEqual([...LOOK_ZOOM_STEPS])
  })

  it('한 단계씩 오르내리고 끝에서 멈춘다', () => {
    expect(stepLookZoom(1, 1)).toBe(1.1)
    expect(stepLookZoom(1, -1)).toBe(0.9)
    expect(stepLookZoom(LOOK_ZOOM_MAX, 1)).toBe(LOOK_ZOOM_MAX)
    expect(stepLookZoom(LOOK_ZOOM_MIN, -1)).toBe(LOOK_ZOOM_MIN)
  })

  it('끝까지 올렸다 내리면 모든 단계를 거쳐 돌아온다', () => {
    let z: number = LOOK_ZOOM_MIN
    const up: number[] = [z]
    while (z < LOOK_ZOOM_MAX) { z = stepLookZoom(z, 1); up.push(z) }
    expect(up).toEqual([...LOOK_ZOOM_STEPS])
    const down: number[] = [z]
    while (z > LOOK_ZOOM_MIN) { z = stepLookZoom(z, -1); down.push(z) }
    expect(down).toEqual([...LOOK_ZOOM_STEPS].reverse())
  })

  it('단계 사이의 값은 그 방향의 가장 가까운 단계로 간다', () => {
    expect(stepLookZoom(1.2, 1)).toBe(1.25)
    expect(stepLookZoom(1.2, -1)).toBe(1.1)
  })

  it('범위 밖 · 숫자가 아닌 값을 고친다', () => {
    expect(clampLookZoom(10)).toBe(LOOK_ZOOM_MAX)
    expect(clampLookZoom(0.1)).toBe(LOOK_ZOOM_MIN)
    expect(clampLookZoom(NaN)).toBe(1)
    expect(clampLookZoom('2')).toBe(1)
    expect(clampLookZoom(undefined)).toBe(1)
  })
})

describe('훑어보기 창의 크기', () => {
  it('정해 둔 크기가 없으면 알아서 잡은 크기', () => {
    expect(fitLookSize(null, 600, LOOK_MIN_WIDTH, 1000)).toBe(600)
  })

  it('정해 둔 크기를 화면 안으로 줄이고, 최소보다 작아지지 않는다', () => {
    expect(fitLookSize(700, 600, LOOK_MIN_WIDTH, 1000)).toBe(700)
    expect(fitLookSize(1500, 600, LOOK_MIN_WIDTH, 1000)).toBe(1000)
    expect(fitLookSize(50, 600, LOOK_MIN_WIDTH, 1000)).toBe(LOOK_MIN_WIDTH)
  })

  it('자리가 최소보다 좁으면 자리만큼만 쓴다', () => {
    expect(fitLookSize(700, 600, LOOK_MIN_WIDTH, 200)).toBe(200)
    expect(fitLookSize(null, 600, LOOK_MIN_HEIGHT, -5)).toBe(0)
  })
})

describe('훑어보기 창의 키', () => {
  it('Ctrl+= · Ctrl++ 는 확대, Ctrl+- 는 축소', () => {
    expect(lookZoomKey(key('=', { ctrlKey: true }))).toBe(1)
    expect(lookZoomKey(key('+', { ctrlKey: true }))).toBe(1)
    expect(lookZoomKey(key('-', { ctrlKey: true }))).toBe(-1)
    expect(lookZoomKey(key('=', { metaKey: true }))).toBe(1)
  })

  it('Ctrl 이 없거나 Alt 가 같이 눌리면 아니다 (Ctrl+Alt+= 는 그리드의 행 삽입)', () => {
    expect(lookZoomKey(key('='))).toBe(0)
    expect(lookZoomKey(key('-'))).toBe(0)
    expect(lookZoomKey(key('=', { ctrlKey: true, altKey: true }))).toBe(0)
    expect(lookZoomKey(key('0', { ctrlKey: true }))).toBe(0)
  })

  it('Shift+방향키는 크기 — → ← 는 너비, ↓ ↑ 는 높이', () => {
    expect(lookResizeKey(key('ArrowRight', { shiftKey: true }))).toEqual([LOOK_SIZE_STEP, 0])
    expect(lookResizeKey(key('ArrowLeft', { shiftKey: true }))).toEqual([-LOOK_SIZE_STEP, 0])
    expect(lookResizeKey(key('ArrowDown', { shiftKey: true }))).toEqual([0, LOOK_SIZE_STEP])
    expect(lookResizeKey(key('ArrowUp', { shiftKey: true }))).toEqual([0, -LOOK_SIZE_STEP])
  })

  it('Shift 만일 때만 — 그냥 방향키(커서) · Ctrl+방향키(스크롤)는 아니다', () => {
    expect(lookResizeKey(key('ArrowDown'))).toBeNull()
    expect(lookResizeKey(key('ArrowDown', { shiftKey: true, ctrlKey: true }))).toBeNull()
    expect(lookResizeKey(key('Home', { shiftKey: true }))).toBeNull()
  })
})

describe('훑어보기 창 설정', () => {
  it('깨진 저장분은 기본값으로', () => {
    expect(cleanLookPrefs(null)).toEqual(LOOK_DEFAULT)
    expect(cleanLookPrefs('x')).toEqual(LOOK_DEFAULT)
    expect(cleanLookPrefs({ fileWidth: 'wide', height: NaN, zoom: 'big' })).toEqual(LOOK_DEFAULT)
  })

  it('크기는 최소 아래로 내려가지 않고, 배율은 범위 안에 든다', () => {
    const p = cleanLookPrefs({ fileWidth: 10, folderWidth: 640.4, height: 5, zoom: 9, gridZoom: 0.01 })
    expect(p).toEqual({ fileWidth: LOOK_MIN_WIDTH, folderWidth: 640, height: LOOK_MIN_HEIGHT, zoom: LOOK_ZOOM_MAX, gridZoom: LOOK_ZOOM_MIN })
  })

  it('바꾼 값만 바뀌고, 처음으로 되돌릴 수 있다', () => {
    resetLookPrefs()
    expect(isLookDefault()).toBe(true)
    setLookPrefs({ fileWidth: 700 })
    setLookPrefs({ zoom: 1.5 })
    expect(lookPrefs()).toEqual({ ...LOOK_DEFAULT, fileWidth: 700, zoom: 1.5 })
    expect(isLookDefault()).toBe(false)
    // 파일의 배율과 폴더 격자의 배율은 따로다
    setLookPrefs({ gridZoom: 2 })
    expect(lookPrefs().zoom).toBe(1.5)
    setLookPrefs({ fileWidth: null })
    expect(lookPrefs().fileWidth).toBeNull()
    resetLookPrefs()
    expect(lookPrefs()).toEqual(LOOK_DEFAULT)
  })
})
