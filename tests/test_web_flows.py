from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from fastapi.testclient import TestClient

from talentsift_ai.web import admin as admin_module
from talentsift_ai.web import app as app_module
from talentsift_ai.web import candidate as candidate_module
from talentsift_ai.web import organization as org_module
from talentsift_ai.web.security import auth_rate_limiter, create_signed_session


def _configure_settings(monkeypatch) -> None:
    fake_settings = SimpleNamespace(
        admin_session_secret="test-session-secret",
        product_key_pepper="test-pepper",
        cookie_secure=False,
        embedding_provider="ultrabert",
        ultrabert_model_name="dmis-lab/UltraBERT-Embed-150M",
        embedding_dimensions=768,
        hybrid_dense_weight=0.65,
        hybrid_sparse_weight=0.35,
        hybrid_fusion_method="hybrid_blend",
        max_concurrency=4,
        mistral_api_keys=["fake-key"],
        mistral_base_url="https://api.mistral.ai/v1",
        request_timeout_seconds=10.0,
        warmup_embeddings_on_startup=False,
        phoenix_project_name="talentsift-test",
        phoenix_collector_endpoint=None,
        database_url="postgres://fake",
    )
    monkeypatch.setattr(admin_module, "get_settings", lambda: fake_settings)
    monkeypatch.setattr(app_module, "get_settings", lambda: fake_settings)
    monkeypatch.setattr(candidate_module, "get_settings", lambda: fake_settings)
    monkeypatch.setattr(org_module, "get_settings", lambda: fake_settings)
    monkeypatch.setattr(app_module.db, "init_pool", lambda *a, **kw: _noop_async())
    monkeypatch.setattr(app_module.db, "close_pool", lambda *a, **kw: _noop_async())
    monkeypatch.setattr(app_module, "configure_phoenix", lambda *a, **kw: False)


async def _noop_async():
    return None


def test_role_scoped_session_cookies_cannot_cross_portals(monkeypatch) -> None:
    _configure_settings(monkeypatch)
    monkeypatch.setattr(org_module, "get_pool", lambda: object())

    admin_token = create_signed_session({"role": "admin", "admin_id": 1}, "test-session-secret")
    org_token = create_signed_session(
        {"role": "org", "organization_id": 10, "display_name": "Acme", "username": "acme"},
        "test-session-secret",
    )
    cand_token = create_signed_session(
        {"role": "candidate", "candidate_id": 99, "email": "a@example.com"},
        "test-session-secret",
    )

    with TestClient(app_module.app) as client:
        # Admin cookie cannot call org or candidate routes even if copied across cookie names
        assert (
            client.get("/api/org/me", cookies={org_module.SESSION_COOKIE: admin_token}).status_code
            == 401
        )
        assert (
            client.get(
                "/api/candidate/profile",
                cookies={candidate_module.CANDIDATE_SESSION_COOKIE: admin_token},
            ).status_code
            == 401
        )
        # Candidate cookie forged into org cookie is rejected
        assert (
            client.get("/api/org/me", cookies={org_module.SESSION_COOKIE: cand_token}).status_code
            == 401
        )
        # Org cookie forged into admin or candidate cookie is rejected
        assert (
            client.get(
                "/api/admin/organizations", cookies={"talentsift_admin_session": org_token}
            ).status_code
            == 401
        )
        assert (
            client.get(
                "/api/candidate/profile",
                cookies={candidate_module.CANDIDATE_SESSION_COOKIE: org_token},
            ).status_code
            == 401
        )


