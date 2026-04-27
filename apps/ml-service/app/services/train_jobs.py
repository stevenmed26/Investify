from __future__ import annotations

import logging
import secrets
import threading
from datetime import datetime, timezone
from typing import Any

from app.services.trainer import train_model

logger = logging.getLogger(__name__)

_jobs_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}


def start_training_job(horizon_days: int) -> dict[str, Any]:
    job_id = secrets.token_hex(16)
    job = {
        "id": job_id,
        "name": "train_model",
        "status": "queued",
        "message": "Queued model training job.",
        "created_at": _utcnow(),
        "horizon_days": horizon_days,
    }

    with _jobs_lock:
        _jobs[job_id] = job

    thread = threading.Thread(
        target=_run_training_job,
        args=(job_id, horizon_days),
        daemon=True,
    )
    thread.start()
    return job.copy()


def get_training_job(job_id: str) -> dict[str, Any] | None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        return job.copy() if job else None


def _run_training_job(job_id: str, horizon_days: int) -> None:
    _update_job(job_id, status="running", message="Model training is running.", started_at=_utcnow())

    try:
        result = train_model(horizon_days=horizon_days)
        _update_job(
            job_id,
            status="completed",
            message="Model training completed.",
            completed_at=_utcnow(),
            result={
                "rows": result.rows,
                "train_rows": result.train_rows,
                "test_rows": result.test_rows,
                "accuracy": result.accuracy,
                "labels": result.labels,
                "tickers": result.tickers,
                "model_path": result.model_path,
                "horizon_days": horizon_days,
            },
        )
    except ValueError as exc:
        logger.warning("[train-jobs] training rejected job_id=%s: %s", job_id, exc)
        _update_job(
            job_id,
            status="failed",
            message="Model training failed.",
            completed_at=_utcnow(),
            error=str(exc),
        )
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception("[train-jobs] unexpected training error job_id=%s: %s", job_id, exc)
        _update_job(
            job_id,
            status="failed",
            message="Model training failed.",
            completed_at=_utcnow(),
            error=f"Unexpected training error: {exc}",
        )


def _update_job(job_id: str, **changes: Any) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(changes)


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()
