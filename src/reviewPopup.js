import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { POPUP_TYPE, Popup } from '../../../../popup.js';
import { saveSettings } from './settings.js';
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
import {
    addEntryTag,
    ensureEntryMetaSettings,
    formatTagLabel,
    getAllAvailableTags,
    getEntryTags,
    getTagColor,
    isFavorite,
    normalizeTagName,
    removeEntryTag,
    toggleFavorite,
} from './entryMetaStore.js';

export async function showLorebookReviewPopup({ activeEntries, inactiveEntries, statsBefore, settings }) {
    ensureEntryMetaSettings(settings);

    const template = $(await renderExtensionTemplateAsync(EXTENSION_PATH, 'popup'));
    const state = {
        activeEntries: activeEntries.map((entry) => ({ ...entry, stableId: entry.stableId || entry.id, selected: true, originallyActive: true })),
        inactiveEntries: inactiveEntries.map((entry) => ({ ...entry, stableId: entry.stableId || entry.id, selected: false, originallyActive: false })),
        settings,
        statsBefore,
        rememberedChoice: loadRememberedChoice(),
        previousChoice: loadPreviousChoice(),
        inactiveBookFilter: ALL_LOREBOOKS_FILTER,
    };

    initializeControls(template, state);
    renderTagFilterList(template, state);
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
    template.find('#lbgTagFilterMode').val(state.settings.tagFilter?.mode || 'or');

    populateInactiveBookFilter(template, state);
    populatePreferredInactiveBooks(template, state);

    template.find('#lbgSearch').on('input', () => {
        renderLists(template, state);
        updateStats(template, state);
    });

    template.find('#lbgSort').on('change', () => {
        state.settings.sortMode = template.find('#lbgSort').val();
        persistState(state);
        renderLists(template, state);
        updateStats(template, state);
    });

    template.find('#lbgShowInactive').on('change', () => {
        state.settings.showInactiveEntries = Boolean(template.find('#lbgShowInactive').prop('checked'));
        persistState(state);
        renderLists(template, state);
        updateStats(template, state);
    });

    template.find('#lbgTagFilterMode').on('change', () => {
        state.settings.tagFilter.mode = template.find('#lbgTagFilterMode').val() === 'and' ? 'and' : 'or';
        persistState(state);
        renderLists(template, state);
        updateStats(template, state);
    });

    template.find('#lbgClearTagFilter').on('click', () => {
        state.settings.tagFilter.selectedTags = [];
        persistState(state);
        renderTagFilterList(template, state);
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
        persistState(state);
        populatePreferredInactiveBooks(template, state);
        renderLists(template, state);
        updateStats(template, state);
    });

    template.find('#lbgClearPreferredBooks').on('click', () => {
        state.settings.preferredInactiveBookNames = [];
        persistState(state);
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
            persistState(state);
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

function renderTagFilterList(template, state) {
    const container = template.find('#lbgTagFilterList');
    const availableTags = getAllAvailableTags(state.settings);
    const selectedTags = new Set(state.settings.tagFilter?.selectedTags || []);

    container.empty();

    if (!availableTags.length) {
        container.append(createNoticeElement('No tags available.'));
        return;
    }

    for (const tag of availableTags) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `lbg-filter-tag ${selectedTags.has(tag.name) ? 'is-selected' : ''}`;
        button.style.setProperty('--tag-color', tag.color);
        button.textContent = tag.label;
        button.title = tag.type === 'standard' ? 'Standard tag' : 'Custom tag';

        button.addEventListener('click', () => {
            const next = new Set(state.settings.tagFilter.selectedTags || []);
            if (next.has(tag.name)) next.delete(tag.name);
            else next.add(tag.name);

            state.settings.tagFilter.selectedTags = [...next];
            persistState(state);
            renderTagFilterList(template, state);
            renderLists(template, state);
            updateStats(template, state);
        });

        container.append(button);
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

    const activeEntries = filterAndSortEntries(state.activeEntries, query, sortMode, state);
    const inactiveCandidates = filterEntries(state.inactiveEntries, query, state);
    const inactiveEntries = sortInactiveEntries(
        filterInactiveEntriesByBook(filterEntriesByTags(inactiveCandidates, state), state.inactiveBookFilter),
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
        container.append(createEntryElement(entry, state, template, () => {
            entry.selected = !entry.selected;
            renderLists(template, state);
            updateStats(template, state);
        }));
    }
}

function createEntryElement(entry, state, template, onToggle) {
    const element = document.createElement('div');
    element.className = `lbg-entry ${entry.selected ? 'lbg-entry-selected' : 'lbg-entry-disabled'} ${isFavorite(state.settings, entry) ? 'lbg-entry-favorite' : ''}`;

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

    const entryActions = document.createElement('div');
    entryActions.className = 'lbg-entry-actions';

    const tokenBadge = document.createElement('span');
    tokenBadge.className = 'lbg-token-badge';
    tokenBadge.textContent = `${entry.tokens || 0} tokens`;

    const favoriteButton = document.createElement('button');
    favoriteButton.type = 'button';
    favoriteButton.className = `lbg-favorite-button ${isFavorite(state.settings, entry) ? 'is-favorite' : ''}`;
    favoriteButton.textContent = isFavorite(state.settings, entry) ? '★' : '☆';
    favoriteButton.title = isFavorite(state.settings, entry) ? 'Remove from favorites' : 'Add to favorites';
    favoriteButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleFavorite(state.settings, entry);
        persistState(state);
        renderLists(template, state);
        updateStats(template, state);
    });

    entryActions.appendChild(tokenBadge);
    entryActions.appendChild(favoriteButton);

    top.appendChild(label);
    top.appendChild(entryActions);

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

    const tags = createTagsElement(entry, state, template);

    const preview = document.createElement('pre');
    preview.className = 'lbg-preview';
    preview.textContent = shorten(entry.content, 500);

    element.appendChild(top);
    element.appendChild(meta);
    element.appendChild(tags);
    element.appendChild(preview);

    return element;
}

function createTagsElement(entry, state, template) {
    const wrapper = document.createElement('div');
    wrapper.className = 'lbg-entry-tags';

    const tags = getEntryTags(state.settings, entry);
    for (const tagName of tags) {
        wrapper.appendChild(createTagChip(tagName, entry, state, template));
    }

    const addArea = document.createElement('div');
    addArea.className = 'lbg-add-tag-area';

    const select = document.createElement('select');
    select.className = 'text_pole lbg-tag-select';
    select.appendChild(createOption('', '+ standard tag'));

    for (const tag of getAllAvailableTags(state.settings)) {
        const option = createOption(tag.name, tag.label);
        option.disabled = tags.includes(tag.name);
        select.appendChild(option);
    }

    select.addEventListener('change', () => {
        const tagName = normalizeTagName(select.value);
        if (!tagName) return;

        addEntryTag(state.settings, entry, tagName);
        persistState(state);
        renderTagFilterList(template, state);
        renderLists(template, state);
        updateStats(template, state);
    });

    const input = document.createElement('input');
    input.className = 'text_pole lbg-custom-tag-input';
    input.type = 'text';
    input.placeholder = 'Custom tag...';
    input.maxLength = 40;

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'menu_button lbg-add-tag-button';
    addButton.textContent = 'Add';

    const addCustomTag = () => {
        const tagName = normalizeTagName(input.value);
        if (!tagName) return;

        addEntryTag(state.settings, entry, tagName);
        input.value = '';
        persistState(state);
        renderTagFilterList(template, state);
        renderLists(template, state);
        updateStats(template, state);
    };

    addButton.addEventListener('click', addCustomTag);
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addCustomTag();
        }
    });

    addArea.appendChild(select);
    addArea.appendChild(input);
    addArea.appendChild(addButton);
    wrapper.appendChild(addArea);

    return wrapper;
}

