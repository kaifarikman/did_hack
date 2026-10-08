# Исправления X2: экраны

## Для X1

**Срочно (регрессия после UI-31):** `shared/ui/banner/styles.module.css`: у `.content` теперь `flex-direction: column`, а у `.body` осталось `flex: 1 1 var(--banner-text-min)` (240px). В колонке это высота: каждая плашка минимум 264px (видно на `disconnect`, экспорт журнала, команда). Нужно `flex: none` (или `flex: 0 1 auto`) у `.body`.


Просьбы к `shared` и конфигам. Пока не сделано, X2 обходится локально и отмечает это в таблице.

1. **R-03, язык контента backend.** Нужен один источник: `BACKEND_CONTENT_LANG` (сейчас `"ru"`) и компонент `<BackendText as? children>` с `lang={BACKEND_CONTENT_LANG}` в `@/ui/shared/i18n` (или `shared/ui`). X2 заменит им 13 литералов `lang="ru"`.
2. **UI-04, ScrollArea.** `max-block-size` на корне сейчас не ограничивает высоту: строка грида `auto` растёт по содержимому, и вьюпорт не прокручивается. Нужно `grid-template-rows: minmax(0, 1fr)` (или flex-колонка) у `.root`. И `scroll-padding-block: var(--scroll-fade-size)` у `.viewport` (UI-02: фокус не уходит под градиент).
3. **UI-18, view transition.** В `global.css`: `:root[data-view-transition="mission"]::view-transition-old(root), :root[data-view-transition="mission"]::view-transition-new(root) { animation: none }`. X2 даёт карточке миссии `view-transition-name: mission`.
4. **UI-19.** У `StatusBadge` со `swapKey` нужен `data-motion="fade"` на `Swap`, чтобы в reduced был мягкий fade.
5. **UI-20.** `Segmented` и кнопки `NumberField` — `min-block-size: var(--target-min)`.
6. **UI-21.** `errors.json`, `common.json`: «backend» → «сервер» (ru), «server» (en). В `mission.json` X2 уже заменил.
7. **UI-25.** `Disclosure`: шеврон `align-self: start` по первой строке.
8. **UI-31.** `Banner`: действие выровнять по колонке текста.
9. **UI-32.** Слой `Tooltip`/`Popover` в `body` вне ориентиров даёт axe `region`: портал внутрь корневого контейнера или роль с меткой.
10. **UI-35.** `Select`: проп `hideLabel` (подпись остаётся для aria, визуально скрыта), чтобы «Сценарий демо» не раздувал шапку.
11. **S-01.** Fallback-генератор id для `main.tsx` вместо `crypto.randomUUID` вне secure context.
12. **UI-06, UI-13 (иконка progress у других бейджей), UI-27, UI-28, UI-30 (цвет стен в палитре канваса), UI-33** — целиком в `shared`.

## Доделано после остановки

Дата: 2026-10-08. Дерево: `.claude/worktrees/frontend-screens/frontend`, ветка `frontend`, база `d5615dd`. Git не трогался. Незакоммиченных правок X2 в дереве не было: всё, что он успел, вошло в `d5615dd`. Битых правок не найдено. Таблицы X2 «сделано/не сделано» в этом файле не было, поэтому хвосты сверены по коду.

### Уже было сделано X2 (проверено в коде)

- UI-18: `view-transition-name: mission` у карточки миссии (`mission-card/styles.module.css`).
- R-15: `JOURNAL_KINDS` берётся из `@/domain/contract`; `connectionStatus(view)` используется в `app-shell` и `app-notices`, локальных `headerConnection`/`isOffline` нет.
- R-17: `canvasPalette.ts` лежит в `features/map/`, в `SIGNAL_SCOPES` старого пути нет.
- R-13 (названные): `TRANSPARENT`, `researchFrom`, `isFixtureScenarioName`, `STEP_STATUS_LABELS`, `ENTRY_COUNT_LABEL`, `ROBOT_COUNT_LABEL` удалены; `ResearchKey` не экспортируется.
- UI-04/UI-10: журнал в своём `ScrollArea`, «Загрузить ещё», подтверждение экспорта.

### Сделано сейчас

