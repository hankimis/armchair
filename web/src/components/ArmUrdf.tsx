import { useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import URDFLoader, { type URDFRobot } from 'urdf-loader'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { sim } from '../lib/sim'
import { Arm } from './Arm'

const URDF_URL = 'so101/so101.urdf'

const PRINTED = new THREE.MeshStandardMaterial({ color: '#ff8b2c', roughness: 0.6, metalness: 0.05 })
const SERVO = new THREE.MeshStandardMaterial({ color: '#20232b', roughness: 0.45, metalness: 0.25 })

// Maps the sim convention (see lib/kinematics.ts) onto URDF joint values:
//   urdf = sign * (sim_angle - offset)      for the 5 revolute joints
//   urdf = gripLo + grip01 * (gripHi - gripLo)  for the jaw
// Calibrated against so101_new_calib.urdf by measuring joint frame world
// positions at zero pose and under single-joint perturbations.
const CALIB = {
  names: ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll'] as const,
  sign: [-1, -1, -1, -1, -1],
  offset: [0, 1.327, -1.2885, 0.0287, 0],
  gripLo: 0,
  gripHi: 1.5,
}

// world-x of the shoulder_pan axis when the robot root sits at the origin
const PAN_AXIS_X = 0.0388

function applyJoints(robot: URDFRobot) {
  for (let i = 0; i < 5; i++) {
    robot.setJointValue(CALIB.names[i], CALIB.sign[i] * (sim.joints[i] - CALIB.offset[i]))
  }
  robot.setJointValue('gripper', CALIB.gripLo + sim.joints[5] * (CALIB.gripHi - CALIB.gripLo))
}

/** Official SO-101 model (URDF + STL). Falls back to the stylized arm if assets are missing. */
export function ArmUrdf() {
  const [robot, setRobot] = useState<URDFRobot | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const loader = new URDFLoader()
    // note: urdf-loader 0.13 actually calls (path, manager, material, done);
    // its bundled .d.ts still declares the old 3-arg signature, hence the cast.
    loader.loadMeshCb = ((
      path: string,
      manager: THREE.LoadingManager,
      _material: THREE.Material,
      done: (obj: THREE.Object3D, err?: Error) => void,
    ) => {
      new STLLoader(manager).load(
        path,
        (geom) => {
          geom.computeVertexNormals()
          const mesh = new THREE.Mesh(geom, path.includes('sts3215') ? SERVO : PRINTED)
          mesh.castShadow = true
          done(mesh)
        },
        undefined,
        (err) => done(new THREE.Object3D(), err instanceof Error ? err : new Error(String(err))),
      )
    }) as unknown as typeof loader.loadMeshCb
    let disposed = false
    loader.load(
      URDF_URL,
      (r) => {
        if (disposed) return
        r.rotation.x = -Math.PI / 2 // URDF is Z-up, three.js is Y-up
        r.position.x = -PAN_AXIS_X // put the pan axis on the world origin
        applyJoints(r)
        setRobot(r)
        const hook = (window as unknown as Record<string, unknown>).__armchair as
          | Record<string, unknown>
          | undefined
        if (hook) hook.urdf = r
      },
      undefined,
      () => !disposed && setFailed(true),
    )
    return () => {
      disposed = true
    }
  }, [])

  useFrame(() => {
    if (robot) applyJoints(robot)
  })

  if (robot) return <primitive object={robot} />
  return failed ? <Arm /> : null
}
