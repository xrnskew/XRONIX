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

# Весь ответ /ai/respond (вопросы + план + повтор) должен уложиться сюда. Держать на ~5 с меньше
# таймаута бэка на запрос к нам: у GigaChat-2 бэк ждёт 30 с -> 25; у GigaChat-3-Ultra план идёт 19–25 с,
# поэтому для неё бэку нужно 45 с, а здесь 40.
DEADLINE_SEC = float(os.environ.get("AI_DEADLINE_SEC", "25"))
# Один запрос к GigaChat (без подключения, у него свои 5 с). Ultra: 35.
REQUEST_TIMEOUT_SEC = float(os.environ.get("GIGACHAT_TIMEOUT_SEC", "20"))
# Шаг «вопросы или план»: обычно 1–2 с, дольше не ждём и задаём запасные вопросы.
DECIDE_TIMEOUT_SEC = float(os.environ.get("AI_DECIDE_TIMEOUT_SEC", "8"))
# Повтор генерации плана имеет смысл, только если на него осталось хотя бы столько секунд. Ultra: 20.
MIN_RETRY_SEC = float(os.environ.get("AI_MIN_RETRY_SEC", "10"))
