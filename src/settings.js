import { STORAGE_KEY } from './constants.js';

export const defaultSettings = {
    enabled: true,
    showInactiveEntries: true,
    insertManualEntriesAsSystem: true,
    maxPreviewLength: 500,
    sortMode: 'tokens_desc',
    countInactiveTokens: true,
    showManualOnlyWhenNoActive: false,
};

export function getSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...cloneDefaultSettings(), ...JSON.parse(raw) } : cloneDefaultSettings();
    } catch (error) {
        console.warn('Lorebook Gatekeeper: failed to read settings, using defaults.', error);
        return cloneDefaultSettings();
    }
}

export function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function cloneDefaultSettings() {
    return JSON.parse(JSON.stringify(defaultSettings));
}
