"""Настройки из .env. Пути считаются от папки ai, поэтому запускать можно из любой папки."""
import os
from pathlib import Path

from dotenv import load_dotenv

AI_DIR = Path(__file__).resolve().parent.parent
load_dotenv(AI_DIR / ".env")

AUTH_KEY = os.environ.get("GIGACHAT_AUTH_KEY", "")
SCOPE = os.environ.get("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
MODEL = os.environ.get("GIGACHAT_MODEL", "GigaChat-2")
CA_BUNDLE = str(AI_DIR / os.environ.get("GIGACHAT_CA_BUNDLE_FILE", "certs/russian_bundle.pem"))

# У бэка общий таймаут 30 с на запрос к нам. Укладываемся в 25 с вместе с повтором.
DEADLINE_SEC = float(os.environ.get("AI_DEADLINE_SEC", "25"))
# Повтор генерации плана имеет смысл, только если на него осталось хотя бы столько секунд.
MIN_RETRY_SEC = float(os.environ.get("AI_MIN_RETRY_SEC", "10"))
