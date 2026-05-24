import { STORAGE_KEY } from './constants.js';

export const defaultSettings = {
    enabled: true,
    showInactiveEntries: true,
    insertManualEntriesAsSystem: true,
    maxPreviewLength: 500,
    sortMode: 'tokens_desc',
    countInactiveTokens: true,
    showManualOnlyWhenNoActive: false,
    preferredInactiveBookNames: [],

    favorites: {},
    entryTags: {},
    customTags: {},
    tagColors: {},
    tagFilter: {
        selectedTags: [],
        mode: 'or',
    },
    favoritesMode: 'pin',
};

export function getSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return normalizeSettings(raw ? { ...cloneDefaultSettings(), ...JSON.parse(raw) } : cloneDefaultSettings());
    } catch (error) {
        console.warn('Lorebook Gatekeeper: failed to read settings, using defaults.', error);
        return cloneDefaultSettings();
    }
}

export function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
}

function normalizeSettings(settings) {
    const normalized = { ...cloneDefaultSettings(), ...(settings || {}) };

    normalized.preferredInactiveBookNames = toStringArray(normalized.preferredInactiveBookNames);
    normalized.favorites = normalizeBooleanMap(normalized.favorites);
    normalized.entryTags = normalizeEntryTags(normalized.entryTags);
    normalized.customTags = normalizeCustomTags(normalized.customTags);
    normalized.tagColors = normalizeStringMap(normalized.tagColors);
    normalized.favoritesMode = ['pin', 'section', 'both'].includes(normalized.favoritesMode)
        ? normalized.favoritesMode
        : 'pin';

    normalized.tagFilter = {
        selectedTags: toStringArray(normalized.tagFilter?.selectedTags).map(normalizeTagName).filter(Boolean),
        mode: normalized.tagFilter?.mode === 'and' ? 'and' : 'or',
    };

    return normalized;
}

function normalizeBooleanMap(value) {
    const result = {};
    if (!value || typeof value !== 'object') return result;

    for (const [key, enabled] of Object.entries(value)) {
        if (key && enabled) result[String(key)] = true;
    }

    return result;
}

function normalizeEntryTags(value) {
    const result = {};
    if (!value || typeof value !== 'object') return result;

    for (const [entryId, tags] of Object.entries(value)) {
        const normalizedTags = [...new Set(toStringArray(tags).map(normalizeTagName).filter(Boolean))];
        if (entryId && normalizedTags.length) result[String(entryId)] = normalizedTags;
    }

    return result;
}

function normalizeCustomTags(value) {
    const result = {};
    if (!value || typeof value !== 'object') return result;

    for (const [key, tag] of Object.entries(value)) {
        const name = normalizeTagName(tag?.name || key);
        if (!name) continue;

        result[name] = {
            name,
            label: String(tag?.label || formatTagLabel(name)),
            createdAt: Number(tag?.createdAt || Date.now()),
        };
    }

    return result;
}

function normalizeStringMap(value) {
    const result = {};
    if (!value || typeof value !== 'object') return result;

    for (const [key, mapValue] of Object.entries(value)) {
        if (key && mapValue) result[String(key)] = String(mapValue);
    }

    return result;
}

function toStringArray(value) {
    return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function normalizeTagName(tag) {
    return String(tag || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function formatTagLabel(tag) {
    return String(tag || '').trim().replace(/\s+/g, ' ').replace(/^./, (char) => char.toUpperCase());
}

function cloneDefaultSettings() {
    return JSON.parse(JSON.stringify(defaultSettings));
}
