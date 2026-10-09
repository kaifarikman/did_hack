"""Настройки LLM из окружения. Ключ хранится только здесь и в заголовке запроса."""
from __future__ import annotations

import os
import math
from dataclasses import dataclass, field


@dataclass(frozen=True)
class LlmConfig:
    endpoint: str
    model: str
    api_key: str = field(repr=False)  # repr скрыт: ключ не должен попасть в логи
    timeout_s: float = 8.0  # общий бюджет всех попыток одного плана
    max_attempts: int = 2
    failure_threshold: int = 2
    recovery_cooldown_s: float = 30.0

    def __post_init__(self) -> None:
        if not math.isfinite(self.timeout_s) or self.timeout_s <= 0:
            raise ValueError("LLM_TIMEOUT_S must be finite and positive")
        if self.max_attempts < 1 or self.failure_threshold < 1:
            raise ValueError("LLM attempts and failure threshold must be positive")
        if not math.isfinite(self.recovery_cooldown_s) or self.recovery_cooldown_s <= 0:
            raise ValueError("LLM_RECOVERY_COOLDOWN_S must be finite and positive")

    def validate_execution_deadline(self, deadline_s: float) -> None:
        if self.timeout_s >= deadline_s:
            raise ValueError("LLM_TIMEOUT_S must be smaller than the planner execution deadline")

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
            failure_threshold=int(env.get("LLM_FAILURE_THRESHOLD", "2")),
            recovery_cooldown_s=float(env.get("LLM_RECOVERY_COOLDOWN_S", "30")),
        )
