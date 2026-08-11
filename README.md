# TalentSift AI

TalentSift AI is a scalable, multi-stage hybrid RAG pipeline for screening large resume batches. It combines async Mistral OCR/extraction, PostgreSQL + pgvector semantic ranking, and a LangGraph Optimist/Pessimist/Arbitrator review flow.

## Quick Start

```powershell
python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
pip install -e ".[dev,observability,eval]"
copy .env.example .env
```

Fill in `.env` (Mistral keys, secrets — see `.env.example` for what each value does).

Start a local PostgreSQL database with pgvector:

```powershell
docker compose up -d
```

Create the database schema:

```powershell
talentsift db init
```

Provision the owner admin login. The username and password are fully random and printed once.

```powershell
talentsift admin provision
```

Start the JSON API that the web frontend talks to:

```powershell
talentsift admin serve
```

This serves the admin and organization API routes at `http://127.0.0.1:8000/api/*`.

In a separate terminal, install and start the Next.js frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`, sign in with the generated admin credential at `/admin/login`, and use "Organizasyon ekle" to create licensed organizations. Organization display names are only labels; each organization receives a fully random username and password. Organizations sign in at `/org/login` to browse candidates, run the debate pipeline, and view final rankings.

> Use `http://localhost:3000`, not `127.0.0.1`, when opening the frontend in development — Next.js blocks cross-origin dev asset requests by default.

The frontend proxies `/api/*` to the backend (configurable via the `BACKEND_URL` environment variable, default `http://127.0.0.1:8000`), so both must be running together in development.

You can also add an organization from the CLI:

```powershell
talentsift admin add-organization --display-name "Acme Corp"
```

Verify an organization login credential:

```powershell
talentsift auth login-check --username "org_..." --password "pw_..."
```

Ingest resumes:

```powershell
talentsift ingest --organization-id 1 --resume-dir .\\resumes
```

Rank candidates for a role:

```powershell
talentsift rank --organization-id 1 --job-description ".\\job.txt" --min-gpa 2.75 --class-year 3 --limit 50
```

Run the adversarial review for ranked candidates:

```powershell
talentsift debate --organization-id 1 --job-description ".\\job.txt" --candidate-id 1
```

Show the final ranking:

```powershell
talentsift top --organization-id 1 --limit 5
```

## Architecture

1. Async OCR and structured extraction with Mistral models.
2. B2B tenant isolation with organization-scoped candidates and debate results.
3. PostgreSQL + pgvector for strict filters and semantic ranking.
4. LangGraph Optimist, Pessimist, and Arbitrator agents for final scoring.
5. Optional Phoenix tracing and RAGAS evaluation hooks.
6. A Next.js (TypeScript, Tailwind, shadcn/ui) frontend in `frontend/` that talks to the FastAPI
   JSON API — an admin console for organization/license management, and an organization console
   for candidate search, semantic ranking, and running the debate pipeline.

## Frontend

`frontend/` is a standalone Next.js app. It never talks to Postgres directly — every request goes
through the FastAPI JSON API (`talentsift_ai.web.app`) under `/api/admin/*` (owner admin) and
`/api/org/*` (organization users), proxied in development via `next.config.ts` rewrites. Both
processes must run side by side locally (`talentsift admin serve` for the API, `npm run dev` in
`frontend/` for the UI).

## Database Strategy

Local development uses Dockerized Postgres with pgvector. Production uses Supabase Postgres (see
below). The application talks to standard Postgres via `asyncpg`, so the same migrations work in
both places unchanged.

## Production Deployment (Supabase + Render + Vercel)

The backend (FastAPI + asyncpg + LangGraph) runs on Render as a Docker web service — it's not
deployed to Vercel, since the OCR/embedding/debate pipeline includes long-running, sequential
Mistral calls that don't fit serverless execution-time limits. Only the Next.js frontend goes on
Vercel.

**We don't use Prisma or any Node ORM.** The backend already owns all database access
(`asyncpg` + hand-written SQL in `db/repository.py`); the frontend never talks to Postgres
directly, it only calls the FastAPI JSON API. Pointing an ORM at the database from the frontend
would duplicate that logic in a second language and bypass the auth/tenant-isolation rules the
backend already enforces — so we skip that part of the generic Vercel/Supabase integration
snippet entirely.

### 1. Supabase (database)

1. Create a Supabase project and enable the `vector` extension (Database → Extensions → `vector`,
   or let `talentsift db init` run `CREATE EXTENSION IF NOT EXISTS vector` for you — the
   Supabase Postgres role has permission for it).
2. Copy two connection strings from Project Settings → Database → Connection string:
   - **Transaction pooler** (port `6543`, `?pgbouncer=true`) → `DATABASE_URL`. Used by the running
     app; safe for many concurrent serverless-style connections.
   - **Session/direct** connection (port `5432`) → `DIRECT_DATABASE_URL`. Used only for running
     migrations, since PgBouncer's transaction mode doesn't reliably support the DDL statements
     migrations issue.
3. `asyncpg` is already configured with `statement_cache_size=0` (see `db/repository.py`), which
   is required for compatibility with PgBouncer's transaction-mode pooler.
4. Run migrations once against the **direct** URL:
   ```powershell
   $env:DATABASE_URL = $env:DIRECT_DATABASE_URL
   talentsift db init
   talentsift admin provision
   ```

### 2. Backend (Render)

`render.yaml` at the repo root is a [Render Blueprint](https://render.com/docs/blueprint-spec) —
it declares a Docker web service built from the root `Dockerfile`, a `/healthz` health check, and
its required environment variables.

1. In the Render dashboard: **New +** → **Blueprint** → connect this repo. Render reads
   `render.yaml` and proposes the `talentsift-api` service.
2. `PRODUCT_KEY_PEPPER` and `ADMIN_SESSION_SECRET` are generated for you automatically
   (`generateValue: true`). Fill in the rest when prompted:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Supabase transaction-pooler URL (port 6543, `?pgbouncer=true`) |
   | `DIRECT_DATABASE_URL` | Supabase direct URL (port 5432) — only needed if you run `talentsift db init` from the Render shell |
   | `MISTRAL_API_KEYS` | Comma-separated Mistral API keys |

   `COOKIE_SECURE` and `MISTRAL_BASE_URL` are already set in the blueprint.
3. Deploy. Render injects `PORT`; the Docker `CMD` reads it automatically
   (`talentsift admin serve --host 0.0.0.0 --port $PORT`).
4. Run the one-time setup from the service's **Shell** tab in the Render dashboard:
   ```bash
   talentsift db init
   talentsift admin provision
   ```
5. Note the service URL Render assigns (e.g. `https://talentsift-api.onrender.com`) — the
   frontend needs it as `BACKEND_URL` in the next step.

> The Dockerfile itself isn't Render-specific — if you ever move off Render, the same image runs
> unchanged on Railway, Fly.io, or any other container host.

### 3. Frontend (Vercel)

1. Import the repo into Vercel and set **Root Directory** to `frontend` (Next.js is
   auto-detected — no `vercel.json` needed).
2. Set the environment variable `BACKEND_URL` to your deployed backend URL (e.g.
   `https://talentsift-api.onrender.com`). `next.config.ts` reads it at build time to configure
   the `/api/*` rewrite proxy, so the browser only ever talks to your Vercel domain — the backend
   never needs CORS headers, and session cookies stay same-origin automatically.
3. Deploy. Sign in at `/admin/login`, provision organizations, and they sign in at `/org/login`.
