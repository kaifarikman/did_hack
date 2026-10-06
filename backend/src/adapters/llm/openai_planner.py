"""LLM-планировщик: структурированная подцель от OpenAI-совместимого API."""
from __future__ import annotations

import json
import math

from adapters.llm.config import LlmConfig
from adapters.llm.prompt import SYSTEM_PROMPT, build_user_message
from adapters.llm.transport import ChatTransport, TransportError, UrllibChatTransport
from application.ports import CancelCheck, PlannerError
from domain.geometry import Point
from domain.subgoals import GoalKind, PlanningContext, Subgoal

MAX_REASON_CHARS = 300


class LlmResponseError(Exception):
    """Ответ модели не соответствует схеме."""


def parse_subgoal(content: str) -> Subgoal:
    """Строгий разбор: лишние/пропущенные поля и неверные типы отклоняются."""
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[4:] if text.startswith("json") else text
    try:
        raw = json.loads(text)
    except json.JSONDecodeError:
        raise LlmResponseError("ответ модели не JSON") from None
    if not isinstance(raw, dict) or set(raw) != {"kind", "target", "reason"}:
        raise LlmResponseError("ожидаются ровно поля kind, target, reason")
    try:
        kind = GoalKind(raw["kind"])
    except ValueError:
        raise LlmResponseError("неизвестный kind") from None
    reason = raw["reason"]
    if not isinstance(reason, str) or not reason.strip():
        raise LlmResponseError("reason должен быть непустой строкой")
    target = raw["target"]
    point: Point | None = None
    if target is not None:
        if not isinstance(target, dict) or set(target) != {"position_x_m", "position_y_m"}:
            raise LlmResponseError("target: ожидаются position_x_m и position_y_m")
        values = [target["position_x_m"], target["position_y_m"]]
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in values):
            raise LlmResponseError("координаты должны быть конечными числами")
        point = Point(float(values[0]), float(values[1]))
    if kind in (GoalKind.EXPLORE, GoalKind.APPROACH) and point is None:
        raise LlmResponseError(f"{kind.value} требует target")
    return Subgoal(kind, point, reason.strip()[:MAX_REASON_CHARS], source="llm")


class OpenAiCompatiblePlanner:
    def __init__(self, config: LlmConfig, transport: ChatTransport | None = None) -> None:
        self._config = config
        self._transport = transport or UrllibChatTransport()

    def propose(self, context: PlanningContext, is_cancelled: CancelCheck) -> Subgoal:
        payload = {
            "model": self._config.model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_user_message(context)},
            ],
        }
        last_error = "нет попыток"
        for _ in range(self._config.max_attempts):
            if is_cancelled():
                raise PlannerError("запрос отменён")
            try:
                reply = self._transport.post_json(
                    self._config.endpoint, payload, self._config.api_key, self._config.timeout_s
                )
                content = reply["choices"][0]["message"]["content"]
                if not isinstance(content, str):
                    raise LlmResponseError("content не строка")
                return parse_subgoal(content)
            except TransportError as error:
                last_error = f"LLM недоступна: {error}"
            except (LlmResponseError, KeyError, IndexError, TypeError) as error:
                last_error = f"LLM вернула неверный ответ: {error}"
        raise PlannerError(last_error)
