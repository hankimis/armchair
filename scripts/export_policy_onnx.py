#!/usr/bin/env python3
"""Export a trained lerobot ACT policy to ONNX for Armchair's in-browser runner.

The exported graph matches the interface web/src/lib/policy.ts expects:
    input  "obs"    float32 [1, 9]        6 joint positions + cube xyz
    output "action" float32 [1, H, 6]     action chunk (browser uses step 0)
Input/output normalization layers are baked into the graph.

Usage:
    pip install lerobot onnx
    python scripts/export_policy_onnx.py \
        outputs/train/act_armchair/checkpoints/last/pretrained_model \
        --out armchair_policy.onnx

Written against lerobot 0.3.x ACT. The wrapper touches internal attributes
(normalize_inputs / model / unnormalize_outputs) that are stable across recent
versions but may need adjustment — see comments.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("checkpoint", type=Path, help="pretrained_model directory of a lerobot ACT checkpoint")
    parser.add_argument("--out", type=Path, default=Path("armchair_policy.onnx"))
    args = parser.parse_args()

    try:
        import torch

        try:
            from lerobot.policies.act.modeling_act import ACTPolicy
        except ImportError:  # older package layout
            from lerobot.common.policies.act.modeling_act import ACTPolicy
    except ImportError as err:
        sys.exit(f"missing dependency ({err}); run: pip install lerobot onnx")

    policy = ACTPolicy.from_pretrained(str(args.checkpoint))
    policy.eval()

    class ObsToChunk(torch.nn.Module):
        """obs[1,9] -> normalized batch -> ACT chunk -> unnormalized actions."""

        def __init__(self, p: ACTPolicy):
            super().__init__()
            self.p = p

        def forward(self, obs: torch.Tensor) -> torch.Tensor:
            batch = {
                "observation.state": obs[:, :6],
                "observation.environment_state": obs[:, 6:9],
            }
            batch = self.p.normalize_inputs(batch)
            # ACT's transformer returns (actions, latent-params); eval mode uses
            # a zero latent so this is deterministic.
            actions = self.p.model(batch)[0]
            return self.p.unnormalize_outputs({"action": actions})["action"]

    wrapper = ObsToChunk(policy)
    dummy = torch.zeros(1, 9, dtype=torch.float32)
    with torch.no_grad():
        chunk = wrapper(dummy)
    torch.onnx.export(
        wrapper,
        (dummy,),
        str(args.out),
        input_names=["obs"],
        output_names=["action"],
        opset_version=17,
    )
    print(f"exported {args.out} — obs[1,9] -> action{list(chunk.shape)}")


if __name__ == "__main__":
    main()
