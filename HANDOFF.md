# JayDocs 인수인계 (2026-10-31, 브라우저 앱 전환 시점)

다른 PC의 **새 세션**에 아래 프롬프트를 그대로 붙여 넣으면 된다. 이 문서 자체가 그 세션이 처음 읽을 문서다.

---

## 새 세션용 프롬프트

```
JayDocs 리포를 이어서 개발한다. 먼저 HANDOFF.md 를 읽고, 거기 적힌 순서로 문서를 읽은 뒤
환경을 준비하고 "다음 작업" 을 시작해 줘. 시작 전에 HANDOFF.md 의 "핵심 사실" 을 memory 에 저장해 둬.
```

---

## 1. 지금 상태

- **JayDocs** (이 리포 — 2026-10-25 `JayTools/JayDocs/` 에서 커밋 기록째 분리, JayTools 에는 README 링크만 남음): Markdown(+Mermaid)과 TSV를 나란히 편집하는 경량 로컬 편집기. **Phase 0·1·2·3 완료·검증 끝.**
  Vite/React 18 SPA + File System Access API. 서버 없음.
  - 탭·분할(flexlayout-react) · 파일 트리(배지, 오른쪽 클릭 이름 바꾸기/삭제) · 저장 · 외부 변경 감지/충돌 배너 · 레이아웃 복원.
  - 마크다운: CodeMirror 6 소스 + react-markdown 미리보기(소스/분할/미리보기), mermaid 동적 로드, `tsv-view` 펜스로 TSV 표 임베드(필터·정렬·열 선택, 행 클릭 → 그리드).
  - TSV: 자체 그리드 — 바이트 왕복 보존, 타입 행 + `_Field` 스키마(툴팁·enum·bool·검증·Key 중복), 한글 IME, Sheets 붙여넣기, undo/redo, 행/열 조작.
  - Phase 3(DESIGN §11, §7): tsv-view 그 자리 편집 · `bake: true`(저장 시 파이프 표) · `render: mermaid` 템플릿(Mustache 부분집합) · 하이브리드 Live Preview(`components/hybrid.ts`, CM6 StateField 자체 구현) · 그리드 찾기/바꾸기 · 채우기 핸들 · 열 드래그.
  - 키보드·테마(DESIGN §16): 명령 팔레트 `Ctrl+Shift+P` · 빠른 열기 `Ctrl+P` · 탭/패널 키 · 트리 키보드 탐색 · 그리드 범위 선택과 Sheets 식 복사/붙여넣기/채우기 · md 여러 선택 표시 · 다크 모드. 단축키 원본은 `src/lib/shortcuts-table.mjs`, `npm run shortcuts` → `SHORTCUTS.md`(테스트가 동기화를 검사).
  - 계산식(DESIGN §17): `X_Calc.tsv` 규칙을 F9 로 값 열에 써 넣기. 이미지 미리보기.
  - **폴더 가져오기·형식 확장(2026-10-21, DESIGN §18, 계획·과정은 `PLAN-folder-import.md`)**:
    - 형식 표 `src/lib/filetypes.mjs` — `.md` `.tsv` `.csv` `.txt` `.json`. txt 는 평문 창, json 은 구문 강조·문법 검사·"JSON 정렬".
    - UTF-8 이 아닌 파일(CP949)은 읽기 전용 + "UTF-8 로 바꿔 저장"(CSV 는 BOM). 바이너리·5 MB 초과는 열지 않는다.
    - 폴더 가져오기(`Ctrl+Shift+O`) — 다른 폴더를 원래 자리에서 `@별칭/…` 로 연다. 읽기 전용 옵션, 해제·최근 폴더, IndexedDB 에 주 폴더별로 남음.
    - CSV — 같은 그리드, RFC 4180 왕복 보존(`lib/tsv/csv.ts`, `table.ts`), `Alt+Enter` 칸 안 줄바꿈, 타입 행 없으면 첫 줄 머리글.
  - **2026-10-25 (DESIGN §19)**: TC 156개를 Jay 기억 + Claude 자동 실행으로 채움(TESTCASES). 데이터를 잃는 ❌ 4건 수정 — 열 삭제 크래시(+ `PaneErrorBoundary`), Alt+W·팔레트 탭 닫기 저장 확인, 붙여넣기 칸 줄바꿈 정리, **폴더별 고정 포트**(재시작해도 레이아웃·열 너비·테마 유지). 새 기능 **마크다운 표 붙여넣기**(`lib/tsv/mdTable.ts` — md 파이프 표·`<th>` HTML 표 → 머리글은 머리글 행, 모자라는 열·행 늘림).
  - **2026-10-31 브라우저 앱 전환(DESIGN §20)**: `server.mjs`·git 패널·zip 릴리즈를 없앴다. Edge 에 설치한 PWA 가 File System Access 로 폴더를 직접 읽고 쓴다(`lib/fsa/`). 시작 화면·권한 허용 화면(`StartScreen.tsx`), 자동 업데이트(`lib/pwa.ts`, `scripts/gen-sw.mjs`), Pages 배포(`deploy.yml`).
  - **2026-11-01 폴더 별칭 · 상세 경로 · 최근 10개 · 파일 탐색기 열기(DESIGN §21)**: 경로는 사용자가 넣는다(`lib/localPath.ts`, `FolderInfoDialog.tsx`). 탐색기는 PC 에 한 번 설치하는 연결 도우미로 연다(`lib/explorer.ts`, `public/helper/`).
  - **2026-11-01 앱에서 업데이트 확인(DESIGN §22)**: 켤 때 · 창으로 돌아올 때 · 1시간마다 확인하고, `UpdateButton.tsx` 가 확인 → 받는 중 → 적용(실패하면 다시 받기)을 보여 준다.
