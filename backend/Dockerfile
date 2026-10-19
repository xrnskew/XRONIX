# Build from repository root: docker build -f backend/Dockerfile -t xronix-backend .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY contracts /srv/contracts
RUN useradd --uid 10001 --create-home app && mkdir -p data && chown app:app data
USER app
VOLUME ["/srv/backend/data"]
EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
