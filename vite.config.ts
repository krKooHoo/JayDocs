import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 개발: `npm run dev`. 배포: `npm run build` → dist/ 를 Pages 에 올린다.
// base 를 상대 경로로 두어 어떤 주소 아래에 올려도 돈다.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
})
