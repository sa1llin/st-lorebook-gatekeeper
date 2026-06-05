export function findActiveEntries(entries, promptText, options = {}) {
    const normalizedPrompt = normalizeForMatching(promptText);

    return entries
        .map((entry) => {
            const matchType = getEntryMatchType(entry, promptText, normalizedPrompt);
            if (matchType === 'none') return null;

            const triggerScanText = buildTriggerScanTextForEntry(entry, options);

            return {
                ...entry,
                active: true,
                originallyActive: true,
                selected: true,
                matchType,
                matchedKeywords: findMatchedKeywords(entry, triggerScanText, options),
            };
        })
        .filter(Boolean);
}

export function splitActiveAndInactive(entries, activeEntries) {
    const activeIds = new Set(activeEntries.map((entry) => entry.id));

    return {
        activeEntries,
        inactiveEntries: entries
            .filter((entry) => !activeIds.has(entry.id))
            .map((entry) => ({
                ...entry,
                active: false,
                originallyActive: false,
                selected: false,
                matchType: 'none',
                matchedKeywords: [],
            })),
    };
}

function buildTriggerScanTextForEntry(entry, options = {}) {
    if (Array.isArray(options.triggerScanMessages) && options.triggerScanMessages.length) {
        const scanDepth = getEntryScanDepth(entry, options.defaultScanDepth);
        return buildScanTextFromMessages(options.triggerScanMessages, scanDepth, options.includeNames);
    }

    if (Object.prototype.hasOwnProperty.call(options, 'triggerScanText')) {
        return String(options.triggerScanText || '');
    }

    return '';
}

function buildScanTextFromMessages(messages, scanDepth, includeNames = true) {
    const depth = Number(scanDepth);
    if (!Number.isFinite(depth) || depth <= 0 || !Array.isArray(messages) || !messages.length) return '';

    return messages
        .slice(-Math.floor(depth))
        .map((message) => formatMessageForScan(message, includeNames))
        .filter(Boolean)
        .join('\n');
}

function formatMessageForScan(message, includeNames = true) {
    if (typeof message === 'string') return message;

    const content = extractMessageContent(message);
    if (!content) return '';

    if (!includeNames) return content;

    const name = String(
        message?.name
        ?? message?.sender
        ?? message?.extra?.name
        ?? message?.role
        ?? '',
    ).trim();

    return name ? `${name}: ${content}` : content;
}

function extractMessageContent(message) {
    if (!message) return '';

    if (typeof message === 'string') return message;
    if (typeof message.mes === 'string') return message.mes;
    if (typeof message.message === 'string') return message.message;
    if (typeof message.content === 'string') return message.content;
    if (typeof message.text === 'string') return message.text;

    if (Array.isArray(message.content)) {
        return message.content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (typeof part?.text === 'string') return part.text;
                if (typeof part?.content === 'string') return part.content;
                if (typeof part?.message === 'string') return part.message;
                return '';
            })
            .filter(Boolean)
            .join('\n');
    }

    return '';
}

function getEntryScanDepth(entry, fallbackDepth) {
    const candidates = [
        entry?.scanDepth,
        entry?.scan_depth,
        entry?.raw?.scanDepth,
        entry?.raw?.scan_depth,
    ];

    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value >= 0) return Math.floor(value);
    }

    const fallback = Number(fallbackDepth);
    return Number.isFinite(fallback) && fallback >= 0 ? Math.floor(fallback) : 2;
}

function findMatchedKeywords(entry, triggerScanText, options = {}) {
    const keys = [...(entry?.keys || []), ...(entry?.secondaryKeys || [])]
        .flatMap(splitPossibleKeywordList)
        .map((key) => String(key || '').trim())
        .filter(Boolean);

    if (!keys.length) return [];

    const haystack = normalizeForMatching(triggerScanText);
    if (!haystack) return [];

    const matched = [];

    for (const key of keys) {
        if (!key || matched.some((value) => value.toLowerCase() === key.toLowerCase())) continue;

        const match = matchKeyword(haystack, key, {
            caseSensitive: getEntryBooleanOption(entry, 'caseSensitive', options.caseSensitive),
            matchWholeWords: getEntryBooleanOption(entry, 'matchWholeWords', options.matchWholeWords),
        });

        if (match) matched.push(match);
    }

    return matched;
}

function getEntryBooleanOption(entry, fieldName, fallbackValue) {
    const value = entry?.[fieldName] ?? entry?.raw?.[fieldName];
    if (typeof value === 'boolean') return value;
    return Boolean(fallbackValue);
}

function matchKeyword(text, key, options = {}) {
    if (isRegexKey(key)) {
        try {
            const regex = parseRegexKey(key);
            const match = text.match(regex);
            return match ? match[0] : null;
        } catch (error) {
            console.warn('Lorebook Gatekeeper: invalid regex keyword skipped.', key, error);
            return null;
        }
    }

    const caseSensitive = Boolean(options.caseSensitive);
    const matchWholeWords = Boolean(options.matchWholeWords);

    if (!matchWholeWords) {
        const haystack = caseSensitive ? text : text.toLowerCase();
        const needle = caseSensitive ? key : key.toLowerCase();
        return haystack.includes(needle) ? key : null;
    }

    const escapedKey = escapeRegExp(caseSensitive ? key : key.toLowerCase());
    const haystack = caseSensitive ? text : text.toLowerCase();
    const keyWords = String(key).trim().split(/\s+/);

    if (keyWords.length > 1) {
        return haystack.includes(caseSensitive ? key : key.toLowerCase()) ? key : null;
    }

    // Mirrors SillyTavern's whole-word behavior: one-word keys should not trigger inside another word.
    const regex = new RegExp(`(?:^|\\W)(${escapedKey})(?:$|\\W)`, 'u');
    return regex.test(haystack) ? key : null;
}

function isRegexKey(key) {
    return typeof key === 'string' && key.startsWith('/') && key.lastIndexOf('/') > 0;
}

function parseRegexKey(key) {
    const lastSlash = key.lastIndexOf('/');
    const pattern = key.slice(1, lastSlash);
    const rawFlags = key.slice(lastSlash + 1);
    const flags = [...new Set(rawFlags.split('').filter(Boolean))].join('');

    return new RegExp(pattern, flags);
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitPossibleKeywordList(value) {
    return String(value || '')
        .split(/[,;|]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function getEntryMatchType(entry, promptText, normalizedPrompt) {
    if (!entry?.content) return 'none';

    if (promptText.includes(entry.content)) return 'exact';

    const normalizedContent = normalizeForMatching(entry.content);
    if (normalizedContent && normalizedPrompt.includes(normalizedContent)) return 'normalized';

    const compactContent = normalizeCompact(entry.content);
    const compactPrompt = normalizeCompact(promptText);

    if (compactContent.length >= 80 && compactPrompt.includes(compactContent)) return 'compact';

    return 'none';
}

function normalizeForMatching(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function normalizeCompact(text) {
    return normalizeForMatching(text).replace(/\s+/g, ' ').trim();
}
