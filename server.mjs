#!/usr/bin/env node
/**
 * JayDocs 사이드카.
 * 정적 파일(dist/) 서빙 + 파일 API + 파일 변경 알림(SSE). 런타임 의존성 없음 (Node 22+).
 *
 *   node server.mjs --root <문서 폴더> [--port 0] [--open] [--dev] [--token <값>] [--keep]
 *
 * --open   기본 브라우저(Edge/Chrome 앱 모드)로 연다. 창이 닫히면 서버도 종료된다.
 * --dev    Vite 개발 서버(localhost:5173)의 프록시 요청을 허용하고 자동 종료를 끈다.
 * --token  고정 토큰(개발용). 기본은 시작할 때마다 난수.
 * --keep   브라우저가 끊겨도 종료하지 않는다.
 *
 * 보안: 127.0.0.1 에만 바인딩, 모든 /api 요청에 토큰, Host/Origin 검사, 경로는 root 아래로만.
 */
import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WIN = process.platform === 'win32'
const args = parseArgs(process.argv.slice(2))
const ROOT = path.resolve(String(args.root ?? process.cwd()))
const DEV = args.dev === true
const AUTO_EXIT = args.open === true && args.keep !== true && !DEV
const TOKEN = typeof args.token === 'string' ? args.token : crypto.randomBytes(16).toString('hex')
const DIST = path.join(HERE, 'dist')
const EXTS = new Set(['.md', '.tsv'])
const IGNORE_DIRS = new Set(['.git', 'node_modules'])
const MAX_BODY = 50 * 1024 * 1024

if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.error(`문서 폴더가 없습니다: ${ROOT}`)
  process.exit(1)
}
const ROOT_REAL = fs.realpathSync.native(ROOT)

// ---------------------------------------------------------------- 유틸
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++ } else out[key] = true
  }
  return out
}

function httpError(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

function isUnder(child, parent) {
  const c = WIN ? child.toLowerCase() : child
  const p = WIN ? parent.toLowerCase() : parent
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep)
}

/** 요청 경로를 root 아래의 절대 경로로. `..`, 절대 경로, 루트 밖 심볼릭 링크를 거부한다. */
async function resolveSafe(rel) {
  if (typeof rel !== 'string' || rel === '') throw httpError(400, 'path 가 필요합니다')
  const norm = rel.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (norm === '' || norm.split('/').some((s) => s === '..' || s === '' || s === '.')) throw httpError(400, '잘못된 경로')
  if (/^[a-zA-Z]:/.test(norm)) throw httpError(400, '절대 경로는 쓸 수 없습니다')
  const abs = path.resolve(ROOT, norm)
  if (!isUnder(abs, ROOT)) throw httpError(400, '루트 밖 경로')
  let probe = abs
  while (!fs.existsSync(probe)) probe = path.dirname(probe)
  const real = await fsp.realpath(probe)
  if (!isUnder(real, ROOT_REAL)) throw httpError(400, '루트 밖 경로(링크)')
  return { abs, rel: norm }
}

function json(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) { reject(httpError(413, '본문이 너무 큽니다')); req.destroy() }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) }
      catch { reject(httpError(400, 'JSON 본문이 아닙니다')) }
    })
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------- 파일
async function readTree(dirAbs, dirRel) {
  const dirents = await fsp.readdir(dirAbs, { withFileTypes: true })
  const entries = []
  for (const d of dirents) {
    if (d.name.startsWith('.') || IGNORE_DIRS.has(d.name)) continue
    const rel = dirRel ? `${dirRel}/${d.name}` : d.name
    if (d.isDirectory()) {
      entries.push({ type: 'dir', name: d.name, path: rel, children: await readTree(path.join(dirAbs, d.name), rel) })
    } else if (d.isFile() && EXTS.has(path.extname(d.name).toLowerCase())) {
      entries.push({ type: 'file', name: d.name, path: rel })
    }
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ko') : a.type === 'dir' ? -1 : 1))
  return entries
}

async function statOrNull(abs) {
  try { return await fsp.stat(abs) } catch { return null }
}

// ---------------------------------------------------------------- SSE + 감시
const clients = new Set()
let everConnected = false
let exitTimer = null

function sse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write(`event: hello\ndata: ${JSON.stringify({ root: ROOT })}\n\n`)
  clients.add(res)
  everConnected = true
  clearTimeout(exitTimer)
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
  req.on('close', () => {
    clearInterval(ping)
    clients.delete(res)
    scheduleExitCheck()
  })
}

function broadcast(obj) {
  const msg = `data: ${JSON.stringify(obj)}\n\n`
  for (const c of clients) c.write(msg)
}

function scheduleExitCheck() {
  if (!AUTO_EXIT) return
  clearTimeout(exitTimer)
  exitTimer = setTimeout(() => {
    if (clients.size === 0) { console.log('브라우저 연결이 끊겨 종료합니다.'); process.exit(0) }
  }, 15_000)
}

