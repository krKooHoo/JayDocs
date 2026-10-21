#!/usr/bin/env node
/**
 * JayDocs 사이드카.
 * 정적 파일(dist/) 서빙 + 파일 API + git API(PATH 의 git) + 파일 변경 알림(SSE). 런타임 의존성 없음 (Node 22+).
 *
 *   node server.mjs --root <문서 폴더> [--port 0] [--open] [--dev] [--token <값>] [--keep] [--ignore a,b] [--mount <폴더>]… [--config <파일>]
 *   (아무 폴더에서 한 단어로 쓰려면 bin/jaydocs.mjs — `npm link` 뒤 `jaydocs [폴더]`)
 *
 * --open   기본 브라우저(Edge/Chrome 앱 모드)로 연다. 창이 닫히면 서버도 종료된다.
 * --dev    Vite 개발 서버(localhost:5173)의 프록시 요청을 허용하고 자동 종료를 끈다.
 * --token  고정 토큰(개발용). 기본은 시작할 때마다 난수.
 * --keep   브라우저가 끊겨도 종료하지 않는다.
 * --ignore 트리·파일 감시에서 뺄 폴더 이름(쉼표 구분). .git, node_modules, 점으로 시작하는 폴더는 항상 뺀다.
 * --mount  이번 실행에만 가져올 폴더 (여러 번 줄 수 있다). 앱에서 가져온 폴더는 --config 파일에 남는다.
 * --config 가져온 폴더 목록 파일 (기본 ~/.jaydocs/workspaces.json — 주 폴더 경로별로 저장)
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
import os from 'node:os'
import { DOC_EXTS, MAX_TEXT_BYTES } from './src/lib/filetypes.mjs'
import { MOUNT_IGNORE_DIRS, MOUNT_SCAN_LIMIT, isValidAlias, joinRootPath, makeAlias, splitRootPath } from './src/lib/roots.mjs'

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
    const value = next !== undefined && !next.startsWith('--') ? (i++, next) : true
    if (key === 'mount') (out.mount ??= []).push(value)
    else out[key] = value
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

/**
 * 문서 루트. 주 폴더(`--root`) 하나 + 가져온 폴더(마운트) 여럿 — PLAN-folder-import F1.
 * 앱 경로가 `@별칭/…` 이면 그 마운트, 아니면 주 폴더 기준이다.
 * @typedef {{ alias: string | null; abs: string; real: string; readOnly: boolean; persist?: boolean; watcher?: fs.FSWatcher | null; truncated?: boolean }} DocRoot
 */
/** @type {DocRoot} */
const PRIMARY = { alias: null, abs: ROOT, real: ROOT_REAL, readOnly: false }
/** @type {Map<string, DocRoot>} 별칭 → 가져온 폴더 */
const MOUNTS = new Map()

/** 앱 경로의 루트와 그 안 상대 경로. 없는 별칭이고 주 폴더에도 그 `@` 폴더가 없으면 404 */
function rootOf(norm) {
  const { alias, rel } = splitRootPath(norm)
  if (alias === null) return { root: PRIMARY, inner: norm }
  const m = MOUNTS.get(alias)
  if (m) return { root: m, inner: rel }
  // 주 폴더 최상위에 진짜 `@이름` 폴더가 있으면 그쪽 (가져오기가 그 별칭을 쓰지 못하게 막아 둔다)
  if (fs.existsSync(path.join(ROOT, `@${alias}`))) return { root: PRIMARY, inner: norm }
  throw httpError(404, `가져온 폴더가 없습니다 (@${alias}) — 해제되었거나 이번 실행에서 가져오지 않았습니다`)
}

/**
 * 요청 경로(앱 경로)를 그 루트 아래의 절대 경로로. `..`, 절대 경로, 루트 밖 심볼릭 링크를 거부한다.
 * rel 은 정규화한 앱 경로, inner 는 루트 안 상대 경로(주 폴더면 rel 과 같다), root 는 그 루트.
 */
