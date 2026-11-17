import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 개발: `npm run dev`. 배포: `npm run build` → dist/ 를 Pages 에 올린다.
// base 를 상대 경로로 두어 어떤 주소 아래에 올려도 돈다.
// 화면에 보이는 버전은 빌드 날짜와 커밋이다 (GITHUB_SHA 는 Actions 가 준다).
const sha = process.env.GITHUB_SHA?.slice(0, 7)

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(sha ? `${new Date().toISOString().slice(0, 10)} · ${sha}` : '로컬 빌드'),
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        // assets/ 아래 이름에는 내용 해시가 든다 — scripts/gen-sw.mjs 가 이것을 믿고 이전 버전 파일을 재사용한다.
        // (Vite 기본값과 같다. 바꾸면 gen-sw.mjs 의 HASHED 도 함께 본다)
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        // 앱 코드만 바뀐 업데이트에서 라이브러리 청크 이름이 그대로 남게 한다.
        // 나누지 않으면 첫 화면 라이브러리와 rolldown 런타임 · Vite 프리로드 도우미가 앱 청크(index)에 함께 들고,
        // mermaid 청크들이 그것을 import 하므로 앱 한 줄만 바꿔도 mermaid 쪽 파일 이름이 거의 다 바뀐다.
        // - vendor: 첫 화면에 필요한 라이브러리(react · flexlayout · codemirror · react-markdown 계열)와
        //   가상 모듈(\0 로 시작: 프리로드 도우미 등). 런타임은 rolldown 이 따로 rolldown-runtime 청크로 뺀다.
        // - mermaid 와 그 의존성은 지연 로드 그대로 자동 분할에 맡긴다. 이제 vendor 와 런타임만 import 한다.
        codeSplitting: {
          groups: [
            // 가상 모듈(\0 로 시작: Vite 의 프리로드 도우미 등). mermaid 청크가 이것을 import 하므로 vendor 와도 떼어,
            // 앱이 라이브러리를 새로 쓰거나 라이브러리를 올려 vendor 가 바뀌어도 mermaid 쪽 이름이 남게 한다.
            { name: 'vite-helpers', test: (id) => id.startsWith('\0'), tags: ['$initial'], priority: 2 },
            { name: 'vendor', test: /[\\/]node_modules[\\/]/, tags: ['$initial'], priority: 1 },
          ],
        },
      },
    },
  },
})
