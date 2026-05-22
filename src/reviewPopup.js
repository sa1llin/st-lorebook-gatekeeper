import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { POPUP_TYPE, Popup } from '../../../../popup.js';
import {
    ALL_LOREBOOKS_FILTER,
    CANCEL_GENERATION_RESULT,
    EXTENSION_PATH,
    MAX_RENDERED_ENTRIES,
} from './constants.js';
import { sumTokens } from './tokenCounter.js';
import {
    applyPreviousChoiceToState,
    applyRememberedChoiceToState,
    clearRememberedChoice,
    formatPreviousChoiceInfo,
    formatRememberedChoiceInfo,
    loadPreviousChoice,
    loadRememberedChoice,
    savePreviousChoiceFromState,
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
        previousChoice: loadPreviousChoice(),
        inactiveBookFilter: ALL_LOREBOOKS_FILTER,
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

    state.previousChoice = savePreviousChoiceFromState(state);

    if (Boolean(template.find('#lbgRememberChoice').prop('checked'))) {
        state.rememberedChoice = saveRememberedChoiceFromState(state);
    }

    const selectedActiveEntries = state.activeEntries.filter((entry) => entry.selected);
    const disabledEntries = state.activeEntries.filter((entry) => !entry.selected);
    const manualEntries = state.inactiveEntries.filter((entry) => entry.selected);

    return { action: 'confirm', selectedActiveEntries, disabledEntries, manualEntries };
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

    populateInactiveBookFilter(template, state);
    populatePreferredInactiveBooks(template, state);

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

    template.find('#lbgInactiveBookFilter').on('change', () => {
        state.inactiveBookFilter = String(template.find('#lbgInactiveBookFilter').val() || ALL_LOREBOOKS_FILTER);
        renderLists(template, state);
        updateStats(template, state);
    });

    template.find('#lbgUseLinkedBooksFirst').on('click', () => {
        state.settings.preferredInactiveBookNames = getLinkedBookNames(state.inactiveEntries);
        populatePreferredInactiveBooks(template, state);
        renderLists(template, state);
        updateStats(template, state);
    });

    template.find('#lbgClearPreferredBooks').on('click', () => {
        state.settings.preferredInactiveBookNames = [];
        populatePreferredInactiveBooks(template, state);
        renderLists(template, state);
        updateStats(template, state);
    });

    template.find('#lbgApplyRememberedChoice').on('click', () => {
        state.rememberedChoice = loadRememberedChoice();
        if (!state.rememberedChoice) {
            toastr.info('Lorebook Gatekeeper: no remembered choice to apply.');
            updateChoiceInfo(template, state);
            return;
        }

        applyRememberedChoiceToState(state, state.rememberedChoice);
        renderLists(template, state);
        updateStats(template, state);
        updateChoiceInfo(template, state);
        toastr.success('Lorebook Gatekeeper: remembered choice applied.');
    });

    template.find('#lbgApplyPreviousChoice').on('click', () => {
        state.previousChoice = loadPreviousChoice();
        if (!state.previousChoice) {
            toastr.info('Lorebook Gatekeeper: no previous request choice to apply.');
            updateChoiceInfo(template, state);
            return;
        }

        applyPreviousChoiceToState(state, state.previousChoice);
        renderLists(template, state);
        updateStats(template, state);
        updateChoiceInfo(template, state);
        toastr.success('Lorebook Gatekeeper: previous request choice applied.');
    });

    template.find('#lbgClearRememberedChoice').on('click', () => {
        clearRememberedChoice();
        state.rememberedChoice = null;
        updateChoiceInfo(template, state);
        toastr.info('Lorebook Gatekeeper: remembered choice cleared.');
    });

    updateChoiceInfo(template, state);

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

function populateInactiveBookFilter(template, state) {
    const select = template.find('#lbgInactiveBookFilter');
    const bookInfos = getBookInfos(state.inactiveEntries);

    select.empty();
    select.append(createOption(ALL_LOREBOOKS_FILTER, 'All lorebooks'));

    for (const info of bookInfos) {
        select.append(createOption(info.bookName, `${info.bookName}${info.sourceLabel ? ` (${info.sourceLabel})` : ''}`));
    }

    select.val(state.inactiveBookFilter || ALL_LOREBOOKS_FILTER);
}

function populatePreferredInactiveBooks(template, state) {
    const container = template.find('#lbgPreferredInactiveBooks');
    const bookInfos = getBookInfos(state.inactiveEntries);
    const availableBookNames = new Set(bookInfos.map((info) => info.bookName));
    const preferred = new Set(toStringArray(state.settings.preferredInactiveBookNames).filter((bookName) => availableBookNames.has(bookName)));

    state.settings.preferredInactiveBookNames = [...preferred];
    container.empty();

    if (!bookInfos.length) {
        container.append(createNoticeElement('No inactive lorebooks found.'));
        return;
    }

    for (const info of bookInfos) {
        const label = document.createElement('label');
        label.className = 'lbg-book-choice';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = preferred.has(info.bookName);
        checkbox.addEventListener('change', () => {
            const next = new Set(toStringArray(state.settings.preferredInactiveBookNames));
            if (checkbox.checked) next.add(info.bookName);
            else next.delete(info.bookName);

            state.settings.preferredInactiveBookNames = [...next].filter((bookName) => availableBookNames.has(bookName));
            renderLists(template, state);
            updateStats(template, state);
        });

        const text = document.createElement('span');
        text.textContent = `${info.bookName}${info.sourceLabel ? ` (${info.sourceLabel})` : ''}`;

        label.appendChild(checkbox);
        label.appendChild(text);
        container.append(label);
    }
}

function createOption(value, text) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    return option;
}

