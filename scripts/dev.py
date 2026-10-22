"""Run both local application servers; stop both cleanly with Ctrl+C."""
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    node = os.environ.get("NODE_BINARY") or shutil.which("node")
    local_node = ROOT / ".tools/node/bin/node"
    if not node and local_node.exists():
        node = str(local_node)
    python = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not node or not python.exists() or not (ROOT / "node_modules/next").exists():
        sys.exit("Install dependencies first; see README.md Quick start.")
    env = os.environ.copy()
    env["PATH"] = str(Path(node).parent) + os.pathsep + env.get("PATH", "")
    env.setdefault("DEMO_MODE", "1")
    children = []

    def stop(*_):
        for child in children:
            if child.poll() is None:
                child.terminate()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        children.append(subprocess.Popen([str(python), "-m", "uvicorn", "backend.app:app", "--host", "127.0.0.1", "--port", "8000"], cwd=ROOT, env=env))
        children.append(subprocess.Popen([node, "node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1"], cwd=ROOT, env=env))
        print("\nBetter Get Involved: http://127.0.0.1:3000\nAPI docs: http://127.0.0.1:8000/docs\n", flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(0.5)
    finally:
        stop()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
        failures = [child.returncode for child in children if child.returncode not in (0, -15, -2, 130)]
        if failures:
            sys.exit(1)


if __name__ == "__main__":
    main()
