# Lorebook Gatekeeper for SillyTavern

Расширение показывает активированные Lorebook / World Info записи перед отправкой промта на сервер и позволяет временно отключить лишние записи или вручную добавить неактивированные.

## Установка

1. Скопируйте ссылку на репозиторий:

   https://github.com/sa1llin/st-lorebook-gatekeeper.git

2. Вставьте ссылку в соответствующее поле в SillyTavern "Установить расширение".
3. ВАЖНО: выберите "Установить для всех пользователей".
4. Перезапустите SillyTavern.


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
- Избранные записи через звёздочку.
- Закрепление избранных записей выше остальных в активном и неактивном списке.
- Стандартные тэги для записей.
- Кастомные пользовательские тэги.
- Цветные тэги с постоянным цветом для каждого имени тэга.
- Фильтрация записей по тэгам в режимах OR и AND.

## v0.1.8

### Added

- Favorite lorebook entries with a star button.
- Favorite entries are pinned above non-favorite entries.
- Standard tags: Character, Location, Item, Lore, Plot, Relationship, Important, NSFW.
- Custom user-created tags.
- Persistent automatic color assignment for every tag.
- Color-coded tag display on each entry card.
- Tag filtering with OR / AND mode.
- Tag search support through the main search field.

### Changed

- Entry metadata is stored as a local UI layer in extension settings.
- Entry IDs are more stable for metadata when SillyTavern entries do not expose `uid` or `id`.

### Preserved

- Original lorebook entries are not modified.
- Prompt patching logic remains temporary and generation-scoped.
- Remembered choice remains compatible.
- Previous request choice remains compatible.
- Inactive lorebook prioritization remains compatible.
- Prompt Itemization correction remains compatible.
