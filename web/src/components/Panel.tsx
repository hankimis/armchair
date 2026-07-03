import { useEffect, useState } from 'react'
import { JOINT_NAMES, LIMITS, clamp } from '../lib/kinematics'
import { cubeInBin, resetCube, sim, syncGizmoToTip, type Episode } from '../lib/sim'
import { downloadDataset } from '../lib/exporter'
import { loadPolicy, startPolicy, stopPolicy } from '../lib/policy'
import { connectRobot, disconnectRobot } from '../lib/ws'
import { playEpisode, stopPlaying, toggleRecord } from '../state/actions'
import { useStore } from '../state/store'

interface Snap {
  joints: number[]
  targets: number[]
  pitch: number
  ikEnabled: boolean
  frames: number
  recElapsed: number
  inBin: boolean
  recordCameras: boolean
}

function takeSnap(): Snap {
  return {
    joints: [...sim.joints],
    targets: [...sim.targets],
    pitch: sim.pitch,
    ikEnabled: sim.ikEnabled,
    frames: sim.frames.length,
    recElapsed: sim.recording ? sim.time - sim.recStart : 0,
    inBin: cubeInBin(),
    recordCameras: sim.recordCameras,
  }
}

function JointRow({ i, snap, disabled }: { i: number; snap: Snap; disabled: boolean }) {
  const [drag, setDrag] = useState<number | null>(null)
  const [lo, hi] = LIMITS[i]
  const isGrip = i === 5
  const value = drag ?? snap.targets[i]
  const shown = snap.joints[i]
  return (
    <div className="joint-row">
      <span className="joint-name">{JOINT_NAMES[i]}</span>
      <input
        type="range"
        min={lo}
        max={hi}
        step={0.001}
        value={clamp(value, lo, hi)}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value)
          setDrag(v)
          sim.targets[i] = v
        }}
        onPointerUp={() => setDrag(null)}
        onBlur={() => setDrag(null)}
      />
      <span className="joint-val mono">{isGrip ? `${Math.round(shown * 100)}%` : shown.toFixed(2)}</span>
    </div>
  )
}

function EpisodeRow({ ep, index }: { ep: Episode; index: number }) {
  const { playingId, recording, removeEpisode, toggleSuccess } = useStore()
  const playing = playingId === ep.id
  return (
    <div className={playing ? 'ep-row playing' : 'ep-row'}>
      <span className="mono ep-idx">{index + 1}</span>
      <span className="ep-meta mono">
        {ep.frames.length}f · {(ep.frames.length / ep.fps).toFixed(1)}s
      </span>
      <label className="ep-success">
        <input type="checkbox" checked={ep.success} onChange={() => toggleSuccess(ep.id)} />
        success
      </label>
      <button
        className="ghost"
        disabled={recording}
        onClick={() => (playing ? stopPlaying() : playEpisode(ep))}
      >
        {playing ? 'stop' : 'play'}
      </button>
      <button className="ghost" disabled={playing} onClick={() => removeEpisode(ep.id)}>
        del
      </button>
    </div>
  )
}