function getBookInfos(entries) {
    const byName = new Map();

    for (const entry of entries) {
        const bookName = String(entry.bookName || '').trim();
        if (!bookName) continue;

        const current = byName.get(bookName);
        if (!current || getSourcePriority(entry.sourceType) < current.sourcePriority) {
            byName.set(bookName, {
                bookName,
                sourceType: entry.sourceType || 'other',
                sourcePriority: getSourcePriority(entry.sourceType),
                sourceLabel: getSourceLabel(entry.sourceType),
            });
        }
    }

    return [...byName.values()].sort((a, b) => {
        if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority - b.sourcePriority;
        return a.bookName.localeCompare(b.bookName);
    });
}

function getLinkedBookNames(entries) {
    return getBookInfos(entries)
        .filter((info) => info.sourcePriority < getSourcePriority('other'))
        .map((info) => info.bookName);
}

function filterInactiveEntriesByBook(entries, selectedBookName) {
    if (!selectedBookName || selectedBookName === ALL_LOREBOOKS_FILTER) return entries;
    return entries.filter((entry) => entry.bookName === selectedBookName);
}

function updateChoiceInfo(template, state) {
    template.find('#lbgRememberedChoiceInfo').text(formatRememberedChoiceInfo(state.rememberedChoice));
    template.find('#lbgPreviousChoiceInfo').text(formatPreviousChoiceInfo(state.previousChoice));
    template.find('#lbgApplyRememberedChoice').prop('disabled', !state.rememberedChoice);
    template.find('#lbgClearRememberedChoice').prop('disabled', !state.rememberedChoice);
    template.find('#lbgApplyPreviousChoice').prop('disabled', !state.previousChoice);
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
    const inactiveCandidates = filterEntries(state.inactiveEntries, query);
    const inactiveEntries = sortInactiveEntries(
        filterInactiveEntriesByBook(inactiveCandidates, state.inactiveBookFilter),
        sortMode,
        state,
    );

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

    const sourceBadge = document.createElement('span');
    sourceBadge.className = 'lbg-source-badge';
    sourceBadge.textContent = getSourceLabel(entry.sourceType) || 'external';

    const matchBadge = document.createElement('span');
    matchBadge.className = 'lbg-match-badge';
    matchBadge.textContent = entry.originallyActive ? `match: ${entry.matchType}` : 'manual candidate';

    const keys = document.createElement('span');
    keys.className = 'lbg-keys';
    keys.textContent = buildKeysText(entry);

    meta.appendChild(bookBadge);
    meta.appendChild(sourceBadge);
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
    return sortEntries(filterEntries(entries, query), sortMode);
}

function filterEntries(entries, query) {
    if (!query) return [...entries];

    return entries.filter((entry) => {
        const haystack = [entry.title, entry.bookName, entry.content, ...(entry.keys || []), ...(entry.secondaryKeys || [])]
            .join(' ')
            .toLowerCase();
        return haystack.includes(query);
    });
}

function sortInactiveEntries(entries, sortMode, state) {
    const preferred = new Set(toStringArray(state.settings.preferredInactiveBookNames));
    const sorted = sortEntries(entries, sortMode);

    return sorted.sort((a, b) => {
        const priorityA = getInactivePriority(a, preferred);
        const priorityB = getInactivePriority(b, preferred);
        if (priorityA !== priorityB) return priorityA - priorityB;
        return 0;
    });
}

function getInactivePriority(entry, preferred) {
    if (preferred.has(entry.bookName)) return 0;
    return 1 + getSourcePriority(entry.sourceType);
}

function sortEntries(entries, sortMode) {
    const result = [...entries];

    switch (sortMode) {
        case 'tokens_asc':
            result.sort((a, b) => Number(a.tokens || 0) - Number(b.tokens || 0));
            break;
        case 'tokens_desc':
            result.sort((a, b) => Number(b.tokens || 0) - Number(a.tokens || 0));
            break;
        case 'book':
            result.sort((a, b) => String(a.bookName).localeCompare(String(b.bookName)) || String(a.title).localeCompare(String(b.title)));
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

function getSourcePriority(sourceType) {
    switch (sourceType) {
        case 'chat': return 0;
        case 'persona': return 1;
        case 'character': return 2;
        case 'global': return 3;
        default: return 4;
    }
}

function getSourceLabel(sourceType) {
    switch (sourceType) {
        case 'chat': return 'chat-linked';
        case 'persona': return 'persona-linked';
        case 'character': return 'character-linked';
        case 'global': return 'global';
        default: return 'external';
    }
}

function toStringArray(value) {
    return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}
