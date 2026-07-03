import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initPhysics } from './lib/physics'
import { placeCube, resetCube, sim, spawnPoint, toggleGripper } from './lib/sim'
import { toggleRecord } from './state/actions'
import { useStore } from './state/store'
import './styles.css'

initPhysics(sim.bin, spawnPoint())

// dev-only scripting hook (demo recordings, e2e tests)
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__armchair = {
    sim,
    resetCube,
    placeCube,
    toggleGripper,
    toggleRecord,
    store: useStore,
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
