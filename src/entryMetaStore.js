export const DEFAULT_TAGS = [
    { name: 'character', label: 'Character' },
    { name: 'location', label: 'Location' },
    { name: 'item', label: 'Item' },
    { name: 'lore', label: 'Lore' },
    { name: 'plot', label: 'Plot' },
    { name: 'relationship', label: 'Relationship' },
    { name: 'important', label: 'Important' },
    { name: 'nsfw', label: 'NSFW' },
];

const TAG_COLOR_PALETTE = [
    '#4f8cff',
    '#4caf70',
    '#f3c969',
    '#d95c5c',
    '#9b6cff',
    '#4ecdc4',
    '#ff8c42',
    '#c77dff',
    '#6bcb77',
    '#ff6b9a',
    '#00b4d8',
    '#b5e48c',
];

export function ensureEntryMetaSettings(settings) {
    if (!settings.favorites || typeof settings.favorites !== 'object') settings.favorites = {};
    if (!settings.lockedEntries || typeof settings.lockedEntries !== 'object') settings.lockedEntries = {};
    if (!settings.blockedEntries || typeof settings.blockedEntries !== 'object') settings.blockedEntries = {};
    if (!settings.entryTags || typeof settings.entryTags !== 'object') settings.entryTags = {};
    if (!settings.customTags || typeof settings.customTags !== 'object') settings.customTags = {};
    if (!settings.tagColors || typeof settings.tagColors !== 'object') settings.tagColors = {};
    if (!settings.tagFilter || typeof settings.tagFilter !== 'object') {
        settings.tagFilter = { selectedTags: [], mode: 'or' };
    }

    for (const entryId of Object.keys(settings.blockedEntries)) {
        delete settings.lockedEntries[entryId];
    }

    settings.tagFilter.selectedTags = toStringArray(settings.tagFilter.selectedTags).map(normalizeTagName).filter(Boolean);
    settings.tagFilter.mode = settings.tagFilter.mode === 'and' ? 'and' : 'or';

    ensureDefaultTagColors(settings);
}

export function getEntryMetaId(entry) {
    return String(entry?.stableId || entry?.id || `${entry?.bookName || 'unknown'}:${entry?.uid || entry?.title || 'entry'}`);
}

export function isFavorite(settings, entryOrId) {
    ensureEntryMetaSettings(settings);
    const entryId = typeof entryOrId === 'string' ? entryOrId : getEntryMetaId(entryOrId);
    return Boolean(settings.favorites[entryId]);
}

export function toggleFavorite(settings, entryOrId) {
    ensureEntryMetaSettings(settings);
    const entryId = typeof entryOrId === 'string' ? entryOrId : getEntryMetaId(entryOrId);

    if (settings.favorites[entryId]) {
        delete settings.favorites[entryId];
    } else {
        settings.favorites[entryId] = true;
    }

    return Boolean(settings.favorites[entryId]);
}

export function isLocked(settings, entryOrId) {
    ensureEntryMetaSettings(settings);
    const entryId = typeof entryOrId === 'string' ? entryOrId : getEntryMetaId(entryOrId);
    return Boolean(settings.lockedEntries[entryId]);
}

export function toggleLocked(settings, entryOrId) {
    ensureEntryMetaSettings(settings);
    const entryId = typeof entryOrId === 'string' ? entryOrId : getEntryMetaId(entryOrId);

    if (settings.lockedEntries[entryId]) {
        delete settings.lockedEntries[entryId];
    } else {
        settings.lockedEntries[entryId] = true;
        delete settings.blockedEntries[entryId];
    }

    return Boolean(settings.lockedEntries[entryId]);
}

export function isBlocked(settings, entryOrId) {
    ensureEntryMetaSettings(settings);
    const entryId = typeof entryOrId === 'string' ? entryOrId : getEntryMetaId(entryOrId);
    return Boolean(settings.blockedEntries[entryId]);
}

export function toggleBlocked(settings, entryOrId) {
    ensureEntryMetaSettings(settings);
    const entryId = typeof entryOrId === 'string' ? entryOrId : getEntryMetaId(entryOrId);

    if (settings.blockedEntries[entryId]) {
        delete settings.blockedEntries[entryId];
    } else {
        settings.blockedEntries[entryId] = true;
        delete settings.lockedEntries[entryId];
    }

    return Boolean(settings.blockedEntries[entryId]);
}

export function getEntryTags(settings, entryOrId) {
    ensureEntryMetaSettings(settings);
    const entryId = typeof entryOrId === 'string' ? entryOrId : getEntryMetaId(entryOrId);
    return toStringArray(settings.entryTags[entryId]).map(normalizeTagName).filter(Boolean);
}

export function setEntryTags(settings, entryOrId, tags) {
    ensureEntryMetaSettings(settings);
    const entryId = typeof entryOrId === 'string' ? entryOrId : getEntryMetaId(entryOrId);
    const normalizedTags = [...new Set(toStringArray(tags).map(normalizeTagName).filter(Boolean))];

    for (const tagName of normalizedTags) {
        createCustomTag(settings, tagName);
    }

    if (normalizedTags.length) {
        settings.entryTags[entryId] = normalizedTags;
    } else {
        delete settings.entryTags[entryId];
    }

    return normalizedTags;
}

