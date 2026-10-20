"""Durable local-job wrapper; enforce the training subprocess timeout."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import traceback


def run(directory):
    directory = Path(directory).resolve()
    config = json.loads((directory / "job.json").read_text(encoding="utf-8"))
    def status(state, error=None):
        payload = {"state": state, "updated_at": datetime.now(timezone.utc).isoformat()}
        if error:
            payload["error"] = error
        pending = directory / "status.pending.json"
        pending.write_text(json.dumps(payload), encoding="utf-8")
        os.replace(pending, directory / "status.json")
    status("running")
    try:
        command = [sys.executable, "-u", "-m", "training.train_constraints"]
        for key in ("snapshot", "champion", "out", "style"):
            command.extend(["--" + key, config[key]])
        for key, value in config["parameters"].items():
            command.extend(["--" + key, str(value)])
        if config.get("version"):
            command.extend(["--version", config["version"]])
        subprocess.run(command, check=True, timeout=config["timeout_seconds"], stdout=sys.stdout, stderr=subprocess.STDOUT,
                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        status("succeeded")
    except subprocess.TimeoutExpired:
        status("failed", "Local retrain timed out; champion untouched")
    except Exception as exc:
        traceback.print_exc()
        status("failed", str(exc))
    finally:
        marker = directory.parent / ".active-job"
        if marker.exists() and marker.read_text(encoding="utf-8") == config["job_id"]:
            marker.unlink()


if __name__ == "__main__":
    run(sys.argv[1])
