import { useEffect } from 'react'
import { Scene } from './components/Scene'
import { Panel } from './components/Panel'
import { HandPreview } from './components/HandPreview'
import { LIMITS, clamp } from './lib/kinematics'
import { resetCube, sim, toggleGripper } from './lib/sim'
import { toggleRecord } from './state/actions'

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      switch (e.code) {
        case 'Space':
          e.preventDefault()
          toggleGripper()
          break
        case 'KeyQ':
          sim.targets[4] = clamp(sim.targets[4] - 0.18, LIMITS[4][0], LIMITS[4][1])
          break
        case 'KeyE':
          sim.targets[4] = clamp(sim.targets[4] + 0.18, LIMITS[4][0], LIMITS[4][1])
          break
        case 'KeyR':
          toggleRecord()
          break
        case 'KeyX':
          resetCube()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App() {
  useKeyboard()
  return (
    <div className="app">
      <div className="viewport">
        <Scene />
        <HandPreview />
      </div>
      <Panel />
    </div>
  )
}
