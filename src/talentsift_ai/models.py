from enum import StrEnum


class MistralModel(StrEnum):
    OCR = "mistral-ocr-2512"
    EXTRACTION = "ministral-3b-2512"
    EMBEDDING = "mistral-embed-2312"
    DEBATE = "mistral-small-2603"
    ARBITRATION = "mistral-medium-2508"


DEFAULT_EMBEDDING_MODEL = "dmis-lab/UltraBERT-Embed-150M"
ULTRABERT_EMBEDDING_DIMENSIONS = 768
MISTRAL_EMBEDDING_DIMENSIONS = 1024
EMBEDDING_DIMENSIONS = ULTRABERT_EMBEDDING_DIMENSIONS
