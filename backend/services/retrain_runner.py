"""Local subprocess adapter: submit, poll durable status, fetch a fresh bundle.

Lightning and the database job registry are intentionally separate integrations.
The adapter never changes the active model or reads database credentials.
"""
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid


class LocalRunner:
    def __init__(self, work_root, python_executable, timeout_minutes=60):
        self.work_root = Path(work_root).resolve()
        self.python = Path(python_executable).resolve()
        self.repo_root = Path(__file__).resolve().parents[2]
        if not self.python.is_file() or not math.isfinite(timeout_minutes) or timeout_minutes <= 0:
            raise ValueError("A training Python executable and positive timeout are required")
        self.timeout_seconds = timeout_minutes * 60
        self.processes = {}

    def _directory(self, job_id):
        if not re.fullmatch(r"[0-9a-f]{32}", job_id):
            raise ValueError("Invalid local job ID")
        return self.work_root / job_id

    def submit(self, snapshot_dir, champion_dir, parameters=None, *, version=None, job_id=None):
        parameters = parameters or {}
        if set(parameters) - {"epochs", "lr", "patience", "seed", "threads"}:
            raise ValueError("Unsupported training parameter")
        snapshot_dir, champion_dir = Path(snapshot_dir).resolve(), Path(champion_dir).resolve()
        if not (snapshot_dir / "manifest.json").is_file() or not (champion_dir / "manifest.json").is_file():
            raise ValueError("A complete snapshot and champion bundle are required")
        if version is not None and not re.fullmatch(r"v[1-9][0-9]*", version):
            raise ValueError("Invalid registry version")
        job_id = job_id or uuid.uuid4().hex
        self._directory(job_id)  # Validate caller-supplied IDs before acquiring the marker.
        if self._directory(job_id).exists():
            raise FileExistsError("Local job ID already exists")
        self.work_root.mkdir(parents=True, exist_ok=True)
        active = self.work_root / ".active-job"
        # Exclusive filesystem creation serializes local jobs across callers.
        try:
            with active.open("x", encoding="utf-8") as marker:
                marker.write(job_id)
        except FileExistsError as exc:
            previous_id = active.read_text(encoding="utf-8")
            try:
                previous = self.status(previous_id)
            except (KeyError, ValueError):
                previous = {"state": "unknown"}
            if previous["state"] not in ("succeeded", "failed"):
                raise RuntimeError("A local retrain is already active; inspect its persisted status") from exc
            # A finished wrapper can leave a marker after an interrupted cleanup.
            if active.exists() and active.read_text(encoding="utf-8") == previous_id:
                active.unlink()
            try:
                with active.open("x", encoding="utf-8") as marker:
                    marker.write(job_id)
            except FileExistsError as retry_error:
                raise RuntimeError("Another local retrain acquired the runner") from retry_error
        directory = self._directory(job_id)
        try:
            directory.mkdir()
            config = {"job_id": job_id, "snapshot": str(snapshot_dir), "champion": str(champion_dir),
                      "out": str(directory / "bundle"), "style": str(self.repo_root / "backend/data/constraint_style_config.json"),
                      "parameters": parameters, "version": version, "timeout_seconds": self.timeout_seconds,
                      "created_at": datetime.now(timezone.utc).isoformat()}
            (directory / "job.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
            # Training receives only OS/runtime settings, never the backend's
            # DATABASE_URL, JWT secret or external-service credentials.
            runtime_keys = {"PATH", "SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "PATHEXT",
                            "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE",
                            "HOMEPATH", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"}
            environment = {key: value for key, value in os.environ.items() if key.upper() in runtime_keys}
            environment.update(PYTHONUTF8="1", PYTHONIOENCODING="utf-8", PYTHONHASHSEED="42")
            with (directory / "job.log").open("w", encoding="utf-8") as log:
                process = subprocess.Popen([str(self.python), "-u", "-m", "training.local_job", str(directory)],
                                           cwd=self.repo_root, stdout=log, stderr=subprocess.STDOUT,
                                           env=environment,
                                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            self.processes[job_id] = process
        except Exception:
            active.unlink(missing_ok=True)
            raise
        return job_id

    def status(self, job_id):
        directory = self._directory(job_id)
        if not (directory / "job.json").is_file():
            raise KeyError("Local job not found")
        status_file = directory / "status.json"
        status = json.loads(status_file.read_text(encoding="utf-8")) if status_file.exists() else {"state": "queued"}
        process = self.processes.get(job_id)
        if process is not None and process.poll() is not None and status["state"] in ("queued", "running"):
            status = {"state": "failed", "error": f"Local job worker exited unexpectedly ({process.returncode})"}
            (directory / "status.json").write_text(json.dumps(status), encoding="utf-8")
            marker = self.work_root / ".active-job"
            if marker.exists() and marker.read_text(encoding="utf-8") == job_id:
                marker.unlink()
        if status["state"] == "failed":
            log = directory / "job.log"
            if log.exists():
                with log.open("rb") as source:
                    source.seek(max(0, log.stat().st_size - 8000))
                    status["log_tail"] = source.read().decode("utf-8", errors="replace")
        return {"job_id": job_id, **status}

    def fetch(self, job_id, destination):
        if self.status(job_id)["state"] != "succeeded":
            raise RuntimeError("Only a successful local job can be fetched")
        source = self._directory(job_id) / "bundle"
        if not (source / "manifest.json").is_file():
            raise RuntimeError("Job returned no complete bundle")
        shutil.copytree(source, Path(destination), dirs_exist_ok=False)
        return Path(destination)
