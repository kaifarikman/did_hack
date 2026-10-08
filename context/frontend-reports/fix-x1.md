# Исправления X1: система и проверки

Дата: 2026-10-08. Дерево: `.claude/worktrees/frontend-screens/frontend`. Git не трогался.

**Итог:** `npm run verify` — exit 0 (rules 29/29, typecheck вместе с `e2e/`, lint, 73 файла / 863 теста, build). Лог: `scratchpad\x1\verify.log`. Пробы аудита (`scratchpad\audit-code\checks-probe\root`) прогнаны новыми проверками: каждый обход из таблицы C ловится (скрипт `scratchpad\x1\probe-run.ts`).

Ratchet-базы: все пустые, кроме `cyrillic.txt` (2 записи — `tests/domain.test.ts`, `tests/research.test.ts`, их переводит X2; на последнем прогоне нарушений уже 0, финальный `npm run rules -- --prune` запускает X2).

## Сделано

### C. Проверки `scripts/checks`

| ID | Что сделано | Файл | Тест |
| --- | --- | --- | --- |
| C-01 | Реальный расчёт размеров: `rem`/`em` (×16), `calc`, цепочки `var()` через токены и локальные свойства, худший вариант. Высота из `padding` (+24px контента). Область нажатия засчитывается, только если `::before/::after` реально даёт ≥44px (размер или `inset` против собственного размера). Интерактивные классы — по `:hover/:active/:focus-visible/:checked` (вне `:has()/:not()`), `cursor: pointer`, `composes: pressable/listItem` и по разметке (`button`, `a`, `input`, роли, `onClick`) | `rules/touchTargets.ts`, `lengths.ts`, `jsxClasses.ts` | `tests/checks/touchTargets.test.ts` (`.tiny`, `.chip`, `.fake`, `--target-min: var(--space-12)`, разметка) |
| C-02 | `transition`/`transition-property` разворачиваются (`var()` → локальные → токены), проверяется каждое свойство; `animation` — только существующий токен `--motion-*`; локальные `@keyframes` и объявления `--motion-/--transition-/--dur-/--ease-/--delay-*` вне `tokens/` запрещены; свойства внутри `--transition-*` проверяет `motion-tokens` | `rules/cssValues.ts`, `rules/motionTokens.ts`, `cssVars.ts` | `css.test.ts`, `motionTokens.test.ts` |
| C-03 | Новая проверка `layers` (учитывает type-only импорты) | `rules/layers.ts` | `layers.test.ts` (10 нарушений + чистый граф) |
| C-04 | Сканируются `e2e/`, `docker/`, `public/`, `index.html`, `Dockerfile`, `*.config.ts`, `tsconfig*.json`; расширения `.jsx .cjs .cts .sh .envsh .template .conf`; `#`-комментарии в sh/nginx/Dockerfile; комментарии в `<style>`/`<script>` HTML | `files.ts`, `rules/noComments.ts`, `rules/fileLength.ts` | `files.test.ts`, `structure.test.ts` |
| C-05 | Нет файла токенов — нарушение (`touch-targets`, `contrast`, `surface-ladder`, `motion-tokens`, `token-layers`) | соответствующие rules | «reports a missing …» в тестах |
| C-06 | `jsx-text`: `{"…"}`, `` {`…`} ``, тернарии, `??`/`&&`, атрибуты-выражения, пропсы `label/eyebrow/description/hint/title/content/…`, `document.title =`, `.textContent =`, `setAttribute("aria-label", …)` | `rules/texts.ts` | `texts.test.ts` |
| C-07 | Inline `style={{…}}` и `el.style.*`/`setProperty` с литералами; полный список именованных цветов CSS; `filter: drop-shadow` — тень | `rules/scriptStyles.ts`, `literals.ts`, `rules/cssValues.ts` | `css.test.ts` |
| C-08 | Радиус/шрифт/z-index — ровно токен (`calc(var(--radius-card)*0.7)` ловится); `font:` запрещён; px/rem/em в padding/margin/gap/inset; `@container` и `matchMedia` по шкале брейкпоинтов | `rules/unityCss.ts` | `unity.test.ts` |
| C-09 | `signal-scope` и `accent-text` разворачивают цепочки (`--status-alarm: var(--signal-critical)`, `--text-accent: var(--vivid-teal)`), сигналы ищутся и в TS | `rules/unityCss.ts`, `rules/motionUsage.ts` | `unity.test.ts`, `motionUsage.test.ts` |
| C-10 | `border-inline`, асимметричный `border-width`, `calc(var(--hairline)*4)`, узкий закрашенный `::before/::after` | `rules/sideStripe.ts` | `sideStripe.test.ts` |
| C-11 | Пары строятся из всех `--text-*` × поверхностей, `--text-on-*` × своих поверхностей, кольца × поверхностей (включая inverse), меток карты × фонов карты. `--text-disabled` исключён намеренно (WCAG 1.4.3 не требует контраста у неактивных) | `rules/unityTokens.ts` | `contrast.test.ts` |
| C-12 | postcss вместо регэкспов; кривые по форме (ease-in — ниже диагонали в t=0.5; bounce — y вне [0,1]); `scale(0.0)`; `blur` > 2px через токены; однострочные `@keyframes` | `rules/motionTokens.ts` | `motionTokens.test.ts` |
| C-13 | Константы файла, тернарии, spread `{...{type}}`, `role={"…"}`, `as={"…"}`, `createElement("select")`, `{value ?? "—"}`; `overflow` через локальные свойства; своя карточка (`padding` + `--radius-inner/card` + `--surface-*`) | `rules/consistency.ts` | `consistency.test.ts` |
| C-14 | Имена нормализуются (`XIcon`, `LucideX` → `X`), учитываются `import { Map as MapGlyph }`, подпути `lucide-react/*` | `rules/iconAlias.ts` | `consistency.test.ts` |
| C-15 | Константы и арифметика (`SETTLE`, `2*110`), `animate(k, 200)`, `new KeyframeEffect(…, 300)`, строковые `easing` | `rules/tsTimings.ts` | `tsTimings.test.ts` |
| C-16 | URL в строках TS/TSX (кроме `www.w3.org`), `srcset` | `rules/motionUsage.ts` | `motionUsage.test.ts` |
| C-17 | `:global` и `@import` в модулях; классы shared-модулей учитываются через `composes … from`; неподключённые глобальные таблицы в `shared/styles` | `rules/cssStructure.ts` | `css.test.ts` |
| C-18 | Аргументы `motionMs/readToken/readEasing/readPixels` сверяются с токенами; исключение «свойство задаётся из TS» — только по ключам объектов и `setProperty` | `rules/cssValues.ts`, `rules/scriptStyles.ts` | `css.test.ts` |
| C-19 | Нормализация: одинаковые селекторы в одном контексте объединяются, `background` → `background-color` для одного значения, алиасы токенов сводятся к конечному | `rules/cssDuplicates.ts` | `cssDuplicates.test.ts` |
| C-20 | `cyrillic`: только `locales/**.json` и фикстуры, `\u04xx`-escape; `file-length` для `.js/.jsx/.cjs/.sh`; `import-cycles` с `./b.js`; `motion-libraries`: `@motionone/*`, `@react-spring/*`, `@lottiefiles/*`, `lottie-react`, peer/optional; `package-subject`: `util`, `helper`, `libs`, корни `e2e/`, `scripts/`; `hover-gate`: изменение в `:focus-visible`, анимируемое `transition` базового класса | разные | `texts`, `structure`, `motionUsage` |
| C-21 | Тесты-обходы добавлены ко всем проверкам. «ignores tests» у `jsx-text` оставлен (тесты — не UI); «does not scan code outside ui» у `ts-timings` стал «leaves network timeouts …» (аудит признал сетевые тайм-ауты допустимыми) | `tests/checks/*` | 17 файлов |
| A-05 | Корень проверок — `frontend` по `import.meta.dirname`; без `src/` — сообщение и exit 2 | `index.ts`, `files.ts` | `files.test.ts` |

