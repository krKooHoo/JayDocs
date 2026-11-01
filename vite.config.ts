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
  },
})
