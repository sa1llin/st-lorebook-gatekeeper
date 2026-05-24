# Lorebook Gatekeeper for SillyTavern

Расширение показывает активированные Lorebook / World Info записи перед отправкой промта на сервер и позволяет временно отключить лишние записи или вручную добавить неактивированные.

## Установка

1. Скопируйте ссылку на репозиторий:

   https://github.com/sa1llin/st-lorebook-gatekeeper.git

2. Вставьте ссылку в соответствующее поле в SillyTavern "Установить расширение".
3. ВАЖНО: выберите "Установить для всех пользователей".

## Альтернативный вариант установки из архива

1. Удалите старую папку расширения, если ранее была установлена:

   `SillyTavern/public/scripts/extensions/third-party/st-lorebook-gatekeeper`

2. Распакуйте новую папку `st-lorebook-gatekeeper` сюда:

   `SillyTavern/public/scripts/extensions/third-party/`

3. Перезапустите SillyTavern.
4. Очистите кэш браузера или выполните жёсткое обновление.

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
- Избранные записи через звёздочку в правом верхнем углу карточки.
- Закрепление избранных записей выше остальных в активном и неактивном списке.
- Стандартные тэги для записей.
- Кастомные пользовательские тэги.
- Цветные тэги с постоянным цветом для каждого имени тэга.
- Компактная фильтрация записей по тэгам в режимах OR и AND.
- Меню `⋯` для добавления, снятия и управления тэгами внутри карточки.
- Tag Manager для удаления кастомных тэгов и очистки стандартных тэгов со всех записей.
- Lock-записи через кнопку замочка: запись всегда остаётся выбранной и добавляется в prompt.
- Blacklist / Never include через кнопку `⊘`: запись автоматически отключается даже при срабатывании ключей.
- Временное редактирование записи через `Edit for this prompt` без изменения оригинального lorebook.
- Переключатель Compact View / Detailed View для управления плотностью карточек.
- Compare with remembered для сравнения текущего выбора с сохранённым Remembered choice.
- Отображение причины попадания записи в prompt.
- Подсветка matched keyword внутри preview текста записи.




## v0.1.12

### Added

- Compact View / Detailed View: новый режим отображения карточек.
- В Compact View карточка показывает только checkbox, звёздочку, название, тэги, токены и лорбук.
- В Detailed View дополнительно показываются причина активации, matched keyword, ключи и preview контента записи.
- Compare with remembered: сравнение текущего выбора с сохранённым Remembered choice через блок Added / Removed.
- Причины активации: keyword, character-linked lorebook, global lorebook, manual add, remembered choice и previous request choice.
- Подсветка совпавших ключевых слов в тексте preview записи.

### Changed

- Карточки стали более управляемыми визуально: подробная диагностическая информация скрывается в Compact View и остаётся доступной в Detailed View.
- Remembered choice panel теперь может показывать различия без применения сохранённого выбора.

## v0.1.11

### Changed

- Исправлена визуальная часть `Edit for this prompt` на мобильных устройствах.
- Фон редактора теперь полностью непрозрачный и совпадает с основным фоном расширения, поэтому текст записей под ним больше не просвечивает.
- Поле временного редактирования и нижние кнопки получили отдельный непрозрачный фон и границу.
- Во время редактирования блокируется прокрутка основного экрана, чтобы слой редактора не смешивался с карточками записей.

## v0.1.10

### Added

- Lock entry: кнопка замочка в карточке записи. Закреплённая запись остаётся выбранной при Deselect all, Apply remembered/previous choice и других массовых изменениях выбора.
- Locked inactive entries автоматически добавляются как manual entries, чтобы действительно попадать в prompt даже без keyword activation.
- Never include this entry: кнопка `⊘` в карточке записи. Запись отключается автоматически, даже если активировалась ключевыми словами.
- Конфликт Lock и Never include разрешается автоматически: включение blacklist снимает lock, включение lock снимает blacklist.
- Edit for this prompt: временный редактор текста записи перед отправкой prompt.
- Временная версия записи применяется только к текущей генерации. Оригинальный World Info / Lorebook entry не изменяется.
- Prompt Itemization теперь учитывает временно отредактированный текст записи.

### Changed

- Кнопка массового отключения переименована в Deselect all active.
- Persistent rules для Lock / Never include применяются как отдельный слой поверх пользовательского выбора.

### Preserved

- Favorite остаётся только инструментом удобной навигации и визуального поднятия записи выше.
- Lock и Never include хранятся отдельно от Favorite и тэгов.
- Все изменения prompt остаются generation-scoped, если речь не о сохранённых UI-метаданных Lock / Blacklist.

## v0.1.9

### Changed

- Moved the favorite star to the top-right action area of each entry card.
- Reworked entry tags into compact colored chips near entry metadata.
- Removed always-visible tag editors from entry cards.
- Moved standard tag selection and custom tag creation into the entry `⋯` menu.
- Made the tag filter panel more compact for desktop and mobile layouts.

### Added

- Entry action menu with favorite toggle, standard tag assignment, custom tag input, per-entry tag removal and clear-all-tags action.
- Tag Manager inside the tag filter panel.
- Global deletion for custom tags.
- Global cleanup for standard tags from all entries while keeping default standard tags available.
- Tag usage counts in Tag Manager.

### Preserved

- Original lorebook / World Info entries are still not modified.
- Prompt patching remains generation-scoped.
- Remembered choice and previous request choice remain compatible.

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

### v0.1.13

- `Edit for this prompt` теперь открывается как крупное окно минимум на половину высоты экрана.
- Добавлена отдельная ручка `Drag to resize`, через которую можно менять высоту временного редактора вверх-вниз.
- Последняя выбранная высота редактора сохраняется локально для следующих открытий.