def test_suspended_org_cookie_is_blocked_immediately(monkeypatch) -> None:
    _configure_settings(monkeypatch)
    monkeypatch.setattr(org_module, "get_pool", lambda: object())

    class FakeRepo:
        def __init__(self, pool=None):
            self.pool = pool

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get_organization_access_status(self, organization_id: int):
            return {
                "id": organization_id,
                "display_name": "Acme",
                "is_active": False,
                "license_status": "suspended",
                "license_expires_at": datetime.now(UTC) + timedelta(days=30),
            }

    monkeypatch.setattr(org_module, "CandidateRepository", FakeRepo)
    org_token = create_signed_session(
        {"role": "org", "organization_id": 10, "display_name": "Acme", "username": "acme"},
        "test-session-secret",
    )
    with TestClient(app_module.app) as client:
        resp = client.get("/api/org/me", cookies={org_module.SESSION_COOKIE: org_token})
        assert resp.status_code == 403


def test_candidate_upload_validation_rescore_and_finalized_withdraw_block(monkeypatch) -> None:
    _configure_settings(monkeypatch)
    monkeypatch.setattr(candidate_module, "get_pool", lambda: object())
    monkeypatch.setattr(candidate_module, "get_shared_mistral_client", lambda: object())

    captured_scores: list[dict] = []

    class FakePipeline:
        def __init__(self, **kwargs):
            pass

        async def process_bytes(self, content: bytes, *, filename: str):
            return SimpleNamespace(
                raw_cv_text="Python FastAPI PostgreSQL developer with 4 years experience.",
                structured_data=SimpleNamespace(
                    university="ITU",
                    gpa=3.6,
                    current_class=5,
                    experience_years=4,
                    skills=["Python", "FastAPI", "PostgreSQL"],
                ),
                embedding=[0.1] * 768,
            )

    class FakeEmbedder:
        async def embed_query(self, text: str):
            return [0.1] * 768

    class FakeRepo:
        def __init__(self, pool=None):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def save_candidate_profile(self, **kwargs):
            return {
                "candidate_id": kwargs["candidate_id"],
                "university": kwargs["university"],
                "gpa": kwargs["gpa"],
                "current_class": kwargs["current_class"],
                "experience_years": kwargs["experience_years"],
                "skills": kwargs["skills"],
                "updated_at": datetime.now(UTC).isoformat(),
            }

        async def list_candidate_applications_for_rescore(self, candidate_id: int):
            return [
                {
                    "job_posting_id": 5,
                    "organization_id": 2,
                    "description": "Senior Python FastAPI PostgreSQL Docker engineer",
                }
            ]

        async def get_posting_embedding(self, posting_id: int):
            return [0.1] * 768

        async def get_candidate_similarity(self, **kwargs):
            return 0.88

        async def upsert_application_score(self, **kwargs):
            captured_scores.append(kwargs)

        async def withdraw_job_application(self, job_posting_id: int, candidate_id: int):
            return False

        async def list_candidate_applications(self, candidate_id: int):
            return [{"job_posting_id": 5, "status": "selected"}]

    monkeypatch.setattr(candidate_module, "ResumeIngestionPipeline", FakePipeline)
    monkeypatch.setattr(candidate_module, "CandidateRepository", FakeRepo)
    monkeypatch.setattr(candidate_module, "get_embedder", lambda *a, **kw: FakeEmbedder())

    cand_token = create_signed_session(
        {"role": "candidate", "candidate_id": 7, "email": "cand@example.com"},
        "test-session-secret",
    )
    cookies = {candidate_module.CANDIDATE_SESSION_COOKIE: cand_token}

    with TestClient(app_module.app) as client:
        # Unsupported file extension -> 400
        bad_ext = client.post(
            "/api/candidate/cv/upload",
            files={"file": ("virus.exe", b"hello", "application/octet-stream")},
            cookies=cookies,
        )
        assert bad_ext.status_code == 400

        # Oversized > 10MB -> 413
        oversized = client.post(
            "/api/candidate/cv/upload",
            files={"file": ("big.pdf", b"x" * (10 * 1024 * 1024 + 1), "application/pdf")},
            cookies=cookies,
        )
        assert oversized.status_code == 413

        # Valid .txt upload saves profile AND rescores existing application
        ok_upload = client.post(
            "/api/candidate/cv/upload",
            files={"file": ("cv.txt", b"Python FastAPI developer", "text/plain")},
            cookies=cookies,
        )
        assert ok_upload.status_code == 200
        assert len(captured_scores) == 1
        assert captured_scores[0]["dense_score"] == 0.88
        assert "python" in captured_scores[0]["matched_skills"]
        assert "docker" in captured_scores[0]["missing_skills"]

        # Withdrawing a finalized ("selected") application returns 409
        blocked_withdraw = client.post("/api/candidate/jobs/5/withdraw", cookies=cookies)
        assert blocked_withdraw.status_code == 409


