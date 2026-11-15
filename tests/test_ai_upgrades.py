import asyncio
import io
import zipfile

import httpx

from talentsift_ai.agents.debate_graph import DebateGraph
from talentsift_ai.evaluation import (
    compute_evidence_grounding,
    evaluate_debate_faithfulness,
    redact_demographic_markers,
)
from talentsift_ai.mistral_client import MistralClient, _strict_json_schema
from talentsift_ai.pipeline.ingest import ResumeIngestionPipeline
from talentsift_ai.pipeline.reranker import calculate_competency_breakdown
from talentsift_ai.pipeline.sparse import extract_skill_matches
from talentsift_ai.schemas import AgentAnalysis, ArbitratorReport


def test_extract_skill_matches_reports_matched_and_missing() -> None:
    jd = "Looking for a Senior Python, FastAPI, PostgreSQL, Docker and Kubernetes engineer."
    candidate = {
        "skills": ["Python", "FastAPI", "Git"],
        "raw_cv_text": "Built microservices using Python, FastAPI and PostgreSQL.",
    }
    res = extract_skill_matches(jd, candidate)
    assert "python" in res["matched_skills"]
    assert "fastapi" in res["matched_skills"]
    assert "postgresql" in res["matched_skills"]
    assert "docker" in res["missing_skills"]
    assert "kubernetes" in res["missing_skills"]


def test_competency_breakdown_handles_turkish_yonetti_and_missing_gpa() -> None:
    cand_with_gpa_none = {
        "experience_years": 4,
        "gpa": None,
        "current_class": 5,
        "skills": ["Python", "SQL", "Docker", "FastAPI", "React", "AWS"],
        "raw_cv_text": "Mühendislik ekibini yönetti ve ölçeklenebilir sistemler kurdu.",
    }
    breakdown = calculate_competency_breakdown(cand_with_gpa_none)
    assert breakdown["gpa_score"] == 0.10
    assert breakdown["keyword_score"] > 0.0
    assert 0.40 <= breakdown["competency_score"] <= 1.0


def test_demographic_redaction_and_grounding_metrics() -> None:
    cv = (
        "Ada Lovelace\n"
        "Birth Date: 1995-04-12\n"
        "Cinsiyet: Kadın\n"
        "Military Status: Completed\n"
        "Built distributed FastAPI and PostgreSQL services handling 10k RPS."
    )
    redacted = redact_demographic_markers(cv)
    assert "1995-04-12" not in redacted
    assert "Kadın" not in redacted
    assert "Military Status" not in redacted
    assert "FastAPI and PostgreSQL" in redacted

    grounding = compute_evidence_grounding(
        [
            "Built distributed FastAPI and PostgreSQL services",
            "Invented quantum blockchain compiler at NASA",
        ],
        cv,
    )
    assert grounding == 0.5

    metrics = evaluate_debate_faithfulness(
        job_description="FastAPI PostgreSQL backend engineer",
        cv_text=cv,
        arbitrator_rationale="Candidate built distributed FastAPI and PostgreSQL services.",
        evidence_quotes=["Built distributed FastAPI and PostgreSQL services"],
    )
    assert metrics["evidence_grounding"] == 1.0
    assert metrics["vocab_support"] >= 0.7


