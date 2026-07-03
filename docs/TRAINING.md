# Train a policy on your browser demos — and watch it drive the arm

The full loop: **teleoperate in the browser → export → train → export ONNX → run the policy back in the browser.** No robot required.

## Quick path: the built-in BC trainer (no GPU, no lerobot)

```bash
pip install numpy onnx
python scripts/train_bc.py armchair_dataset_*.zip --out my_policy.onnx
```

Trains a small MLP with stacked observations (K=3) and action-chunk targets (H=8) in a couple of minutes on CPU, and exports an `.onnx` the app runs directly. The shipped sample (`examples/policy_bc.onnx`) was trained this way on ~1,400 noise-injected scripted demonstrations and scored 16/16 on random cube placements. Things that matter, learned the hard way:

- **Action chunks + lookahead execution.** Predicting only the next 30 Hz target collapses to `target ≈ current joints` and the arm barely moves in closed loop. The trainer predicts an 8-step chunk and the runner executes the *last* step as a ~0.27 s lookahead waypoint.
- **Noise-injected demonstrations.** Pure clean demos fail on compounding error — the policy drifts slightly off-distribution and never recovers. Record some episodes where you wobble and correct yourself; the correction labels are what make the policy robust.
- **Vary your starting pose and cube placement.** The policy only knows states it has seen.

## Full path: ACT with lerobot

## 1. Collect demonstrations

Open the app (`cd web && npm run dev`), then:

- press `R`, pick up the cube, drop it in the bin, press `R` again — that's one episode
- press `X` to respawn the cube somewhere else, repeat
- 30–50 successful episodes is a good starting set (10–15 minutes of clicking, or use hand control)
- click **export dataset (.zip)**

Tip: keep the `success` checkbox honest — the converter can drop failed episodes with `--skip-failed`.

## 2. Convert to a LeRobotDataset

```bash
pip install lerobot pillow
python scripts/convert_to_lerobot.py armchair_dataset_*.zip \
    --repo-id local/armchair-pick --skip-failed
```

This writes parquet + encoded camera videos to `~/.cache/huggingface/lerobot/local/armchair-pick`.

## 3. Train ACT

The sim task is fully observable from `observation.state` + `observation.environment_state` (cube pose), so a state-only ACT trains in minutes-to-an-hour, even without a big GPU:

```bash
lerobot-train \
  --dataset.repo_id=local/armchair-pick \
  --policy.type=act \
  --policy.push_to_hub=false \
  --output_dir=outputs/train/act_armchair \
  --steps=20000 \
  --batch_size=64
```

- Apple Silicon: add `--policy.device=mps`; NVIDIA: `--policy.device=cuda`
- the exact CLI entrypoint moved across lerobot versions (`lerobot-train` vs `python -m lerobot.scripts.train`) — check `lerobot --help` for yours

## 4. Export the policy to ONNX

```bash
pip install onnx
python scripts/export_policy_onnx.py \
    outputs/train/act_armchair/checkpoints/last/pretrained_model \
    --out armchair_policy.onnx
```

## 5. Run it in the browser

In the app's **policy** section, choose `armchair_policy.onnx`, press **run policy**, then press `X` to shuffle the cube and watch the policy chase it. Record its rollouts with `R` like any other episode.

## Notes

- The browser runner feeds `[joints(6), cube_xyz(3)]` at 30 Hz and applies the first step of the returned action chunk.
- Camera streams in the dataset are there for training vision policies (e.g. ACT with images) for real-robot transfer; the in-browser runner is state-only for now.
- A policy trained only on successful, smooth demos transfers best — prune junk episodes before converting.
