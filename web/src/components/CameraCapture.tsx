import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { fkTip } from '../lib/kinematics'
import { sim } from '../lib/sim'

export const CAM_W = 320
export const CAM_H = 240

// Layer 1 = teleop UI artifacts (gizmo, guide line). The viewport camera
// renders them; the observation cameras below only render layer 0, so the
// dataset images stay free of operator overlays.
export const UI_LAYER = 1

// Render targets are written in linear color space; convert to sRGB so the
// saved JPEGs match what the viewport shows.
const SRGB = new Uint8ClampedArray(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  SRGB[i] = Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255)
}

/**
 * Renders the scene from a fixed front camera and a wrist-mounted camera at
 * each recording tick, storing JPEG frames alongside the state stream.
 */
export function CameraCapture() {
  const { gl, scene } = useThree()

  const rig = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(CAM_W, CAM_H)
    const front = new THREE.PerspectiveCamera(42, CAM_W / CAM_H, 0.01, 5)
    front.position.set(0.46, 0.28, 0.38)
    front.lookAt(0.14, 0.03, 0)
    const wrist = new THREE.PerspectiveCamera(62, CAM_W / CAM_H, 0.01, 5)
    const buf = new Uint8Array(CAM_W * CAM_H * 4)
    const canvas = document.createElement('canvas')
    canvas.width = CAM_W
    canvas.height = CAM_H
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(CAM_W, CAM_H)
    return { rt, front, wrist, buf, canvas, ctx, img }
  }, [])

  useEffect(() => () => rig.rt.dispose(), [rig])

  const snap = (cam: THREE.PerspectiveCamera): string => {
    gl.setRenderTarget(rig.rt)
    gl.render(scene, cam)
    gl.readRenderTargetPixels(rig.rt, 0, 0, CAM_W, CAM_H, rig.buf)
    gl.setRenderTarget(null)
    // GL reads bottom-up; flip rows and convert linear -> sRGB
    const row = CAM_W * 4
    const data = rig.img.data
    for (let y = 0; y < CAM_H; y++) {
      const src = (CAM_H - 1 - y) * row
      const dst = y * row
      for (let x = 0; x < row; x += 4) {
        data[dst + x] = SRGB[rig.buf[src + x]]
        data[dst + x + 1] = SRGB[rig.buf[src + x + 1]]
        data[dst + x + 2] = SRGB[rig.buf[src + x + 2]]
        data[dst + x + 3] = 255
      }
    }
    rig.ctx.putImageData(rig.img, 0, 0)
    return rig.canvas.toDataURL('image/jpeg', 0.78)
  }

  useFrame(() => {
    if (!sim.pendingCapture) return
    sim.pendingCapture = false

    // pose the wrist camera like a side-mounted gripper cam: offset laterally
    // out of the arm plane and slightly above the grasp point, looking at it
    // (stays clear of the wrist/gripper motors)
    const tip = fkTip(sim.joints)
    const pan = sim.joints[0]
    const latX = Math.sin(pan)
    const latZ = Math.cos(pan)
    rig.wrist.position.set(tip.x + latX * 0.065, tip.y + 0.06, tip.z + latZ * 0.065)
    rig.wrist.up.set(0, 1, 0)
    rig.wrist.lookAt(tip.x, tip.y - 0.01, tip.z)

    sim.imageFrames.front.push(snap(rig.front))
    sim.imageFrames.wrist.push(snap(rig.wrist))
  })

  return null
}
