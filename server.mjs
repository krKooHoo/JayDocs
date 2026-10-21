#!/usr/bin/env node
/**
 * JayDocs 사이드카.
 * 정적 파일(dist/) 서빙 + 파일 API + git API(PATH 의 git) + 파일 변경 알림(SSE). 런타임 의존성 없음 (Node 22+).
 *
 *   node server.mjs --root <문서 폴더> [--port 0] [--open] [--dev] [--token <값>] [--keep] [--ignore a,b]
 *   (아무 폴더에서 한 단어로 쓰려면 bin/jaydocs.mjs — `npm link` 뒤 `jaydocs [폴더]`)
 *
 * --open   기본 브라우저(Edge/Chrome 앱 모드)로 연다. 창이 닫히면 서버도 종료된다.
 * --dev    Vite 개발 서버(localhost:5173)의 프록시 요청을 허용하고 자동 종료를 끈다.
 * --token  고정 토큰(개발용). 기본은 시작할 때마다 난수.
 * --keep   브라우저가 끊겨도 종료하지 않는다.
 * --ignore 트리·파일 감시에서 뺄 폴더 이름(쉼표 구분). .git, node_modules, 점으로 시작하는 폴더는 항상 뺀다.
 *
 * 보안: 127.0.0.1 에만 바인딩, 모든 /api 요청에 토큰, Host/Origin 검사, 경로는 root 아래로만.
 */
import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { DOC_EXTS, MAX_TEXT_BYTES } from './src/lib/filetypes.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WIN = process.platform === 'win32'
const args = parseArgs(process.argv.slice(2))
const ROOT = path.resolve(String(args.root ?? process.cwd()))
const DEV = args.dev === true
const AUTO_EXIT = args.open === true && args.keep !== true && !DEV
const TOKEN = typeof args.token === 'string' ? args.token : crypto.randomBytes(16).toString('hex')
const DIST = path.join(HERE, 'dist')
const EXTS = new Set(DOC_EXTS)
const IGNORE_DIRS = new Set(['.git', 'node_modules'])
for (const n of String(args.ignore ?? '').split(',').map((s) => s.trim()).filter(Boolean)) IGNORE_DIRS.add(n)
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
  // .git 안은 어떤 API 로도 읽고 쓸 수 없다 (hooks/config 를 토큰만으로 고치는 길을 막는다)
  if (norm.split('/').some((s) => s.toLowerCase() === '.git')) throw httpError(400, '.git 폴더는 건드릴 수 없습니다')
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

/** 문서 파일을 바이트로. 너무 크면 거부 (그리드·에디터 보호) */
async function readTextFile(abs, st) {
  if (st.size > MAX_TEXT_BYTES) throw httpError(413, `파일이 너무 큽니다 (${(st.size / 1024 / 1024).toFixed(1)} MB, 최대 ${MAX_TEXT_BYTES / 1024 / 1024} MB)`)
  return fsp.readFile(abs)
}

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const EUCKR = new TextDecoder('euc-kr', { ignoreBOM: true })
/**
 * 바이트 → 텍스트. UTF-8 로 읽히면 그대로 (BOM 은 남긴다 — 앱이 보존한다).
 * 아니면 EUC-KR(CP949) 로 읽고 encoding 으로 알린다 — 앱은 읽기 전용으로 연다.
 * NUL 바이트나 UTF-16 BOM 이 있으면 텍스트 파일이 아니다.
 */
function decodeText(buf) {
  if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) throw httpError(415, 'UTF-16 파일은 열 수 없습니다 — UTF-8 로 저장한 뒤 여세요')
  if (buf.includes(0)) throw httpError(415, '텍스트 파일이 아닙니다 (바이너리)')
  try {
    return { text: UTF8.decode(buf), encoding: 'utf-8' }
  } catch {
    return { text: EUCKR.decode(buf), encoding: 'euc-kr' }
  }
}

async function statOrNull(abs) {
  try { return await fsp.stat(abs) } catch { return null }
}

