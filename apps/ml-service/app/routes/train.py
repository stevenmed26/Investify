from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.security import verify_internal_token
from app.services.train_jobs import get_training_job, start_training_job

router = APIRouter()


@router.post("/train/jobs")
def create_training_job(
    horizon_days: int = Query(default=5, ge=1, le=60),
    _verified: None = Depends(verify_internal_token),
):
    job = start_training_job(horizon_days=horizon_days)
    return {
        "job_id": job["id"],
        "status": job["status"],
        "horizon_days": horizon_days,
    }


@router.get("/train/jobs/{job_id}")
def get_training_job_status(
    job_id: str,
    _verified: None = Depends(verify_internal_token),
):
    job = get_training_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job
