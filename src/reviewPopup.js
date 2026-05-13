import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { POPUP_TYPE, Popup } from '../../../../popup.js';
import { CANCEL_GENERATION_RESULT, EXTENSION_PATH, MAX_RENDERED_ENTRIES } from './constants.js';
import { sumTokens } from './tokenCounter.js';
import {
    applyRememberedChoiceToState,
    clearRememberedChoice,
    formatRememberedChoiceInfo,
    loadRememberedChoice,
    saveRememberedChoiceFromState,
} from './choiceMemory.js';

export async function showLorebookReviewPopup({ activeEntries, inactiveEntries, statsBefore, settings }) {
    const template = $(await renderExtensionTemplateAsync(EXTENSION_PATH, 'popup'));

    const state = {
        activeEntries: activeEntries.map((entry) => ({ ...entry, selected: true, originallyActive: true })),
        inactiveEntries: inactiveEntries.map((entry) => ({ ...entry, selected: false, originallyActive: false })),
        settings,
        statsBefore,
        rememberedChoice: loadRememberedChoice(),
    };

    initializeControls(template, state);
    renderLists(template, state);
    updateStats(template, state);

    const cancelGenerationButton = {
        text: 'Cancel generation',
        result: CANCEL_GENERATION_RESULT,
        appendAtEnd: true,
    };

    const popupResult = await showReviewDialog(template, cancelGenerationButton);

    if (popupResult === CANCEL_GENERATION_RESULT) return { action: 'cancel', disabledEntries: [], manualEntries: [] };
    if (!popupResult) return { action: 'discard', disabledEntries: [], manualEntries: [] };

    if (Boolean(template.find('#lbgRememberChoice').prop('checked'))) {
        state.rememberedChoice = saveRememberedChoiceFromState(state);
    }

    const disabledEntries = state.activeEntries.filter((entry) => !entry.selected);
    const manualEntries = state.inactiveEntries.filter((entry) => entry.selected);

    return { action: 'confirm', disabledEntries, manualEntries };
}

function shouldUseMobileOverlay() {
    return window.matchMedia?.('(max-width: 768px), (pointer: coarse)')?.matches || window.innerWidth <= 768;
}

async function showReviewDialog(template, cancelGenerationButton) {
    if (shouldUseMobileOverlay()) return await showMobileReviewOverlay(template, cancelGenerationButton);

    try {
        const popup = new Popup(template, POPUP_TYPE.CONFIRM, '', {
            wide: true,
            large: true,
            okButton: 'Confirm changes',
            cancelButton: 'Send without changes',
            customButtons: [cancelGenerationButton],
        });

        return await popup.show();
    } catch (error) {
        console.warn('Lorebook Gatekeeper: default Popup failed, falling back to mobile overlay.', error);
        return await showMobileReviewOverlay(template, cancelGenerationButton);
    }
}

function showMobileReviewOverlay(template, cancelGenerationButton) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'lbg-mobile-overlay';

        const panel = document.createElement('div');
        panel.className = 'lbg-mobile-panel';

        const body = document.createElement('div');
        body.className = 'lbg-mobile-body';
        body.appendChild(template[0]);

        const footer = document.createElement('div');
        footer.className = 'lbg-mobile-footer';

        const cancelGeneration = document.createElement('button');
        cancelGeneration.type = 'button';
        cancelGeneration.className = 'menu_button lbg-mobile-button lbg-mobile-danger';
        cancelGeneration.textContent = cancelGenerationButton.text || 'Cancel generation';

        const discard = document.createElement('button');
        discard.type = 'button';
        discard.className = 'menu_button lbg-mobile-button';
        discard.textContent = 'Send without changes';

        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'menu_button lbg-mobile-button lbg-mobile-primary';
        confirm.textContent = 'Confirm changes';

        footer.appendChild(cancelGeneration);
        footer.appendChild(discard);
        footer.appendChild(confirm);
        panel.appendChild(body);
        panel.appendChild(footer);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        document.body.classList.add('lbg-mobile-open');

        const cleanup = (result) => {
            document.body.classList.remove('lbg-mobile-open');
            overlay.remove();
            resolve(result);
        };

        cancelGeneration.addEventListener('click', () => cleanup(CANCEL_GENERATION_RESULT), { once: true });
        discard.addEventListener('click', () => cleanup(false), { once: true });
        confirm.addEventListener('click', () => cleanup(true), { once: true });
    });
}