def test_org_shortlist_status_concurrency_guard_and_interview_422(monkeypatch) -> None:
    _configure_settings(monkeypatch)
    monkeypatch.setattr(org_module, "get_pool", lambda: object())

    class FakeRepo:
        def __init__(self, pool=None):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get_organization_access_status(self, organization_id: int):
            return {
                "id": organization_id,
                "display_name": "Acme",
                "is_active": True,
                "license_status": "active",
                "license_expires_at": None,
            }

        async def get_job_posting(self, posting_id: int, organization_id: int):
            return {"id": posting_id, "organization_id": organization_id, "title": "Backend Dev"}

        async def evaluated_candidate_ids(self, organization_id: int, posting_id: int):
            return [1, 2]

    monkeypatch.setattr(org_module, "CandidateRepository", FakeRepo)
    org_module._SHORTLIST_RUNS[77] = {
        "status": "running",
        "total": 4,
        "completed": 2,
        "succeeded": 2,
        "failed": 0,
        "failed_candidates": [],
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": None,
        "message": None,
    }
    org_token = create_signed_session(
        {"role": "org", "organization_id": 10, "display_name": "Acme", "username": "acme"},
        "test-session-secret",
    )
    cookies = {org_module.SESSION_COOKIE: org_token}
    try:
        with TestClient(app_module.app) as client:
            status_resp = client.get("/api/org/postings/77/shortlist/status", cookies=cookies)
            assert status_resp.status_code == 200
            data = status_resp.json()
            assert data["status"] == "running"
            assert data["completed"] == 2
            assert data["evaluated_count"] == 2

            dup_shortlist = client.post(
                "/api/org/postings/77/shortlist",
                json={"candidate_count": 3},
                cookies=cookies,
            )
            assert dup_shortlist.status_code == 409

            fin_blocked = client.post(
                "/api/org/postings/77/finalize",
                json={"interview_slots": 2},
                cookies=cookies,
            )
            assert fin_blocked.status_code == 409

            bad_date = client.post(
                "/api/org/postings/77/candidates/1/interview",
                json={"proposed_at": "not-a-valid-date"},
                cookies=cookies,
            )
            assert bad_date.status_code == 422

            xss_link = client.post(
                "/api/org/postings/77/candidates/1/interview",
                json={
                    "proposed_at": "2026-12-01T10:00:00Z",
                    "location_or_link": "javascript:alert(1)",
                },
                cookies=cookies,
            )
            assert xss_link.status_code == 422
    finally:
        org_module._SHORTLIST_RUNS.pop(77, None)


