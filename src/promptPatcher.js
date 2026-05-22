import { MANUAL_BLOCK_TITLE } from './constants.js';

export function removeEntriesFromTextPrompt(prompt, disabledEntries) {
    let result = String(prompt || '');
    for (const entry of disabledEntries) result = removeEntryContentOnce(result, entry).text;
    return cleanupPrompt(result);
}

export function injectManualEntriesIntoTextPrompt(prompt, manualEntries) {
    const block = formatManualEntries(manualEntries);
    if (!block) return prompt;
    return cleanupPrompt(`${block}\n\n${prompt}`);
}

export function removeEntriesFromChat(chat, disabledEntries) {
    if (!Array.isArray(chat)) return;

    for (const entry of disabledEntries) {
        for (const message of chat) {
            if (typeof message?.content !== 'string') continue;

            const patched = removeEntryContentOnce(message.content, entry);
            if (patched.removed) {
                message.content = cleanupPrompt(patched.text);
                break;
            }
        }
    }
}

export function injectManualEntriesIntoChat(chat, manualEntries) {
    const block = formatManualEntries(manualEntries);
    if (!block || !Array.isArray(chat)) return;

    chat.unshift({ role: 'system', content: block });
}

export function formatManualEntries(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return '';

    const parts = entries.map((entry) => [
        `Book: ${entry.bookName}`,
        `Entry: ${entry.title}`,
        entry.content,
    ].join('\n'));

    return [MANUAL_BLOCK_TITLE, ...parts].join('\n\n');
}

export function cleanupPrompt(text) {
    return String(text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function removeEntryContentOnce(text, entry) {
    const source = String(text || '');
    const content = String(entry?.content || '');
    if (!content) return { text: source, removed: false };

    const exactIndex = source.indexOf(content);
    if (exactIndex !== -1) {
        return {
            text: source.slice(0, exactIndex) + source.slice(exactIndex + content.length),
            removed: true,
        };
    }

    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const normalizedSource = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const normalizedIndex = normalizedSource.indexOf(normalizedContent);
    if (normalizedIndex !== -1) {
        return {
            text: normalizedSource.slice(0, normalizedIndex) + normalizedSource.slice(normalizedIndex + normalizedContent.length),
            removed: true,
        };
    }

    const regex = buildWhitespaceFlexibleRegex(content);
    const regexResult = source.replace(regex, '');
    if (regexResult !== source) return { text: regexResult, removed: true };

    return { text: source, removed: false };
}

function buildWhitespaceFlexibleRegex(value) {
    const escaped = String(value || '')
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\s+/g, '\\s+');

    return new RegExp(escaped, 'm');
}
