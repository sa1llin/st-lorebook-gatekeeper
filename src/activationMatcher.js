export function findActiveEntries(entries, promptText, options = {}) {
    const normalizedPrompt = normalizeForMatching(promptText);
    const triggerScanText = Object.prototype.hasOwnProperty.call(options, 'triggerScanText')
        ? options.triggerScanText
        : promptText;

    return entries
        .map((entry) => {
            const matchType = getEntryMatchType(entry, promptText, normalizedPrompt);
            if (matchType === 'none') return null;

            return {
                ...entry,
                active: true,
                originallyActive: true,
                selected: true,
                matchType,
                matchedKeywords: findMatchedKeywords(entry, triggerScanText),
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

function findMatchedKeywords(entry, triggerScanText) {
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

        const match = matchKeyword(haystack, key);
        if (match) matched.push(match);
    }

    return matched;
}

function matchKeyword(text, key) {
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

    const escapedKey = escapeRegExp(key);
    const isSingleWord = !/\s/.test(key);

    // This mirrors SillyTavern's practical behavior better than a plain .includes():
    // one-word keys should not trigger inside another word, while phrases are matched as text.
    const pattern = isSingleWord
        ? `(^|[^\\p{L}\\p{N}_])(${escapedKey})(?=$|[^\\p{L}\\p{N}_])`
        : `(${escapedKey})`;

    const regex = new RegExp(pattern, 'iu');
    const match = text.match(regex);

    if (!match) return null;
    return isSingleWord ? match[2] : match[1];
}

function isRegexKey(key) {
    return typeof key === 'string' && key.startsWith('/') && key.lastIndexOf('/') > 0;
}

function parseRegexKey(key) {
    const lastSlash = key.lastIndexOf('/');
    const pattern = key.slice(1, lastSlash);
    const rawFlags = key.slice(lastSlash + 1);
    const flags = [...new Set(`${rawFlags}i`.split(''))].join('');

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
