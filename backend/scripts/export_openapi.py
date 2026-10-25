"""Run from backend: uv run python scripts\\export_openapi.py."""

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

app = create_app(
    Settings(
        _env_file=None,
        chesscom_mode="demo",
        engine_mode="demo",
        llm_provider="deterministic",
    )
)
(BACKEND / "openapi.json").write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")
