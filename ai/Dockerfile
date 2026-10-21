FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Только сервис и его файлы данных (app/rules/data). Сборщики базы и генератор фраз (knowledge/) в образ не входят:
# во время работы сервис не ходит в сеть, ключей и сертификатов ему не нужно.
COPY app ./app

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
