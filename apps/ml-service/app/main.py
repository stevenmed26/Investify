import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.health import router as health_router
from app.routes.models import router as models_router
from app.routes.predict import router as predict_router
from app.routes.train import router as train_router

# Configure logging once at startup so all loggers in the service
# (dataset, trainer, predictor, model_store, routes) emit consistently
# formatted output that matches the Go API's log style.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y/%m/%d %H:%M:%S",
)

# Quieten noisy third-party loggers
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("sklearn").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

app = FastAPI(title="Investify ML Service", version="0.4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(models_router)
app.include_router(predict_router)
app.include_router(train_router)

logger.info("[startup] Investify ML Service v0.4.0 ready")