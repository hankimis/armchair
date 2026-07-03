#!/usr/bin/env python3
"""Convert an Armchair `dataset.json` export into a LeRobotDataset.

The web app exports a single JSON file (format `armchair/v1`). This script
turns it into a real LeRobotDataset on disk (parquet + metadata) that works
with `lerobot` training scripts, and can optionally push it to the Hub.

Usage:
    pip install lerobot
    python scripts/convert_to_lerobot.py armchair_dataset_2026-07-03.json \
        --repo-id yourname/armchair-so101-pick --push

Written against the lerobot 0.3.x dataset API. If your lerobot version
complains about `add_frame` / `save_episode` signatures, check the notes
inline — the API has moved a few times.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dataset_json", type=Path, help="dataset.json exported from the Armchair web app")
    parser.add_argument("--repo-id", default="local/armchair-so101", help="dataset repo id (user/name)")
    parser.add_argument("--root", type=Path, default=None, help="local root dir (default: ~/.cache/huggingface/lerobot)")
    parser.add_argument("--push", action="store_true", help="push the converted dataset to the Hugging Face Hub")
    parser.add_argument("--skip-failed", action="store_true", help="only convert episodes marked success")
    args = parser.parse_args()

    try:
        import numpy as np

        try:
            from lerobot.datasets.lerobot_dataset import LeRobotDataset
        except ImportError:  # older package layout
            from lerobot.common.datasets.lerobot_dataset import LeRobotDataset
    except ImportError as err:
        sys.exit(f"missing dependency ({err}); run: pip install lerobot")

    data = json.loads(args.dataset_json.read_text())
    if data.get("format") != "armchair/v1":
        sys.exit(f"unexpected format {data.get('format')!r}; expected 'armchair/v1'")

    names = data["joints"]
    episodes = data["episodes"]
    if args.skip_failed:
        episodes = [ep for ep in episodes if ep.get("success")]
    if not episodes:
        sys.exit("no episodes to convert")

    features = {
        "observation.state": {"dtype": "float32", "shape": (len(names),), "names": names},
        "action": {"dtype": "float32", "shape": (len(names),), "names": names},
        "observation.environment_state": {
            "dtype": "float32",
            "shape": (3,),
            "names": ["cube_x", "cube_y", "cube_z"],
        },
    }

    dataset = LeRobotDataset.create(
        repo_id=args.repo_id,
        fps=data["fps"],
        features=features,
        robot_type=data.get("robot_type", "so101"),
        root=args.root,
    )

    total_frames = 0
    for ep in episodes:
        task = ep.get("task") or data.get("task_default", "")
        for frame in ep["frames"]:
            payload = {
                "observation.state": np.asarray(frame["obs"], dtype=np.float32),
                "action": np.asarray(frame["act"], dtype=np.float32),
                "observation.environment_state": np.asarray(frame["env"], dtype=np.float32),
                "task": task,
            }
            try:
                dataset.add_frame(payload)
            except (TypeError, ValueError):
                # some lerobot versions take task as a kwarg instead of a frame key
                payload.pop("task")
                dataset.add_frame(payload, task=task)
        dataset.save_episode()
        total_frames += len(ep["frames"])

    print(f"converted {len(episodes)} episodes / {total_frames} frames -> {args.repo_id}")
    if args.push:
        dataset.push_to_hub()
        print("pushed to the Hugging Face Hub")


if __name__ == "__main__":
    main()
