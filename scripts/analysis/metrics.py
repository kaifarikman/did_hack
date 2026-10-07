"""Метрики по выгрузкам прогонов: сборы, возвраты, энергия, прогноз расхода, гипотезы, обнаружения,
ложные тревоги, запросы плана и резерв. Учитываются все найденные прогоны, без отбора удачных.

Форматы на входе (каталог или файлы):
- каталог прогона `<run_id>/journal.jsonl + state.json [+ manifest.json] [+ truth.json]`
  (раскладка verification.md; `truth.json` читается только для оценки обнаружений после прогона);
- приёмка MVP `run-N.json` с полями `final_state` и `journal`;
- экспорт панели `{run_id, entries, ...}` (без финального состояния — только научные метрики).

Запуск: python3 scripts/analysis/metrics.py ПУТЬ [ПУТЬ ...] --out artifacts/analysis/metrics.json
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import statistics
from collections import Counter
from pathlib import Path

ROUTE = re.compile(r"Расход по маршруту ≈ (?P<route>\d+(?:\.\d+)?).*?батарея (?P<battery>\d+(?:\.\d+)?)")
CHANGE_TO_DETECTION = {"terrain": "terrain", "hazard": "hazard", "sensor": "sensor"}


def _read_jsonl(path: Path) -> list[dict]:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def load_runs(paths: list[Path]) -> list[dict]:
    runs: list[dict] = []
    for path in paths:
        if path.is_dir() and (path / "journal.jsonl").exists():
            runs.append({
                "source": str(path), "entries": _read_jsonl(path / "journal.jsonl"),
                "state": json.loads((path / "state.json").read_text()) if (path / "state.json").exists() else None,
                "manifest": json.loads((path / "manifest.json").read_text()) if (path / "manifest.json").exists() else {},
                "truth": json.loads((path / "truth.json").read_text()) if (path / "truth.json").exists() else None,
            })
        elif path.is_dir():
            runs.extend(load_runs(sorted(path.iterdir())))
        elif path.suffix == ".json":
            payload = json.loads(path.read_text())
            if isinstance(payload, dict) and "journal" in payload and "final_state" in payload:
                runs.append({"source": str(path), "entries": payload["journal"], "state": payload["final_state"],
                             "manifest": {}, "truth": None})
            elif isinstance(payload, dict) and "entries" in payload and "run_id" in payload:
                runs.append({"source": str(path), "entries": payload["entries"], "state": None,
                             "manifest": {}, "truth": None})
    return runs


def _conclusion_kind(text: str | None) -> str | None:
    if not text:
        return None
    lowered = text.lower()
    if lowered.startswith("подтвержд"):
        return "confirmed"
    if lowered.startswith("опроверг"):
        return "refuted"
    if lowered.startswith("недостаточно"):
        return "insufficient"
    return "other"


def _detection_family(detection_id: str) -> str:
    return detection_id.split("-")[0]


def run_metrics(run: dict) -> dict:
    entries, state, manifest = run["entries"], run["state"], run["manifest"]
    titles = Counter(entry["title"] for entry in entries)
    conclusions = Counter(
        kind for kind in (_conclusion_kind(entry.get("conclusion")) for entry in entries if entry.get("hypothesis_id"))
        if kind
    )
    detections: dict[str, float | None] = {}
    for entry in entries:
        detection = entry.get("detection_id")
        if detection and detection not in detections:
            detections[detection] = entry.get("simulation_time_s")
    plans = [entry for entry in entries if entry["title"] == "План получен"]
    route_entries = [entry for entry in entries if entry["title"].startswith("Подцель:")]
    prediction_errors = []
    for current, following in zip(route_entries, route_entries[1:]):
        first, second = ROUTE.search(current["detail"]), ROUTE.search(following["detail"])
        if first and second:
            actual = float(first["battery"]) - float(second["battery"])
            prediction_errors.append(float(first["route"]) - actual)  # >0 — прогноз консервативен
    metrics = {
        "source": run["source"],
        "run_id": (state or {}).get("run_id") or manifest.get("run_id"),
        "profile": (state or {}).get("scenario") or manifest.get("profile"),
        "map_mode": (state or {}).get("map_mode", manifest.get("map_mode", "static")),
        "robot_count": manifest.get("robot_count", 1 if not (state or {}).get("team") else len(state["team"]["robots"])),
        "status": (state or {}).get("status"),
        "error": ((state or {}).get("last_error") or {}).get("code"),
        "collected": (state or {}).get("samples_collected", titles["Образец собран"]),
        "returned": (state or {}).get("status") == "completed",
        "battery_left": (state or {}).get("battery_remaining"),
        "false_collects": titles["Сбор не удался"],
        "hypotheses": len({entry["hypothesis_id"] for entry in entries if entry.get("hypothesis_id")}),
        "conclusions": dict(conclusions),
        "detections": {family: sum(1 for d in detections if _detection_family(d) == family)
                       for family in ("terrain", "hazard", "sensor")},
        "replans": titles["Перепланирование"],
        "plans_llm": sum(1 for entry in plans if " от llm" in entry["detail"]),
        "plans_with_fallback_reason": sum(1 for entry in plans if "Резерв:" in entry["detail"]),
        "planner_requests": (((state or {}).get("research") or {}).get("planner_requests")),
        "route_prediction_error_median": round(statistics.median(prediction_errors), 3) if prediction_errors else None,
        "route_predictions": len(prediction_errors),
    }
    truth = run["truth"]
    if truth is not None:
        metrics["judge"] = truth.get("judge")
        metrics["change_detection"] = evaluate_detections(truth.get("applied_changes", []), detections,
                                                          truth.get("observable", {}))
    return metrics


def evaluate_detections(changes: list[list], detections: dict[str, float | None],
                        observable: dict[str, bool] | None = None) -> dict:
    """Сопоставление закрытого расписания с обнаружениями агента (только после прогона)."""
    result: dict[str, dict] = {}
    used: set[str] = set()
    for time_s, label in changes:
        family = next((value for key, value in CHANGE_TO_DETECTION.items() if label.startswith(key)), None)
        if family is None or label.endswith("_ok"):
            continue
        hit = next(
            (d for d, t in sorted(detections.items(), key=lambda item: item[1] or 0)
             if d not in used and _detection_family(d) == family and t is not None and t >= time_s),
            None,
        )
        if hit:
            used.add(hit)
        result[label] = {"changed_at_s": time_s, "detection_id": hit,
                         "observable": (observable or {}).get(label),
                         "delay_s": None if hit is None else round(detections[hit] - time_s, 1)}
    false_alarms = [d for d in detections if d not in used and _detection_family(d) != "hazard"]
    return {"changes": result, "unmatched_detections": false_alarms}


def summarize(metrics: list[dict]) -> dict:
    groups: dict[str, list[dict]] = {}
    for item in metrics:
        key = f"{item['profile']}/{item['map_mode']}/x{item['robot_count']}"
        groups.setdefault(key, []).append(item)
    summary = {}
    for key, items in sorted(groups.items()):
        collected = [item["collected"] for item in items]
        errors = [item["route_prediction_error_median"] for item in items if item["route_prediction_error_median"] is not None]
        conclusions = Counter()
        for item in items:
            conclusions.update(item["conclusions"])
        summary[key] = {
            "runs": len(items),
            "returned": sum(item["returned"] for item in items),
            "statuses": dict(Counter(item["status"] for item in items)),
            "collected_mean": round(statistics.mean(collected), 2),
            "collected_median": statistics.median(collected),
            "collected_min_max": [min(collected), max(collected)],
            "false_collects_mean": round(statistics.mean(item["false_collects"] for item in items), 2),
            "conclusions": dict(conclusions),
            "detections": {family: sum(item["detections"][family] for item in items) for family in ("terrain", "hazard", "sensor")},
            "replans": sum(item["replans"] for item in items),
            "plans_llm": sum(item["plans_llm"] for item in items),
            "route_prediction_error_median": round(statistics.median(errors), 3) if errors else None,
        }
        evaluated = [item["change_detection"] for item in items if "change_detection" in item]
        if evaluated:
            per_label: dict[str, list] = {}
            for evaluation in evaluated:
                for label, row in evaluation["changes"].items():
                    per_label.setdefault(label, []).append(row)
            summary[key]["change_detection"] = {
                label: {"applied": len(rows), "observable": sum(row.get("observable") is True for row in rows),
                        "detected": sum(row["detection_id"] is not None for row in rows),
                        "detected_when_observable": sum(row["detection_id"] is not None for row in rows
                                                        if row.get("observable") is True),
                        "median_delay_s": statistics.median([row["delay_s"] for row in rows if row["delay_s"] is not None])
                        if any(row["delay_s"] is not None for row in rows) else None}
                for label, rows in per_label.items()
            }
            summary[key]["unmatched_detections"] = sum(len(e["unmatched_detections"]) for e in evaluated)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    metrics = [run_metrics(run) for run in load_runs(args.paths)]
    summary = summarize(metrics)
    args.out.write_text(json.dumps({"runs": metrics, "summary": summary}, ensure_ascii=False, indent=1))
    for key, value in summary.items():
        print(key, json.dumps(value, ensure_ascii=False))


if __name__ == "__main__":
    main()
