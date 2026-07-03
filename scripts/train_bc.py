#!/usr/bin/env python3
"""Train a small behavior-cloning MLP on an Armchair dataset and export ONNX.

The quick path to a working policy: no GPU, no lerobot — just numpy + onnx.
Trains obs[9] (6 joints + cube xyz) -> action[6] on your recorded episodes and
writes an .onnx that the app's "policy" section can run directly. For the
full ACT pipeline, see docs/TRAINING.md.

Usage:
    pip install numpy onnx
    python scripts/train_bc.py armchair_dataset_2026-07-04.zip --out policy_bc.onnx
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

import numpy as np


def load_frames(path: Path, stack: int, chunk: int):
    """Builds stacked observations (newest first) and action chunks per frame."""
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as zf:
            data = json.loads(zf.read("dataset.json"))
    else:
        data = json.loads(path.read_text())
    if data.get("format") not in ("armchair/v1", "armchair/v2"):
        sys.exit(f"unexpected format {data.get('format')!r}")
    X, Y = [], []
    n_ep = 0
    for ep in data["episodes"]:
        if not ep.get("success"):
            continue
        n_ep += 1
        obs = [f["obs"] + f["env"] for f in ep["frames"]]
        act = [f["act"] for f in ep["frames"]]
        n = len(obs)
        for i in range(n):
            stacked = []
            for k in range(stack):
                stacked += obs[max(i - k, 0)]
            chunked = []
            for h in range(chunk):
                chunked += act[min(i + h, n - 1)]
            X.append(stacked)
            Y.append(chunked)
    if not X:
        sys.exit("no successful episodes in the dataset")
    return np.asarray(X, np.float32), np.asarray(Y, np.float32), n_ep


def train(X, Y, hidden: int, epochs: int, lr0: float, seed: int = 0):
    rng = np.random.default_rng(seed)
    mu_x, sd_x = X.mean(0), X.std(0) + 1e-6
    mu_y, sd_y = Y.mean(0), Y.std(0) + 1e-6
    Xn = (X - mu_x) / sd_x
    Yn = (Y - mu_y) / sd_y

    n_val = max(1, len(Xn) // 20)
    idx = rng.permutation(len(Xn))
    Xv, Yv = Xn[idx[:n_val]], Yn[idx[:n_val]]
    Xt, Yt = Xn[idx[n_val:]], Yn[idx[n_val:]]

    def init(fan_in, fan_out):
        return (rng.standard_normal((fan_in, fan_out)) * np.sqrt(2 / fan_in)).astype(np.float32)

    params = {
        "W1": init(Xn.shape[1], hidden), "b1": np.zeros(hidden, np.float32),
        "W2": init(hidden, hidden), "b2": np.zeros(hidden, np.float32),
        "W3": init(hidden, Yn.shape[1]), "b3": np.zeros(Yn.shape[1], np.float32),
    }
    adam = {k: [np.zeros_like(v), np.zeros_like(v)] for k, v in params.items()}
    t_step = 0
    batch = 4096

    def forward(x):
        h1 = np.maximum(x @ params["W1"] + params["b1"], 0)
        h2 = np.maximum(h1 @ params["W2"] + params["b2"], 0)
        return h1, h2, h2 @ params["W3"] + params["b3"]

    for epoch in range(epochs):
        lr = lr0 * (0.3 if epoch >= epochs * 3 // 4 else 1.0)
        order = rng.permutation(len(Xt))
        for s in range(0, len(order), batch):
            xb = Xt[order[s : s + batch]]
            yb = Yt[order[s : s + batch]]
            h1, h2, out = forward(xb)
            dout = 2 * (out - yb) / len(xb)
            grads = {}
            grads["W3"] = h2.T @ dout
            grads["b3"] = dout.sum(0)
            dh2 = (dout @ params["W3"].T) * (h2 > 0)
            grads["W2"] = h1.T @ dh2
            grads["b2"] = dh2.sum(0)
            dh1 = (dh2 @ params["W2"].T) * (h1 > 0)
            grads["W1"] = xb.T @ dh1
            grads["b1"] = dh1.sum(0)
            t_step += 1
            for k, g in grads.items():
                m, v = adam[k]
                m[:] = 0.9 * m + 0.1 * g
                v[:] = 0.999 * v + 0.001 * g * g
                mhat = m / (1 - 0.9**t_step)
                vhat = v / (1 - 0.999**t_step)
                params[k] -= lr * mhat / (np.sqrt(vhat) + 1e-8)
        if (epoch + 1) % 10 == 0 or epoch == epochs - 1:
            val = float(np.mean((forward(Xv)[2] - Yv) ** 2))
            print(f"epoch {epoch + 1:3d}/{epochs}  val mse (normalized): {val:.5f}")

    return params, (mu_x, sd_x, mu_y, sd_y)


def export_onnx(out_path: Path, params, norm, stack: int, chunk: int):
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    # the app's runner reads the stack size from the input name ("obs3" = 3
    # stacked observations, newest first)
    in_name = "obs" if stack == 1 else f"obs{stack}"
    mu_x, sd_x, mu_y, sd_y = norm
    init = [
        numpy_helper.from_array(mu_x.astype(np.float32), "mu_x"),
        numpy_helper.from_array(sd_x.astype(np.float32), "sd_x"),
        numpy_helper.from_array(mu_y.astype(np.float32), "mu_y"),
        numpy_helper.from_array(sd_y.astype(np.float32), "sd_y"),
        numpy_helper.from_array(np.array([1, chunk, len(mu_y) // chunk], np.int64), "out_shape"),
    ] + [numpy_helper.from_array(v, k) for k, v in params.items()]
    nodes = [
        helper.make_node("Sub", [in_name, "mu_x"], ["xc"]),
        helper.make_node("Div", ["xc", "sd_x"], ["xn"]),
        helper.make_node("Gemm", ["xn", "W1", "b1"], ["z1"]),
        helper.make_node("Relu", ["z1"], ["h1"]),
        helper.make_node("Gemm", ["h1", "W2", "b2"], ["z2"]),
        helper.make_node("Relu", ["z2"], ["h2"]),
        helper.make_node("Gemm", ["h2", "W3", "b3"], ["yn"]),
        helper.make_node("Mul", ["yn", "sd_y"], ["ys"]),
        helper.make_node("Add", ["ys", "mu_y"], ["y"]),
        helper.make_node("Reshape", ["y", "out_shape"], ["action"]),
    ]
    graph = helper.make_graph(
        nodes,
        "armchair_bc",
        [helper.make_tensor_value_info(in_name, TensorProto.FLOAT, [1, len(mu_x)])],
        [helper.make_tensor_value_info("action", TensorProto.FLOAT, [1, chunk, len(mu_y) // chunk])],
        initializer=init,
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 10
    onnx.checker.check_model(model)
    onnx.save(model, str(out_path))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dataset", type=Path, help=".zip or .json exported from the web app")
    parser.add_argument("--out", type=Path, default=Path("policy_bc.onnx"))
    parser.add_argument("--hidden", type=int, default=384)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--stack", type=int, default=3, help="observation history length")
    parser.add_argument("--chunk", type=int, default=8, help="action chunk length (first step is executed)")
    args = parser.parse_args()

    X, Y, n_ep = load_frames(args.dataset, args.stack, args.chunk)
    print(f"training on {n_ep} successful episodes / {len(X)} frames (obs {X.shape[1]}, act chunk {Y.shape[1]})")
    params, norm = train(X, Y, args.hidden, args.epochs, args.lr)
    export_onnx(args.out, params, norm, args.stack, args.chunk)
    print(f"exported {args.out} — load it in the app's policy section")


if __name__ == "__main__":
    main()
