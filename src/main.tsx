import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'flexlayout-react/style/light.css'
import './styles.css'
import App from './App'
import { pwa } from './lib/pwa'

pwa.start()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
