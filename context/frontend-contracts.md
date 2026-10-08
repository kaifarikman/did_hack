# Контракты фронтенда (Рубеж 0)

Дата: 2026-10-08. **Статус:** предложение F1, ждёт подтверждения F2. После подтверждения имена и сигнатуры меняются только по согласию обоих.

Основание: [frontend-rules.md](frontend-rules.md), [frontend-plan.md](frontend-plan.md), [tokens.md](tokens.md).

## 1. Пути и импорты

| Что | Путь | Импорт |
| --- | --- | --- |
| Токены и глобальные стили | `src/ui/shared/styles/` (`global.css`, `reset.css`, `tokens/*.css`) | только `src/main.tsx` |
| Примитивы интерфейса | `src/ui/shared/ui/<kebab-name>/{index.tsx,styles.module.css}` | `@/ui/shared/ui` (общий индекс) |
| Примитивы движения | `src/ui/shared/motion/*` | `@/ui/shared/motion` |
| i18n | `src/ui/shared/i18n/*` | `@/ui/shared/i18n` |
| Сообщения домена | `src/domain/message.ts` | `@/domain/message` |
| Словари | `src/ui/shared/i18n/locales/{ru,en}/<ns>.json` | только `resources.ts` |

Алиас `@/` → `src/`. Фичи импортируют только общие индексы, не внутренние файлы примитивов.

## 2. Токены

Компоненты используют только семантический слой. Палитру (`--sage-canvas`, `--carbon`, …) напрямую берут только файлы `tokens/`.

### Цвет: поверхности

| Токен | Значение |
| --- | --- |
| `--surface-canvas` | sage `#d3e4df`, фон страницы |
| `--surface-card` | white, карточка верхнего уровня |
| `--surface-card-hover` | шаг вниз от card |
| `--surface-tint` | mint `#edf4f2`, вложенный блок, бейдж |
| `--surface-tint-hover` | шаг вниз от tint |
| `--surface-selected` | выбранный сегмент, выбранная строка (white на tint) |
| `--surface-inverse` | deep forest `#34484a`, тёмная секция, критичный статус |
| `--surface-inverse-strong` | carbon, тёмная кнопка |
| `--surface-scrim` | подложка диалога |
| `--surface-skeleton` | заливка скелета |

### Цвет: текст

| Токен | Значение |
| --- | --- |
| `--text-primary` | carbon |
| `--text-secondary` | slate |
| `--text-tertiary` | затемнённый mist, ≥ 4.5:1 на sage/white/mint (eyebrow, подписи) |
| `--text-disabled` | fog, только у неактивных элементов |
| `--text-on-inverse` | white |
| `--text-on-inverse-secondary` | white с прозрачностью, ≥ 4.5:1 на deep forest |
| `--text-on-action` | carbon на teal |

### Цвет: действия, границы, фокус

| Токен | Значение |
| --- | --- |
| `--action-primary` / `-hover` / `-press` | teal и два шага темнее |
| `--action-dark` / `-hover` | carbon → graphite |
| `--action-ghost-hover` | tint-подсветка у ghost |
| `--action-disabled` | фон неактивной кнопки |
| `--border-hairline` | 1px разделители и края |
| `--border-strong` | slate |
| `--border-input` | `#717f80` из Zoox |
| `--border-inverse` | разделитель на тёмном |
| `--focus-ring-color`, `--focus-ring-width` (2px), `--focus-ring-offset` (2px) | общий `:focus-visible` в `global.css` |

### Цвет: данные (только карта и графики)

Пять приглушённых цветов, согласованных с sage. Teal здесь не используется.

| Палитра | Семантика |
| --- | --- |
| `--data-ochre` | `--data-sample` — образцы |
| `--data-clay` | `--data-hazard` — опасная зона |
| `--data-dusk` | `--data-robot-partner` — второй робот, его бронь и путь |
| `--data-moss` | `--data-soil-low` → `--data-soil-high` (шкала стоимости грунта, с `--data-sand`) |
| `--data-brick` | `--data-critical` — ошибка, Stop, потеря связи |

Нейтральные роли карты: `--data-robot` (carbon), `--data-path` (graphite), `--data-trail` (slate 50%), `--data-base` (eucalyptus), `--data-grid` (hairline), `--data-unknown` (sage темнее), `--data-free` (white), `--data-obstacle` (graphite), `--data-label` (carbon), `--data-label-halo` (white).

`readCanvasPalette()` возвращает объект `CanvasPalette` с ключами-ролями без префикса: `sample`, `hazard`, `robot`, `robotPartner`, `path`, `trail`, `base`, `grid`, `unknown`, `free`, `obstacle`, `soilLow`, `soilHigh`, `critical`, `label`, `labelHalo`.

### Типографика

`--font-ui` (GT Standard S + fallback), `--font-display` (GT Standard L + fallback), `--font-features` (`"kern" 0`), `--font-numeric` (`tabular-nums`).

Размеры: `--font-size-{caption,body-sm,body,subheading,heading-sm,heading,heading-lg,display-sm,display}` с парами `--line-height-*` и `--tracking-*`. Имя `--text-*` занято цветом текста. Вес: `--weight-regular` 400, `--weight-medium` 500, `--weight-semibold` 600.

### Отступы, радиусы, тени, размеры

- `--space-{4,8,12,16,20,24,32,36,40,60,80,100,160}` — шкала Zoox. Роли: `--space-card` 24, `--space-inner` 16, `--space-element` 12, `--space-section` 32.
- `--radius-flag` 3, `--radius-check` 6, `--radius-button` 12, `--radius-inner` 16, `--radius-badge` 20, `--radius-card` 36, `--radius-round` 9999px (поправка 13).
- `--shadow-float` — единственная тень, у тултипа и диалога.
- `--target-min` 44px, `--control-height` 44px, `--control-height-compact` 36px (только в плотных строках, цель нажатия добирается паддингом), `--hairline` 1px, `--page-max-width` 1920px.
- Брейкпоинты только `30rem`, `48rem`, `64rem`, `75rem` (литералы в `@media`, переменные там не работают).

### Движение

| Токен | Значение |
| --- | --- |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` |
| `--dur-instant` 80, `--dur-press` 140, `--dur-fast` 160, `--dur-fast-exit` 110, `--dur-base` 200, `--dur-exit` 140, `--dur-panel` 260, `--dur-slow` 320, `--dur-draw` 900, `--dur-breathe` 2600 | ms |
| `--delay-skeleton` 200, `--delay-spinner` 400, `--hold-skeleton` 300, `--stagger` 40, `--reduced-fade` 160, `--view-transition-limit` 900 | ms |
| `--press-scale` 0.97, `--press-scale-surface` 0.99, `--enter-scale` 0.95, `--shift-rise` 6px, `--shift-slide` 8px | |
| `--transition-control` | фон, цвет, рамка за `--dur-fast`, transform за `--dur-press` |
| `--transition-surface` | фон за `--dur-fast` |

Анимации подключаются только через `animation: var(--motion-*)`. Keyframes (`kf-*`) лежат в `tokens/keyframes.css`:

`--motion-fade-in`, `--motion-fade-out`, `--motion-scale-in`, `--motion-scale-out`, `--motion-slide-in`, `--motion-rise-in`, `--motion-pop-in`, `--motion-expand`, `--motion-collapse`, `--motion-pulse`, `--motion-spin`, `--motion-commit`, `--motion-verdict`, `--motion-verdict-emphatic`, `--motion-appear-mark`, `--motion-shimmer`.

Лесенка: элемент получает `style={staggerStyle(index)}` (ставит `--i`) и `animation-delay: calc(var(--i) * var(--stagger))`.

Reduced motion (`prefers-reduced-motion: reduce`): все `--dur-*` = 1ms, `--stagger` = 0ms, `--press-scale*` и `--enter-scale` = 1, `--shift-*` = 0, `--motion-pulse`/`--motion-spin`/`--motion-shimmer` = `none`. Элементы с `data-motion="fade"` получают вместо входных `--motion-*` короткий fade за `--reduced-fade`.

## 3. Примитивы интерфейса `@/ui/shared/ui`

Все пропсы `readonly`. Тексты приходят строками из `t()` у вызывающего; свои тексты (aria-label по умолчанию) примитив берёт из `common`. `className` разрешён только для раскладки (отступы, grid-area), не для цвета и формы.

```ts
type IconName =
  | "close" | "check" | "alert" | "critical" | "info" | "play" | "stop" | "retry"
  | "download" | "chevron-down" | "chevron-right" | "battery" | "battery-low" | "signal"
  | "signal-off" | "clock" | "target" | "sample" | "map" | "robot" | "hazard" | "sensor"
  | "plan" | "journal" | "hypothesis" | "confirmed" | "refuted" | "inconclusive" | "team"
  | "language" | "live" | "offline" | "loader" | "home" | "route" | "filter" | "pending"

