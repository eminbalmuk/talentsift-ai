from collections.abc import Sequence


def to_pgvector(values: Sequence[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"

