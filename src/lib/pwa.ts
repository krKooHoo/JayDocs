import { useSyncExternalStore } from 'react'

/**
 * 앱 설치와 자동 업데이트.
 * 새 버전은 서비스 워커가 받아 대기시키고, 모든 창을 닫으면 다음 실행에 적용된다. 바로 적용은 사용자가 고른다.
 * 저장 안 한 문서가 있을 때 저절로 새로고침하는 일은 없다.
 */
interface InstallEvent extends Event {
  prompt(): Promise<void>
}

const CHECK_MS = 60 * 60 * 1000

class PwaState {
  version = 0
  canInstall = false
  updateReady = false
  private installEvent: InstallEvent | null = null
  private waiting: ServiceWorker | null = null
  private applying = false
  private listeners = new Set<() => void>()

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

  private async register() {
    let reg: ServiceWorkerRegistration
    try {
      reg = await navigator.serviceWorker.register('./sw.js')
    } catch (e) {
      console.warn('서비스 워커를 등록하지 못했습니다:', (e as Error).message)
      return
    }
    // controller 가 있어야 "업데이트"다 (없으면 첫 설치)
    if (reg.waiting && navigator.serviceWorker.controller) this.markWaiting(reg.waiting)
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) this.markWaiting(sw)
      })
    })
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (this.applying) location.reload()
    })
    window.setInterval(() => void reg.update().catch(() => { /* 오프라인 */ }), CHECK_MS)
  }

  async install() {
    const e = this.installEvent
    if (!e) return
    await e.prompt()
  }

  /** 대기 중인 새 버전을 지금 적용한다. 부르는 쪽에서 저장 여부를 먼저 확인한다 */
  applyUpdate() {
    if (!this.waiting) return
    this.applying = true
    this.waiting.postMessage('skipWaiting')
  }
}

export const pwa = new PwaState()

export function usePwa() {
  useSyncExternalStore(pwa.subscribe, pwa.getVersion)
  return pwa
}
