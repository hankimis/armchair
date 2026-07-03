// SO-101-like 5-DOF arm + gripper. Lengths in meters, angles in radians.
// Joint order matches LeRobot's SO-101 convention.
export const JOINT_NAMES = [
  'shoulder_pan',
  'shoulder_lift',
  'elbow_flex',
  'wrist_flex',
  'wrist_roll',
  'gripper',
] as const

export const BASE_H = 0.12 // ground -> shoulder_lift axis
export const L1 = 0.115 // upper arm
export const L2 = 0.135 // forearm
export const L3 = 0.105 // wrist_flex axis -> fingertip

// [min, max] per joint. Gripper is normalized: 0 = closed, 1 = open.
export const LIMITS: [number, number][] = [
  [-1.92, 1.92],
  [-0.35, 1.83],
  [-2.9, 0.0],
  [-1.8, 1.8],
  [-2.62, 2.62],
  [0, 1],
]

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Analytic IK. `pitch` is the end-effector approach angle in the arm's
 * vertical plane (0 = horizontal, -PI/2 = pointing straight down).
 * Returns [pan, lift, elbow, wristFlex], elbow-up solution, clamped to limits.
 */
export function solveIK(tx: number, ty: number, tz: number, pitch: number): number[] {
  const pan = Math.atan2(-tz, tx)
  const r = Math.hypot(tx, tz)
  const y = ty - BASE_H

  // wrist_flex axis position, backed off from the fingertip along the approach direction
  const wr = r - L3 * Math.cos(pitch)
  const wy = y - L3 * Math.sin(pitch)

  let d = Math.hypot(wr, wy)
  d = clamp(d, Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4)

  const a = Math.atan2(wy, wr)
  const cosElbow = clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1)
  const cosShoulder = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)

  const lift = a + Math.acos(cosShoulder)
  const elbow = Math.acos(cosElbow) - Math.PI
  const wristFlex = pitch - lift - elbow

  return [
    clamp(pan, LIMITS[0][0], LIMITS[0][1]),
    clamp(lift, LIMITS[1][0], LIMITS[1][1]),
    clamp(elbow, LIMITS[2][0], LIMITS[2][1]),
    clamp(wristFlex, LIMITS[3][0], LIMITS[3][1]),
  ]
}

/** Forward kinematics: world position of the fingertip. */
export function fkTip(j: number[]): { x: number; y: number; z: number } {
  let ang = j[1]
  let px = 0
  let py = BASE_H
  px += L1 * Math.cos(ang)
  py += L1 * Math.sin(ang)
  ang += j[2]
  px += L2 * Math.cos(ang)
  py += L2 * Math.sin(ang)
  ang += j[3]
  px += L3 * Math.cos(ang)
  py += L3 * Math.sin(ang)
  return { x: px * Math.cos(j[0]), y: py, z: -px * Math.sin(j[0]) }
}
