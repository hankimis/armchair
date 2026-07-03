import { LIMITS, clamp, fkTip, solveIK } from './kinematics'

export const FPS = 30
export const DEFAULT_TASK = 'Pick up the cube and place it in the bin'

export interface Frame {
  t: number
  obs: number[] // observation.state — current joint positions
  act: number[] // action — commanded joint targets
  env: number[] // observation.environment_state — cube xyz
}

export interface Episode {
  id: string
  task: string
  fps: number
  success: boolean
  recordedAt: string
  frames: Frame[]
}

// Home pose: arm raised, gripper open, tip pointing down-ish.
export const HOME = [0, 0.9, -1.6, -0.87, 0, 1]

const SPEED = [3.5, 3.0, 3.5, 4.5, 5.0, 5.0] // max joint speed, rad/s (gripper: units/s)

const CUBE_HALF = 0.015
const SPAWNS = [
  { x: 0.2, z: 0.06 },
  { x: 0.22, z: -0.02 },
  { x: 0.17, z: 0.12 },
  { x: 0.24, z: 0.04 },
  { x: 0.19, z: -0.06 },
]

const homeTip = fkTip(HOME)

// Single mutable sim state, stepped inside the render loop. React reads
// snapshots of it at low frequency; three.js meshes read it every frame.
export const sim = {
  time: 0,
  joints: [...HOME],
  targets: [...HOME],
  ee: { ...homeTip }, // IK drag target (fingertip goal)
  pitch: -Math.PI / 2, // approach angle, default: straight down
  ikEnabled: true,

  cube: { x: SPAWNS[0].x, y: CUBE_HALF, z: SPAWNS[0].z, vy: 0, held: false },
  bin: { x: 0.16, z: -0.14, r: 0.055 },
  spawnIdx: 0,

  recording: false,
  recStart: 0,
  lastSample: -1,
  frames: [] as Frame[],

  playback: null as null | { ep: Episode; i: number; acc: number },

  // set by the WebSocket bridge when a real robot is connected
  wsSend: null as null | ((targets: number[]) => void),
}

export const orbit: { controls: { enabled: boolean } | null } = { controls: null }

const round5 = (v: number) => Math.round(v * 1e5) / 1e5

export function cubeInBin(): boolean {
  const { cube, bin } = sim
  return !cube.held && cube.y <= CUBE_HALF + 1e-3 && Math.hypot(cube.x - bin.x, cube.z - bin.z) < bin.r
}

export function resetCube() {
  sim.spawnIdx = (sim.spawnIdx + 1) % SPAWNS.length
  const s = SPAWNS[sim.spawnIdx]
  sim.cube = { x: s.x, y: CUBE_HALF, z: s.z, vy: 0, held: false }
}

export function syncGizmoToTip() {
  const tip = fkTip(sim.joints)
  sim.ee.x = tip.x
  sim.ee.y = Math.max(tip.y, 0.005)
  sim.ee.z = tip.z
}

export function toggleGripper() {
  sim.targets[5] = sim.targets[5] > 0.5 ? 0 : 1
}

export function startRecording() {
  sim.frames = []
  sim.recStart = sim.time
  sim.lastSample = -1
  sim.recording = true
}

export function stopRecording(task: string): Episode {
  sim.recording = false
  return {
    id: `ep_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    task,
    fps: FPS,
    success: cubeInBin(),
    recordedAt: new Date().toISOString(),
    frames: sim.frames,
  }
}

export function startPlayback(ep: Episode) {
  sim.recording = false
  sim.playback = { ep, i: 0, acc: 0 }
}

export function stopPlayback() {
  sim.playback = null
  syncGizmoToTip()
}

/** Advance the simulation. Called once per rendered frame. */
export function stepSim(rawDt: number) {
  const dt = Math.min(rawDt, 0.05)
  sim.time += dt

  // 1) resolve targets: playback > IK drag > joint sliders
  if (sim.playback) {
    const pb = sim.playback
    pb.acc += dt
    const frameDur = 1 / pb.ep.fps
    while (pb.acc >= frameDur && pb.i < pb.ep.frames.length) {
      sim.targets = [...pb.ep.frames[pb.i].act]
      pb.i++
      pb.acc -= frameDur
    }
    if (pb.i >= pb.ep.frames.length) stopPlayback()
  } else if (sim.ikEnabled) {
    const ik = solveIK(sim.ee.x, sim.ee.y, sim.ee.z, sim.pitch)
    for (let k = 0; k < 4; k++) sim.targets[k] = ik[k]
  }

  // 2) servos chase targets at bounded speed
  for (let k = 0; k < 6; k++) {
    const t = clamp(sim.targets[k], LIMITS[k][0], LIMITS[k][1])
    const d = t - sim.joints[k]
    const step = SPEED[k] * dt
    sim.joints[k] += Math.abs(d) <= step ? d : Math.sign(d) * step
  }

  // 3) cube: grasp / carry / drop
  const tip = fkTip(sim.joints)
  const cube = sim.cube
  const grip = sim.joints[5]
  if (!cube.held) {
    const near = Math.hypot(tip.x - cube.x, tip.y - cube.y, tip.z - cube.z) < 0.035
    if (near && grip < 0.35 && sim.targets[5] < 0.35) cube.held = true
  }
  if (cube.held) {
    if (grip > 0.5) {
      cube.held = false
      cube.vy = 0
    } else {
      cube.x = tip.x
      cube.y = Math.max(tip.y - 0.01, CUBE_HALF)
      cube.z = tip.z
    }
  } else if (cube.y > CUBE_HALF) {
    cube.vy -= 9.8 * dt
    cube.y += cube.vy * dt
    if (cube.y <= CUBE_HALF) {
      cube.y = CUBE_HALF
      cube.vy = 0
    }
  }

  // 4) fixed-rate tick: record a frame / stream to the real robot
  const period = 1 / FPS
  if (sim.time - sim.lastSample >= period - 1e-6) {
    sim.lastSample = sim.time
    if (sim.recording) {
      sim.frames.push({
        t: round5(sim.time - sim.recStart),
        obs: sim.joints.map(round5),
        act: sim.targets.map((v, k) => round5(clamp(v, LIMITS[k][0], LIMITS[k][1]))),
        env: [round5(cube.x), round5(cube.y), round5(cube.z)],
      })
    }
    sim.wsSend?.(sim.targets)
  }
}
