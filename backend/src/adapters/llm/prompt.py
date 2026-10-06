"""Промпт и разбор ответа модели. Контекст — только разрешённые наблюдения."""
from __future__ import annotations

import json

from domain.subgoals import PlanningContext

SYSTEM_PROMPT = (
    "Ты верхнеуровневый планировщик автономного робота-исследователя. Цель: найти и собрать скрытые "
    "образцы по шумному скалярному сигналу близости (0..1, без направления) и вернуться на базу с "
    "положительной батареей. Ты выбираешь ОДНУ подцель, а не скорости. Виды: explore (исследовать "
    "точку), approach (подойти к точке с сильным сигналом), collect (попытка сбора на месте, нужен "
    "сигнал выше порога), return (вернуться на базу). Выбирай target только из candidates, либо базу "
    "для return. Если запас энергии мал (reserve_low) — return. Ответ — только JSON без пояснений вне него: "
    '{"kind": "explore|approach|collect|return", '
    '"target": {"position_x_m": число, "position_y_m": число} или null, "reason": "кратко, по-русски"}. '
    "Для collect target = null."
)


def build_user_message(context: PlanningContext) -> str:
    def point(p) -> dict:
        return {"position_x_m": round(p.x_m, 3), "position_y_m": round(p.y_m, 3)}

    payload = {
        "pose": {**point(context.pose.point), "heading_rad": round(context.pose.heading_rad, 3)},
        "base": point(context.base),
        "battery_remaining": round(context.battery_remaining, 2),
        "battery_initial": context.battery_initial,
        "sample_signal": context.sample_signal,
        "best_signal": context.best_signal,
        "samples_collected": context.samples_collected,
        "return_energy_estimate": context.return_energy_estimate,
        "reserve_low": context.reserve_low,
        "collect_attempts_here": context.collect_attempts_here,
        "candidates": [
            {"target": point(c.point), "score": round(c.score, 3), "expected_signal": round(c.expected_signal, 3)}
            for c in context.candidates
        ],
        "terrain_estimates": [
            {"center": point(t.center), "energy_per_m": round(t.energy_per_m, 3), "confidence": round(t.confidence, 2)}
            for t in context.terrain
        ],
        "recent_signals": [{**point(p), "signal": round(s, 3)} for p, s in context.recent_signals],
        "journal_tail": list(context.journal_tail),
    }
    return json.dumps(payload, ensure_ascii=False)
