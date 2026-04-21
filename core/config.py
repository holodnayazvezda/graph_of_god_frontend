from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from graph_of_god_frontend.core.dotenv import load_dotenv

FRONTEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DOTENV_PATH = FRONTEND_ROOT / ".env"


@dataclass(frozen=True, slots=True)
class FrontendConfig:
    backend_base_url: str = "http://127.0.0.1:8000"
    host: str = "127.0.0.1"
    port: int = 5000
    secret_key: str = "graph-of-god-frontend-dev"
    request_timeout_seconds: float = 60.0
    max_profiles: int = 5
    poll_interval_ms: int = 1500

    @classmethod
    def from_env(cls, *, dotenv_path: Path | None = None) -> "FrontendConfig":
        load_dotenv(dotenv_path or DEFAULT_DOTENV_PATH)

        backend_base_url = (
            os.getenv("GRAPH_OF_GOD_FRONTEND_BACKEND_BASE_URL", "http://127.0.0.1:8000").strip()
            or "http://127.0.0.1:8000"
        )
        host = os.getenv("GRAPH_OF_GOD_FRONTEND_HOST", "127.0.0.1").strip() or "127.0.0.1"
        port = _parse_positive_int(
            raw_value=os.getenv("GRAPH_OF_GOD_FRONTEND_PORT", "5000").strip() or "5000",
            field_name="GRAPH_OF_GOD_FRONTEND_PORT",
        )
        secret_key = (
            os.getenv("GRAPH_OF_GOD_FRONTEND_SECRET_KEY", "graph-of-god-frontend-dev").strip()
            or "graph-of-god-frontend-dev"
        )
        request_timeout_seconds = _parse_positive_float(
            raw_value=os.getenv("GRAPH_OF_GOD_FRONTEND_TIMEOUT_SECONDS", "60").strip() or "60",
            field_name="GRAPH_OF_GOD_FRONTEND_TIMEOUT_SECONDS",
        )
        max_profiles = _parse_positive_int(
            raw_value=os.getenv("GRAPH_OF_GOD_FRONTEND_MAX_PROFILES", "5").strip() or "5",
            field_name="GRAPH_OF_GOD_FRONTEND_MAX_PROFILES",
        )
        poll_interval_ms = _parse_positive_int(
            raw_value=os.getenv("GRAPH_OF_GOD_FRONTEND_POLL_INTERVAL_MS", "1500").strip() or "1500",
            field_name="GRAPH_OF_GOD_FRONTEND_POLL_INTERVAL_MS",
        )

        return cls(
            backend_base_url=backend_base_url.rstrip("/"),
            host=host,
            port=port,
            secret_key=secret_key,
            request_timeout_seconds=request_timeout_seconds,
            max_profiles=max_profiles,
            poll_interval_ms=poll_interval_ms,
        )


def _parse_positive_int(*, raw_value: str, field_name: str) -> int:
    try:
        value = int(raw_value)
    except ValueError as error:
        raise ValueError(f"{field_name} должен быть целым числом.") from error

    if value <= 0:
        raise ValueError(f"{field_name} должен быть больше нуля.")
    return value


def _parse_positive_float(*, raw_value: str, field_name: str) -> float:
    try:
        value = float(raw_value)
    except ValueError as error:
        raise ValueError(f"{field_name} должен быть числом.") from error

    if value <= 0:
        raise ValueError(f"{field_name} должен быть больше нуля.")
    return value
