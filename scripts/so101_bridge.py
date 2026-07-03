#!/usr/bin/env python3
"""WebSocket bridge between the Armchair web app and a real SO-101 follower arm.

The web app streams joint targets (radians, gripper 0..1) at 30 Hz as JSON:
    {"type": "action", "t": 12345, "joints": {"shoulder_pan": 0.12, ...}}

This bridge maps them to lerobot's SO-101 follower action space and sends
them to the arm. ALWAYS start with --dry-run to sanity-check the values and
joint directions before letting it move real hardware.

Usage:
    pip install lerobot websockets
    python scripts/so101_bridge.py --dry-run                 # print actions only
    python scripts/so101_bridge.py --port /dev/tty.usbmodem1 --id my_follower

Then open the web app and press "connect" (default ws://localhost:8765).

Written against the lerobot 0.3.x robots API (SO101Follower). Calibrate the
arm with lerobot first: the bridge assumes a calibrated follower whose
`.pos` action space is degrees (gripper 0..100).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import signal
import sys

JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]

# Sim convention -> SO-101 servo convention. Flip signs / add offsets here if
# your arm moves the wrong way during --dry-run comparison.
SIGN = {name: 1.0 for name in JOINTS}
OFFSET_DEG = {name: 0.0 for name in JOINTS}


def to_robot_action(joints_rad: dict[str, float]) -> dict[str, float]:
    action: dict[str, float] = {}
    for name in JOINTS:
        value = joints_rad.get(name)
        if value is None:
            continue
        if name == "gripper":
            action["gripper.pos"] = max(0.0, min(100.0, value * 100.0))
        else:
            action[f"{name}.pos"] = SIGN[name] * math.degrees(value) + OFFSET_DEG[name]
    return action


class Driver:
    """Wraps the lerobot follower; --dry-run prints instead of moving."""

    def __init__(self, port: str | None, robot_id: str, dry_run: bool):
        self.dry_run = dry_run
        self.robot = None
        if dry_run:
            return
        if not port:
            sys.exit("--port is required unless --dry-run is set")
        try:
            from lerobot.robots.so101_follower import SO101Follower, SO101FollowerConfig
        except ImportError:
            sys.exit("lerobot with SO-101 support not found; run: pip install lerobot")
        self.robot = SO101Follower(SO101FollowerConfig(port=port, id=robot_id))
        self.robot.connect()
        print(f"connected to SO-101 follower on {port}")

    def send(self, joints_rad: dict[str, float]) -> None:
        action = to_robot_action(joints_rad)
        if self.dry_run:
            print("action:", {k: round(v, 2) for k, v in action.items()})
        elif self.robot is not None:
            self.robot.send_action(action)

    def close(self) -> None:
        if self.robot is not None:
            self.robot.disconnect()


async def serve(driver: Driver, host: str, ws_port: int) -> None:
    import websockets

    async def handler(ws):
        peer = ws.remote_address
        print(f"web app connected: {peer}")
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "action" and isinstance(msg.get("joints"), dict):
                    driver.send(msg["joints"])
        finally:
            print(f"web app disconnected: {peer}")

    async with websockets.serve(handler, host, ws_port):
        print(f"listening on ws://{host}:{ws_port} — press connect in the web app")
        await asyncio.Future()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", default=None, help="serial port of the SO-101 follower (e.g. /dev/tty.usbmodem1)")
    parser.add_argument("--id", default="armchair_follower", help="lerobot robot id (calibration profile)")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--ws-port", type=int, default=8765)
    parser.add_argument("--dry-run", action="store_true", help="print actions instead of moving the arm")
    args = parser.parse_args()

    try:
        import websockets  # noqa: F401
    except ImportError:
        sys.exit("missing dependency; run: pip install websockets")

    driver = Driver(args.port, args.id, args.dry_run)
    loop = asyncio.new_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, loop.stop)
    try:
        loop.run_until_complete(serve(driver, args.host, args.ws_port))
    except (KeyboardInterrupt, RuntimeError):
        pass
    finally:
        driver.close()
        print("bridge stopped")


if __name__ == "__main__":
    main()