def test_parallel_debate_graph_redacts_pii_and_grounds_quotes() -> None:
    calls: list[dict] = []

    class FakeMistralClient:
        async def chat_json(
            self,
            *,
            model,
            system_prompt,
            user_prompt,
            response_model,
            temperature=0.2,
            max_tokens=None,
        ):
            calls.append({"prompt": user_prompt, "model": response_model.__name__})
            if response_model is ArbitratorReport:
                assert "<optimist_analysis>" in user_prompt
                assert "<pessimist_analysis>" in user_prompt
                return ArbitratorReport(
                    technical_fit=88.0,
                    experience_fit=82.0,
                    education_fit=75.0,
                    final_score=84.5,
                    rationale="Güçlü FastAPI ve PostgreSQL deneyimi kanıtlanmış.",
                    evidence_quotes=["Built FastAPI and PostgreSQL microservices"],
                    is_selected=True,
                )
            # Blind parallel agents must NOT contain optimist/pessimist sections yet
            assert "<optimist_analysis>" not in user_prompt
            assert "<pessimist_analysis>" not in user_prompt
            return AgentAnalysis(
                score=85 if "advocate" in system_prompt else 72,
                arguments="Deneyim kanıtlandı." if "advocate" in system_prompt else "Kısa süre.",
                evidence_quotes=["Built FastAPI and PostgreSQL microservices"],
            )

    graph = DebateGraph(FakeMistralClient())  # type: ignore[arg-type]
    cv_text = (
        "Gender: Male\n"
        "TC Kimlik: 12345678901\n"
        "Built FastAPI and PostgreSQL microservices in production."
    )
    result = asyncio.run(
        graph.evaluate(
            organization_id=1,
            candidate_id=9,
            cv_text=cv_text,
            job_description="Senior Python Backend Engineer",
            language="tr",
        )
    )
    assert result.final_score == 84.5
    assert result.grounding_score == 1.0
    assert all("12345678901" not in c["prompt"] for c in calls)


def test_strict_json_schema_sets_additional_properties_and_required() -> None:
    schema = _strict_json_schema(ArbitratorReport.model_json_schema())
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(ArbitratorReport.model_fields.keys())


def test_mistral_client_repairs_invalid_json_and_retries_transient_503() -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(503, json={"error": "overloaded"})
        if attempts == 2:
            # Returns invalid/fenced incomplete JSON to trigger repair attempt
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {"content": "```json\n{\"score\": 999}\n```"},
                        }
                    ],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                },
            )
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": (
                                '{"score": 82, "arguments": "Solid backend skills.", '
                                '"evidence_quotes": ["Python FastAPI"]}'
                            )
                        },
                    }
                ],
                "usage": {"prompt_tokens": 20, "completion_tokens": 10},
            },
        )

    async def _run() -> AgentAnalysis:
        client = MistralClient(api_keys=["key-1", "key-2"])
        await client._client.aclose()
        client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            return await client.chat_json(
                model="mistral-small-latest",
                system_prompt="sys",
                user_prompt="user",
                response_model=AgentAnalysis,
            )
        finally:
            await client.close()

    # Replace asyncio.sleep inside retry loop? No need: backoff for attempt 0 is ~0.6s, plenty fast.
    parsed = asyncio.run(_run())
    assert attempts == 3
    assert parsed.score == 82


def test_resume_ingestion_reads_txt_and_docx_without_ocr() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "word/document.xml",
            (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                "<w:body><w:p><w:r><w:t>"
                + "Senior Python and PostgreSQL Engineer building scalable AI systems. " * 4
                + "</w:t></w:r></w:p></w:body></w:document>"
            ),
        )
    docx_bytes = buf.getvalue()

    class StubMistral:
        ocr_called = False

        async def ocr_document_bytes(self, *args, **kwargs):
            self.ocr_called = True
            raise AssertionError("OCR should not be called for readable .docx or .txt")

    class StubRepo:
        pass

    async def _check():
        mistral = StubMistral()
        pipeline = ResumeIngestionPipeline(
            mistral_client=mistral,  # type: ignore[arg-type]
            repository=StubRepo(),  # type: ignore[arg-type]
        )
        docx_text = await pipeline._extract_raw_text(docx_bytes, filename="resume.docx")
        txt_text = await pipeline._extract_raw_text(
            b"Full stack developer with React and FastAPI experience across multiple systems.",
            filename="resume.txt",
        )
        assert "PostgreSQL Engineer" in docx_text
        assert "React and FastAPI" in txt_text
        assert mistral.ocr_called is False

    asyncio.run(_check())
