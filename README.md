# JayDocs

Markdown(+Mermaid) 과 TSV 를 **나란히 놓고 편집**하는 브라우저 문서 편집기. 설치형 웹앱(PWA)으로 쓰고, 이 PC 의 폴더를 직접 읽고 쓴다. 서버가 없어 문서는 어디에도 올라가지 않는다. 설계는 [DESIGN.md](DESIGN.md).

> 폴더 열기 · 탭/분할 · 마크다운 소스/하이브리드/미리보기(Mermaid) · TSV 그리드(바이트 왕복 보존 · 스키마 검증 · 한글 IME · 범위 선택 · 찾기/바꾸기 · 채우기 핸들)
> · md 안에 TSV 표 임베드(`tsv-view` — 그 자리 편집 · bake · Mermaid 템플릿) · 다크 모드 · 명령 팔레트 · 전부 키보드로 ([SHORTCUTS.md](SHORTCUTS.md)).
> 수식은 `X_Calc.tsv` 로 — 파일에는 값만 남는다(아래 "계산식"). git 은 앱 밖(터미널 · GitHub Desktop)에서 쓴다. 바꾼 행만 바뀌게 저장하므로 diff 는 깨끗하다.

## 실행

배포 주소를 **Edge** 에서 열고 상단의 **앱으로 설치** 를 누른다(주소창의 설치 아이콘도 같다). 그 뒤로는 시작 메뉴·작업 표시줄에서 연다.

1. **문서 폴더 열기** 로 폴더를 고르고 허용한다.
2. 다른 폴더가 더 필요하면 `Ctrl+Shift+O` 로 가져온다.
3. 다음부터는 바로 열린다. 권한이 풀려 있으면 시작할 때 **허용** 을 한 번 누른다.

- Chrome 도 된다. 다만 Chrome 은 파일 이동 API 가 막혀 있어 이름 변경을 복사 후 삭제로 처리한다. Firefox · Safari 는 폴더를 열 수 없다.
- **탭으로 쓰면 권한이 닫을 때마다 풀릴 수 있다.** 앱으로 설치해 쓴다.
- 오프라인에서도 돈다(처음 한 번은 인터넷 필요).

### 자동 업데이트

`main` 에 push 하면 GitHub Actions(`.github/workflows/deploy.yml`)가 테스트 → 빌드 → 배포한다. 앱은 새 버전을 받아 두었다가 **모든 창을 닫고 다음에 열 때** 적용한다. 상단의 **새 버전 적용** 으로 바로 적용할 수도 있다(저장 안 한 문서가 있으면 막는다). 저절로 새로고침되는 일은 없다.

### 배포

공개 리포 하나로 코드와 앱을 함께 관리한다. 앱 주소는 https://krkoohoo.github.io/JayDocs/ 이고, Settings → Pages 의 Source 는 GitHub Actions 다. 따로 넣을 토큰이나 설정은 없다.

## 쓰는 법

