"""HTTP-транспорт OpenAI-совместимого endpoint. Заменяется двойником в тестах."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Protocol


class TransportError(Exception):
    """Сбой связи или ответ сервера. Текст не содержит заголовков авторизации."""


class ChatTransport(Protocol):
    def post_json(self, url: str, payload: dict, api_key: str, timeout_s: float) -> dict: ...


class UrllibChatTransport:
    def post_json(self, url: str, payload: dict, api_key: str, timeout_s: float) -> dict:
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout_s) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise TransportError(f"HTTP {error.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise TransportError("сеть недоступна или таймаут") from None
        except json.JSONDecodeError:
            raise TransportError("ответ не JSON") from None