- **SagaDocs** (별도 리포, 이 PC는 `C:\Users\user\SagaDocs`, 원래 PC는 `C:\Users\gaber\Documents\GitHub\SagaDocs`): 기획 원본. TSV 7개(LF · BOM 없음 · 끝 개행 있음 — cbfa1ad 에서 넣음). 원격 `github.com/krKooHoo/SagaDocs`.
- 커밋·푸시 여부: 이 문서가 포함된 커밋의 로그를 본다. Phase 1~3·TC 문서·이미지/push-pull·계산식(`7e35ce5` → `6b60870`), 형식 확장·독립 실행(`215f069`), 폴더 가져오기(`1cc6d76`), CSV(`249f306`), TC 결과 기록(`786e4b2`) 까지 커밋됨. 그 뒤의 버그 수정·마크다운 표 붙여넣기는 커밋 전일 수 있다. (해시는 분리 뒤 이 리포 기준 — JayTools 시절 해시와 다르다. 메모리·옛 문서에 남은 해시는 커밋 제목으로 찾는다.) push 는 Jay 지시 전일 수 있다 — `git status -sb` 로 확인.

## 2. 읽을 순서 (10분)

1. `DESIGN.md` — §0 결론, §2 TSV 포맷 규칙(= 계약), §5 핵심 결정 D1~D7, §6 데이터 모델, §7 결합 문법(Phase 3 의 bake·Mermaid 템플릿), §11 Phase 1·2 구현 메모와 Phase 3 범위, §13 피드백 반영, §14 SagaDocs 구조, **§18 폴더 가져오기·형식 확장**(결정 F1~F9, API, 한계), **§19 마크다운 표 붙여넣기 · TC 뒤 수정**(결정 T1~T5), **§20 브라우저 앱 전환**(결정 B1~B10, 실측), **§21 폴더 별칭 · 파일 탐색기**(결정 P1~P9), **§22 앱에서 업데이트 확인**(결정 U1~U7).
2. `README.md` — 실행·배포·개발 명령, 소스 구조, 사용법(그리드 · tsv-view).
3. `SagaDocs/README.md`, `SagaDocs/00-Overview/용어집.md` — 실제 데이터와 규칙.

