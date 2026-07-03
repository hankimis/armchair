// In-browser policy runner (onnxruntime-web). Expects an ONNX model with:
//   input  "obs"    float32 [1, 9]   — 6 joint positions + cube xyz
//   output "action" float32 [1, 6] or [1, H, 6] (action chunk; first step is used)
// scripts/export_policy_onnx.py produces this interface from a trained
// lerobot ACT policy (with normalization baked in).
import * as ort from 'onnxruntime-web'
import { LIMITS, clamp } from './kinematics'
import { sim, syncGizmoToTip } from './sim'

// absolute URL: the runtime loads its .mjs via dynamic import, which rejects
// bare relative specifiers
ort.env.wasm.wasmPaths = new URL('ort/', document.baseURI).href

export type PolicyStatus = 'none' | 'loading' | 'loaded' | 'running' | 'error'

let session: ort.InferenceSession | null = null
let timer: ReturnType<typeof setInterval> | null = null
let busy = false

export interface PolicyInfo {
  name: string
  inputName: string
  outputName: string
  stack: number // observation history length, encoded in the input name ("obs3")
}

let info: PolicyInfo | null = null
let history: Float32Array[] = []

export async function loadPolicy(file: File): Promise<PolicyInfo> {
  stopPolicy()
  session = await ort.InferenceSession.create(await file.arrayBuffer(), {
    executionProviders: ['wasm'],
  })
  const inputName =
    session.inputNames.find((n) => /^obs\d*$/.test(n)) ?? session.inputNames[0]
  const outputName = session.outputNames.includes('action') ? 'action' : session.outputNames[0]
  const stack = Number(/^obs(\d+)$/.exec(inputName)?.[1] ?? 1)
  info = { name: file.name, inputName, outputName, stack }
  return info
}

export function policyLoaded() {
  return session !== null
}

export function startPolicy(onStop?: () => void) {
  if (!session || timer) return
  sim.ikEnabled = false // the policy owns the targets now
  history = []
  timer = setInterval(async () => {
    if (!session || busy || sim.playback) return
    busy = true
    try {
      const now = new Float32Array(9)
      for (let i = 0; i < 6; i++) now[i] = sim.joints[i]
      now[6] = sim.cube.x
      now[7] = sim.cube.y
      now[8] = sim.cube.z
      history.unshift(now)
      if (history.length > info!.stack) history.length = info!.stack
      // newest first; pad the warm-up frames with the oldest available
      const obs = new Float32Array(9 * info!.stack)
      for (let k = 0; k < info!.stack; k++) {
        obs.set(history[Math.min(k, history.length - 1)], k * 9)
      }
      const feeds = { [info!.inputName]: new ort.Tensor('float32', obs, [1, 9 * info!.stack]) }
      const out = await session.run(feeds)
      const action = out[info!.outputName]
      const data = action.data as Float32Array
      // [1,6] or [1,H,6] — execute the LAST step of the chunk: a lookahead
      // waypoint (~H/30 s ahead). Executing the immediate step collapses to
      // target≈current-joints and the arm barely moves in closed loop.
      const chunkLen = action.dims.length === 3 ? Number(action.dims[1]) : 1
      const base = (chunkLen - 1) * 6
      for (let i = 0; i < 6; i++) {
        sim.targets[i] = clamp(data[base + i], LIMITS[i][0], LIMITS[i][1])
      }
    } catch (err) {
      console.warn('policy inference failed', err)
      stopPolicy()
      onStop?.()
    } finally {
      busy = false
    }
  }, 1000 / 30)
}

export function stopPolicy() {
  if (timer) clearInterval(timer)
  timer = null
  syncGizmoToTip()
  sim.ikEnabled = true
}

export function policyRunning() {
  return timer !== null
}
