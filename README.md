# Lorebook Gatekeeper for SillyTavern

Расширение показывает активированные Lorebook / World Info записи перед отправкой промта на сервер и позволяет временно отключить лишние записи или вручную добавить неактивированные.

## Установка

1. Удалите старую папку расширения:

```text
SillyTavern/public/scripts/extensions/third-party/st-lorebook-gatekeeper
```

2. Распакуйте новую папку `st-lorebook-gatekeeper` сюда:

```text
SillyTavern/public/scripts/extensions/third-party/
```

3. Перезапустите SillyTavern.
4. Очистите кэш браузера или выполните жесткое обновление.

## Возможности

- Перехват готового промта перед отправкой.
- Поддержка Chat Completion и Text Completion payload.
- Работа без изменения ядра SillyTavern.
- Отдельный fullscreen overlay для мобильных браузеров.
- Загрузка лорбуков через несколько fallback-источников.
- Подсчёт токенов с fallback-оценкой.
- Remembered choice memory.
- Previous request choice для быстрого повторного применения выбора после reroll/swipe.
- Приоритетный выбор inactive-лорбуков без отключения режима All lorebooks.
- Коррекция Prompt Itemization после подтверждения изменений в расширении.

## v0.1.7

- Добавлена кнопка `Apply previous request choice`.
  - Выбор из предыдущего подтверждённого запроса сохраняется отдельно от `Remembered choice`.
  - Кнопка применяет предыдущий выбор к текущему popup без перезаписи remembered-настроек.
- Расширен блок inactive-записей.
  - Сохранён существующий фильтр `All lorebooks` / один лорбук.
  - Добавлен список `Prioritize inactive lorebooks`, где пользователь выбирает сторонние лорбуки, записи которых нужно показывать первыми.
  - Добавлена кнопка `Use linked/global first` для быстрого приоритета chat/persona/character/global лорбуков, если SillyTavern отдаёт эти связи.
- Добавлена коррекция Prompt Itemization.
  - После подтверждения popup расширение обновляет сохранённый itemized prompt: `rawPrompt`, `finalPrompt`, `worldInfoString` и вычисляемую строку World Info.
  - Это снижает риск, что Prompt Itemization покажет старое количество токенов лорбука до включения/выключения записей.

## v0.1.6

- Changed custom checkbox rendering so selected ticks are white instead of black.
- Added an inactive lorebook filter: inactive entries can now be shown from all lorebooks or from one selected lorebook.
- Current manual selections are preserved while switching the inactive lorebook filter.

## v0.1.5

- Removed duplicate popup behavior for Chat Completion flow: preliminary text-prompt review is skipped when Chat Completion review will handle the generation.
- Added a fallback skip for preliminary prompt review when no active Lorebook entries are detected.
- Updated palette: main background `#171717`, entry/text background `#101010`, text color `#dcddd8`.
- Added remembered choice memory:
  - `Remember my choice after confirmation`;
  - `Apply remembered choice`;
  - `Clear remembered choice`.
- Remembered choice stores disabled active entries and manually selected inactive entries in browser localStorage.

## v0.1.4

Исправлена ошибка загрузки на мобильном/удалённом frontend:

```text
GET /scripts/script.js 404
Extension "Lorebook Gatekeeper" failed to load
```

Причина: файл `src/worldInfoCollector.js` находился на один уровень глубже, поэтому путь `../../../../script.js` превращался в `/scripts/script.js`. Теперь используется правильный путь `../../../../../script.js`, который ведёт к `/script.js`.
