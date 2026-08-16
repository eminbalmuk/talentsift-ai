"""App-lifetime asyncpg pool shared across every request.

Each web request used to open its own CandidateRepository(settings.database_url),
which creates a brand-new asyncpg pool (a fresh TCP+TLS+auth handshake with Supabase)
and tears it down at the end of that single request. Under concurrent requests (e.g.
a dashboard page firing several API calls at once) this could open dozens of new
connections to the database simultaneously just to serve one page load. This module
opens one pool at FastAPI startup and every request reuses it.
"""

import asyncpg

from talentsift_ai.db.repository import init_connection

_pool: asyncpg.Pool | None = None


async def init_pool(database_url: str) -> None:
    global _pool
    _pool = await asyncpg.create_pool(
        database_url, statement_cache_size=0, init=init_connection
    )


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized -- app startup hasn't run yet.")
    return _pool
