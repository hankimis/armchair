import { zipSync, strToU8 } from 'fflate'
import { JOINT_NAMES } from './kinematics'
import { CAMERAS, DEFAULT_TASK, FPS, type Episode } from './sim'
import { CAM_H, CAM_W } from '../components/CameraCapture'

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function buildManifest(episodes: Episode[]) {
  const cameraFeatures: Record<string, unknown> = {}
  const hasImages = episodes.some((e) => e.images)
  if (hasImages) {
    for (const cam of CAMERAS) {
      cameraFeatures[`observation.images.${cam}`] = {
        dtype: 'video',
        shape: [CAM_H, CAM_W, 3],
        names: ['height', 'width', 'channels'],
      }
    }
  }
  return {
    format: 'armchair/v2',
    robot_type: 'so101',
    fps: FPS,
    joints: [...JOINT_NAMES],
    units: 'radians; gripper normalized 0 (closed) – 1 (open)',
    task_default: DEFAULT_TASK,
    features: {
      'observation.state': { dtype: 'float32', shape: [6], names: [...JOINT_NAMES] },
      action: { dtype: 'float32', shape: [6], names: [...JOINT_NAMES] },
      'observation.environment_state': { dtype: 'float32', shape: [3], names: ['cube_x', 'cube_y', 'cube_z'] },
      ...cameraFeatures,
    },
    stats: {
      episodes: episodes.length,
      frames: episodes.reduce((n, e) => n + e.frames.length, 0),
      successes: episodes.filter((e) => e.success).length,
      episodes_with_images: episodes.filter((e) => e.images).length,
    },
    episodes: episodes.map((ep, i) => ({
      index: i,
      id: ep.id,
      task: ep.task,
      fps: ep.fps,
      success: ep.success,
      recordedAt: ep.recordedAt,
      frames: ep.frames,
      images: ep.images
        ? Object.fromEntries(
            CAMERAS.map((cam) => [cam, { dir: `images/ep_${String(i).padStart(3, '0')}/${cam}`, count: ep.images![cam].length }]),
          )
        : null,
    })),
  }
}

/** Builds and downloads a ZIP: dataset.json + JPEG frames per episode/camera. */
export function downloadDataset(episodes: Episode[]) {
  const files: Record<string, Uint8Array> = {
    'dataset.json': strToU8(JSON.stringify(buildManifest(episodes))),
  }
  episodes.forEach((ep, i) => {
    if (!ep.images) return
    for (const cam of CAMERAS) {
      ep.images[cam].forEach((frame, f) => {
        files[`images/ep_${String(i).padStart(3, '0')}/${cam}/${String(f).padStart(6, '0')}.jpg`] =
          dataUrlToBytes(frame)
      })
    }
  })
  // JPEGs are already compressed; store them as-is for speed
  const zipped = zipSync(files, { level: 0 })
  const buf = new ArrayBuffer(zipped.byteLength)
  new Uint8Array(buf).set(zipped)
  const blob = new Blob([buf], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `armchair_dataset_${new Date().toISOString().slice(0, 10)}.zip`
  a.click()
  URL.revokeObjectURL(url)
}
