"""AI-сервис XRONIX. Контракт: contracts/ai.md.

Запуск из папки ai:
  .\\.venv\\Scripts\\python -m uvicorn app.main:app --port 8001 --reload
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from . import service
from .llm import LLM
from .models import RespondRequest, SummarizeRequest

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.llm = LLM()
    await app.state.llm.warmup()
    yield
    await app.state.llm.aclose()


app = FastAPI(title="XRONIX AI", lifespan=lifespan)


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


@app.exception_handler(service.AiError)
async def ai_error(_: Request, exc: service.AiError):
    return error(exc.status, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def bad_request(_: Request, exc: RequestValidationError):
    logger.warning("bad request: %s", exc.errors()[:5])
    return error(422, "VALIDATION_ERROR", "Некорректный запрос к AI-сервису")


@app.exception_handler(Exception)
async def internal(_: Request, exc: Exception):
    logger.exception("unhandled error")
    return error(500, "INTERNAL", "Внутренняя ошибка AI-сервиса")


@app.get("/ai/health")
async def health():
    return {"status": "ok"}


@app.post("/ai/respond")
async def respond(req: RespondRequest, request: Request):
    return await service.respond(request.app.state.llm, req)


@app.post("/ai/summarize")
async def summarize(req: SummarizeRequest):
    return await service.summarize(req)
