# 🛋️ armchair

**Teleoperate a robot arm and collect LeRobot-ready training data — from your browser.**

![demo](docs/assets/demo.gif)

Drag a target in 3D, the simulated [SO-101](https://github.com/TheRobotStudio/SO-ARM100) arm follows via analytic IK. Press `R`, do the task, press `R` again — that's one imitation-learning episode. Export the whole session as a [LeRobot](https://github.com/huggingface/lerobot)-compatible dataset, or stream the same joint targets to a real $100 SO-101 over WebSocket.

No ROS. No VR headset. No robot required to start.

## Quickstart

```bash
cd web
npm install
npm run dev        # open http://localhost:5173
```

That's it. You are teleoperating a robot arm.

## What it does

- **Browser teleoperation** — drag the yellow target, the arm follows (analytic elbow-up IK, servo-speed-limited like real Feetech servos). Or switch to per-joint sliders.
- **Hand-tracking teleoperation** — enable your webcam and drive the arm with your bare hand (MediaPipe hand landmarks, fully in-browser): move to steer, bring your hand closer or farther to control reach, make a fist to grab and open your hand to release.
- **Episode recording at 30 Hz** — `observation.state` (6 joints), `action` (6 joint targets), `observation.environment_state` (cube pose), the same feature layout LeRobot trains on.
- **A built-in pick-and-place task** — grab the cube, drop it in the bin. Success is detected automatically. Episodes persist in your browser between sessions.
- **Replay** — play any recorded episode back in the sim before you spend GPU hours on it.
- **LeRobot export** — one click downloads `dataset.json`; one command converts it to a real `LeRobotDataset` (parquet + metadata) ready for `lerobot` training scripts or the Hugging Face Hub.
- **Real-robot bridge** — the same 30 Hz action stream drives a physical SO-101 through `scripts/so101_bridge.py`.

## Controls

| input | action |
| --- | --- |
| drag yellow target | move end-effector (XZ plane) |
| `Shift` + drag | move end-effector vertically |
| `Space` | open / close gripper |
| `Q` / `E` | wrist roll |
| `R` | start / stop recording |
| `X` | reset the cube |
| approach slider | end-effector approach angle (default: straight down) |
| hand control | webcam: hand position steers the arm, hand distance = reach, fist = grab, open hand = release |

Hand-tracking mapping constants (axis signs, ranges, pinch thresholds) live at the top of [`web/src/lib/hand.ts`](web/src/lib/hand.ts) — tune them to taste.

## From browser to LeRobot dataset

```bash
# 1. record episodes in the browser, click "export dataset"
# 2. convert:
pip install lerobot
python scripts/convert_to_lerobot.py armchair_dataset_2026-07-03.json \
    --repo-id yourname/armchair-so101-pick --push
# 3. train any lerobot policy (ACT, diffusion, ...) on it
```

The exported features:

| feature | shape | contents |
| --- | --- | --- |
| `observation.state` | (6,) | joint positions, radians (gripper 0–1) |
| `action` | (6,) | commanded joint targets |
| `observation.environment_state` | (3,) | cube xyz — free ground truth from the sim |

## Driving a real SO-101

```bash
pip install lerobot websockets
python scripts/so101_bridge.py --dry-run                    # check values first!
python scripts/so101_bridge.py --port /dev/tty.usbmodem1    # then the real thing
```

Press **connect** in the web app (`ws://localhost:8765`) and the arm mirrors your browser teleoperation live. Calibrate the follower with lerobot first, and always start with `--dry-run` — sign/offset mapping lives at the top of the bridge script.

## Why

LeRobot made *training* robot policies accessible. *Collecting demonstrations* is still the annoying part — leader arms, VR rigs, ROS setups. A browser is the lowest-friction teleoperation device that exists, and for low-DOF arms like the SO-101 it is plenty. Armchair is the shortest path from "I'm curious about robot learning" to "I have a dataset."

## Roadmap

Sim-first, hardware later — see [docs/ROADMAP.md](docs/ROADMAP.md).

- [x] browser sim + IK teleoperation + 30 Hz episode recording
- [x] webcam hand-tracking teleoperation (MediaPipe, in-browser)
- [x] LeRobot dataset export / conversion
- [x] WebSocket bridge to a real SO-101
- [ ] camera observations (offscreen render → dataset video streams)
- [ ] in-browser policy playback (ONNX runtime web)
- [ ] multi-cube / randomized task variants
- [ ] leader-arm and gamepad input

## License

MIT

---

### 한국어 요약

브라우저에서 SO-101 로봇팔을 드래그로 조종해 모방학습 데이터를 수집하는 오픈소스 툴킷입니다. ROS·VR 장비 없이 `npm run dev` 한 줄로 시작하고, 수집한 에피소드는 LeRobot 호환 데이터셋으로 변환해 바로 학습에 쓰거나, WebSocket 브릿지로 실물 SO-101을 그대로 조종할 수 있습니다. 상세 로드맵은 [docs/ROADMAP.md](docs/ROADMAP.md) 참고.
