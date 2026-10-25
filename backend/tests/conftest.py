from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        chesscom_mode="demo",
        engine_mode="demo",
        llm_provider="deterministic",
        max_games=128,
        max_jobs=16,
        max_active_jobs=2,
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as client:
        yield client


@pytest.fixture
def game(client: TestClient) -> dict:
    response = client.get("/api/demo")
    assert response.status_code == 200
    return response.json()