interface IconProps { readonly name: IconName; readonly size?: "sm" | "md" | "lg"; readonly label?: string; readonly className?: string }

type ButtonVariant = "primary" | "dark" | "ghost"
interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  readonly variant?: ButtonVariant
  readonly size?: "regular" | "compact"
  readonly icon?: IconName
  readonly iconPosition?: "start" | "end"
  readonly pending?: boolean
  readonly fullWidth?: boolean
  readonly children: ReactNode
}

interface CloseButtonProps { readonly onClick: () => void; readonly label?: string; readonly tone?: "default" | "inverse"; readonly className?: string }

interface SegmentedOption<T extends string> { readonly value: T; readonly label: string; readonly icon?: IconName; readonly disabled?: boolean; readonly disabledReason?: string }
interface SegmentedProps<T extends string> {
  readonly label: string
  readonly options: readonly SegmentedOption<T>[]
  readonly value: T
  readonly onChange: (value: T) => void
  readonly size?: "regular" | "compact"
  readonly disabled?: boolean
  readonly className?: string
}

interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly level?: "top" | "inner"
  readonly tone?: "default" | "inverse"
  readonly as?: "section" | "article" | "aside" | "div"
  readonly motionIndex?: number
  readonly children: ReactNode
}

interface EyebrowProps { readonly as?: "p" | "span" | "h2" | "h3" | "div"; readonly tone?: "default" | "inverse"; readonly id?: string; readonly className?: string; readonly children: ReactNode }

type StatusTone = "neutral" | "progress" | "positive" | "attention" | "critical"
interface StatusBadgeProps { readonly tone: StatusTone; readonly icon?: IconName; readonly live?: boolean; readonly swapKey?: string; readonly className?: string; readonly children: ReactNode }

interface StatProps { readonly label: string; readonly value: string | null; readonly unit?: string; readonly size?: "regular" | "large"; readonly tone?: "default" | "attention"; readonly icon?: IconName; readonly className?: string }

interface MeterProps { readonly label: string; readonly value: number | null; readonly valueText: string; readonly threshold?: number; readonly thresholdLabel?: string; readonly tone?: "default" | "attention" | "critical"; readonly className?: string }

type BannerTone = "info" | "attention" | "critical"
interface BannerProps { readonly tone: BannerTone; readonly title: string; readonly children?: ReactNode; readonly icon?: IconName; readonly action?: ReactNode; readonly open?: boolean; readonly onDismiss?: () => void; readonly className?: string }

interface NoValueProps { readonly label?: string }
```

Поведение:

- `Button`: `primary` — teal, текст carbon; `dark` — carbon, радиус `--radius-button` как у primary; радиус `--radius-inner` только у `shape="pill"` в шапке (поправка 13); `ghost` — без фона, hover `--action-ghost-hover`. `pending` ставит `aria-busy`, показывает `loader` и блокирует клики. Высота ≥ 44px. Нажатие — `scale(var(--press-scale))`.
- `Segmented`: `role="radiogroup"`, стрелки двигают выбор, бегунок через `useSlidingIndicator`. Неактивный вариант показывает `disabledReason` через `title`.
- `Card`: `top` — white, радиус 36, паддинг 24; `inner` — tint, радиус 16, паддинг 16. `motionIndex` включает вход лесенкой.
- `StatusBadge`: один вид — mint-бейдж без рамки. Иконка по тону: neutral `pending`, positive `check`, attention `alert`, critical `critical` (attention и critical ещё и полужирные). progress без `icon` и `live` — пульсирующая точка. `swapKey` — смена текста через `Swap` (поправка 13).
- `Stat`: eyebrow + число `tabular-nums` + единица; `null` → `NoValue`. Числа не анимируются.
- `Meter`: `role="meter"`, полоса через `transform: scaleX`; переход тона в `attention`/`critical` даёт одну вспышку `--motion-commit`.
- `Banner`: `critical` — `role="alert"`, остальные `role="status"`. Без боковой полосы. `open` анимирует `--motion-expand`/`--motion-collapse` через `usePresence`.
- `NoValue`: одно и то же тире из `common:value.none`, `aria-label` из `common:value.noneLabel`.

### Вторая волна (FS-08), сигнатуры зафиксированы заранее

```ts
interface FieldControlProps { readonly id: string; readonly "aria-describedby": string | undefined; readonly "aria-invalid": boolean }
interface FieldProps { readonly label: string; readonly hint?: string; readonly error?: string; readonly children: (control: FieldControlProps) => ReactNode }

interface SelectOption<T extends string> { readonly value: T; readonly label: string; readonly disabled?: boolean }
interface SelectProps<T extends string> { readonly label: string; readonly value: T; readonly options: readonly SelectOption<T>[]; readonly onChange: (value: T) => void; readonly hint?: string; readonly error?: string; readonly disabled?: boolean }

interface NumberFieldProps { readonly label: string; readonly value: number | null; readonly onChange: (value: number | null) => void; readonly min?: number; readonly max?: number; readonly step?: number; readonly unit?: string; readonly hint?: string; readonly error?: string; readonly disabled?: boolean }

interface TextFieldProps { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly multiline?: boolean; readonly placeholder?: string; readonly maxLength?: number; readonly hint?: string; readonly error?: string; readonly disabled?: boolean }

interface TooltipProps { readonly content: string; readonly side?: "top" | "bottom" | "start" | "end"; readonly children: ReactElement }

interface DialogProps { readonly open: boolean; readonly onClose: () => void; readonly title: string; readonly description?: string; readonly actions?: ReactNode; readonly size?: "regular" | "wide"; readonly children: ReactNode }

interface SkeletonProps { readonly shape?: "line" | "block" | "circle"; readonly lines?: number; readonly className?: string }
interface SpinnerProps { readonly label: string; readonly size?: "sm" | "md" }

interface EmptyStateProps { readonly title: string; readonly description?: string; readonly icon?: IconName; readonly action?: ReactNode; readonly size?: "regular" | "hero" }
interface ErrorStateProps { readonly title: string; readonly description?: string; readonly onRetry?: () => void; readonly retryPending?: boolean }

interface DisclosureProps { readonly summary: ReactNode; readonly defaultOpen?: boolean; readonly children: ReactNode; readonly className?: string }

type ProgressStepStatus = "pending" | "active" | "done" | "rejected" | "dropped"
interface ProgressStep { readonly id: string; readonly label: string; readonly status: ProgressStepStatus; readonly detail?: ReactNode }
interface ProgressStepsProps { readonly label: string; readonly steps: readonly ProgressStep[] }
```

`TextField` добавлен к списку плана: он нужен форме миссии (текст миссии). `Spinner` при reduced motion статичен и показывает `label` текстом.

## 4. Примитивы движения `@/ui/shared/motion`

```ts
type PresenceState = "open" | "closed"
function usePresence(open: boolean, exitToken?: DurationToken): {
  readonly mounted: boolean
  readonly state: PresenceState
  readonly onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void
}

function useLatched<T>(value: T, open: boolean): T

interface SwapProps { readonly swapKey: string | number; readonly as?: "span" | "div"; readonly className?: string; readonly children: ReactNode }
function Swap(props: SwapProps): ReactElement

