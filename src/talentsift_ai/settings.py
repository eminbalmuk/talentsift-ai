from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = Field(default="postgresql://postgres:postgres@localhost:5432/talentsift_ai")
    direct_database_url: str | None = Field(default=None)
    mistral_api_keys: list[str] = Field(default_factory=list)
    mistral_base_url: str = Field(default="https://api.mistral.ai/v1")
    nvidia_api_key: str = Field(default="")
    nvidia_base_url: str = Field(default="https://integrate.api.nvidia.com/v1")
    embedding_provider: str = Field(default="nvidia")
    embedding_model_name: str = Field(default="nvidia/nemotron-3.5-embed-1b")
    embedding_dimensions: int = Field(default=1024)
    embedding_device: str | None = Field(default=None)
    embedding_local_files_only: bool = Field(default=False)
    embedding_query_instruction: str = Field(
        default="Instruct: Given a job description, retrieve matching candidate resumes\nQuery: "
    )
    hybrid_dense_weight: float = Field(default=0.60, ge=0.0, le=1.0)
    hybrid_sparse_weight: float = Field(default=0.40, ge=0.0, le=1.0)
    hybrid_fusion_method: str = Field(default="hybrid_blend")
    warmup_embeddings_on_startup: bool = Field(default=False)
    product_key_pepper: str = Field(default="")
    admin_session_secret: str = Field(default="")
    admin_username: str = Field(default="admin")
    admin_password: str = Field(default="")
    cookie_secure: bool = Field(default=False)
    phoenix_project_name: str = Field(default="talentsift-ai")
    phoenix_collector_endpoint: str | None = Field(default=None)
    request_timeout_seconds: float = Field(default=120.0)
    max_concurrency: int = Field(default=16)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        enable_decoding=False,
        extra="ignore",
    )

    @field_validator("mistral_api_keys", mode="before")
    @classmethod
    def parse_api_keys(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [key.strip() for key in value.split(",") if key.strip()]
        return value

    @property
    def migration_database_url(self) -> str:
        """DDL (CREATE EXTENSION/TABLE/INDEX) needs a direct, non-pooled connection.

        Transaction-mode poolers (e.g. Supabase's pgbouncer on port 6543) don't
        reliably support the session-level statements migrations issue.
        """
        return self.direct_database_url or self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
