import { startPlayback, startRecording, stopPlayback, stopRecording, type Episode } from '../lib/sim'
import { useStore } from './store'

export function toggleRecord() {
  const s = useStore.getState()
  if (s.playingId) return
  if (s.recording) {
    const ep = stopRecording(s.task)
    s.setRecording(false)
    if (ep.frames.length > 5) s.addEpisode(ep)
  } else {
    startRecording()
    s.setRecording(true)
  }
}

export function playEpisode(ep: Episode) {
  const s = useStore.getState()
  if (s.recording) return
  startPlayback(ep)
  s.setPlayingId(ep.id)
}

export function stopPlaying() {
  stopPlayback()
  useStore.getState().setPlayingId(null)
}
