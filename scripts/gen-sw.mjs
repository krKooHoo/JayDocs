#!/usr/bin/env node
/**
 * 빌드 뒤에 dist/sw.js 를 만든다 — dist 의 모든 파일을 미리 받아 오프라인으로도 돌게 한다.
 * 파일 내용이 바뀌면 sw.js 의 BUILD 가 바뀌어 브라우저가 새 버전으로 알아본다.
 * 새 버전은 대기하다가 모든 창이 닫히면 적용된다 (앱이 skipWaiting 을 보내면 바로).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

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

const hash = crypto.createHash('sha256')
for (const rel of files) hash.update(rel).update(fs.readFileSync(path.join(DIST, rel)))
const build = hash.digest('hex').slice(0, 16)

const sw = `// npm run build 가 만든다 (scripts/gen-sw.mjs). 직접 고치지 않는다.
const BUILD = ${JSON.stringify(build)}
const CACHE = 'jaydocs-' + BUILD
const FILES = ${JSON.stringify(['./', ...files.map((f) => './' + f)], null, 2)}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)))
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
console.log(`dist/sw.js  빌드 ${build}, 파일 ${files.length}개`)
