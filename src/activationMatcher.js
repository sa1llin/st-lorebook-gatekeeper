export function findActiveEntries(entries, promptText) {
    const normalizedPrompt = normalizeForMatching(promptText);

    return entries
        .map((entry) => {
            const matchType = getEntryMatchType(entry, promptText, normalizedPrompt);
            if (matchType === 'none') return null;

            const unlinkedAlwaysActive = isUnlinkedAlwaysActiveEntry(entry);

            return {
                ...entry,
                active: true,
                originallyActive: true,
                selected: !unlinkedAlwaysActive,
                matchType: unlinkedAlwaysActive ? 'unlinked-constant' : matchType,
                matchedKeywords: unlinkedAlwaysActive ? [] : findMatchedKeywords(entry, promptText),
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

function findMatchedKeywords(entry, promptText) {
    const keys = [...(entry?.keys || []), ...(entry?.secondaryKeys || [])]
        .flatMap(splitPossibleKeywordList)
        .map((key) => String(key || '').trim())
        .filter(Boolean);

    if (!keys.length) return [];

    const haystack = stripEntryContentFromPrompt(promptText, entry?.content).toLowerCase();
    const matched = [];

    for (const key of keys) {
        const normalizedKey = key.toLowerCase();
        if (!normalizedKey || matched.some((value) => value.toLowerCase() === normalizedKey)) continue;
        if (haystack.includes(normalizedKey)) matched.push(key);
    }

    return matched;
}

function stripEntryContentFromPrompt(promptText, content) {
    const prompt = String(promptText || '');
    const entryContent = String(content || '');
    if (!entryContent) return prompt;
    return prompt.split(entryContent).join(' ');
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

function isUnlinkedAlwaysActiveEntry(entry) {
    return isAlwaysActiveEntry(entry) && !isConnectedLorebookSource(entry);
}

function isAlwaysActiveEntry(entry) {
    return entry?.constant === true || entry?.raw?.constant === true;
}

function isConnectedLorebookSource(entry) {
    return ['chat', 'persona', 'character', 'global'].includes(String(entry?.sourceType || '').toLowerCase());
}

function normalizeForMatching(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function normalizeCompact(text) {
    return normalizeForMatching(text).replace(/\s+/g, ' ').trim();
}
