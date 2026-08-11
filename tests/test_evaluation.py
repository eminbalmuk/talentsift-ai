from talentsift_ai.evaluation import build_faithfulness_sample, protected_attribute_policy


def test_build_faithfulness_sample_uses_cv_as_context() -> None:
    sample = build_faithfulness_sample(
        job_description="Python engineer",
        cv_text="Built RAG systems.",
        arbitrator_rationale="Strong fit due to RAG experience.",
    )

    assert sample.contexts == ["Built RAG systems."]
    assert "Python engineer" in sample.question


def test_protected_attribute_policy_names_allowed_basis() -> None:
    policy = protected_attribute_policy()

    assert "technical skills" in policy
    assert "protected attributes" in policy

