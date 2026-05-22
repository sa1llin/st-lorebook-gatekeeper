export function findActiveEntries(entries, promptText) {
    const normalizedPrompt = normalizeForMatching(promptText);

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
            })),
    };
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