- 왼쪽 트리에서 `.md` · `.tsv` · `.csv` · `.txt` · `.json` 을 클릭하면 가운데 탭으로 열린다(형식 목록은 `src/lib/filetypes.mjs` 한 곳). 탭은 끌어서 옮기거나 다른 탭셋에 붙일 수 있다. 오른쪽 클릭 → **이름 바꾸기 / 옮기기 · 삭제 · 새 파일 · 새 폴더**. 폴더 이름은 탐색기에서 바꾼다(브라우저에 폴더 이동 API 가 없다). 트리는 자동으로 따라온다.
- **오른쪽에 분할** (`Ctrl+\`) — 같은 문서를 오른쪽 창에도 연다. 한쪽에서 고치면 다른 쪽도 즉시 바뀐다.
- `Ctrl+S` 저장, `Ctrl+Shift+S` 모두 저장. 탭 이름 옆 `●` 가 미저장. 다른 프로그램(Excel 등)이 파일을 잠그고 있으면 저장이 오류로 막히고 원본은 그대로다.
- 다른 프로그램이 파일을 바꾸면: 내가 손대지 않은 문서는 조용히 다시 읽고, 수정 중이던 문서는 위에 배너가 떠서 **디스크 내용 받기 / 내 내용으로 덮어쓰기** 를 고른다. 터미널에서 `git pull` 해도 같다.
- 레이아웃(탭·분할), 열 너비, 마크다운 보기 모드는 브라우저에 남아 다음에 열 때 복원된다.
- 상단의 폴더 이름을 누르면 다른 문서 폴더로 바꾼다. 전에 연 폴더는 가져온 폴더·레이아웃과 함께 돌아온다.
- 저장한 파일에는 브라우저가 인터넷 표시(`Zone.Identifier`)를 붙인다. 내용과 git 에는 영향이 없다. Excel 이 제한된 보기로 열면 문서 폴더를 Excel 의 신뢰할 수 있는 위치에 넣는다.

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
- 이미지는 `![alt](_assets/x.png)` 처럼 문서 폴더 안 경로(그 md 위치 기준, `/` 면 그 폴더 루트)를 쓰면 보인다(png·jpg·gif·webp·svg·bmp·avif). 바깥 주소도 된다.
- 저장은 소스 그대로다 — 미리보기는 파일을 바꾸지 않는다.

### 텍스트 · JSON

- `.txt` 는 고정폭 평문 에디터로 연다(미리보기 없음). 찾기/바꾸기·여러 선택·되돌리기는 마크다운과 같고, 줄바꿈·BOM·끝 개행은 파일 그대로 저장된다.
- `.json` 은 구문 강조 + 문법 검사(거터의 빨간 점·밑줄, 창 위 `JSON ✓` / `JSON 오류`). 문법이 틀려도 저장은 된다.
- **JSON 정렬**(창 위 **정렬** 버튼, 팔레트 "JSON 정렬") — 들여쓰기 2칸으로 다시 쓴다. 저절로는 하지 않는다(diff 가 통째로 바뀌므로). `1.0` → `1`, 큰 정수, 중복 키처럼 정렬하면 **내용이** 바뀌는 파일은 바꾸지 않고 알린다. `Ctrl+Z` 로 되돌린다.

### UTF-8 이 아닌 파일 · 열 수 없는 파일

- 메모장 "ANSI"·한글 Excel 처럼 **CP949(EUC-KR)** 로 저장된 파일은 한글이 제대로 보이지만 🔒 **읽기 전용**으로 열린다(저장하면 깨지던 것을 막는다). 고치려면 배너의 **UTF-8 로 바꿔 저장** — 지금 보이는 내용 그대로 UTF-8 로 다시 쓰고, 그 뒤엔 보통 문서처럼 편집한다. 원래 인코딩으로 되쓰지는 않는다.
- NUL 바이트가 든 파일(이름만 txt 인 바이너리), UTF-16 파일, 5 MB 넘는 파일은 열지 않고 이유를 보여 준다. UTF-8 이 아닌 파일은 "UTF-8 로 바꿔 저장" 이 아니면 덮어쓰지 않는다.

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
- **폴더 고르기…** 로 폴더를 고르고 **가져오기**. 별칭은 비우면 폴더 이름.
- **읽기 전용**으로 가져오면(`🔒`) 저장·새 파일·이름 바꾸기·삭제가 막힌다. 제출물처럼 보기만 할 폴더는 먼저 읽기 전용을 켜고 고른다(쓰기 권한을 묻지 않는다). 트리의 `@별칭` 오른쪽 클릭(또는 팔레트, 창 위 배너)으로 켜고 끈다.
- 트리 오른쪽 클릭: 읽기 전용 켜기/끄기 · 새로 고침 · **가져오기 해제**(파일은 그대로). 해제한 폴더는 가져오기 창의 "최근 폴더" 에서 한 번에 다시 가져온다.
- 목록은 브라우저 저장소(IndexedDB)에 **주 폴더별로** 남아 다음에 열 때 돌아온다(리포에는 아무것도 안 남는다). 폴더를 못 읽으면(드라이브 빠짐) 상단에 오류를 보이고 나머지는 그대로 쓴다.
- Unity 프로젝트를 통째로 가져와도 `Library` `Temp` `Logs` `obj` `Build(s)` `UserSettings` `MemoryCaptures` 는 빠지고, 문서가 없는 폴더는 트리에 안 보인다. 항목이 2만 개를 넘으면 `⚠` — 하위 폴더를 가져온다. 브라우저는 폴더를 읽는 속도가 느려(2만 항목에 6~8초) 큰 프로젝트는 문서 폴더만 고르는 편이 낫다.
- 안 되는 것: 주 폴더나 다른 가져온 폴더와 **겹치는** 폴더(안에 있거나 감싸는), 브라우저가 막는 시스템 폴더. 주 폴더 ↔ 가져온 폴더 사이 이동.
- `tsv-view` 의 `file:`, `/` 로 시작하는 링크, 계산식 `lookup`, `_Field` 찾기는 **그 문서가 속한 폴더 안에서** 풀린다(가져온 폴더의 md 는 가져온 폴더 기준).

## 개발

```bash
npm run dev     # Vite 5173. http://127.0.0.1:5173 을 Edge/Chrome 에서 연다
npm run build   # 타입 검사 + dist/ + sw.js
npm test        # vitest — 파일 처리(메모리 파일 시스템)·TSV 왕복·편집·스키마·검증·tsv-view·계산식
```

- 폴더 선택 창은 자동화가 못 누른다. 화면 시험은 `http://127.0.0.1:5173/?opfs` (개발 전용) — 브라우저 안 저장소를 문서 폴더로 쓴다. 변경 감지도 실제로 돈다.
- 빌드본(서비스 워커 포함)은 `npx vite preview`. `.claude/launch.json` 에 둘 다 있다.
- 테스트의 SagaDocs 왕복 항목은 `../SagaDocs`(이 리포 옆), `C:\Users\user\SagaDocs` 등 후보 경로나 `SAGADOCS` 환경변수에서 리포를 찾고, 없으면 건너뛴다.

다른 PC에서 이어서 작업할 때는 [HANDOFF.md](HANDOFF.md). 전체 기능을 손으로 검증할 때는 [TESTCASES.md](TESTCASES.md).

## 구조

```
public/               manifest · 앱 아이콘
scripts/gen-sw.mjs    npm run build 끝에 dist/sw.js 생성 (오프라인 · 자동 업데이트)
scripts/gen-shortcuts.mjs  npm run shortcuts — SHORTCUTS.md 생성
.github/workflows/deploy.yml  main push → 테스트 · 빌드 → GitHub Pages 배포
src/
  lib/backend.ts      Backend 인터페이스, ConflictError
  lib/fsa/fsaBackend.ts  File System Access 구현 — 트리 · 읽기(인코딩 감지 · 바이너리/크기 거부) · 저장(낙관적 잠금) · 이름 변경(덮어쓰기 검사, move 실패 시 복사) · 변경 감지(FileSystemObserver, 뭉치기) · 가져온 폴더
  lib/fsa/workspace.ts   작업 공간(주 폴더 + 가져온 폴더) · IndexedDB 저장 · 권한 묻기
  lib/fsa/fake.ts     시험용 메모리 파일 시스템
  lib/fsa/devSeed.ts  개발 전용 `?opfs` — 폴더 선택 창 없이 브라우저 저장소로 화면 시험
  lib/pwa.ts          앱 설치 · 서비스 워커 등록 · 새 버전 안내
  lib/nav.ts          창 사이 이동 — 문서 열기 · 그리드 셀 선택 요청
  lib/filetypes.mjs   여는 파일 형식 표 (확장자 → md / table / text, 아이콘)
  lib/roots.mjs       가져온 폴더 경로 규칙 (`@별칭/…` 나누기·합치기, 같은 루트 안 경로, 별칭 규칙, 기본 무시 폴더)
  lib/jsonText.ts     JSON 문법 확인 · 정렬 (내용이 바뀌는 정렬은 거부)
  lib/cm.ts           CodeMirror 공통 설정 (마크다운 창 · 평문/JSON 창)
  lib/md/tsvView.ts   tsv-view 펜스 파서(YAML 부분집합) · where 식 · 필터/정렬 적용
  lib/md/template.ts  Mermaid 생성용 Mustache 부분집합 (each · if · .list · .id)
  lib/md/bake.ts      bake — 펜스 찾기 · 파이프 표 생성 · 저장 시 변경 계산
  lib/tsv/
    model.ts          TsvTable / TsvRow (불변, raw 행 보관)
    parse.ts          텍스트 → 표 (탭 split 만, 따옴표 해석 없음) · 열 때 경고
    serialize.ts      표 → 텍스트 (수정한 행만 재조립) · 셀 글자 정리
    csv.ts            CSV (RFC 4180) ↔ 같은 표 모델 — 레코드 원문·따옴표 칸 보존, 고친 레코드만 재조립
    table.ts          경로의 형식(tsv/csv)에 따라 읽기·쓰기·열 때 경고·셀 정리 — 스토어·bake 가 부른다
    edits.ts          setCell · 행/열 삽입·삭제·복제 · 붙여넣기 (순수 함수)
    clipboard.ts      Sheets 클립보드 TSV 파싱·만들기 (줄바꿈 든 칸만 따옴표)
    mdTable.ts        머리글 있는 표 읽기 — 마크다운 파이프 표 · <th> HTML 표 (DESIGN §19)
    field.ts          _Field 시트의 블록 읽기
    schema.ts         타입 행 + Field 블록 → 열 스키마 (enum 후보 · 설명 · Key)
    validate.ts       셀 검증 (타입 · enum · Key 중복)
  lib/calc/
    expr.ts           계산식 토크나이저 · 파서 · 평가기 (함수 · lookup)
    calc.ts           X_Calc.tsv 규칙 읽기 · 계산 · 적용 (stale 판정)
    *.test.ts         vitest
  store/documents.ts  DocumentStore — 경로당 문서 하나 (TextDoc | TsvDoc), 창 간 동기화, undo 스택, Field 캐시, dirty·충돌·저장
  components/
    Workbench.tsx     flexlayout-react 탭·분할·레이아웃 저장, 닫기 확인
    FileTree.tsx      파일 트리 (오른쪽 클릭 메뉴, 가져온 폴더 `@별칭` 노드)
    ImportDialog.tsx  폴더 가져오기 창 (폴더 선택 · 별칭 · 읽기 전용 · 최근 폴더)
    StartScreen.tsx   시작 화면 (문서 폴더 열기 · 전에 연 폴더) · 권한 다시 허용 화면
    MarkdownPane.tsx  CodeMirror 6 + 소스/하이브리드/분할/미리보기 모드. md 가 아니면 평문(txt) · JSON(강조·검사·정렬)
    ReadOnlyBanner.tsx 읽기 전용 배너 — 읽기 전용 가져온 폴더("읽기 전용 끄기") · UTF-8 아닌 파일("UTF-8 로 바꿔 저장")
    PreviewPane.tsx   react-markdown + mermaid(동적) + tsv-view 표(그 자리 편집 · 템플릿 렌더)
    hybrid.ts         하이브리드 Live Preview — CM6 StateField 장식 (표식 숨김 · 펜스 블록 위젯)
    grid/Grid.tsx     자체 DOM 그리드 — 행 윈도잉(고정 높이, 직접 계산) · 고정 헤더 · 입력 textarea 하나 · 드롭다운 · 범위 선택 · 채우기 핸들 · 열 드래그
    grid/GridPane.tsx 툴바(되돌리기·행/열) · 배너 · 상태줄, 스토어 ↔ Grid 연결
    PaneErrorBoundary.tsx 창 안쪽 렌더 오류를 잡아 저장 안 한 편집을 지킨다 (그리드)
```

## 보안

- **문서는 올라가지 않는다.** 서버가 없고, 코드는 브라우저 안에서 돌며 파일을 직접 읽고 쓴다. 공개되는 것은 앱 코드뿐이다.
- 배포된 코드는 허용한 폴더를 고칠 수 있다. **GitHub 2단계 인증 필수.** 라이브러리는 번들에 넣고 lockfile 로 고정하며, 실행 중에 CDN 에서 코드를 받지 않는다.
- 같은 주소(`krkoohoo.github.io`)의 다른 페이지는 저장소와 폴더 핸들을 함께 볼 수 있다. 위키와 `portfolio-test` 가 여기에 있으니 **두 사이트에 외부 스크립트나 다른 사람의 코드를 넣지 않는다.** 넣어야 한다면 JayDocs 를 먼저 다른 주소로 옮긴다.
- 경로는 허용한 폴더 아래로만(`..`, 절대 경로, `.git` 안 거부). 쓰기는 읽기 전용 폴더에서 막힌다.
- 삭제는 휴지통으로 가지 않는다. 앱이 그렇게 묻는다.
