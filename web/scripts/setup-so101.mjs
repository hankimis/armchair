// Downloads the official SO-101 URDF + STL meshes (TheRobotStudio/SO-ARM100,
// Apache-2.0) into public/so101 once, so the app renders the real robot.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAW = 'https://raw.githubusercontent.com/TheRobotStudio/SO-ARM100/main/Simulation/SO101'
const STLS = [
  'base_motor_holder_so101_v1.stl',
  'base_so101_v2.stl',
  'motor_holder_so101_base_v1.stl',
  'motor_holder_so101_wrist_v1.stl',
  'moving_jaw_so101_v1.stl',
  'rotation_pitch_so101_v1.stl',
  'sts3215_03a_no_horn_v1.stl',
  'sts3215_03a_v1.stl',
  'under_arm_so101_v1.stl',
  'upper_arm_so101_v1.stl',
  'waveshare_mounting_plate_so101_v2.stl',
  'wrist_roll_follower_so101_v1.stl',
  'wrist_roll_pitch_so101_v2.stl',
]

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'public', 'so101')
mkdirSync(join(dest, 'assets'), { recursive: true })

async function fetchTo(url, path) {
  if (existsSync(path)) return false
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  return true
}

try {
  let n = 0
  if (await fetchTo(`${RAW}/so101_new_calib.urdf`, join(dest, 'so101.urdf'))) n++
  for (const f of STLS) if (await fetchTo(`${RAW}/assets/${f}`, join(dest, 'assets', f))) n++
  console.log(n ? `so101 assets downloaded (${n} files)` : 'so101 assets already present')
} catch (err) {
  console.warn(`could not download SO-101 assets (${err}); the app will fall back to the built-in arm model.`)
  console.warn('retry later with: node scripts/setup-so101.mjs')
}
