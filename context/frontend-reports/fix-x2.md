# Исправления X2: экраны (черновик, идёт работа)

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
