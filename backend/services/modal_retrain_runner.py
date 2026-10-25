"""Modal adapter with durable job IDs, explicit uploads and atomic artifact import."""
from datetime import datetime, timezone
import io
import json
import math
from pathlib import Path
import re
import tempfile
import uuid

from aiohttp import ClientError
from grpclib.exceptions import StreamTerminatedError

from .model_artifacts import CANDIDATE_FILES, read_json, verify_artifacts
from .retrain_runner import RunnerUnavailable
from .retrain_contract import MAX_TRAINING_SECONDS, PROTOCOL_VERSION, source_hashes, snapshot_files, validate_job_id


class ModalRunner:
    def __init__(self, work_root, app_name="firetrackr-training", volume_name="firetrackr-training-jobs",
                 environment_name="main", timeout_minutes=60):
        import modal  # Optional: local inference and local training do not need Modal.

        if not math.isfinite(timeout_minutes) or not 0 < timeout_minutes <= MAX_TRAINING_SECONDS / 60:
            raise ValueError("Modal training timeout must be positive and at most 60 minutes")
        if not all(isinstance(value, str) and value.strip() for value in (app_name, volume_name, environment_name)):
            raise ValueError("Modal app, volume and environment names are required")
        self.modal = modal
        self.work_root = Path(work_root).resolve()
        self.repo_root = Path(__file__).resolve().parents[2]
        self.app_name, self.volume_name, self.environment_name = app_name, volume_name, environment_name
        self.timeout_seconds = timeout_minutes * 60

    def _directory(self, job_id):
        return self.work_root / validate_job_id(job_id)

    def _write(self, path, value):
        pending = path.with_suffix(".pending.json")
        pending.write_text(json.dumps(value, indent=2), encoding="utf-8")
        pending.replace(path)

    def _volume(self, job=None):
        job = job or {"volume": self.volume_name, "environment": self.environment_name}
        return self.modal.Volume.from_name(job["volume"], environment_name=job["environment"])

    def _read_remote(self, volume, name, limit=1024 * 1024):
        chunks, size = [], 0
        for chunk in volume.read_file(name):
            size += len(chunk)
            if size > limit:
                raise ValueError("Cloud metadata exceeds the size limit")
            chunks.append(chunk)
        return json.loads(b"".join(chunks))

    def submit(self, snapshot_dir, champion_dir, parameters=None, *, version=None, job_id=None):
        if parameters:
            raise ValueError("Modal retraining uses the fixed registry training parameters")
        if not isinstance(version, str) or not re.fullmatch(r"v[1-9][0-9]*", version):
            raise ValueError("A registry-assigned version is required")
        snapshot_dir, champion_dir = Path(snapshot_dir), Path(champion_dir)
        snapshot_names = snapshot_files(snapshot_dir)
        champion, _, _ = verify_artifacts(champion_dir)
        hashes = source_hashes(self.repo_root)
        job_id = job_id or uuid.uuid4().hex
        directory = self._directory(job_id)
        directory.mkdir(parents=True, exist_ok=False)
        job = {"runner": "modal", "app": self.app_name, "volume": self.volume_name,
               "environment": self.environment_name, "created_at": datetime.now(timezone.utc).isoformat()}
        request = {"protocol": PROTOCOL_VERSION, "version": version, "parameters": {},
                   "source_hashes": hashes, "timeout_seconds": self.timeout_seconds, "created_at": job["created_at"]}
        self._write(directory / "job.json", job)
        # Persist the marker before cold starts/network I/O, so another polling
        # worker cannot mistake a slow submission for a missing reservation.
        info = self.modal.Function.from_name(self.app_name, "runner_info", environment_name=self.environment_name).remote()
        if info.get("protocol") != PROTOCOL_VERSION or info.get("source_hashes") != hashes:
            raise ValueError("The Modal trainer is out of date; redeploy training.modal_app")
        volume = self._volume(job)
        with volume.batch_upload() as batch:
            for name in snapshot_names:
                batch.put_file(snapshot_dir / name, f"/{job_id}/snapshot/{name}")
            for name in sorted(set(champion["files"]) | {"manifest.json"}):
                batch.put_file(champion_dir / name, f"/{job_id}/champion/{name}")
            batch.put_file(self.repo_root / "backend/data/constraint_style_config.json", f"/{job_id}/style_config.json")
            batch.put_file(io.BytesIO(json.dumps(request).encode()), f"/{job_id}/request.json")
        # Record intent before spawn. An interrupted acknowledgement is recovered
        # through the volume's job ID; it must never trigger automatic resubmission.
        job["spawn_requested"] = True
        self._write(directory / "job.json", job)
        try:
            call = self.modal.Function.from_name(self.app_name, "train", environment_name=self.environment_name).spawn(job_id)
            job["call_id"] = call.object_id
            self._write(directory / "job.json", job)
        except Exception as exc:
            raise RunnerUnavailable("Modal submission acknowledgement unavailable; polling the reserved job") from exc
        return job_id

    def status(self, job_id):
        directory = self._directory(job_id)
        if not (directory / "job.json").is_file():
            raise KeyError("Modal job not found")
        job = read_json(directory / "job.json")
        if (directory / "status.json").is_file():
            return read_json(directory / "status.json")
        try:
            try:
                status = self._read_remote(self._volume(job), f"/{job_id}/status.json")
            except FileNotFoundError:
                status = {"job_id": job_id, "state": "queued"}
            if status.get("job_id") != job_id or status.get("state") not in ("queued", "running", "succeeded", "failed"):
                raise ValueError("Invalid cloud job status")
            if status["state"] not in ("succeeded", "failed") and job.get("call_id"):
                try:
                    result = self.modal.FunctionCall.from_id(job["call_id"]).get(timeout=0)
                    if result.get("job_id") != job_id or result.get("state") not in ("succeeded", "failed"):
                        raise ValueError("Modal call returned no terminal job status")
                    status = result
                except self.modal.exception.FunctionTimeoutError:
                    status = {"job_id": job_id, "state": "failed", "error": "Modal function exceeded its time limit"}
                except self.modal.exception.OutputExpiredError:
                    # Durable volume results remain usable after call outputs expire.
                    pass
                except (TimeoutError, self.modal.exception.TimeoutError):
                    pass  # Nonblocking polling: the call has not finished yet.
                except self.modal.exception.ExecutionError:
                    status = {"job_id": job_id, "state": "failed", "error": "Modal worker exited; inspect its cloud logs"}
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(job["created_at"])).total_seconds()
            if status["state"] in ("queued", "running") and age > 86400 + MAX_TRAINING_SECONDS + 300:
                status = {"job_id": job_id, "state": "failed", "error": "Modal job expired without a durable result; inspect cloud logs"}
            if status["state"] in ("succeeded", "failed"):
                self._write(directory / "status.json", status)
            return status
        except self.modal.exception.Error as exc:
            raise RunnerUnavailable("Modal status temporarily unavailable") from exc
        except (ConnectionError, OSError, ClientError, StreamTerminatedError) as exc:
            raise RunnerUnavailable("Modal status temporarily unavailable") from exc

    def fetch(self, job_id, destination):
        if self.status(job_id)["state"] != "succeeded":
            raise RuntimeError("Only a successful Modal job can be fetched")
        job = read_json(self._directory(job_id) / "job.json")
        volume = self._volume(job)
        destination = Path(destination)
        if destination.exists():
            raise FileExistsError("Refusing to replace a model bundle")
        destination.parent.mkdir(parents=True, exist_ok=True)
        # Download into a sibling staging directory. A dropped connection never
        # leaves a partial bundle occupying the registry version directory.
        try:
            with tempfile.TemporaryDirectory(prefix=".modal-fetch-", dir=destination.parent) as staging:
                staged = Path(staging) / "bundle"
                staged.mkdir()
                manifest = self._read_remote(volume, f"/{job_id}/bundle/manifest.json")
                if set(manifest.get("files", {})) != CANDIDATE_FILES:
                    raise ValueError("Cloud bundle has unexpected artifact names")
                (staged / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
                for name in sorted(CANDIDATE_FILES):
                    size = 0
                    with (staged / name).open("wb") as target:
                        for chunk in volume.read_file(f"/{job_id}/bundle/{name}"):
                            size += len(chunk)
                            if size > 256 * 1024 * 1024:
                                raise ValueError("Cloud artifact exceeds size limit")
                            target.write(chunk)
                verify_artifacts(staged)
                staged.rename(destination)
        except self.modal.exception.Error as exc:
            raise RunnerUnavailable("Modal artifact download temporarily unavailable") from exc
        except (ConnectionError, TimeoutError, ClientError, StreamTerminatedError) as exc:
            raise RunnerUnavailable("Modal artifact download temporarily unavailable") from exc
        return destination
