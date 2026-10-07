"""Промпт планировщика. Контекст — только разрешённые наблюдения и оценки агента, без истины сценария."""
from __future__ import annotations

import json

from domain.subgoals import PlanningContext

SYSTEM_PROMPT = (
    "Ты верхнеуровневый планировщик автономного робота-исследователя. Цель задаёт текст миссии; "
    "по умолчанию — найти и собрать как можно больше скрытых образцов по шумному скалярному сигналу "
    "близости (0..1, без направления) и вернуться на базу с положительной батареей. Ты составляешь "
    "короткий план из 1..max_plan_steps подцелей, а не скорости. Виды: explore (исследовать точку), "
    "approach (подойти к точке с сильным сигналом), collect (попытка сбора на месте, нужен сигнал выше "
    "порога, target = null), return (вернуться на базу). Каждый шаг алгоритм проверит отдельно "
    "(достижимость, энергия туда-обратно с резервом, лимиты сбора) и может отклонить. Выбирай target "
    "из candidates или refine_candidates, либо базу для return. Если reserve_low — только return. "
    "Не объявляй гипотезы подтверждёнными: выводы делает алгоритм по измерениям. В evidence указывай "
    "ссылки из journal_tail (например \"#12\") или detection_id, на которые опираешься. В revise_if — "
    "при каком наблюдении план нужно пересмотреть. Ответ — только JSON: "
    '{"steps": [{"kind": "explore|approach|collect|return", '
    '"target": {"position_x_m": число, "position_y_m": число} или null, "reason": "кратко, по-русски", '
    '"evidence": ["#12"], "revise_if": "условие или null"}], '
    '"rationale": "почему такой порядок", "premises": ["предпосылка"]}.'
)


def build_user_message(context: PlanningContext) -> str:
    def point(p) -> dict:
        return {"position_x_m": round(p.x_m, 3), "position_y_m": round(p.y_m, 3)}

    def candidate(c) -> dict:
        item = {"target": point(c.point), "score": round(c.score, 3), "expected_signal": round(c.expected_signal, 3)}
        if c.energy_to is not None:
            item["energy_to"] = round(c.energy_to, 2)
            item["energy_back"] = round(c.energy_back, 2)
        return item

    payload = {
        "mission_text": context.mission_text,
        "max_plan_steps": context.max_plan_steps,
        "pose": {**point(context.pose.point), "heading_rad": round(context.pose.heading_rad, 3)},
        "base": point(context.base),
        "battery_remaining": round(context.battery_remaining, 2),
        "battery_initial": context.battery_initial,
        "sample_signal": context.sample_signal,
        "local_signal": None if context.local_signal is None else round(context.local_signal, 3),
        "best_signal": context.best_signal,
        "at_signal_peak": context.at_signal_peak,
        "samples_collected": context.samples_collected,
        "samples_possible_in_profile": context.target_samples,
        "return_energy_estimate": context.return_energy_estimate,
        "reserve_low": context.reserve_low,
        "collect_attempts_here": context.collect_attempts_here,
        "sensor": {"state": context.sensor_state, "quality": round(context.sensor_quality, 2)},
        "candidates": [candidate(c) for c in context.candidates],
        "refine_candidates": [candidate(c) for c in context.refine_candidates],
        "terrain_estimates": [
            {"center": point(t.center), "energy_per_m": round(t.energy_per_m, 3), "confidence": round(t.confidence, 2)}
            for t in context.terrain
        ],
        "observed_hazards": [{"center": point(center), "radius_m": round(radius, 2)} for center, radius in context.hazards],
        "hypotheses": list(context.hypotheses),
        "detections": list(context.detections),
        "recent_signals": [{**point(p), "signal": round(s, 3)} for p, s in context.recent_signals],
        "journal_tail": list(context.journal_tail),
    }
    return json.dumps(payload, ensure_ascii=False)
