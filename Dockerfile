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
#
# Migrations (idempotent) and admin provisioning (skipped if an admin already exists)
# run on every container start, before the server binds — no Shell access needed on
# hosts like Render's free tier. Their failures don't block the server from starting
# (e.g. DATABASE_URL not configured yet), so /healthz still comes up for debugging;
# check the service logs for the "Admin credential provisioned" line after first boot.
CMD talentsift db init; talentsift admin provision --skip-if-exists; talentsift admin serve --host 0.0.0.0 --port ${PORT:-8000}