async function resolveSafe(rel) {
  if (typeof rel !== 'string' || rel === '') throw httpError(400, 'path 가 필요합니다')
  const norm = rel.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (norm === '' || norm.split('/').some((s) => s === '..' || s === '' || s === '.')) throw httpError(400, '잘못된 경로')
  if (/^[a-zA-Z]:/.test(norm)) throw httpError(400, '절대 경로는 쓸 수 없습니다')
  // .git 안은 어떤 API 로도 읽고 쓸 수 없다 (hooks/config 를 토큰만으로 고치는 길을 막는다)
  if (norm.split('/').some((s) => s.toLowerCase() === '.git')) throw httpError(400, '.git 폴더는 건드릴 수 없습니다')
  const { root, inner } = rootOf(norm)
  if (inner === '') throw httpError(400, '가져온 폴더 자체에는 쓸 수 없습니다')
  const abs = path.resolve(root.abs, inner)
  if (!isUnder(abs, root.abs)) throw httpError(400, '루트 밖 경로')
  let probe = abs
  while (!fs.existsSync(probe)) probe = path.dirname(probe)
  const real = await fsp.realpath(probe)
  if (!isUnder(real, root.real)) throw httpError(400, '루트 밖 경로(링크)')
  return { abs, rel: norm, inner, root }
}

/** 쓰기(저장·폴더 만들기·이름 바꾸기·지우기)용 — 읽기 전용으로 가져온 폴더면 403 */
async function resolveWritable(rel) {
  const r = await resolveSafe(rel)
  if (r.root.readOnly) throw httpError(403, `읽기 전용으로 가져온 폴더입니다 (@${r.root.alias}) — 트리에서 그 폴더를 오른쪽 클릭해 읽기 전용을 끌 수 있습니다`)
  return r
}

