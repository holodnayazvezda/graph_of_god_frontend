from __future__ import annotations

import json
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


@dataclass(frozen=True, slots=True)
class BackendClientError(Exception):
    message: str
    status_code: int = 502

    def __str__(self) -> str:
        return self.message


class BackendClient:
    def __init__(self, *, base_url: str, timeout_seconds: float) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds

    def create_social_graph_job(self, profiles: list[str]) -> dict[str, object]:
        query = urlencode({"profiles": profiles}, doseq=True)
        return self._request_json(
            "POST",
            f"/api/v1/social-graphs/jobs?{query}",
        )

    def get_social_graph_job(self, job_id: str) -> dict[str, object]:
        return self._request_json("GET", f"/api/v1/social-graphs/jobs/{job_id}")

    def _request_json(self, method: str, path: str) -> dict[str, object]:
        request = Request(
            f"{self._base_url}{path}",
            method=method,
            headers={"Accept": "application/json"},
        )

        try:
            with urlopen(request, timeout=self._timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            payload = _decode_error_payload(error)
            message = payload.get("detail") if isinstance(payload, dict) else None
            raise BackendClientError(
                message=message or f"Backend returned HTTP {error.code}.",
                status_code=error.code,
            ) from error
        except URLError as error:
            raise BackendClientError(
                message=f"Не удалось подключиться к backend: {error.reason}.",
                status_code=502,
            ) from error
        except json.JSONDecodeError as error:
            raise BackendClientError(
                message="Backend вернул невалидный JSON.",
                status_code=502,
            ) from error

        if not isinstance(payload, dict):
            raise BackendClientError(
                message="Backend вернул неожиданный формат ответа.",
                status_code=502,
            )

        return payload


def _decode_error_payload(error: HTTPError) -> dict[str, object] | str | None:
    try:
        raw_payload = error.read()
    except Exception:
        return None

    if not raw_payload:
        return None

    try:
        return json.loads(raw_payload.decode("utf-8"))
    except Exception:
        return raw_payload.decode("utf-8", errors="replace")
