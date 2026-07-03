// Rapier (WASM) rigid-body physics for the manipulation scene. The arm itself
// stays kinematic (servo model in sim.ts); physics owns the cube, the ground,
// the bin, and a small "fingertip" pusher so the arm can nudge objects.
import type RAPIER_NS from '@dimforge/rapier3d-compat'

type Rapier = typeof RAPIER_NS

const STEP = 1 / 120
const CUBE_HALF = 0.015

let R: Rapier | null = null
let world: RAPIER_NS.World | null = null
let cubeBody: RAPIER_NS.RigidBody | null = null
let handBody: RAPIER_NS.RigidBody | null = null
let acc = 0
let lastTip = { x: 0, y: 0, z: 0 }

export interface CubePose {
  x: number
  y: number
  z: number
  q: [number, number, number, number]
}

export function physicsReady() {
  return world !== null
}

export async function initPhysics(bin: { x: number; z: number; r: number }, cubeAt: { x: number; z: number }) {
  if (R) return
  const RAPIER = (await import('@dimforge/rapier3d-compat')).default
  await RAPIER.init()
  R = RAPIER
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 })

  // ground
  w.createCollider(RAPIER.ColliderDesc.cuboid(1.5, 0.05, 1.5).setTranslation(0, -0.05, 0).setFriction(0.9))

  // bin: base pad + a ring of short wall segments (matches the visual torus)
  w.createCollider(RAPIER.ColliderDesc.cylinder(0.002, bin.r).setTranslation(bin.x, 0.002, bin.z).setFriction(0.9))
  const SEGS = 12
  const segHalfLen = bin.r * Math.tan(Math.PI / SEGS) + 0.004
  for (let i = 0; i < SEGS; i++) {
    const a = (i / SEGS) * Math.PI * 2
    const q = { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }
    w.createCollider(
      RAPIER.ColliderDesc.cuboid(0.004, 0.007, segHalfLen)
        .setTranslation(bin.x + Math.cos(a) * bin.r, 0.007, bin.z + Math.sin(a) * bin.r)
        .setRotation(q)
        .setFriction(0.8),
    )
  }

  // cube (dynamic)
  cubeBody = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(cubeAt.x, CUBE_HALF + 0.002, cubeAt.z).setAngularDamping(0.3),
  )
  w.createCollider(
    RAPIER.ColliderDesc.cuboid(CUBE_HALF, CUBE_HALF, CUBE_HALF).setFriction(0.8).setRestitution(0.1).setDensity(800),
    cubeBody,
  )

  // fingertip pusher (kinematic ball following the grasp point)
  handBody = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.3, 0))
  w.createCollider(RAPIER.ColliderDesc.ball(0.014).setFriction(0.6), handBody)

  world = w
}

export function grabCube() {
  if (!R || !cubeBody) return
  cubeBody.setBodyType(R.RigidBodyType.KinematicPositionBased, true)
}

export function releaseCube() {
  if (!R || !cubeBody) return
  cubeBody.setBodyType(R.RigidBodyType.Dynamic, true)
}

export function resetCubePhysics(at: { x: number; z: number }) {
  if (!R || !cubeBody) return
  cubeBody.setBodyType(R.RigidBodyType.Dynamic, true)
  cubeBody.setTranslation({ x: at.x, y: CUBE_HALF + 0.03, z: at.z }, true)
  cubeBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
  cubeBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
  cubeBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
}

/**
 * Advances physics with a fixed substep. `tip` is the grasp point from FK;
 * while `held`, the cube is carried kinematically (stable grasp), otherwise
 * the fingertip ball can push it around.
 */
export function stepPhysics(dt: number, tip: { x: number; y: number; z: number }, held: boolean): CubePose | null {
  if (!world || !cubeBody || !handBody) return null
  acc = Math.min(acc + dt, 0.1)
  while (acc >= STEP) {
    handBody.setNextKinematicTranslation({ x: tip.x, y: Math.max(tip.y, 0.014), z: tip.z })
    if (held) {
      cubeBody.setNextKinematicTranslation({
        x: tip.x,
        y: Math.max(tip.y - 0.01, CUBE_HALF),
        z: tip.z,
      })
    }
    world.step()
    acc -= STEP
  }
  // hand-off velocity so a released cube keeps the arm's motion
  if (held && dt > 0) {
    const vx = (tip.x - lastTip.x) / dt
    const vy = (tip.y - lastTip.y) / dt
    const vz = (tip.z - lastTip.z) / dt
    cubeBody.userData = { vx, vy, vz }
  }
  lastTip = { ...tip }
  const t = cubeBody.translation()
  const r = cubeBody.rotation()
  return { x: t.x, y: t.y, z: t.z, q: [r.x, r.y, r.z, r.w] }
}

/** Gives the just-released cube the carry velocity (call right after releaseCube). */
export function applyCarryVelocity() {
  if (!cubeBody) return
  const v = cubeBody.userData as { vx: number; vy: number; vz: number } | undefined
  if (v && Number.isFinite(v.vx)) {
    cubeBody.setLinvel({ x: v.vx, y: Math.max(v.vy, -0.5), z: v.vz }, true)
  }
}