### A, R, S, T, UI в моих файлах

| ID | Что сделано | Файл | Тест |
| --- | --- | --- | --- |
| A-02 | Override Biome удалён целиком (живой `fixtureGateway.ts` теперь проверяется) | `biome.json` | `npm run lint` |
| A-03 | `formatter.lineEnding: "lf"` | `biome.json` | — |
| A-04 | `typecheck` = `tsc --noEmit && tsc --noEmit -p e2e` (e2e + `playwright.config.ts`) | `package.json` | `npm run verify` |
| R-01 | `<title>DID Hack</title>`; `LocaleProvider` ставит `document.title` из `common:app.title` | `index.html`, `shared/i18n/LocaleProvider.tsx` | `localeProvider.test.tsx` |
| R-02 | Комментарии в `docker/*` убраны, сообщение на английском; объяснения — в `frontend-contracts.md` §13.5 | `docker/*` | `no-comments`, `cyrillic` |
| R-03 | `BACKEND_CONTENT_LANG` + `<BackendText>` | `shared/i18n/BackendText.tsx` | `shared/ui/layers.test.tsx` |
| R-08 | `--radius-flag: 3px` в шкале | `tokens/radius.css`, `flag/styles.module.css` | `scale-tokens` |
| R-12 | Удалены мёртвые `common:action.{cancel,dismiss,open}`, `status.{pending,loading,live}`, `select.empty`, `locale.*`; тест на неиспользуемые ключи `common`/`errors` | `locales/{ru,en}/common.json` | `shared/i18n/usedKeys.test.ts` |
| R-13 | `IndicatorBox` не экспортируется; `STATUS_ICON` удалён; мёртвые токены удалены (`--mist`, `--eucalyptus`, `--transition-surface`, `--dur-slow-exit`, `--motion-appear-mark` + `kf-appear-mark`, `--space-section`, `--page-max-width`, `--banner-text-min`); `gt-standard-files.css` удалён (не подключался) | shared, tokens | `css-modules`, сборка |
| R-15 | `RUN_STATUSES`, `GOAL_KINDS`, `JOURNAL_KINDS`, `JUDGE_MODES`, `PLANNER_MODES` в `contract.ts`, парсеры берут их; `connectionStatus(view)` в `viewState` | `domain/contract.ts`, `domain/parsing/*`, `application/viewState.ts` | `viewState.test.ts` |
| R-18 | Производные цвета описаны в `tokens.md` | `context/tokens.md` | — |
| R-19 | `--focus-ring-color-inverse` у `Banner .critical` и `[data-surface="inverse"]`; пара в `contrast` | `banner/styles.module.css`, `global.css` | `contrast.test.ts` |
| R-20 | Метки карты темнее, ≥3:1 к свободным и неизвестным клеткам | `tokens/palette.css`, `semantic.css` | `contrast` (реальные токены) |
| R-21 | `:focus-visible` у `ScrollArea` без перехода (`transition: none`), отдельное правило | `scroll-area/styles.module.css` | `hover-gate` |
| R-22 | Названия тестов `tests/application/*`, `gateway.contract.test.ts`, `support.ts` переведены, данные — английские | эти файлы | `cyrillic` |
| R-24 | Статусы обновлены: `frontend-rules.md` (§1, §2, §3, §4, §5.5, 5а, §8, §9, открытые вопросы), `frontend-contracts.md` (locale-switch, Button, StatusBadge, Banner + §13), `frontend-plan.md`, `README.md` | `context/` | — |
| R-25 | `detail` берётся только из `ApiError` (текст сервера), внутренние английские сообщения в интерфейс не попадают | `application/errorDescription.ts` | `describeError.test.ts` |
| S-01 | `createRequestId()` с fallback на `getRandomValues`/`Math.random` | `adapters/requestId.ts` | `tests/adapters/requestId.test.ts` |
| S-04 | Владелец `data-view-transition` — счётчик; ошибка `change` пробрасывается | `shared/motion/withViewTransition.ts` | `transitions.test.tsx` |
| S-06 | Экспорт: флаг занятости по поколению; `MapLoading.reset()` сбрасывает `lastAttemptAt` | `application/session/*` | `tests/application` |
| S-09 | Кэш `Intl.NumberFormat` по опциям и один `ListFormat` | `shared/i18n/formatters.ts` | `formatters.test.ts` |
| T-18 | Reduced-тесты `usePresence` и `Swap` различают reduced и обычный режим | `tests/shared/motion/*` | там же |
| T-22 | `ruleBody` падает без селектора, общий хелпер | `tests/setup/styleRules.ts` | `frequency`, `motionReview` |
| T-26 | Шум jsdom `getContext` убран моком в setup | `tests/setup/polyfills.ts` | — |
| UI-01 | Слои масштабируются как страница (`currentCSSZoom` якоря) | `layer-host`, `popover/useAnchorPosition.ts`, `dialog` | `layers.test.tsx` |
| UI-02, UI-04 | `ScrollArea`: `grid-template-rows: minmax(0,1fr)`, `scroll-padding-block` | `scroll-area/styles.module.css` | — |
| UI-06 | Firefox-свойства под `@supports not selector(::-webkit-scrollbar)`, стрелки скрыты; список `Select` в `ScrollArea` + прокрутка к активному | `global.css`, `scroll-area`, `select` | `overlays.test.tsx` |
| UI-13, UI-28 | `StatusBadge`: один mint-вид, «выполняется» — пульс, спиннер только у явного `loader` | `status-badge/*` | `display.test.tsx` |
| UI-18 | `animation: none` у корневой группы при `mission` | `global.css` | — |
| UI-19 | Мягкий fade входа и выхода в reduced во всех примитивах | `tokens/motion.css`, `motion/fallbackDelay.ts` | `presence`, `swap` |
| UI-20 | `Segmented` 44px, шаги `NumberField` 44×44, поле ввода растянуто | `segmented`, `number-field` | `touch-targets` |
| UI-21 | «backend» → «сервер»/«server» в `common`, `errors` | locales | — |
| UI-25 | Шеврон `Disclosure` по первой строке | `disclosure/styles.module.css` | — |
| UI-27 | dark-кнопка 12px, 16px только `shape="pill"` | `button/*` | `layers.test.tsx` |
| UI-30 | `--wall-stone` светлее с сохранением 3:1 | `palette.css` | `contrast` |
| UI-31 | Действие `Banner` под текстом; регрессия высоты исправлена (`.body { flex: none }`) | `banner/styles.module.css` | `bannerLayout.test.ts` |
| UI-32 | `LayerHost`: порталы внутри ориентира | `layer-host/*` | `layers.test.tsx` |
| UI-33 | Убраны `@font-face` GT через `local()` (давали `error`); Inter из `public/fonts` | `tokens/typography.css` | — |
| UI-35 | `Select`/`Field` `hideLabel` | `select`, `field` | `layers.test.tsx` |

