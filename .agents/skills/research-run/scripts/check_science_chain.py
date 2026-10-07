"""Проверка научной цепочки по журналу прогона: прогноз до проверки → эксперимент → независимое
измерение → вывод → учёт в решении. Печатает таблицу и список дефектов; код выхода 1 при дефектах.

Запуск: python3 check_science_chain.py <journal.jsonl | каталог прогона | run-N.json | экспорт панели>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def load_entries(path: Path) -> list[dict]:
    if path.is_dir():
        path = path / "journal.jsonl"
    if path.suffix == ".jsonl":
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload.get("journal") or payload.get("entries") or []


def check(entries: list[dict]) -> tuple[list[dict], list[str]]:
    rows, defects = [], []
    ids = list(dict.fromkeys(e["hypothesis_id"] for e in entries if e.get("hypothesis_id")))
    for hypothesis_id in ids:
        related = [e for e in entries if e.get("hypothesis_id") == hypothesis_id]
        first_prediction = next((e["sequence"] for e in related if e.get("expected")), None)
        experiment = next((e["sequence"] for e in related if e["kind"] == "experiment" and e["title"] == "Проверочный проезд"), None)
        conclusion = next((e for e in related if e.get("conclusion")), None)
        measured = conclusion is not None and conclusion.get("observed")
        decision = any(e["title"] == "Вывод учтён в решении" for e in related)
        row = {
            "hypothesis_id": hypothesis_id,
            "prediction_seq": first_prediction,
            "experiment_seq": experiment,
            "measurement": measured or None,
            "conclusion": (conclusion or {}).get("conclusion"),
            "decision_logged": decision,
        }
        rows.append(row)
        if conclusion is None:
            continue  # гипотеза ещё не проверена или данных недостаточно без вывода — не дефект
        if first_prediction is None or (experiment is not None and first_prediction > experiment):
            defects.append(f"{hypothesis_id}: прогноз не записан до проверки")
        if not conclusion["conclusion"].startswith("Недостаточно") and not measured:
            defects.append(f"{hypothesis_id}: вывод без независимого измерения")
        if not conclusion["conclusion"].startswith("Недостаточно") and not decision:
            defects.append(f"{hypothesis_id}: вывод не связан с решением")
    return rows, defects


def main() -> None:
    rows, defects = check(load_entries(Path(sys.argv[1])))
    for row in rows:
        print(json.dumps(row, ensure_ascii=False))
    print(f"гипотез: {len(rows)}, с выводом: {sum(1 for r in rows if r['conclusion'])}, дефектов: {len(defects)}")
    for defect in defects:
        print("ДЕФЕКТ:", defect)
    sys.exit(1 if defects else 0)


if __name__ == "__main__":
    main()