function useSlidingIndicator(activeKey: string): {
  readonly listRef: RefObject<HTMLDivElement | null>
  readonly indicatorRef: RefObject<HTMLSpanElement | null>
  readonly itemRef: (key: string) => (element: HTMLElement | null) => void
}

type ViewTransitionMode = "mission" | "layout" | "locale"
function withViewTransition(mode: ViewTransitionMode, change: () => void): Promise<void>

function useReducedMotion(): boolean

type LoadingIndicator = "none" | "skeleton" | "spinner" | "stale"
function useLoadingIndicator(input: { readonly pending: boolean; readonly hasData: boolean }): LoadingIndicator

function useDetailsMotion(): {
  readonly detailsRef: RefObject<HTMLDetailsElement | null>
  readonly contentRef: RefObject<HTMLDivElement | null>
  readonly state: PresenceState
  readonly onSummaryClick: (event: MouseEvent<HTMLElement>) => void
}

type DurationToken = `--dur-${string}` | "--delay-skeleton" | "--delay-spinner" | "--hold-skeleton" | "--stagger" | "--reduced-fade" | "--view-transition-limit"
type EasingToken = "--ease-out" | "--ease-in-out" | "--ease-drawer"
function motionMs(token: DurationToken): number
function readEasing(token: EasingToken): string
function readCanvasPalette(): CanvasPalette
function staggerStyle(index: number): CSSProperties
```

- `usePresence`: `mounted` держит элемент, пока идёт выход; размонтирование по `animationend` или по резервному таймеру `motionMs(exitToken)` (по умолчанию `--dur-exit`). Компонент ставит `data-state={state}` и в CSS выбирает `--motion-*-in` или `--motion-*-out`.
- `Swap`: сначала уходит старое содержимое (WAAPI), потом входит новое; высота фиксируется на время смены; при reduced motion — только fade.
- `withViewTransition`: ставит `data-view-transition={mode}` на `<html>`; без API или при reduced motion применяет изменение сразу; обрывает переход через `--view-transition-limit`.
- `useLoadingIndicator`: скелет через `--delay-skeleton`, держится не меньше `--hold-skeleton`, спиннер через `--delay-spinner`; если данные есть — `stale`.
- Числа миллисекунд в TS не пишутся: всё через `motionMs`.

## 5. i18n `@/ui/shared/i18n` и сообщения домена

```ts
type Locale = "ru" | "en"
const LOCALES: readonly Locale[]
const DEFAULT_LOCALE: Locale
type Namespace = "common" | "errors" | "mission" | "map" | "research" | "journal" | "team" | "demo"

function LocaleProvider(props: { readonly children: ReactNode }): ReactElement
function useLocale(): { readonly locale: Locale; readonly setLocale: (locale: Locale) => void }
export { useTranslation } from "react-i18next"

interface Formatters {
  readonly number: (value: number, fractionDigits?: number) => string
  readonly integer: (value: number) => string
  readonly percent: (ratio: number, fractionDigits?: number) => string
  readonly unit: (value: number, unit: MeasureUnit, fractionDigits?: number) => string
  readonly duration: (seconds: number) => string
  readonly time: (value: Date | string | number) => string
  readonly dateTime: (value: Date | string | number) => string
  readonly list: (items: readonly string[]) => string
}
type MeasureUnit = "meter" | "second" | "minute" | "percent" | "degree" | "meter-per-second"
function useFormatters(): Formatters

