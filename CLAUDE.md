# JayDocs — 작업 규칙

Markdown(+Mermaid)과 TSV/CSV 를 탭·분할로 편집하는 로컬 PWA. Vite + React 18 + CodeMirror 6 + flexlayout-react, File System Access API, 서버 없음. 공개 리포이고 `main` 에 push 하면 GitHub Pages 로 배포된다. 1인 개발자 Jay 의 리포.

## 일하는 방식

- 한국어로 답한다. 글은 짧고 사실만.
- **커밋 · push 는 Jay 가 말할 때만 한다.**
- 권고는 하나로 강하게, 근거와 함께 낸다. 되돌릴 수 있는 것은 정하고 알린다. 묻는 것은 끝에 모아서 한다.
- 문서에 없는 사실을 지어 넣지 않는다. 확인이 안 되면 그렇게 적는다.

## 지킬 것

- **포맷 계약은 DESIGN §2.** 1행 타입 행(`#string` …), 2행 머리글, Key 는 파일 안에서 유일, `_Field` 시트는 빈 줄로 블록을 나누고 첫 줄이 블록 이름. TSV 는 탭 split 만(따옴표 해석 없음), 파일별 EOL · BOM · 끝 개행을 그대로 보존한다. 바꾼 셀의 행만 diff 에 나와야 한다.
- UTF-8 이 아닌 파일은 덮어쓰지 않는다(`fsaBackend.write` 가 막는다). CSV 를 UTF-8 로 바꿀 때는 BOM 을 붙인다.
- 같은 주소(`krkoohoo.github.io`)의 위키 · `portfolio-test` 에 외부 스크립트를 넣지 않는다(DESIGN §20 B9).

## 한 곳에서 관리하는 표

- 여는 파일 형식: `src/lib/filetypes.mjs`
- 가져온 폴더 경로 규칙(`@별칭/…`): `src/lib/roots.mjs`
- 단축키: `src/lib/shortcuts-table.mjs` → `npm run shortcuts` 가 `SHORTCUTS.md` 를 만든다(테스트가 동기화를 검사).
- **새 기능을 넣을 때 단축키 표와 팔레트 명령을 같이 넣는다.** 모든 작업이 키보드로 되어야 하고 Sheets · Excel 관행을 따른다. 브라우저가 가로채는 조합(`Ctrl+W` `Ctrl+T` `Ctrl+N` `Ctrl+Tab` `Ctrl+숫자`)과 글자 키 단독 단축키는 쓰지 않는다.

## 개발 · 검증

```bash
npm ci          # 새 워크트리라면 먼저
npm test        # vitest. SagaDocs 항목은 그 리포를 찾을 때만 돈다(없으면 skip)
npm run build   # tsc -b + vite build + sw.js 생성
npm run dev     # Vite 5173 (다른 세션과 겹치면 --port 로 바꾼다)
npm run lint    # oxlint. 경고만 낸다 — 명백한 버그만 고친다(DESIGN §24.7 X12)
```

- 화면 확인: `http://127.0.0.1:<포트>/?opfs` — 폴더 선택 창 없이 브라우저 안 저장소를 문서 폴더로 쓴다(개발 전용, 샘플은 `src/lib/fsa/devSeed.ts`). 빌드본 · 서비스 워커는 `npx vite preview`.
- 실제 폴더 선택 창은 자동화가 못 누른다 — 실제 폴더로 하는 확인은 Jay 가 한다.
- **Bash 도구는 명령 문자열의 백슬래시를 한 단계 벗긴다.** `\\` 가 든 `sed` · `node -e` · heredoc 치환은 조용히 실패한다. 그런 편집은 Edit/Write 도구로 한다.
- 브라우저 자동화에서는 `Ctrl+C`/`Ctrl+V` 가 clipboard 이벤트를 일으키지 않는다 — `ClipboardEvent` 를 dispatch 해서 시험한다. 실제 한글 IME 는 자동화로 못 본다.

## 문서

`HANDOFF.md`(현재 상태 · 다음 작업) → `DESIGN.md`(§0 결론, §2 포맷 계약, §20 이후 현재 구조) → `docs/DEVELOPMENT.md`(실행 · 배포 · 소스 구조 · 보안). 단축키는 `SHORTCUTS.md`, 손으로 하는 검증은 `TESTCASES.md`.