function initializeControls(template, state) {
    template.find('#lbgSort').val(state.settings.sortMode || 'tokens_desc');
    template.find('#lbgShowInactive').prop('checked', Boolean(state.settings.showInactiveEntries));

    template.find('#lbgSearch').on('input', () => {
        renderLists(template, state);
        updateStats(template, state);
    });

    template.find('#lbgSort').on('change', () => {
        state.settings.sortMode = template.find('#lbgSort').val();
        renderLists(template, state);
        updateStats(template, state);
    });

    template.find('#lbgShowInactive').on('change', () => {
        state.settings.showInactiveEntries = Boolean(template.find('#lbgShowInactive').prop('checked'));
        renderLists(template, state);
        updateStats(template, state);
    });

    template.find('#lbgApplyRememberedChoice').on('click', () => {
        state.rememberedChoice = loadRememberedChoice();

        if (!state.rememberedChoice) {
            toastr.info('Lorebook Gatekeeper: no remembered choice to apply.');
            updateMemoryInfo(template, state);
            return;
        }

        applyRememberedChoiceToState(state, state.rememberedChoice);
        renderLists(template, state);
        updateStats(template, state);
        updateMemoryInfo(template, state);
        toastr.success('Lorebook Gatekeeper: remembered choice applied.');
    });

    template.find('#lbgClearRememberedChoice').on('click', () => {
        clearRememberedChoice();
        state.rememberedChoice = null;
        updateMemoryInfo(template, state);
        toastr.info('Lorebook Gatekeeper: remembered choice cleared.');
    });

    updateMemoryInfo(template, state);

    template.find('#lbgDisableAllActive').on('click', () => {
        state.activeEntries.forEach((entry) => { entry.selected = false; });
        renderLists(template, state);
        updateStats(template, state);
    });

    template.find('#lbgEnableAllActive').on('click', () => {
        state.activeEntries.forEach((entry) => { entry.selected = true; });
        renderLists(template, state);
        updateStats(template, state);
    });
}

function updateMemoryInfo(template, state) {
    template.find('#lbgRememberedChoiceInfo').text(formatRememberedChoiceInfo(state.rememberedChoice));
    template.find('#lbgApplyRememberedChoice').prop('disabled', !state.rememberedChoice);
    template.find('#lbgClearRememberedChoice').prop('disabled', !state.rememberedChoice);
}

function renderLists(template, state) {
    const query = String(template.find('#lbgSearch').val() || '').toLowerCase().trim();
    const sortMode = template.find('#lbgSort').val() || 'tokens_desc';
    const showInactive = Boolean(template.find('#lbgShowInactive').prop('checked'));

    const activeContainer = template.find('#lbgActiveEntries');
    const inactiveContainer = template.find('#lbgInactiveEntries');
    const inactiveSection = template.find('#lbgInactiveSection');

    activeContainer.empty();
    inactiveContainer.empty();

    const activeEntries = filterAndSortEntries(state.activeEntries, query, sortMode);
    const inactiveEntries = filterAndSortEntries(state.inactiveEntries, query, sortMode);

    renderEntrySet(activeContainer, activeEntries, state, template);

    inactiveSection.toggle(showInactive);

    if (showInactive) {
        const visibleInactive = inactiveEntries.slice(0, MAX_RENDERED_ENTRIES);
        renderEntrySet(inactiveContainer, visibleInactive, state, template);

        if (inactiveEntries.length > MAX_RENDERED_ENTRIES) {
            inactiveContainer.append(createNoticeElement(`Showing ${MAX_RENDERED_ENTRIES} of ${inactiveEntries.length} inactive entries. Use search to narrow the list.`));
        }
    }

    template.find('#lbgActiveVisibleCount').text(activeEntries.length);
    template.find('#lbgInactiveVisibleCount').text(showInactive ? inactiveEntries.length : 0);
}