function createTagChip(tagName, entry, state, template) {
    const color = getTagColor(state.settings, tagName);
    const chip = document.createElement('span');
    chip.className = 'lbg-tag';
    chip.style.setProperty('--tag-color', color);

    const dot = document.createElement('span');
    dot.className = 'lbg-tag-dot';

    const label = document.createElement('span');
    label.className = 'lbg-tag-label';
    label.textContent = formatTagLabel(tagName);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'lbg-tag-remove';
    removeButton.textContent = '×';
    removeButton.title = 'Remove tag';
    removeButton.addEventListener('click', () => {
        removeEntryTag(state.settings, entry, tagName);
        persistState(state);
        renderTagFilterList(template, state);
        renderLists(template, state);
        updateStats(template, state);
    });

    chip.appendChild(dot);
    chip.appendChild(label);
    chip.appendChild(removeButton);

    return chip;
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

function filterAndSortEntries(entries, query, sortMode, state) {
    return sortEntries(filterEntriesByTags(filterEntries(entries, query, state), state), sortMode, state);
}

function filterEntries(entries, query, state) {
    if (!query) return [...entries];

    return entries.filter((entry) => {
        const tagText = getEntryTags(state.settings, entry).join(' ');
        const haystack = [entry.title, entry.bookName, entry.content, tagText, ...(entry.keys || []), ...(entry.secondaryKeys || [])]
            .join(' ')
            .toLowerCase();

        return haystack.includes(query);
    });
}

function filterEntriesByTags(entries, state) {
    const selectedTags = toStringArray(state.settings.tagFilter?.selectedTags).map(normalizeTagName).filter(Boolean);
    if (!selectedTags.length) return entries;

    const mode = state.settings.tagFilter?.mode === 'and' ? 'and' : 'or';

    return entries.filter((entry) => {
        const entryTags = getEntryTags(state.settings, entry);
        if (mode === 'and') return selectedTags.every((tag) => entryTags.includes(tag));
        return selectedTags.some((tag) => entryTags.includes(tag));
    });
}

function sortInactiveEntries(entries, sortMode, state) {
    const preferred = new Set(toStringArray(state.settings.preferredInactiveBookNames));
    const sorted = sortEntries(entries, sortMode, state);

    return sorted.sort((a, b) => {
        const favoriteA = isFavorite(state.settings, a) ? 0 : 1;
        const favoriteB = isFavorite(state.settings, b) ? 0 : 1;
        if (favoriteA !== favoriteB) return favoriteA - favoriteB;

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

function sortEntries(entries, sortMode, state) {
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

    return result.sort((a, b) => {
        const favoriteA = isFavorite(state.settings, a) ? 0 : 1;
        const favoriteB = isFavorite(state.settings, b) ? 0 : 1;
        return favoriteA - favoriteB;
    });
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

function persistState(state) {
    ensureEntryMetaSettings(state.settings);
    saveSettings(state.settings);
}

function toStringArray(value) {
    return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}
