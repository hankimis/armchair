import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BASE_H, L1, L2 } from '../lib/kinematics'
import { sim } from '../lib/sim'

const BODY = '#ff8b2c' // 3d-printed orange, SO-101 style
const DARK = '#262a33'
const LIGHT = '#e9e4da'

function Hinge({ r = 0.019 }: { r?: number }) {
  return (
    <mesh rotation-x={Math.PI / 2} castShadow>
      <cylinderGeometry args={[r, r, 0.042, 24]} />
      <meshStandardMaterial color={DARK} roughness={0.4} metalness={0.2} />
    </mesh>
  )
}

export function Arm() {
  const pan = useRef<THREE.Group>(null)
  const lift = useRef<THREE.Group>(null)
  const elbow = useRef<THREE.Group>(null)
  const wrist = useRef<THREE.Group>(null)
  const roll = useRef<THREE.Group>(null)
  const fingerL = useRef<THREE.Mesh>(null)
  const fingerR = useRef<THREE.Mesh>(null)

  useFrame(() => {
    const j = sim.joints
    if (!pan.current) return
    pan.current.rotation.y = j[0]
    lift.current!.rotation.z = j[1]
    elbow.current!.rotation.z = j[2]
    wrist.current!.rotation.z = j[3]
    roll.current!.rotation.x = j[4]
    const gap = 0.006 + j[5] * 0.022
    fingerL.current!.position.z = gap
    fingerR.current!.position.z = -gap
  })

  return (
    <group>
      <mesh position={[0, 0.008, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.05, 0.056, 0.016, 32]} />
        <meshStandardMaterial color={DARK} roughness={0.5} />
      </mesh>

      <group ref={pan}>
        <mesh position={[0, 0.046, 0]} castShadow>
          <cylinderGeometry args={[0.036, 0.042, 0.06, 32]} />
          <meshStandardMaterial color={LIGHT} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.095, 0]} castShadow>
          <boxGeometry args={[0.046, 0.052, 0.04]} />
          <meshStandardMaterial color={DARK} roughness={0.5} />
        </mesh>

        <group ref={lift} position={[0, BASE_H, 0]}>
          <Hinge />
          <mesh position={[L1 / 2, 0, 0]} castShadow>
            <boxGeometry args={[L1, 0.03, 0.028]} />
            <meshStandardMaterial color={BODY} roughness={0.55} />
          </mesh>

          <group ref={elbow} position={[L1, 0, 0]}>
            <Hinge r={0.017} />
            <mesh position={[L2 / 2, 0, 0]} castShadow>
              <boxGeometry args={[L2, 0.026, 0.024]} />
              <meshStandardMaterial color={BODY} roughness={0.55} />
            </mesh>

            <group ref={wrist} position={[L2, 0, 0]}>
              <Hinge r={0.015} />
              <group ref={roll}>
                <mesh position={[0.024, 0, 0]} rotation-z={Math.PI / 2} castShadow>
                  <cylinderGeometry args={[0.014, 0.014, 0.044, 24]} />
                  <meshStandardMaterial color={LIGHT} roughness={0.55} />
                </mesh>
                <mesh position={[0.052, 0, 0]} castShadow>
                  <boxGeometry args={[0.014, 0.02, 0.052]} />
                  <meshStandardMaterial color={DARK} roughness={0.5} />
                </mesh>
                <mesh ref={fingerL} position={[0.078, 0, 0.02]} castShadow>
                  <boxGeometry args={[0.052, 0.014, 0.007]} />
                  <meshStandardMaterial color={DARK} roughness={0.45} />
                </mesh>
                <mesh ref={fingerR} position={[0.078, 0, -0.02]} castShadow>
                  <boxGeometry args={[0.052, 0.014, 0.007]} />
                  <meshStandardMaterial color={DARK} roughness={0.45} />
                </mesh>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}