def test_security_headers_csrf_rate_limit_magic_bytes_and_admin_actions(monkeypatch) -> None:
    _configure_settings(monkeypatch)
    monkeypatch.setattr(admin_module, "get_pool", lambda: object())
    monkeypatch.setattr(candidate_module, "get_pool", lambda: object())
    monkeypatch.setattr(org_module, "get_pool", lambda: object())
    auth_rate_limiter.reset()

    class FakeAdminAndOrgRepo:
        def __init__(self, pool=None):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def ping(self):
            return True

        async def authenticate_admin(self, **kwargs):
            return None

        async def reset_organization_password(
            self, *, organization_id: int, credential_pepper: str
        ):
            return {"username": "acme-admin", "password": "pw_new_generated"}

        async def get_organization_access_status(self, organization_id: int):
            return {
                "id": organization_id,
                "display_name": "Acme",
                "is_active": True,
                "license_status": "active",
                "license_expires_at": None,
            }

        async def update_job_posting(self, **kwargs):
            return {
                "id": kwargs["job_posting_id"],
                "title": kwargs["title"],
                "description": kwargs["description"],
                "deadline_at": kwargs["deadline_at"],
                "is_active": True,
                "created_at": datetime.now(UTC).isoformat(),
                "candidate_count": 2,
                "debate_count": 0,
            }

    monkeypatch.setattr(admin_module, "CandidateRepository", FakeAdminAndOrgRepo)
    monkeypatch.setattr(org_module, "CandidateRepository", FakeAdminAndOrgRepo)

    admin_token = create_signed_session(
        {"role": "admin", "admin_id": 1, "username": "rootadmin"},
        "test-session-secret",
    )
    org_token = create_signed_session(
        {"role": "org", "organization_id": 10, "display_name": "Acme", "username": "acme"},
        "test-session-secret",
    )
    cand_token = create_signed_session(
        {"role": "candidate", "candidate_id": 7, "email": "cand@example.com"},
        "test-session-secret",
    )

    try:
        with TestClient(app_module.app) as client:
            # 1. Security headers + Cache-Control: no-store on API
            health = client.get("/healthz")
            assert health.headers["x-content-type-options"] == "nosniff"
            assert health.headers["x-frame-options"] == "DENY"

            unauth = client.get("/api/admin/me")
            assert unauth.status_code == 401
            assert unauth.headers["cache-control"] == "no-store, private"

            # 2. Cross-site Origin rejected with 403
            csrf_blocked = client.post(
                "/api/org/logout",
                headers={"Origin": "https://evil.attacker.example"},
            )
            assert csrf_blocked.status_code == 403

            # 3. Spoofed PDF binary header rejected with 400
            client.cookies.set(candidate_module.CANDIDATE_SESSION_COOKIE, cand_token)
            spoofed_pdf = client.post(
                "/api/candidate/cv/upload",
                files={"file": ("malware.pdf", b"MZ\x90\x00not-a-pdf", "application/pdf")},
            )
            assert spoofed_pdf.status_code == 400
            client.cookies.clear()

            # 4. Admin system status + org password reset
            client.cookies.set(admin_module.SESSION_COOKIE, admin_token)
            sys_resp = client.get("/api/admin/system/status")
            assert sys_resp.status_code == 200
            sys_json = sys_resp.json()
            assert sys_json["database_reachable"] is True
            assert sys_json["embedding_model"] == "dmis-lab/UltraBERT-Embed-150M"

            pw_reset = client.post("/api/admin/organizations/10/password/reset")
            assert pw_reset.status_code == 200
            assert pw_reset.json()["password"] == "pw_new_generated"
            client.cookies.clear()

            # 5. Org can edit posting
            client.cookies.set(org_module.SESSION_COOKIE, org_token)
            patch_resp = client.patch(
                "/api/org/postings/77",
                json={
                    "title": "Updated Senior Engineer",
                    "description": "Python FastAPI UltraBERT",
                },
            )
            assert patch_resp.status_code == 200
            assert patch_resp.json()["posting"]["title"] == "Updated Senior Engineer"
            client.cookies.clear()

            # 6. Brute-force rate limiter triggers 429 on 13th admin login attempt
            for _ in range(12):
                r = client.post("/api/admin/login", json={"username": "root", "password": "wrong"})
                assert r.status_code == 401
            limited = client.post(
                "/api/admin/login", json={"username": "root", "password": "wrong"}
            )
            assert limited.status_code == 429
            assert "retry-after" in limited.headers
    finally:
        auth_rate_limiter.reset()
