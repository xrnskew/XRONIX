"""Сервис ai XRONIX — собственная экспертная система на правилах. Контракт: contracts/ai.md.

Нейросети, ключей и сети во время работы нет: /ai/consult и /ai/parse-need — правила (app/rules) и файлы
данных в app/rules/data, /ai/summarize — фильтр сказанного человеком.

Запуск из папки ai:
  .\\.venv\\Scripts\\python -m uvicorn app.main:app --port 8001 --reload
"""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .rules import consult as rules_consult, parse_need as rules_parse_need
from .rules.models import ConsultRequest, ConsultResponse, ParseNeedRequest, ParseNeedResponse
from .summarize import SummarizeRequest, summarize as summarize_memory

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("ai")


app = FastAPI(title="XRONIX AI")


class AiError(Exception):
    MESSAGES = {"AI_BAD_RESPONSE": "Не получилось составить ответ. Попробуйте ещё раз или переформулируйте."}
    STATUS = {"AI_BAD_RESPONSE": 502}

    def __init__(self, code: str):
        super().__init__(code)
        self.code, self.status, self.message = code, self.STATUS[code], self.MESSAGES[code]


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


@app.exception_handler(AiError)
async def ai_error(_: Request, exc: AiError):
    return error(exc.status, exc.code, exc.message)


@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException):
    # Тело не JSON / не UTF-8, неизвестный путь и т.п. — тоже в формате ошибок контракта.
    code = {400: "VALIDATION_ERROR", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
    message = "Некорректный запрос к AI-сервису" if exc.status_code == 400 else str(exc.detail)
    return error(exc.status_code, code, message)


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


def _checked(model, payload: dict) -> dict:
    """Свой ответ тоже проверяем по контракту: лучше 502, чем невалидный JSON бэкенду."""
    try:
        out = model.model_validate(payload).model_dump()
    except ValidationError as e:
        logger.error("ответ не по контракту: %s", e.errors()[:3])
        raise AiError("AI_BAD_RESPONSE")
    if model is ConsultResponse:
        if out.get("questions") is None:
            out.pop("questions", None)  # state с null-полями оставляем как есть: схема их требует
        for q in out.get("questions") or []:
            if q.get("options") is None:
                q.pop("options", None)  # у text-вопроса поля options быть не должно
    return out


@app.post("/ai/consult")
async def consult(req: ConsultRequest):
    out = _checked(ConsultResponse, rules_consult.respond(req.model_dump(exclude_unset=False)))
    # experience необязательное: если в запросе его не было и он не узнан, state возвращается без него, как пришёл.
    if "experience" not in req.state.model_fields_set and out["state"].get("experience") is None:
        out["state"].pop("experience", None)
    return out


@app.post("/ai/parse-need")
async def parse_need(req: ParseNeedRequest):
    out = _checked(ParseNeedResponse, rules_parse_need.parse(req.model_dump()))
    out["confidence"] = {k: v for k, v in out["confidence"].items() if v is not None}
    return out


@app.post("/ai/summarize")
async def summarize(req: SummarizeRequest):
    return summarize_memory(req)