async function lstatOrNull(abs) {
  try { return await fsp.lstat(abs) } catch { return null }
}

/** 트리에 보이는 문서인가 (형식 표의 확장자, 숨김·무시 폴더 밖). 경로는 root 기준, `/` 구분. */
function isDocPath(rel) {
  const segs = rel.split('/')
  if (segs.some((s) => s.startsWith('.') || IGNORE_DIRS.has(s))) return false
  return EXTS.has(path.posix.extname(rel).toLowerCase())
}

/** 이름 바꾸기·지우기용: resolveSafe + `.git` 폴더 안은 건드리지 않는다. */
async function resolveEditable(rel) {
  const r = await resolveSafe(rel)
  if (r.rel.split('/').some((s) => s.toLowerCase() === '.git')) throw httpError(400, '.git 폴더는 건드릴 수 없습니다')
  return r
}

const FS_ERRORS = {
  ENOENT: '경로가 없습니다',
  EEXIST: '이미 있습니다',
  ENOTEMPTY: '비어 있지 않은 폴더입니다',
  EPERM: '권한이 없거나 다른 프로그램이 쓰고 있습니다',
  EBUSY: '다른 프로그램이 쓰고 있습니다',
  EACCES: '권한이 없습니다',
  EINVAL: '잘못된 대상입니다',
  EXDEV: '다른 드라이브로는 옮길 수 없습니다',
  ENOTDIR: '폴더가 아닙니다',
  EISDIR: '폴더입니다',
}
/** 흔한 파일 시스템 오류는 400 으로, 나머지는 그대로(500). */
function fsFail(e, what) {
  const msg = FS_ERRORS[e?.code]
  return msg ? httpError(400, `${what}: ${msg}`) : e
}

// ---------------------------------------------------------------- git
// PATH 의 git 을 그대로 쓴다. 셸을 거치지 않고 인자 배열로만 넘기며, 경로 앞에는 항상 `--`.
const execFileP = promisify(execFile)
const GIT_OPTS = {
  cwd: ROOT,
  maxBuffer: 64 * 1024 * 1024,
  windowsHide: true,
  timeout: 120_000,
  encoding: 'utf8',
  env: {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0', // 자격 증명 프롬프트로 멈추지 않게
    GIT_OPTIONAL_LOCKS: '0', // status 가 index.lock 을 잡지 않게
    GIT_LITERAL_PATHSPECS: '1', // 파일 이름의 * ? : 를 패턴으로 해석하지 않게
    LANGUAGE: 'en', // stderr 를 영어(ASCII)로 고정 — 인코딩 깨짐 방지
  },
}
const REV_RE = /^(HEAD(~\d+)?|[0-9a-fA-F]{4,40})$/

/** git 실행. 0 이 아닌 종료 코드에도 throw 하지 않는다. git 이 없으면 code -1. */
async function git(args, { input } = {}) {
  const p = execFileP('git', args, GIT_OPTS)
  const stdin = p.child?.stdin
  if (stdin) {
    stdin.on('error', () => {}) // git 이 먼저 끝나면 EPIPE — 무시
    stdin.end(input ?? '', 'utf8')
  }
  try {
    const { stdout, stderr } = await p
    return { stdout, stderr, code: 0 }
  } catch (e) {
    if (typeof e.code === 'number') return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code }
    // ENOENT(git 없음), 시간 초과, maxBuffer 초과 등
    return { stdout: e.stdout ?? '', stderr: e.code === 'ENOENT' ? 'git 을 찾을 수 없습니다' : String(e.message ?? e), code: -1 }
  }
}

function gitMessage(r) {
  return (r.stderr.trim() || r.stdout.trim() || `git 이 실패했습니다 (종료 코드 ${r.code})`).replace(/\r\n/g, '\n')
}

/** 실패하면 git 의 메시지로 400. 성공하면 stdout. */
async function gitOrThrow(args, opts) {
  const r = await git(args, opts)
  if (r.code !== 0) throw httpError(400, gitMessage(r))
  return r.stdout
}

