// Copies the onnxruntime-web WASM runtime out of node_modules so the in-browser
// policy runner can load it without a CDN.
import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'onnxruntime-web', 'dist')
const dest = join(root, 'public', 'ort')
mkdirSync(dest, { recursive: true })
// wasm execution provider runtimes (the default web bundle asks for the
// jsep variant; keep the plain one too for the wasm-only bundle)
const FILES = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
]
let n = 0
for (const f of readdirSync(src)) {
  if (FILES.includes(f)) {
    cpSync(join(src, f), join(dest, f))
    n++
  }
}
console.log(`onnxruntime wasm runtime copied (${n} files)`)
