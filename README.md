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

## v0.1.4

Исправлена ошибка загрузки на мобильном/удалённом frontend:

```text
GET /scripts/script.js 404
Extension "Lorebook Gatekeeper" failed to load
```

Причина: файл `src/worldInfoCollector.js` находился на один уровень глубже, поэтому путь `../../../../script.js` превращался в `/scripts/script.js`. Теперь используется правильный путь `../../../../../script.js`, который ведёт к `/script.js`.

## Возможности

- Перехват готового промта перед отправкой.
- Поддержка Chat Completion и Text Completion payload.
- Работа без изменения ядра SillyTavern.
- Отдельный fullscreen overlay для мобильных браузеров.
- Загрузка лорбуков через несколько fallback-источников.
- Подсчёт токенов с fallback-оценкой.


## v0.1.5

- Removed duplicate popup behavior for Chat Completion flow: preliminary text-prompt review is skipped when Chat Completion review will handle the generation.
- Added a fallback skip for preliminary prompt review when no active Lorebook entries are detected.
- Updated palette: main background `#171717`, entry/text background `#101010`, text color `#dcddd8`.
- Added remembered choice memory:
  - `Remember my choice after confirmation`;
  - `Apply remembered choice`;
  - `Clear remembered choice`.
- Remembered choice stores disabled active entries and manually selected inactive entries in browser localStorage.
