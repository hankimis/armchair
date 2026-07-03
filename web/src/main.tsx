import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { resetCube, sim, toggleGripper } from './lib/sim'
import { toggleRecord } from './state/actions'
import './styles.css'

// dev-only scripting hook (demo recordings, e2e tests)
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__armchair = { sim, resetCube, toggleGripper, toggleRecord }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
