import type { HighlighterCore } from 'shiki/core'
import { codeLang } from './langs'

/**
 * 코드 블록 색 (DESIGN §27). Shiki(VS Code 의 문법 · 테마)로 토큰을 나눈다.
 * 미리보기(`components/CodeBlock.tsx`)와 편집기(`cmColors.ts`)가 같이 쓴다 — 두 곳의 색이 같다.
 *
 * - Shiki 본체와 문법은 코드 블록을 처음 그릴 때 받는다. 그 전의 `tokenizeCode` 는 null 을 돌려주고
 *   다 받으면 `onCodeReady` 로 알린다(받는 동안은 색 없이 보인다).
 * - 토큰마다 밝은 테마 · 어두운 테마 색을 둘 다 준다. 테마 전환은 CSS 만으로 된다(다시 나누지 않는다).
 * - 결과는 (언어, 글) 로 기억한다. 편집기는 글자 · 커서가 바뀔 때마다 묻는다.
 */

/** 색이 같은 글자 한 토막. 색이 없으면(undefined) 코드 상자의 기본 글자색 */
export interface CodeToken {
  text: string
  light?: string
  dark?: string
  italic?: boolean
  bold?: boolean
}
export type CodeLines = CodeToken[][]

/** 이보다 긴 블록은 색을 넣지 않는다 — 고칠 때마다 블록 전체를 다시 나누기 때문이다 (390줄 블록에서 입력이 멈춘 뒤 113 ms 한 번, DESIGN §27 CC5) */
export const CODE_MAX_LINES = 400
export const CODE_MAX_CHARS = 40_000
const CACHE_MAX = 300

const LIGHT = 'light-plus'
const DARK = 'dark-plus'
const ITALIC = 1
const BOLD = 2

let core: HighlighterCore | null = null
let corePromise: Promise<HighlighterCore> | null = null
let fg = { light: '', dark: '' }
const ready = new Set<string>()
const failed = new Set<string>()
const loading = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
const cache = new Map<string, CodeLines>()
let version = 0

function loadCore() {
  corePromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, dark, light] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/themes/dark-plus.mjs'),
      import('shiki/themes/light-plus.mjs'),
    ])
    const hl = await createHighlighterCore({ themes: [dark.default, light.default], langs: [], engine: createJavaScriptRegexEngine() })
    fg = { light: hl.getTheme(LIGHT).fg.toLowerCase(), dark: hl.getTheme(DARK).fg.toLowerCase() }
    core = hl
    return hl
  })()
  return corePromise
}

/** 언어의 문법을 받는다. 표에 없는 언어면 거절한다. 이미 받았으면 바로 끝난다 */
export function loadCodeLang(id: string): Promise<void> {
  if (ready.has(id)) return Promise.resolve()
  const def = codeLang(id)
  if (!def || def.id !== id) return Promise.reject(new Error(`색을 넣지 않는 언어입니다: ${id}`))
  let p = loading.get(id)
  if (!p) {
    p = (async () => {
      try {
        const [hl, mod] = await Promise.all([loadCore(), def.load()])
        await hl.loadLanguage(mod.default)
        ready.add(id)
      } catch (e) {
        // 한 번 실패한 언어는 다시 받지 않는다(그릴 때마다 되풀이하지 않게) — 색 없이 보인다
        failed.add(id)
        console.warn(`코드 색: ${id} 문법을 받지 못했습니다:`, (e as Error).message)
        throw e
      } finally {
        loading.delete(id)
        version++
        for (const fn of listeners) fn()
      }
    })()
    loading.set(id, p)
  }
  return p
}

/** 언어 하나를 다 받았거나 받지 못했을 때 부른다. 돌려주는 함수로 그만 듣는다 */
export function onCodeReady(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 받은 언어가 달라질 때마다 오른다 (React 의 useSyncExternalStore 용) */
export function codeVersion() {
  return version
}

export function isTooLong(code: string) {
  if (code.length > CODE_MAX_CHARS) return true
  let lines = 1
  for (let i = code.indexOf('\n'); i >= 0; i = code.indexOf('\n', i + 1)) if (++lines > CODE_MAX_LINES) return true
  return false
}

/**
 * 코드를 줄 · 토큰으로 나눈다. `lang` 은 표의 id (`codeLangOf` 가 준 것).
 * 아직 문법을 받지 못했으면 받기 시작하고 null — 다 받으면 `onCodeReady` 가 불린다. 너무 긴 블록 · 받지 못한 언어도 null.
 */
export function tokenizeCode(code: string, lang: string): CodeLines | null {
  if (failed.has(lang) || isTooLong(code)) return null
  if (!core || !ready.has(lang)) {
    void loadCodeLang(lang).catch(() => { /* 위에서 알렸다 */ })
    return null
  }
  const key = `${lang}\n${code}`
  const hit = cache.get(key)
  if (hit) {
    // 최근에 쓴 것이 뒤로 가게 다시 넣는다
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  let lines: CodeLines
  try {
    lines = core.codeToTokensWithThemes(code, { lang, themes: { light: LIGHT, dark: DARK } }).map((line) => {
      const out: CodeToken[] = []
      for (const t of line) {
        const tok = toToken(t.content, t.variants.light, t.variants.dark)
        const prev = out[out.length - 1]
        if (prev && sameStyle(prev, tok)) prev.text += tok.text
        else out.push(tok)
      }
      return out
    })
  } catch (e) {
    // 문법이 이 글을 못 읽는다(정규식 엔진이 못 바꾼 무늬 등). 색 없이 보이고, 같은 글로 다시 시도하지 않는다
    console.warn(`코드 색: ${lang} 블록을 나누지 못했습니다:`, (e as Error).message)
    lines = code.split('\n').map((text) => (text ? [{ text }] : []))
  }
  cache.set(key, lines)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return lines
}

interface Variant { color?: string; fontStyle?: number }

function toToken(text: string, light: Variant | undefined, dark: Variant | undefined): CodeToken {
  // 빈칸뿐인 토막은 색이 보이지 않는다 → 기본색으로 두어 옆 토막과 합쳐지게 한다
  if (text.trim() === '') return { text }
  const tok: CodeToken = { text }
  const l = light?.color?.toLowerCase()
  const d = dark?.color?.toLowerCase()
  // 테마의 기본 글자색은 넣지 않는다 — 코드 상자의 글자색(앱 테마)을 따른다
  if (l && l !== fg.light) tok.light = l
  if (d && d !== fg.dark) tok.dark = d
  const style = (dark?.fontStyle ?? light?.fontStyle ?? 0) as number
  if (style > 0 && style & ITALIC) tok.italic = true
  if (style > 0 && style & BOLD) tok.bold = true
  return tok
}

function sameStyle(a: CodeToken, b: CodeToken) {
  return a.light === b.light && a.dark === b.dark && !!a.italic === !!b.italic && !!a.bold === !!b.bold
}

/** 기본 글자색 그대로인 토막인가 (감쌀 필요가 없다) */
export function isPlainToken(t: CodeToken) {
  return !t.light && !t.dark && !t.italic && !t.bold
}

/** 토막의 class · style — 미리보기의 span 과 편집기의 mark 가 같은 것을 쓴다. 색은 styles.css 의 `.tk` 가 테마에 맞춰 고른다 */
export function tokenClass(t: CodeToken) {
  return `tk${t.italic ? ' tk-i' : ''}${t.bold ? ' tk-b' : ''}`
}

export function tokenStyle(t: CodeToken) {
  return `${t.light ? `--tk-l:${t.light};` : ''}${t.dark ? `--tk-d:${t.dark};` : ''}`
}
