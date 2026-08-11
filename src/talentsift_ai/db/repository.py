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
from talentsift_ai.schemas import Candidate, CandidateCreate, DebateResult


class CandidateRepository:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url
        self._pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        if self._pool is None:
            self._pool = await asyncpg.create_pool(
                self._database_url,
                statement_cache_size=0,
            )

    async def close(self) -> None:
        if self._pool is not None:
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

    async def provision_admin_user(self, *, credential_pepper: str = "") -> AdminCredential:
        await self._ensure_connected()
        username = generate_admin_username()
        password = generate_password()
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
                RETURNING id
                """,
                username,
                normalize_username(username),
                hash_secret(password, pepper=credential_pepper),
                secret_public_prefix(password),
            )

        return AdminCredential(
            admin_id=row["id"],
            username=username,
            password=password,
            password_prefix=secret_public_prefix(password),
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
                       u.username, u.password_hash
                FROM organization_users u
                JOIN organizations o ON o.id = u.organization_id
                WHERE u.username_normalized = $1
                  AND u.is_active = TRUE
                  AND o.is_active = TRUE
                """,
                username_normalized,
            )
            if row is None:
                return None

            if not verify_secret(password, row["password_hash"], pepper=credential_pepper):
                return None

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

    async def insert_candidate(self, candidate: CandidateCreate) -> Candidate:
        await self._ensure_connected()
        embedding = to_pgvector(candidate.cv_embedding) if candidate.cv_embedding else None
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                INSERT INTO candidates (
                    organization_id,
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
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10)
                RETURNING id
                """,
                candidate.organization_id,
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

    async def get_candidate(self, candidate_id: int, organization_id: int) -> Candidate | None:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                SELECT id, organization_id, full_name, university, gpa, current_class,
                       experience_years, skills, raw_cv_text, source_path
                FROM candidates
                WHERE id = $1 AND organization_id = $2
                """,
                candidate_id,
                organization_id,
            )
        if row is None:
            return None
        return self._row_to_candidate(row)

    async def list_candidates(
        self,
        *,
        organization_id: int,
        min_gpa: float | None = None,
        class_year: int | None = None,
        min_experience_years: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        await self._ensure_connected()
        where_clauses = ["organization_id = $1"]
        values: list[Any] = [organization_id]
        param_index = 1

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
        query_embedding: list[float],
        min_gpa: float | None = None,
        class_year: int | None = None,
        min_experience_years: int | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        await self._ensure_connected()
        where_clauses = ["organization_id = $3", "cv_embedding IS NOT NULL"]
        values: list[Any] = [to_pgvector(query_embedding), limit, organization_id]
        param_index = 3
        param_index += 1

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
            rows = await connection.fetch(sql, *values)
        return [dict(row) for row in rows]

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

    async def top_results(self, organization_id: int, limit: int = 5) -> list[dict[str, Any]]:
        await self._ensure_connected()
        async with self._pool.acquire() as connection:
            rows = await connection.fetch(
                """
                SELECT c.id AS candidate_id, c.full_name, c.university,
                       d.final_score, d.arbitrator_rationale, d.is_selected
                FROM debate_results d
                JOIN candidates c ON c.id = d.candidate_id
                WHERE d.organization_id = $1
                ORDER BY d.final_score DESC, d.created_at DESC
                LIMIT $2
                """,
                organization_id,
                limit,
            )
        return [dict(row) for row in rows]

    async def _ensure_connected(self) -> None:
        if self._pool is None:
            await self.connect()

    @staticmethod
    def _row_to_candidate(row: asyncpg.Record) -> Candidate:
        data = dict(row)
        data["cv_embedding"] = None
        return Candidate(**data)
