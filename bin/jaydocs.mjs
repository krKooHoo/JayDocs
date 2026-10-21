#!/usr/bin/env node
/**
 * JayDocs 를 아무 폴더에서나 한 단어로.
 *
 *   jaydocs [문서 폴더] [--no-open] [--port N] [--keep] [--ignore a,b] [--mount 폴더]… [--token 값]
 *
 * 폴더를 안 주면 현재 폴더. --no-open 이 없으면 브라우저(Edge/Chrome 앱 모드)를 열고,
 * 창이 닫히면 서버도 끝난다. 나머지는 그대로 server.mjs 에 넘긴다.
 * 설치: JayDocs 폴더에서 `npm link` (또는 release 묶음에서 `npm install -g .`) 한 번.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HELP = `사용법: jaydocs [문서 폴더] [옵션]
  문서 폴더       생략하면 현재 폴더
  --no-open       브라우저를 열지 않고 주소만 찍는다 (서버는 Ctrl+C 로 끝낸다)
  --port <n>      고정 포트 (기본은 빈 포트 아무거나)
  --keep          브라우저 창을 닫아도 서버를 유지
  --ignore <a,b>  트리·파일 감시에서 뺄 폴더 이름 (기본: .git, node_modules, 점으로 시작하는 폴더)
  --mount <폴더>  다른 폴더를 이번 실행에만 같이 연다 (여러 번 가능). 앱의 "폴더 가져오기"(Ctrl+Shift+O)로
                  가져온 폴더는 ~/.jaydocs/workspaces.json 에 남아 다음에도 열린다
  --token <값>    고정 접속 토큰 (개발용. 기본은 실행마다 난수)`

const BOOL_FLAGS = new Set(['--open', '--no-open', '--keep', '--dev', '--help', '-h'])
const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(HELP)
  process.exit(0)
}

const out = []
let root
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    out.push(a)
    const next = argv[i + 1]
    if (!BOOL_FLAGS.has(a) && next !== undefined && !next.startsWith('--')) { out.push(next); i++ }
  } else if (root === undefined) {
    root = a
  } else {
    console.error(`인자를 이해하지 못했습니다: ${a}\n\n${HELP}`)
    process.exit(2)
  }
}
if (root !== undefined && !out.includes('--root')) out.push('--root', root)
if (!out.includes('--open') && !out.includes('--no-open') && !out.includes('--dev')) out.push('--open')

const server = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs')
process.argv = [process.argv[0], server, ...out]
await import('../server.mjs')
