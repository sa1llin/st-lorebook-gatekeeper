Lorebook Gatekeeper v0.1.14 — Profiles + Prompt Preview

Что заменять:
1. index.js
2. popup.html
3. style.css
4. src/reviewPopup.js
5. src/profileMemory.js — новый файл

Путь установки:
SillyTavern/public/scripts/extensions/third-party/st-lorebook-gatekeeper/

Что добавлено:
- новая вкладка Entries / Profiles / Prompt Preview;
- сохранённые профили выбора записей;
- профиль хранит только ID выбранных записей, не копирует текст lorebook entries;
- Apply profile активирует строго сохранённые записи;
- Missing entries показываются отдельно, если запись больше не найдена;
- Prompt Preview показывает prompt до изменений Gatekeeper и preview после текущего выбора;
- для Chat Completion выводится JSON messages array;
- для Text Completion выводится текстовый prompt;
- Copy копирует текущий preview.

После замены файлов:
1. Перезапустить SillyTavern.
2. Сделать жёсткое обновление браузера Ctrl+F5.
3. Если браузер держит старый JS-кэш, очистить cache/site data для адреса SillyTavern.
