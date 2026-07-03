// Copies the MediaPipe wasm runtime out of node_modules and fetches the hand
// landmarker model once, so the app serves everything itself (no CDN at runtime).
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'public', 'mediapipe')
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

mkdirSync(join(dest, 'wasm'), { recursive: true })
cpSync(join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'), join(dest, 'wasm'), {
  recursive: true,
})
console.log('mediapipe wasm copied to public/mediapipe/wasm')

const modelPath = join(dest, 'hand_landmarker.task')
if (existsSync(modelPath)) {
  console.log('hand_landmarker.task already present')
} else {
  try {
    const res = await fetch(MODEL_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()))
    console.log('hand_landmarker.task downloaded')
  } catch (err) {
    console.warn(`could not download hand model (${err}); hand control will be unavailable.`)
    console.warn(`retry later with: node scripts/setup-mediapipe.mjs`)
  }
}
