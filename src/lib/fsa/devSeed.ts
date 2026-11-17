import type { Workspace } from './workspace'

/**
 * 개발 전용 (`npm run dev` 의 `?opfs`): 폴더 선택 창 없이 브라우저 안 저장소(OPFS)를 문서 폴더로 쓴다.
 * 자동 화면 시험용이고, 빌드에는 들어가지 않는다.
 */
// 표 형식은 DESIGN §2: 1행 타입 행(`#string` … 첫 셀의 `#` 뒤가 첫 열 타입, 빈 타입 = 주석 열), 2행 머리글.
// 첫 열 이름이 `Key` 면 Key 중복 검사. `X_Field.tsv` 는 빈 줄로 나눈 블록(첫 줄 = 블록 이름) —
// `XDef` 블록은 열 설명, 열 이름과 같은 이름의 블록은 enum 후보. `X_Calc.tsv` 는 F9 로 값 열을 채우는 규칙(§17).
const ITEM_TABLE = [
  '#string\tstring\tenum\tbool\tuint\tuint\t',
  'Key\tDisplayName\tCategory\tTradable\tBuildCost\tUpkeep\t#메모',
  'Sword\t검\tWeapon\tTRUE\t120\t2\t',
  'Shield\t방패\tArmor\tTRUE\t90\t2\t',
  'Potion\t물약\tConsumable\tTRUE\t30\t1\t',
  'Scroll\t두루마리\tConsumable\tFALSE\t45\t9\tUpkeep 이 식과 다름 (노란 칸)',
  'Bow\t활\tWeapn\tTRUE\t100\t2\t검증 오류: 없는 enum 값',
  'Axe\t도끼\tWeapon\tmaybe\t-5\t2\t검증 오류: bool · uint',
  'Potion\t물약 2\tConsumable\tTRUE\t35\t1\t검증 오류: 중복 Key',
  '',
].join('\n')

const ITEM_FIELD = [
  'ItemDef\t설명\tNote',
  'Key\t아이템 고유 키\t파일 안에서 유일',
  'DisplayName\t화면에 보이는 이름\t',
  'Category\t분류\t아래 Category 블록의 값만',
  'Tradable\t거래 가능 여부\tTRUE / FALSE',
  'BuildCost\t제작 비용\t',
  'Upkeep\t유지비\tItem_Calc.tsv 가 채움',
  '',
  'Category\t설명',
  'Weapon\t무기',
  'Armor\t방어구',
  'Consumable\t소모품',
  '',
].join('\n')

const ITEM_CALC = ['Target\tFormula\t#메모', 'Upkeep\t=max(1, round(BuildCost / 60))\t제작 비용의 약 1/60', 'Upkeep[Sword]\t=5\t이 행만', ''].join('\n')

const SAMPLE: Record<string, string> = {
  'docs/개요.md': '# 개요\n\n본문 **굵게**\n\n```mermaid\ngraph LR\n  A --> B\n```\n',
  'docs/표.tsv': '#string\tstring\tuint\n이름\t값\n가\t1\n나\t2\n',
  'docs/아이템.md': [
    '# 아이템',
    '',
    '표 파일을 연결해 보여 준다. 표 값이 바뀌면 이 문서의 표도 바뀐다.',
    '',
    '```tsv-view',
    'file: data/Item/Item_Table.tsv',
    'columns: [Key, DisplayName, Category, BuildCost]',
    'where: Category == "Consumable"',
    'sort: -BuildCost',
    '```',
    '',
  ].join('\n'),
  'data/Item/Item_Table.tsv': ITEM_TABLE,
  'data/Item/Item_Field.tsv': ITEM_FIELD,
  'data/Item/Item_Calc.tsv': ITEM_CALC,
  '메모.txt': '메모\r\n',
  '설정.json': '{\n  "n": 1\n}\n',
}

export async function devWorkspace(): Promise<Workspace> {
  const opfs = await navigator.storage.getDirectory()
  const primary = await opfs.getDirectoryHandle('dev-docs', { create: true })
  const mount = await opfs.getDirectoryHandle('dev-mount', { create: true })
  const put = async (root: FileSystemDirectoryHandle, rel: string, text: string) => {
    const parts = rel.split('/')
    const name = parts.pop() as string
    let d = root
    for (const p of parts) d = await d.getDirectoryHandle(p, { create: true })
    const h = await d.getFileHandle(name, { create: true })
    if ((await h.getFile()).size > 0) return
    const w = await h.createWritable()
    await w.write(text)
    await w.close()
  }
  for (const [rel, text] of Object.entries(SAMPLE)) await put(primary, rel, text)
  await put(mount, '가져온 문서.md', '# 가져온 문서\n')
  return { id: 'dev', primary, mounts: [{ alias: '가져온폴더', handle: mount, readOnly: false }], recent: [] }
}
