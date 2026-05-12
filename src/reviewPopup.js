import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { POPUP_TYPE, Popup } from '../../../../popup.js';
import { CANCEL_GENERATION_RESULT, EXTENSION_PATH, MAX_RENDERED_ENTRIES } from './constants.js';
import { sumTokens } from './tokenCounter.js';

export async function showLorebookReviewPopup({
    activeEntries,
    inactiveEntries,
    statsBefore,
    settings,
}) {
    const template = $(await renderExtensionTemplateAsync(EXTENSION_PATH, 'popup'));

    const state = {
        activeEntries: activeEntries.map((entry) => ({
            ...entry,
            selected: true,
            originallyActive: true,
        })),
        inactiveEntries: inactiveEntries.map((entry) => ({
            ...entry,
            selected: false,
            originallyActive: false,
        })),
        settings,
    };

    initializeControls(template, state);
    renderLists(template, state);
    updateStats(template, state, statsBefore);

    let popup;
    const cancelGenerationButton = {
        text: 'Cancel generation',
        result: CANCEL_GENERATION_RESULT,
        appendAtEnd: true,
        action: async () => {
            await popup.complete(CANCEL_GENERATION_RESULT);
        },
    };

    popup = new Popup(template, POPUP_TYPE.CONFIRM, '', {
        wide: true,
        large: true,
        okButton: 'Confirm changes',
        cancelButton: 'Send without changes',
        customButtons: [cancelGenerationButton],
    });

    const popupResult = await popup.show();

    if (popupResult === CANCEL_GENERATION_RESULT) {
        return {
            action: 'cancel',
            disabledEntries: [],
            manualEntries: [],
        };
    }

    if (!popupResult) {
        return {
            action: 'discard',
            disabledEntries: [],
            manualEntries: [],
        };
    }

    const disabledEntries = state.activeEntries.filter((entry) => !entry.selected);
    const manualEntries = state.inactiveEntries.filter((entry) => entry.selected);

    return {
        action: 'confirm',
        disabledEntries,
        manualEntries,
    };
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

    template.find('#lbgDisableAllActive').on('click', () => {
        state.activeEntries.forEach((entry) => {
            entry.selected = false;
        });
        renderLists(template, state);
        updateStats(template, state);
    });

    template.find('#lbgEnableAllActive').on('click', () => {
        state.activeEntries.forEach((entry) => {
            entry.selected = true;
        });
        renderLists(template, state);
        updateStats(template, state);
    });
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
            inactiveContainer.append(createNoticeElement(
                `Showing ${MAX_RENDERED_ENTRIES} of ${inactiveEntries.length} inactive entries. Use search to narrow the list.`
            ));
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

function updateStats(template, state, statsBefore = null) {
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

    if (statsBefore) {
        template.find('#lbgBeforeTokens').text(statsBefore.activeTokens || 0);
    }
}

function filterAndSortEntries(entries, query, sortMode) {
    let result = entries;

    if (query) {
        result = result.filter((entry) => {
            const haystack = [
                entry.title,
                entry.bookName,
                entry.content,
                ...(entry.keys || []),
                ...(entry.secondaryKeys || []),
            ].join(' ').toLowerCase();

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
