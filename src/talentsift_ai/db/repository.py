import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import asyncpg

from talentsift_ai.auth import (
    AdminCredential,
    OrganizationCredential,
    generate_admin_username,
    generate_license_key,
    generate_organization_username,
    generate_password,
    hash_secret,
    normalize_username,
    secret_public_prefix,
    unique_slug,
    verify_secret,
)
from talentsift_ai.db.vector import to_pgvector
from talentsift_ai.pipeline.sparse import tr_lower
from talentsift_ai.schemas import (
    Candidate,
    CandidateCreate,
    DebateResult,
    JobPosting,
    JobPostingCreate,
)

logger = logging.getLogger(__name__)


def _utc_iso(value: Any) -> Any:
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    return value


async def init_connection(connection: asyncpg.Connection) -> None:
    """
    Postgres NUMERIC columns (gpa) decode to Python Decimal by default, which
    FastAPI's JSON encoder then serializes as a *string* (e.g. "3.40") -- the
    frontend expects a number and crashes calling .toFixed() on a string. Decode
    numeric as float8 for every connection so the API always returns real numbers.
    """
    await connection.set_type_codec(
        "numeric", schema="pg_catalog", encoder=str, decoder=float, format="text"
    )


class CandidateRepository:
    """
    database_url: opens and owns a dedicated pool for the lifetime of this instance
    (CLI commands -- short-lived processes where a fresh pool per invocation is fine).
    pool: uses an already-open, externally-owned pool (the web app's shared pool) and
    never closes it -- creating a new asyncpg pool per HTTP request re-pays a TCP+TLS+
    auth handshake with the database on every single request.
    """

    def __init__(
        self, database_url: str | None = None, *, pool: asyncpg.Pool | None = None
    ) -> None:
        self._database_url = database_url
        self._pool = pool
        self._owns_pool = pool is None

    async def connect(self) -> None:
        if self._pool is None:
            if self._database_url is None:
                raise ValueError("CandidateRepository requires database_url or pool.")
            self._pool = await asyncpg.create_pool(
                self._database_url,
                statement_cache_size=0,
                init=init_connection,
            )

    async def close(self) -> None:
        if self._owns_pool and self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def __aenter__(self) -> "CandidateRepository":
        await self.connect()
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    async def init_schema(self, migration_path: Path) -> None:
        await self._ensure_connected()
        sql = migration_path.read_text(encoding="utf-8")
        async with self._pool.acquire() as connection:
            await connection.execute(sql)

    async def ping(self) -> bool:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            return bool(await connection.fetchval("SELECT 1"))

    async def admin_user_exists(self) -> bool:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchval("SELECT EXISTS(SELECT 1 FROM admin_users)")
        return bool(row)

    async def provision_admin_user(
        self,
        *,
        username: str | None = None,
        password: str | None = None,
        credential_pepper: str = "",
    ) -> AdminCredential:
        await self._ensure_connected()
        admin_user = username or generate_admin_username()
        admin_pass = password or generate_password()
        username_norm = normalize_username(admin_user)

        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                INSERT INTO admin_users (
                    username,
                    username_normalized,
                    password_hash,
                    password_prefix
                )
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (username_normalized) DO UPDATE
                SET password_hash = EXCLUDED.password_hash,
                    password_prefix = EXCLUDED.password_prefix
                RETURNING id, username
                """,
                admin_user,
                username_norm,
                hash_secret(admin_pass, pepper=credential_pepper),
                secret_public_prefix(admin_pass),
            )

        return AdminCredential(
            admin_id=row["id"],
            username=row["username"],
            password=admin_pass,
            password_prefix=secret_public_prefix(admin_pass),
        )

    async def authenticate_admin(
        self,
        *,
        username: str,
        password: str,
        credential_pepper: str = "",
    ) -> dict[str, Any] | None:
        await self._ensure_connected()
        username_normalized = normalize_username(username)
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                SELECT id AS admin_id, username, password_hash
                FROM admin_users
                WHERE username_normalized = $1 AND is_active = TRUE
                """,
                username_normalized,
            )
            if row is None:
                return None

            if not verify_secret(password, row["password_hash"], pepper=credential_pepper):
                return None

            await connection.execute(
                "UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1",
                row["admin_id"],
            )

        data = dict(row)
        data.pop("password_hash")
        return data

    async def provision_organization_user(
        self,
        *,
        display_name: str,
        credential_pepper: str = "",
        notes: str | None = None,
    ) -> OrganizationCredential:
        await self._ensure_connected()
        username = generate_organization_username()
        password = generate_password()
        license_key = generate_license_key()
        username_normalized = normalize_username(username)
        async with self._pool.acquire() as connection:
            async with connection.transaction():
                organization_row = await connection.fetchrow(
                    """
                    INSERT INTO organizations (
                        display_name,
                        slug,
                        license_key_hash,
                        license_key_prefix,
                        notes
                    )
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id, display_name
                    """,
                    display_name,
                    unique_slug(display_name),
                    hash_secret(license_key, pepper=credential_pepper),
                    secret_public_prefix(license_key),
                    notes,
                )
                await connection.execute(
                    """
                    INSERT INTO organization_users (
                        organization_id,
                        username,
                        username_normalized,
                        password_hash,
                        password_prefix
                    )
                    VALUES ($1, $2, $3, $4, $5)
                    """,
                    organization_row["id"],
                    username,
                    username_normalized,
                    hash_secret(password, pepper=credential_pepper),
                    secret_public_prefix(password),
                )

        return OrganizationCredential(
            organization_id=organization_row["id"],
            display_name=organization_row["display_name"],
            username=username,
            password=password,
            password_prefix=secret_public_prefix(password),
            license_key=license_key,
            license_key_prefix=secret_public_prefix(license_key),
        )

    async def create_organization_registration(
        self,
        *,
        display_name: str,
        username: str,
        password: str,
        credential_pepper: str = "",
        notes: str | None = None,
    ) -> dict[str, Any]:
        await self._ensure_connected()
        username_clean = username.strip()
        username_normalized = normalize_username(username_clean)
        async with self._pool.acquire() as connection:
            async with connection.transaction():
                existing = await connection.fetchrow(
                    "SELECT id FROM organization_users WHERE username_normalized = $1",
                    username_normalized,
                )
                if existing:
                    raise ValueError("Bu kullanıcı adı zaten kullanılmaktadır.")

                organization_row = await connection.fetchrow(
                    """
                    INSERT INTO organizations (
                        display_name,
                        slug,
                        license_status,
                        is_active,
                        notes
                    )
                    VALUES ($1, $2, 'pending', FALSE, $3)
                    RETURNING id, display_name
                    """,
                    display_name,
                    unique_slug(display_name),
                    notes,
                )
                await connection.execute(
                    """
                    INSERT INTO organization_users (
                        organization_id,
                        username,
                        username_normalized,
                        password_hash,
                        password_prefix
                    )
                    VALUES ($1, $2, $3, $4, $5)
                    """,
                    organization_row["id"],
                    username_clean,
                    username_normalized,
                    hash_secret(password, pepper=credential_pepper),
                    secret_public_prefix(password),
                )

        return {
            "organization_id": organization_row["id"],
            "display_name": organization_row["display_name"],
            "status": "pending",
        }

    async def authenticate_organization_user(
        self,
        *,
        username: str,
        password: str,
        credential_pepper: str = "",
    ) -> dict[str, Any] | None:
        await self._ensure_connected()
        username_normalized = normalize_username(username)
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                SELECT u.id AS user_id, u.organization_id, o.display_name,
                       u.username, u.password_hash, o.is_active AS org_is_active,
                       o.license_status, o.license_expires_at, u.is_active AS user_is_active
                FROM organization_users u
                JOIN organizations o ON o.id = u.organization_id
                WHERE u.username_normalized = $1
                """,
                username_normalized,
            )
            if row is None:
                return None

            if not verify_secret(password, row["password_hash"], pepper=credential_pepper):
                return None

            expires_at = _utc_iso(row["license_expires_at"])
            is_expired_by_date = expires_at is not None and expires_at < datetime.now(UTC)
            if row["license_status"] == "pending":
                return {
                    "is_pending": True,
                    "blocked_reason": "pending",
                    "display_name": row["display_name"],
                }
            if (
                not row["org_is_active"]
                or not row["user_is_active"]
                or row["license_status"] == "suspended"
            ):
                return {
                    "is_pending": True,
                    "blocked_reason": "suspended",
                    "display_name": row["display_name"],
                }
            if row["license_status"] == "expired" or is_expired_by_date:
                return {
                    "is_pending": True,
                    "blocked_reason": "expired",
                    "display_name": row["display_name"],
                }

            await connection.execute(
                "UPDATE organization_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1",
                row["user_id"],
            )

        data = dict(row)
        data.pop("password_hash")
        return data

    async def get_organization_access_status(self, organization_id: int) -> dict[str, Any] | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                SELECT id, display_name, is_active, license_status, license_expires_at
                FROM organizations
                WHERE id = $1
                """,
                organization_id,
            )
        return None if row is None else dict(row)

    async def list_organizations(self) -> list[dict[str, Any]]:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            rows = await connection.fetch(
                """
                SELECT o.id,
                       o.display_name,
                       o.license_status,
                       o.license_key_prefix,
                       o.license_started_at,
                       o.license_expires_at,
                       o.notes,
                       o.is_active,
                       o.created_at,
                       (
                           SELECT u.username FROM organization_users u
                           WHERE u.organization_id = o.id
                           ORDER BY u.id ASC LIMIT 1
                       ) AS username,
                       (
                           SELECT u.password_prefix FROM organization_users u
                           WHERE u.organization_id = o.id
                           ORDER BY u.id ASC LIMIT 1
                       ) AS password_prefix,
                       (
                           (SELECT COUNT(*) FROM candidates c WHERE c.organization_id = o.id)
                           + (
                               SELECT COUNT(*) FROM job_applications a
                               WHERE a.organization_id = o.id
                           )
                       ) AS candidate_count,
                       (
                           SELECT COUNT(*) FROM debate_results d WHERE d.organization_id = o.id
                       ) AS debate_count
                FROM organizations o
                ORDER BY o.created_at DESC
                """
            )
        return [dict(row) for row in rows]

    async def update_organization_license(
        self,
        *,
        organization_id: int,
        license_status: str,
        is_active: bool,
        license_expires_at: str | None = None,
        notes: str | None = None,
    ) -> dict[str, Any] | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                UPDATE organizations
                SET license_status = $2,
                    is_active = $3,
                    license_expires_at = NULLIF($4, '')::timestamp,
                    notes = COALESCE($5, notes)
                WHERE id = $1
                RETURNING id, display_name, license_status, is_active,
                          license_expires_at, notes
                """,
                organization_id,
                license_status,
                is_active,
                license_expires_at,
                notes,
            )
        return None if row is None else dict(row)

    async def rotate_organization_license_key(
        self,
        *,
        organization_id: int,
        credential_pepper: str = "",
    ) -> dict[str, Any] | None:
        await self._ensure_connected()
        license_key = generate_license_key()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                UPDATE organizations
                SET license_key_hash = $2,
                    license_key_prefix = $3,
                    license_started_at = CURRENT_TIMESTAMP
                WHERE id = $1
                RETURNING id, display_name, license_key_prefix
                """,
                organization_id,
                hash_secret(license_key, pepper=credential_pepper),
                secret_public_prefix(license_key),
            )
        if row is None:
            return None
        return {**dict(row), "license_key": license_key}

    async def reset_organization_password(
        self,
        *,
        organization_id: int,
        credential_pepper: str = "",
    ) -> dict[str, Any] | None:
        await self._ensure_connected()
        new_password = generate_password()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                UPDATE organization_users
                SET password_hash = $2, password_prefix = $3
                WHERE organization_id = $1
                RETURNING username
                """,
                organization_id,
                hash_secret(new_password, pepper=credential_pepper),
                secret_public_prefix(new_password),
            )
        if row is None:
            return None
        return {"username": row["username"], "password": new_password}

    async def delete_organization(self, organization_id: int) -> bool:
        """Deletes an organization and everything it owns (users, postings, applications,
        legacy candidates, debate results -- all ON DELETE CASCADE). Candidate portal
        identities (candidate_users/candidate_profiles) are not org-owned and are left
        untouched; only their application/link rows to this organization are removed.
        """
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            result = await connection.execute(
                "DELETE FROM organizations WHERE id = $1", organization_id
            )
        return result == "DELETE 1"

    async def create_job_posting(self, posting: JobPostingCreate) -> JobPosting:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                INSERT INTO job_postings (organization_id, title, description, deadline_at)
                VALUES ($1, $2, $3, NULLIF($4, '')::timestamp)
                RETURNING id, is_active
                """,
                posting.organization_id,
                posting.title,
                posting.description,
                posting.deadline_at,
            )
        return JobPosting(id=row["id"], is_active=row["is_active"], **posting.model_dump())

    async def get_posting_embedding(self, job_posting_id: int) -> list[float] | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            value = await connection.fetchval(
                "SELECT description_embedding FROM job_postings WHERE id = $1", job_posting_id
            )
        if value is None:
            return None
        # pgvector comes back as a "[0.1,0.2,...]" string via asyncpg (no native codec).
        return [float(x) for x in value.strip("[]").split(",")]

    async def set_posting_embedding(self, job_posting_id: int, embedding: list[float]) -> None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            await connection.execute(
                "UPDATE job_postings SET description_embedding = $2 WHERE id = $1",
                job_posting_id,
                to_pgvector(embedding),
            )

    async def list_records_missing_embeddings(
        self, *, include_all: bool = False
    ) -> dict[str, list[dict[str, Any]]]:
        """Returns candidate_profiles, legacy candidates, and job_postings needing embeddings."""
        await self._ensure_connected()
        profile_filter = "" if include_all else "cv_embedding IS NULL AND "
        posting_filter = "" if include_all else "description_embedding IS NULL AND "
        async with self._pool.acquire() as connection:
            profiles = await connection.fetch(
                f"""
                SELECT candidate_id, skills, raw_cv_text
                FROM candidate_profiles
                WHERE {profile_filter}btrim(raw_cv_text) <> ''
                """
            )
            candidates = await connection.fetch(
                f"""
                SELECT id, skills, raw_cv_text
                FROM candidates
                WHERE {profile_filter}btrim(raw_cv_text) <> ''
                """
            )
            postings = await connection.fetch(
                f"""
                SELECT id, description
                FROM job_postings
                WHERE {posting_filter}btrim(description) <> ''
                """
            )
        return {
            "profiles": [dict(r) for r in profiles],
            "candidates": [dict(r) for r in candidates],
            "postings": [dict(r) for r in postings],
        }

    async def list_candidate_applications_for_rescore(
        self, candidate_id: int
    ) -> list[dict[str, Any]]:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            rows = await connection.fetch(
                """
                SELECT a.job_posting_id, a.organization_id, j.description
                FROM job_applications a
                JOIN job_postings j ON j.id = a.job_posting_id
                WHERE a.candidate_id = $1
                """,
                candidate_id,
            )
        return [dict(row) for row in rows]

    async def update_profile_embedding(self, candidate_id: int, embedding: list[float]) -> None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            await connection.execute(
                "UPDATE candidate_profiles SET cv_embedding = $2::vector WHERE candidate_id = $1",
                candidate_id,
                to_pgvector(embedding),
            )

    async def update_candidate_embedding(self, candidate_id: int, embedding: list[float]) -> None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            await connection.execute(
                "UPDATE candidates SET cv_embedding = $2::vector WHERE id = $1",
                candidate_id,
                to_pgvector(embedding),
            )

    async def bulk_upsert_application_scores(
        self, *, job_posting_id: int, scored_candidates: list[dict[str, Any]]
    ) -> None:
        """Persists pre-LLM and hybrid explainability scores returned by PreLLMReranker."""
        if not scored_candidates:
            return
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            await connection.executemany(
                """
                UPDATE job_applications
                SET relevance_score = $3,
                    competency_score = $4,
                    pre_llm_score = $5,
                    dense_score = $6,
                    sparse_score = $7,
                    bm25_score = $8,
                    tfidf_score = $9,
                    matched_skills = $10::jsonb,
                    missing_skills = $11::jsonb,
                    score_computed_at = CURRENT_TIMESTAMP
                WHERE job_posting_id = $1 AND candidate_id = $2
                """,
                [
                    (
                        job_posting_id,
                        c["id"],
                        c.get("relevance_score"),
                        c.get("competency_score"),
                        c.get("pre_llm_score"),
                        c.get("dense_score"),
                        c.get("sparse_score"),
                        c.get("bm25_score"),
                        c.get("tfidf_score"),
                        json.dumps(c.get("matched_skills") or []),
                        json.dumps(c.get("missing_skills") or []),
                    )
                    for c in scored_candidates
                ],
            )

    async def upsert_application_score(
        self,
        *,
        job_posting_id: int,
        candidate_id: int,
        relevance_score: float | None,
        competency_score: float | None,
        pre_llm_score: float | None,
        dense_score: float | None = None,
        sparse_score: float | None = None,
        matched_skills: list[str] | None = None,
        missing_skills: list[str] | None = None,
    ) -> None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            await connection.execute(
                """
                UPDATE job_applications
                SET relevance_score = $3,
                    competency_score = $4,
                    pre_llm_score = $5,
                    dense_score = COALESCE($6, dense_score),
                    sparse_score = COALESCE($7, sparse_score),
                    matched_skills = COALESCE($8::jsonb, matched_skills),
                    missing_skills = COALESCE($9::jsonb, missing_skills),
                    score_computed_at = CURRENT_TIMESTAMP
                WHERE job_posting_id = $1 AND candidate_id = $2
                """,
                job_posting_id,
                candidate_id,
                relevance_score,
                competency_score,
                pre_llm_score,
                dense_score,
                sparse_score,
                None if matched_skills is None else json.dumps(matched_skills),
                None if missing_skills is None else json.dumps(missing_skills),
            )

    # Candidates for a posting can live in either of two tables: the legacy `candidates`
    # table (organization uploads CVs directly) or `job_applications` (candidate-portal
    # applications). Correlated subqueries avoid the row-multiplication that joining both
    # sources directly would cause when combined with a third join for debate_results.
    _JOB_POSTING_COUNT_COLUMNS = """
                       (
                           (SELECT COUNT(*) FROM candidates c WHERE c.job_posting_id = p.id)
                           + (SELECT COUNT(*) FROM job_applications a WHERE a.job_posting_id = p.id)
                       ) AS candidate_count,
                       (
                           (SELECT COUNT(DISTINCT d.candidate_id) FROM debate_results d
                            JOIN candidates c ON c.id = d.candidate_id
                            WHERE c.job_posting_id = p.id
                              AND d.organization_id = p.organization_id
                              AND (d.job_posting_id = p.id OR d.job_posting_id IS NULL))
                           + (SELECT COUNT(DISTINCT d.candidate_id) FROM debate_results d
                              JOIN job_applications a ON a.candidate_id = d.candidate_id
                              WHERE a.job_posting_id = p.id
                                AND d.organization_id = p.organization_id
                                AND d.job_posting_id = p.id)
                       ) AS debate_count
    """

    async def list_job_postings(self, organization_id: int) -> list[dict[str, Any]]:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            rows = await connection.fetch(
                f"""
                SELECT p.id, p.title, p.description, p.deadline_at, p.is_active, p.created_at,
                       {self._JOB_POSTING_COUNT_COLUMNS}
                FROM job_postings p
                WHERE p.organization_id = $1
                ORDER BY p.created_at DESC
                """,
                organization_id,
            )
        return [dict(row) for row in rows]

    async def get_job_posting(self, posting_id: int, organization_id: int) -> dict[str, Any] | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                f"""
                SELECT p.id, p.organization_id, p.title, p.description, p.deadline_at,
                       p.is_active, p.created_at,
                       {self._JOB_POSTING_COUNT_COLUMNS}
                FROM job_postings p
                WHERE p.id = $1 AND p.organization_id = $2
                """,
                posting_id,
                organization_id,
            )
        return None if row is None else dict(row)

    async def insert_candidate(self, candidate: CandidateCreate) -> Candidate:
        await self._ensure_connected()
        embedding = to_pgvector(candidate.cv_embedding) if candidate.cv_embedding else None
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                INSERT INTO candidates (
                    organization_id,
                    job_posting_id,
                    full_name,
                    university,
                    gpa,
                    current_class,
                    experience_years,
                    skills,
                    raw_cv_text,
                    cv_embedding,
                    source_path
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector, $11)
                RETURNING id
                """,
                candidate.organization_id,
                candidate.job_posting_id,
                candidate.full_name,
                candidate.university,
                candidate.gpa,
                candidate.current_class,
                candidate.experience_years,
                candidate.skills,
                candidate.raw_cv_text,
                embedding,
                candidate.source_path,
            )
        return Candidate(id=row["id"], **candidate.model_dump())

    async def get_candidate(
        self, candidate_id: int, organization_id: int, job_posting_id: int
    ) -> Candidate | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            # 1. Try candidate_profiles + job_applications
            row = await connection.fetchrow(
                """
                SELECT p.candidate_id AS id, a.organization_id, a.job_posting_id, u.full_name,
                       p.university, p.gpa, p.current_class, p.experience_years, p.skills,
                       p.raw_cv_text, p.source_path
                FROM job_applications a
                JOIN candidate_profiles p ON p.candidate_id = a.candidate_id
                JOIN candidate_users u ON u.id = a.candidate_id
                WHERE p.candidate_id = $1 AND a.organization_id = $2 AND a.job_posting_id = $3
                """,
                candidate_id,
                organization_id,
                job_posting_id,
            )
            if row is None:
                # 2. Fallback to legacy candidates table
                row = await connection.fetchrow(
                    """
                    SELECT id, organization_id, job_posting_id, full_name, university, gpa,
                           current_class, experience_years, skills, raw_cv_text, source_path
                    FROM candidates
                    WHERE id = $1 AND organization_id = $2 AND job_posting_id = $3
                    """,
                    candidate_id,
                    organization_id,
                    job_posting_id,
                )
        if row is None:
            return None
        return self._row_to_candidate(row)

    async def list_candidates(
        self,
        *,
        organization_id: int,
        job_posting_id: int,
        min_gpa: float | None = None,
        class_year: int | None = None,
        min_experience_years: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        await self._ensure_connected()
        app_where = ["a.organization_id = $1", "a.job_posting_id = $2"]
        cand_where = ["organization_id = $1", "job_posting_id = $2"]
        values: list[Any] = [organization_id, job_posting_id]
        param_index = 2

        if min_gpa is not None:
            param_index += 1
            app_where.append(f"p.gpa >= ${param_index}")
            cand_where.append(f"gpa >= ${param_index}")
            values.append(min_gpa)
        if class_year is not None:
            param_index += 1
            app_where.append(f"p.current_class = ${param_index}")
            cand_where.append(f"current_class = ${param_index}")
            values.append(class_year)
        if min_experience_years is not None:
            param_index += 1
            app_where.append(f"p.experience_years >= ${param_index}")
            cand_where.append(f"experience_years >= ${param_index}")
            values.append(min_experience_years)

        limit_index = param_index + 1
        offset_index = param_index + 2
        values.extend([limit, offset])

        sql = f"""
            SELECT id, full_name, university, gpa, current_class, experience_years,
                   skills, source_path, created_at,
                   relevance_score, competency_score, pre_llm_score,
                   dense_score, sparse_score, matched_skills, missing_skills,
                   candidate_source
            FROM (
                SELECT p.candidate_id AS id, u.full_name, p.university, p.gpa, p.current_class,
                       p.experience_years, p.skills, p.source_path, a.applied_at AS created_at,
                       a.relevance_score, a.competency_score, a.pre_llm_score,
                       a.dense_score, a.sparse_score, a.matched_skills, a.missing_skills,
                       'portal'::text AS candidate_source
                FROM job_applications a
                JOIN candidate_profiles p ON p.candidate_id = a.candidate_id
                JOIN candidate_users u ON u.id = a.candidate_id
                WHERE {" AND ".join(app_where)}

                UNION ALL

                SELECT id, full_name, university, gpa, current_class, experience_years,
                       skills, source_path, created_at,
                       NULL::double precision AS relevance_score,
                       NULL::double precision AS competency_score,
                       NULL::double precision AS pre_llm_score,
                       NULL::double precision AS dense_score,
                       NULL::double precision AS sparse_score,
                       '[]'::jsonb AS matched_skills,
                       '[]'::jsonb AS missing_skills,
                       'legacy'::text AS candidate_source
                FROM candidates
                WHERE {" AND ".join(cand_where)}
            ) combined
            ORDER BY created_at DESC
            LIMIT ${limit_index} OFFSET ${offset_index}
        """

        async with self._pool.acquire() as connection:
            rows = await connection.fetch(sql, *values)
        return [dict(row) for row in rows]

    async def evaluated_candidate_ids(
        self, organization_id: int, job_posting_id: int
    ) -> set[int]:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            rows = await connection.fetch(
                """
                SELECT DISTINCT candidate_id FROM debate_results
                WHERE organization_id = $1 AND job_posting_id = $2
                """,
                organization_id,
                job_posting_id,
            )
        return {row["candidate_id"] for row in rows}

    async def latest_debate_result(
        self, candidate_id: int, organization_id: int, job_posting_id: int | None = None
    ) -> dict[str, Any] | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            if job_posting_id is not None:
                row = await connection.fetchrow(
                    """
                    SELECT id, optimist_score, optimist_arguments, pessimist_score,
                           pessimist_arguments, final_score, arbitrator_rationale,
                           is_selected, created_at, pre_llm_score, relevance_score,
                           competency_score, dense_score, sparse_score,
                           matched_skills, missing_skills, evidence_quotes, grounding_score
                    FROM debate_results
                    WHERE candidate_id = $1
                      AND organization_id = $2
                      AND (job_posting_id = $3 OR job_posting_id IS NULL)
                    ORDER BY (job_posting_id = $3) DESC NULLS LAST, created_at DESC
                    LIMIT 1
                    """,
                    candidate_id,
                    organization_id,
                    job_posting_id,
                )
            else:
                row = await connection.fetchrow(
                    """
                    SELECT id, optimist_score, optimist_arguments, pessimist_score,
                           pessimist_arguments, final_score, arbitrator_rationale,
                           is_selected, created_at, pre_llm_score, relevance_score,
                           competency_score, dense_score, sparse_score,
                           matched_skills, missing_skills, evidence_quotes, grounding_score
                    FROM debate_results
                    WHERE candidate_id = $1 AND organization_id = $2
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    candidate_id,
                    organization_id,
                )
        return None if row is None else dict(row)

    async def reset_posting_evaluations(
        self, *, organization_id: int, job_posting_id: int
    ) -> dict[str, int]:
        """Wipes every LLM evaluation, interview schedule, notification, and decision for a
        posting, resetting all its applications back to 'applied'."""
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            async with connection.transaction():
                deleted_notifications = await connection.execute(
                    """
                    DELETE FROM candidate_notifications
                    WHERE organization_id = $1 AND job_posting_id = $2
                    """,
                    organization_id,
                    job_posting_id,
                )
                await connection.execute(
                    """
                    DELETE FROM interview_schedules
                    WHERE organization_id = $1 AND job_posting_id = $2
                    """,
                    organization_id,
                    job_posting_id,
                )
                deleted_debates = await connection.execute(
                    """
                    DELETE FROM debate_results d
                    WHERE d.organization_id = $1
                      AND (
                          d.job_posting_id = $2
                          OR (
                              d.job_posting_id IS NULL AND (
                                  d.candidate_id IN (
                                      SELECT id FROM candidates
                                      WHERE organization_id = $1 AND job_posting_id = $2
                                  )
                                  OR d.candidate_id IN (
                                      SELECT candidate_id FROM job_applications
                                      WHERE organization_id = $1 AND job_posting_id = $2
                                  )
                              )
                          )
                      )
                    """,
                    organization_id,
                    job_posting_id,
                )
                reset_applications = await connection.execute(
                    """
                    UPDATE job_applications SET status = 'applied'
                    WHERE organization_id = $1 AND job_posting_id = $2
                    """,
                    organization_id,
                    job_posting_id,
                )

        def _count(result: str) -> int:
            return int(result.split()[-1]) if result.split()[-1].isdigit() else 0

        return {
            "notifications_deleted": _count(deleted_notifications),
            "debates_deleted": _count(deleted_debates),
            "applications_reset": _count(reset_applications),
        }

    async def finalize_shortlist(
        self,
        *,
        organization_id: int,
        job_posting_id: int,
        interview_slots: int,
    ) -> dict[str, Any]:
        """Locks in the interview shortlist: the top `interview_slots` evaluated
        candidates (by final_score) become 'selected', the rest that were evaluated
        become 'rejected', and applicants who never reached the LLM debate stage at
        all also become 'rejected'. A candidate_notifications row is written for every
        application whose status actually changes, so re-clicking after evaluating
        more candidates doesn't spam duplicate notifications.
        """
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            async with connection.transaction():
                evaluated = await connection.fetch(
                    f"""
                    SELECT *
                    FROM (
                        SELECT DISTINCT ON (a.id)
                               a.id AS application_id, a.candidate_id, a.status,
                               d.id AS debate_result_id, d.final_score, d.created_at,
                               {self._RANKING_SCORE_EXPR}
                        FROM debate_results d
                        JOIN job_applications a ON a.candidate_id = d.candidate_id
                        WHERE d.organization_id = $1
                          AND a.job_posting_id = $2
                          AND d.job_posting_id = $2
                        ORDER BY a.id, d.created_at DESC
                    ) deduped
                    ORDER BY ranking_score DESC, created_at DESC
                    """,
                    organization_id,
                    job_posting_id,
                )
                selected_ids = {row["application_id"] for row in evaluated[:interview_slots]}

                not_evaluated = await connection.fetch(
                    """
                    SELECT a.id AS application_id, a.candidate_id, a.status
                    FROM job_applications a
                    WHERE a.organization_id = $1 AND a.job_posting_id = $2
                      AND NOT EXISTS (
                          SELECT 1 FROM debate_results d
                          WHERE d.organization_id = a.organization_id
                                AND d.candidate_id = a.candidate_id
                                AND d.job_posting_id = a.job_posting_id
                      )
                    """,
                    organization_id,
                    job_posting_id,
                )

                selected_count = 0
                rejected_post_llm_count = 0
                rejected_pre_llm_count = 0
                notifications_sent = 0

                for row in evaluated:
                    new_status = "selected" if row["application_id"] in selected_ids else "rejected"
                    if new_status == "selected":
                        selected_count += 1
                    else:
                        rejected_post_llm_count += 1
                    if row["status"] == new_status:
                        continue
                    await connection.execute(
                        "UPDATE job_applications SET status = $2 WHERE id = $1",
                        row["application_id"],
                        new_status,
                    )
                    if new_status == "selected":
                        title = "Mülakat aşamasına geçtiniz"
                        message = (
                            "Tebrikler! Başvurunuz değerlendirildi ve bu pozisyon için "
                            "mülakat aşamasına geçtiniz. Kuruluş sizinle iletişime geçecektir."
                        )
                    else:
                        title = "Başvurunuz değerlendirildi"
                        message = (
                            "Başvurunuz yapay zeka ajanları tarafından değerlendirildi, ancak bu "
                            "pozisyon için şu an sizinle ilerlemiyoruz. Değerlendirme raporunun "
                            "tamamını bu bildirimden inceleyebilirsiniz."
                        )
                    await connection.execute(
                        """
                        INSERT INTO candidate_notifications
                            (candidate_id, job_posting_id, organization_id, type, title,
                             message, debate_result_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        """,
                        row["candidate_id"],
                        job_posting_id,
                        organization_id,
                        "selected" if new_status == "selected" else "rejected_post_llm",
                        title,
                        message,
                        row["debate_result_id"],
                    )
                    notifications_sent += 1

                for row in not_evaluated:
                    rejected_pre_llm_count += 1
                    if row["status"] == "rejected":
                        continue
                    await connection.execute(
                        "UPDATE job_applications SET status = 'rejected' WHERE id = $1",
                        row["application_id"],
                    )
                    await connection.execute(
                        """
                        INSERT INTO candidate_notifications
                            (candidate_id, job_posting_id, organization_id, type, title, message)
                        VALUES ($1, $2, $3, 'rejected_pre_llm', $4, $5)
                        """,
                        row["candidate_id"],
                        job_posting_id,
                        organization_id,
                        "Başvurunuz değerlendirildi",
                        "Başvurunuz ilk elemede incelendi; profiliniz bu ilanın aradığı "
                        "niteliklerle yeterli ölçüde örtüşmediği için bu pozisyon için "
                        "sizinle ilerlemiyoruz. Başka ilanlara başvurmaya devam edebilirsiniz.",
                    )
                    notifications_sent += 1

        return {
            "selected_count": selected_count,
            "rejected_post_llm_count": rejected_post_llm_count,
            "rejected_pre_llm_count": rejected_pre_llm_count,
            "notifications_sent": notifications_sent,
        }

    async def list_candidate_notifications(self, candidate_id: int) -> list[dict[str, Any]]:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            rows = await connection.fetch(
                """
                SELECT n.id, n.type, n.title, n.message, n.is_read, n.created_at,
                       j.title AS job_title, o.display_name AS organization_name,
                       d.optimist_score, d.optimist_arguments, d.pessimist_score,
                       d.pessimist_arguments, d.final_score, d.arbitrator_rationale,
                       i.id AS interview_schedule_id, i.proposed_at AS interview_proposed_at,
                       i.location_or_link AS interview_location_or_link,
                       i.notes AS interview_notes, i.status AS interview_status
                FROM candidate_notifications n
                LEFT JOIN job_postings j ON j.id = n.job_posting_id
                LEFT JOIN organizations o ON o.id = n.organization_id
                LEFT JOIN debate_results d ON d.id = n.debate_result_id
                LEFT JOIN interview_schedules i ON i.id = n.interview_schedule_id
                WHERE n.candidate_id = $1
                ORDER BY n.created_at DESC
                """,
                candidate_id,
            )
        items = []
        for row in rows:
            item = dict(row)
            if item.get("interview_proposed_at") is not None:
                item["interview_proposed_at"] = _utc_iso(item["interview_proposed_at"])
            items.append(item)
        return items

    async def create_candidate_notification(
        self,
        *,
        candidate_id: int,
        job_posting_id: int | None,
        organization_id: int | None,
        type: str,
        title: str,
        message: str,
        debate_result_id: int | None = None,
        interview_schedule_id: int | None = None,
    ) -> None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            await connection.execute(
                """
                INSERT INTO candidate_notifications
                    (candidate_id, job_posting_id, organization_id, type, title, message,
                     debate_result_id, interview_schedule_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                candidate_id,
                job_posting_id,
                organization_id,
                type,
                title,
                message,
                debate_result_id,
                interview_schedule_id,
            )

    async def upsert_interview_schedule(
        self,
        *,
        job_posting_id: int,
        candidate_id: int,
        organization_id: int,
        proposed_at: str,
        location_or_link: str | None,
        notes: str | None,
    ) -> dict[str, Any]:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                INSERT INTO interview_schedules
                    (job_posting_id, candidate_id, organization_id, proposed_at,
                     location_or_link, notes)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (job_posting_id, candidate_id) DO UPDATE
                SET proposed_at = EXCLUDED.proposed_at,
                    location_or_link = EXCLUDED.location_or_link,
                    notes = EXCLUDED.notes,
                    status = 'proposed',
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id, job_posting_id, candidate_id, organization_id, proposed_at,
                          location_or_link, notes, status, created_at, updated_at
                """,
                job_posting_id,
                candidate_id,
                organization_id,
                datetime.fromisoformat(proposed_at.replace("Z", "+00:00")).astimezone(UTC),
                location_or_link,
                notes,
            )
        out = dict(row)
        out["proposed_at"] = _utc_iso(out.get("proposed_at"))
        return out

    async def get_interview_schedule(
        self, job_posting_id: int, candidate_id: int
    ) -> dict[str, Any] | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                SELECT id, job_posting_id, candidate_id, organization_id, proposed_at,
                       location_or_link, notes, status, created_at, updated_at
                FROM interview_schedules
                WHERE job_posting_id = $1 AND candidate_id = $2
                """,
                job_posting_id,
                candidate_id,
            )
        if row is None:
            return None
        out = dict(row)
        out["proposed_at"] = _utc_iso(out.get("proposed_at"))
        return out

    async def respond_to_interview(
        self, interview_id: int, candidate_id: int, status: str
    ) -> dict[str, Any] | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                UPDATE interview_schedules
                SET status = $3, updated_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND candidate_id = $2
                RETURNING id, job_posting_id, candidate_id, organization_id, proposed_at,
                          location_or_link, notes, status, created_at, updated_at
                """,
                interview_id,
                candidate_id,
                status,
            )
        if row is None:
            return None
        out = dict(row)
        out["proposed_at"] = _utc_iso(out.get("proposed_at"))
        return out

    async def get_application_status(
        self, candidate_id: int, organization_id: int, job_posting_id: int
    ) -> str | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            return await connection.fetchval(
                """
                SELECT status FROM job_applications
                WHERE candidate_id = $1 AND organization_id = $2 AND job_posting_id = $3
                """,
                candidate_id,
                organization_id,
                job_posting_id,
            )

    async def mark_notification_read(self, notification_id: int, candidate_id: int) -> bool:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            result = await connection.execute(
                """
                UPDATE candidate_notifications SET is_read = TRUE
                WHERE id = $1 AND candidate_id = $2
                """,
                notification_id,
                candidate_id,
            )
        return "UPDATE 1" in result

    async def search_candidates(
        self,
        *,
        organization_id: int,
        job_posting_id: int,
        query_embedding: list[float],
        min_gpa: float | None = None,
        class_year: int | None = None,
        min_experience_years: int | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        await self._ensure_connected()
        where_clauses = ["organization_id = $3", "job_posting_id = $4", "cv_embedding IS NOT NULL"]
        values: list[Any] = [to_pgvector(query_embedding), limit, organization_id, job_posting_id]
        param_index = 4

        if min_gpa is not None:
            param_index += 1
            where_clauses.append(f"gpa >= ${param_index}")
            values.append(min_gpa)
        if class_year is not None:
            param_index += 1
            where_clauses.append(f"current_class = ${param_index}")
            values.append(class_year)
        if min_experience_years is not None:
            param_index += 1
            where_clauses.append(f"experience_years >= ${param_index}")
            values.append(min_experience_years)

        sql = f"""
            SELECT id, full_name, university, gpa, current_class, experience_years,
                   skills, raw_cv_text, source_path,
                   1 - (cv_embedding <=> $1::vector) AS similarity
            FROM candidates
            WHERE {" AND ".join(where_clauses)}
            ORDER BY cv_embedding <=> $1::vector
            LIMIT $2
        """

        async with self._pool.acquire() as connection:
            async with connection.transaction():
                # ivfflat index is built with lists=100; default probes=1 only scans
                # 1/100 of the clusters and can silently miss true matches at our
                # current data volume. probes=100 scans every cluster (exact recall,
                # negligible cost at this row count). Supabase free tier's 32MB
                # maintenance_work_mem cap blocks rebuilding the index with a lower
                # lists value, so this is tuned at query time instead.
                await connection.execute("SET LOCAL ivfflat.probes = 100")
                rows = await connection.fetch(sql, *values)
        return [dict(row) for row in rows]

    @staticmethod
    def _build_or_tsquery(query_text: str) -> str:
        """Builds an OR-joined Postgres tsquery string preserving Turkish alphanumeric terms."""
        lowered = tr_lower(query_text)
        tokens = re.findall(r"[0-9a-zçğıöşü]{2,}", lowered)
        seen: dict[str, None] = {}
        for tok in tokens:
            if tok not in seen:
                seen[tok] = None
            if len(seen) >= 48:
                break
        return " | ".join(seen.keys())

    async def hybrid_search_candidates(
        self,
        *,
        organization_id: int,
        job_posting_id: int,
        query_text: str,
        query_embedding: list[float],
        min_gpa: float | None = None,
        class_year: int | None = None,
        min_experience_years: int | None = None,
        limit: int = 2000,
    ) -> list[dict[str, Any]]:
        """
        Hybrid search combining PostgreSQL Full-Text Search (OR-tsquery) and pgvector
        Cosine Similarity across both candidate-portal applications and org-uploaded CVs.
        """
        await self._ensure_connected()
        or_tsquery = self._build_or_tsquery(query_text)
        cand_where = ["organization_id = $3", "job_posting_id = $4"]
        app_where = ["a.organization_id = $3", "a.job_posting_id = $4"]
        values: list[Any] = [
            to_pgvector(query_embedding),
            limit,
            organization_id,
            job_posting_id,
            or_tsquery,
        ]
        param_index = 5

        if min_gpa is not None:
            param_index += 1
            cand_where.append(f"gpa >= ${param_index}")
            app_where.append(f"p.gpa >= ${param_index}")
            values.append(min_gpa)
        if class_year is not None:
            param_index += 1
            cand_where.append(f"current_class = ${param_index}")
            app_where.append(f"p.current_class = ${param_index}")
            values.append(class_year)
        if min_experience_years is not None:
            param_index += 1
            cand_where.append(f"experience_years >= ${param_index}")
            app_where.append(f"p.experience_years >= ${param_index}")
            values.append(min_experience_years)

        vec_sim_expr_p = (
            "CASE WHEN p.cv_embedding IS NOT NULL "
            "THEN (1 - (p.cv_embedding <=> $1::vector)) ELSE 0.0 END"
        )
        fts_rank_expr_p = (
            "CASE WHEN $5 <> '' AND p.fts IS NOT NULL "
            "THEN ts_rank_cd(p.fts, to_tsquery('simple', $5)) ELSE 0.0 END"
        )
        vec_sim_expr_c = (
            "CASE WHEN cv_embedding IS NOT NULL "
            "THEN (1 - (cv_embedding <=> $1::vector)) ELSE 0.0 END"
        )
        fts_rank_expr_c = (
            "CASE WHEN $5 <> '' AND fts IS NOT NULL "
            "THEN ts_rank_cd(fts, to_tsquery('simple', $5)) ELSE 0.0 END"
        )

        combined_sql = f"""
            SELECT id, full_name, university, gpa, current_class, experience_years,
                   skills, raw_cv_text, source_path, vector_similarity, bm25_rank,
                   similarity, candidate_source
            FROM (
                SELECT p.candidate_id AS id, u.full_name, p.university, p.gpa, p.current_class,
                       p.experience_years, p.skills, p.raw_cv_text, p.source_path,
                       ({vec_sim_expr_p}) AS vector_similarity,
                       ({fts_rank_expr_p}) AS bm25_rank,
                       (({vec_sim_expr_p}) * 0.7 + LEAST(({fts_rank_expr_p}), 1.0) * 0.3)
                           AS similarity,
                       'portal'::text AS candidate_source
                FROM job_applications a
                JOIN candidate_profiles p ON p.candidate_id = a.candidate_id
                JOIN candidate_users u ON u.id = a.candidate_id
                WHERE {" AND ".join(app_where)}

                UNION ALL

                SELECT id, full_name, university, gpa, current_class, experience_years,
                       skills, raw_cv_text, source_path,
                       ({vec_sim_expr_c}) AS vector_similarity,
                       ({fts_rank_expr_c}) AS bm25_rank,
                       (({vec_sim_expr_c}) * 0.7 + LEAST(({fts_rank_expr_c}), 1.0) * 0.3)
                           AS similarity,
                       'legacy'::text AS candidate_source
                FROM candidates
                WHERE {" AND ".join(cand_where)}
            ) pool
            ORDER BY vector_similarity DESC, bm25_rank DESC
            LIMIT $2
        """

        async with self._pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute("SET LOCAL ivfflat.probes = 100")
                rows = await connection.fetch(combined_sql, *values)
        return [dict(row) for row in rows]

    async def save_debate_result(
        self,
        result: DebateResult,
        *,
        job_posting_id: int | None = None,
        pre_llm_score: float | None = None,
        relevance_score: float | None = None,
        competency_score: float | None = None,
        dense_score: float | None = None,
        sparse_score: float | None = None,
        matched_skills: list[str] | None = None,
        missing_skills: list[str] | None = None,
    ) -> int:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                INSERT INTO debate_results (
                    organization_id,
                    candidate_id,
                    optimist_score,
                    optimist_arguments,
                    pessimist_score,
                    pessimist_arguments,
                    final_score,
                    arbitrator_rationale,
                    is_selected,
                    job_posting_id,
                    pre_llm_score,
                    relevance_score,
                    competency_score,
                    dense_score,
                    sparse_score,
                    matched_skills,
                    missing_skills,
                    evidence_quotes,
                    grounding_score
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                    $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19
                )
                RETURNING id
                """,
                result.organization_id,
                result.candidate_id,
                result.optimist_score,
                result.optimist_arguments,
                result.pessimist_score,
                result.pessimist_arguments,
                result.final_score,
                result.arbitrator_rationale,
                result.is_selected,
                job_posting_id,
                pre_llm_score,
                relevance_score,
                competency_score,
                dense_score,
                sparse_score,
                json.dumps(matched_skills or []),
                json.dumps(missing_skills or []),
                json.dumps(result.evidence_quotes or []),
                result.grounding_score,
            )
        return row["id"]

    async def get_candidate_similarity(
        self,
        *,
        candidate_id: int,
        organization_id: int,
        job_posting_id: int,
        query_embedding: list[float],
    ) -> float | None:
        """Cosine similarity between a single candidate's CV embedding and a query
        embedding, used to back-fill pre-LLM scores for the ad-hoc single-candidate
        debate button (which doesn't go through the full ranking pipeline)."""
        await self._ensure_connected()
        embedding_pg = to_pgvector(query_embedding)
        async with self._pool.acquire() as connection:
            value = await connection.fetchval(
                """
                SELECT 1 - (p.cv_embedding <=> $1::vector) AS similarity
                FROM job_applications a
                JOIN candidate_profiles p ON p.candidate_id = a.candidate_id
                WHERE p.candidate_id = $2 AND a.organization_id = $3 AND a.job_posting_id = $4
                      AND p.cv_embedding IS NOT NULL
                """,
                embedding_pg,
                candidate_id,
                organization_id,
                job_posting_id,
            )
            if value is None:
                value = await connection.fetchval(
                    """
                    SELECT 1 - (cv_embedding <=> $1::vector) AS similarity
                    FROM candidates
                    WHERE id = $2 AND organization_id = $3 AND job_posting_id = $4
                          AND cv_embedding IS NOT NULL
                    """,
                    embedding_pg,
                    candidate_id,
                    organization_id,
                    job_posting_id,
                )
        return float(value) if value is not None else None

    # Arbitrator scores cluster on round multiples of 5/10 (an LLM habit that no prompt
    # instruction fully broke) so many candidates land on an identical final_score --
    # with only that number visible, a rejected candidate tied with a selected one looks
    # arbitrarily/unfairly cut. ranking_score blends in pre_llm_score (embedding fit +
    # competency, a continuous number with real entropy) as a small, honest correction:
    # it's an actual second signal, not manufactured precision, and it's what decides
    # ties in both display ordering and finalize's top-N selection.
    _RANKING_SCORE_EXPR = """
        CASE WHEN d.pre_llm_score IS NULL THEN d.final_score
             ELSE ROUND((d.final_score * 0.85 + d.pre_llm_score * 100 * 0.15)::numeric, 2)
        END AS ranking_score
    """

    async def top_results(
        self, organization_id: int, job_posting_id: int, limit: int = 5
    ) -> list[dict[str, Any]]:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            rows = await connection.fetch(
                f"""
                SELECT *
                FROM (
                    SELECT DISTINCT ON (candidate_source, candidate_id)
                           candidate_id, full_name, university,
                           final_score, arbitrator_rationale, is_selected,
                           pre_llm_score, relevance_score, competency_score,
                           dense_score, sparse_score, matched_skills, missing_skills,
                           evidence_quotes, grounding_score,
                           application_status, ranking_score, created_at
                    FROM (
                        SELECT 'portal'::text AS candidate_source,
                               p.candidate_id, u.full_name, p.university,
                               d.final_score, d.arbitrator_rationale, d.is_selected,
                               d.pre_llm_score, d.relevance_score, d.competency_score,
                               d.dense_score, d.sparse_score, d.matched_skills, d.missing_skills,
                               d.evidence_quotes, d.grounding_score,
                               a.status AS application_status,
                               {self._RANKING_SCORE_EXPR},
                               d.created_at
                        FROM debate_results d
                        JOIN job_applications a ON a.candidate_id = d.candidate_id
                        JOIN candidate_profiles p ON p.candidate_id = a.candidate_id
                        JOIN candidate_users u ON u.id = a.candidate_id
                        WHERE d.organization_id = $1
                          AND a.job_posting_id = $2
                          AND d.job_posting_id = $2

                        UNION ALL

                        SELECT 'legacy'::text AS candidate_source,
                               c.id AS candidate_id, c.full_name, c.university,
                               d.final_score, d.arbitrator_rationale, d.is_selected,
                               d.pre_llm_score, d.relevance_score, d.competency_score,
                               d.dense_score, d.sparse_score, d.matched_skills, d.missing_skills,
                               d.evidence_quotes, d.grounding_score,
                               NULL::VARCHAR AS application_status,
                               {self._RANKING_SCORE_EXPR},
                               d.created_at
                        FROM debate_results d
                        JOIN candidates c ON c.id = d.candidate_id
                        WHERE d.organization_id = $1
                          AND c.job_posting_id = $2
                          AND (d.job_posting_id = $2 OR d.job_posting_id IS NULL)
                    ) all_rows
                    ORDER BY candidate_source, candidate_id, created_at DESC
                ) deduped
                ORDER BY ranking_score DESC, created_at DESC
                LIMIT $3
                """,
                organization_id,
                job_posting_id,
                limit,
            )
        return [dict(row) for row in rows]

    async def create_candidate_user(
        self,
        *,
        email: str,
        password: str,
        full_name: str,
        credential_pepper: str = "",
        is_guest: bool = False,
    ) -> dict[str, Any]:
        await self._ensure_connected()
        email_clean = email.strip().lower()
        password_hash = hash_secret(password, pepper=credential_pepper)
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                INSERT INTO candidate_users (email, password_hash, full_name, is_guest)
                VALUES ($1, $2, $3, $4)
                RETURNING id, email, full_name, is_guest, created_at
                """,
                email_clean,
                password_hash,
                full_name,
                is_guest,
            )
        return dict(row)

    async def authenticate_candidate_user(
        self,
        *,
        email: str,
        password: str,
        credential_pepper: str = "",
    ) -> dict[str, Any] | None:
        await self._ensure_connected()
        email_clean = email.strip().lower()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                SELECT id, email, password_hash, full_name, is_guest, created_at
                FROM candidate_users
                WHERE email = $1
                """,
                email_clean,
            )
            if row is None:
                return None
            if not verify_secret(password, row["password_hash"], pepper=credential_pepper):
                return None

        data = dict(row)
        data.pop("password_hash", None)
        return data

    async def get_candidate_user(self, candidate_id: int) -> dict[str, Any] | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                SELECT id, email, full_name, is_guest, created_at
                FROM candidate_users
                WHERE id = $1
                """,
                candidate_id,
            )
        return None if row is None else dict(row)

    async def save_candidate_profile(
        self,
        *,
        candidate_id: int,
        university: str | None = None,
        gpa: float | None = None,
        current_class: int = 5,
        experience_years: int = 0,
        skills: list[str] | None = None,
        raw_cv_text: str = "",
        cv_embedding: list[float] | None = None,
        source_path: str | None = None,
    ) -> dict[str, Any]:
        await self._ensure_connected()
        skills = skills or []
        embedding_pg = to_pgvector(cv_embedding) if cv_embedding else None

        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                INSERT INTO candidate_profiles (
                    candidate_id, university, gpa, current_class,
                    experience_years, skills, raw_cv_text, cv_embedding, source_path, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, CURRENT_TIMESTAMP)
                ON CONFLICT (candidate_id) DO UPDATE SET
                    university = EXCLUDED.university,
                    gpa = EXCLUDED.gpa,
                    current_class = EXCLUDED.current_class,
                    experience_years = EXCLUDED.experience_years,
                    skills = EXCLUDED.skills,
                    raw_cv_text = EXCLUDED.raw_cv_text,
                    cv_embedding = COALESCE(
                        EXCLUDED.cv_embedding, candidate_profiles.cv_embedding
                    ),
                    source_path = EXCLUDED.source_path,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING candidate_id, university, gpa, current_class,
                          experience_years, skills, updated_at
                """,
                candidate_id,
                university,
                gpa,
                current_class,
                experience_years,
                skills,
                raw_cv_text,
                embedding_pg,
                source_path,
            )
        return dict(row)

    async def get_candidate_profile(self, candidate_id: int) -> dict[str, Any] | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                SELECT p.candidate_id, u.full_name, u.email, p.university, p.gpa,
                       p.current_class, p.experience_years, p.skills, p.raw_cv_text,
                       p.source_path, p.updated_at,
                       (p.cv_embedding IS NOT NULL) AS has_embedding
                FROM candidate_users u
                LEFT JOIN candidate_profiles p ON p.candidate_id = u.id
                WHERE u.id = $1
                """,
                candidate_id,
            )
        return None if row is None else dict(row)

    async def create_job_application(
        self,
        *,
        job_posting_id: int,
        candidate_id: int,
        organization_id: int,
    ) -> dict[str, Any]:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                INSERT INTO job_applications (job_posting_id, candidate_id, organization_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (job_posting_id, candidate_id)
                DO UPDATE SET status = job_applications.status
                RETURNING id, job_posting_id, candidate_id, organization_id, status, applied_at
                """,
                job_posting_id,
                candidate_id,
                organization_id,
            )
        return dict(row)

    async def list_open_job_postings(self) -> list[dict[str, Any]]:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            rows = await connection.fetch(
                """
                SELECT j.id, j.organization_id, o.display_name AS organization_name,
                       j.title, j.description, j.deadline_at, j.created_at
                FROM job_postings j
                JOIN organizations o ON o.id = j.organization_id
                WHERE j.is_active = TRUE
                  AND o.is_active = TRUE
                  AND o.license_status IN ('active', 'trial')
                  AND (o.license_expires_at IS NULL OR o.license_expires_at >= CURRENT_TIMESTAMP)
                  AND (j.deadline_at IS NULL OR j.deadline_at >= CURRENT_TIMESTAMP)
                ORDER BY j.created_at DESC
                """
            )
        return [dict(row) for row in rows]

    async def get_open_job_posting(self, posting_id: int) -> dict[str, Any] | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                SELECT j.id, j.organization_id, o.display_name AS organization_name,
                       j.title, j.description, j.deadline_at, j.created_at
                FROM job_postings j
                JOIN organizations o ON o.id = j.organization_id
                WHERE j.id = $1
                  AND j.is_active = TRUE
                  AND o.is_active = TRUE
                  AND o.license_status IN ('active', 'trial')
                  AND (o.license_expires_at IS NULL OR o.license_expires_at >= CURRENT_TIMESTAMP)
                  AND (j.deadline_at IS NULL OR j.deadline_at >= CURRENT_TIMESTAMP)
                """,
                posting_id,
            )
        return None if row is None else dict(row)

    async def list_candidate_applications(self, candidate_id: int) -> list[dict[str, Any]]:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            rows = await connection.fetch(
                """
                SELECT a.id AS application_id, a.job_posting_id, j.title AS job_title,
                       o.display_name AS organization_name, a.status, a.applied_at
                FROM job_applications a
                JOIN job_postings j ON j.id = a.job_posting_id
                JOIN organizations o ON o.id = a.organization_id
                WHERE a.candidate_id = $1
                ORDER BY a.applied_at DESC
                """,
                candidate_id,
            )
        return [dict(row) for row in rows]

    async def withdraw_job_application(self, job_posting_id: int, candidate_id: int) -> bool:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            result = await connection.execute(
                """
                DELETE FROM job_applications
                WHERE job_posting_id = $1 AND candidate_id = $2 AND status = 'applied'
                """,
                job_posting_id,
                candidate_id,
            )
            return "DELETE 1" in result

    async def has_active_application(self, candidate_id: int) -> bool:
        """job_applications rows are deleted outright on withdraw, so any row here
        is an active application (never a stale 'withdrawn' status to filter out)."""
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchval(
                "SELECT 1 FROM job_applications WHERE candidate_id = $1 LIMIT 1",
                candidate_id,
            )
        return row is not None

    async def delete_candidate_profile(self, candidate_id: int) -> bool:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            result = await connection.execute(
                """
                DELETE FROM candidate_profiles
                WHERE candidate_id = $1
                """,
                candidate_id,
            )
            return "DELETE 1" in result

    async def update_job_posting(
        self,
        *,
        job_posting_id: int,
        organization_id: int,
        title: str,
        description: str,
        deadline_at: str | None = None,
    ) -> dict[str, Any] | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            existing_desc = await connection.fetchval(
                "SELECT description FROM job_postings WHERE id = $1 AND organization_id = $2",
                job_posting_id,
                organization_id,
            )
            if existing_desc is None:
                return None
            description_changed = existing_desc.strip() != description.strip()
            await connection.execute(
                """
                UPDATE job_postings
                SET title = $3,
                    description = $4,
                    deadline_at = NULLIF($5, '')::timestamp,
                    description_embedding = CASE
                        WHEN $6 THEN NULL
                        ELSE description_embedding
                    END
                WHERE id = $1 AND organization_id = $2
                """,
                job_posting_id,
                organization_id,
                title,
                description,
                deadline_at,
                description_changed,
            )
        return await self.get_job_posting(job_posting_id, organization_id)

    async def delete_job_posting(self, job_posting_id: int, organization_id: int) -> bool:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            result = await connection.execute(
                """
                DELETE FROM job_postings
                WHERE id = $1 AND organization_id = $2
                """,
                job_posting_id,
                organization_id,
            )
            return "DELETE 1" in result

    async def toggle_job_posting_status(
        self, job_posting_id: int, organization_id: int, is_active: bool
    ) -> bool:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            result = await connection.execute(
                """
                UPDATE job_postings
                SET is_active = $3
                WHERE id = $1 AND organization_id = $2
                """,
                job_posting_id,
                organization_id,
                is_active,
            )
            return "UPDATE 1" in result

    async def record_mistral_usage(
        self,
        *,
        model: str,
        endpoint: str,
        organization_id: int | None,
        prompt_tokens: int | None,
        completion_tokens: int | None,
        total_tokens: int | None,
        success: bool,
    ) -> None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            await connection.execute(
                """
                INSERT INTO mistral_api_usage
                    (model, endpoint, organization_id, prompt_tokens, completion_tokens,
                     total_tokens, success)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                model,
                endpoint,
                organization_id,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                success,
            )

    async def get_mistral_usage_summary(self, *, since_hours: int = 24) -> dict[str, Any]:
        """Backs the admin usage panel: per-model call/error/token counts for the window,
        overall totals, and the most recent calls for a live-ish feed."""
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            by_model = await connection.fetch(
                """
                SELECT model,
                       COUNT(*) AS call_count,
                       COUNT(*) FILTER (WHERE NOT success) AS error_count,
                       COALESCE(SUM(total_tokens), 0) AS total_tokens
                FROM mistral_api_usage
                WHERE created_at >= NOW() - ($1 * INTERVAL '1 hour')
                GROUP BY model
                ORDER BY call_count DESC
                """,
                since_hours,
            )
            totals = await connection.fetchrow(
                """
                SELECT COUNT(*) AS call_count,
                       COUNT(*) FILTER (WHERE NOT success) AS error_count,
                       COALESCE(SUM(total_tokens), 0) AS total_tokens
                FROM mistral_api_usage
                WHERE created_at >= NOW() - ($1 * INTERVAL '1 hour')
                """,
                since_hours,
            )
            recent = await connection.fetch(
                """
                SELECT u.model, u.endpoint, u.total_tokens, u.success, u.created_at,
                       o.display_name AS organization_name
                FROM mistral_api_usage u
                LEFT JOIN organizations o ON o.id = u.organization_id
                ORDER BY u.created_at DESC
                LIMIT 50
                """
            )
        return {
            "by_model": [dict(row) for row in by_model],
            "totals": dict(totals)
            if totals
            else {"call_count": 0, "error_count": 0, "total_tokens": 0},
            "recent": [dict(row) for row in recent],
        }

    async def _ensure_connected(self) -> None:
        if self._pool is None:
            await self.connect()

    @staticmethod
    def _row_to_candidate(row: asyncpg.Record) -> Candidate:
        data = dict(row)
        data["cv_embedding"] = None
        return Candidate(**data)
