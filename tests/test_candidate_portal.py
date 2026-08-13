from talentsift_ai.db.repository import hash_secret, verify_secret


def test_candidate_password_hashing():
    password = "MySecurePassword123!"
    pepper = "test_pepper"
    hashed = hash_secret(password, pepper=pepper)

    assert len(hashed) == 64
    assert verify_secret(password, hashed, pepper=pepper)
    assert not verify_secret("WrongPassword", hashed, pepper=pepper)


def test_candidate_profile_data_structure():
    profile = {
        "candidate_id": 42,
        "university": "Istanbul Technical University",
        "gpa": 3.75,
        "current_class": 4,
        "experience_years": 3,
        "skills": ["Python", "FastAPI", "PostgreSQL"],
        "has_embedding": True,
    }

    assert profile["candidate_id"] == 42
    assert profile["has_embedding"] is True
    assert len(profile["skills"]) == 3


def test_ingestion_result_structure():
    from talentsift_ai.pipeline.ingest import IngestionResult
    from talentsift_ai.schemas import CVStructure

    cv_data = CVStructure(
        full_name="John Doe",
        university="METU",
        gpa=3.8,
        current_class=5,
        experience_years=4,
        skills=["Python", "Docker"],
    )
    result = IngestionResult(
        raw_cv_text="John Doe METU CV...",
        structured_data=cv_data,
        embedding=[0.1] * 1024,
    )

    assert result.structured_data.university == "METU"
    assert len(result.embedding) == 1024
    assert result.raw_cv_text.startswith("John Doe")