| ID | Что сделано | Файлы |
| --- | --- | --- |
| Biome | `noExcessiveCognitiveComplexity` в `JournalCard` (16 > 15): карточка разбита по ответственности. Список, постраничный показ, «свежие» записи и номера гипотез — `journal-list`; плашки экспорта — `journal-export`. Формат `unityCss.ts` | `features/journal/journal-{card,list,export}/*`, `scripts/checks/rules/unityCss.ts` |
| R-25 | Текст сервера (`params.detail`) выводится через `<BackendText>`: в ошибке журнала и в плашке экспорта. `ErrorState.description` принимает `ReactNode` | `journal-card`, `journal-export`, `shared/ui/error-state` |
| S-08 / UI-33 | `fetch("/config.json")` с `AbortSignal.timeout(2000)`. `public/config.json` = `{}`: в dev/preview нет 404, источник берётся из `VITE_DATA_SOURCE`; в Docker файл перезаписывает `40-runtime-config.sh` | `src/main.tsx`, `public/config.json` |
| R-13 | Удалён мёртвый код, нужный только тестам: `placeLabels` (раскладку делает `LabelSink`), `withAlpha`, `buildHypothesisChain` + `HypothesisChain`; тесты переписаны на живой код (`LabelSink.reserve/isFree`, `listHypothesisIds`). У 83 символов, которые используются только в своём файле, снят `export` (интерфейсы `XxxProps` оставлены). Оставлены экспорты для тестов, которые служат перечислениями или эталоном: `START_BLOCKERS`, `STOP_BLOCKERS`, `worldToScreen`, `screenToWorld` | `src/**`, `tests/domain.test.ts`, `tests/ui/map/*` |
| R-09 | `opacity: 0.55` → токен `--opacity-stale`; `presentation/tokens.css` пересобран | `tokens/elevation.css`, `map-card/styles.module.css` |
| R-22 | `npm run rules -- --prune`: `cyrillic.txt` очищен | `scripts/baselines/cyrillic.txt` |
| e2e axe | Нестабильный `color-contrast` (`team_partial`, `command_unknown`) — замер посреди fade. Причина: часы Playwright идут сами, за ~1 с работы axe сценарий успевает выдать новые события, и бейджи/записи журнала появляются с fade. Исправление: перед axe ждём конца конечных анимаций документа (без scroll-timeline и бесконечных), при нарушениях ждём ещё раз и повторяем axe один раз. В запись axe добавлены селекторы и `failureSummary`. Пауза часов не подходит: axe сам использует `setTimeout` и зависает | `e2e/driver.ts` |

### Результаты

- `npm run rules -- --prune`: 29/29, все 29 баз `scripts/baselines/*.txt` пустые (0 байт).
- `npm run verify`: exit 0. Rules 29/29, typecheck (src + e2e) 0 ошибок, Biome 397 файлов без ошибок, Vitest 74 файла / 863 теста, сборка: CSS 51.12 kB, JS 476.99 kB.
- `npm run e2e`, первый полный прогон: 222 passed, 1 failed (`team_partial · ru`, 1920-normal, axe `color-contrast`); повтор прошёл. Второй полный прогон: 221/2 (снова контраст посреди fade). Стресс-повтор до исправления: 6 из 40 падений, после исправления 0 из 32.
- `npm run e2e`, финальный полный прогон после исправления: **223 passed, 0 failed** (7.0 мин); axe **132/132 чистых, 0 нарушений**; fps 55.0 (порог 55).
- FPS зависит от загрузки машины: отдельные прогоны `--project=fps` дали 50.6 / 55.2 / 50.4 при работающих рядом VS Code и других агентах. Сравнение на одном сервере preview: HEAD `d5615dd` — 56.8 / 58.0 / 58.0, текущее дерево — 59.2 / 56.2 / 60.0. Регрессии нет, но запас над порогом 55 маленький.

### Осталось

- FPS-тест на загруженной машине колеблется около порога 55. Нужен прогон на свободной машине или более устойчивая метрика (например, p95 кадра).
- `ARTIFACTS_DIR` в `e2e/driver.ts` разрешается в `artifacts/frontend` основного checkout, а не worktree (`../../../../../`). Скриншоты и `axe-summary.json` из worktree пишутся туда.
- Без изменений с отчёта X1: файлы GT Standard (`[вопрос]` в `frontend-rules.md` §4), `.gitattributes` с `eol=lf` (A-03).
- Пункты audit-code группы T (слабые и отсутствующие тесты, T-02…T-25) построчно не перепроверялись: таблицы X2 по ним нет.
