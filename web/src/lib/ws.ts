import { JOINT_NAMES } from './kinematics'
import { sim } from './sim'

export type RobotStatus = 'off' | 'connecting' | 'on'

let socket: WebSocket | null = null

/**
 * Connects to the Python bridge (scripts/so101_bridge.py) and streams the
 * commanded joint targets at the sim's fixed tick rate.
 */
export function connectRobot(url: string, onStatus: (s: RobotStatus) => void) {
  disconnectRobot()
  onStatus('connecting')
  try {
    socket = new WebSocket(url)
  } catch {
    onStatus('off')
    return
  }
  const ws = socket
  ws.onopen = () => {
    onStatus('on')
    sim.wsSend = (targets) => {
      if (ws.readyState !== WebSocket.OPEN) return
      const joints: Record<string, number> = {}
      JOINT_NAMES.forEach((n, i) => (joints[n] = Math.round(targets[i] * 1e5) / 1e5))
      ws.send(JSON.stringify({ type: 'action', t: Math.round(sim.time * 1e3), joints }))
    }
  }
  const drop = () => {
    if (socket === ws) {
      sim.wsSend = null
      socket = null
      onStatus('off')
    }
  }
  ws.onclose = drop
  ws.onerror = drop
}

export function disconnectRobot() {
  sim.wsSend = null
  socket?.close()
  socket = null
}
