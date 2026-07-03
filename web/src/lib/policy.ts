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
}

let info: PolicyInfo | null = null

export async function loadPolicy(file: File): Promise<PolicyInfo> {
  stopPolicy()
  session = await ort.InferenceSession.create(await file.arrayBuffer(), {
    executionProviders: ['wasm'],
  })
  const inputName = session.inputNames.includes('obs') ? 'obs' : session.inputNames[0]
  const outputName = session.outputNames.includes('action') ? 'action' : session.outputNames[0]
  info = { name: file.name, inputName, outputName }
  return info
}

export function policyLoaded() {
  return session !== null
}

export function startPolicy(onStop?: () => void) {
  if (!session || timer) return
  sim.ikEnabled = false // the policy owns the targets now
  timer = setInterval(async () => {
    if (!session || busy || sim.playback) return
    busy = true
    try {
      const obs = new Float32Array(9)
      for (let i = 0; i < 6; i++) obs[i] = sim.joints[i]
      obs[6] = sim.cube.x
      obs[7] = sim.cube.y
      obs[8] = sim.cube.z
      const feeds = { [info!.inputName]: new ort.Tensor('float32', obs, [1, 9]) }
      const out = await session.run(feeds)
      const action = out[info!.outputName]
      const data = action.data as Float32Array
      // [1,6] or [1,H,6] — take the first action of the chunk
      for (let i = 0; i < 6; i++) {
        sim.targets[i] = clamp(data[i], LIMITS[i][0], LIMITS[i][1])
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
