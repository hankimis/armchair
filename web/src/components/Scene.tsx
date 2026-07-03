import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { clamp } from '../lib/kinematics'
import { cubeInBin, orbit, sim, stepSim } from '../lib/sim'
import { useStore } from '../state/store'
import { ArmUrdf } from './ArmUrdf'
import { CameraCapture, UI_LAYER } from './CameraCapture'

function CameraRig() {
  const { camera, gl, raycaster } = useThree()
  const controls = useRef<OrbitControls | null>(null)
  useEffect(() => {
    camera.layers.enable(UI_LAYER) // viewport shows teleop overlays; obs cameras don't
    raycaster.layers.enableAll()
    const c = new OrbitControls(camera, gl.domElement)
    c.target.set(0.08, 0.1, 0)
    c.enableDamping = true
    c.dampingFactor = 0.12
    c.maxPolarAngle = 1.52
    c.minDistance = 0.15
    c.maxDistance = 1.6
    controls.current = c
    orbit.controls = c
    return () => {
      orbit.controls = null
      c.dispose()
    }
  }, [camera, gl, raycaster])
  useFrame(() => controls.current?.update())
  return null
}

/** Steps the simulation once per rendered frame and syncs UI flags. */
function SimLoop() {
  useFrame((_, dt) => {
    stepSim(dt)
    const s = useStore.getState()
    if (s.playingId && !sim.playback) s.setPlayingId(null)
  })
  return null
}

function TargetGizmo() {
  const group = useRef<THREE.Group>(null)
  const guide = useRef<THREE.Mesh>(null)

  useEffect(() => {
    group.current?.traverse((o) => o.layers.set(UI_LAYER))
    guide.current?.layers.set(UI_LAYER)
  }, [])
  const dragging = useRef(false)
  const plane = useMemo(() => new THREE.Plane(), [])
  const hit = useMemo(() => new THREE.Vector3(), [])
  const normal = useMemo(() => new THREE.Vector3(), [])
  const { camera } = useThree()

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (sim.playback || !sim.ikEnabled) return
    e.stopPropagation()
    dragging.current = true
    if (orbit.controls) orbit.controls.enabled = false
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return
    e.stopPropagation()
    if (e.nativeEvent.shiftKey) {
      // vertical move: intersect a camera-facing vertical plane through the target
      camera.getWorldDirection(normal)
      normal.y = 0
      if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1)
      normal.normalize()
      plane.setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(sim.ee.x, sim.ee.y, sim.ee.z))
      if (e.ray.intersectPlane(plane, hit)) sim.ee.y = clamp(hit.y, 0.005, 0.32)
    } else {
      // horizontal move on the target's current height
      plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, sim.ee.y, 0))
      if (e.ray.intersectPlane(plane, hit)) {
        const r = clamp(Math.hypot(hit.x, hit.z), 0.07, 0.26)
        const a = Math.atan2(hit.z, hit.x)
        sim.ee.x = r * Math.cos(a)
        sim.ee.z = r * Math.sin(a)
      }
    }
  }
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    dragging.current = false
    if (orbit.controls) orbit.controls.enabled = true
    ;(e.target as Element).releasePointerCapture(e.pointerId)
  }

  useFrame(() => {
    if (!group.current) return
    const visible = sim.ikEnabled && !sim.playback
    group.current.visible = visible
    group.current.position.set(sim.ee.x, sim.ee.y, sim.ee.z)
    if (guide.current) {
      guide.current.position.set(sim.ee.x, sim.ee.y / 2, sim.ee.z)
      guide.current.scale.y = Math.max(sim.ee.y, 1e-4)
      guide.current.visible = visible
    }
  })

  return (
    <>
      <group ref={group}>
        <mesh
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerOver={() => (document.body.style.cursor = 'grab')}
          onPointerOut={() => (document.body.style.cursor = 'auto')}
        >
          <sphereGeometry args={[0.013, 24, 16]} />
          <meshStandardMaterial color="#ffd166" emissive="#7a5a12" roughness={0.3} />
        </mesh>
        {/* larger invisible grab handle */}
        <mesh visible={false} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
          <sphereGeometry args={[0.032, 12, 8]} />
        </mesh>
      </group>
      <mesh ref={guide}>
        <boxGeometry args={[0.0012, 1, 0.0012]} />
        <meshBasicMaterial color="#5a616e" />
      </mesh>
    </>
  )
}

function Cube() {
  const ref = useRef<THREE.Mesh>(null)
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(() => {
    if (!ref.current) return
    ref.current.position.set(sim.cube.x, sim.cube.y, sim.cube.z)
    ref.current.quaternion.set(...sim.cube.q)
    if (mat.current) mat.current.color.set(cubeInBin() ? '#39c26d' : '#4f9cf9')
  })
  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[0.03, 0.03, 0.03]} />
      <meshStandardMaterial ref={mat} color="#4f9cf9" roughness={0.5} />
    </mesh>
  )
}

function Bin() {
  const { bin } = sim
  return (
    <group position={[bin.x, 0, bin.z]}>
      <mesh position-y={0.008} rotation-x={-Math.PI / 2}>
        <torusGeometry args={[bin.r, 0.005, 12, 48]} />
        <meshStandardMaterial color="#8f97a8" roughness={0.6} />
      </mesh>
      <mesh position-y={0.0015} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[bin.r, 48]} />
        <meshStandardMaterial color="#1a1e26" roughness={0.9} />
      </mesh>
    </group>
  )
}

export function Scene() {
  return (
    <Canvas shadows camera={{ position: [0.42, 0.34, 0.48], fov: 40, near: 0.01, far: 10 }}>
      <color attach="background" args={['#0d1016']} />
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[0.5, 0.9, 0.4]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-0.5}
        shadow-camera-right={0.5}
        shadow-camera-top={0.5}
        shadow-camera-bottom={-0.5}
        shadow-camera-near={0.1}
        shadow-camera-far={3}
      />
      <SimLoop />
      <CameraCapture />
      <CameraRig />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[0.65, 64]} />
        <meshStandardMaterial color="#141821" roughness={0.95} />
      </mesh>
      <gridHelper args={[1.3, 26, '#2a2f3a', '#1b202a']} position-y={0.0005} />
      <ArmUrdf />
      <Cube />
      <Bin />
      <TargetGizmo />
    </Canvas>
  )
}
