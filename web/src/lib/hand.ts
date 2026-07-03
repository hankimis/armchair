import { DrawingUtils, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { clamp } from './kinematics'
import { sim } from './sim'

export type HandStatus = 'off' | 'loading' | 'tracking' | 'no-hand' | 'error'

// Served from public/mediapipe (see scripts/setup-mediapipe.mjs).
const WASM_BASE = 'mediapipe/wasm'
const MODEL_PATH = 'mediapipe/hand_landmarker.task'

// Hand landmark indices (MediaPipe convention)
const WRIST = 0
const PALM = [0, 5, 9, 13, 17]
const MIDDLE_MCP = 9
const FINGER_TIPS = [8, 12, 16] // index, middle, ring — thumb/pinky are too noisy

const SMOOTH = 0.35 // EMA factor per detection frame

// Gripper gesture: make a fist to close, open your hand to release.
// "Openness" = mean fingertip-to-wrist distance over palm length (3D, so it
// stays valid when fingers point at the camera). Fist ≈ 0.9, open hand ≈ 1.8.
const FIST_OPENNESS = 1.05 // at/below -> gripper fully closed
const OPEN_OPENNESS = 1.6 // at/above -> gripper fully open

let session = 0
let stream: MediaStream | null = null
let landmarker: HandLandmarker | null = null
let raf = 0

function cleanup(video: HTMLVideoElement | null) {
  cancelAnimationFrame(raf)
  landmarker?.close()
  landmarker = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  if (video) video.srcObject = null
}

export function stopHandTracking(video: HTMLVideoElement | null = null) {
  session++
  cleanup(video)
}

export async function startHandTracking(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  onStatus: (s: HandStatus) => void,
) {
  const my = ++session
  onStatus('loading')
  try {
    const media = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 360, facingMode: 'user' },
      audio: false,
    })
    if (my !== session) {
      media.getTracks().forEach((t) => t.stop())
      return
    }
    stream = media
    video.srcObject = media
    await video.play()

    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE)
    const lm = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    })
    if (my !== session) {
      lm.close()
      return
    }
    landmarker = lm

    const ctx = canvas.getContext('2d')!
    const drawer = new DrawingUtils(ctx)
    const smoothed = { x: sim.ee.x, y: sim.ee.y, z: sim.ee.z, grip: sim.targets[5] }

    const loop = () => {
      if (my !== session) return
      if (video.readyState >= 2 && landmarker) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
        }
        const result = landmarker.detectForVideo(video, performance.now())
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        const hand = result.landmarks?.[0]
        if (hand) {
          onStatus('tracking')
          drawer.drawConnectors(hand, HandLandmarker.HAND_CONNECTIONS, { color: '#39c26d', lineWidth: 2 })
          drawer.drawLandmarks(hand, { color: '#ffd166', radius: 2.5 })
          applyHand(hand, smoothed)
        } else {
          onStatus('no-hand')
        }
      }
      raf = requestAnimationFrame(loop)
    }
    loop()
  } catch (err) {
    console.warn('hand tracking failed', err)
    if (my === session) {
      cleanup(video)
      onStatus('error')
    }
  }
}

type Landmark = { x: number; y: number; z: number }

const dist3 = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/**
 * Maps one detected hand to the IK target and gripper:
 *   left/right  -> target z (side to side)
 *   up/down     -> target height
 *   near/far    -> reach (hand size on screen as a depth proxy)
 *   fist/open hand -> gripper close/open
 */
function applyHand(hand: Landmark[], s: { x: number; y: number; z: number; grip: number }) {
  if (sim.playback || !sim.ikEnabled) return

  let px = 0
  let py = 0
  for (const i of PALM) {
    px += hand[i].x
    py += hand[i].y
  }
  px /= PALM.length
  py /= PALM.length

  // hand size in image units ~ distance to camera (2D on purpose: depth proxy)
  const scale = Math.hypot(hand[WRIST].x - hand[MIDDLE_MCP].x, hand[WRIST].y - hand[MIDDLE_MCP].y)

  const mirroredX = 1 - px // preview is mirrored; keep motion intuitive
  const z = clamp((mirroredX - 0.5) * 0.5, -0.22, 0.22)
  const y = clamp((0.62 - py) * 0.5 + 0.02, 0.01, 0.3)
  const r = clamp(0.31 - scale * 0.55, 0.1, 0.25)
  const x = Math.sqrt(Math.max(r * r - z * z, 0.004))

  s.x += (x - s.x) * SMOOTH
  s.y += (y - s.y) * SMOOTH
  s.z += (z - s.z) * SMOOTH
  sim.ee.x = s.x
  sim.ee.y = s.y
  sim.ee.z = s.z

  const palmLen = Math.max(dist3(hand[WRIST], hand[MIDDLE_MCP]), 1e-3)
  let openness = 0
  for (const tip of FINGER_TIPS) openness += dist3(hand[WRIST], hand[tip])
  openness /= FINGER_TIPS.length * palmLen
  const grip = clamp((openness - FIST_OPENNESS) / (OPEN_OPENNESS - FIST_OPENNESS), 0, 1)
  s.grip += (grip - s.grip) * SMOOTH
  sim.targets[5] = s.grip
}
