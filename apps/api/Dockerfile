# SmartWear API + worker image (Django ASGI via uvicorn; Celery uses the same image with another command).
# Build from the repo root:  docker build -f apps/api/Dockerfile -t smartwear-api .
FROM python:3.12-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv UV_HTTP_TIMEOUT=180 UV_HTTP_RETRIES=5
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgdal32 libgeos-c1v5 libproj25 libvips42 ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv

FROM base AS deps
WORKDIR /app
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project

FROM base AS runtime
RUN useradd --create-home --uid 10001 smartwear
WORKDIR /app
COPY --from=deps /opt/venv /opt/venv
COPY --chown=smartwear:smartwear apps/api/ ./
ENV PATH="/opt/venv/bin:$PATH" NODE_ENV=production PORT=4000
USER smartwear
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD curl -fsS http://localhost:${PORT}/health || exit 1
# Migrations run as a separate release step:  docker run … python manage.py migrate
CMD ["sh", "-c", "uvicorn smartwear.asgi:application --host 0.0.0.0 --port ${PORT} --workers ${WEB_CONCURRENCY:-2} --proxy-headers --forwarded-allow-ips='*' --ws websockets"]
