#!/usr/bin/env node
/**
 * 빌드 뒤에 dist/sw.js 를 만든다 — dist 의 모든 파일을 미리 받아 오프라인으로도 돌게 한다.
 * 파일 내용이 바뀌면 sw.js 의 BUILD 가 바뀌어 브라우저가 새 버전으로 알아본다.
 * 새 버전은 대기하다가 모든 창이 닫히면 적용된다 (앱이 skipWaiting 을 보내면 바로).
 * 새 버전을 받을 때 이름에 내용 해시가 든 파일은 이전 버전 캐시에서 복사하고, 나머지만 네트워크로 받는다.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.join(path.dirname(SELF), '..')
const DIST = path.join(ROOT, 'dist')

/**
 * 재사용 기준: 이름이 같으면 내용도 같다고 믿을 수 있는 파일.
 * Vite 가 `assets/[name]-[hash].ext` 로 낸 파일만 해당한다 (vite.config.ts 의 *FileNames).
 * 해시는 rolldown 기본 8자 [A-Za-z0-9_-]. 둘 다 맞아야 재사용하고, 아니면 매번 새로 받는다.
 * index.html · manifest · 아이콘 · helper/ 처럼 public/ 에서 그대로 복사되는 파일은 이름이 같아도 내용이 바뀔 수 있다.
 */
const HASHED = /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/

// public/assets/ 가 있으면 해시 없는 파일이 assets/ 에 섞인다 — 위 기준이 깨지므로 빌드를 멈춘다
if (fs.existsSync(path.join(ROOT, 'public', 'assets'))) {
  console.error('public/assets/ 는 쓸 수 없습니다 — dist/assets/ 는 내용 해시가 든 파일만 두는 곳입니다 (scripts/gen-sw.mjs)')
  process.exit(1)
}

function walk(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, d.name)
    if (d.isDirectory()) walk(abs, out)
    else out.push(abs)
  }
  return out
}

const files = walk(DIST)
  .map((abs) => path.relative(DIST, abs).split(path.sep).join('/'))
  .filter((rel) => rel !== 'sw.js' && rel !== '.nojekyll')
  .sort()

const odd = files.filter((f) => f.startsWith('assets/') && !HASHED.test(f))
if (odd.length) console.warn(`assets/ 에 해시가 없어 보이는 파일 — 매번 새로 받는다: ${odd.join(', ')}`)

// 이 스크립트도 해시에 넣는다. sw.js 만 바뀌고 파일은 그대로인 빌드가 같은 캐시 이름을 쓰지 않게
// (install 이 실패하면 새 캐시를 지우는데, 그것이 지금 쓰는 캐시면 안 된다)
const hash = crypto.createHash('sha256').update(fs.readFileSync(SELF))
for (const rel of files) hash.update(rel).update(fs.readFileSync(path.join(DIST, rel)))
const build = hash.digest('hex').slice(0, 16)

const sw = `// npm run build 가 만든다 (scripts/gen-sw.mjs). 직접 고치지 않는다.
const BUILD = ${JSON.stringify(build)}
const CACHE = 'jaydocs-' + BUILD
const FILES = ${JSON.stringify(['./', ...files.map((f) => './' + f)], null, 2)}
// 이름에 내용 해시가 든 파일 — 이전 버전 캐시에 같은 주소가 있으면 내용도 같다 (gen-sw.mjs 의 HASHED)
const HASHED = ${JSON.stringify(files.filter((f) => HASHED.test(f)).map((f) => './' + f), null, 2)}

// 해시 없는 파일은 HTTP 캐시를 거치지 않고 받는다. Pages 의 max-age=600 때문에 옛 index.html 이 새 버전에 담길 수 있다.
// 하나라도 못 받으면 새 캐시를 지우고 실패한다 — 서비스 워커가 버려지고 지금 버전이 그대로 돈다 (cache.addAll 과 같은 결과).
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const hashed = new Set(HASHED)
    const olds = await Promise.all((await caches.keys())
      .filter((n) => n.startsWith('jaydocs-') && n !== CACHE)
      .map((n) => caches.open(n)))
    const cache = await caches.open(CACHE)
    const results = await Promise.allSettled(FILES.map(async (f) => {
      if (hashed.has(f)) {
        for (const old of olds) {
          const hit = await old.match(f, { ignoreVary: true })
          if (hit) return cache.put(f, hit)
        }
      }
      const res = await fetch(new Request(f, { cache: 'reload' }))
      if (!res.ok) throw new Error(f + ' ' + res.status)
      await cache.put(f, res)
    }))
    const failed = results.filter((r) => r.status === 'rejected')
    if (failed.length) {
      await caches.delete(CACHE)
      throw failed[0].reason
    }
  })())
})

// 지금 버전과 바로 전 버전만 남긴다. 아직 열려 있는 옛 창이 나중에 불러올 조각을 잃지 않게.
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = (await caches.keys()).filter((n) => n.startsWith('jaydocs-') && n !== CACHE)
    const stamped = await Promise.all(names.map(async (n) => {
      const res = await (await caches.open(n)).match('./')
      return { n, at: res ? Date.parse(res.headers.get('date') ?? '') || 0 : 0 }
    }))
    stamped.sort((a, b) => b.at - a.at)
    await Promise.all(stamped.slice(1).map((s) => caches.delete(s.n)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting()
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  e.respondWith((async () => {
    const cache = await caches.open(CACHE)
    if (req.mode === 'navigate') return (await cache.match('./')) ?? fetch(req)
    // 모듈 스크립트는 Origin 헤더를 달고 오므로 Vary 를 무시해야 미리 받은 파일과 맞는다
    const any = { ignoreVary: true }
    return (await cache.match(req, any)) ?? (await caches.match(req, any)) ?? fetch(req)
  })())
})
`
fs.writeFileSync(path.join(DIST, 'sw.js'), sw)
// Pages 의 Jekyll 이 밑줄로 시작하는 파일을 빼지 않게
fs.writeFileSync(path.join(DIST, '.nojekyll'), '')
const reused = files.filter((f) => HASHED.test(f)).length
console.log(`dist/sw.js  빌드 ${build}, 파일 ${files.length}개 (해시 든 ${reused}개는 이전 버전에 같은 이름이 있으면 재사용)`)
