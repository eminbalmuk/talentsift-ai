from talentsift_ai.pipeline.reranker import PreLLMReranker, calculate_competency_score


def test_calculate_competency_score_senior_vs_junior():
    senior_candidate = {
        "full_name": "Senior Dev",
        "experience_years": 8,
        "gpa": 3.8,
        "current_class": 5,
        "skills": ["Python", "FastAPI", "Docker", "PostgreSQL"],
        "raw_cv_text": "Experienced Senior Architect. Led backend teams and designed systems.",
    }
    
    junior_candidate = {
        "full_name": "Junior Dev",
        "experience_years": 1,
        "gpa": 2.5,
        "current_class": 3,
        "skills": ["Python"],
        "raw_cv_text": "Junior developer student learning Python.",
    }

    senior_score = calculate_competency_score(senior_candidate)
    junior_score = calculate_competency_score(junior_candidate)

    assert senior_score > junior_score
    assert senior_score >= 0.70
    assert junior_score < 0.50


def test_pre_llm_reranker_sorting():
    candidates = [
        {
            "id": 1,
            "full_name": "Alice Candidate",
            "experience_years": 1,
            "gpa": 2.0,
            "current_class": 2,
            "skills": ["Python"],
            "raw_cv_text": "Beginner programmer.",
            "similarity": 0.40,
        },
        {
            "id": 2,
            "full_name": "Bob Candidate",
            "experience_years": 7,
            "gpa": 3.9,
            "current_class": 5,
            "skills": ["Python", "FastAPI", "PostgreSQL", "LangChain"],
            "raw_cv_text": "Senior Lead Software Engineer with 7 years of building AI products.",
            "similarity": 0.85,
        },
    ]

    reranker = PreLLMReranker()
    reranked = reranker.rerank(
        query="Python AI Engineer",
        candidates=candidates,
        top_k=2,
    )

    assert len(reranked) == 2
    assert reranked[0]["id"] == 2  # Bob should be ranked first
    assert "pre_llm_score" in reranked[0]
    assert "competency_score" in reranked[0]
    assert "relevance_score" in reranked[0]
    assert reranked[0]["pre_llm_score"] >= reranked[1]["pre_llm_score"]
