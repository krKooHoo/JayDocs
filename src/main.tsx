import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'flexlayout-react/style/light.css'
import './styles.css'
import App from './App'
import { AppErrorBoundary } from './components/CrashScreen'
import { pwa } from './lib/pwa'

pwa.start()

// 렌더 오류가 나도 검은 화면만 남지 않게 앱 전체를 감싼다 (DESIGN §22 U11)
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
