# JayDocs

Markdown(+Mermaid) 과 TSV 를 **나란히 놓고 편집**하는 경량 로컬 문서 편집기.
Node 사이드카 하나 + 브라우저 창 하나. 문서는 git 리포에 평범한 파일로 둔다. 설계는 [DESIGN.md](DESIGN.md).

> 상태: **Phase 3 완료** — 폴더 열기 · 탭/분할 · 마크다운 소스/하이브리드/미리보기(Mermaid) · TSV 그리드(바이트 왕복 보존 · 스키마 검증 · 한글 IME · 범위 선택 · 찾기/바꾸기 · 채우기 핸들)
> · md 안에 TSV 표 임베드(`tsv-view` — 그 자리 편집 · bake · Mermaid 템플릿) · git(배지 · HEAD diff · 커밋 · 기록 · 되돌리기) · 다크 모드 · 명령 팔레트 · 전부 키보드로 ([SHORTCUTS.md](SHORTCUTS.md)).
> 수식은 `X_Calc.tsv` 로 — 파일에는 값만 남는다(아래 "계산식").

## 실행

```bash
npm install
npm run build
```

그 뒤에는 `start.cmd` 에 문서 폴더를 **끌어다 놓거나** 인자로 넘긴다.

```bat
start.cmd "C:\Users\user\SagaDocs"
```

Edge(없으면 Chrome) 앱 모드 창이 열린다. 창을 닫으면 서버도 15초 뒤 꺼진다.
주소에 붙은 `#token=…` 이 접속 키다. 터미널에 찍힌 주소를 그대로 쓰면 된다. `git` 이 PATH 에 있어야 git 기능이 켜진다.

### 아무 리포에서나 한 단어로 — `jaydocs`

SagaDocs 전용이 아니다. 어떤 폴더든 `.md`/`.tsv` 가 있으면 열린다(git 리포가 아니어도 편집·저장은 된다).

```bash
npm link          # JayDocs/ 에서 한 번 — 전역 명령 jaydocs 가 생긴다 (지우기: npm unlink -g jaydocs)
```

```bash
jaydocs                     # 현재 폴더를 연다
jaydocs D:\Docs             # 그 폴더를 연다
jaydocs --no-open           # 브라우저를 열지 않고 주소만 찍는다
jaydocs --ignore Library,Temp   # 큰 폴더(유니티 프로젝트 등)는 트리·감시에서 뺀다
```

폴더를 여러 개 동시에 열어도 된다(각자 다른 포트, 창 제목이 `<폴더 이름> — JayDocs`). 포트는 폴더마다 정해져 있어서 다시 열어도 레이아웃·열 너비·보기 모드·테마가 남는다(그 포트를 누가 쓰고 있으면 아무 포트). 옵션은 `jaydocs --help`.

### 다른 PC 로 가져가기 — `npm run pack`

```bash
npm run pack      # build → release/jaydocs/ + release/jaydocs-<버전>.zip
```

zip 을 풀면 `server.mjs` + `dist/` + `start.cmd` + `jaydocs.cmd` 뿐이라 **node_modules 없이 Node 22+ 만 있으면** 돈다.
`start.cmd "<폴더>"` 로 바로 쓰거나, 그 폴더를 PATH 에 넣거나 `npm install -g .` 하면 어디서나 `jaydocs`.

