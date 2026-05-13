import { CHOICE_MEMORY_KEY } from './constants.js';

export function loadRememberedChoice() {
    try {
        const raw = localStorage.getItem(CHOICE_MEMORY_KEY);
        if (!raw) return null;

        const value = JSON.parse(raw);
        if (!value || value.version !== 1) return null;

        return {
            version: 1,
            savedAt: Number(value.savedAt || 0),
            selectedActiveIds: toStringArray(value.selectedActiveIds),
            disabledActiveIds: toStringArray(value.disabledActiveIds),
            manualEntryIds: toStringArray(value.manualEntryIds),
        };
    } catch (error) {
        console.warn('Lorebook Gatekeeper: failed to load remembered choice.', error);
        return null;
    }
}

export function saveRememberedChoiceFromState(state) {
    const memory = {
        version: 1,
        savedAt: Date.now(),
        selectedActiveIds: state.activeEntries.filter((entry) => entry.selected).map((entry) => entry.id),
        disabledActiveIds: state.activeEntries.filter((entry) => !entry.selected).map((entry) => entry.id),
        manualEntryIds: state.inactiveEntries.filter((entry) => entry.selected).map((entry) => entry.id),
    };

    localStorage.setItem(CHOICE_MEMORY_KEY, JSON.stringify(memory));
    return memory;
}

export function clearRememberedChoice() {
    localStorage.removeItem(CHOICE_MEMORY_KEY);
}

export function applyRememberedChoiceToState(state, rememberedChoice) {
    if (!rememberedChoice) return false;

    const selectedActiveIds = new Set(rememberedChoice.selectedActiveIds || []);
    const disabledActiveIds = new Set(rememberedChoice.disabledActiveIds || []);
    const manualEntryIds = new Set(rememberedChoice.manualEntryIds || []);

    for (const entry of state.activeEntries) {
        if (disabledActiveIds.has(entry.id)) {
            entry.selected = false;
            continue;
        }

        if (selectedActiveIds.has(entry.id)) {
            entry.selected = true;
        }
    }

    for (const entry of state.inactiveEntries) {
        entry.selected = manualEntryIds.has(entry.id);
    }

    return true;
}

export function formatRememberedChoiceInfo(rememberedChoice) {
    if (!rememberedChoice) {
        return 'No remembered choice.';
    }

    const savedAt = rememberedChoice.savedAt ? new Date(rememberedChoice.savedAt).toLocaleString() : 'unknown time';
    const disabledCount = rememberedChoice.disabledActiveIds?.length || 0;
    const manualCount = rememberedChoice.manualEntryIds?.length || 0;

    return `Saved: ${savedAt}. Disabled active: ${disabledCount}. Manual entries: ${manualCount}.`;
}

function toStringArray(value) {
    return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}