/** git 기능은 주 폴더만 (가져온 폴더는 git 없이 파일 편집만 — PLAN F7) */
function primaryOnly(r) {
  if (r.root !== PRIMARY) throw httpError(400, '가져온 폴더의 파일에는 git 기능을 쓰지 않습니다')
  return r
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
/**
 * 폴더 트리 (문서 형식만). 경로는 앱 경로(가져온 폴더면 `@별칭/` 접두).
 * 가져온 폴더(mount)는 Unity 같은 큰 폴더를 생각해 — 기본 무시 폴더를 더 빼고, 문서가 없는 폴더는 접어 버리고,
 * 항목을 MOUNT_SCAN_LIMIT 개까지만 훑는다 (넘으면 ctx.truncated). 읽을 수 없는 하위 폴더는 건너뛴다.
 */
async function readTree(dirAbs, dirRel, ctx = null) {
  let dirents
  try {
    dirents = await fsp.readdir(dirAbs, { withFileTypes: true })
  } catch (e) {
    if (ctx && dirRel !== '') return [] // 가져온 폴더 안의 권한 없는 폴더 등
    throw e
  }
  const ignore = ctx ? ctx.ignore : IGNORE_DIRS
  const entries = []
  for (const d of dirents) {
    if (d.name.startsWith('.') || ignore.has(d.name)) continue
    if (ctx && --ctx.budget < 0) { ctx.truncated = true; break }
    const rel = dirRel ? `${dirRel}/${d.name}` : d.name
    const appPath = ctx ? joinRootPath(ctx.alias, rel) : rel
    if (d.isDirectory()) {
      const children = await readTree(path.join(dirAbs, d.name), rel, ctx)
      if (ctx && children.length === 0) continue
      entries.push({ type: 'dir', name: d.name, path: appPath, children })
    } else if (d.isFile() && EXTS.has(path.extname(d.name).toLowerCase())) {
      entries.push({ type: 'file', name: d.name, path: appPath })
    }
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ko') : a.type === 'dir' ? -1 : 1))
  return entries
}

/** 가져온 폴더 하나의 트리 */
async function readMountTree(m) {
  const ctx = { alias: m.alias, ignore: new Set([...IGNORE_DIRS, ...MOUNT_IGNORE_DIRS]), budget: MOUNT_SCAN_LIMIT, truncated: false }
  let entries = []
  let error = null
  try { entries = await readTree(m.abs, '', ctx) } catch (e) { error = fsFail(e, '폴더를 읽지 못했습니다').message }
  m.truncated = ctx.truncated
  return { ...mountInfo(m), entries, error }
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
  const r = await resolveWritable(rel)
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
/**
 * 루트 하나를 감시해 변경을 앱 경로로 알린다. 무시 폴더(경로 어느 단계든)는 건너뛴다.
 * 감시 대상 폴더가 사라지면(USB 분리 등) 오류 이벤트가 오는데, 프로세스가 죽지 않게 받아서 끈다.
 */
function watchRoot(root) {
  const ignore = root === PRIMARY ? IGNORE_DIRS : new Set([...IGNORE_DIRS, ...MOUNT_IGNORE_DIRS])
  try {
    const w = fs.watch(root.abs, { recursive: true }, (event, filename) => {
      if (!filename) return
      const rel = String(filename).replace(/\\/g, '/')
      const segs = rel.split('/')
      if (root === PRIMARY ? ignore.has(segs[0]) || segs[0].startsWith('.') : segs.some((s) => ignore.has(s) || s.startsWith('.'))) return
      const appPath = joinRootPath(root.alias, rel)
      clearTimeout(pending.get(appPath))
      pending.set(appPath, setTimeout(() => {
        pending.delete(appPath)
        broadcast({ type: 'change', event, path: appPath })
      }, 150))
    })
    w.on('error', (e) => { console.warn(`파일 감시가 멈췄습니다 (${root.abs}):`, e.message); try { w.close() } catch { /* 이미 닫힘 */ } })
    return w
  } catch (e) {
    console.warn(`파일 감시를 시작하지 못했습니다 (${root.abs}):`, e.message)
    return null
  }
}
PRIMARY.watcher = watchRoot(PRIMARY)

// ---------------------------------------------------------------- 가져온 폴더 (마운트)
// 목록은 사용자 설정 파일에 주 폴더 경로별로 남는다 (리포를 더럽히지 않게 — PLAN F2).
//   { "<주 폴더 실제 경로>": { mounts: [{ alias, path, readOnly }], recent: [{ alias, path, readOnly }] } }
const CONFIG_FILE = path.resolve(typeof args.config === 'string' ? args.config : path.join(os.homedir(), '.jaydocs', 'workspaces.json'))
const WS_KEY = WIN ? ROOT_REAL.toLowerCase() : ROOT_REAL
const RECENT_MAX = 10
/** 설정에는 있지만 이번에 찾지 못한 폴더 (드라이브가 빠졌거나 지워짐) — 설정에서 지우지 않고 남겨 둔다 */
let missingMounts = []
let recentMounts = []

function mountInfo(m) {
  return { alias: m.alias, path: m.abs, readOnly: m.readOnly, persist: m.persist !== false, truncated: !!m.truncated }
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) } catch { return {} }
}
function saveConfig() {
  const all = readConfig()
  const mounts = [...MOUNTS.values()].filter((m) => m.persist !== false).map((m) => ({ alias: m.alias, path: m.abs, readOnly: m.readOnly }))
  all[WS_KEY] = { mounts: [...mounts, ...missingMounts], recent: recentMounts }
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
    const tmp = `${CONFIG_FILE}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, CONFIG_FILE)
  } catch (e) {
    console.warn('가져온 폴더 목록을 저장하지 못했습니다:', e.message)
  }
}

function samePath(a, b) {
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** 붙여 넣은 경로 정리: 따옴표·앞뒤 공백 제거, `C:` 만 있으면 `C:\` */
function cleanInputPath(p) {
  let s = String(p ?? '').trim().replace(/^["']+|["']+$/g, '').trim()
  if (WIN && /^[a-zA-Z]:$/.test(s)) s += '\\'
  return s
}

/**
 * 폴더를 가져온다. 검사(PLAN F4): 있는 폴더 · 드라이브 루트 아님 · 사용자 홈 그 자체 아님 ·
 * 주 폴더나 다른 가져온 폴더와 겹치지 않음 · 별칭이 올바르고 겹치지 않음.
 */
function mountFolder(inputPath, { alias, readOnly = false, persist = true } = {}) {
  const p = cleanInputPath(inputPath)
  if (!p) throw httpError(400, '폴더 경로가 필요합니다')
  if (!path.isAbsolute(p)) throw httpError(400, `절대 경로로 적어 주세요 (예: ${WIN ? 'D:\\수업자료' : '/home/me/docs'})`)
  const abs = path.resolve(p)
  let st
  try { st = fs.statSync(abs) } catch { throw httpError(400, `폴더가 없습니다: ${abs}`) }
  if (!st.isDirectory()) throw httpError(400, `폴더가 아닙니다: ${abs}`)
  const real = fs.realpathSync.native(abs)
  if (samePath(path.parse(real).root, real)) throw httpError(400, '드라이브 전체는 가져올 수 없습니다 — 그 안의 폴더를 고르세요')
  if (samePath(real, os.homedir())) throw httpError(400, '사용자 폴더 전체는 가져올 수 없습니다 — 그 안의 폴더를 고르세요')
  for (const r of [PRIMARY, ...MOUNTS.values()]) {
    const name = r.alias === null ? '주 문서 폴더' : `@${r.alias}`
    if (isUnder(real, r.real)) throw httpError(400, `이미 열려 있는 ${name} 안의 폴더입니다`)
    if (isUnder(r.real, real)) throw httpError(400, `이 폴더 안에 ${name} 이 들어 있어 겹칩니다 — 겹치지 않는 폴더를 고르세요`)
  }
  const taken = [...MOUNTS.keys()]
  let name = typeof alias === 'string' && alias.trim() !== '' ? alias.trim() : makeAlias(path.basename(real), taken)
  if (!isValidAlias(name)) throw httpError(400, `별칭으로 쓸 수 없습니다: ${name} (40자 이하, / \\ : * ? " < > | 와 맨 앞 점 제외)`)
  if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) throw httpError(400, `이미 쓰는 별칭입니다: @${name}`)
  if (fs.existsSync(path.join(ROOT, `@${name}`))) throw httpError(400, `주 폴더에 "@${name}" 폴더가 있어 그 별칭은 쓸 수 없습니다`)
  /** @type {DocRoot} */
  const m = { alias: name, abs, real, readOnly: readOnly === true, persist }
  m.watcher = watchRoot(m)
  MOUNTS.set(name, m)
  missingMounts = missingMounts.filter((x) => !samePath(path.resolve(x.path), abs))
  recentMounts = recentMounts.filter((x) => !samePath(path.resolve(x.path), abs))
  if (persist) saveConfig()
  broadcast({ type: 'change', event: 'rename', path: `@${name}` }) // 다른 창도 트리를 다시 읽게
  return m
}

function unmountFolder(alias) {
  const m = MOUNTS.get(alias)
  if (!m) throw httpError(404, `가져온 폴더가 없습니다 (@${alias})`)
  try { m.watcher?.close() } catch { /* 이미 닫힘 */ }
  MOUNTS.delete(alias)
  recentMounts = [{ alias: m.alias, path: m.abs, readOnly: m.readOnly }, ...recentMounts.filter((x) => !samePath(path.resolve(x.path), m.abs))].slice(0, RECENT_MAX)
  saveConfig()
  broadcast({ type: 'change', event: 'rename', path: `@${alias}` })
}

// 시작할 때: 설정 파일의 폴더(남김) → --mount 폴더(이번 실행만)
{
  const ws = readConfig()[WS_KEY] ?? {}
  recentMounts = Array.isArray(ws.recent) ? ws.recent.filter((x) => x && typeof x.path === 'string').slice(0, RECENT_MAX) : []
  for (const x of Array.isArray(ws.mounts) ? ws.mounts : []) {
    if (!x || typeof x.path !== 'string') continue
    try { mountFolder(x.path, { alias: x.alias, readOnly: x.readOnly === true, persist: true }) } catch (e) {
      console.warn(`가져온 폴더를 열지 못했습니다 (${x.path}): ${e.message}`)
      missingMounts.push({ alias: x.alias, path: x.path, readOnly: x.readOnly === true })
    }
  }
  for (const p of args.mount ?? []) {
    if (typeof p !== 'string') continue
    if ([...MOUNTS.values()].some((m) => samePath(m.abs, path.resolve(cleanInputPath(p))))) continue
    try { mountFolder(p, { persist: false }) } catch (e) { console.warn(`--mount ${p}: ${e.message}`) }
  }
}

/** 경로 자동 완성 — prefix 로 시작하는 하위 폴더 (최대 50). 비었으면 드라이브 목록 */
async function listDirs(prefix) {
  const p = cleanInputPath(prefix)
  if (!p) {
    if (!WIN) return ['/']
    const out = []
    for (let c = 65; c <= 90; c++) { const d = `${String.fromCharCode(c)}:\\`; if (fs.existsSync(d)) out.push(d) }
    return out
  }
  if (!path.isAbsolute(p)) return []
  const endsSep = /[\\/]$/.test(p)
  const dir = endsSep ? p : path.dirname(p)
  const part = (endsSep ? '' : path.basename(p)).toLowerCase()
  let dirents
  try { dirents = await fsp.readdir(dir, { withFileTypes: true }) } catch { return [] }
  return dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('$') && d.name !== 'System Volume Information' && d.name.toLowerCase().startsWith(part))
    .map((d) => path.join(dir, d.name))
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .slice(0, 50)
}

