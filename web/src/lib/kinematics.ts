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

// Measured from the official so101_new_calib.urdf (joint frame world positions).
export const BASE_H = 0.1166 // ground -> shoulder_lift axis
export const R0 = 0.0304 // pan axis -> shoulder_lift axis, horizontal offset
export const L1 = 0.116 // upper arm
export const L2 = 0.135 // forearm
export const L3 = 0.15 // wrist_flex axis -> grasp point between the jaws

// [min, max] per joint, sim convention (derived from URDF limits through the
// calibration mapping in ArmUrdf). Gripper is normalized: 0 = closed, 1 = open.
export const LIMITS: [number, number][] = [
  [-1.92, 1.92],
  [-0.4, 1.9],
  [-2.95, 0.35],
  [-1.62, 1.65],
  [-2.74, 2.74],
  [0, 1],
]

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Analytic IK. `pitch` is the end-effector approach angle in the arm's
 * vertical plane (0 = horizontal, -PI/2 = pointing straight down).
 * Elbow-up solution. When the requested pitch would push wrist_flex past its
 * physical limit, the approach angle is relaxed iteratively toward the
 * closest achievable one so the fingertip still reaches the target.
 * Returns [pan, lift, elbow, wristFlex], clamped to limits.
 */
export function solveIK(tx: number, ty: number, tz: number, pitch: number): number[] {
  const pan = Math.atan2(-tz, tx)
  const r = Math.hypot(tx, tz) - R0
  const y = ty - BASE_H
  const [wLo, wHi] = LIMITS[3]

  let p = pitch
  let lift = 0
  let elbow = 0
  let wristFlex = 0
  for (let i = 0; i < 3; i++) {
    // wrist_flex axis position, backed off from the grasp point along the approach direction
    const wr = r - L3 * Math.cos(p)
    const wy = y - L3 * Math.sin(p)
    const d = clamp(Math.hypot(wr, wy), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4)

    const a = Math.atan2(wy, wr)
    const cosElbow = clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1)
    const cosShoulder = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)

    lift = a + Math.acos(cosShoulder)
    elbow = Math.acos(cosElbow) - Math.PI
    wristFlex = p - lift - elbow
    if (wristFlex >= wLo && wristFlex <= wHi) break
    p = lift + elbow + clamp(wristFlex, wLo, wHi)
  }

  return [
    clamp(pan, LIMITS[0][0], LIMITS[0][1]),
    clamp(lift, LIMITS[1][0], LIMITS[1][1]),
    clamp(elbow, LIMITS[2][0], LIMITS[2][1]),
    clamp(wristFlex, wLo, wHi),
  ]
}

/** Forward kinematics: wrist_flex axis position + approach direction (for the wrist camera). */
export function fkWrist(j: number[]): { x: number; y: number; z: number; chord: number } {
  let ang = j[1]
  let px = 0
  let py = BASE_H
  px += L1 * Math.cos(ang)
  py += L1 * Math.sin(ang)
  ang += j[2]
  px += L2 * Math.cos(ang)
  py += L2 * Math.sin(ang)
  const rx = px + R0
  return { x: rx * Math.cos(j[0]), y: py, z: -rx * Math.sin(j[0]), chord: ang + j[3] }
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
  const rx = px + R0
  return { x: rx * Math.cos(j[0]), y: py, z: -rx * Math.sin(j[0]) }
}
