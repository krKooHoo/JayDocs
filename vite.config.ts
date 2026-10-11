import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 개발: `npm run serve`(사이드카, 5190) + `npm run dev`(Vite, 5173). /api 는 사이드카로 프록시.
// 배포: `npm run build` → dist/ 를 사이드카가 그대로 서빙한다.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:5190', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
})
