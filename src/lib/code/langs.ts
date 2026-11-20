import type { LanguageRegistration } from 'shiki/core'

/**
 * 코드 블록에 색을 넣는 언어 — 한 곳에서 관리한다 (DESIGN §27 CC3).
 * 언어를 늘릴 때는 여기에 한 줄. 문법은 그 언어의 코드 블록을 처음 그릴 때 받는다(언어마다 청크 하나).
 *
 * 표에 없는 언어는 색 없이 지금처럼 보인다. 일부러 좁게 둔다 — 서비스 워커가 dist 의 파일을 전부 미리 받으므로
 * 문법을 넣는 만큼 설치 · 업데이트가 무거워진다 (C++ 문법 하나가 530 kB 라 뺐다).
 *
 * id — Shiki 의 언어 이름 · aliases — 펜스에 적는 다른 이름 (```cs · ```c# …). 대소문자는 가리지 않는다.
 */
export interface CodeLang {
  id: string
  label: string
  aliases: string[]
  load: () => Promise<{ default: LanguageRegistration[] }>
}

export const CODE_LANGS: CodeLang[] = [
  { id: 'csharp', label: 'C#', aliases: ['cs', 'c#'], load: () => import('shiki/langs/csharp.mjs') },
  { id: 'hlsl', label: 'HLSL', aliases: ['cg', 'cginc'], load: () => import('shiki/langs/hlsl.mjs') },
  { id: 'shaderlab', label: 'ShaderLab', aliases: ['shader'], load: () => import('shiki/langs/shaderlab.mjs') },
  { id: 'json', label: 'JSON', aliases: [], load: () => import('shiki/langs/json.mjs') },
  { id: 'jsonc', label: 'JSON (주석)', aliases: ['json5'], load: () => import('shiki/langs/jsonc.mjs') },
  { id: 'yaml', label: 'YAML', aliases: ['yml'], load: () => import('shiki/langs/yaml.mjs') },
  { id: 'xml', label: 'XML', aliases: ['uxml', 'csproj', 'xaml'], load: () => import('shiki/langs/xml.mjs') },
  { id: 'html', label: 'HTML', aliases: ['htm'], load: () => import('shiki/langs/html.mjs') },
  { id: 'css', label: 'CSS', aliases: ['uss'], load: () => import('shiki/langs/css.mjs') },
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'mjs', 'cjs'], load: () => import('shiki/langs/javascript.mjs') },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts'], load: () => import('shiki/langs/typescript.mjs') },
  { id: 'python', label: 'Python', aliases: ['py'], load: () => import('shiki/langs/python.mjs') },
  { id: 'lua', label: 'Lua', aliases: [], load: () => import('shiki/langs/lua.mjs') },
  { id: 'shellscript', label: '셸', aliases: ['bash', 'sh', 'shell', 'zsh'], load: () => import('shiki/langs/shellscript.mjs') },
  { id: 'powershell', label: 'PowerShell', aliases: ['ps', 'ps1', 'pwsh'], load: () => import('shiki/langs/powershell.mjs') },
  { id: 'bat', label: '배치', aliases: ['batch', 'cmd'], load: () => import('shiki/langs/bat.mjs') },
  { id: 'ini', label: 'INI', aliases: ['properties'], load: () => import('shiki/langs/ini.mjs') },
  { id: 'sql', label: 'SQL', aliases: [], load: () => import('shiki/langs/sql.mjs') },
  { id: 'diff', label: 'Diff', aliases: ['patch'], load: () => import('shiki/langs/diff.mjs') },
]

const BY_NAME = new Map<string, CodeLang>()
for (const l of CODE_LANGS) for (const name of [l.id, ...l.aliases]) BY_NAME.set(name, l)

/**
 * 펜스의 언어 표기(```csharp title="…" 의 `csharp title="…"`) → 표의 언어 id. 표에 없으면 null.
 * 첫 낱말만 본다.
 */
export function codeLangOf(info: string | null | undefined): string | null {
  const name = /^[^\s{,:]+/.exec((info ?? '').trim())?.[0].toLowerCase()
  return (name && BY_NAME.get(name)?.id) || null
}

export function codeLang(id: string): CodeLang | undefined {
  return BY_NAME.get(id)
}
