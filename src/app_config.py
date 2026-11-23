from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"


class AppConfig(BaseSettings):
    pydantic_logfire_api_key: str | None = Field(None, validation_alias="PYDANTIC_LOGFIRE_API_KEY")
    service_name: str | None = Field("xbrl-autopilot", validation_alias="SERVICE_NAME")

    # AI (Groq). Dev: from .env. Packaged app: injected by Electron main from safeStorage.
    groq_api_key: str | None = Field(None, validation_alias="GROQ_API_KEY")
    groq_model: str = Field(DEFAULT_GROQ_MODEL, validation_alias="GROQ_MODEL")
    # Models tried in order when the current one hits Groq's rate limit (429), comma-separated.
    # Groq limits are per model, so the next model usually still has quota (docs/17).
    groq_fallback_models: str | None = Field(None, validation_alias="GROQ_FALLBACK_MODELS")
    # Tests / E2E point this at a local mock LLM (src/services/llm/groq.py accepts https or loopback http only).
    groq_url: str | None = Field(None, validation_alias="GROQ_URL")

    # Sidecar runtime (set by Electron main when it spawns us).
    xap_port: int = Field(7860, validation_alias="XAP_PORT")
    xap_token: str | None = Field(None, validation_alias="XAP_TOKEN")

    # Qdrant Vector DB
    qdrant_api_key: str | None = Field(None, validation_alias="QDRANT_API_KEY")
    qdrant_cluster_endpoint: str | None = Field(None, validation_alias="QDRANT_CLUSTER_ENDPOINT")
    embedding_dim: int = Field(768, validation_alias="EMBEDDING_DIM")
    embedding_model: int = Field(None,validation_alias="EMBEDDING_MODEL")
    collection_name: str = Field("xbrl_agent", validation_alias="COLLECTION_NAME")

    # Ingestion / Security (Optional password protection)
    ingestion_password: str | None = Field(None, validation_alias="INGESTION_PASSWORD")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_ignore_empty=True,
        extra="ignore",
    )


@lru_cache
def get_app_config():
    return AppConfig()