/**
 * Windows 폴더 고르기 대화상자 (PowerShell + WinForms, 의존성 0). 앱 창 뒤에 뜨지 않게 TopMost 소유 창을 둔다.
 * 시작 폴더는 환경 변수로 넘긴다 (스크립트에 경로를 끼워 넣지 않으려고). 취소하면 null.
 */
let picking = false
async function pickFolder(start) {
  if (!WIN) throw httpError(501, '폴더 고르기 대화상자는 Windows 에서만 됩니다 — 경로를 직접 적어 주세요')
  if (picking) throw httpError(409, '폴더 고르기 창이 이미 열려 있습니다')
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$owner.ShowInTaskbar = $false',
    '$owner.StartPosition = "CenterScreen"',
    '$owner.Width = 1; $owner.Height = 1; $owner.Opacity = 0',
    '$owner.Show(); $owner.Activate()',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$d.Description = "JayDocs 로 가져올 폴더를 고르세요"',
    '$d.ShowNewFolderButton = $false',
    'if ($env:JAYDOCS_PICK_START -and (Test-Path -LiteralPath $env:JAYDOCS_PICK_START)) { $d.SelectedPath = $env:JAYDOCS_PICK_START }',
    'if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }',
    '$owner.Close()',
  ].join('\n')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  picking = true
  try {
    const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded], {
      windowsHide: true,
      timeout: 10 * 60_000,
      encoding: 'utf8',
      env: { ...process.env, JAYDOCS_PICK_START: cleanInputPath(start) },
    })
    const picked = stdout.trim()
    return picked || null
  } catch (e) {
    throw httpError(500, `폴더 고르기 창을 열지 못했습니다: ${e.message}`)
  } finally {
    picking = false
  }
}

