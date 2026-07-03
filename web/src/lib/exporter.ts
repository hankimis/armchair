import { JOINT_NAMES } from './kinematics'
import { DEFAULT_TASK, FPS, type Episode } from './sim'

export function buildDataset(episodes: Episode[]) {
  return {
    format: 'armchair/v1',
    robot_type: 'so101',
    fps: FPS,
    joints: [...JOINT_NAMES],
    units: 'radians; gripper normalized 0 (closed) – 1 (open)',
    task_default: DEFAULT_TASK,
    features: {
      'observation.state': { dtype: 'float32', shape: [6], names: [...JOINT_NAMES] },
      action: { dtype: 'float32', shape: [6], names: [...JOINT_NAMES] },
      'observation.environment_state': { dtype: 'float32', shape: [3], names: ['cube_x', 'cube_y', 'cube_z'] },
    },
    stats: {
      episodes: episodes.length,
      frames: episodes.reduce((n, e) => n + e.frames.length, 0),
      successes: episodes.filter((e) => e.success).length,
    },
    episodes,
  }
}

export function downloadDataset(episodes: Episode[]) {
  const blob = new Blob([JSON.stringify(buildDataset(episodes))], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `armchair_dataset_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
