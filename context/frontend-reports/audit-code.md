# Независимый аудит кода фронтенда

Дата: 2026-10-08. Аудитор не автор кода. Код, git и ratchet-базы не менялись. Временные файлы и пробы лежат в `scratchpad\audit-code\`: `verify.log`, `checks-probe\`, `tests-probe\`, скрипты `unused-exports.mjs` и `i18n-keys.mjs`.

**Объект:** `.claude/worktrees/frontend-screens/frontend` (объединённое дерево).
**Требования:** `context/frontend-rules.md`, `frontend-plan.md`, `frontend-coverage.md`, `frontend-contracts.md`, `tokens.md`, `AGENTS.md`.
**Проверялись утверждения:** `frontend-reports/f1.md`, `f2.md`.

## Итог

| Серьёзность | Сколько |
| --- | ---: |
| blocker | 4 |
| major | 38 |
| minor | 44 |
| **Всего** | **86** |

Главное:

1. **`npm run verify` красный.** Утверждение F1 и F2 «verify зелёный» на текущем дереве неверно.
2. **Проверки `scripts/checks` пропускают нарушения формально.** Это тот же класс дефекта, что был у touch-targets: `touch-targets` молча пропускает размеры в `rem`, `css-transitions` не раскрывает `var()`. Проверки слоёв архитектуры нет совсем.
3. **Матрица покрытия закрыта на бумаге.** В сверке F2 не меньше 14 ячеек «готово», где названный тест заявленное не проверяет. axe и fps в e2e ничего не валят.

## Фактический результат команд

| Команда | Результат |
| --- | --- |
| `npm run rules` | 28 из 28 «ok», 0 известных нарушений |
| `scripts/baselines/*.txt` | все 22 файла пустые (0 байт) |
| `npm run typecheck` | 0 ошибок |
| `npm run lint` | **1 ошибка:** `src/domain/journal.ts` — format (CRLF). `verify` останавливается с кодом 1 |
| `npx vitest run` (отдельно) | 56 файлов, 648 тестов, все зелёные |
| `npx vite build` (отдельно, в scratchpad) | собирается: CSS 50.4 kB, JS 464.3 kB |
| `tsc` по `e2e/` и `playwright.config.ts` (временный tsconfig) | 0 ошибок, но в `verify` этой проверки нет |
| `node scripts/checks/index.ts` из пустой папки | «rules: 28 checks passed» — ложный зелёный |

## Находки

Обозначения: **A** — инструменты и сборка, **R** — соблюдение правил в коде, **S** — надёжность, **C** — качество `scripts/checks`, **T** — тесты.

Пути даны относительно `frontend/`.

### A. Инструменты и сборка

| ID | Сер. | Файл:строка | Что не так | Правило | Как воспроизвести | Как исправить |
| --- | --- | --- | --- | --- | --- | --- |
| A-01 | blocker | `src/domain/journal.ts:1-74` | Файл сохранён с CRLF после удаления `JOURNAL_KIND_LABELS`. Biome падает на format, `verify` красный. Отчёты F1 и F2 называют `verify` зелёным | §8 «фича готова, только когда verify зелёный», план «Когда идеален» п.1 | `npm run verify` → `Found 1 error`, exit 1; `git ls-files --eol frontend/src/domain/journal.ts` → `w/crlf` | `npx biome format --write src/domain/journal.ts` |
| A-02 | major | `biome.json:88-110` | В override с отключёнными linter, formatter и assist остался живой файл `src/adapters/fixture/fixtureGateway.ts` (тоже CRLF). Biome его не проверяет. Остальные 7 путей override удалены (`src/ui/*.ts*`, `presentation.ts`, `scenarios.ts`, `tests/fixture.test.ts`): мёртвая конфигурация. F1 записал «убрать override» в FS-13, но этого не сделано | §8 Biome; FS-13 «verify зелёный без исключений» | Копия `biome.json` без override на копии файла: `format` error. `ls` по путям override: существует только `fixtureGateway.ts` | Удалить весь блок override, отформатировать `fixtureGateway.ts` |
| A-03 | minor | корень репозитория (`.gitattributes`), `biome.json` | Нет политики концов строк для `frontend/`: нет `eol=lf` в `.gitattributes`, нет `formatter.lineEnding`. На Windows CRLF снова появится и снова сломает lint | §8 | `git ls-files --eol frontend` → 2 файла `w/crlf` | `frontend/** text eol=lf` в `.gitattributes` |
| A-04 | minor | `tsconfig.json:24` | `include` не содержит `e2e` и `playwright.config.ts`, поэтому `verify` их не типизирует. Сейчас ошибок нет (проверено временным tsconfig) | §8 strict TS | Читать `include` | Добавить `e2e`, `playwright.config.ts` |
| A-05 | major | `scripts/checks/index.ts:14` | Корень проверок — `process.cwd()`. Запуск не из `frontend/` сканирует пустоту и даёт «28 checks passed» | §8 | `cd scratchpad/.../empty2 && node .../scripts/checks/index.ts` → `rules: 28 checks passed` | Корень от `import.meta.dirname`; если нет `src/`, падать |

### R. Соблюдение правил в коде

| ID | Сер. | Файл:строка | Что не так | Правило | Как воспроизвести | Как исправить |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | major | `index.html:6` | `<title>Панель исследователя</title>`: кириллица вне словаря. `document.title` нигде не ставится, поэтому в en вкладка остаётся русской | §3 «все тексты из словарей», «кириллица только в locales» | `grep -rn "document.title" src` → 0 | Ставить `document.title = t("common:app.title")` в `LocaleProvider`; в html — нейтральный заголовок |
| R-02 | minor | `docker/10-resolver.envsh:2`, `docker/40-runtime-config.sh:2`, `docker/default.conf.template:9` | Комментарии на русском в shell-скриптах и в конфиге nginx. В скрипте `40-runtime-config.sh:5` также русское сообщение об ошибке | §1 «комментариев нет совсем… и конфигов» | `grep -n "^ *#" docker/*` | Убрать комментарии, объяснение перенести в `README`/`context`; сообщение — на английском |
| R-03 | major | `journal-entry/index.tsx:28,45,54`; `run-summary/index.tsx:69`; `plan-view/index.tsx:17,37,46,54,64`; `research-card/index.tsx:35,37,71`; `team-card/index.tsx:101` | `lang="ru"` вписан литералом в 13 местах. В контракте нет поля языка контента, поэтому это догадка. Если LLM ответит на английском, разметка солжёт. Константы или источника языка нет | §3 «помечается `lang` того языка, на котором пришёл» | `grep -rn 'lang="ru"' src` | Одна константа `BACKEND_CONTENT_LANG` (или поле от backend) и компонент `<BackendText>` |
| R-04 | minor | `plan-view/index.tsx:66-70` | `revise_if` (текст backend) подставляется в переведённую строку `research:label.reviseIf` без `lang`. В en получается смешанная строка «Revise if: <русский текст>» без разметки | §3 | Сценарий `plan_revision`, en | Подпись из словаря отдельно, условие — в `<span lang>` |
| R-05 | minor | `research-card/index.tsx:69` | `{text(...)}:{" "}`: двоеточие и пробел склеиваются в JSX, мимо словаря | §3 «склейки строк нет», `jsx-text` | Читать код | Ключ с параметром `{{reason}}` или отдельный `<dt>` |
| R-06 | major | `team-card/styles.module.css:26-33` | Строка робота — самодельная вложенная карточка: свои `border-radius: var(--radius-inner)`, `background: var(--surface-tint)`, `padding`. `consistency` это пропускает | §5а «Card (level: top/inner); свои фон, радиус или рамка у секций запрещены» | Читать CSS | `Card level="inner"` |
| R-07 | minor | `research-card/index.tsx:83,105`; `styles.module.css:35` | Свои заглушки «нет опасностей» и «нет гипотез» (`<p className={styles.empty}>`) вместо `EmptyState` | §5а «пустое состояние — EmptyState; свои заглушки запрещены» | Читать код | `EmptyState size="compact"` или вариант для вложенного блока |
| R-08 | minor | `ui/shared/ui/flag/styles.module.css:5` | `border-radius: calc(var(--radius-button) / 4)` = 3px, вне шкалы 6/12/16/20/36/round. `scale-tokens` пропускает, потому что видит имя токена | §5а шкала радиусов | Читать CSS | Токен `--radius-flag` в шкале или `--radius-check` |
| R-09 | minor | `map-card/styles.module.css:19` | `opacity: 0.55` литералом. Затемнение «stale» есть только у карты; миссия, исследование и журнал при stale не затемняются | §4 «значения только из токенов» (дух), 5.3 «stale по opacity» | Читать CSS | Токен `--opacity-stale` и единый `data-stale` у `Card` |
| R-10 | minor | `journal-entry/index.tsx:23`, `plan-view/index.tsx:12`, `research-card/index.tsx:21` | Пропсы описаны inline-типом, а не интерфейсом `XxxProps` | §2 «Пропсы — readonly-интерфейс `XxxProps`» | Читать код | Вынести `ChainRowProps`, `EvidenceProps`, `HypothesisRowProps` |
| R-11 | minor | `features/demo/labels.ts:8-10` | `` `demo:scenario.${name}` as DemoKey ``: каст на `name: string` выключает проверку ключей типами. Опечатка в имени сценария не сломает typecheck | FS-04 «опечатка в ключе ломает typecheck» | Читать код | `Record<FixtureScenarioName, DemoKey>` |
| R-12 | minor | словари `ui/shared/i18n/locales/{ru,en}/*` | Мёртвые ключи — в коде нет ни одного обращения: `common:action.{cancel,dismiss,open}`, `common:status.{loading,pending,live}`, `common:select.empty`, `common:locale.*` (дубль `language.*`, F1 обещал удалить), `journal:loadMore`, `journal:export.done`, `mission:value.belowReserve`, `team:column.{robot,status,samples,goal}`, `research:label.evidence`, `research:step.*` (ProgressSteps берёт `common:step.*`). Набор ключей ru/en совпадает, кроме русских форм `_few`/`_many` (это норма) | §3, AGENTS «одна ответственность»; мёртвый код | `node scratchpad/audit-code/i18n-keys.mjs .` + grep по каждому ключу | Удалить ключи; тест «каждый ключ en используется» |
| R-13 | minor | `domain/journal.ts:15,30,39`; `features/journal/journal-card/index.tsx:33-41` | `filterJournal` и `buildHypothesisChain` используются только тестами, `listHypothesisIds` не используется вовсе. При этом фильтрация по типу и по гипотезе продублирована inline в UI. Ещё мёртвые экспорты: `STEP_STATUS_LABELS`, `ENTRY_COUNT_LABEL`, `ROBOT_COUNT_LABEL` (только тесты), `isFixtureScenarioName`, `researchFrom`, `TRANSPARENT`, `IndicatorBox`, `ResearchKey` (export не нужен). Файл `ui/shared/styles/gt-standard-files.css` нигде не подключён | AGENTS «бизнес-логика вне UI»; мёртвый код | `node scratchpad/audit-code/unused-exports.mjs .` | UI вызывает доменные функции; мёртвое удалить |
| R-14 | major | `mission-card/index.tsx:24`; `ui/shared/motion/useLoadingIndicator.ts` | Скелет первой загрузки есть только у карточки миссии. У исследования, журнала, команды и карты его нет. Ветки `spinner` и `stale` хука в продукте не используются: `Spinner` не применяется нигде. Матрица говорит «Первая загрузка: скелеты — все», F2 пишет «готово» | 5.3 «Загрузка данных», coverage «Первая загрузка» | `grep -rn useLoadingIndicator src/ui` → 1 место | Хук и `Skeleton` во всех карточках, `stale` — через затемнение |
| R-15 | minor | `domain/parsing/responses.ts:32` и `features/journal/labels.ts:7`; `features/research/labels.ts:55-75`; `app/app-notices/index.tsx:17` и `app-shell/index.tsx:33` | Дубли: список `JournalKind` в двух местах, причём в UI полнота массива не проверяется. Перечисления статусов и видов гипотез лежат в UI, а не в домене. `isOffline` повторяет логику `headerConnection` | AGENTS «одна задача — один модуль», §2 | Читать код | Константы в `domain/contract.ts`; один предикат в `application/viewState` |
| R-16 | minor | `research-card/index.tsx:131`; `journal-entry/index.tsx:67` | Пользователю показываются внутренние id: `region_id` («cell--6--3», «observed-area-1») и `hypothesis_id` в кнопке «показать цепочку». F2 заявлял, что внутренние термины убраны | SC-13 (свой же критерий F2) | Сценарий `slam_building` или `medium_adaptation` | Нумерация «Участок 1», «Гипотеза 1», как у опасностей |
| R-17 | minor | `ui/shared/motion/canvasPalette.ts` | Палитра ролей карты (`sample`, `hazard`, `robotPartner`…) лежит в `shared/motion`, хотя это не движение. Знание фичи `map` попало в shared | §2 слои, AGENTS «одна ответственность» | Читать код | Перенести в `features/map/mapTheme.ts` или `shared/styles` |
| R-18 | minor | `ui/shared/styles/tokens/palette.css` | В палитре есть значения, которых нет в `tokens.md`: `#bfd3cd`, `#566263`, `#bfcecc`, `#5b6f6f` и 6 цветов `--data-*` (решение было «4–5»). Единый источник `tokens.md` расходится с кодом | §4 «Палитра — сырые значения из tokens.md», решение про `--data-*` | grep каждого hex в `tokens.md` | Дописать в `tokens.md` раздел производных цветов или сократить |
| R-19 | major | `ui/shared/styles/global.css:50`; `banner/styles.module.css:29-33`; `close-button` `tone="inverse"` | Кольцо фокуса всегда `--focus-ring-color` (carbon). На `--surface-inverse` (#34484a, критичный `Banner` с крестиком) контраст ≈1.95:1. `--focus-ring-color-inverse` объявлен и не используется | §7 «видимый :focus-visible», WCAG 1.4.11 | Таб до крестика критичного баннера (сценарий `start_rejected`) | `.critical, [data-surface=inverse] { --focus-ring-color: var(--focus-ring-color-inverse) }` |
| R-20 | minor | `tokens/semantic.css` (`--data-*`) | Метки карты на фоне ниже 3:1: `--data-hazard` на `--data-unknown` ≈2.38, `--data-sample` на `--data-free` ≈2.73, `--data-base` на `--data-unknown` ≈2.73. Таких пар нет в `contrast` | §7, решение «нетекстовые ≥3:1» | Расчёт в `checks-probe/contrast.ts` | Обводка меток или более тёмные цвета; добавить пары в проверку |
| R-21 | minor | `scroll-area/styles.module.css:26,34` | `.viewport:focus-visible` меняет переменную ползунка, и `transition` проигрывает это с клавиатуры | 5.1 «фокус не анимируется; клавиатура не анимируется» | Таб в журнал | Убрать `:focus-visible` из анимируемого селектора |
| R-22 | minor | `tests/application/*.test.ts`, `tests/domain.test.ts`, `tests/research.test.ts`, `tests/gateway.contract.test.ts`, `tests/support.ts` | 97 строк кириллицы в 8 файлах: названия тестов F1 на русском, остальные на английском | §3 «кириллица только в locales и JSON фикстур» | `LC_ALL=C.UTF-8 grep -rlP "[\x{0400}-\x{04FF}]" tests` | Названия на английском, данные backend — в JSON фикстурах; или явно разрешить tests в правиле |
| R-23 | minor | `public/fonts/*`, `tokens/typography.css` | GT Standard S/L в проекте нет. Работает Inter, а `@font-face` GT — только `local()`. План требует файлы GT в `public/fonts`; Inter допустим как fallback, но это решение пользователь не подтверждал | План «Решения перед стартом: шрифт», §4 «Шрифты [утв.]» | `ls public/fonts` | Получить файлы GT или записать решение «Inter» в `tokens.md` и `frontend-rules.md` |
| R-24 | minor | `context/frontend-plan.md:3`; `frontend-rules.md:27-35, 95, 340`; `frontend-coverage.md:13-30` («Есть: нет»); `context/README.md:24`; `frontend-contracts.md:357` | Документы устарели: «работа не начата», старый список нарушителей лимита, «§9 Не начато», «FS-13 ждёт F2». В контрактах `locale-switch` описан на `Segmented`, а утверждён `Menu` | AGENTS «изменилась договорённость — обнови context и статус» | Читать файлы | Обновить статусы |
| R-25 | minor | `application/errorDescription.ts:58-65`; `errors.json` | В `describeError` передаётся `detail` (сообщение backend `ApiError.message`), но ни один шаблон `errors:*` его не выводит, и текст backend теряется. Дефолтные сообщения `NetworkError` и `RequestTimeoutError` — английские строки | §3 «контент backend выводится как есть с lang» | `grep "{{detail}}" locales` → только `staleBannerDetail` | Выводить `detail` отдельной строкой с `lang` |

### S. Надёжность

| ID | Сер. | Файл:строка | Что не так | Правило | Как воспроизвести | Как исправить |
| --- | --- | --- | --- | --- | --- | --- |
| S-01 | major | `src/main.tsx:40`; `application/session/commands.ts:32`; `mission-card/index.tsx:85` | `crypto.randomUUID()` есть только в secure context (https или localhost). Если панель открыта по `http://<ip>:8080` (проектор с другой машины, `compose` публикует порт), `generateId` бросает TypeError. Обработчик кнопки зовёт `void controller.startRun(...)`, поэтому отказ уходит в unhandled rejection, а Start молча ничего не делает | AGENTS «надёжность», ошибки сети | Открыть сборку по IP, нажать Start: в консоли `crypto.randomUUID is not a function` | Fallback через `crypto.getRandomValues`; try/catch в `start()` с переходом команды в `failed` |
| S-02 | minor | `src/ui/app/download.ts:10` | `URL.revokeObjectURL` сразу после `click()`. В Firefox и Safari это может отменить загрузку экспорта | надёжность | Экспорт журнала в Firefox | Отзывать URL через `setTimeout(…, 0)` или по `focus` |
| S-03 | minor | `journal-card/index.tsx:47-50` | `seen.current` меняется во время рендера. В конкурентном и StrictMode-рендере это нечистый рендер: отметка «свежая запись» может съехать | React-правила, надёжность | Читать код | Вычислять в `useMemo` по `runId` или в эффекте |
| S-04 | minor | `ui/shared/motion/withViewTransition.ts:16-30` | Если два перехода перекрываются, `finally` первого удаляет `dataset.viewTransition` второго. Исключение внутри `change` глотается `catch { return }` | 5.4, надёжность | Две быстрые смены статуса | Счётчик или токен владельца атрибута; ошибки `change` пробрасывать |
| S-05 | minor | `features/map/map-canvas/index.tsx:37-44, 82` | Шрифт карты читается до загрузки web-шрифта, перерисовки по `document.fonts.ready` нет. Смена `devicePixelRatio` (перенос окна на проектор) не отслеживается, и canvas мылится | SC-15 чёткость на проекторе | Перетащить окно на монитор с другим DPR | `document.fonts.ready.then(wake)`, `matchMedia("(resolution: …)")` |
| S-06 | minor | `application/session/journalExportTask.ts:44`; `application/session/mapLoading.ts:13-15` | `inFlight = false` в `finally` без проверки поколения: после перезапуска контроллера старый экспорт сбросит флаг нового. `MapLoading.reset()` не сбрасывает `lastAttemptAt`, поэтому после перезапуска (StrictMode) карта ждёт до `mapRetryMs` | гонки в контроллере | Перезапуск контроллера во время экспорта | Проверять `generation`; сбрасывать `lastAttemptAt` в `reset()` |
| S-07 | minor | `plan-view/index.tsx:17` | `key={item}`: одинаковые строки доказательств или предпосылок дают одинаковые ключи React | надёжность | Две одинаковые строки в `evidence` | `key={index}` или `${index}-${item}` |
| S-08 | minor | `src/main.tsx:13-23` | `fetch("/config.json")` без тайм-аута. Если запрос завис, приложение не рендерится совсем: пустой экран без индикатора | ошибки сети | Задержать `/config.json` в DevTools | `AbortSignal.timeout(...)` |
| S-09 | minor | `ui/shared/i18n/formatters.ts:36-62` | `new Intl.NumberFormat` создаётся на каждый вызов, при 10 Гц телеметрии это десятки объектов в секунду | производительность | Профилировщик на `success` | Кэшировать форматтеры по ключу опций |

### C. Качество проверок `scripts/checks`

Пробы воспроизведены на копии дерева в `scratchpad/audit-code/checks-probe/`:

- `root/` — копия реального дерева, на ней проходят 28 из 28;
- `make-probe.mjs` добавляет файлы-обходы;
- `run1.txt` — вывод;
- `sanity.ts` подтверждает, что файлы-обходы разбираются: пропуск настоящий.

Выборочно перепроверено мной: A-05, C-01 (`NON_PIXEL` в `touchTargets.ts:29`), состав `SCANNED_DIRECTORIES`.

| ID | Сер. | Файл:строка | Что пропускает | Правило | Проба | Как исправить |
| --- | --- | --- | --- | --- | --- | --- |
| C-01 | blocker | `rules/touchTargets.ts:29,194,248-291,319-322` | Размер в `rem` превращается в `null`, и класс проходит: `.tiny { block-size: 1.5rem }` (24px) с `:active` не пойман. Класс, где размер задаёт padding, проходит. «Область нажатия» засчитывается за любое значение со строкой `--target-min` (`calc(var(--target-min) / 4)` при 8px проходит). Интерактивными считаются только классы с `:hover`/`:active`/`pressable`. `--target-min: var(--space-12)` даёт NaN и проходит | §7 «≥44px», FS-09 | `checks-probe/root` → `.tiny`, `.chip`, `.fake` | Резолвить `rem` (×16), `var()`, `calc`; считать по фактическому `block-size`/`min-block-size` + padding; интерактивность — по JSX-ролям |
| C-02 | blocker | `rules/cssValues.ts:153-181`; `rules/unityTokens.ts` | Проверяется форма записи, а не анимируемое свойство. Проходят: `--transition-box: width …` + `transition: var(--transition-box)`; локальный `@keyframes` с `width` через `--motion-box`; токен `--transition-grow: width` в `motion.css` (содержимое `--transition-*` не проверяется) | 5.1 «только transform, opacity, clip-path, filter» | `checks-probe/root/src/probe/*` | Раскрывать `var()`; запретить `@keyframes` и `--transition-*`/`--motion-*` вне `tokens/`; проверять свойства внутри `--transition-*` |
| C-03 | major | (нет проверки) | Слои архитектуры не проверяются: `domain` с импортом `react`, `i18next` и `@/ui/shared/ui`, shared с импортом фичи, фича с импортом другой фичи — 0 срабатываний | §2 «app → features → shared; фичи не импортируют друг друга», AGENTS «чистая архитектура» | `checks-probe/root/src/domain/probeLayer.ts` | Проверка `layers` на `importGraph` |
| C-04 | major | `scripts/checks/files.ts:5-14`; `texts.ts:118-126` | Не сканируются `e2e/`, `playwright.config.ts`, `docker/*`, `Dockerfile`, `public/`; расширения `.jsx .cjs .sh .envsh .template` не читаются. `cyrillic` смотрит только `src/`. Из-за этого не пойманы R-01 и R-02 | §1, §3 | `e2e/long.spec.ts` (300 строк), `docker/probe.sh` (`# note`) проходят | Добавить корни и расширения; `#`-комментарии для sh/conf |
| C-05 | major | `rules/unityCss.ts:117`; `rules/unityTokens.ts:204,336`; `rules/touchTargets.ts:317` | Если файл токенов не найден по имени, проверки молча выключаются: token-layers, contrast, motion-tokens, touch-targets | §4, 5.6 | `checks-probe/root2`: переименован `palette.css` → нарушения не пойманы | Отсутствие файла токенов — нарушение |
| C-06 | major | `rules/texts.ts:107-116,139-151,158` | `jsx-text` видит только `JSXText` и атрибут со строковым `Literal`. Проходят: `{"Start mission"}`, `` {`Stop`} ``, `{on ? "Running" : "Idle"}`, `aria-label={"…"}`, `alt={"…"}`, пропсы `label`/`eyebrow`/`description`/`title` своих компонентов, `document.title = "…"` в `.ts` | §3 «литеральный текст в JSX запрещён» | `checks-probe/root/src/ui/features/bypass-jsx` | Разбирать `JSXExpressionContainer`, тернарии и `??`; расширить список пропсов |
| C-07 | major | `rules/cssValues.ts:82-130` | `css-literals` смотрит только CSS: inline `style={{ color: "#f00", transitionDuration: "200ms", borderRadius: 3, fontSize: 13 }}` и `element.style.color = …` проходят. Именованных цветов в списке 15: `tomato` и `cyan` проходят. `filter: drop-shadow` не считается тенью | §4 «литералы только в tokens/» | `bypass-jsx/index.tsx` | Сканировать TSX `style` и присваивания `.style.*` |
| C-08 | major | `rules/unityCss.ts:72-103` | `scale-tokens` засчитывает любое упоминание имени токена (`calc(var(--radius-card) * 0.7)` проходит — так и пропущен R-08). Шорткат `font:` не проверяется. Шкала отступов 5а не проверяется: `padding: 13px 7px`, `margin-block: 3px` проходят. `@container` и `matchMedia` с px не проверяются | §5а «другие значения запрещены тестом» | `checks-probe/root` | Значение = ровно `var(--token)`; проверять `font`, padding/margin/gap по шкале |
| C-09 | major | `rules/unityCss.ts:126-128`; `rules/motionUsage.ts:152-165` | `signal-scope` и `accent-text` не раскрывают алиасы: `--status-alarm: var(--signal-critical)` в `semantic.css` + использование в фиче проходит; `--text-accent: var(--vivid-teal)` проходит | §4 «сигнальных цветов в интерфейсе нет», §7 «teal только поверхность» | `checks-probe/root` | Раскрывать цепочки `var()` до палитры |
| C-10 | major | `rules/unityCss.ts:21,146-155` | `no-side-stripe` пропускает `border-inline: 6px solid`, `border-width: 0 0 0 var(--space-4)`, `calc(var(--hairline) * 4)`, полосу через `::before` | §5а `no-side-stripe` | `checks-probe/root` | Нормализовать border-шорткаты; проверять узкие `::before`/`::after` с фоном |
| C-11 | major | `rules/unityTokens.ts:168-192` | Пары контраста зашиты в код: новый `--text-*` не проверяется (`--text-accent` = teal ≈1.8:1 прошёл). Нет кольца фокуса на inverse (так и пропущен R-19), большей части `--data-*` и `--text-disabled` | §7 | `checks-probe/root` | Строить пары из всех `--text-*` × поверхностей, кольца × поверхностей, `--data-*` × фонов карты |
| C-12 | major | `rules/unityTokens.ts:261-327` | `motion-tokens` проверяет кривые только по имени `--ease-in`: проходят `--ease-enter: cubic-bezier(0.4,0,1,1)` (это ease-in) и bounce `cubic-bezier(0.34,1.56,…)`. Однострочный `@keyframes{from{height:0}}` не разбирается (регэксп требует отступ). Проходят `scale(0.0)` и `blur(12px)` (лимит 2px) | 5.1 | `checks-probe/root` | Разбирать через postcss; проверять y<0/y>1 и форму ease-in; лимит blur |
| C-13 | major | `rules/consistency.ts:364-374,399,405-418` | Атрибут читается только как строковый `Literal`. Проходят `<input type={kind}>`, spread `{...{type:"radio"}}`, `role={"tablist"}`, `as={"h3"}`, `createElement("select")`, `{value ?? "—"}`. В CSS — `overflow-y: var(--x)`, где `--x: auto`. Не пойман R-06 (свой фон и радиус секции) | §5а «один компонент на роль» | `checks-probe/root` | Вычислять константные выражения; проверять фон и радиус у классов фич |
| C-14 | major | `rules/consistency.ts:443,452` | `icon-alias` сравнивает идентификаторы, а lucide экспортирует одну иконку под тремя именами (`X`, `XIcon`, `LucideX`). Импорт `lucide-react/dynamic` не виден | §5а «одна иконка — одно имя» | `checks-probe/root` | Нормализовать имена (убрать `Icon`/`Lucide`), ловить подпути пакета |
| C-15 | major | `rules/motionUsage.ts:81-111` | `ts-timings` видит только числовой литерал в вызове внутри `src/ui`. Проходят `const SETTLE = 220; setTimeout(fn, SETTLE)`, `2*110`, `el.animate(k, 200)`, `easing: "cubic-bezier(…)"`, `el.style.transition = "opacity 200ms ease-in"` | 5.1 «в TS нет чисел-миллисекунд» | `checks-probe/root/src/ui/probe/timing.ts` | Резолвить `const`; проверять `animate`, `KeyframeEffect`, строки `easing`/`transition` |
| C-16 | major | `rules/motionUsage.ts:28,138-140` | `remote-assets` не сканирует TS/TSX (`<img src="https://…">`, `new FontFace(…url(https://…))`), `srcset` в HTML не видит | §4 «шрифты локально, без CDN» | `checks-probe/root` | Сканировать TSX-атрибуты и строки URL |
| C-17 | major | `rules/cssStructure.ts:314,375-400` | `:global(body){…}` и `@import "…/reset.css"` внутри CSS-модуля не ловят ни `css-modules`, ни `global-styles`. Модули `ui/shared/styles/*.module.css` целиком исключены из поиска неиспользуемых классов (`.deadProbe` не найден) | §4 «глобальный CSS только в shared/styles; неиспользуемых классов нет» | `bypass-jsx/styles.module.css`, `compose.module.css` | Запретить `:global` и `@import` в модулях; проверять `composes` для shared-модулей |
| C-18 | minor | `rules/cssValues.ts:199-235` | `css-token-refs` не проверяет ссылки из TS: `motionMs("--dur-typo")` на несуществующий токен проходит. Исключение `scriptText.includes('"--x"')` засчитывает любое упоминание | 5.1, §4 | `checks-probe/root` | Собирать аргументы `motionMs`/`readToken`/`readEasing` |
| C-19 | minor | `rules/cssStructure.ts:332-346` | `css-duplicates` сравнивает блоки без нормализации: тот же набор, разбитый на два правила, `background` вместо `background-color` и алиас токена проходят | §4 «блок из 3+ деклараций в двух местах запрещён» | `dup-a`/`dup-b` | Нормализовать шорткаты и алиасы; сравнивать объединение по селектору |
| C-20 | minor | разные | `cyrillic` разрешает любой путь с `/locales/` (в т. ч. `.ts`) и не видит `П`-escape. `no-comments` не смотрит `<style>`/`<script>` в HTML. `file-length` не меряет `.js`. `import-cycles` не видит `./b.js`-спецификаторы. `motion-libraries` не знает `@motionone/*`, `lottie-react`, `peerDependencies`. `package-subject` пропускает `util`/`helper` в единственном числе. `hover-gate` не видит транзиции на базовом классе для свойства, меняемого в `:focus-visible` (так и пропущен R-21) | §1, 3, 5.1 | `checks-probe/run1.txt` | Точечно по каждому пункту |
| C-21 | minor | `tests/checks/texts.test.ts` («ignores tests»), `tests/checks/motionUsage.test.ts` («does not scan code outside ui») | Тесты проверок закрепляют дыры C-04 и C-15 как норму. Ни один тест не покрывает обходы выше | §8 «у проверки тест на нарушение» | Читать тесты | Добавить тесты-обходы из `checks-probe` как негативные кейсы |

### T. Тесты и матрица покрытия

Зонд достижимости состояний по сценариям — `scratchpad/audit-code/tests-probe/probe.json`. Выборочно перепроверено мной: T-14 (`e2e/driver.ts:128-151` — нет `expect`) и T-15 (`e2e/fps.spec.ts:65` — только `frames > 0`).

| ID | Сер. | Файл:строка | Что не так | Правило | Как проверить | Как исправить |
| --- | --- | --- | --- | --- | --- | --- |
| T-01 | blocker | `context/frontend-reports/f2.md:405-452` | В сверке не меньше 14 ячеек «готово», где названный тест заявленное не проверяет (T-02…T-13, T-19). Часть «тестов» — проверки данных фикстур (`coverage`, `reachability`, `gateway`) без рендера и анимации | План «идеален» п.2; coverage «для каждой строки тест отображения и анимации» | Таблица ниже | Переоткрыть ячейки, исправить статусы в `f2.md` |
| T-02 | major | `tests/ui/features/app.test.tsx:66-83` | «map is missing, then versions differ» проверяет общий `aria-label` `map:describe.unavailable`, одинаковый для обоих случаев. `map:state.mismatch` нигде не проверяется | coverage «Карта не совпадает» | `grep -rn "state.mismatch" tests` → 0 | Проверять текст mismatch с параметрами |
| T-03 | major | `tests/ui/map/layers.test.ts:102-111` | «draws every frame of %s» всегда даёт статическую `fixtureMap`, в том числе для `slam_building`. Растущая SLAM-карта и `null` не проверяются; assert только `not.toThrow` | coverage «Сетка static/SLAM/нет» | Читать тест | Проходить `script.maps`, проверять вызовы рисования |
| T-04 | major | `application/session/journalSync.ts:52-54`; `journal-card/index.tsx:113` | `journal.error` не проверяется ни в application, ни в UI. F2 ссылается на тест фикстуры | coverage «Ошибка загрузки журнала» | `grep -rn "journal.error" tests` → 0 | Тест контроллера + `ErrorState` в `JournalCard` |
| T-05 | major | `tests/ui/features/research.test.tsx:17-28` | В «every step status» нет `active`; pop-in выполненного шага не проверяется — для строки 5.3 «Выполненный шаг → pop-in» теста нет | coverage «5 статусов шагов», 5.6 | Читать тест | `it.each(STEP_STATUSES)` + `data-state` pop |
| T-06 | major | `research.test.tsx:44-58` | В UI проверен только `degraded` × 3 сбоя; `ok`, `suspected`, `recovering` и `quality` не проверены | coverage «Датчик 4×3, качество» | Читать тест | `it.each(SENSOR_STATES × SENSOR_FAULTS)` |
| T-07 | major | `tests/ui/features/journalTeam.test.tsx:139-173` | Итог команды проверен только для `partial` и «работает без партнёра». `success`, `failed`, `stopped`, `running` и Swap статуса робота не проверены. `failed`/`stopped` есть только в сценариях 12 и 15, а не в 9 и 10 | coverage «Итог команды», 5.3 TeamPanel | `probe.json` → team | `it.each(TEAM_OUTCOMES)`; `data-swap` |
| T-08 | major | `tests/ui/features/mission.test.tsx:70-118,133-144` | Логика блокировок покрыта полностью (`viewState.test.ts`: 6 + 5 веток). В UI проверена только `environmentStarting`; подсказки Stop, `seedInvalid`, `form.unsupported` и отрицательный случай Stop — нет | coverage «все ветки startDisabledReason/stopDisabledReason» | Читать тесты | `it.each(START_BLOCKERS/STOP_BLOCKERS)` через `MissionForm` |
| T-09 | major | `mission.test.tsx:147-175` | `CommandBanner` проверен только в фазах `unknown` и `failed`. `sending`, `awaiting` и dismiss — нет | coverage «Фазы команды» | Читать тест | `it.each` по фазам |
| T-10 | major | `journalTeam.test.tsx:104-120`; `src/ui/app/download.ts` | В UI экспорта проверен только `failed`. `exporting`, баннер `cancelled` и успех (`onExported` → `downloadJson`) — нет. У `download.ts` тестов нет | coverage «Экспорт: все фазы» | `grep -rn "onExported\|downloadJson" tests` | Тест на каждую фазу + юнит |
| T-11 | major | `journalTeam.test.tsx:88-102` | «Цепочка гипотезы» проверяет только «записей > 0» и вызов `selectHypothesis(null)`; сужение списка и прогноз/наблюдение/вывод не проверены | coverage «Цепочка гипотезы» | Читать тест | Сравнить число записей; проверить `CHAIN_LABELS` |
| T-12 | major | `mission.test.tsx:177-187`; `run-summary/index.tsx:66-70` | `RunSummary` проверен для success и failure; `stopped`, `data-outcome` и иконка — нет. `last_error` выводится одинаково для повторяемой и неповторяемой ошибки, поэтому ячейку в UI проверить нечем | coverage «Итог прогона», «last_error» | Читать код | Тест 3 исходов; показывать `retryable` |
| T-13 | major | `research.test.tsx:62-68`; `sensor-view/index.tsx:28-36` | F2 ссылается на тесты `planner_requests` и Swap `last_replan_reason` — их нет. «lists hazards…» опасности не проверяет | coverage «План и исследование» | `grep -rn "planner_requests\|last_replan_reason" tests/ui` → 0 | Добавить проверки |
| T-14 | major | `e2e/driver.ts:128-151`; `e2e/scenarios.spec.ts:49` | axe только пишет JSON, тест не валит. Аудит идёт только в `normal` и только на последнем кадре; stale, unknown и export-failed не проверяются | coverage/план «axe — 0 нарушений на каждом сценарии» | Читать код: нет `expect` | `expect(record.violations).toEqual([])`; аудит ключевых кадров |
| T-15 | major | `e2e/fps.spec.ts:65` | Порога FPS нет, проверяется только `frames > 0`. Падение до 10 fps пройдёт | План «60 fps на проекторе» | Читать тест | `expect(fps).toBeGreaterThanOrEqual(55)`, лимит `p95` |
| T-16 | major | `e2e/scenarios.spec.ts:167-179`; `e2e/plans.ts:39,69` | e2e в основном снимает скриншоты. Содержимое проверяется только в `env_starting` и `disconnect`; 14 сценариев — лишь отсутствие горизонтальной прокрутки. Проекты `reduce` не проверяют, что движение уменьшено | coverage «тест + скриншот» | Читать `plans.ts` | `see(...)` по ключу словаря в каждом сценарии; в reduce — `transitionDuration` |
| T-17 | minor | `e2e/controls.spec.ts:156-194` | Нативные контролы и висящие попапы только пишутся в отчёт. Условный `test.skip` с устаревшей причиной «FS-08a»; `expect` только при `motion === "normal"`; контролы в `fieldset` исключены | 5.4 «все контролы свои» | Читать spec | `expect(native).toEqual([])`, убрать skip |
| T-18 | minor | `tests/shared/motion/presence.test.tsx:65-72`; `swap.test.tsx:145-151` | Reduced-тесты ничего не доказывают. В `usePresence` нет ветки reduced: тест сам ставит `--dur-exit=1ms` и прошёл бы с `setReducedMotion(false)`. У `useLoadingIndicator` reduced-теста нет. `setReducedMotion` не шлёт `change`, поэтому подписка `useReducedMotion` не проверена | 5.5, 5.6 | Заменить `true` на `false` → тест зелёный | Перестроить тесты |
| T-19 | minor | `mission.test.tsx:46-50` | «no-value dash» берёт кадр idle, а `data-no-value.length > 0` подходит для любого поля. Сигнал `null` при dropout, батарея `null` и подписи целей в UI не проверены | coverage «Батарея null», «Сигнал null», «Цель» | Читать тест | Кадр dropout `hard_events`, проверка конкретного поля |
| T-20 | minor | `tests/fixture/coverage.test.ts:25-54`; `tests/ui/features/statuses.ts:3-12` | Перечисления RunStatus, GoalKind, JournalKind и статусов гипотез скопированы руками: в `contract.ts` для них нет массивов. Если контракт расширят, тесты останутся зелёными | coverage «Тест сверяет перечисления из contract.ts» | Читать код | Const-массивы в `contract.ts` |
| T-21 | minor | `tests/fixture/coverage.test.ts:56-63` | Данные всех сценариев берутся вместе: тест не проверяет, что состояние есть именно в сценарии из матрицы | coverage | `probe.json` | Таблица «сценарий → обязательные состояния» |
| T-22 | minor | `tests/research.test.ts:21,84`; `tests/fixture/reachability.test.ts:98-104`; `tests/shared/ui/frequency.test.tsx:14-35` | Слабые assert: `toBeDefined()` на всегда существующем поле; `["partial","failed"].toContain`; тест «connecting…» `connecting` не проверяет. `ruleBody()` возвращает `""`, если селектора нет, и `not.toMatch` проходит впустую | 5.6 | Читать код | Конкретные значения; `ruleBody` падает без селектора |
| T-23 | minor | `tests/` | Структура не повторяет `src/`: верхнеуровневые `domain.test.ts`, `research.test.ts`, `gateway.contract.test.ts`, `support.ts`; `tests/fixture` вместо `tests/adapters/fixture`, `tests/shared` вместо `tests/ui/shared`, `tests/ui/map` вместо `tests/ui/features/map`, `tests/ui/labels`. `packageShape.ts:9` явно разрешает `tests/shared` | §8 «tests/ повторяют структуру src/» | `ls tests` | Перенести по зеркалу |
| T-24 | minor | `features/map/layers/{robots,frame,markers,terrain}.ts`; `src/ui/app/useMission.ts` | Без юнит-тестов: `robotColor`, `soilRamp`/`rampColor`, `drawBase` (задеты только smoke `not.toThrow`). Ячейки «База» нет ни в сверке F2, ни в тестах | AGENTS «покрывай тестами новую логику» | Импорты в `tests/` | Юниты на чистые функции |
| T-25 | minor | разные (5.3) | Нет поведенческих тестов на: `withViewTransition("mission")` (`layout.ts:20`), затемнение карты `data-stale`, «мигание баннера не перезапускает анимацию», второй тултип без задержки, press у `NumberField`, hover кнопок (только поиск строки в CSS). Swap статуса миссии проверен одной парой running → returning | 5.6 «для каждого элемента 5.3 поведенческий тест» | — | Добавить |
| T-26 | minor | `tests/ui/features/missionLayout.test.tsx:145-164`; `mission.test.tsx:101` | `vi.useFakeTimers()` без `afterEach(vi.useRealTimers)`: при падении таймеры утекут в следующие тесты. Шум jsdom «getContext not implemented» в DOM-тестах | гигиена | `vitest run` | `afterEach`; мок `getContext` в setup |

## Матрица покрытия: фактический статус

Сводка проверки T-01. «OK» — тест проверяет отображение; «частично» и «нет» — см. ID.

| Ячейка | Вердикт |
| --- | --- |
| Связь connecting/live/stale/нет backend | частично: `connecting` и `live` в UI не проверены |
| Среда, заставка, скелеты (у миссии), язык, ширины | OK (скелеты остальных карточек — R-14) |
| Карта не совпадает | нет (T-02) |
| Движение normal/reduce | частично (T-16, T-18) |
| Статусы миссии | частично: текст есть, `data-state` и tone по каждому — нет |
| Фазы команды | частично (T-09) |
| Блокировки Start/Stop | логика OK, UI 1 из 11 (T-08) |
| Батарея / цель / сигнал `null` | частично / частично / нет (T-19) |
| `last_error`, итог прогона | нет / частично (T-12) |
| Сетка static/SLAM/нет | нет (T-03) |
| Робот, траектория, сбор образца, грунт, опасности, подписи | OK |
| База | нет (T-24) |
| Второй робот, бронь, путь | частично: путь партнёра |
| План llm/fallback, шаги | частично (T-05) |
| Датчик 4×3 | частично (T-06) |
| Гипотезы и вердикты | OK |
| Перепланированный маршрут, счётчик запросов | нет (T-13) |
| Журнал: пусто, фильтр, has_more | OK |
| Журнал: типы | частично: иконка и tone по типам в UI |
| Цепочка гипотезы, экспорт | частично (T-11, T-10) |
| Ошибка загрузки журнала | нет (T-04) |
| Итог команды, робот команды | частично (T-07) |
| Потерянный робот, один робот | OK |

## Проверено и признано чистым

- **Ratchet:** все 22 базы в `scripts/baselines/` пустые, логика baseline и `--prune` корректна.
- **Длина файлов:** в `src`, `tests`, `e2e`, `scripts` нет файлов ≥250 строк, включая CSS. Максимум: `tests/fixture/coverage.test.ts` — 237, `domain/contract.ts` — 240. JSON в `fixture/examples` ≤ 934 строк, это допустимое исключение; 7 файлов контракта побайтно совпадают с `context/mvp/examples`.
- **Комментарии** в `src`, `tests`, `e2e`, `scripts` — только `biome-ignore` с причиной (6 мест, все обоснованы). `@ts-ignore`, `eslint-disable` и JSDoc нет. Исключение — `docker/*` (R-02).
- **Импорты** в начале файлов. Default export только в `vite.config.ts`, `playwright.config.ts` и `e2e/axeSummary.ts` (последний — через `biome-ignore` для Playwright).
- **Нет папок** `utils`, `helpers`, `common`, `lib`, `misc`. `shared` — только `src/ui/shared`.
- **Циклов импорта нет.**
- **Слои** (проверено grep-ом, раз проверки нет):
  - `domain` и `application` не импортируют React, i18n, ui и adapters;
  - `adapters` не импортируют ui;
  - фичи не импортируют друг друга;
  - `ui/shared` не импортирует `features` и `app`;
  - `adapters/fixture` импортирует только `ui/app` — это корень композиции.
- **Тексты:**
  - кириллица в `src` только в `locales/` и в JSON фикстур;
  - литералов в JSX, inline-стилей с цветами или длительностями и чисел-миллисекунд в `src/ui` нет;
  - сетевые тайм-ауты в `application/` и `adapters/` — не анимация, это допустимо.
- **CSS:**
  - нет `!important`, `transition: all`, анимаций `width`/`height`;
  - hover только внутри `(hover: hover) and (pointer: fine)` — 8 мест;
  - брейкпоинты только 48/64/75rem;
  - `overflow` в фичах — только `hidden`/`clip` у карты и раскладки.
- **Компоненты:** нативных `<select>`, `<input>`, `<details>`, `<button>`, `<h2>–<h6>` в фичах нет.
- **i18n:**
  - набор ключей ru/en совпадает (кроме русских плюральных форм);
  - параметры `{{…}}` в ru и en совпадают;
  - в en нет кириллицы, кроме самоназвания «Русский».
- **localStorage:** чтение и запись в try/catch (`ui/shared/i18n/locale.ts`).
- **Таймеры, подписки, rAF:**
  - все `setTimeout`, `addEventListener`, `ResizeObserver` и `requestAnimationFrame` в `ui/` снимаются в cleanup (locale-switch, tooltip, scroll-area, popover, swap, usePresence, useDetailsMotion, useLoadingIndicator, map-canvas, frame loop);
  - цикл карты засыпает, когда анимировать нечего.
- **Контроллер:**
  - поколения (`generation`) отсекают ответы старого цикла;
  - `seq` и `revision` не дают откатить снимок;
  - `inFlight` исключает параллельные опросы;
  - `AbortController` гасит запросы при `dispose`;
  - тайм-аут в `httpGateway` с очисткой таймера и снятием слушателя `abort`;
  - ошибки сети сводятся к `LocalizedError`/`describeError`;
  - неизвестный исход команды сверяется с `/state` перед повтором.
- **Причины блокировок Start/Stop** отдаются кодами (`StartBlocker`/`StopBlocker`), все ветки покрыты `viewState.test.ts`.
- **Токены:** `presentation/tokens.css` побайтно совпадает с выгрузкой `buildTokenCss` из текущих токенов.
- **Тесты:**
  - нет `.only`, `.skip`/`.todo` (кроме T-17), снапшотов, `expect(true)` и `vi.mock` модуля под тестом;
  - ожидаемый текст UI берётся из словарей;
  - у всех 28 проверок есть тесты «нарушение ловится» и «чистый код проходит» (но обходы не покрыты, C-21).