export function addEntryTag(settings, entryOrId, rawTagName) {
    const tagName = createCustomTag(settings, rawTagName);
    if (!tagName) return [];

    const currentTags = getEntryTags(settings, entryOrId);
    if (!currentTags.includes(tagName)) currentTags.push(tagName);
    return setEntryTags(settings, entryOrId, currentTags);
}

export function removeEntryTag(settings, entryOrId, rawTagName) {
    const tagName = normalizeTagName(rawTagName);
    const nextTags = getEntryTags(settings, entryOrId).filter((tag) => tag !== tagName);
    return setEntryTags(settings, entryOrId, nextTags);
}

export function createCustomTag(settings, rawTagName) {
    ensureEntryMetaSettings(settings);
    const name = normalizeTagName(rawTagName);
    if (!name) return '';

    const defaultTag = DEFAULT_TAGS.find((tag) => tag.name === name);
    if (!defaultTag && !settings.customTags[name]) {
        settings.customTags[name] = {
            name,
            label: formatTagLabel(name),
            createdAt: Date.now(),
        };
    }

    if (!settings.tagColors[name]) settings.tagColors[name] = generateTagColor(name);
    return name;
}

export function getAllAvailableTags(settings) {
    ensureEntryMetaSettings(settings);

    const tags = new Map();
    for (const tag of DEFAULT_TAGS) {
        tags.set(tag.name, {
            ...tag,
            type: 'standard',
            color: getTagColor(settings, tag.name),
        });
    }

    for (const tag of Object.values(settings.customTags || {})) {
        const name = normalizeTagName(tag?.name);
        if (!name) continue;

        tags.set(name, {
            name,
            label: String(tag?.label || formatTagLabel(name)),
            type: 'custom',
            color: getTagColor(settings, name),
        });
    }

    for (const entryTags of Object.values(settings.entryTags || {})) {
        for (const tagName of toStringArray(entryTags).map(normalizeTagName).filter(Boolean)) {
            if (!tags.has(tagName)) {
                tags.set(tagName, {
                    name: tagName,
                    label: formatTagLabel(tagName),
                    type: 'custom',
                    color: getTagColor(settings, tagName),
                });
            }
        }
    }

    return [...tags.values()].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'standard' ? -1 : 1;
        return a.label.localeCompare(b.label);
    });
}


export function getTagUsageCounts(settings) {
    ensureEntryMetaSettings(settings);

    const counts = {};
    for (const entryTags of Object.values(settings.entryTags || {})) {
        for (const tagName of toStringArray(entryTags).map(normalizeTagName).filter(Boolean)) {
            counts[tagName] = (counts[tagName] || 0) + 1;
        }
    }

    return counts;
}

export function deleteTagGlobally(settings, rawTagName) {
    ensureEntryMetaSettings(settings);
    const tagName = normalizeTagName(rawTagName);
    if (!tagName) return false;

    const isStandardTag = DEFAULT_TAGS.some((tag) => tag.name === tagName);

    for (const [entryId, entryTags] of Object.entries(settings.entryTags || {})) {
        const nextTags = toStringArray(entryTags).map(normalizeTagName).filter((tag) => tag && tag !== tagName);
        if (nextTags.length) settings.entryTags[entryId] = [...new Set(nextTags)];
        else delete settings.entryTags[entryId];
    }

    if (!isStandardTag) {
        delete settings.customTags[tagName];
        delete settings.tagColors[tagName];
    }

    if (settings.tagFilter && Array.isArray(settings.tagFilter.selectedTags)) {
        settings.tagFilter.selectedTags = settings.tagFilter.selectedTags.filter((tag) => normalizeTagName(tag) !== tagName);
    }

    return true;
}

export function getTagColor(settings, rawTagName) {
    ensureEntryMetaSettings(settings);
    const tagName = normalizeTagName(rawTagName);
    if (!tagName) return '#888888';

    if (!settings.tagColors[tagName]) settings.tagColors[tagName] = generateTagColor(tagName);
    return settings.tagColors[tagName];
}

export function normalizeTagName(tag) {
    return String(tag || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function formatTagLabel(tag) {
    return String(tag || '').trim().replace(/\s+/g, ' ').replace(/^./, (char) => char.toUpperCase());
}

function ensureDefaultTagColors(settings) {
    DEFAULT_TAGS.forEach((tag, index) => {
        if (!settings.tagColors[tag.name]) {
            settings.tagColors[tag.name] = TAG_COLOR_PALETTE[index % TAG_COLOR_PALETTE.length];
        }
    });
}

function generateTagColor(tagName) {
    let hash = 0;
    const text = String(tagName || '');

    for (let i = 0; i < text.length; i += 1) {
        hash = text.charCodeAt(i) + ((hash << 5) - hash);
        hash |= 0;
    }

    return TAG_COLOR_PALETTE[Math.abs(hash) % TAG_COLOR_PALETTE.length];
}

function toStringArray(value) {
    return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}
