from __future__ import annotations

from fastapi import Header, HTTPException

from app.config import settings


def verify_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    if x_internal_token != settings.internal_token:
        raise HTTPException(status_code=401, detail="unauthorized")
