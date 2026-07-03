#!/usr/bin/env python3
"""Convert an Armchair dataset export into a LeRobotDataset.

Accepts either the v2 `.zip` export (state streams + camera JPEG frames) or
the older v1 `.json` export (state streams only), and produces a real
LeRobotDataset on disk (parquet + encoded videos + metadata) usable with
`lerobot` training scripts. Optionally pushes to the Hugging Face Hub.

Usage:
    pip install lerobot pillow
    python scripts/convert_to_lerobot.py armchair_dataset_2026-07-04.zip \
        --repo-id yourname/armchair-so101-pick --push

Written against the lerobot 0.3.x dataset API. If your lerobot version
complains about `add_frame` / `save_episode` signatures, check the notes
inline — the API has moved a few times.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import zipfile
from pathlib import Path


def load_export(path: Path):
    """Returns (manifest_dict, image_reader or None)."""
    if path.suffix.lower() == ".zip":
        zf = zipfile.ZipFile(path)
        manifest = json.loads(zf.read("dataset.json"))

        def read_image(ep, cam: str, idx: int):
            spec = (ep.get("images") or {}).get(cam)
            if not spec:
                return None
            return zf.read(f"{spec['dir']}/{idx:06d}.jpg")

        return manifest, read_image
    manifest = json.loads(path.read_text())
    return manifest, None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("export_file", type=Path, help=".zip (v2) or .json (v1) exported from the Armchair web app")
    parser.add_argument("--repo-id", default="local/armchair-so101", help="dataset repo id (user/name)")
    parser.add_argument("--root", type=Path, default=None, help="local root dir (default: ~/.cache/huggingface/lerobot)")
    parser.add_argument("--push", action="store_true", help="push the converted dataset to the Hugging Face Hub")
    parser.add_argument("--skip-failed", action="store_true", help="only convert episodes marked success")
    parser.add_argument("--no-images", action="store_true", help="drop camera streams even if present")
    args = parser.parse_args()

    try:
        import numpy as np

        try:
            from lerobot.datasets.lerobot_dataset import LeRobotDataset
        except ImportError:  # older package layout
            from lerobot.common.datasets.lerobot_dataset import LeRobotDataset
    except ImportError as err:
        sys.exit(f"missing dependency ({err}); run: pip install lerobot")

    manifest, read_image = load_export(args.export_file)
    if manifest.get("format") not in ("armchair/v1", "armchair/v2"):
        sys.exit(f"unexpected format {manifest.get('format')!r}")

    names = manifest["joints"]
    episodes = manifest["episodes"]
    if args.skip_failed:
        episodes = [ep for ep in episodes if ep.get("success")]
    if not episodes:
        sys.exit("no episodes to convert")

    cameras = []
    if read_image is not None and not args.no_images:
        cam_feats = [k for k in manifest.get("features", {}) if k.startswith("observation.images.")]
        cameras = [k.split(".")[-1] for k in cam_feats]
        if cameras:
            try:
                from PIL import Image  # noqa: F401
            except ImportError:
                sys.exit("missing dependency for image decoding; run: pip install pillow")

    features = {
        "observation.state": {"dtype": "float32", "shape": (len(names),), "names": names},
        "action": {"dtype": "float32", "shape": (len(names),), "names": names},
        "observation.environment_state": {
            "dtype": "float32",
            "shape": (3,),
            "names": ["cube_x", "cube_y", "cube_z"],
        },
    }
    for cam in cameras:
        shape = tuple(manifest["features"][f"observation.images.{cam}"]["shape"])
        features[f"observation.images.{cam}"] = {
            "dtype": "video",
            "shape": shape,
            "names": ["height", "width", "channels"],
        }

    dataset = LeRobotDataset.create(
        repo_id=args.repo_id,
        fps=manifest["fps"],
        features=features,
        robot_type=manifest.get("robot_type", "so101"),
        root=args.root,
    )

    Image = None
    if cameras:
        from PIL import Image

    total_frames = 0
    for ep in episodes:
        task = ep.get("task") or manifest.get("task_default", "")
        ep_cams = cameras if (ep.get("images") or None) else []
        for f_idx, frame in enumerate(ep["frames"]):
            payload = {
                "observation.state": np.asarray(frame["obs"], dtype=np.float32),
                "action": np.asarray(frame["act"], dtype=np.float32),
                "observation.environment_state": np.asarray(frame["env"], dtype=np.float32),
                "task": task,
            }
            for cam in ep_cams:
                raw = read_image(ep, cam, f_idx)
                if raw is None:
                    continue
                payload[f"observation.images.{cam}"] = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"))
            try:
                dataset.add_frame(payload)
            except (TypeError, ValueError):
                # some lerobot versions take task as a kwarg instead of a frame key
                payload.pop("task")
                dataset.add_frame(payload, task=task)
        dataset.save_episode()
        total_frames += len(ep["frames"])

    print(f"converted {len(episodes)} episodes / {total_frames} frames -> {args.repo_id}")
    if cameras:
        print(f"camera streams: {', '.join(cameras)}")
    if args.push:
        dataset.push_to_hub()
        print("pushed to the Hugging Face Hub")


if __name__ == "__main__":
    main()
