import { useSyncExternalStore } from 'react'

/**
 * 앱 설치와 자동 업데이트.
 * 앱을 켤 때, 창으로 돌아올 때, 1시간마다 새 버전을 확인한다. 사용자가 바로 확인할 수도 있다 (DESIGN §22).
 * 새 버전은 서비스 워커가 받아 대기시키고, 모든 창을 닫으면 다음 실행에 적용된다. 바로 적용은 사용자가 고른다.
 * 저장 안 한 문서가 있을 때 저절로 새로고침하는 일은 없다.
 */
interface InstallEvent extends Event {
  prompt(): Promise<void>
}

const CHECK_MS = 60 * 60 * 1000
/** 창으로 돌아올 때 확인하는 최소 간격 */
const FOCUS_CHECK_MS = 10 * 60 * 1000

export const APP_VERSION = __APP_VERSION__

export type CheckResult = 'latest' | 'downloading' | 'ready' | 'offline' | 'unavailable'

class PwaState {
  version = 0
  canInstall = false
  updateReady = false
  checking = false
  /** 새 버전 파일을 받다가 실패했다. 다시 확인하면 다시 받는다 */
  downloadFailed = false
  private installEvent: InstallEvent | null = null
  private reg: ServiceWorkerRegistration | null = null
  private downloadingSw: ServiceWorker | null = null
  private waiting: ServiceWorker | null = null
  private applying = false
  private lastCheck = 0
  private listeners = new Set<() => void>()

  get canCheck() { return this.reg !== null }
  get downloading() { return this.downloadingSw !== null }

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => { this.listeners.delete(l) }
  }
  getVersion = () => this.version
  private emit() {
    this.version++
    for (const l of this.listeners) l()
  }

  /** beforeinstallprompt 는 일찍 온다 — 화면을 그리기 전에 부른다 */
  start() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault()
      this.installEvent = e as InstallEvent
      this.canInstall = true
      this.emit()
    })
    window.addEventListener('appinstalled', () => {
      this.installEvent = null
      this.canInstall = false
      this.emit()
    })
    if (import.meta.env.PROD && 'serviceWorker' in navigator) void this.register()
  }

  private markWaiting(sw: ServiceWorker) {
    this.waiting = sw
    this.updateReady = true
    this.emit()
  }

  /** 파일을 다 받으면 대기로, 하나라도 못 받으면 서비스 워커가 버려진다 */
  private track(sw: ServiceWorker) {
    if (this.downloadingSw === sw) return
    this.downloadingSw = sw
    this.downloadFailed = false
    this.emit()
    sw.addEventListener('statechange', () => {
      if (this.downloadingSw !== sw) return
      if (sw.state === 'installed') {
        this.downloadingSw = null
        this.markWaiting(sw)
      } else if (sw.state === 'redundant') {
        this.downloadingSw = null
        this.downloadFailed = true
        this.emit()
      }
    })
  }

  private checkQuietly() {
    this.lastCheck = Date.now()
    void this.reg?.update().catch(() => { /* 오프라인 */ })
  }

  private async register() {
    let reg: ServiceWorkerRegistration
    try {
      reg = await navigator.serviceWorker.register('./sw.js')
    } catch (e) {
      console.warn('서비스 워커를 등록하지 못했습니다:', (e as Error).message)
      return
    }
    this.reg = reg
    this.emit()
    // controller 가 있어야 "업데이트"다 (없으면 첫 설치)
    const updating = !!navigator.serviceWorker.controller
    if (reg.waiting && updating) this.markWaiting(reg.waiting)
    if (reg.installing && updating) this.track(reg.installing)
    reg.addEventListener('updatefound', () => {
      if (reg.installing && navigator.serviceWorker.controller) this.track(reg.installing)
    })
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (this.applying) location.reload()
    })
    if (updating) this.checkQuietly()
    window.setInterval(() => this.checkQuietly(), CHECK_MS)
    window.addEventListener('focus', () => {
      if (Date.now() - this.lastCheck >= FOCUS_CHECK_MS) this.checkQuietly()
    })
  }

  /** 지금 새 버전이 있는지 서버에 묻는다. 있으면 서비스 워커가 바로 받기 시작한다 */
  async checkUpdate(): Promise<CheckResult> {
    const reg = this.reg
    if (!reg) return 'unavailable'
    if (this.updateReady) return 'ready'
    if (this.downloadingSw) return 'downloading'
    this.checking = true
    this.downloadFailed = false
    this.lastCheck = Date.now()
    this.emit()
    try {
      await reg.update()
      // updatefound 보다 먼저 올 수 있다 — 버튼이 잠깐 되돌아가지 않게 여기서 잡는다
      if (reg.installing) {
        this.track(reg.installing)
        return 'downloading'
      }
      return reg.waiting ? 'ready' : 'latest'
    } catch {
      return 'offline'
    } finally {
      this.checking = false
      this.emit()
    }
  }

  async install() {
    const e = this.installEvent
    if (!e) return
    await e.prompt()
  }

  /** 대기 중인 새 버전을 지금 적용한다. 부르는 쪽에서 저장 여부를 먼저 확인한다 */
  applyUpdate() {
    if (!this.waiting) return
    // 다른 창에서 이미 적용했으면 다시 불러오기만 하면 된다
    if (this.waiting.state !== 'installed') { location.reload(); return }
    this.applying = true
    this.waiting.postMessage('skipWaiting')
  }
}

export const pwa = new PwaState()

export function usePwa() {
  useSyncExternalStore(pwa.subscribe, pwa.getVersion)
  return pwa
}