export function Panel() {
  const [snap, setSnap] = useState(takeSnap)
  const [wsUrl, setWsUrl] = useState('ws://localhost:8765')
  const {
    episodes,
    recording,
    playingId,
    robot,
    task,
    setTask,
    setRobot,
    clearEpisodes,
    handEnabled,
    handStatus,
    setHandEnabled,
    policyStatus,
    policyName,
    setPolicy,
  } = useStore()

  useEffect(() => {
    const id = setInterval(() => setSnap(takeSnap()), 100)
    return () => clearInterval(id)
  }, [])

  const totalFrames = episodes.reduce((n, e) => n + e.frames.length, 0)
  const successes = episodes.filter((e) => e.success).length
  const busy = recording || playingId !== null

  return (
    <aside className="panel">
      <header>
        <h1>armchair</h1>
        <p className="sub">SO-101 web teleoperation · data collection</p>
      </header>

      <section>
        <button className={recording ? 'rec-btn recording' : 'rec-btn'} onClick={toggleRecord} disabled={playingId !== null}>
          {recording ? `stop recording — ${snap.recElapsed.toFixed(1)}s · ${snap.frames}f` : 'record episode (R)'}
        </button>
        <label className="field">
          <span>task</span>
          <input value={task} onChange={(e) => setTask(e.target.value)} disabled={recording} />
        </label>
        <label className="ep-success">
          <input
            type="checkbox"
            checked={snap.recordCameras}
            disabled={recording}
            onChange={(e) => (sim.recordCameras = e.target.checked)}
          />
          camera observations (front + wrist, 320×240)
        </label>
        <p className="hint">
          cube in bin: <span className="mono">{snap.inBin ? 'yes' : 'no'}</span> — episodes stopped while the cube is
          in the bin are marked success automatically. Camera frames live in memory until export; a page refresh
          keeps state streams but drops images.
        </p>
      </section>

      <section>
        <h2>control</h2>
        <div className="seg">
          <button
            className={snap.ikEnabled ? 'seg-btn active' : 'seg-btn'}
            onClick={() => {
              syncGizmoToTip()
              sim.ikEnabled = true
            }}
          >
            IK drag
          </button>
          <button
            className={!snap.ikEnabled ? 'seg-btn active' : 'seg-btn'}
            onClick={() => {
              sim.ikEnabled = false
              for (let k = 0; k < 6; k++) sim.targets[k] = sim.joints[k]
            }}
          >
            joint sliders
          </button>
        </div>
        {snap.ikEnabled && (
          <div className="joint-row">
            <span className="joint-name">approach</span>
            <input
              type="range"
              min={-180}
              max={0}
              step={1}
              value={Math.round((snap.pitch * 180) / Math.PI)}
              onChange={(e) => (sim.pitch = (Number(e.target.value) * Math.PI) / 180)}
            />
            <span className="joint-val mono">{Math.round((snap.pitch * 180) / Math.PI)}°</span>
          </div>
        )}
        <div className="joints">
          {JOINT_NAMES.map((_, i) => (
            <JointRow key={i} i={i} snap={snap} disabled={playingId !== null || (snap.ikEnabled && i < 4)} />
          ))}
        </div>
        <button className="ghost wide" onClick={resetCube} disabled={busy}>
          reset cube (X)
        </button>
      </section>

      <section>
        <h2>policy</h2>
        <input
          type="file"
          accept=".onnx"
          disabled={policyStatus === 'running'}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setPolicy('loading', file.name)
            try {
              await loadPolicy(file)
              setPolicy('loaded', file.name)
            } catch (err) {
              console.warn('policy load failed', err)
              setPolicy('error', file.name)
            }
          }}
        />
        {policyStatus !== 'none' && (
          <>
            <button
              className={policyStatus === 'running' ? 'wide active-toggle' : 'wide'}
              disabled={policyStatus === 'loading' || policyStatus === 'error' || recording || playingId !== null}
              onClick={() => {
                if (policyStatus === 'running') {
                  stopPolicy()
                  setPolicy('loaded')
                } else {
                  startPolicy(() => setPolicy('error'))
                  setPolicy('running')
                }
              }}
            >
              {policyStatus === 'running' ? 'stop policy' : 'run policy'}
            </button>
            <p className="hint">
              <span className="mono">{policyName}</span> —{' '}
              {policyStatus === 'loading'
                ? 'loading…'
                : policyStatus === 'error'
                  ? 'failed (expects obs[1,9] → action[…,6], see scripts/export_policy_onnx.py)'
                  : policyStatus === 'running'
                    ? 'driving the arm at 30 Hz'
                    : 'ready'}
            </p>
          </>
        )}
        <p className="hint">
          train on your episodes, then watch it drive this arm — try{' '}
          <span className="mono">examples/policy_bc.onnx</span> or see <span className="mono">docs/TRAINING.md</span>
        </p>
      </section>

      <section>
        <h2>hand control</h2>
        <button className={handEnabled ? 'wide active-toggle' : 'wide'} onClick={() => setHandEnabled(!handEnabled)}>
          {handEnabled ? 'disable hand control' : 'enable hand control (webcam)'}
        </button>
        {handEnabled && (
          <p className="hint">
            status:{' '}
            <span className="mono">
              {handStatus === 'loading'
                ? 'loading model…'
                : handStatus === 'tracking'
                  ? 'tracking'
                  : handStatus === 'no-hand'
                    ? 'show a hand to the camera'
                    : handStatus === 'error'
                      ? 'camera or model unavailable'
                      : 'off'}
            </span>
            <br />
            move hand: left/right + up/down · closer/farther: reach · fist: grab · open hand: release
          </p>
        )}
      </section>

      <section>
        <h2>episodes</h2>
        {episodes.length === 0 ? (
          <p className="hint">No episodes yet. Drag the yellow target, pick up the cube, drop it in the bin — press R to record.</p>
        ) : (
          <>
            <div className="ep-list">
              {episodes.map((ep, i) => (
                <EpisodeRow key={ep.id} ep={ep} index={i} />
              ))}
            </div>
            <p className="hint mono">
              {episodes.length} episodes · {successes} success · {totalFrames} frames
            </p>
            <div className="row-2">
              <button className="primary" onClick={() => downloadDataset(episodes)}>
                export dataset (.zip)
              </button>
              <button
                className="ghost"
                onClick={() => {
                  if (window.confirm(`Delete all ${episodes.length} episodes?`)) clearEpisodes()
                }}
              >
                clear all
              </button>
            </div>
            <p className="hint">
              convert to LeRobot: <span className="mono">python scripts/convert_to_lerobot.py dataset.zip</span>
            </p>
          </>
        )}
      </section>

      <section>
        <h2>real robot</h2>
        <div className="row-2">
          <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} disabled={robot !== 'off'} />
          <button
            className="ghost"
            onClick={() => {
              if (robot === 'off') connectRobot(wsUrl, setRobot)
              else disconnectRobot()
            }}
          >
            {robot === 'off' ? 'connect' : robot === 'connecting' ? 'cancel' : 'disconnect'}
          </button>
        </div>
        <p className="hint">
          status: <span className="mono">{robot === 'on' ? 'streaming joint targets' : robot}</span> — run{' '}
          <span className="mono">python scripts/so101_bridge.py</span> to drive a real SO-101.
        </p>
      </section>

      <footer className="hint">
        drag target: move · shift-drag: height
        <br />
        space: gripper · Q/E: wrist roll · R: record · X: reset cube
      </footer>
    </aside>
  )
}