**직접 만들지 않아도 된다** — `main` 에 push 될 때마다 GitHub Actions(`.github/workflows/release.yml`)가 테스트 → `npm run pack` 을 돌려 [Releases](https://github.com/krKooHoo/JayDocs/releases) 에 `jaydocs-<버전>-build.<번호>.zip` 을 올린다(태그 `v<버전>-build.<번호>`). 버전은 `package.json` 의 `version` 을 올리면 된다.

## 쓰는 법

- 왼쪽 트리에서 `.md` · `.tsv` · `.csv` · `.txt` · `.json` 을 클릭하면 가운데 탭으로 열린다(형식 목록은 `src/lib/filetypes.mjs` 한 곳 — 사이드카와 앱이 같이 읽는다). 탭은 끌어서 옮기거나 다른 탭셋에 붙일 수 있다. 오른쪽 클릭 → **이름 바꾸기 / 옮기기 · 삭제 · 새 파일 · 새 폴더**.
- **오른쪽에 분할** (`Ctrl+\`) — 같은 문서를 오른쪽 창에도 연다. 한쪽에서 고치면 다른 쪽도 즉시 바뀐다.
- `Ctrl+S` 저장, `Ctrl+Shift+S` 모두 저장. 탭 이름 옆 `●` 가 미저장, `M/A/?/D` 배지가 git 상태.
- 다른 프로그램이 파일을 바꾸면: 내가 손대지 않은 문서는 조용히 다시 읽고, 수정 중이던 문서는 위에 배너가 떠서 **디스크 내용 받기 / 내 내용으로 덮어쓰기** 를 고른다.
- 레이아웃(탭·분할), 열 너비, 마크다운 보기 모드는 브라우저에 남아 다음에 열 때 복원된다.

### 키보드 · 테마

- **모든 명령은 키보드로** 된다. 단축키 전체는 [SHORTCUTS.md](SHORTCUTS.md)(앱에서는 `F1`). 키가 없는 명령도 **명령 팔레트** `Ctrl+Shift+P` 에서 글자로 찾아 실행한다. `Ctrl+P` 는 파일 빠른 열기.
- 탭: `Alt+]` / `Alt+[` 다음·이전, `Alt+1~9` n번째, `Alt+W` 닫기. 패널: `Ctrl+B` 트리, `Ctrl+J` git, `Ctrl+Shift+E` / `Ctrl+Shift+G` / `Ctrl+Shift+M` 으로 트리 · git · 문서 창에 포커스.
- 트리에 포커스가 있으면 방향키로 다니고 `Enter` 열기, `F2` 이름 바꾸기, `Delete` 삭제, `Shift+F10` 메뉴.
- 단축키는 `src/lib/shortcuts-table.mjs` 한 곳에 적는다. `npm run shortcuts` 가 SHORTCUTS.md 를 다시 만들고, 테스트가 둘이 같은지 본다. 브라우저가 먼저 가로채는 조합(`Ctrl+W` `Ctrl+T` `Ctrl+N` `Ctrl+Tab` `Ctrl+숫자`)은 쓰지 않는다.
- **다크 모드** `Ctrl+Alt+D` 또는 오른쪽 위 ☾/☀. 처음엔 OS 설정을 따르고 고르면 브라우저에 남는다.

### 마크다운

- 창 위의 **소스 / 하이브리드 / 분할 / 미리보기** 로 보기 모드를 고른다 (`Ctrl+Shift+V` 로 순환). 미리보기는 GFM(표·체크박스·취소선) + ```` ```mermaid ```` 다이어그램.
- **하이브리드**는 Obsidian 식 — 커서가 있는 줄만 원문이고 나머지 줄은 `#` `**` `` ` `` 같은 표식이 숨고 목록·인용이 꾸며진다. ```` ```mermaid ````·```` ```tsv-view ```` 블록과 GFM 표는 커서가 밖에 있으면 그 자리에서 렌더되고(tsv-view 표는 편집도 된다), 블록 위의 **원문** 을 누르면 소스로 돌아온다. `![그림](…)` 은 줄 아래에 그림이 붙고, `- [ ]` 할 일은 체크박스를 눌러 `[x]` 로 바꿀 수 있다. 글자는 체크박스 말고는 하나도 바뀌지 않는다 — 파일은 늘 소스 그대로다.
- 미리보기의 `.md`/`.tsv` 링크를 누르면 그 문서가 탭으로 열린다(링크는 그 md 파일 위치 기준, `/` 로 시작하면 리포 루트 기준).
- 이미지는 `![alt](_assets/x.png)` 처럼 리포 안 경로(그 md 위치 기준, `/` 면 리포 루트)를 쓰면 사이드카가 내보낸다(png·jpg·gif·webp·svg·bmp·avif). 바깥 주소도 된다.
- 저장은 소스 그대로다 — 미리보기는 파일을 바꾸지 않는다.

### 텍스트 · JSON

- `.txt` 는 고정폭 평문 에디터로 연다(미리보기 없음). 찾기/바꾸기·여러 선택·되돌리기는 마크다운과 같고, 줄바꿈·BOM·끝 개행은 파일 그대로 저장된다.
- `.json` 은 구문 강조 + 문법 검사(거터의 빨간 점·밑줄, 창 위 `JSON ✓` / `JSON 오류`). 문법이 틀려도 저장은 된다.
- **JSON 정렬**(창 위 **정렬** 버튼, 팔레트 "JSON 정렬") — 들여쓰기 2칸으로 다시 쓴다. 저절로는 하지 않는다(diff 가 통째로 바뀌므로). `1.0` → `1`, 큰 정수, 중복 키처럼 정렬하면 **내용이** 바뀌는 파일은 바꾸지 않고 알린다. `Ctrl+Z` 로 되돌린다.

### UTF-8 이 아닌 파일 · 열 수 없는 파일

- 메모장 "ANSI"·한글 Excel 처럼 **CP949(EUC-KR)** 로 저장된 파일은 한글이 제대로 보이지만 🔒 **읽기 전용**으로 열린다(저장하면 깨지던 것을 막는다). 고치려면 배너의 **UTF-8 로 바꿔 저장** — 지금 보이는 내용 그대로 UTF-8 로 다시 쓰고, 그 뒤엔 보통 문서처럼 편집한다. 원래 인코딩으로 되쓰지는 않는다.
- NUL 바이트가 든 파일(이름만 txt 인 바이너리), UTF-16 파일, 5 MB 넘는 파일은 열지 않고 이유를 보여 준다. 사이드카도 UTF-8 이 아닌 파일의 덮어쓰기를 거부한다.

### md 안에 TSV 표 넣기 (`tsv-view`)

````markdown
```tsv-view
file: 10-World/Tile/Tile_Table.tsv
columns: [Key, SurfaceType, Buildable, MovementCost, FoodCost]
where: TerrainType == "Peak" && MovementCost > 5
sort: -MovementCost
limit: 20
```
````

- `file` 리포 상대 경로(필수). `./`, `../` 로 시작하면 md 파일 위치 기준.
- `columns` 열 이름 목록(생략하면 주석 열을 뺀 전부). `sort` 는 `-` 접두면 내림차순, 여러 개 가능. `limit` 행 수.
- `where` 비교식: `==` `!=` `>` `<` `>=` `<=` · `in ["a", "b"]` · `not in` · `&&` `||` `!` · 괄호. 숫자끼리는 숫자로 비교. `Plains, Hill` 같은 리스트 셀은 `in` 에 항목 단위로 걸린다.
- 그리드에서 값을 바꾸면 미리보기 표가 바로 따라오고 "● 저장 전 내용" 이 붙는다. 행 번호를 누르면 그리드가 그 행으로 열린다.
- **그 자리 편집**: 셀을 클릭해 고르고 더블클릭·`Enter`·`F2`(또는 바로 타이핑)로 고친다. `Tab`/`Enter` 로 옆·아래 셀, `Delete` 비우기, `Ctrl+Z` 되돌리기, `Ctrl+Enter` 그리드로. 같은 TsvDoc 이라 그리드·다른 창과 즉시 같아지고, 저장은 TSV 파일 쪽에서 한다.
- **`bake: true`** 를 넣으면 md 를 저장할 때 펜스 바로 아래 `<!-- tsv-view:baked -->` … `<!-- /tsv-view -->` 사이에 파이프 표를 다시 써 준다. GitHub 에서도 진짜 표가 보이는 대신 파생 내용이 diff 에 섞인다. 미리보기에서는 이 블록을 숨긴다. 기본은 꺼짐.
- **`render: mermaid`** + `template: |` 로 행들에서 다이어그램을 만든다. Mustache 수준만 된다: `{{Key}}` `{{this}}` `{{../Key}}` `{{@index}}` `{{#each rows}}` `{{#each Col.list}}`(콤마 리스트) `{{Col.id}}`(mermaid id 로 안전하게) `{{#if Col}}…{{else}}…{{/if}}`. 블록 태그만 있는 줄은 빈 줄을 남기지 않는다. 문법이 틀리면 생성 텍스트와 오류를 보여 주고, 표시줄의 **생성 텍스트** 로 결과를 볼 수 있다.

  ````markdown
  ```tsv-view
  file: 20-Settlement/Building/Building_Table.tsv
  where: DistrictKey == "Agricultural-District"
  render: mermaid
  template: |
    flowchart LR
    {{#each rows}}
    {{Key.id}}["{{DisplayName}}"]
    {{#each RequiredBuildingKey.list}}
    {{this.id}} --> {{../Key.id}}
    {{/each}}
    {{/each}}
  ```
  ````

### TSV 그리드

- **이동** 방향키 · `Tab`/`Shift+Tab` · `Home`/`End` · `PageUp`/`PageDown` · `Ctrl+방향키` 끝으로.
- **편집** 그냥 타이핑하면 덮어쓰기, `Enter`/`F2` 는 기존 값 이어 쓰기, `Esc` 취소. `Enter` 확정 후 아래로, `Tab` 확정 후 오른쪽으로.
  한글은 조합 중에도 자모가 빠지지 않는다 (입력창 하나가 항상 떠 있고 조합이 그 안에서 시작된다).
- **되돌리기** `Ctrl+Z` / `Ctrl+Y` (문서 단위 — 분할 창 어디서 눌러도 같다).
- **범위 선택** `Shift+방향키` · 드래그 · 행 번호/열 글자 클릭 · `Ctrl+A` · `Shift+Space`(행) · `Ctrl+Space`(열). `Esc` 로 해제.
- **복사/붙여넣기** `Ctrl+C`/`Ctrl+X` 는 선택 범위를 TSV 블록으로, `Ctrl+V` 는 Google Sheets·Excel 블록을 활성 셀부터 채운다. 표 끝을 넘는 행은 추가, 너비를 넘는 열은 잘라 내고 알린다. 한 셀을 복사해 범위에 붙이면 범위가 그 값으로 채워진다. **마크다운 표**(md 소스의 파이프 표, 미리보기·하이브리드에서 복사한 표)를 붙이면 머리글은 머리글 행으로 가고(본문에 붙이면 빈 머리글 칸만 채운다), 모자라는 열·행은 늘린다 — 행이 있는 표에서 열을 늘릴 때는 확인을 묻는다(DESIGN §19). `Delete` 범위 비우기, `Ctrl+D`/`Ctrl+R` 아래·오른쪽으로 채우기.
- **채우기 핸들** 범위(또는 활성 셀) 오른쪽 아래의 작은 네모를 아래·위·옆으로 끈다. Sheets 처럼 값 무늬를 되풀이하고, 끄는 방향으로 숫자 2칸 이상이 등차면 수열을 잇는다 (`1, 2` → `3, 4 …`, 소수 자릿수 유지). 숫자 한 칸은 복사. 표 끝을 넘으면 행이 생긴다. 되돌리기 한 번.
- **찾기/바꾸기** `Ctrl+F`(찾기) · `Ctrl+H`(바꾸기) 로 그리드 위에 막대가 열린다. 헤더 행까지 모든 셀을 위→아래, 왼→오로 찾고 걸린 셀은 노랗게, 개수는 `3 / 27`. `Enter`·`F3` 다음, `Shift+Enter`·`Shift+F3` 이전, 대소문자 구분 · 셀 전체 일치. **바꾸기** 는 지금 셀만 바꾸고 다음으로, **모두 바꾸기** 는 한 번에(되돌리기 한 번). `Esc` 로 닫고 그리드로.
- **행/열** 툴바 또는 `Ctrl+Alt+=`(행 삽입) `Ctrl+Alt+-`(행 삭제) `Ctrl+Shift+D`(행 복제), Shift 를 더하면 열. 선택한 범위만큼 여러 행/열에 적용된다. 열을 바꾸면 모든 행이 다시 조립되어 git diff 에 전체가 나오므로 확인을 묻는다.
- **열 옮기기** 열 글자를 누른 채 옆으로 끌면 놓을 자리에 세로선이 보인다. 고른 여러 열 안에서 끌면 함께 옮긴다. 열 너비도 따라간다. 역시 모든 행이 다시 조립되므로 확인을 묻는다.
- **스키마** 1행이 `#string enum bool …` 타입 행이면 2행을 헤더로 보고 고정한다. 빈 타입·`#헤더` 는 주석 열(회색).
  같은 폴더의 `X_Field.tsv`(없으면 리포 안 다른 `_Field` 의 `XDef` 블록)에서 열 설명(열 글자 위에 마우스)과 enum 허용 값을 읽는다.
  enum 셀은 입력창 아래에 후보가 뜬다 (`↓`로 고르고 `Enter`). `A, B` 리스트 열은 마지막 항목만 자동완성. bool 은 체크박스(`Space`).
  byte(0~255)·uint·float·enum 값과 Key 중복은 빨간 밑줄 + 툴팁. 저장은 막지 않는다.
- **왕복 보존** 수정한 행만 다시 조립한다. BOM·CRLF/LF·끝 개행·열 수는 파일에 있던 그대로. 끝 개행이 없는 파일은 아래 상태줄의 **끝 개행 추가** 로 한 번 넣어 두면 행을 덧붙일 때 diff 가 한 줄로 나온다.

### CSV

- `.csv` 도 같은 그리드로 연다(편집·되돌리기·찾기/바꾸기·채우기·행/열 조작 전부 같다). 읽기·쓰기만 CSV 규칙(RFC 4180) — `"…"` 로 감싼 칸, 안의 `""`, 칸 안 쉼표·줄바꿈.
- **왕복 보존**은 TSV 와 같다 — 고치지 않은 레코드는 바이트 그대로, 고친 레코드만 다시 쓴다. 원래 따옴표로 감싸져 있던 칸은 계속 감싸고, 나머지는 쉼표·따옴표·줄바꿈이 있을 때만 감싼다. 고친 레코드는 원래 칸 수를 지킨다. BOM·CRLF/LF·끝 개행도 그대로(상태 줄에 `CSV · CRLF · BOM`).
- 칸 안 줄바꿈은 그리드에서 `↵` 로 보이고, 편집 중 **`Alt+Enter`** 가 줄을 바꾼다(Excel 처럼). 클립보드는 Sheets·Excel 관행대로 줄바꿈이 든 칸만 따옴표로 감싸 주고받는다.
- 타입 행이 없으면 **첫 줄을 머리글**로 본다 — 그리드에서 고정되고, `tsv-view` 에서 `columns: [이름, 점수]` · `where: 점수 > 80` 처럼 열 이름을 쓴다. 1행이 `#string,…` 타입 행이면 TSV 와 같은 스키마 규칙.
- 한글 Excel 의 **"CSV(쉼표로 분리)"** 는 CP949 라 읽기 전용으로 열린다. **UTF-8 로 바꿔 저장** 하면 BOM 을 붙인 UTF-8 이 되어 Excel 에서도 한글이 그대로 보인다("CSV UTF-8" 과 같은 형식).
- `tsv-view` 의 `file:` 에 `.csv` 를 줄 수 있다. bake 하면 칸 안 줄바꿈은 `<br>`. `_Field` 짝짓기·계산식(`_Calc`)은 TSV 전용.
- 따옴표가 안 맞는 칸은 읽을 수 있는 만큼 읽고 열 때 알린다. 쉼표 말고 세미콜론 구분 CSV 는 아직 안 된다.

### 계산식 (`X_Calc.tsv`)

표 `X_Table.tsv` 옆에 `X_Calc.tsv` 를 두면(툴바 **계산식 만들기**) 그 식으로 값 열을 채울 수 있다. **파일에는 식이 아니라 결과 값이 남는다** — SagaDocs 를 읽는 쪽(SAGA `/design`)은 식을 볼 일이 없다.

```
Target	Formula	#메모
MovementCost	=if(TerrainType == "Peak", 9, if(TerrainType == "Mountain", 3, 1))	지형별 이동 비용
FoodCost	=MovementCost * 2 / 3 > 1 ? round(MovementCost * 2 / 3) : 1	
FoodCost[Ocean-Ocean]	=255	이 행만
```

- 1행은 헤더(`Target`), 2행부터 규칙. `열이름` 은 모든 데이터 행, `열이름[Key]` 는 그 Key 행 하나(나중 규칙이 이긴다). `#` 로 시작하는 Target 은 주석.
- 식: 숫자 · `"문자열"` · 열이름 · `+ - * / %` · `== != > < >= <=` · `&& || !` · `조건 ? a : b` · 함수 `if min max abs floor ceil round(x, n) len upper lower trim concat contains(리스트셀, 항목) count(리스트셀) num`, 다른 표는 `lookup("폴더/Y_Table.tsv", 키값, "열")`. 빈 셀은 숫자 문맥에서 0. 규칙이 다른 규칙의 결과를 읽을 수 있다(값이 안정될 때까지 다시 계산).
- 그리드에서 식이 걸린 셀은 왼쪽에 파란 띠, 지금 값이 식과 다르면 노란 배경. 툴바 **계산 (n)** 또는 `F9` 가 바뀔 셀을 한 번에 써 넣는다(되돌리기 한 단계). 식 오류는 위에 빨간 배너로.
- Calc 파일은 보통 TSV 처럼 그리드에서 고치고, 저장 전 내용이 바로 표에 반영된다(바뀔 셀 수가 실시간으로 바뀐다).

### 폴더 가져오기 (다른 폴더를 같이 열기)

- `Ctrl+Shift+O` 또는 상단 **📂 가져오기** — 수업 자료 · Unity 프로젝트 문서 · 수강생 제출물처럼 다른 곳의 폴더를 **복사하지 않고 원래 자리에서** 연다. 트리 맨 아래에 `🔗 @별칭` 으로 붙고, 그 안 파일 경로는 `@별칭/…` 이다.
- 경로는 붙여 넣는다(탐색기 "경로로 복사" 의 따옴표는 알아서 뗀다). 치는 동안 하위 폴더가 후보로 뜨고 `↓`/`↑` 로 골라 `Tab` 으로 채운다, `Enter` 가져오기. Windows 면 **찾아보기…** 가 폴더 고르기 창을 띄운다. 별칭은 비우면 폴더 이름.
- **읽기 전용**으로 가져오면(`🔒`) 저장·새 파일·이름 바꾸기·삭제가 막힌다. 가져온 폴더엔 **git 이 없어 저장을 되돌릴 수 없으니** 제출물처럼 보기만 할 폴더는 읽기 전용으로. 트리의 `@별칭` 오른쪽 클릭(또는 팔레트, 창 위 배너)으로 켜고 끈다.
- 트리 오른쪽 클릭: **탐색기에서 보기**(모든 파일·폴더) · 읽기 전용 켜기/끄기 · 새로 고침 · **가져오기 해제**(파일은 그대로). 해제한 폴더는 가져오기 창의 "최근 폴더" 에서 한 번에 다시 가져온다.
- 목록은 `~/.jaydocs/workspaces.json` 에 **주 폴더별로** 남아 다음에 열 때 돌아온다(리포에는 아무것도 안 남는다). 이번 실행에만 열려면 `jaydocs <주 폴더> --mount <폴더>`. 폴더를 못 찾으면(드라이브 빠짐) 그 탭은 닫고 알린다.
- Unity 프로젝트를 통째로 가져와도 `Library` `Temp` `Logs` `obj` `Build(s)` `UserSettings` `MemoryCaptures` 는 빠지고, 문서가 없는 폴더는 트리에 안 보인다. 항목이 2만 개를 넘으면 `⚠` — 하위 폴더를 가져온다.
- 안 되는 것: 주 폴더나 다른 가져온 폴더와 **겹치는** 폴더(안에 있거나 감싸는), 드라이브 전체, 사용자 폴더 전체. 주 폴더 ↔ 가져온 폴더 사이 이동. 가져온 파일의 git(배지·diff·기록·커밋) — git 은 주 폴더만.
- `tsv-view` 의 `file:`, `/` 로 시작하는 링크, 계산식 `lookup`, `_Field` 찾기는 **그 문서가 속한 폴더 안에서** 풀린다(가져온 폴더의 md 는 가져온 폴더 기준).

### git (아래 **변경 (git)** 패널)

- 바뀐 `.md`/`.tsv` 목록 + 배지. 체크를 풀면 커밋에서 뺀다. 메시지를 쓰고 **커밋** (`Ctrl+Enter`). 저장하지 않은 문서가 섞여 있으면 먼저 저장할지 묻는다.
- 파일 이름(또는 **diff**) → HEAD 와 비교 탭. md 는 왼쪽 HEAD / 오른쪽 현재(편집 가능, 가운데 화살표로 청크 되돌리기). tsv 는 Key 로 행을 맞춘 셀 변경 목록, 항목을 누르면 그리드의 그 셀로.
- **되돌리기** → `git restore` (HEAD 내용으로, 저장 전 수정도 버린다). 새 파일(`?`)은 대상이 아니다.
- **기록** (또는 **현재 문서** / **전체**) → 커밋 목록. **보기** 는 그 시점 내용을 읽기 전용 탭으로, **이 버전으로** 는 그 내용을 현재 문서에 넣는다 (git 은 안 건드린다 — 저장·커밋은 따로).
- 원격 추적 브랜치가 있으면 패널 머리에 **pull ↓n / push ↑n** 버튼(팔레트의 `git push` / `git pull` 도 같다). pull 은 `--ff-only` 라 갈라졌으면 거부하고 터미널로 안내한다. 자격 증명은 git credential helper 에 맡기므로 처음 한 번은 터미널에서 `git push` 해 둔다. 브랜치 전환은 없다.

## 개발

```bash
npm run serve   # 사이드카: 127.0.0.1:5190, 토큰 dev, 자동 종료 없음
npm run dev     # Vite 5173 — /api 는 5190 으로 프록시. http://localhost:5173 을 연다
npm run build   # dist/ 생성 (사이드카가 서빙)
npm run pack    # build + release/jaydocs/ 와 zip (독립 실행 묶음)
npm test        # vitest — TSV 왕복(SagaDocs 실제 파일 포함)·편집·스키마·검증·tsv-view·diff·계산식
```

빌드한 `dist/` 를 사이드카로 바로 보려면 `http://127.0.0.1:5190/#token=dev`.
`.claude/launch.json` 의 `--root` 경로는 PC마다 다르므로 clone 한 뒤 맞춘다.
테스트의 SagaDocs 왕복 항목은 `../SagaDocs`(이 리포 옆), `C:\Users\user\SagaDocs` 등 후보 경로나 `SAGADOCS` 환경변수에서 리포를 찾고, 없으면 건너뛴다.

다른 PC에서 이어서 작업할 때는 [HANDOFF.md](HANDOFF.md). 전체 기능을 손으로 검증할 때는 [TESTCASES.md](TESTCASES.md)(117개 TC).

## 구조

```
server.mjs            사이드카 — 정적 파일 + /api/tree,file(인코딩 감지 · 바이너리/크기 거부),mkdir,rename,delete,raw(이미지) + /api/roots(가져온 폴더 목록·추가·읽기 전용·해제, ~/.jaydocs/workspaces.json),fs/dirs(경로 자동 완성),fs/pick(Windows 폴더 창),reveal(탐색기) + /api/git/*(status·show·log·commit·restore·push·pull, CLI 위임, 주 폴더만) + /api/events(SSE, 루트마다 감시). 런타임 의존성 0
start.cmd             실행기 (폴더를 끌어다 놓거나 인자로)
bin/jaydocs.mjs       전역 명령 jaydocs — 위치 인자 → --root, 기본 --open, --help
scripts/pack.mjs      npm run pack — release/jaydocs/ 와 zip 묶기
.github/workflows/release.yml  main push → 테스트 · pack → GitHub Releases 에 zip
scripts/gen-shortcuts.mjs  npm run shortcuts — SHORTCUTS.md 생성
src/
  lib/backend.ts      Backend 인터페이스 + HttpBackend (토큰 헤더, 409 → ConflictError, git 메서드)
  lib/token.ts        #token=… → sessionStorage
  lib/nav.ts          창 사이 이동 — 문서 열기 · 그리드 셀 선택 요청
  lib/filetypes.mjs   여는 파일 형식 표 (확장자 → md / table / text, 아이콘) — 사이드카도 import
  lib/roots.mjs       가져온 폴더 경로 규칙 (`@별칭/…` 나누기·합치기, 같은 루트 안 경로, 별칭 규칙, 기본 무시 폴더) — 사이드카도 import
  lib/jsonText.ts     JSON 문법 확인 · 정렬 (내용이 바뀌는 정렬은 거부)
  lib/cm.ts           CodeMirror 공통 설정 (마크다운 창 · 평문/JSON 창 · diff 창 · 이전 버전 보기)
  lib/md/tsvView.ts   tsv-view 펜스 파서(YAML 부분집합) · where 식 · 필터/정렬 적용
  lib/md/template.ts  Mermaid 생성용 Mustache 부분집합 (each · if · .list · .id)
  lib/md/bake.ts      bake — 펜스 찾기 · 파이프 표 생성 · 저장 시 변경 계산
  lib/tsv/
    model.ts          TsvTable / TsvRow (불변, raw 행 보관)
    parse.ts          텍스트 → 표 (탭 split 만, 따옴표 해석 없음) · 열 때 경고
    serialize.ts      표 → 텍스트 (수정한 행만 재조립) · 셀 글자 정리
    csv.ts            CSV (RFC 4180) ↔ 같은 표 모델 — 레코드 원문·따옴표 칸 보존, 고친 레코드만 재조립
    table.ts          경로의 형식(tsv/csv)에 따라 읽기·쓰기·열 때 경고·셀 정리 — 스토어·diff·bake 가 부른다
    edits.ts          setCell · 행/열 삽입·삭제·복제 · 붙여넣기 (순수 함수)
    clipboard.ts      Sheets 클립보드 TSV 파싱·만들기 (줄바꿈 든 칸만 따옴표)
    mdTable.ts        머리글 있는 표 읽기 — 마크다운 파이프 표 · <th> HTML 표 (DESIGN §19)
    field.ts          _Field 시트의 블록 읽기
    schema.ts         타입 행 + Field 블록 → 열 스키마 (enum 후보 · 설명 · Key)
    validate.ts       셀 검증 (타입 · enum · Key 중복)
  lib/calc/
    expr.ts           계산식 토크나이저 · 파서 · 평가기 (함수 · lookup)
    calc.ts           X_Calc.tsv 규칙 읽기 · 계산 · 적용 (stale 판정)
    diff.ts           두 표의 차이 (Key 로 행 맞춤)
    *.test.ts         vitest
  store/documents.ts  DocumentStore — 경로당 문서 하나 (TextDoc | TsvDoc), 창 간 동기화, undo 스택, Field 캐시, dirty·충돌·저장
  store/git.ts        git 상태 (경로 → 배지), 뭉친 새로고침, HEAD 변경 카운터
  components/
    Workbench.tsx     flexlayout-react 탭·분할·레이아웃 저장, 닫기 확인. md/tsv/diff/rev 탭, 아래 git 패널
    FileTree.tsx      파일 트리 (git 배지, 오른쪽 클릭 메뉴, 가져온 폴더 `@별칭` 노드)
    ImportDialog.tsx  폴더 가져오기 창 (경로 자동 완성 · 찾아보기 · 별칭 · 읽기 전용 · 최근 폴더)
    MarkdownPane.tsx  CodeMirror 6 + 소스/하이브리드/분할/미리보기 모드. md 가 아니면 평문(txt) · JSON(강조·검사·정렬)
    ReadOnlyBanner.tsx 읽기 전용 배너 — 읽기 전용 가져온 폴더("읽기 전용 끄기") · UTF-8 아닌 파일("UTF-8 로 바꿔 저장")
    PreviewPane.tsx   react-markdown + mermaid(동적) + tsv-view 표(그 자리 편집 · 템플릿 렌더)
    hybrid.ts         하이브리드 Live Preview — CM6 StateField 장식 (표식 숨김 · 펜스 블록 위젯)
    GitPane.tsx       변경 목록 · 커밋 · 기록 · 되돌리기
    DiffPane.tsx      HEAD 비교 (md: @codemirror/merge, tsv: 셀 diff) · 이전 버전 보기(RevPane)
    grid/Grid.tsx     자체 DOM 그리드 — 행 윈도잉(고정 높이, 직접 계산) · 고정 헤더 · 입력 textarea 하나 · 드롭다운 · 범위 선택 · 채우기 핸들 · 열 드래그
    grid/GridPane.tsx 툴바(되돌리기·행/열) · 배너 · 상태줄, 스토어 ↔ Grid 연결
    PaneErrorBoundary.tsx 창 안쪽 렌더 오류를 잡아 저장 안 한 편집을 지킨다 (그리드)
```

## 보안 (로컬 도구 기준)

127.0.0.1 에만 바인딩 · 모든 `/api` 요청에 토큰 · `Host`/`Origin` 검사 · 경로는 문서 폴더(주 폴더 또는 가져온 폴더) 아래로만(`..`, 절대 경로, 루트 밖 링크, `.git` 안 거부) · git 은 인자 배열로만 호출(셸 없음, 경로 앞 `--`). 폴더 가져오기도 같은 토큰이 있어야 하고, 드라이브 전체·사용자 폴더 전체·겹치는 폴더는 거부한다.
