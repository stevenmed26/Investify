from fastapi import APIRouter
from app.db import get_db

router = APIRouter()

@router.get("/top-picks")
def get_top_picks(limit: int = 10):
    db = get_db()

    rows = db.execute("""
        SELECT symbol, predicted_return, confidence, recommendation
        FROM predictions
        WHERE confidence > 0.40
        ORDER BY confidence DESC
        LIMIT ?
    """, (limit,)).fetchall()

    return {"picks": [dict(r) for r in rows]}