/**
 * 저장소 최상위와 ROOT 의 상대 위치. 성공한 결과만 캐시한다(나중에 git init 해도 잡히게).
 * git 이 없거나 ROOT 가 저장소 밖이면 null.
 */
let gitTopCache = null
async function gitTop() {
  if (gitTopCache) return gitTopCache
  const r = await git(['rev-parse', '--show-toplevel'])
  if (r.code !== 0 || !r.stdout.trim()) return null
  const top = path.resolve(r.stdout.trim())
  const base = [ROOT, ROOT_REAL].find((p) => isUnder(p, top))
  if (!base) return null
  const prefix = path.relative(top, base).split(path.sep).join('/')
  gitTopCache = { top, prefix }
  return gitTopCache
}

async function requireRepo() {
  const info = await gitTop()
  if (!info) throw httpError(400, '문서 폴더가 git 저장소 안에 있지 않습니다 (또는 git 을 찾을 수 없습니다)')
  return info
}

/** root 기준 경로 → 저장소 최상위 기준 경로 (`rev:path` 용). */
function toTop(info, rel) {
  return info.prefix ? `${info.prefix}/${rel}` : rel
}

/** 저장소 최상위 기준 경로 → root 기준 경로. root 밖이면 null. */
function fromTop(info, p) {
  if (!info.prefix) return p
  const pre = info.prefix + '/'
  const head = p.slice(0, pre.length)
  if (WIN ? head.toLowerCase() !== pre.toLowerCase() : head !== pre) return null
  return p.slice(pre.length)
}

async function gitBranch() {
  const r = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])
  return r.code === 0 ? r.stdout.trim() || null : null // detached HEAD 면 null
}

function checkRev(rev) {
  if (typeof rev !== 'string' || !REV_RE.test(rev)) throw httpError(400, '잘못된 리비전')
  return rev
}

/** 리비전을 커밋 해시로. 없으면 404. */
async function resolveRev(rev) {
  const r = await git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])
  if (r.code !== 0) throw httpError(404, '그 리비전을 찾을 수 없습니다')
  return r.stdout.trim()
}

/** 공백으로 n 개 필드로 자른다. 마지막 필드(경로)는 공백을 포함해 나머지 전부. */
function splitFields(s, n) {
  const out = []
  let pos = 0
  for (let k = 0; k < n - 1; k++) {
    const sp = s.indexOf(' ', pos)
    if (sp < 0) return null
    out.push(s.slice(pos, sp))
    pos = sp + 1
  }
  out.push(s.slice(pos))
  return out
}

function mapXY(xy, renamed) {
  if (xy.includes('D')) return 'D'
  if (xy.includes('A')) return 'A'
  if (renamed) return 'R'
  return 'M'
}

/** `git status --porcelain=v2 -z --branch` 출력 해석. 경로는 root 기준으로 바꾸고 root 밖·문서 아닌 것은 버린다. */
function parseStatus(out, info) {
  const recs = out.split('\0')
  let branch = null
  let upstream = null
  let ahead = 0
  let behind = 0
  const entries = []
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i]
    if (!r) continue
    if (r.startsWith('# ')) {
      if (r.startsWith('# branch.head ')) {
        const h = r.slice('# branch.head '.length)
        branch = h === '(detached)' ? null : h
      } else if (r.startsWith('# branch.upstream ')) {
        upstream = r.slice('# branch.upstream '.length)
      } else if (r.startsWith('# branch.ab ')) {
        // "# branch.ab +1 -0"
        const m = /\+(\d+) -(\d+)/.exec(r)
        if (m) { ahead = Number(m[1]); behind = Number(m[2]) }
      }
      continue
    }
    let status, p, orig
    if (r.startsWith('1 ')) {
      // 1 XY sub mH mI mW hH hI path
      const f = splitFields(r, 9)
      if (!f) continue
      status = mapXY(f[1], false)
      p = f[8]
    } else if (r.startsWith('2 ')) {
      // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const f = splitFields(r, 10)
      orig = recs[++i]
      if (!f) continue
      status = f[8].startsWith('C') ? mapXY(f[1] + 'A', false) : mapXY(f[1], true) // 복사는 새 파일로 본다
      p = f[9]
    } else if (r.startsWith('u ')) {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const f = splitFields(r, 11)
      if (!f) continue
      status = 'U'
      p = f[10]
    } else if (r.startsWith('? ')) {
      status = '?'
      p = r.slice(2)
    } else continue // '!' (무시된 파일) 등

    const rel = fromTop(info, p)
    if (rel === null) continue
    const origRel = orig ? fromTop(info, orig) : null
    if (!isDocPath(rel) && !(origRel && isDocPath(origRel))) continue
    const e = { path: rel, status }
    if (origRel) e.origPath = origRel
    entries.push(e)
  }
  entries.sort((a, b) => a.path.localeCompare(b.path, 'ko'))
  return { branch, upstream, ahead, behind, entries }
}