`presentation/tokens.css` пересобран `npm run export-tokens` (тест `presentationTokens` сверяет его с токенами).

## Не исправлено и почему

- **A-03 `.gitattributes`** — файл вне моего списка. Рекомендация: `frontend/.gitattributes` с `* text=auto eol=lf`. Biome уже требует LF.
- **R-23 / UI-33, шрифт GT** — файлов GT нет; записан `[вопрос]` в `frontend-rules.md` §4.
- **T-23 (`tests/shared` → `tests/ui/shared`)** — перенос затронул бы десятки относительных импортов параллельно с X2; `package-subject` явно разрешает `tests/shared`. Оставлено.
- **C-20, мелочь:** динамический `import("…/reset.css")` не ловит `global-styles`; `setProperty("color", "var(--carbon)")` в TS не ловит `token-layers` (inline-стиль ловит `css-literals`).
- **`--text-disabled`** исключён из `contrast` намеренно (WCAG 1.4.3).
- Находки хука impeccable в `tests/checks/*` (bounce, side-tab, layout-transition) — ложные: это негативные фикстуры для проверок.

## Для X2

Всё ниже готово; судя по коду, `LayerHost`, `createRequestId`, `BackendText`, `connectionStatus` уже подключены.

1. **R-03.** `BACKEND_CONTENT_LANG`, `<BackendText as="p" className>` из `@/ui/shared/i18n`; `as`: `span|p|div|li|dd|dt`.
2. **UI-04/UI-02.** `ScrollArea`: высоту ограничивает `max-block-size` на `className` корня.
3. **UI-18.** Дайте карточке миссии `view-transition-name: mission`.
4. **UI-19.** Ничего не нужно: `Swap` уже `data-motion="fade"`, исправлен резервный таймер.
5. **UI-20, UI-21, UI-25, UI-31, UI-35** — в shared, см. таблицу.
6. **UI-32 и режим показа.** `<LayerHost>` вокруг приложения внутри `<main>`/корневой раскладки. Слои берут масштаб якоря сами.
7. **S-01.** `generateId: () => createRequestId()` из `./adapters/requestId`.
8. **UI-13/UI-28/UI-27.** `StatusBadge` один вид; `Button shape="pill"` — только в шапке.
9. **R-15.** `JOURNAL_KINDS` из `@/domain/contract` вместо своего списка в `features/journal/labels.ts`; `connectionStatus(view)` вместо `headerConnection`/`isOffline`.
10. **R-25.** `message.params.detail` (текст сервера) можно показать отдельной строкой в `<BackendText>`.
11. **R-06.** `consistency` ловит свою карточку (`padding` + `--radius-inner/card` + `--surface-*`).
12. **R-17.** `shared/motion/canvasPalette.ts` — знание карты в shared; перенос в `features/map/` за вами. После переноса удалите старый путь из `SIGNAL_SCOPES` в `scripts/checks/rules/unityCss.ts` (или скажите мне).
13. **R-13.** Мёртвые экспорты в ваших файлах: `TRANSPARENT` (`features/map/color.ts`), `researchFrom` (`adapters/fixture/content.ts`), `isFixtureScenarioName`, `ResearchKey`, `STEP_STATUS_LABELS`, `ENTRY_COUNT_LABEL`, `ROBOT_COUNT_LABEL` — проверьте.
14. **R-22.** `tests/domain.test.ts`, `tests/research.test.ts` — в базе `cyrillic.txt`; после перевода `npm run rules -- --prune`.
15. **S-08 / UI-33.** `fetch("/config.json")` без тайм-аута и 404 в консоли — `main.tsx`.
