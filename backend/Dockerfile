FROM python:3.13-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    ENGINE_MODE=stockfish \
    STOCKFISH_PATH=/usr/games/stockfish \
    ENGINE_THREADS=1 \
    ENGINE_HASH_MB=32 \
    LLM_PROVIDER=deterministic \
    PORT=10000

RUN apt-get update \
    && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install --no-cache-dir uv==0.13.5
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-cache
COPY app ./app

RUN useradd --create-home --uid 10001 coach
USER coach
EXPOSE 10000

CMD ["sh", "-c", "exec .venv/bin/uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
