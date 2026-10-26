from typing import Literal, Self

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    chesscom_mode: Literal["demo", "live"] = "demo"
    engine_mode: Literal["demo", "stockfish"] = "demo"
    llm_provider: Literal["deterministic", "anthropic"] = "deterministic"
    anthropic_api_key: SecretStr | None = None
    anthropic_model: str = Field(default="claude-haiku-4-5-20251001", min_length=1, max_length=100)
    anthropic_timeout_seconds: float = Field(default=10, ge=0.1, le=30)
    stockfish_path: str | None = None
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    engine_depth: int = Field(default=12, ge=1, le=24)
    engine_time_seconds: float = Field(default=0.3, gt=0, le=5)
    engine_timeout_seconds: float = Field(default=10, ge=0.1, le=30)
    engine_queue_timeout_seconds: float = Field(default=30, ge=0.1, le=60)
    engine_threads: int = Field(default=1, ge=1, le=4)
    engine_hash_mb: int = Field(default=32, ge=1, le=256)
    max_games: int = Field(default=128, ge=2, le=1000)
    max_positions: int = Field(default=2048, ge=2, le=10000)
    max_jobs: int = Field(default=16, ge=1, le=100)
    max_active_jobs: int = Field(default=2, ge=1, le=8)
    cache_ttl_seconds: float = Field(default=3600, ge=1, le=86400)
    http_timeout_seconds: float = Field(default=8, ge=0.1, le=30)
    http_min_interval_seconds: float = Field(default=0.2, ge=0, le=10)
    max_request_bytes: int = Field(default=300_000, ge=1024, le=1_000_000)

    @field_validator("cors_origins")
    @classmethod
    def explicit_origins_only(cls, origins: list[str]) -> list[str]:
        from urllib.parse import urlsplit

        for origin in origins:
            parsed = urlsplit(origin)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or (
                    parsed.scheme == "http"
                    and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
                )
                or any(character in origin for character in "*\\?#")
                or any(
                    character.isspace() or ord(character) < 32 or ord(character) == 127
                    for character in origin
                )
                or parsed.path
                or parsed.username is not None
                or parsed.password is not None
                or parsed.netloc.endswith(":")
                or parsed.port == 0
            ):
                raise ValueError("CORS origins must be explicit HTTPS or local HTTP origins")
        return origins

    @model_validator(mode="after")
    def stockfish_required(self) -> Self:
        if self.engine_mode == "stockfish" and not self.stockfish_path:
            raise ValueError("STOCKFISH_PATH is required in stockfish mode")
        if self.llm_provider == "anthropic" and (
            self.anthropic_api_key is None or not self.anthropic_api_key.get_secret_value().strip()
        ):
            raise ValueError("ANTHROPIC_API_KEY is required with LLM_PROVIDER=anthropic")
        if self.max_active_jobs > self.max_jobs:
            raise ValueError("max_active_jobs must not exceed max_jobs")
        return self
