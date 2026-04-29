from __future__ import annotations

import logging
import secrets
import threading
from datetime import datetime, timezone
from typing import Any

from app.db import get_connection
from app.services.trainer import train_model
from psycopg.types.json import Jsonb

logger = logging.getLogger(__name__)

_jobs_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}


def start_training_job(horizon_days: int) -> dict[str, Any]:
    job_id = secrets.token_hex(16)
    job = {
        "id": job_id,
        "service": "ml",
        "name": "train_model",
        "status": "queued",
        "message": "Queued model training job.",
        "created_at": _utcnow(),
        "updated_at": _utcnow(),
        "metadata": {"horizon_days": horizon_days},
        "horizon_days": horizon_days,
    }

    with _jobs_lock:
        _jobs[job_id] = job

    _insert_job(job)

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
        if job:
            return job.copy()

    return _get_job_from_db(job_id)


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


def _insert_job(job: dict[str, Any]) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pipeline_jobs (
                    id, service, name, status, message, metadata_json, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    job["id"],
                    job["service"],
                    job["name"],
                    job["status"],
                    job["message"],
                    Jsonb(job["metadata"]),
                    job["created_at"],
                    job["updated_at"],
                ),
            )


def _get_job_from_db(job_id: str) -> dict[str, Any] | None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    service,
                    name,
                    status,
                    message,
                    error,
                    result_json,
                    metadata_json,
                    created_at,
                    started_at,
                    completed_at,
                    updated_at
                FROM pipeline_jobs
                WHERE id = %s
                """,
                (job_id,),
            )
            row = cur.fetchone()

    if not row:
        return None

    job = {
        "id": row["id"],
        "service": row["service"],
        "name": row["name"],
        "status": row["status"],
        "message": row["message"],
        "error": row["error"],
        "result": row["result_json"],
        "metadata": row["metadata_json"] or {},
        "created_at": _iso(row["created_at"]),
        "started_at": _iso(row["started_at"]),
        "completed_at": _iso(row["completed_at"]),
        "updated_at": _iso(row["updated_at"]),
    }
    if "horizon_days" in job["metadata"]:
        job["horizon_days"] = job["metadata"]["horizon_days"]
    return job


def _update_job(job_id: str, **changes: Any) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job:
            job.update(changes)
            job["updated_at"] = changes.get("updated_at", _utcnow())

    updated_at = changes.get("updated_at", _utcnow())

    with get_connection() as conn:
        with conn.cursor() as cur:
            if changes.get("status") == "running":
                cur.execute(
                    """
                    UPDATE pipeline_jobs
                    SET status = %s,
                        message = %s,
                        started_at = COALESCE(started_at, %s),
                        updated_at = %s
                    WHERE id = %s
                    """,
                    (changes["status"], changes["message"], changes.get("started_at"), updated_at, job_id),
                )
            elif changes.get("status") == "completed":
                cur.execute(
                    """
                    UPDATE pipeline_jobs
                    SET status = %s,
                        message = %s,
                        error = NULL,
                        result_json = %s,
                        completed_at = %s,
                        updated_at = %s
                    WHERE id = %s
                    """,
                    (
                        changes["status"],
                        changes["message"],
                        Jsonb(changes.get("result") or {}),
                        changes.get("completed_at"),
                        updated_at,
                        job_id,
                    ),
                )
            elif changes.get("status") == "failed":
                cur.execute(
                    """
                    UPDATE pipeline_jobs
                    SET status = %s,
                        message = %s,
                        error = %s,
                        completed_at = %s,
                        updated_at = %s
                    WHERE id = %s
                    """,
                    (
                        changes["status"],
                        changes["message"],
                        changes.get("error"),
                        changes.get("completed_at"),
                        updated_at,
                        job_id,
                    ),
                )
            elif "message" in changes:
                cur.execute(
                    """
                    UPDATE pipeline_jobs
                    SET message = %s,
                        updated_at = %s
                    WHERE id = %s
                    """,
                    (changes["message"], updated_at, job_id),
                )


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)
