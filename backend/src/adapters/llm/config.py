"""Настройки LLM из окружения. Ключ хранится только здесь и в заголовке запроса."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class LlmConfig:
    endpoint: str
    model: str
    api_key: str = field(repr=False)  # repr скрыт: ключ не должен попасть в логи
    timeout_s: float = 8.0
    max_attempts: int = 2

    @staticmethod
    def from_environment(environ: dict[str, str] | None = None) -> "LlmConfig | None":
        env = os.environ if environ is None else environ
        endpoint, model, api_key = env.get("LLM_ENDPOINT"), env.get("LLM_MODEL"), env.get("LLM_API_KEY")
        if not (endpoint and model and api_key):
            return None
        return LlmConfig(
            endpoint, model, api_key,
            timeout_s=float(env.get("LLM_TIMEOUT_S", "8")),
            max_attempts=int(env.get("LLM_MAX_ATTEMPTS", "2")),
        )
