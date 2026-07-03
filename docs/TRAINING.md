# Train a policy on your browser demos — and watch it drive the arm

The full loop: **teleoperate in the browser → export → train ACT → export ONNX → run the policy back in the browser.** No robot required.

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
