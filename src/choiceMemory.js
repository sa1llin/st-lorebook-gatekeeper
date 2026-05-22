import { CHOICE_MEMORY_KEY, PREVIOUS_CHOICE_KEY } from './constants.js';

export function loadRememberedChoice() {
    return loadChoice(CHOICE_MEMORY_KEY);
}

export function loadPreviousChoice() {
    return loadChoice(PREVIOUS_CHOICE_KEY);
}

export function saveRememberedChoiceFromState(state) {
    const memory = buildChoiceFromState(state);
    localStorage.setItem(CHOICE_MEMORY_KEY, JSON.stringify(memory));
    return memory;
}

export function savePreviousChoiceFromState(state) {
    const memory = buildChoiceFromState(state);
    localStorage.setItem(PREVIOUS_CHOICE_KEY, JSON.stringify(memory));
    return memory;
}

export function clearRememberedChoice() {
    localStorage.removeItem(CHOICE_MEMORY_KEY);
}

export function applyRememberedChoiceToState(state, rememberedChoice) {
    return applyChoiceToState(state, rememberedChoice);
}

export function applyPreviousChoiceToState(state, previousChoice) {
    return applyChoiceToState(state, previousChoice);
}

export function formatRememberedChoiceInfo(rememberedChoice) {
    return formatChoiceInfo(rememberedChoice, 'No remembered choice.');
}

export function formatPreviousChoiceInfo(previousChoice) {
    return formatChoiceInfo(previousChoice, 'No previous request choice.');
}

function loadChoice(storageKey) {
    try {
        const raw = localStorage.getItem(storageKey);
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
        console.warn('Lorebook Gatekeeper: failed to load stored choice.', error);
        return null;
    }
}

function buildChoiceFromState(state) {
    return {
        version: 1,
        savedAt: Date.now(),
        selectedActiveIds: state.activeEntries.filter((entry) => entry.selected).map((entry) => entry.id),
        disabledActiveIds: state.activeEntries.filter((entry) => !entry.selected).map((entry) => entry.id),
        manualEntryIds: state.inactiveEntries.filter((entry) => entry.selected).map((entry) => entry.id),
    };
}

function applyChoiceToState(state, choice) {
    if (!choice) return false;

    const selectedActiveIds = new Set(choice.selectedActiveIds || []);
    const disabledActiveIds = new Set(choice.disabledActiveIds || []);
    const manualEntryIds = new Set(choice.manualEntryIds || []);

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

function formatChoiceInfo(choice, emptyText) {
    if (!choice) return emptyText;

    const savedAt = choice.savedAt ? new Date(choice.savedAt).toLocaleString() : 'unknown time';
    const disabledCount = choice.disabledActiveIds?.length || 0;
    const manualCount = choice.manualEntryIds?.length || 0;

    return `Saved: ${savedAt}. Disabled active: ${disabledCount}. Manual entries: ${manualCount}.`;
}

function toStringArray(value) {
    return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}