/** 탐색기에서 보기 — 파일이면 그 파일을 선택한 채, 폴더면 그 폴더를 연다 */
async function reveal(appPath) {
  let abs
  if (appPath === '' || appPath === null) abs = ROOT
  else {
    const { alias, rel } = splitRootPath(appPath)
    if (alias !== null && rel === '') {
      const m = MOUNTS.get(alias)
      if (!m) throw httpError(404, `가져온 폴더가 없습니다 (@${alias})`)
      abs = m.abs
    } else abs = (await resolveSafe(appPath)).abs
  }
  const st = await statOrNull(abs)
  if (!st) throw httpError(404, '경로가 없습니다')
  let child
  if (WIN) {
    child = st.isDirectory()
      ? spawn('explorer.exe', [abs], { detached: true, stdio: 'ignore' })
      : spawn('explorer.exe', [`/select,"${abs}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true })
  } else {
    child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [st.isDirectory() ? abs : path.dirname(abs)], { detached: true, stdio: 'ignore' })
  }
  child.on('error', () => { /* 탐색기가 없으면 조용히 */ })
  child.unref()
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
      return json(res, 200, { root: ROOT, dev: DEV, git: repo, branch: repo ? await gitBranch() : null, platform: process.platform })
    }

    case 'GET /api/tree':
      return json(res, 200, { root: ROOT, entries: await readTree(ROOT, ''), mounts: await Promise.all([...MOUNTS.values()].map(readMountTree)) })

    // ---- 가져온 폴더
    case 'GET /api/roots':
      return json(res, 200, { platform: process.platform, mounts: [...MOUNTS.values()].map(mountInfo), recent: recentMounts, missing: missingMounts })

    case 'POST /api/roots': {
      const body = await readJson(req)
      const m = mountFolder(body.path, { alias: body.alias, readOnly: body.readOnly === true, persist: true })
      return json(res, 200, mountInfo(m))
    }

    case 'PATCH /api/roots': {
      const m = MOUNTS.get(q.get('alias') ?? '')
      if (!m) throw httpError(404, `가져온 폴더가 없습니다 (@${q.get('alias')})`)
      const body = await readJson(req)
      if (typeof body.readOnly !== 'boolean') throw httpError(400, 'readOnly 가 필요합니다')
      m.readOnly = body.readOnly
      if (m.persist !== false) saveConfig()
      broadcast({ type: 'change', event: 'rename', path: `@${m.alias}` })
      return json(res, 200, mountInfo(m))
    }

    case 'DELETE /api/roots': {
      unmountFolder(q.get('alias') ?? '')
      return json(res, 200, { ok: true })
    }

    case 'POST /api/roots/forget': {
      // 최근 목록·못 찾은 목록에서 지우기
      const body = await readJson(req)
      const p = typeof body.path === 'string' ? path.resolve(cleanInputPath(body.path)) : ''
      recentMounts = recentMounts.filter((x) => !samePath(path.resolve(x.path), p))
      missingMounts = missingMounts.filter((x) => !samePath(path.resolve(x.path), p))
      saveConfig()
      return json(res, 200, { ok: true })
    }

    case 'GET /api/fs/dirs':
      return json(res, 200, { dirs: await listDirs(q.get('prefix') ?? '') })

    case 'POST /api/fs/pick': {
      const body = await readJson(req)
      return json(res, 200, { path: await pickFolder(body.start) })
    }

    case 'POST /api/reveal': {
      const body = await readJson(req)
      await reveal(typeof body.path === 'string' ? body.path : '')
      return json(res, 200, { ok: true })
    }

    case 'GET /api/file': {
      const { abs, rel } = await resolveSafe(q.get('path'))
      const st = await statOrNull(abs)
      if (!st || !st.isFile()) throw httpError(404, '파일이 없습니다')
      const { text, encoding } = decodeText(await readTextFile(abs, st))
      return json(res, 200, { path: rel, text, encoding, mtime: st.mtimeMs })
    }

    case 'PUT /api/file': {
      const { abs, rel } = await resolveWritable(q.get('path'))
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
      const { abs, rel } = await resolveWritable(q.get('path'))
      await fsp.mkdir(abs, { recursive: true })
      return json(res, 200, { path: rel })
    }

    case 'POST /api/rename': {
      const body = await readJson(req)
      if (typeof body.from !== 'string' || typeof body.to !== 'string') throw httpError(400, 'from, to 가 필요합니다')
      const from = await resolveEditable(body.from)
      const to = await resolveEditable(body.to)
      if (from.root !== to.root) throw httpError(400, '다른 폴더(주 폴더 ↔ 가져온 폴더)로는 옮길 수 없습니다')
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
      const { abs, rel, root } = await resolveEditable(body.path)
      if (isUnder(root.abs, abs) || isUnder(root.real, abs)) throw httpError(400, '문서 폴더 자체는 지울 수 없습니다')
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
      const { rel } = primaryOnly(await resolveSafe(q.get('path')))
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
      const rel = q.get('path') ? primaryOnly(await resolveSafe(q.get('path'))).rel : null
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
      const resolved = [...new Map((await Promise.all(body.paths.map(async (p) => primaryOnly(await resolveSafe(p))))).map((r) => [r.rel, r])).values()]
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
      const { rel } = primaryOnly(await resolveSafe(body.path))
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
  const mounts = [...MOUNTS.values()].map((m) => `\n  가져온 폴더: @${m.alias} = ${m.abs}${m.readOnly ? ' (읽기 전용)' : ''}`).join('')
  console.log(`JayDocs\n  문서 폴더: ${ROOT}${mounts}\n  주소:      ${url}${DEV ? '\n  (개발 모드: Vite 5173 프록시 허용, 자동 종료 없음)' : ''}`)
  if (args.open === true) {
    openBrowser(url)
    if (AUTO_EXIT) setTimeout(() => {
      if (!everConnected) { console.log('60초 안에 브라우저가 연결되지 않아 종료합니다.'); process.exit(0) }
    }, 60_000)
  }
})
