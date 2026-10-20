"""Предикторы для evaluate.py через настоящий HTTP-путь сервиса (FastAPI TestClient), без GigaChat.

    python -m dataset.evaluate --task consult    --predictor dataset.predictors:rules_consult    --name rules
    python -m dataset.evaluate --task parse_need --predictor dataset.predictors:rules_parse_need --name rules
"""
import os
from functools import lru_cache

os.environ["GIGACHAT_AUTH_KEY"] = ""  # правиловым методам ключ не нужен; v1 /ai/respond останется выключен


@lru_cache(maxsize=1)
def _client():
    from fastapi.testclient import TestClient

    from app import config
    config.AUTH_KEY = ""
    from app.main import app
    return TestClient(app)


def rules_consult(request: dict) -> dict:
    return _client().post("/ai/consult", json=request).json()


def rules_parse_need(request: dict) -> dict:
    return _client().post("/ai/parse-need", json=request).json()
