# Как продолжить работу над фронтендом

**Актуализация 2026-10-08:** F1/F2 и X1/X2 закоммичены в `frontend` (`e034a25`) и объединены с main по запросу пользователя. Продолжать от main; [отчёт слияния](frontend-reports/merge-main-2026-10-08.md). Ниже — историческое состояние паузы, а не текущий статус worktree.

Пауза 2026-10-08 по просьбе пользователя: заканчивались токены. Агентам F1 и F2 велено остановиться и записать состояние в отчёты.

## Где что лежит

| Что | Где |
| --- | --- |
| Правила | [frontend-rules.md](frontend-rules.md) |
| План и задачи | [frontend-plan.md](frontend-plan.md) |
| Матрица покрытия | [frontend-coverage.md](frontend-coverage.md) |
| Токены Zoox | [tokens.md](tokens.md) |
| Контракты F1↔F2: токены, сигнатуры, API | [frontend-contracts.md](frontend-contracts.md) |
| Отчёт F1, последний раздел «Пауза» | [frontend-reports/f1.md](frontend-reports/f1.md) |
| Отчёт F2, последний раздел «Пауза» | [frontend-reports/f2.md](frontend-reports/f2.md) |
| Код F1 | `.claude/worktrees/frontend-system/frontend`, ветка `feature/frontend-system` |
| Код F2 | `.claude/worktrees/frontend-screens/frontend`, ветка `feature/frontend-screens` |
| Скриншоты и axe | `artifacts/frontend/` |
| Анимационные скиллы | `.claude/skills/` |

Коммитов нет: всё лежит незакоммиченным в двух worktree, а документы `context/` — в основной папке. Git делает пользователь.

## Состояние на момент паузы

- **Рубежи 0 и 1** закрыты у обоих.
- **Рубеж 2 у F1** закрыт. Сделаны FS-07…FS-10 и FS-08a, `verify` был зелёным. Две синхронизации F1→F2 выполнены, вторая — около 10:20.
- **Рубеж 2 у F2** в работе. Экраны переносятся с `drafts/` на примитивы. Старые панели, `App.tsx`, `presentation.ts`, `interimText.ts` и `styles.css` ещё не удалены.
- **Новое требование.** Переключатель языка делается как в rlt-hack-deploy (правила, раздел 3; план SC-09). F1 делает `Flag`, `MenuItemRadio`, `useCheckedIndicator`, `settleDelay` и ключи `language.*`. F2 делает фичу `locale-switch`.
- **Рубеж 3** не начат: FS-11…FS-13, SC-12…SC-15. У F2 уже есть инфраструктура Playwright, axe и замер fps.

Точное состояние каждой ветки смотреть в разделах «Пауза» отчётов f1.md и f2.md.

### Итог паузы (координатор, 2026-10-08 ~10:40)

- **F1** остановлен зелёным: `verify` = 22 из 22 rules, 329 тестов, сборка.
  - Готово: всё для переключателя языка (`Flag`, `MenuList`, `MenuItemRadio`, `useCheckedIndicator`, `settleDelay`, `Button size="icon"`, ключи `language.*`, `LocaleProvider` с контекстом как в rlt); FS-11 почти полностью; часть FS-12.
  - Осталось: `/review-animations` запускает пользователь (агент этот скилл вызвать не может), F1 правит найденное; пересобрать `goatwhistle.pdf`, если нужен; FS-13.
- **F2** остановился зелёным: `verify` = 22 rules, 561 тест, lint и build.
  - Рубеж 2 закрыт; `presentation.ts`, `interimText.ts`, старые панели и `MapView` удалены.
  - e2e: 1116 скриншотов, axe нашёл одно нарушение `landmark-unique` на всех страницах, fps 58–60.
- **После паузы координатор сделал третью синхронизацию F1→F2** (39 файлов + `presentation/`), и **ветка F2 стала красной**. Это первое, что нужно починить при продолжении:
  1. `tests/domain.test.ts` и `tests/research.test.ts` из F1 перезаписали версии F2, в которых F2 уже убрал зависимость от удалённого `presentation.ts`. Версии F2 потеряны, потому что их не коммитили. Нужно убрать из этих двух файлов импорты `../src/domain/presentation` и тесты удалённых функций. Это подписи и форматирование; `placeLabels` и `terrainLabel` переехали в фичи F2, их тесты уже лежат в `tests/ui/**`.
  2. 7 компонентных тестов F2 падают с `useLocale must be used within LocaleProvider`. Причина: `LocaleProvider` теперь контекст, как в rlt. Нужно добавить обёртку `LocaleProvider` в общий render-хелпер тестов F2 (`tests/ui/**`), а не в каждый тест.
  3. Тест `presentationTokens` починен: в F2 скопирован `presentation/` из F1.
- **Порядок продолжения:**
  1. F2 чинит пункты 1–2 и подключает `locale-switch` из `drafts/` (примитивы уже у него).
  2. F1 по `NEED-SYNC` переключает `main.tsx` на `AppShell` из `./ui/app` и убирает `import "./ui/styles.css"`. После этого F2 удаляет `src/ui/App.tsx` и `src/ui/styles.css`, а F1 делает FS-13.
  3. F2 исправляет `landmark-unique`, затем SC-13…SC-15, затем повторяет полный прогон e2e и fps.
- **Мелочи:**
  - В `.gitignore` добавить `.impeccable/` и `presentation/.vite/`: кэш хука impeccable ломает lint.
  - Заголовки карточек сейчас сделаны через `Eyebrow` в верхнем регистре, а для заголовка карточки это выглядит шаблонно. Нужен отдельный заголовок карточки от F1 или решение пользователя.

## Как возобновить

1. Прочитать разделы «Пауза» в f1.md и f2.md.
2. В каждом worktree запустить `npm run verify` и сравнить с записанным.
3. Запустить двух агентов заново: F1 в worktree `frontend-system`, F2 в `frontend-screens`. В промпт включить:
   - пути к правилам, плану, контрактам и своему отчёту;
   - ограничения: без коммитов, без комментариев, файл до 250 строк, только свой worktree;
   - продолжить с раздела «Пауза».
4. Синхронизацию F1→F2 делает координатор по метке `SYNC-READY` в f1.md:
   - копировать изменённые и новые файлы F1, кроме файлов F2;
   - файлы F2: `src/ui/app/**`, `src/ui/features/**`, `src/ui/*.tsx`, `src/ui/*.ts`, `src/main.tsx`, словари неймспейсов mission, map, research, journal, team и demo, `src/domain/presentation.ts`, `src/adapters/fixture/**`, `tests/ui|fixture/**`, `e2e/**`, `playwright.config.ts`, `drafts/**`;
   - отдельно скопировать `public/fonts/*`;
   - после копирования в F2 запустить `tsc`, `vitest` и `npm run rules`.
5. Просьбы F2 к F1 идут через метку `NEED-SYNC` в f2.md.

## Финал

Когда обе ветки зелёные и рубеж 3 закрыт:

1. Пользователь коммитит каждую ветку и сливает их в `main`. В конфликтах словарей неймспейсов F2 берётся версия F2.
2. На объединённом коде запускается `npm run verify` и e2e.
3. Обновить статус в `context/README.md`.
