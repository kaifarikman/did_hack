"""LLM-планировщик: структурированный план из нескольких подцелей от OpenAI-совместимого API.

Разбор строгий: лишние поля, неверные типы, NaN/Infinity и пустые шаги отклоняются. План —
только намерения; скорости, подтверждение гипотез и проверка энергии остаются за алгоритмом.
"""
from __future__ import annotations

import json
import math
import time

from adapters.llm.config import LlmConfig
from adapters.llm.prompt import SYSTEM_PROMPT, build_user_message
from adapters.llm.transport import ChatTransport, TransportError, UrllibChatTransport
from application.ports import CancelCheck, PlannerError
from domain.geometry import Point
from domain.plans import MAX_PLAN_STEPS, MissionPlan, PlanStep
from domain.subgoals import GoalKind, PlanningContext, Subgoal

MAX_REASON_CHARS = 300
MAX_EVIDENCE = 6
STEP_FIELDS = {"kind", "target", "reason"}
STEP_OPTIONAL = {"evidence", "revise_if"}
PLAN_FIELDS = {"steps", "rationale"}
PLAN_OPTIONAL = {"premises"}


class LlmResponseError(Exception):
    """Ответ модели не соответствует схеме."""


def _reject_constant(name: str) -> float:
    raise LlmResponseError(f"недопустимое число {name}")


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise LlmResponseError(f"повторяющееся поле {key}")
        result[key] = value
    return result


def _load_json(content: str) -> object:
    text = content.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if len(lines) < 3 or lines[0].strip() not in ("```", "```json") or lines[-1].strip() != "```":
            raise LlmResponseError("неверная JSON code fence")
        text = "\n".join(lines[1:-1]).strip()
    try:
        return json.loads(text, parse_constant=_reject_constant, object_pairs_hook=_unique_object)
    except json.JSONDecodeError:
        raise LlmResponseError("ответ модели не JSON") from None


def _text(value: object, field: str, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise LlmResponseError(f"{field} должен быть непустой строкой")
    return value.strip()[:MAX_REASON_CHARS]


def _texts(value: object, field: str, limit: int) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise LlmResponseError(f"{field} должен быть списком строк")
    return tuple(item.strip()[:MAX_REASON_CHARS] for item in value if item.strip())[:limit]


def _step(raw: object) -> PlanStep:
    if not isinstance(raw, dict) or not STEP_FIELDS <= set(raw) or set(raw) - STEP_FIELDS - STEP_OPTIONAL:
        raise LlmResponseError("шаг: ожидаются поля kind, target, reason и необязательные evidence, revise_if")
    try:
        kind = GoalKind(raw["kind"])
    except ValueError:
        raise LlmResponseError("неизвестный kind") from None
    reason = _text(raw["reason"], "reason")
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
    evidence = _texts(raw.get("evidence", []), "evidence", MAX_EVIDENCE)
    revise_if = raw.get("revise_if")
    revise = None if revise_if is None else _text(revise_if, "revise_if")
    return PlanStep(Subgoal(kind, point, reason, source="llm"), evidence, revise)


def parse_subgoal(content: str) -> Subgoal:
    """Одна подцель (совместимость с ответом MVP)."""
    raw = _load_json(content)
    if not isinstance(raw, dict) or set(raw) != STEP_FIELDS:
        raise LlmResponseError("ожидаются ровно поля kind, target, reason")
    return _step(raw).goal


def parse_plan(content: str, context: PlanningContext) -> MissionPlan:
    raw = _load_json(content)
    if not isinstance(raw, dict) or not PLAN_FIELDS <= set(raw) or set(raw) - PLAN_FIELDS - PLAN_OPTIONAL:
        raise LlmResponseError("план: ожидаются поля steps, rationale и необязательное premises")
    steps = raw["steps"]
    if not isinstance(steps, list) or not 1 <= len(steps) <= MAX_PLAN_STEPS:
        raise LlmResponseError(f"steps: от 1 до {MAX_PLAN_STEPS} шагов")
    return MissionPlan(
        plan_id=context.plan_id, run_id=context.run_id, model_epoch=context.model_epoch,
        map_revision=context.map_revision, steps=tuple(_step(step) for step in steps),
        rationale=_text(raw["rationale"], "rationale"),
        premises=_texts(raw.get("premises", []), "premises", 4), source="llm",
    )


class OpenAiCompatiblePlanner:
    def __init__(self, config: LlmConfig, transport: ChatTransport | None = None) -> None:
        self._config = config
        self._transport = transport or UrllibChatTransport()
        self._consecutive_failures = 0
        self._retry_after_s = 0.0

    def propose(self, context: PlanningContext, is_cancelled: CancelCheck) -> MissionPlan:
        if is_cancelled():
            raise PlannerError("запрос отменён")
        if time.monotonic() < self._retry_after_s:
            raise PlannerError("LLM временно недоступна; повтор после паузы восстановления")
        try:
            plan = self._request(context, is_cancelled)
        except PlannerError:
            if not is_cancelled():
                self._consecutive_failures += 1
                if self._consecutive_failures >= self._config.failure_threshold:
                    self._retry_after_s = time.monotonic() + self._config.recovery_cooldown_s
            raise
        self._consecutive_failures = 0
        self._retry_after_s = 0.0
        return plan

    def _request(self, context: PlanningContext, is_cancelled: CancelCheck) -> MissionPlan:
        deadline_s = time.monotonic() + self._config.timeout_s
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
            remaining_s = deadline_s - time.monotonic()
            if remaining_s <= 0:
                break
            try:
                reply = self._transport.post_json(
                    self._config.endpoint, payload, self._config.api_key, remaining_s
                )
                if is_cancelled():
                    raise PlannerError("запрос отменён")
                if time.monotonic() >= deadline_s:
                    raise PlannerError("LLM не ответила в общий срок запроса")
                content = reply["choices"][0]["message"]["content"]
                if not isinstance(content, str):
                    raise LlmResponseError("content не строка")
                return parse_plan(content, context)
            except TransportError as error:
                last_error = f"LLM недоступна: {error}"
            except (LlmResponseError, KeyError, IndexError, TypeError) as error:
                last_error = f"LLM вернула неверный ответ: {error}"
        raise PlannerError(last_error)