## 3. 환경 준비

```bash
git pull
npm install          # node_modules 와 dist 는 커밋하지 않는다
npm run build        # dist/ 생성
npm test             # SagaDocs 실제 파일 왕복 포함 (리포를 못 찾으면 그 항목만 건너뜀)
```

- 화면 시험: `npm run dev` 뒤 `http://127.0.0.1:5173/?opfs` — 폴더 선택 창 없이 브라우저 안 저장소를 문서 폴더로 쓴다(개발 전용, 변경 감지도 돈다). 빌드본·서비스 워커는 `npx vite preview`. 둘 다 `.claude/launch.json` 에 있다.
- 실제 폴더 선택 창은 자동화가 못 누른다 → 실제 폴더로 하는 확인은 Jay 가 한다(TESTCASES §15).
- 배포: `.github/workflows/deploy.yml` — `main` push 마다 `npm ci` → `npm test` → `npm run build` → Pages(https://krkoohoo.github.io/JayDocs/). 테스트가 실패하면 배포 안 됨. 리포는 공개다. 같은 주소의 위키·`portfolio-test` 에 외부 스크립트를 넣지 않는다(DESIGN §20 B9).
- 이 PC 의 `C:\Users\gaber\Documents\GitHub\SagaDocs` 에는 옛 경로의 TSV 가 없어 `tsv.test.ts` 의 SagaDocs 항목 2개가 실패한다(전환과 무관, 러너에는 폴더가 없어 skip).
- Node 22+. 설치 시점 버전: Vite 8, TypeScript 7, flexlayout-react 0.11, CodeMirror 6.43, react-markdown 10, remark-gfm 4, mermaid 12. (@tanstack/react-virtual 은 뺐다 — 숨은 탭에서 마운트된 그리드가 보인 뒤에도 행을 안 그리는 일이 있어 고정 높이 윈도잉을 직접 계산한다.)

## 4. 핵심 사실 (memory 에 저장할 것)

- Jay는 1인 개발. 한국어. 커밋·push는 Jay가 말할 때만. 권고는 하나로 강하게, 되돌릴 수 있는 건 정하고 알리고, 질문은 끝에 모아서.
- 기획 원본은 **git(SagaDocs)**. Notion·Asana·Sheets는 더 이상 원본이 아니다.
- **게임(Project-SAGA)은 SagaDocs TSV를 직접 읽지 않는다.** SAGA의 `/design` 세션이 읽고 게임 형식으로 옮겨 쓴다. 복사·서브모듈·링크 없음. → JayDocs 포맷은 DESIGN §2 그대로가 계약.
- 지킬 것: Key는 파일 안에서 유일, `_Field` 시트는 빈 줄로 블록 구분·첫 줄이 블록 이름(SAGA 비교 도구 기준).
- Google Sheets export TSV는 **CRLF**다. SagaDocs 리포는 `.gitattributes`로 **LF 정규화**. JayDocs는 파일별 EOL·BOM·끝 개행을 감지해 보존한다(DESIGN §6.1). 왕복 테스트는 CRLF 입력과 LF 입력 둘 다 통과.
- v1 마크다운은 소스 + 미리보기(하이브리드는 Phase 3). TSV 그리드는 **자체 제작**(DOM + 행 가상화, 라이브러리 아님 — 이유는 DESIGN §3.3/D3). 입력은 항상 떠 있는 textarea 하나가 받고 한글 조합이 그 안에서 시작된다.
- 다른 세션에 보낼 프롬프트는 작게(질문 3~5개). 이전에 10항목 조사 프롬프트가 과한 작업을 만들었다.
- Jay 의 사용 기준(2026-10-11 피드백): 가벼울 것. 모든 작업이 키보드로 되어야 하고, 단축키는 Sheets·Excel 관행을 따르며 `SHORTCUTS.md` 에 계속 쌓는다(한 곳 `shortcuts-table.mjs` 에서 생성). 새 기능을 넣을 때 단축키 표와 팔레트 명령을 같이 넣을 것.
- Claude Code 의 Bash 도구는 명령 문자열의 백슬래시를 한 단계 벗긴다 → `sed`/`node -e`/heredoc 으로 `\\` 가 든 치환은 조용히 실패하고, CSS 처럼 따옴표·백슬래시가 섞인 heredoc 은 깨진다. 그런 편집은 Edit/Write 도구로.
- (2026-10-21) Jay 는 유니티 강사이기도 하다. 폴더 가져오기의 대상은 **수업 자료 · Unity 프로젝트 문서 · 수강생 제출물**. 가져오기는 복사가 아니라 **원래 자리에서 편집**.
- (2026-10-31) JayDocs 는 **Edge 에 설치한 PWA**. 서버·git 기능은 없앴고 git 은 앱 밖에서 쓴다. `Backend` 구현은 `lib/fsa/fsaBackend.ts` 하나.
- 파일 형식은 `src/lib/filetypes.mjs`, 가져온 폴더 경로 규칙은 `src/lib/roots.mjs` 한 곳.
- UTF-8 이 아닌 파일은 절대 그대로 덮어쓰지 않는다(`fsaBackend.write` 가 막는다). CSV 를 UTF-8 로 바꿀 때는 BOM 을 붙인다(Excel 한글).

## 5. 다음 작업 — 사용 피드백 반영 + 남은 숙제

**먼저 브라우저 앱 전환의 남은 일(DESIGN §20)**: 인수 시험(TESTCASES §15 · §16 앞 4건 · TC-1701). 재부팅 뒤 권한, Edge 앱의 폴더 여러 개, 실제 Pages 주소, Edge 가 연결 도우미를 부르는 마지막 단계는 아직 확인하지 못했다.

Phase 0~3 과 폴더 가져오기·형식 확장(DESIGN §18)의 계획 범위는 끝났다. **`TESTCASES.md`(156개 TC)** — 2026-10-25 Jay 기억(✅ 37개)과 Claude 자동 실행(내장 브라우저, SagaDocs 임시 복사본)으로 전부 채웠다: ✅ 111 · ◐ 18 · ⚠ 12 · ❌ 11 · ⏭ 4. ◐ 는 실제 한글 IME·Excel·OS 창처럼 자동화가 못 보는 부분이 남은 것 — Jay 가 손으로 볼 것은 TC-201/211/302/605(IME), 1304/1305/1307(Excel), 003/004(앱 창). 데이터를 잃는 ❌ 4건은 같은 날 고쳤다(아래 ✅, DESIGN §19.2). **남은 ❌ 부터 고친다.** 그 다음은 실제로 써 보고 주는 피드백 (단축키 조합 정리를 넘겨 주기로 했다 — `src/lib/shortcuts-table.mjs` 만 고치면 앱·SHORTCUTS.md·F1 이 같이 바뀐다).

TC 에서 나온 문제(2026-10-25, 모두 따로 재현·소스 확인함. 재현은 TESTCASES 결과 칸):
- ✅ 고침(2026-10-25, 브라우저로 확인): 열 삭제 크래시 + 미저장 편집 소실(TC-307·408 — 너비 배열을 렌더 중에 맞추고 그리드를 `PaneErrorBoundary` 로 감쌈), 재시작하면 레이아웃·열 너비·보기 모드·테마를 잃음(TC-105·412·1211 — 폴더별 고정 포트 43000~44999, `server.mjs` `stablePort`), Alt+W·팔레트 탭 닫기의 저장 확인(TC-904 — `Workbench.tsx` `confirmCloseTab`), 붙여넣기 칸 줄바꿈(TC-1310 — `onPaste` 가 `sanitizeFor`).
- ❌ **tsv-view `where` 가 한글 열 이름을 못 읽음**(TC-1308, 1309 의 원인) — 토크나이저 id 정규식이 ASCII(`tsvView.ts:131`). bake 는 where 오류 때 걸러지지 않은 표를 그대로 쓴다(`bake.ts:126`).
- ❌ **tsv-view 셀에서 Ctrl+Enter 가 그리드로 안 감**(TC-606) — `case 'Enter'` 가 Ctrl 을 가리지 않아 `:224` 분기에 못 간다(`PreviewPane.tsx:210`).
- ❌ **하이브리드에서 블록이 여럿 보이면 ↑ 가 멀리 점프**(TC-210) — `.cm-hybrid-block { margin: 4px 0 }` 를 CM 높이 맵이 세지 않는다(`hybrid.ts:269`). margin 을 없애고 안쪽 여백으로.
- ❌ **JSON 정렬(버튼·팔레트) 직후 Ctrl+Z 가 숨은 다른 탭을 되돌림**(TC-1108) — `formatActive`·팔레트 `onPick` 이 편집기에 포커스를 돌려주지 않는다(`MarkdownPane.tsx:66`, `App.tsx:335`). 팔레트 명령 전반(TC-801·811 도 포커스가 body).
- ❌(TC 밖) **Ctrl+Alt+N 이 트리에서 고른 폴더를 안 따름** — `lastDir` 가 ＋파일/＋폴더에서만 갱신(`App.tsx:64`).
- ⚠ 그 밖: 트리 F2·Delete 뒤 커서 사라짐(TC-807), 미리보기의 없는 그림 안내(TC-215), 모두 바꾸기 직후 Ctrl+Z(TC-410), 열 이동 되돌리기 때 너비(TC-411), 하이브리드의 baked 표 중복(TC-613), CP949 그리드 입력이 Enter 때야 거절(TC-1105), 읽기 전용 폴더의 F2·Delete·＋파일이 대화상자 뒤 오류(TC-1206), 오른쪽 클릭 메뉴 잘림(TC-1207). 문서: SHORTCUTS 의 Ctrl+Shift+V 설명에 하이브리드 없음.

새 기능 **마크다운 표 → TSV 붙여넣기 자동 확장**(2026-10-25 Jay 요청) — 넣었다. 규칙은 DESIGN §19.1(T1~T5), TC 는 TESTCASES §14. 실제 Ctrl+C 로 복사한 표(시스템 클립보드)는 Jay 가 손으로 한 번 볼 것 — 자동화는 붙여넣기 이벤트를 흉내 냈다. 새 단축키·팔레트 명령은 없다(Ctrl+V 설명만 늘림).

폴더 가져오기 쪽 후보(PLAN-folder-import §4, 써 보고 필요하면): **전체 검색**(`Ctrl+Alt+F`, 권고했지만 아직 안 함) · 첫 저장 전 백업 · 주 폴더로 복사 · 트리 이름 필터 · `.yaml`/`.mmd` · 세미콜론 CSV · 가져온 폴더 git.

남은 숙제:
1. ~~수식~~ — (b) 안으로 구현했다: `X_Calc.tsv` 의 규칙을 F9 로 값 열에 써 넣는다(`lib/calc/`). 남은 것: 식 자동완성, Calc 파일 전용 편집 UI(지금은 보통 그리드).
2. **하이브리드 다듬기 2차** — 제목 크기 단계, 코드 펜스(일반 언어) 꾸밈, 각주, 표 안 편집. 지금은 표식 숨김 · 목록/인용 · 할 일 체크박스 · 이미지 · GFM 표/펜스 블록 위젯까지.
3. 번들 1.2 MB(gz 390 KB) — flexlayout·react-markdown·CM 몫. 필요하면 mermaid 처럼 react-markdown 도 지연 로드.
4. `npm audit` 가 mermaid 의존성 경고를 낸다(로컬 도구라 보류).



## 6. 알려진 상태·주의

- 하이브리드 모드는 한글 조합 중(input.type.compose) 장식을 다시 계산하지 않는다. 실제 키보드로 한글을 쳐서 조합이 안 깨지는지 한 번 확인할 것(자동화로는 조합을 못 흉내 낸다).
- bake 는 md 저장 때만 돈다. TSV 만 고치고 md 를 저장하지 않으면 baked 표는 그대로다(미리보기는 살아 있는 표를 보여 준다). tsv-view 의 `file` 을 못 읽으면 배너로 알리고 그 펜스는 건너뛴다.
- 계산식은 **F9/계산 버튼을 눌러야** 표에 써진다(자동 아님). Calc 파일이 있는 표는 식이 걸린 셀에 파란 띠, 바뀔 셀은 노란 배경. lookup 대상 표는 스토어 `auxTable` 로 읽어 둔다.
- 전역 단축키는 버블 단계 keydown 으로 처리한다 — 에디터·그리드가 먼저 `preventDefault` 한 키는 건드리지 않는다. 글자 키 단독 단축키는 두지 않는다(입력 중 충돌). 브라우저 예약 조합(Ctrl+W/T/N/Tab/숫자)은 페이지가 못 받는다.
- 자동화 테스트에서 패널 포커스 명령 뒤 바로 키를 보내면 포커스 이동(한 프레임)보다 앞설 수 있다. 사람 속도에서는 문제 없다.
- enum 열에 Field 블록이 없으면(예: District `AllowedTerrain`) **열에 이미 있는 값**을 후보로 보여 주고 검증은 하지 않는다. 툴팁에 "(열에 있는 값)" 으로 표시.
- `Building_Table` 의 열 설명은 다른 폴더의 `District_Field.tsv` 안 `BuildingDef` 블록에서 온다(리포 전체의 `_Field` 를 훑는다). 열린 Field 문서는 저장 전 편집 내용이 바로 스키마에 반영된다.
- 한글 IME 는 composition 이벤트를 흉내 낸 자동 테스트로 확인했다. 실제 키보드로도 한 번 쳐 보는 것이 좋다(브라우저 자동화는 IME 를 거치지 않는다).
- 새 파일/새 폴더/이름 바꾸기는 `window.prompt`. 저장 전 문서는 이름 바꾸기·삭제를 거부한다.
- 레이아웃·열 너비·md 보기 모드는 `localStorage`. 레이아웃은 작업 공간 id 별, 열 너비·보기 모드는 경로별.
- 자동화 테스트에서 flexlayout 의 숨은 탭은 높이 0 이라 그리드 행이 안 그려진다 → 보이는 창만 고르고, 탭을 바꾼 뒤 행이 그려질 때까지 기다릴 것.
- Phase 0에서 설계와 달라진 점은 DESIGN §11. 2026-10-31 전환으로 사이드카·SSE·`fs.watch` 는 없어졌다(DESIGN §20).
- 가져온 폴더 경로는 `@별칭/…`. 주 폴더 경로는 예전 그대로다. 레이아웃 복원 때 없는 별칭의 탭은 닫고 알린다. 가져온 폴더 트리는 문서 없는 폴더를 숨긴다(주 폴더는 빈 폴더도 보인다).
- 브라우저 자동화에서는 `Ctrl+C`/`Ctrl+V` 가 clipboard 이벤트를 일으키지 않는다 → JS 로 `ClipboardEvent` + `DataTransfer` 를 dispatch 해서 시험한다. 한글 타이핑도 자동화가 IME 를 거치며 바뀔 수 있으니 경로·이름은 ASCII 로 치고 Tab 자동 완성을 쓴다.
- `Ctrl+Shift+O`(폴더 가져오기)는 내장 브라우저에서 동작을 확인했다. Edge/Chrome 일반 탭에서는 북마크 관리자와 겹칠 수 있다 — 설치한 앱 창에서 한 번 확인할 것(안 되면 표에서 키만 바꾼다).