function renderEntrySet(container, entries, state, template) {
    if (!entries.length) {
        container.append(createNoticeElement('No entries found.'));
        return;
    }

    for (const entry of entries) {
        container.append(createEntryElement(entry, () => {
            entry.selected = !entry.selected;
            renderLists(template, state);
            updateStats(template, state);
        }));
    }
}

function createEntryElement(entry, onToggle) {
    const element = document.createElement('div');
    element.className = `lbg-entry ${entry.selected ? 'lbg-entry-selected' : 'lbg-entry-disabled'}`;

    const top = document.createElement('div');
    top.className = 'lbg-entry-top';

    const label = document.createElement('label');
    label.className = 'lbg-toggle-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(entry.selected);
    checkbox.addEventListener('change', onToggle);

    const title = document.createElement('span');
    title.className = 'lbg-entry-title';
    title.textContent = entry.title;

    label.appendChild(checkbox);
    label.appendChild(title);

    const tokenBadge = document.createElement('span');
    tokenBadge.className = 'lbg-token-badge';
    tokenBadge.textContent = `${entry.tokens || 0} tokens`;

    top.appendChild(label);
    top.appendChild(tokenBadge);

    const meta = document.createElement('div');
    meta.className = 'lbg-entry-meta';

    const bookBadge = document.createElement('span');
    bookBadge.className = 'lbg-book-badge';
    bookBadge.textContent = entry.bookName;

    const matchBadge = document.createElement('span');
    matchBadge.className = 'lbg-match-badge';
    matchBadge.textContent = entry.originallyActive ? `match: ${entry.matchType}` : 'manual candidate';

    const keys = document.createElement('span');
    keys.className = 'lbg-keys';
    keys.textContent = buildKeysText(entry);

    meta.appendChild(bookBadge);
    meta.appendChild(matchBadge);
    meta.appendChild(keys);

    const preview = document.createElement('pre');
    preview.className = 'lbg-preview';
    preview.textContent = shorten(entry.content, 500);

    element.appendChild(top);
    element.appendChild(meta);
    element.appendChild(preview);

    return element;
}

function createNoticeElement(text) {
    const element = document.createElement('div');
    element.className = 'lbg-notice';
    element.textContent = text;
    return element;
}

function updateStats(template, state) {
    const selectedActive = state.activeEntries.filter((entry) => entry.selected);
    const disabledActive = state.activeEntries.filter((entry) => !entry.selected);
    const selectedManual = state.inactiveEntries.filter((entry) => entry.selected);
    const selectedTokens = sumTokens([...selectedActive, ...selectedManual]);
    const savedTokens = sumTokens(disabledActive);
    const addedTokens = sumTokens(selectedManual);

    template.find('#lbgActiveCount').text(state.activeEntries.length);
    template.find('#lbgInactiveCount').text(state.inactiveEntries.length);
    template.find('#lbgSelectedTokens').text(selectedTokens);
    template.find('#lbgSavedTokens').text(savedTokens);
    template.find('#lbgAddedTokens').text(addedTokens);
    template.find('#lbgBeforeTokens').text(state.statsBefore?.activeTokens || 0);
}

function filterAndSortEntries(entries, query, sortMode) {
    let result = entries;

    if (query) {
        result = result.filter((entry) => {
            const haystack = [entry.title, entry.bookName, entry.content, ...(entry.keys || []), ...(entry.secondaryKeys || [])].join(' ').toLowerCase();
            return haystack.includes(query);
        });
    }

    result = [...result];

    switch (sortMode) {
        case 'tokens_asc':
            result.sort((a, b) => Number(a.tokens || 0) - Number(b.tokens || 0));
            break;
        case 'tokens_desc':
            result.sort((a, b) => Number(b.tokens || 0) - Number(a.tokens || 0));
            break;
        case 'book':
            result.sort((a, b) => String(a.bookName).localeCompare(String(b.bookName)));
            break;
        case 'title':
            result.sort((a, b) => String(a.title).localeCompare(String(b.title)));
            break;
        default:
            break;
    }

    return result;
}

function buildKeysText(entry) {
    const keys = [...(entry.keys || []), ...(entry.secondaryKeys || [])].filter(Boolean);
    return keys.length ? `Keys: ${keys.join(', ')}` : 'Keys: none';
}

function shorten(text, limit) {
    const value = String(text || '');
    return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}
