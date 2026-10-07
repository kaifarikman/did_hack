# Пример применения: серия на подменной среде и прогоны MVP в Gazebo (2026-10-07)

Реальное применение скилла исполнителем B, результаты не отбирались.

## Протокол

- Commit серии: см. `artifacts/analysis/offline-series/*/manifest.json`; профили easy/medium/hard × seed 1–6; готовая карта; один робот; алгоритмический резерв (без LLM).
- В hard подменная среда скрыто добавляет опасность (60 с), подорожание зоны (90 с), шум датчика (150–175 с).

## Команды

```bash
PYTHONPATH=backend/src:backend/tests:scripts/analysis backend/.venv/bin/python scripts/analysis/offline_series.py 6
python3 scripts/analysis/metrics.py artifacts/analysis/offline-series --out artifacts/analysis/metrics-offline-series.json
for d in artifacts/analysis/offline-series/*; do python3 .agents/skills/research-run/scripts/check_science_chain.py $d; done
python3 .agents/skills/research-run/scripts/check_science_chain.py <main>/artifacts/mvp-acceptance/run-4.json
```

## Что нашлось

- Все 18 прогонов вернулись; сборы easy/medium/hard в среднем 2.5 / 3.17 / 3.0. Научная цепочка без дефектов в 18 прогонах.
- Шум датчика обнаружен 6/6 (медиана 0.9 с). Подорожание грунта и опасность в естественных миссиях **не были наблюдаемы ни разу** (робот не знал прежнего уровня зоны или не входил в опасность). Первая версия критерия наблюдаемости засчитала 2 «пропуска», но разбор показал, что робот впервые попал в зону уже после изменения, — критерий уточнен: нужен контакт до и после. Обнаружение грунта поэтому проверяется контролируемыми челночными экспериментами (`artifacts/analysis/adaptation.md`), а не этой серией.
- Прогоны приёмки MVP в Gazebo (`run-3`, `run-4`): проверка цепочки выдала дефект «вывод не связан с решением» — в версии MVP записи «Вывод учтён в решении» ещё не было. Исправлено в B2 для нового кода; старые прогоны остаются как есть и не перезаписываются.
