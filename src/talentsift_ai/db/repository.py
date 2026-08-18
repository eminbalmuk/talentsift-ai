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
from talentsift_ai.schemas import (
    Candidate,
    CandidateCreate,
    DebateResult,
    JobPosting,
    JobPostingCreate,
)


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
                       o.license_status, u.is_active AS user_is_active
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

            if not row["org_is_active"] or row["license_status"] == "pending" or not row["user_is_active"]:
                return {"is_pending": True, "display_name": row["display_name"]}

            await connection.execute(
                "UPDATE organization_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1",
                row["user_id"],
            )

        data = dict(row)
        data.pop("password_hash")
        return data

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
                       u.username,
                       u.password_prefix,
                       COUNT(DISTINCT c.id) AS candidate_count,
                       COUNT(DISTINCT d.id) AS debate_count
                FROM organizations o
                LEFT JOIN organization_users u ON u.organization_id = o.id
                LEFT JOIN candidates c ON c.organization_id = o.id
                LEFT JOIN debate_results d ON d.organization_id = o.id
                GROUP BY o.id, u.username, u.password_prefix
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
                           (SELECT COUNT(*) FROM debate_results d
                            JOIN candidates c ON c.id = d.candidate_id
                            WHERE c.job_posting_id = p.id AND d.organization_id = p.organization_id)
                           + (SELECT COUNT(*) FROM debate_results d
                              JOIN job_applications a ON a.candidate_id = d.candidate_id
                              WHERE a.job_posting_id = p.id AND d.organization_id = p.organization_id)
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
        app_values: list[Any] = [organization_id, job_posting_id]
        param_index = 2

        if min_gpa is not None:
            param_index += 1
            app_where.append(f"p.gpa >= ${param_index}")
            app_values.append(min_gpa)
        if class_year is not None:
            param_index += 1
            app_where.append(f"p.current_class = ${param_index}")
            app_values.append(class_year)
        if min_experience_years is not None:
            param_index += 1
            app_where.append(f"p.experience_years >= ${param_index}")
            app_values.append(min_experience_years)

        limit_index = param_index + 1
        offset_index = param_index + 2
        app_values.extend([limit, offset])

        app_sql = f"""
            SELECT p.candidate_id AS id, u.full_name, p.university, p.gpa, p.current_class,
                   p.experience_years, p.skills, p.source_path, a.applied_at AS created_at
            FROM job_applications a
            JOIN candidate_profiles p ON p.candidate_id = a.candidate_id
            JOIN candidate_users u ON u.id = a.candidate_id
            WHERE {" AND ".join(app_where)}
            ORDER BY a.applied_at DESC
            LIMIT ${limit_index} OFFSET ${offset_index}
        """

        async with self._pool.acquire() as connection:
            rows = await connection.fetch(app_sql, *app_values)
            if rows:
                return [dict(row) for row in rows]

        # Secondary: Fallback to candidates table
        where_clauses = ["organization_id = $1", "job_posting_id = $2"]
        values: list[Any] = [organization_id, job_posting_id]
        param_index = 2

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

        limit_index = param_index + 1
        offset_index = param_index + 2
        values.extend([limit, offset])

        sql = f"""
            SELECT id, full_name, university, gpa, current_class, experience_years,
                   skills, source_path, created_at
            FROM candidates
            WHERE {" AND ".join(where_clauses)}
            ORDER BY created_at DESC
            LIMIT ${limit_index} OFFSET ${offset_index}
        """

        async with self._pool.acquire() as connection:
            rows = await connection.fetch(sql, *values)
        return [dict(row) for row in rows]

    async def evaluated_candidate_ids(self, organization_id: int) -> set[int]:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            rows = await connection.fetch(
                "SELECT DISTINCT candidate_id FROM debate_results WHERE organization_id = $1",
                organization_id,
            )
        return {row["candidate_id"] for row in rows}

    async def latest_debate_result(
        self, candidate_id: int, organization_id: int
    ) -> dict[str, Any] | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                SELECT id, optimist_score, optimist_arguments, pessimist_score,
                       pessimist_arguments, final_score, arbitrator_rationale,
                       is_selected, created_at
                FROM debate_results
                WHERE candidate_id = $1 AND organization_id = $2
                ORDER BY created_at DESC
                LIMIT 1
                """,
                candidate_id,
                organization_id,
            )
        return None if row is None else dict(row)

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
            where_clauses.append(f"gpa >= ${param_index}")
            values.append(min_gpa)
            param_index += 1
        if class_year is not None:
            where_clauses.append(f"current_class = ${param_index}")
            values.append(class_year)
            param_index += 1
        if min_experience_years is not None:
            where_clauses.append(f"experience_years >= ${param_index}")
            values.append(min_experience_years)
            param_index += 1

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
        Hybrid search combining Supabase Full-Text Search (BM25) and pgvector Cosine Similarity.
        Retrieves candidates for pre-LLM reranking.
        """
        await self._ensure_connected()
        where_clauses = ["organization_id = $3", "job_posting_id = $4"]
        values: list[Any] = [
            to_pgvector(query_embedding),
            limit,
            organization_id,
            job_posting_id,
            query_text,
        ]
        param_index = 5

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

        # 1. Primary Query: Search Candidate Self-Service Applications
        app_where = [
            "a.organization_id = $3",
            "a.job_posting_id = $4",
            "p.cv_embedding IS NOT NULL",
        ]
        app_param_index = 5
        app_values = list(values)

        if min_gpa is not None:
            app_param_index += 1
            app_where.append(f"p.gpa >= ${app_param_index}")
            app_values.append(min_gpa)
        if class_year is not None:
            app_param_index += 1
            app_where.append(f"p.current_class = ${app_param_index}")
            app_values.append(class_year)
        if min_experience_years is not None:
            app_param_index += 1
            app_where.append(f"p.experience_years >= ${app_param_index}")
            app_values.append(min_experience_years)

        fts_rank_expr_p = (
            "CASE WHEN p.fts IS NOT NULL THEN ts_rank_cd(p.fts, plainto_tsquery('english', $5)) "
            "ELSE 0.0 END"
        )
        app_sql = f"""
            SELECT p.candidate_id AS id, u.full_name, p.university, p.gpa, p.current_class,
                   p.experience_years, p.skills, p.raw_cv_text, p.source_path,
                   (1 - (p.cv_embedding <=> $1::vector)) AS vector_similarity,
                   {fts_rank_expr_p} AS bm25_rank,
                   (
                       (1 - (p.cv_embedding <=> $1::vector)) * 0.7 + 
                       ({fts_rank_expr_p}) * 0.3
                   ) AS similarity
            FROM job_applications a
            JOIN candidate_profiles p ON p.candidate_id = a.candidate_id
            JOIN candidate_users u ON u.id = a.candidate_id
            WHERE {" AND ".join(app_where)}
            ORDER BY similarity DESC
            LIMIT $2
        """

        try:
            async with self._pool.acquire() as connection:
                async with connection.transaction():
                    await connection.execute("SET LOCAL ivfflat.probes = 100")
                    rows = await connection.fetch(app_sql, *app_values)
                if rows:
                    return [dict(row) for row in rows]
        except Exception:
            pass

        # 2. Secondary Query: Fallback to Legacy candidates table
        fts_rank_expr = (
            "CASE WHEN fts IS NOT NULL THEN ts_rank_cd(fts, plainto_tsquery('english', $5)) "
            "ELSE 0.0 END"
        )
        sql = f"""
            SELECT id, full_name, university, gpa, current_class, experience_years,
                   skills, raw_cv_text, source_path,
                   (1 - (cv_embedding <=> $1::vector)) AS vector_similarity,
                   {fts_rank_expr} AS bm25_rank,
                   (
                       (1 - (cv_embedding <=> $1::vector)) * 0.7 + 
                       ({fts_rank_expr}) * 0.3
                   ) AS similarity
            FROM candidates
            WHERE {" AND ".join(where_clauses)}
            ORDER BY similarity DESC
            LIMIT $2
        """

        try:
            async with self._pool.acquire() as connection:
                async with connection.transaction():
                    await connection.execute("SET LOCAL ivfflat.probes = 100")
                    rows = await connection.fetch(sql, *values)
            return [dict(row) for row in rows]
        except Exception:
            return await self.search_candidates(
                organization_id=organization_id,
                job_posting_id=job_posting_id,
                query_embedding=query_embedding,
                min_gpa=min_gpa,
                class_year=class_year,
                min_experience_years=min_experience_years,
                limit=limit,
            )

    async def save_debate_result(self, result: DebateResult) -> int:
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
                    is_selected
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
            )
        return row["id"]

    async def top_results(
        self, organization_id: int, job_posting_id: int, limit: int = 5
    ) -> list[dict[str, Any]]:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            rows = await connection.fetch(
                """
                SELECT p.candidate_id, u.full_name, p.university,
                       d.final_score, d.arbitrator_rationale, d.is_selected
                FROM debate_results d
                JOIN job_applications a ON a.candidate_id = d.candidate_id
                JOIN candidate_profiles p ON p.candidate_id = a.candidate_id
                JOIN candidate_users u ON u.id = a.candidate_id
                WHERE d.organization_id = $1 AND a.job_posting_id = $2
                ORDER BY d.final_score DESC, d.created_at DESC
                LIMIT $3
                """,
                organization_id,
                job_posting_id,
                limit,
            )
            if rows:
                return [dict(row) for row in rows]

            rows = await connection.fetch(
                """
                SELECT c.id AS candidate_id, c.full_name, c.university,
                       d.final_score, d.arbitrator_rationale, d.is_selected
                FROM debate_results d
                JOIN candidates c ON c.id = d.candidate_id
                WHERE d.organization_id = $1 AND c.job_posting_id = $2
                ORDER BY d.final_score DESC, d.created_at DESC
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
                WHERE j.is_active = TRUE AND o.is_active = TRUE
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
                WHERE j.id = $1 AND j.is_active = TRUE AND o.is_active = TRUE
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
                WHERE job_posting_id = $1 AND candidate_id = $2
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

    async def _ensure_connected(self) -> None:
        if self._pool is None:
            await self.connect()

    @staticmethod
    def _row_to_candidate(row: asyncpg.Record) -> Candidate:
        data = dict(row)
        data["cv_embedding"] = None
        return Candidate(**data)
