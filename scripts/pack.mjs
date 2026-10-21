#!/usr/bin/env node
/**
 * 독립 실행 묶음 만들기:  npm run pack  →  release/jaydocs/  +  release/jaydocs-<버전>.zip
 *
 * 묶음 = server.mjs + src/lib/{filetypes,roots}.mjs + bin/ + dist/ + start.cmd + jaydocs.cmd + package.json(bin 만) + README + SHORTCUTS.
 * node_modules 없이 Node 22+ 만 있으면 어디서나 돈다 (git 기능은 PATH 의 git).
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const REL = path.join(ROOT, 'release')
const OUT = path.join(REL, 'jaydocs')
const ZIP = path.join(REL, `jaydocs-${pkg.version}.zip`)

if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('dist/index.html 이 없습니다. npm run build 를 먼저 하세요.')
  process.exit(1)
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
for (const f of ['server.mjs', 'start.cmd', 'SHORTCUTS.md']) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f))
fs.cpSync(path.join(ROOT, 'bin'), path.join(OUT, 'bin'), { recursive: true })
// server.mjs 가 import 하는 공유 표 (앱과 같은 파일)
fs.mkdirSync(path.join(OUT, 'src', 'lib'), { recursive: true })
for (const f of ['filetypes.mjs', 'roots.mjs']) fs.copyFileSync(path.join(ROOT, 'src', 'lib', f), path.join(OUT, 'src', 'lib', f))
fs.cpSync(path.join(ROOT, 'dist'), path.join(OUT, 'dist'), { recursive: true })
fs.writeFileSync(
  path.join(OUT, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: 'module', description: pkg.description, bin: pkg.bin }, null, 2) + '\n',
)
// PATH 에 넣고 쓰는 실행기. node 는 경로의 / 와 \ 를 가리지 않는다.
fs.writeFileSync(path.join(OUT, 'jaydocs.cmd'), '@node "%~dp0bin\\jaydocs.mjs" %*\r\n')
fs.writeFileSync(path.join(OUT, 'README.md'), README())

const zipped = zip()
const size = (p) => (fs.statSync(p).size / 1024 / 1024).toFixed(1) + ' MB'
console.log(`release/jaydocs/            ${count(OUT)}개 파일`)
if (zipped) console.log(`release/jaydocs-${pkg.version}.zip  ${size(ZIP)}`)
else console.log('zip 은 만들지 못했습니다 (tar/zip 없음). release/jaydocs/ 폴더를 그대로 복사하세요.')

function zip() {
  fs.rmSync(ZIP, { force: true })
  // Windows 는 System32 의 bsdtar (-a 가 확장자로 zip 을 고른다). 그 외는 zip 명령.
  const win = process.platform === 'win32'
  const cmd = win ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'zip'
  const args = win ? ['-a', '-cf', ZIP, '-C', REL, 'jaydocs'] : ['-qr', ZIP, 'jaydocs']
  const r = spawnSync(cmd, args, { cwd: REL, stdio: 'inherit' })
  return r.status === 0 && fs.existsSync(ZIP)
}

function count(dir) {
  let n = 0
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) n += d.isDirectory() ? count(path.join(dir, d.name)) : 1
  return n
}

function README() {
  return String.raw`# JayDocs ${pkg.version} — 독립 실행 묶음

Markdown(+Mermaid) 과 TSV 를 나란히 편집하는 로컬 문서 편집기. **Node 22+** 만 있으면 된다.
git 기능(배지·diff·커밋·push/pull)은 PATH 에 git 이 있을 때 켜진다. 문서는 보통 파일로 남고, 이 묶음은 아무것도 설치하지 않는다.

## 실행

- ` + '`start.cmd`' + String.raw` 에 문서 폴더를 **끌어다 놓거나** 인자로: ` + '`start.cmd "D:\\Docs"`' + String.raw`
- 아무 폴더에서 한 단어로: 이 폴더를 PATH 에 넣고 ` + '`jaydocs`' + String.raw`(현재 폴더) 또는 ` + '`jaydocs D:\\Docs`' + String.raw`
  - 또는 이 폴더에서 ` + '`npm install -g .`' + String.raw` 한 번 → 어디서나 ` + '`jaydocs`' + String.raw` (지우기: ` + '`npm uninstall -g jaydocs`' + String.raw`)
- 옵션: ` + '`jaydocs --help`' + String.raw` — ` + '`--no-open`' + String.raw`(주소만 찍기) · ` + '`--port N`' + String.raw` · ` + '`--keep`' + String.raw`(창 닫아도 유지) · ` + '`--ignore Library,Temp`' + String.raw`(큰 폴더 빼기)

Edge(없으면 Chrome) 앱 모드 창이 뜬다. 창을 닫으면 서버도 15초 뒤 꺼진다. 주소 뒤의 ` + '`#token=…`' + String.raw` 이 접속 키다.
폴더를 여러 개 동시에 열어도 된다(각자 다른 포트). 단축키는 SHORTCUTS.md, 그 외는 F1.

## 파일 규칙 (TSV)

- 1행 ` + '`#type`' + String.raw` 행(byte/int/float/bool/string/enum…), 2행 헤더, 3행부터 데이터. ` + '`#`' + String.raw` 로 시작하는 헤더는 주석 열. 이 규칙이 없는 보통 TSV 도 그냥 표로 열린다.
- ` + '`X_Field.tsv`' + String.raw` 는 빈 줄로 나눈 블록(첫 줄이 블록 이름)이고, ` + '`X_Calc.tsv`' + String.raw` 는 계산식(Target / Formula) — F9 로 값을 써 넣는다.
- 줄바꿈(CRLF/LF)·BOM·끝 개행은 파일마다 그대로 보존한다. 안 고친 행은 바이트 하나 안 바뀐다.
`
}
