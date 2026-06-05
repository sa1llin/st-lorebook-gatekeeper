export function findActiveEntries(entries, promptText) {
    const normalizedPrompt = normalizeForMatching(promptText);
    const compactPrompt = normalizeCompact(promptText);

    return entries
        .map((entry) => {
            const matchType = getEntryMatchType(entry, promptText, normalizedPrompt, compactPrompt);
            if (matchType === 'none') return null;

            return {
                ...entry,
                active: true,
                originallyActive: true,
                selected: true,
                matchType,
                matchedKeywords: [],
                triggerMatchSource: matchType === 'constant' ? 'constant' : '',
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
                triggerMatchSource: '',
            })),
    };
}

function getEntryMatchType(entry, promptText, normalizedPrompt, compactPrompt) {
    if (!entry?.content) return 'none';

    // SillyTavern marks permanently active World Info entries with the `constant` flag
    // (the blue-circle state in the lorebook UI). These entries must appear as active
    // in Gatekeeper even when they were injected by ST without a keyword match.
    if (entry.constant === true || entry.raw?.constant === true) return 'constant';

    if (promptText.includes(entry.content)) return 'exact';

    const normalizedContent = normalizeForMatching(entry.content);
    if (normalizedContent && normalizedPrompt.includes(normalizedContent)) return 'normalized';

    const compactContent = normalizeCompact(entry.content);
    if (compactContent.length >= 80 && compactPrompt.includes(compactContent)) return 'compact';

    return 'none';
}

function normalizeForMatching(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

function normalizeCompact(text) {
    return normalizeForMatching(text).replace(/\s+/g, ' ').trim();
}
