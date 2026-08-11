FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY pyproject.toml README.md LICENSE ./
COPY src ./src
COPY migrations ./migrations

RUN pip install .

EXPOSE 8000

# $PORT is injected by Railway/Render/Fly at runtime; falls back to 8000 locally.
CMD talentsift admin serve --host 0.0.0.0 --port ${PORT:-8000}
