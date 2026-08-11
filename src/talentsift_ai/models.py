from enum import StrEnum


class MistralModel(StrEnum):
    OCR = "mistral-ocr-2512"
    EXTRACTION = "ministral-3b-2512"
    EMBEDDING = "mistral-embed-2312"
    DEBATE = "mistral-small-2506"
    ARBITRATION = "mistral-large-2512"


EMBEDDING_DIMENSIONS = 1024