const pending = new Map()
try {
  fs.watch(ROOT, { recursive: true }, (event, filename) => {
    if (!filename) return
    const rel = String(filename).replace(/\\/g, '/')
    const top = rel.split('/')[0]
    if (IGNORE_DIRS.has(top) || top.startsWith('.')) return
    clearTimeout(pending.get(rel))
    pending.set(rel, setTimeout(() => {
      pending.delete(rel)
      broadcast({ type: 'change', event, path: rel })
    }, 150))
  })
} catch (e) {
  console.warn('파일 감시를 시작하지 못했습니다:', e.message)
}

// ---------------------------------------------------------------- API
let PORT = 0
function allowedOrigins() {
  const o = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]
  if (DEV) o.push('http://localhost:5173', 'http://127.0.0.1:5173')
  return o
}
function checkHost(req) {
  const host = req.headers.host ?? ''
  if (!allowedOrigins().includes(`http://${host}`)) throw httpError(403, `허용되지 않은 Host: ${host}`)
}
function checkOrigin(req) {
  const origin = req.headers.origin
  if (origin && !allowedOrigins().includes(origin)) throw httpError(403, `허용되지 않은 Origin: ${origin}`)
}

async function handleApi(req, res, url) {
  checkHost(req)
  const token = req.headers['x-token'] ?? url.searchParams.get('token')
  if (token !== TOKEN) throw httpError(401, '토큰이 맞지 않습니다')
  if (req.method !== 'GET') checkOrigin(req)
  const q = url.searchParams
  const route = `${req.method} ${url.pathname}`

  switch (route) {
    case 'GET /api/info':
      return json(res, 200, { root: ROOT, dev: DEV })

    case 'GET /api/tree':
      return json(res, 200, { root: ROOT, entries: await readTree(ROOT, '') })

    case 'GET /api/file': {
      const { abs, rel } = await resolveSafe(q.get('path'))
      const st = await statOrNull(abs)
      if (!st || !st.isFile()) throw httpError(404, '파일이 없습니다')
      return json(res, 200, { path: rel, text: await fsp.readFile(abs, 'utf8'), mtime: st.mtimeMs })
    }

    case 'PUT /api/file': {
      const { abs, rel } = await resolveSafe(q.get('path'))
      const body = await readJson(req)
      if (typeof body.text !== 'string') throw httpError(400, 'text 가 필요합니다')
      const st = await statOrNull(abs)
      if (st && !st.isFile()) throw httpError(400, '파일이 아닙니다')
      const base = typeof body.baseMtime === 'number' ? body.baseMtime : null
      // 낙관적 잠금: 디스크가 더 새로우면 409 와 함께 디스크 내용을 돌려준다.
      if (st && (base === null || Math.abs(st.mtimeMs - base) >= 1)) {
        return json(res, 409, { error: '디스크의 파일이 더 새롭습니다', mtime: st.mtimeMs, text: await fsp.readFile(abs, 'utf8') })
      }
      await fsp.mkdir(path.dirname(abs), { recursive: true })
      await fsp.writeFile(abs, body.text, 'utf8')
      const after = await fsp.stat(abs)
      return json(res, 200, { path: rel, mtime: after.mtimeMs })
    }

    case 'POST /api/mkdir': {
      const { abs, rel } = await resolveSafe(q.get('path'))
      await fsp.mkdir(abs, { recursive: true })
      return json(res, 200, { path: rel })
    }

    case 'GET /api/events':
      return sse(req, res)

    default:
      throw httpError(404, `알 수 없는 API: ${route}`)
  }
}

// ---------------------------------------------------------------- 정적 파일
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

function serveStatic(res, pathname) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('dist/index.html 이 없습니다. JayDocs 폴더에서 npm run build 를 먼저 실행하세요. (개발 중이면 npm run dev 로 localhost:5173 을 여세요)')
  }
  let p = decodeURIComponent(pathname)
  if (p === '/') p = '/index.html'
  let abs = path.resolve(DIST, '.' + p)
  if (!isUnder(abs, DIST) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) abs = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' })
  fs.createReadStream(abs).pipe(res)
}

// ---------------------------------------------------------------- 서버
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
    return serveStatic(res, url.pathname)
  } catch (e) {
    const status = e?.status ?? 500
    if (status === 500) console.error(e)
    if (!res.headersSent) json(res, status, { error: e?.message ?? String(e) })
    else res.end()
  }
})

function openBrowser(url) {
  const exes = WIN
    ? [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ]
    : []
  const exe = exes.find((p) => fs.existsSync(p))
  let child
  if (exe) child = spawn(exe, [`--app=${url}`], { detached: true, stdio: 'ignore' })
  else if (WIN) child = spawn('cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')], { detached: true, stdio: 'ignore', windowsHide: true })
  else child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' })
  child.unref()
}

server.listen(Number(args.port ?? 0), '127.0.0.1', () => {
  PORT = server.address().port
  const url = `http://127.0.0.1:${PORT}/#token=${TOKEN}`
  console.log(`JayDocs\n  문서 폴더: ${ROOT}\n  주소:      ${url}${DEV ? '\n  (개발 모드: Vite 5173 프록시 허용, 자동 종료 없음)' : ''}`)
  if (args.open === true) {
    openBrowser(url)
    if (AUTO_EXIT) setTimeout(() => {
      if (!everConnected) { console.log('60초 안에 브라우저가 연결되지 않아 종료합니다.'); process.exit(0) }
    }, 60_000)
  }
})
