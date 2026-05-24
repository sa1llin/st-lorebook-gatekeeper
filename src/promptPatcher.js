import { MANUAL_BLOCK_TITLE } from './constants.js';

export function removeEntriesFromTextPrompt(prompt, disabledEntries) {
    let result = String(prompt || '');
    for (const entry of disabledEntries) result = removeEntryContentOnce(result, getOriginalEntryContent(entry)).text;
    return cleanupPrompt(result);
}

export function replaceEditedEntriesInTextPrompt(prompt, selectedEntries) {
    let result = String(prompt || '');
    for (const entry of selectedEntries) {
        if (!hasPromptEdit(entry)) continue;
        result = replaceEntryContentOnce(result, getOriginalEntryContent(entry), getPromptEntryContent(entry)).text;
    }
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

            const patched = removeEntryContentOnce(message.content, getOriginalEntryContent(entry));
            if (patched.removed) {
                message.content = cleanupPrompt(patched.text);
                break;
            }
        }
    }
}

export function replaceEditedEntriesInChat(chat, selectedEntries) {
    if (!Array.isArray(chat)) return;

    for (const entry of selectedEntries) {
        if (!hasPromptEdit(entry)) continue;

        for (const message of chat) {
            if (typeof message?.content !== 'string') continue;

            const patched = replaceEntryContentOnce(message.content, getOriginalEntryContent(entry), getPromptEntryContent(entry));
            if (patched.replaced) {
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
        getPromptEntryContent(entry),
    ].join('\n'));

    return [MANUAL_BLOCK_TITLE, ...parts].join('\n\n');
}

export function getPromptEntryContent(entry) {
    if (Object.prototype.hasOwnProperty.call(entry || {}, 'temporaryContent')) {
        return String(entry.temporaryContent || '');
    }

    return String(entry?.content || '');
}

export function cleanupPrompt(text) {
    return String(text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function getOriginalEntryContent(entry) {
    return String(entry?.originalContent ?? entry?.content ?? '');
}

function hasPromptEdit(entry) {
    if (!Object.prototype.hasOwnProperty.call(entry || {}, 'temporaryContent')) return false;
    return getPromptEntryContent(entry) !== getOriginalEntryContent(entry);
}

function removeEntryContentOnce(text, contentOrEntry) {
    const content = typeof contentOrEntry === 'string'
        ? contentOrEntry
        : getOriginalEntryContent(contentOrEntry);

    const patched = replaceEntryContentOnce(text, content, '');
    return { text: patched.text, removed: patched.replaced };
}

function replaceEntryContentOnce(text, sourceContent, replacementContent) {
    const source = String(text || '');
    const content = String(sourceContent || '');
    const replacement = String(replacementContent || '');
    if (!content) return { text: source, replaced: false };

    const exactIndex = source.indexOf(content);
    if (exactIndex !== -1) {
        return {
            text: source.slice(0, exactIndex) + replacement + source.slice(exactIndex + content.length),
            replaced: true,
        };
    }

    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const normalizedSource = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const normalizedIndex = normalizedSource.indexOf(normalizedContent);
    if (normalizedIndex !== -1) {
        return {
            text: normalizedSource.slice(0, normalizedIndex) + replacement + normalizedSource.slice(normalizedIndex + normalizedContent.length),
            replaced: true,
        };
    }

    const regex = buildWhitespaceFlexibleRegex(content);
    const regexResult = source.replace(regex, replacement);
    if (regexResult !== source) return { text: regexResult, replaced: true };

    return { text: source, replaced: false };
}

function buildWhitespaceFlexibleRegex(value) {
    const escaped = String(value || '')
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\s+/g, '\\s+');

    return new RegExp(escaped, 'm');
}
