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
    return normalized;
}

function toStringArray(value) {
    return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function cloneDefaultSettings() {
    return JSON.parse(JSON.stringify(defaultSettings));
}
