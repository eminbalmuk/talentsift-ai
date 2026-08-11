from talentsift_ai.db.vector import to_pgvector


def test_to_pgvector_formats_values() -> None:
    assert to_pgvector([0.1, 1.234567891, -2]) == "[0.10000000,1.23456789,-2.00000000]"