function describeError(error: unknown): Message
function useMessageText(): (message: Message) => string
```

`src/domain/message.ts` (без React и без i18next):

```ts
interface MessageCatalog {}
type MessageKey = keyof MessageCatalog & string
type MessageParams = Readonly<Record<string, string | number>>
interface Message { readonly key: MessageKey; readonly params?: MessageParams }
function msg(key: MessageKey, params?: MessageParams): Message
class LocalizedError extends Error { readonly descriptor: Message }
```

`MessageCatalog` дополняется из `ui/shared/i18n/messageCatalog.ts` (module augmentation): ключи вида `"mission:state.running"` выводятся из `en`. Домен не импортирует `ui`, но опечатка в `msg()` ломает typecheck.

Цепочка `describeError`: `LocalizedError` → `errors:api.<code>` (если такой ключ есть) → `errors:kind.<kind>`, где kind ∈ `network | timeout | contract | conflict | rejected | unavailable | server | unknown`. Текст backend передаётся параметром `detail` как есть.

Словари: `src/ui/shared/i18n/locales/{ru,en}/<ns>.json`, вложенные объекты, ключи camelCase, интерполяция `{{name}}`, множественное число через суффиксы i18next (`_one`, `_few`, `_many`, `_other` в ru; `_one`, `_other` в en). Тест сверяет набор ключей ru/en по всем файлам папки (с учётом plural-суффиксов по локали). F1 создаёт пустые `{}` файлы F2-неймспейсов, чтобы `resources.ts` собирался; дальше их меняет только F2.

`LocaleProvider` хранит выбор в `localStorage["did-locale"]` (чтение и запись в try/catch), ставит `document.documentElement.lang`, вызывает `i18n.changeLanguage`. По умолчанию `ru`.

## F2 дописывает

- Раскладка `ui/features/*`.
- Список сценариев демо из [frontend-coverage.md](frontend-coverage.md).
- Какие примитивы нужны каждой фиче; недостающие иконки и токены.

## 6. Раздел F2: фичи, сценарии, потребности

Дата: 2026-10-08. **Статус:** предложение F2. Пункты 1–5 выше F2 принимает без изменений.

### 6.1 Раскладка `src/ui`

| Папка | Что внутри | Неймспейс |
| --- | --- | --- |
| `app/` | `AppShell` (корень, сетка областей), `AppHeader` (название, статус связи, место под язык, сценарий демо), `useMission` | `common` |
| `features/mission/` | Форма запуска, Start/Stop/повтор, показатели, итог прогона (SC-11); карты подписей `status`, `goal`, `judge`, `planner`, `outcome` | `mission` |
| `features/map/` | `MapCanvas`, слои `layers/*`, цикл анимации `animation/*`, легенда, `mapTheme.ts` (единственная точка чтения палитры и таймингов) | `map` |
| `features/research/` | План (шаги, предпосылки, пересмотр), датчик, опасности, гипотезы, грунт | `research` |
| `features/journal/` | Лента, фильтр по типу, догрузка, цепочка гипотезы, экспорт | `journal` |
| `features/team/` | Роботы, брони, потеря партнёра, итог команды | `team` |
| `features/locale-switch/` | Кнопка-глобус + `Menu` RU/EN (раздел 11) | `common` |
| `features/demo/` | Переключатель сценария демо (только в режиме fixture) | `demo` |

Фичи не импортируют друг друга. Подписи перечислений — `Record<Enum, MessageKey>` в `features/<x>/labels.ts`. Форматирование чисел — функции, которые принимают `Formatters` и возвращают `Message`, без склейки строк.

### 6.2 Сценарии демо (`src/adapters/fixture/`)

Все 16 сценариев из [frontend-coverage.md](frontend-coverage.md) готовы: `env_starting`, `idle_ready`, `success`, `llm_fallback`, `plan_revision`, `medium_adaptation`, `hard_events`, `slam_building`, `team_success`, `team_partial`, `disconnect`, `failed`, `start_rejected`, `command_unknown`, `stopped`, `journal_long`. Порядок и имена — `FIXTURE_SCENARIOS` в `catalog.ts`; подписи — `demo:scenario.<name>` и `demo:hint.<name>`. Тексты backend (причины, план, журнал) лежат в JSON рядом с модулем сценария.

### 6.3 Что нужно фичам из `shared`

| Фича | Примитивы | Движение |
| --- | --- | --- |
| app | `StatusBadge` (live), `Banner`, `Select`, `Eyebrow`, `Icon` | `usePresence`, `staggerStyle`, `withViewTransition("layout")` |
| mission | `Card`, `Eyebrow`, `StatusBadge`, `Stat`, `Meter` (порог = резерв возврата), `Button` (primary/dark/ghost), `Segmented`, `NumberField`, `TextField`, `Banner`, `NoValue`, `Icon` | `Swap`, `withViewTransition("mission")` |
| map | `Card`, `Eyebrow`, `EmptyState`, `ErrorState`, `Banner`, `Skeleton`, `Icon` | `useReducedMotion`, `motionMs`, `readEasing`, `readCanvasPalette` |
| research | `Card`, `ProgressSteps`, `StatusBadge`, `Stat`, `Disclosure`, `Icon`, `NoValue` | `Swap`, `staggerStyle`, `--motion-pop-in`, `--motion-verdict` |
| journal | `Card`, `Segmented`, `Button`, `Disclosure`, `EmptyState`, `ErrorState`, `Banner`, `Spinner`, `Icon` | `useDetailsMotion`, `useLoadingIndicator`, `--motion-rise-in`, `--motion-verdict` |
| team | `Card`, `StatusBadge`, `Stat`, `Meter`, `Icon` | `Swap`, `--motion-verdict-emphatic` |
| locale-switch | `Button`, `Menu`, `MenuItemRadio`, `Flag` | `useCheckedIndicator`, `settleDelay` |

### 6.4 Просьбы F2 к F1

- Иконки сверх списка: `observation` (eye), `experiment` (flask-conical), `decision` (git-branch), `llm` (sparkles), `fallback` (cpu), `terrain` (layers), `reservation` (lock), `seed` (hash).
- Роли `CanvasPalette` сверх списка: `goal` (текущая цель) и `planStep` (следующие шаги плана). Если их не будет, карта использует `robot` и `path`.
- Канвасу нужны `motionMs("--dur-draw" | "--dur-slow" | "--dur-base")` и `readEasing("--ease-out")`; карта перечитывает палитру при смене темы через `readCanvasPalette()`.
- `src/domain/status.ts` (или аналог в `domain`) с `isActiveStatus`, `isFinishedStatus`, `isStartableStatus`, `isMapMismatch`, `outcomeKind`: это правила, а не подписи. После переноса F2 удаляет `domain/presentation.ts`.
- Пустые `{}` файлы F2-неймспейсов не создавать: F2 уже создал `locales/{ru,en}/{mission,map,research,journal,team,demo}.json`; при слиянии остаётся версия F2.

## 7. Уточнения F1 по итогам Рубежа 1

Дата: 2026-10-08. **Статус:** реализовано в ветке `feature/frontend-system`. Разделы 1–5 действуют с этими поправками.

### 7.1 Ответы на 6.4

- Иконки добавлены: `observation` (Eye), `experiment` (TestTubeDiagonal: FlaskConical уже занят `sample`, одна иконка — одно имя), `decision` (GitBranch), `llm` (Sparkles), `fallback` (Cpu), `terrain` (Layers), `reservation` (Lock), `seed` (Hash).
- `CanvasPalette` получил роли `goal` (`--data-goal`) и `planStep` (`--data-plan-step`).
- `src/domain/status.ts`: `isActiveStatus`, `isFinishedStatus`, `isStartableStatus`, `isMapMismatch`, `outcomeKind`, тип `OutcomeKind`. `application` уже импортирует отсюда; `fixtureGateway.ts` (F2) переводится F2.
- Пустые `{}` файлы F2-неймспейсов в ветке F1 есть, потому что без них не собирается `resources.ts`. При слиянии берётся версия F2.

### 7.2 Поправки к токенам

- Добавлены длительности `--dur-panel-exit` 180, `--dur-slow-exit` 200, `--dur-spin` 800; кривая `--ease-linear`; `--mark-scale`, `--blur-soft`.
- Добавлены `--transition-meter`, `--motion-swap-in`/`--motion-swap-out`, `--motion-details-in`/`--motion-details-out`.
- Добавлены `--action-ghost-press`, `--action-inverse-hover`. `--action-ghost-hover`/`-press` считаются от `currentColor`, поэтому ghost-кнопка работает и на тёмном.
- Добавлены сигнальные цвета `--signal-neutral` (carbon), `--signal-attention` (ochre), `--signal-critical` (brick): полоса `Meter` и значок внимания у `Stat`. Это тот же приглушённый ряд, что у `--data-*`.
- Размеры: `--icon-sm/md/lg`, `--icon-stroke` 1.5, `--dot-size`, `--meter-height`.
- Общие наборы деклараций лежат в `src/ui/shared/styles/compose.module.css` (`controlText`, `captionText`, `pressable`) и подключаются через `composes`. Так `css-duplicates` не ловит повтор.

### 7.3 Поправки к примитивам

- `Segmented` — это `<fieldset>` с нативными radio: стрелки работают без своего кода, при выборе с клавиатуры бегунок не анимируется.
- `useSlidingIndicator<TList>(activeKey, { instant? })` — генерик по элементу списка.
- `Meter` отдаёт семантику нативному `<meter>` (скрыт), полоса — `aria-hidden`.
- ~~`StatusBadge` экспортирует `STATUS_ICON`~~ — удалено в поправке 13 (снаружи не использовался).
- `className` у примитивов принимает `string | undefined`.
- Тексты `common`: `action.{close,retry,cancel,dismiss}`, `status.{pending,loading,live,attention}`, `value.{none,noneLabel}`, `meter.threshold`, `locale.{label,ru,en}`, `app.title`.

### 7.4 Проверки, которые теперь действуют для кода F2

`npm run rules` (12 проверок с ratchet-базой в `frontend/scripts/baselines/`). Новый файл F2 должен проходить все проверки сразу; старые панели в базе, база может только уменьшаться (`npm run rules -- --prune`). `css-duplicates` не считает «связочные» свойства раскладки (`display`, `position`, `content`, `align-items`, `align-self`, `justify-content`, `flex`, `flex-direction`, `gap`, `inset*`, `min-inline-size`) и пользовательские свойства `--*`.

## 8. Поправки F1 в Рубеже 2: API `application` и `domain` (FS-07)

Дата: 2026-10-08. **Статус:** реализовано в ветке `feature/frontend-system`. Публичный API `MissionController` не изменился: `subscribe`, `getView`, `start`, `dispose`, `selectHypothesis`, `startRun(seed, scenario, missionText, mapMode, robotCount)`, `stopRun`, `retryCommand`, `dismissCommandMessage`, `exportJournal`. Изменились типы состояния экрана.

### 8.1 `MissionViewState` (`src/application/viewState.ts`)

| Поле | Было | Стало |
| --- | --- | --- |
| `connectionError`, `mapError`, `journal.error` | `string \| null` | `Message \| null` |
| `command` | `{ phase, kind, message: string \| null, canRetry }` | `{ phase, kind, message: Message \| null, cause: Message \| null, canRetry }` |
| `exportState` | `{ phase, message: string \| null }` | `{ phase, message: Message \| null, cause: Message \| null }` |

- `message` — что произошло (`errors:command.awaiting|unconfirmed|unknown|reconciled`, `errors:export.noRun|cancelled|failed|otherRun|cursorStuck` или результат `describeError`). `cause` — причина из `describeError` (для `unknown` и неудачного экспорта). Текст backend лежит в `params.detail`.
- Перевод в ui: `useMessageText()(message)`.
- Новые экспорты: `INITIAL_VIEW`, `IDLE_COMMAND`, `IDLE_EXPORT`, `EMPTY_JOURNAL`, `isCommandBusy`, тип `CommandKind`.

### 8.2 Причины недоступности Start/Stop — коды

```ts
type StartBlocker = "no_snapshot" | "offline" | "health_unknown" | "environment_starting" | "command_busy" | "run_active"
type StopBlocker = "no_run" | "offline" | "command_busy" | "run_inactive" | "already_stopping"
function startDisabledReason(view: MissionViewState): StartBlocker | null
function stopDisabledReason(view: MissionViewState): StopBlocker | null
const START_BLOCKERS: readonly StartBlocker[]
const STOP_BLOCKERS: readonly StopBlocker[]
```

Подписи кодов — у F2 в `features/mission/labels.ts` (`Record<StartBlocker, MessageKey>` в неймспейсе `mission`). Проверки формы (seed, профиль, режим карты, число роботов) остаются в фиче.

### 8.3 Ошибки

- `src/application/errorDescription.ts`: `describeError(error): Message`, `errorKind`, `isUnknownOutcome`, `KNOWN_API_CODES`. `@/ui/shared/i18n` реэкспортирует `describeError`, `errorKind`, `KNOWN_API_CODES`. Файл `application/errorMessages.ts` удалён.
- `ExportCancelledError` и `ExportFailedError` наследуют `LocalizedError` (`error.descriptor`).
- `NetworkError`, `RequestTimeoutError`, `ContractError`, `ApiError` пишут технический текст по-английски; на экран он попадает только как `detail`.

### 8.4 Разбиение модулей

- `src/application/session/{session,statePolling,mapLoading,journalSync,commands,commandRules,journalExportTask}.ts`; `missionController.ts` — фасад.
- `src/domain/parsing/{readers,research,snapshot,responses}.ts`; `domain/validation.ts` — тот же набор экспортов (`ContractError`, `parseSnapshot`, `parseHealth`, `parseMap`, `parseJournalPage`, `parseErrorBody`).
- `domain/journal.ts` `JOURNAL_KIND_LABELS` с кириллицей остаётся, пока старый `JournalPanel` жив; F2 переносит подписи в `journal.json` и после этого F1 удалит константу.

### 8.5 Ответы на просьбы F2 (f2.md)

1. `common.connection.{connecting,live,stale,offline,staleBanner,staleBannerDetail}` добавлены; `staleBannerDetail` принимает `{{detail}}`.
2. Корень: F1 переключит `src/main.tsx` на `import { AppShell } from "@/ui/app"` (именованный экспорт `AppShell`, пропсы как у нынешнего `App`: `controller`, `fixtureControls`), как только он появится в общей ветке. До этого `main.tsx` импортирует `./ui/App`.
3. `--motion-pulse` при reduced motion равен `none` — подтверждаю.
4. При слиянии брать F2-версии словарей фич — подтверждаю.
5. `package-size` считает только `.ts`, `.tsx`, `.css`; `.json` не считается — подтверждаю.

### 8.6 Минимальные правки старых панелей F2

Чтобы ветка F1 собиралась, в `src/ui/App.tsx`, `src/ui/JournalPanel.tsx`, `src/ui/MissionPanel.tsx` выводы `Message` обёрнуты в `useMessageText()`. При слиянии с переписанными панелями F2 брать версию F2.

## 9. Раздел F2: Рубеж 2 и e2e

Дата: 2026-10-08. **Статус:** реализовано в ветке `feature/frontend-screens`.

- Корень приложения: `src/ui/app/index.ts` экспортирует `AppShell` (пропсы `controller`, `fixtureControls`). Сетка раскладки переименована в `AppLayout` (`src/ui/app/app-layout`). Пока `main.tsx` импортирует `./ui/App`, этот файл — одна строка `export { AppShell as App } from "./app/index"`.
- Фичи импортируют примитивы второй волны по подпутям (`@/ui/shared/ui/select`, `number-field`, `text-area`, `progress-steps`, `disclosure`, `empty-state`, `error-state`, `skeleton`), потому что общий индекс их ещё не экспортирует. После добавления в индекс F2 переключит импорты.
- Язык в e2e задаётся через `localStorage["did-locale"]` (`page.addInitScript` до загрузки), как в `LocaleProvider`. URL-параметра нет.
- e2e выбирает элементы по ролям и текстам из словарей (`e2e/driver.ts`, `textOf(locale, "ns:key")`), без CSS-классов и без кириллицы в коде.
- Всплывающие слои проверяются по `data-state="open|closed"` на обёртке `Popover` (родитель `role="listbox"`/`role="menu"`).

## 10. Поправки F1 в Рубеже 2: примитивы второй волны, свои элементы управления, проверки (FS-08, FS-08a, FS-09, FS-10)

Дата: 2026-10-08. **Статус:** реализовано в ветке `feature/frontend-system`. Все примитивы экспортирует общий индекс `@/ui/shared/ui`. Подпути тоже работают, но лучше импортировать из индекса.

### 10.1 Сигнатуры (уточняют раздел 3)

```ts
interface FieldControlProps { readonly id: string; readonly "aria-describedby": string | undefined; readonly "aria-invalid": boolean }
interface FieldMeta { readonly labelId: string }
interface FieldProps { label: string; hint?: string; error?: string; className?: string; children: (control: FieldControlProps, meta: FieldMeta) => ReactNode }

interface TextFieldProps { label: string; value: string; onChange(value: string): void; placeholder?; maxLength?; hint?; error?; disabled?; className? }
interface TextAreaProps { label; value: string; onChange(value: string): void; placeholder?; maxLength?; minRows?: number; hint?; error?; disabled?; className? }
interface NumberFieldProps { label; value: number | null; onChange(value: number | null): void; min?; max?; step?; unit?; hint?; error?; disabled?; className? }

interface SelectOption<T extends string> { value: T; label: string; disabled?: boolean }
interface SelectProps<T extends string> { label; value: T | null; options: readonly SelectOption<T>[]; onChange(value: T): void; placeholder?; hint?; error?; disabled?; className? }

type Placement = "bottom-start" | "bottom-end" | "top-start" | "top-end"
interface PopoverProps { open: boolean; onClose(): void; anchorRef: RefObject<HTMLElement | null>; placement?: Placement; matchAnchorWidth?: boolean; id?: string; className?: string; children: ReactNode }
interface MenuItem { id: string; label: string; icon?: IconName; disabled?: boolean; onSelect(): void }
interface MenuProps { label?: string; icon?: IconName; items: readonly MenuItem[]; placement?: Placement; className? }
interface TooltipProps { content: string; side?: "top" | "bottom"; children: ReactElement }
interface DialogProps { open: boolean; onClose(): void; title: string; description?: string; actions?: ReactNode; size?: "regular" | "wide"; children?: ReactNode }

interface CheckboxProps { label; checked: boolean; onChange(checked: boolean): void; hint?; disabled?; className? }
interface SwitchProps { label; checked: boolean; onChange(checked: boolean): void; disabled?; className? }
interface RadioOption<T extends string> { value: T; label: string; hint?: string; disabled?: boolean }
interface RadioGroupProps<T extends string> { label; value: T | null; options: readonly RadioOption<T>[]; onChange(value: T): void; orientation?: "vertical" | "horizontal"; disabled?; className? }

interface ScrollAreaProps { label?: string; surface?: "card" | "tint" | "canvas"; className?; children: ReactNode }
interface SkeletonProps { shape?: "line" | "block" | "circle"; lines?: number; className? }
interface SpinnerProps { label: string; size?: "sm" | "md"; className? }
interface EmptyStateProps { title; description?; icon?: IconName; action?: ReactNode; size?: "regular" | "hero"; className? }
interface ErrorStateProps { title; description?; onRetry?(): void; retryPending?: boolean; className? }
interface DisclosureProps { summary: ReactNode; defaultOpen?: boolean; className?; children: ReactNode }
interface ProgressStepsProps { label: string; steps: readonly { id: string; label: string; status: "pending" | "active" | "done" | "rejected" | "dropped"; detail?: ReactNode }[]; className? }
type Verdict = "confirmed" | "refuted" | "inconclusive"
interface VerdictMarkProps { verdict: Verdict; label: string; className? }
```

Все необязательные пропсы принимают `undefined` (`exactOptionalPropertyTypes`). `Button` принимает `ref`.

### 10.2 Поведение и движение

- `Select` — свой combobox и listbox на `Popover`. Фокус остаётся на кнопке, а активный пункт задаётся через `aria-activedescendant`.
  - Клавиши: стрелки, Home/End, Enter/Space, Esc, Tab (выбирает и закрывает), поиск по первым буквам.
  - Открытие: fade, scale `--enter-scale` и сдвиг `--shift-popover` от якоря, `transform-origin` у якоря. Закрытие короче, за `--dur-fast-exit`. У выбранного пункта галочка появляется с `--motion-pop-in`. Подсветка пункта не анимируется.
  - `data-state="open|closed"` стоит на обёртке `Popover`, как в разделе 9.
- `Menu` — кнопка `more` и `role=menu`. Фокус переходит на пункты, клавиши те же.
- `Tooltip` — задержка `--delay-tooltip`. Следующая подсказка в пределах этой задержки появляется сразу, без анимации.
- `Dialog` — нативный `<dialog>` с `showModal`. Подложка — `--motion-fade-*`, панель — `--motion-scale-*`. Esc и клик по подложке вызывают `onClose`, а закрытие анимируется.
- Флажки и переключатели:
  - `Checkbox` — галочка рисуется по `stroke-dashoffset`;
  - `Switch` — бегунок едет через `transform`;
  - `RadioGroup` — точка появляется с `--motion-dot-in`.
- `NumberField` — свои кнопки ±, стрелки вверх/вниз, ограничение `min`/`max`. Поле ввода — `type=text inputMode=decimal`, число не анимируется.
- `TextArea` растёт по содержимому.
- `ScrollArea` и глобальные полосы прокрутки:
  - ползунок проявляется при прокрутке, наведении и фокусе и гаснет через `--delay-scrollbar-hide`; это переход зарегистрированного `--scrollbar-thumb-color`;
  - края затухают через `animation-timeline` с запасным вариантом на `data-at-start` и `data-at-end`;
  - глобальные `scrollbar-*` и `::-webkit-scrollbar*` заданы в `global.css`.
- `VerdictMark` — у каждого исхода своя иконка и своё движение:
  - confirmed — `--motion-verdict`;
  - refuted — `--motion-verdict-emphatic`;
  - inconclusive — `--motion-rise-in`.
- Новые токены:
  - слои: `--layer-raised/sticky/popover/dialog/tooltip`;
  - задержки: `--delay-tooltip`, `--delay-scrollbar-hide`, `--typeahead-reset`;
  - сдвиги: `--shift-popover`, `--origin-shift`;
  - движение: `--motion-popover-in/out`, `--motion-tooltip-in/out`, `--motion-dot-in`, `--motion-edge-fade-in/out`;
  - переходы: `--transition-thumb/draw/turn/scrollbar`;
  - поверхности и цвета: `--surface-option-active`, `--surface-tooltip`, `--text-on-tooltip`, `--surface-track-off`, `--scrollbar-thumb*`;
  - размеры: `--check-size`, `--switch-*`, `--popover-*`, `--dialog-width*`, `--tooltip-max-width`, `--field-max-width`.
- Общие наборы деклараций лежат в `styles/{compose,control,choice}.module.css` и подключаются через `composes`. Фичи их не импортируют.
- Новые иконки: `minus`, `plus`, `more`, `dropped`.
- Новые ключи `common`: `action.{decrease,increase,open,more}`, `step.*`, `select.{placeholder,empty}`, `connection.*`.

### 10.3 Сигнальные цвета (решение координатора)

`--signal-*` и `--data-*` используются только в `ui/shared/ui/meter/**`, `ui/shared/motion/canvasPalette.ts`, `ui/features/map/**` и в `tokens/`. В `Stat` и в иконке `Meter` предупреждение передаётся иконкой, весом и Carbon. Это проверяет `signal-scope`.

### 10.4 Проверки `npm run rules` (теперь 22)

К 12 проверкам Рубежа 1 добавлены:

- `scale-tokens`: радиус только `--radius-*`, тень только `--shadow-float`, `font-size` только `--font-size-*`, `z-index` только `--layer-*`, брейкпоинты только 30/48/64/75rem. Локальные свойства компонента разворачиваются.
- `token-layers`: в компонентах нет токенов палитры.
- `signal-scope`.
- `no-side-stripe`.
- `touch-targets`: `--target-min` и `--control-height` не меньше 44px; у компактного контрола есть область нажатия через `--target-min`.
- `contrast`: 14 пар «текст/поверхность» не ниже 4.5:1.
- `surface-ladder`.
- `motion-tokens`.
- `consistency` — в `src/ui/features/**` и `src/ui/app/**`:
  - нет `<select>`, `<details>`, `<dialog>`, `<button>`, `<meter>`, `<progress>`;
  - нет `<input type=checkbox|radio|number|range>`;
  - нет `role=tablist|radiogroup|switch|listbox|menu|tooltip`;
  - тире не пишется руками;
  - в CSS нет `text-transform: uppercase` и `overflow: auto|scroll`.
- `icon-alias`: `lucide-react` импортируется только в `icon/icons.ts`, одна иконка — одно имя.

У проверок нет базы для кода F2: всё, что F2 уже написал в `features/` и `app/`, должно проходить их сразу или переписываться на примитивы.

### 10.5 Шрифт

Первый запасной шрифт — Inter (OFL), локально из `public/fonts/Inter-{Regular,Medium,SemiBold}.woff2` и `InterDisplay-Regular.woff2`, лицензия в `public/fonts/OFL.txt`. У GT Standard в `@font-face` только `local()`, поэтому сборка не предупреждает о файлах. Когда лицензионные файлы появятся в `public/fonts/GT-Standard-{S-Regular,S-Medium,S-Semibold,L-Regular}.woff2`, нужно подключить `src/ui/shared/styles/gt-standard-files.css` в `global.css`.

### 10.6 Корень приложения и скрипты

`src/main.tsx` в ветке F1 импортирует `./ui/App`. По разделу 9 в ветке F2 этот файл реэкспортирует `AppShell`, так что `main.tsx` работает без правок. После удаления `src/ui/App.tsx` F1 заменит строку на `import { AppShell } from "./ui/app"`. Скрипт `npm run e2e` = `playwright test` добавлен.

## 11. Детали переключателя языка (как в rlt) и поправки FS-12

Дата: 2026-10-08. **Статус:** реализовано в ветке `feature/frontend-system`.

```ts
import { Button, Flag, type FlagCode, MenuItemRadio, MenuList } from "@/ui/shared/ui"
import { settleDelay } from "@/ui/shared/motion"
import { LOCALES, type Locale, useLocale, useTranslation } from "@/ui/shared/i18n"

type FlagCode = "ru" | "gb"
interface FlagProps { code: FlagCode; className? }
interface MenuListProps {
  id: string
  open: boolean
  label: string
  anchorRef: RefObject<HTMLElement | null>
  onClose: (restoreFocus: boolean) => void
  placement?: Placement
  instant?: boolean
  children: ReactNode
}
interface MenuItemRadioProps { checked: boolean; onSelect(): void; children: ReactNode }
type ButtonSize = "regular" | "compact" | "icon"
function settleDelay(): number
```

- **Кнопка-триггер:** `<Button size="icon" variant="ghost" icon="globe" aria-haspopup="menu" aria-expanded aria-controls title={label}>{label}</Button>`.
  - Квадрат 44px, текст скрыт визуально и служит доступным именем. Дублировать `aria-label` не нужно.
  - При `aria-expanded="true"` у ghost-варианта фон как при наведении.
- **`MenuList`:**
  - меню на `Popover` (по умолчанию `bottom-end`); при открытии фокус встаёт на отмеченный пункт или на первый;
  - стрелки, Home и End двигают фокус; Tab закрывает меню без возврата фокуса; Esc и клик снаружи закрывают через `Popover`, Esc возвращает фокус на якорь;
  - `instant` выключает анимацию открытия и закрытия, когда меню открыли с клавиатуры.
- **Индикатор выбранного пункта** — `useCheckedIndicator`. Он ставит `transform: translateY(…)` прямо на элемент индикатора, а не через переменную на родителе. Плавный переход (`--transition-indicator`) включается после первого кадра (`data-indicator="ready"`).
- **`MenuItemRadio`** — `role="menuitemradio"`, `aria-checked`. У выбранного пункта галочка с `--motion-pop-in`.
- **`Flag`** — `<img alt="" width=20 height=15>`, скругление `calc(var(--radius-button) / 4)`, тонкая обводка `--border-hairline`.
- **`settleDelay()`** возвращает `--delay-settle` (220ms), при reduced motion — 0.
- **`LocaleProvider` (как в rlt):**
  - язык хранится в состоянии провайдера и отдаётся через контекст;
  - `setLocale` обновляет состояние и пишет `localStorage["did-locale"]`;
  - эффект ставит `document.documentElement.lang` и вызывает `i18n.changeLanguage`;
  - `useLocale()` работает только внутри `LocaleProvider`.
- **Ключи:**
  - `common:language.{legend,current,ru,en}`; `current` принимает `{{name}}`;
  - старые `common:locale.{label,ru,en}` пока остались для текущей фичи F2 и будут удалены в FS-13.
- **Иконка:** `globe`.

Поправки FS-12 (аудит движения):

- Списки и меню, открытые с клавиатуры, не анимируются: `Select` и `Menu` передают `Popover` `instant`, закрытие тоже мгновенное.
- `Disclosure`, раскрытый с клавиатуры, получает `data-instant`. Для таких элементов токены `--motion-popover-*`, `--motion-details-*`, `--motion-pop-in` и `--transition-turn` равны `none`.
- Ошибка `Field` появляется за `--dur-fast` (`--motion-notice-in`), а не за `--dur-slow`.

## 12. Заголовок карточки, ревью анимаций и новые проверки (Рубеж 3, FS-12)

Дата: 2026-10-08. **Статус:** реализовано в ветке `feature/frontend-system`. Заголовок карточки — решение координатора.

### 12.1 Заголовок карточки

Роль «заголовок карточки» рисует только `Card`. Отдельного `CardHeader` нет.

```ts
interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  level?: "top" | "inner"
  tone?: "default" | "inverse"
  as?: "section" | "article" | "aside" | "div"
  motionIndex?: number
  title?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  titleId?: string
  children: ReactNode
}
```

- С `title` карточка рисует `<header>`: слева `hgroup` (необязательный `Eyebrow` над заголовком, затем заголовок), справа `actions`.
- Заголовок: sentence case, шрифт интерфейса, вес 500, Carbon (на `inverse` — белый). У `top` — `h2`, `subheading` 20px; у `inner` — `h3`, `body` 16px.
- `aria-labelledby` ставится на карточку автоматически, id — `useId()` или `titleId`. Явный `aria-label` побеждает. Поэтому у карточек-секций разные имена ориентиров, а `landmark-unique` от одинаковых id больше не возникает.
- Карточка с заголовком — grid: шаг между шапкой и телом `--space-card` у `top` и `--space-element` у `inner`. `className` фичи может переопределить раскладку.
- `actions` выравниваются по базовой линии заголовка (`last baseline`). Без `title` они не рисуются.
- Как переписать в F2: `<Card aria-labelledby="x"><header><Eyebrow as="h2" id="x">…</Eyebrow>…</header>` → `<Card title={…} actions={…}>`. Подзаголовки групп внутри карточки (`Eyebrow as="h3"`) → `<Card level="inner" title={…}>`.
- Проверка `consistency` в `features/` и `app/` запрещает `<h2>`–`<h6>` и `Eyebrow as="h2…h6"`. `<h1>` в шапке приложения разрешён. `Eyebrow` без `as` или с `as="p"` остаётся подписью.
- На `tone="inverse"` рассчитаны текст карточки, заголовок, `Eyebrow tone="inverse"`, `CloseButton tone="inverse"` и кнопки. `Meter`, `Stat`, `ProgressSteps` и поля — только на светлых карточках.

### 12.2 Движение: что изменилось для пользователей примитивов

- `usePresence()` теперь отдаёт ещё `onTransitionEnd`. Оба обработчика принимают `SyntheticEvent`. Слои на переходах (`Popover`, `Tooltip`, `Banner`) вешают `onTransitionEnd`.
- Новый хук `useInputModality()` → `{ instant, onKeyDown, onPointerDown }`. Его используют `Segmented`, `Checkbox`, `Switch`, `RadioGroup`. Элемент получает `data-instant`, токены переходов внутри становятся `none`.
- `ViewTransitionMode` = `"mission" | "layout"`. Режим `"locale"` удалён: по правилам текст при смене языка меняется сразу.
- `Select`: триггер получает `data-instant`, поэтому шеврон с клавиатуры не вращается. У выбранного пункта галочка без pop-in.
- `MenuItemRadio`: галочка всегда в DOM, видимость — переходом по `data-on`. На открытии меню она не «выстреливает».
- `Tooltip`: Esc закрывает; курсор можно перевести на тултип (задержка скрытия `--delay-hover-grace` 100ms).
- `Dialog`: заголовок 20px, вес 500; описание стоит под заголовком в одном `hgroup`.
- `Banner tone="attention"`: без рамки, иконка в тёмном круге. Так плашка не похожа на поле ввода.
- Невалидное поле: рамка и внутренняя обводка `--border-invalid` (Carbon), 2px вместо 1px Slate.

### 12.3 Токены

- Удалены: `--motion-expand`, `--motion-collapse`, `--motion-notice-in`, `--motion-details-in/out`, `--motion-popover-in/out`, `--motion-tooltip-in/out`, `--motion-dot-in`; keyframes `kf-expand`, `kf-collapse`, `kf-popover-in/out`. В коде F2 они не используются (проверено).
- Новые переходы: `--transition-control-press`, `--transition-thumb-press`, `--transition-fade`, `--transition-mark-in/out`, `--transition-layer-in/out`, `--transition-reveal-in/out`, `--transition-details-in/out`.
- Новые значения: `--delay-hover-grace` 100ms, `--border-invalid`, keyframe `kf-swap-in` (`Swap` теперь с blur 2px).
- `--transition-meter` — linear. `--transition-control` возвращает scale за `--dur-instant`.

### 12.4 Новые проверки `npm run rules` (теперь 28)

- `global-styles` — `global.css` импортирует только `src/main.tsx`, ровно один раз; другие глобальные стили из `shared/styles` никто не импортирует.
- `hover-gate` — `:hover` только внутри `@media (hover: hover) and (pointer: fine)`, у `:focus-visible` нет transition и animation. Проверяются CSS Modules и `shared/styles`.
- `ts-timings` — в `src/ui/**` нет литеральных миллисекунд в `setTimeout`/`setInterval` и в `duration`/`delay`/`endDelay`. Ноль разрешён.
- `motion-libraries` — в `package.json` нет библиотек анимации.
- `remote-assets` — CSS и HTML не тянут ресурсы по `http(s)://` и `//`.
- `accent-text` — teal (`--action-primary*`) не бывает цветом текста.
- `motion-tokens` дополнительно: `--dur-*` короче 300ms, кроме редких `--dur-slow`, `--dur-draw`, `--dur-breathe`, `--dur-spin`; в keyframes нет `scale(0)`.

### 12.5 Просьбы F2 (NEED-F1, вторая сессия)

- `--data-obstacle` → `var(--wall-stone)`, новый токен палитры `#5b6f6f`: 70% graphite и 30% sage-deep в oklab. Контраст стен 5.32:1 к `--data-free` и 3.40:1 к `--data-unknown`. Вариант с 60% давал только 2.82:1 к неизвестным клеткам. Пары «стена/свободно» и «стена/неизвестно» проверяет `contrast` с порогом 3:1 для нетекстовых элементов.
- `Segmented`: проп `showLabel?: boolean`. Над группой появляется видимая подпись в стиле подписи `Field`: общий класс `fieldLabel` в `compose.module.css`, его же используют `Field` и `RadioGroup`. Доступное имя группы по-прежнему берётся из `legend`, видимая подпись помечена `aria-hidden`. С `showLabel` `className` уходит на обёртку. Варианты `Segmented` не растягиваются в grid-родителе (`justify-self: start`).
- ~~`Banner`: текст и действие в общей строке, `--banner-text-min`~~ — заменено в поправке 13: действие всегда под текстом в той же колонке, токен удалён.
- `errors:command.reconciled`: «Состояние сверено: команда не выполнена. Можно безопасно повторить команду.» / «State checked: the command did not run. It is safe to retry the command.» Тест `locales.test.ts` запрещает snake_case-идентификаторы в значениях `common` и `errors`.
- Цели нажатия: у варианта `Segmented` теперь `min-inline-size: var(--target-min)`. По высоте область нажатия и раньше была 44px через `::before`; по ширине у вариантов из одной цифры было 38–41px. У кнопок шага `NumberField` визуальный размер 36×36, область нажатия 44×44 через `::before`. Обе области замерены в Chromium через `elementFromPoint`.
- `touch-targets` переписана (`scripts/checks/rules/touchTargets.ts`). Старая версия искала в файле строку `--target-min` рядом с `--control-height-compact` и не считала размеры. Новая находит интерактивные классы (`:hover`, `:active`, `composes: pressable`) и вычисляет их размеры: подставляет токены и локальные свойства, берёт худший вариант, считает `calc`. Если размер меньше 44px, проверка требует `::before` или `::after` с `inset*`/`min-*-size` от `--target-min`. Ширину по содержимому статически не вычислить, её проверяет замер в браузере.

### 12.6 Решения координатора по мелочам критики

- ~~Радиусы тёмной кнопки (16) и основной (12) остаются~~ — пересмотрено 2026-10-08 после аудита: в теле страницы обе 12px, 16px только `shape="pill"` в шапке (поправка 13).
- `Checkbox`: вместо `calc(var(--radius-button) / 2)` — токен шкалы `--radius-check` (6px). Ближайший токен `--radius-button` (12px) на квадрате 20px дал бы почти круг, и флажок слился бы с радио. Поэтому 6px внесено в шкалу (правила, 5а).
- `Switch`: выключенная дорожка — контур 2px `--border-strong` на светлой подложке `--surface-track-off` (белый), бегунок тёмный. Включённая — заливка `--action-dark` и белый бегунок. Новый токен `--switch-edge`, бегунок 16px. Состояние передают три признака: положение бегунка, заливка и цвет бегунка. Контраст контура и заливки к фону — не ниже 3:1, это проверяет `contrast` (пары `--border-strong` и `--action-dark` к `--surface-card` и `--surface-tint`).
- `Button`: новый проп `disabledReason?: string`. Вместе с `disabled` кнопка не получает нативный `disabled`. Вместо этого ставятся `aria-disabled="true"` и `data-disabled`, клик гасится, кнопка остаётся в порядке фокуса, а причина показывается в `Tooltip` (и в `aria-describedby`). Без причины кнопка по-прежнему нативно `disabled`. Бледный текст неактивной кнопки остаётся: WCAG не требует контраста для disabled.
- `Dialog` без «Отмены» остаётся. Закрытие крестиком, Esc (`cancel`) и кликом по подложке проверяет тест `overlays.test.tsx`.

## 13. Поправки после аудита (X1, 2026-10-08)

Источник: `frontend-reports/audit-code.md`, `audit-ui.md`; отчёт `frontend-reports/fix-x1.md`. Все изменения обратно совместимы, кроме удалённых `STATUS_ICON` и `--banner-text-min` (снаружи не использовались).

### 13.1 Новые API

- `@/ui/shared/i18n`: `BACKEND_CONTENT_LANG` (`"ru"`) и `<BackendText as? className?>` — единственный способ пометить контент backend атрибутом `lang`.
- `@/ui/shared/ui`: `LayerHost` (порталы слоёв внутри ориентира), `useLayerHost()`, `cssZoom(element)`. `Popover`, `Select`, `Menu`, `Tooltip`, `Dialog` порталятся в хост (без хоста — в `body`) и берут масштаб якоря через `currentCSSZoom`: в `/?view=show` слои масштабируются как страница.
- `Select` и `Field`: проп `hideLabel` (подпись визуально скрыта, остаётся для доступного имени). Список `Select` — внутри `ScrollArea`, активный пункт прокручивается в видимую область.
- `Button`: проп `shape?: "default" | "pill"`. `ButtonShape` экспортирован.
- `@/adapters/requestId`: `createRequestId(source?)` — UUID v4; без secure context через `crypto.getRandomValues`, без crypto — `Math.random`.
- `@/application/viewState`: `connectionStatus(view)` → `"connecting" | "live" | "stale" | "offline"` — один предикат для шапки и плашки.
- `@/domain/contract`: массивы `RUN_STATUSES`, `GOAL_KINDS`, `JOURNAL_KINDS`, `JUDGE_MODES`, `PLANNER_MODES`; типы выводятся из них, парсеры берут их же.
- `@/ui/shared/motion`: внутренний `fallbackDelay(token, reducedFade)`; в reduced резервные таймеры `Swap`, `usePresence`, `useDetailsMotion` ждут мягкий fade.

### 13.2 Токены

- Новые: `--radius-flag` 3px, `--reduced-fade-exit` 110ms, `--data-pine #567a72` (`--data-base`).
- Изменены (метки карты держат 3:1 к `--data-free` и `--data-unknown`): `--data-ochre #847243`, `--data-clay #9d6352`, `--data-dusk #627492`, `--wall-stone #637676` (светлее, 3.06:1 к неизвестным клеткам).
- Удалены неиспользуемые: `--mist`, `--eucalyptus`, `--transition-surface`, `--dur-slow-exit`, `--motion-appear-mark` (и `kf-appear-mark`), `--space-section`, `--page-max-width`, `--banner-text-min`.
- Reduced motion у `[data-motion="fade"]`: закрытие (`--motion-swap-out`, `--motion-fade-out`, `--motion-scale-out`, `--transition-{mark,layer,reveal,details}-out`) — fade `--reduced-fade-exit`, вход — `--reduced-fade`.
- Кольцо фокуса: `.critical` у `Banner` и любой `[data-surface="inverse"]` получают `--focus-ring-color-inverse`.
- Шрифт: `@font-face` GT Standard через `local()` удалены (давали статус `error`); стек `--font-ui`/`--font-display` начинается с GT Standard и падает на Inter из `public/fonts`. Файлов GT в проекте нет.

### 13.3 Глобальные стили

- `scrollbar-width`/`scrollbar-color` только под `@supports not selector(::-webkit-scrollbar)`: в Chromium работают свои `::-webkit-scrollbar*`, стрелки скрыты.
- `:root[data-view-transition="mission"]::view-transition-{old,new}(root) { animation: none }` — кроссфейд всей страницы не идёт, анимируется группа `mission`.

### 13.4 Проверки `npm run rules` (теперь 29)

Новая проверка `layers`: `domain` импортирует только `domain` и ни одного пакета; `application` — только `domain`/`application`; `adapters` не импортируют `ui`; `ui/shared` не импортирует фичи и `app`; фича не импортирует другую фичу и `app`. Учитываются и type-only импорты.

Остальные проверки переписаны против обходов из аудита (C-01…C-21); подробности и тесты — в `fix-x1.md`. Корень проверок — папка `frontend` по месту скрипта; если `src/` нет, `rules` завершается с кодом 2. Сканируются `src`, `tests`, `scripts`, `e2e`, `docker`, `public` и корневые конфиги, `index.html`, `Dockerfile`.

### 13.5 Docker

Комментарии из `docker/*` убраны (правило «без комментариев»). Что делают файлы:

- `10-resolver.envsh` — берёт DNS-сервер контейнера из `/etc/resolv.conf` для `resolver` nginx (в Compose это `127.0.0.11`).
- `40-runtime-config.sh` — пишет `/config.json` с `data_source` из `DATA_SOURCE=live|fixture` при запуске контейнера.
- `default.conf.template` — адрес backend разрешается на каждый запрос, поэтому контейнер стартует и без backend (демо-режим).