/** 쓰기 작업(commit/restore)은 한 번에 하나씩 — index.lock 충돌 방지. */
let gitChain = Promise.resolve()
function gitSerial(fn) {
  const run = gitChain.then(fn, fn)
  gitChain = run.catch(() => {})
  return run
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
    case 'GET /api/info': {
      const repo = (await gitTop()) !== null
      return json(res, 200, { root: ROOT, dev: DEV, git: repo, branch: repo ? await gitBranch() : null })
    }

    case 'GET /api/tree':
      return json(res, 200, { root: ROOT, entries: await readTree(ROOT, '') })

    case 'GET /api/file': {
      const { abs, rel } = await resolveSafe(q.get('path'))
      const st = await statOrNull(abs)
      if (!st || !st.isFile()) throw httpError(404, '파일이 없습니다')
      const { text, encoding } = decodeText(await readTextFile(abs, st))
      return json(res, 200, { path: rel, text, encoding, mtime: st.mtimeMs })
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
        const disk = decodeText(await readTextFile(abs, st))
        return json(res, 409, { error: '디스크의 파일이 더 새롭습니다', mtime: st.mtimeMs, text: disk.text, encoding: disk.encoding })
      }
      // UTF-8 이 아닌 파일(바이너리 포함)은 앱이 읽기 전용으로 연다. 덮어쓰기는 "UTF-8 로 바꿔 저장"(convert) 때만
      if (st && body.convert !== true && decodeText(await readTextFile(abs, st)).encoding !== 'utf-8') {
        throw httpError(400, 'UTF-8 이 아닌 파일입니다 — "UTF-8 로 바꿔 저장" 으로만 덮어쓸 수 있습니다')
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

    case 'POST /api/rename': {
      const body = await readJson(req)
      if (typeof body.from !== 'string' || typeof body.to !== 'string') throw httpError(400, 'from, to 가 필요합니다')
      const from = await resolveEditable(body.from)
      const to = await resolveEditable(body.to)
      if (from.abs === to.abs) throw httpError(400, '같은 경로입니다')
      const st = await lstatOrNull(from.abs)
      if (!st) throw httpError(400, '원본이 없습니다')
      // Windows 에서 대소문자만 바꾸는 경우는 대상이 "이미 있는" 것처럼 보이므로 따로 허용한다.
      const caseOnly = WIN && from.abs.toLowerCase() === to.abs.toLowerCase()
      if (!caseOnly && (await lstatOrNull(to.abs))) throw httpError(400, '대상이 이미 있습니다')
      if (!caseOnly && st.isDirectory() && isUnder(to.abs, from.abs)) throw httpError(400, '폴더를 자기 안으로 옮길 수 없습니다')
      try {
        await fsp.mkdir(path.dirname(to.abs), { recursive: true })
        await fsp.rename(from.abs, to.abs)
      } catch (e) {
        throw fsFail(e, '이름을 바꾸지 못했습니다')
      }
      return json(res, 200, { from: from.rel, to: to.rel })
    }

    case 'POST /api/delete': {
      const body = await readJson(req)
      const { abs, rel } = await resolveEditable(body.path)
      if (isUnder(ROOT, abs) || isUnder(ROOT_REAL, abs)) throw httpError(400, '문서 폴더 자체는 지울 수 없습니다')
      const st = await lstatOrNull(abs)
      if (!st) throw httpError(404, '파일이 없습니다')
      try {
        if (!st.isDirectory()) await fsp.unlink(abs)
        else if (body.recursive === true) await fsp.rm(abs, { recursive: true })
        else await fsp.rmdir(abs)
      } catch (e) {
        if (e?.code === 'ENOTEMPTY' || (e?.code === 'EEXIST' && st.isDirectory())) throw httpError(400, '비어 있지 않은 폴더입니다')
        throw fsFail(e, '지우지 못했습니다')
      }
      return json(res, 200, { path: rel })
    }

    case 'GET /api/git/status': {
      const info = await gitTop()
      if (!info) return json(res, 200, { repo: false, branch: null, entries: [] })
      const out = await gitOrThrow(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--', '.'])
      return json(res, 200, { repo: true, ...parseStatus(out, info) })
    }

    case 'GET /api/git/show': {
      const info = await requireRepo()
      const { rel } = await resolveSafe(q.get('path'))
      const rev = checkRev(q.get('rev') || 'HEAD')
      const spec = `${await resolveRev(rev)}:${toTop(info, rel)}`
      const t = await git(['cat-file', '-t', spec])
      if (t.code !== 0) throw httpError(404, '그 리비전에 파일이 없습니다')
      if (t.stdout.trim() !== 'blob') throw httpError(400, '파일이 아닙니다')
      const r = await git(['show', spec])
      if (r.code !== 0) throw httpError(404, '그 리비전에 파일이 없습니다')
      return json(res, 200, { path: rel, rev, text: r.stdout })
    }

    case 'GET /api/git/log': {
      await requireRepo()
      const rawLimit = q.get('limit')
      const limit = rawLimit === null || rawLimit === '' ? 100 : Number(rawLimit)
      if (!Number.isInteger(limit) || limit < 1) throw httpError(400, 'limit 는 1 이상의 정수여야 합니다')
      const rel = q.get('path') ? (await resolveSafe(q.get('path'))).rel : null
      // 커밋이 하나도 없으면 git log 가 실패하므로 빈 목록.
      if ((await git(['rev-parse', '--verify', '--quiet', 'HEAD'])).code !== 0) return json(res, 200, { entries: [] })
      const fmt = '--format=%H%x1f%h%x1f%aI%x1f%an%x1f%s'
      const max = `--max-count=${Math.min(limit, 10_000)}`
      const out = await gitOrThrow(rel ? ['log', '--follow', '-z', max, fmt, '--', rel] : ['log', '-z', max, fmt, '--', '.'])
      const entries = out
        .split('\0')
        .map((s) => s.replace(/^\n/, ''))
        .filter(Boolean)
        .map((s) => {
          const [hash, shortHash, date, author, ...subject] = s.split('\x1f')
          return { hash, shortHash, date, author, subject: subject.join('\x1f') }
        })
      return json(res, 200, { entries })
    }

    case 'POST /api/git/commit': {
      await requireRepo()
      const body = await readJson(req)
      if (!Array.isArray(body.paths) || body.paths.length === 0) throw httpError(400, 'paths 가 필요합니다')
      if (typeof body.message !== 'string' || body.message.trim() === '') throw httpError(400, '커밋 메시지가 필요합니다')
      const resolved = [...new Map((await Promise.all(body.paths.map((p) => resolveSafe(p)))).map((r) => [r.rel, r])).values()]
      const rels = resolved.map((r) => r.rel)
      const message = body.message.replace(/\r\n?/g, '\n')
      return await gitSerial(async () => {
        // add 는 디스크에 있는 경로만(새 파일을 git 에 알리기 위해). 이미 지워진 경로(git mv 의 원래 이름 등)를
        // add 에 넘기면 "pathspec did not match" 로 실패한다 — 수정·삭제는 commit --only 가 직접 반영한다.
        const onDisk = []
        for (const r of resolved) if (await lstatOrNull(r.abs)) onDisk.push(r.rel)
        if (onDisk.length) await gitOrThrow(['add', '-A', '--', ...onDisk])
        // 메시지는 stdin(UTF-8)으로 — 한글·여러 줄도 안전. --only: 이미 스테이징된 다른 파일은 섞지 않는다.
        await gitOrThrow(['commit', '--only', '-F', '-', '--', ...rels], { input: message })
        const hash = (await gitOrThrow(['rev-parse', 'HEAD'])).trim()
        const [shortHash, summary = ''] = (await gitOrThrow(['log', '-1', '--format=%h%x1f%s'])).replace(/\n$/, '').split('\x1f')
        return json(res, 200, { hash, shortHash, summary })
      })
    }

    case 'POST /api/git/restore': {
      const info = await requireRepo()
      const body = await readJson(req)
      const { rel } = await resolveSafe(body.path)
      return await gitSerial(async () => {
        // HEAD 에 없는 파일(추적 안 됨·새로 추가됨)은 거부 — restore 가 지워 버리지 않게. 폴더도 거부.
        const t = await git(['cat-file', '-t', `HEAD:${toTop(info, rel)}`])
        if (t.code !== 0) throw httpError(400, '추적되지 않은 파일은 되돌릴 수 없습니다')
        if (t.stdout.trim() !== 'blob') throw httpError(400, '파일만 되돌릴 수 있습니다')
        const r = await git(['restore', '--source=HEAD', '--staged', '--worktree', '--', rel])
        if (r.code !== 0) {
          if (/did not match any file|pathspec/i.test(r.stderr)) throw httpError(400, '추적되지 않은 파일은 되돌릴 수 없습니다')
          throw httpError(400, gitMessage(r))
        }
        return json(res, 200, { path: rel })
      })
    }

    // push / pull — 원격 추적 브랜치가 있을 때만. 자격 증명은 git credential helper 에 맡긴다 (프롬프트는 끈다)
    case 'POST /api/git/push':
    case 'POST /api/git/pull': {
      await requireRepo()
      const isPush = route.endsWith('push')
      return await gitSerial(async () => {
        const r = await git(isPush ? ['push', '--porcelain'] : ['pull', '--ff-only', '--no-rebase'])
        const output = `${r.stdout}${r.stderr}`.trim()
        if (r.code !== 0) {
          const msg = /could not read Username|Authentication failed|terminal prompts disabled/i.test(output)
            ? '인증이 필요합니다. 터미널에서 한 번 git push 해 자격 증명을 저장하세요'
            : /no upstream|has no upstream branch/i.test(output)
              ? '원격 추적 브랜치가 없습니다 (git push -u origin <브랜치>)'
              : /Not possible to fast-forward|diverge|non-fast-forward|rejected/i.test(output)
                ? '빨리 감기로 합칠 수 없습니다. 터미널에서 pull/merge 를 하세요'
                : output || (isPush ? 'push 실패' : 'pull 실패')
          throw httpError(400, msg)
        }
        return json(res, 200, { ok: true, output })
      })
    }

    // 이미지 등 원본 파일 (미리보기의 <img>). 문서 폴더 아래, 정해진 확장자만
    case 'GET /api/raw': {
      const { abs } = await resolveSafe(q.get('path'))
      const ext = path.extname(abs).toLowerCase()
      const type = RAW_MIME[ext]
      if (!type) throw httpError(400, '허용되지 않은 파일 형식입니다')
      const st = await statOrNull(abs)
      if (!st || !st.isFile()) throw httpError(404, '파일이 없습니다')
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' })
      fs.createReadStream(abs).pipe(res)
      return
    }

    case 'GET /api/events':
      return sse(req, res)

    default:
      throw httpError(404, `알 수 없는 API: ${route}`)
  }
}

/** /api/raw 로 내보낼 수 있는 형식 — 미리보기 이미지 용도만 */
const RAW_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
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
