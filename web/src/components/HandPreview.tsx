import { useEffect, useRef } from 'react'
import { startHandTracking, stopHandTracking } from '../lib/hand'
import { sim, syncGizmoToTip } from '../lib/sim'
import { useStore } from '../state/store'

/** Webcam preview with hand-landmark overlay, shown while hand control is on. */
export function HandPreview() {
  const handEnabled = useStore((s) => s.handEnabled)
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!handEnabled || !video.current || !canvas.current) return
    // hand control drives the IK target, so make sure IK mode is on
    syncGizmoToTip()
    sim.ikEnabled = true
    const v = video.current
    startHandTracking(v, canvas.current, (s) => useStore.getState().setHandStatus(s))
    return () => stopHandTracking(v)
  }, [handEnabled])

  if (!handEnabled) return null
  return (
    <div className="hand-preview">
      <video ref={video} playsInline muted />
      <canvas ref={canvas} />
    </div>
  )
}
