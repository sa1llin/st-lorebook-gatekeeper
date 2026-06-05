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
    deleteTagGlobally,
    ensureEntryMetaSettings,
    formatTagLabel,
    getAllAvailableTags,
    getEntryTags,
    getTagColor,
    getTagUsageCounts,
    isBlocked,
    isFavorite,
    isLocked,
    normalizeTagName,
    removeEntryTag,
    toggleBlocked,
    toggleFavorite,
    toggleLocked,
} from './entryMetaStore.js';
import {
    injectManualEntriesIntoChat,
    injectManualEntriesIntoTextPrompt,
    removeEntriesFromChat,
    removeEntriesFromTextPrompt,
    replaceEditedEntriesInChat,
    replaceEditedEntriesInTextPrompt,
} from './promptPatcher.js';
import {
    createProfileFromEntries,
    deleteProfile,
    loadProfiles,
    replaceProfileSelection,
    upsertProfile,
} from './profileMemory.js';

export async function showLorebookReviewPopup({ activeEntries, inactiveEntries, statsBefore, settings, promptPreview = null }) {
    ensureEntryMetaSettings(settings);

    const template = $(await renderExtensionTemplateAsync(EXTENSION_PATH, 'popup'));
    const state = {
        activeEntries: activeEntries.map((entry) => createStateEntry(entry, true, true, settings)),
        inactiveEntries: inactiveEntries.map((entry) => createStateEntry(entry, false, false, settings)),
        settings,
        statsBefore,
        rememberedChoice: loadRememberedChoice(),
        previousChoice: loadPreviousChoice(),
        profiles: loadProfiles(),
        inactiveBookFilter: ALL_LOREBOOKS_FILTER,
        compareRememberedVisible: false,
        promptPreview,
        promptPreviewVariant: 'before',
        promptPreviewFormat: 'pretty',
    };

    enforceEntryRules(state);
    initializeControls(template, state);
    renderTagFilterList(template, state);
    renderTagManagerList(template, state);
    renderProfiles(template, state);
    renderLists(template, state);
    updateStats(template, state);
    updatePromptPreview(template, state);

    const cancelGenerationButton = {
        text: 'Cancel generation',
        result: CANCEL_GENERATION_RESULT,
        appendAtEnd: true,
    };

    const popupResult = await showReviewDialog(template, cancelGenerationButton);

    if (popupResult === CANCEL_GENERATION_RESULT) return { action: 'cancel', disabledEntries: [], manualEntries: [] };
    if (!popupResult) return buildPersistentRuleResult(state);

    state.previousChoice = savePreviousChoiceFromState(state);

    if (Boolean(template.find('#lbgRememberChoice').prop('checked'))) {
        state.rememberedChoice = saveRememberedChoiceFromState(state);
    }

    return buildConfirmedResult(state);
}

function buildConfirmedResult(state) {
    enforceEntryRules(state);

    const selectedActiveEntries = state.activeEntries.filter((entry) => entry.selected);
    const disabledEntries = state.activeEntries.filter((entry) => !entry.selected);
    const manualEntries = state.inactiveEntries.filter((entry) => entry.selected);

    return { action: 'confirm', selectedActiveEntries, disabledEntries, manualEntries };
}

function buildPersistentRuleResult(state) {
    const selectedActiveEntries = state.activeEntries.filter((entry) => !isBlocked(state.settings, entry));
    const disabledEntries = state.activeEntries.filter((entry) => isBlocked(state.settings, entry));
    const manualEntries = state.inactiveEntries.filter((entry) => isLocked(state.settings, entry) && !isBlocked(state.settings, entry));

    if (!disabledEntries.length && !manualEntries.length) {
        return { action: 'discard', disabledEntries: [], manualEntries: [], selectedActiveEntries: [] };
    }

    return { action: 'confirm', selectedActiveEntries, disabledEntries, manualEntries };
}

function createStateEntry(entry, selected, originallyActive, settings) {
    const content = String(entry?.content || '');
    const stableId = String(entry?.stableId || entry?.id || `${entry?.bookName || 'book'}::${entry?.title || 'entry'}`);
    const stateEntry = {
        ...entry,
        id: String(entry?.id || stableId),
        stableId,
        originalContent: content,
        content,
        selected,
        originallyActive,
        matchedKeywords: toStringArray(entry.matchedKeywords),
        selectionSource: entry.selectionSource || '',
    };

    applyEntryRule(stateEntry, settings);
    return stateEntry;
}

function enforceEntryRules(state) {
    for (const entry of [...state.activeEntries, ...state.inactiveEntries]) {
        applyEntryRule(entry, state.settings);
    }
}

function applyEntryRule(entry, settings) {
    if (isBlocked(settings, entry)) {
        entry.selected = false;
        return;
    }

    if (isLocked(settings, entry)) {
        entry.selected = true;
    }
}

function getEntryPromptContent(entry) {
    if (Object.prototype.hasOwnProperty.call(entry, 'temporaryContent')) {
        return String(entry.temporaryContent || '');
    }

    return String(entry.content || '');
}

function hasTemporaryEdit(entry) {
    if (!Object.prototype.hasOwnProperty.call(entry, 'temporaryContent')) return false;
    return String(entry.temporaryContent || '') !== String(entry.originalContent ?? entry.content ?? '');
}

function setTemporaryEdit(entry, content) {
    const nextContent = String(content || '');
    const originalContent = String(entry.originalContent ?? entry.content ?? '');

    if (nextContent === originalContent) {
        delete entry.temporaryContent;
    } else {
        entry.temporaryContent = nextContent;
    }
}

function clearTemporaryEdit(entry) {
    delete entry.temporaryContent;
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
    template.find('#lbgViewMode').val(state.settings.compactView ? 'compact' : 'detailed');
    template.find('#lbgShowInactive').prop('checked', Boolean(state.settings.showInactiveEntries));
    template.find('#lbgTagFilterMode').val(state.settings.tagFilter?.mode || 'or');
    populateInactiveBookFilter(template, state);
    populatePreferredInactiveBooks(template, state);

    template.find('.lbg-tab-button').on('click', (event) => {
        const tab = String($(event.currentTarget).attr('data-lbg-tab') || 'entries');
        template.find('.lbg-tab-button').removeClass('is-active');
        template.find('.lbg-tab-panel').removeClass('is-active');
        template.find(`.lbg-tab-button[data-lbg-tab="${escapeSelectorValue(tab)}"]`).addClass('is-active');
        template.find(`.lbg-tab-panel[data-lbg-panel="${escapeSelectorValue(tab)}"]`).addClass('is-active');
        if (tab === 'prompt') updatePromptPreview(template, state);
        if (tab === 'profiles') renderProfiles(template, state);
    });

    template.find('#lbgSearch').on('input', () => refreshEntryViews(template, state));

    template.find('#lbgSort').on('change', () => {
        state.settings.sortMode = template.find('#lbgSort').val();
        persistState(state);
        refreshEntryViews(template, state);
    });

    template.find('#lbgViewMode').on('change', () => {
        state.settings.compactView = template.find('#lbgViewMode').val() === 'compact';
        persistState(state);
        refreshEntryViews(template, state);
    });

    template.find('#lbgShowInactive').on('change', () => {
        state.settings.showInactiveEntries = Boolean(template.find('#lbgShowInactive').prop('checked'));
        persistState(state);
        refreshEntryViews(template, state);
    });

    template.find('#lbgTagFilterMode').on('change', () => {
        state.settings.tagFilter.mode = template.find('#lbgTagFilterMode').val() === 'and' ? 'and' : 'or';
        persistState(state);
        refreshEntryViews(template, state);
    });

    template.find('#lbgClearTagFilter').on('click', () => {
        state.settings.tagFilter.selectedTags = [];
        persistState(state);
        renderTagFilterList(template, state);
        renderTagManagerList(template, state);
        refreshEntryViews(template, state);
    });

    template.find('#lbgOpenTagManager').on('click', () => {
        const manager = template.find('#lbgTagManager');
        manager.prop('open', !Boolean(manager.prop('open')));
        renderTagManagerList(template, state);
    });

    template.on('click', '.lbg-menu-button', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const menu = $(event.currentTarget).closest('.lbg-entry-actions').find('.lbg-entry-menu');
        const isOpen = menu.hasClass('is-open');

        template.find('.lbg-entry-menu').removeClass('is-open');
        template.find('.lbg-menu-button').attr('aria-expanded', 'false');

        if (!isOpen) {
            menu.addClass('is-open');
            $(event.currentTarget).attr('aria-expanded', 'true');
        }
    });

    template.on('click', '.lbg-entry-menu', (event) => {
        event.stopPropagation();
    });

    $(document).off('click.lbgEntryMenu').on('click.lbgEntryMenu', () => {
        template.find('.lbg-entry-menu').removeClass('is-open');
        template.find('.lbg-menu-button').attr('aria-expanded', 'false');
    });

    template.find('#lbgInactiveBookFilter').on('change', () => {
        state.inactiveBookFilter = String(template.find('#lbgInactiveBookFilter').val() || ALL_LOREBOOKS_FILTER);
        refreshEntryViews(template, state);
    });

    template.find('#lbgUseLinkedBooksFirst').on('click', () => {
        state.settings.preferredInactiveBookNames = getLinkedBookNames(state.inactiveEntries);
        persistState(state);
        populatePreferredInactiveBooks(template, state);
        refreshEntryViews(template, state);
    });

    template.find('#lbgClearPreferredBooks').on('click', () => {
        state.settings.preferredInactiveBookNames = [];
        persistState(state);
        populatePreferredInactiveBooks(template, state);
        refreshEntryViews(template, state);
    });

    template.find('#lbgApplyRememberedChoice').on('click', () => {
        state.rememberedChoice = loadRememberedChoice();
        if (!state.rememberedChoice) {
            toastr.info('Lorebook Gatekeeper: no remembered choice to apply.');
            updateChoiceInfo(template, state);
            return;
        }

        applyRememberedChoiceToState(state, state.rememberedChoice);
        markChoiceAppliedToState(state, state.rememberedChoice, 'remembered');
        enforceEntryRules(state);
        refreshAllViews(template, state);
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
        markChoiceAppliedToState(state, state.previousChoice, 'previous');
        enforceEntryRules(state);
        refreshAllViews(template, state);
        toastr.success('Lorebook Gatekeeper: previous request choice applied.');
    });

    template.find('#lbgCompareRememberedChoice').on('click', () => {
        state.rememberedChoice = loadRememberedChoice();
        if (!state.rememberedChoice) {
            state.compareRememberedVisible = false;
            toastr.info('Lorebook Gatekeeper: no remembered choice to compare.');
        } else {
            state.compareRememberedVisible = !state.compareRememberedVisible;
        }
        updateChoiceInfo(template, state);
    });

    template.find('#lbgClearRememberedChoice').on('click', () => {
        clearRememberedChoice();
        state.rememberedChoice = null;
        state.compareRememberedVisible = false;
        updateChoiceInfo(template, state);
        toastr.info('Lorebook Gatekeeper: remembered choice cleared.');
    });

    template.find('#lbgDisableAllActive').on('click', () => {
        state.activeEntries.forEach((entry) => {
            if (!isLocked(state.settings, entry) && !isBlocked(state.settings, entry)) {
                entry.selected = false;
                delete entry.selectionSource;
            }
        });
        enforceEntryRules(state);
        refreshAllViews(template, state);
    });

    template.find('#lbgEnableAllActive').on('click', () => {
        state.activeEntries.forEach((entry) => {
            entry.selected = !isBlocked(state.settings, entry);
            delete entry.selectionSource;
        });
        enforceEntryRules(state);
        refreshAllViews(template, state);
    });

    template.find('#lbgSaveProfile').on('click', () => {
        saveCurrentSelectionAsProfile(template, state);
    });

    template.find('#lbgProfileName').on('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            saveCurrentSelectionAsProfile(template, state);
        }
    });

    template.find('#lbgProfilesList').on('click', '[data-lbg-profile-action]', (event) => {
        const button = event.currentTarget;
        const action = String(button.getAttribute('data-lbg-profile-action') || '');
        const profileId = String(button.getAttribute('data-lbg-profile-id') || '');
        const profile = state.profiles.find((item) => item.id === profileId);
        if (!profile) return;

        if (action === 'apply') {
            applyProfileToState(profile, state);
            refreshAllViews(template, state);
            toastr.success(`Lorebook Gatekeeper: profile "${profile.name}" applied.`);
        }

        if (action === 'replace') {
            const confirmed = window.confirm(`Replace saved profile "${profile.name}" with the current selection?`);
            if (!confirmed) return;
            state.profiles = replaceProfileSelection(profile.id, getAllEntries(state));
            renderProfiles(template, state);
            toastr.success('Lorebook Gatekeeper: profile updated.');
        }

        if (action === 'delete') {
            const confirmed = window.confirm(`Delete saved profile "${profile.name}"?`);
            if (!confirmed) return;
            state.profiles = deleteProfile(profile.id);
            renderProfiles(template, state);
            toastr.info('Lorebook Gatekeeper: profile deleted.');
        }
    });

    template.find('#lbgPromptPreviewVariant').on('change', () => {
        state.promptPreviewVariant = String(template.find('#lbgPromptPreviewVariant').val() || 'before');
        updatePromptPreview(template, state);
    });

    template.find('#lbgPromptPreviewFormat').on('change', () => {
        state.promptPreviewFormat = String(template.find('#lbgPromptPreviewFormat').val() || 'pretty');
        updatePromptPreview(template, state);
    });

    template.find('#lbgRefreshPromptPreview').on('click', () => updatePromptPreview(template, state));
    template.find('#lbgCopyPromptPreview').on('click', async () => {
        const text = String(template.find('#lbgPromptPreviewOutput').text() || '');
        if (!text) return;

        try {
            await navigator.clipboard.writeText(text);
            toastr.success('Lorebook Gatekeeper: prompt preview copied.');
        } catch (_) {
            window.prompt('Copy prompt preview:', text);
        }
    });

    updateChoiceInfo(template, state);
}

function refreshEntryViews(template, state) {
    renderLists(template, state);
    updateStats(template, state);
    updatePromptPreview(template, state);
}

function refreshAllViews(template, state) {
    updateChoiceInfo(template, state);
    renderLists(template, state);
    updateStats(template, state);
    renderProfiles(template, state);
    updatePromptPreview(template, state);
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
            refreshEntryViews(template, state);
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
    template.find('#lbgSelectedTagCount').text(`${selectedTags.size} selected`);

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
            renderTagManagerList(template, state);
            refreshEntryViews(template, state);
        });

        container.append(button);
    }
}

function renderTagManagerList(template, state) {
    const container = template.find('#lbgTagManagerList');
    if (!container.length) return;

    const tags = getAllAvailableTags(state.settings);
    const usageCounts = getTagUsageCounts(state.settings);
    container.empty();

    if (!tags.length) {
        container.append(createNoticeElement('No tags available.'));
        return;
    }

    for (const tag of tags) {
        const row = document.createElement('div');
        row.className = 'lbg-tag-manager-row';

        const chip = createStaticTagChip(tag.name, state.settings);
        chip.classList.add('lbg-tag-manager-chip');

        const meta = document.createElement('span');
        meta.className = 'lbg-tag-manager-meta';
        meta.textContent = `${tag.type} • ${usageCounts[tag.name] || 0} use${usageCounts[tag.name] === 1 ? '' : 's'}`;

        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'menu_button lbg-small-button lbg-tag-delete-button';
        action.textContent = tag.type === 'standard' ? 'Clear from entries' : 'Delete';
        action.disabled = tag.type === 'standard' && !usageCounts[tag.name];
        action.title = tag.type === 'standard'
            ? 'Remove this standard tag from all entries. The standard tag itself stays available.'
            : 'Delete this custom tag and remove it from all entries.';
        action.addEventListener('click', () => {
            const confirmed = window.confirm(
                tag.type === 'standard'
                    ? `Remove the standard tag "${tag.label}" from all entries?`
                    : `Delete the custom tag "${tag.label}" everywhere?`,
            );
            if (!confirmed) return;

            deleteTagGlobally(state.settings, tag.name);
            persistState(state);
            renderTagFilterList(template, state);
            renderTagManagerList(template, state);
            refreshEntryViews(template, state);
        });

        row.appendChild(chip);
        row.appendChild(meta);
        row.appendChild(action);
        container.append(row);
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
    template.find('#lbgCompareRememberedChoice').prop('disabled', !state.rememberedChoice);
    template.find('#lbgClearRememberedChoice').prop('disabled', !state.rememberedChoice);
    template.find('#lbgApplyPreviousChoice').prop('disabled', !state.previousChoice);

    const compare = template.find('#lbgRememberedCompareInfo');
    if (!state.compareRememberedVisible || !state.rememberedChoice) {
        compare.prop('hidden', true).empty();
        return;
    }

    compare.prop('hidden', false).empty().append(createRememberedCompareElement(state));
}

function markChoiceAppliedToState(state, choice, source) {
    const selectedIds = new Set([
        ...toStringArray(choice?.selectedActiveIds),
        ...toStringArray(choice?.manualEntryIds),
    ]);

    for (const entry of [...state.activeEntries, ...state.inactiveEntries]) {
        if (selectedIds.has(entry.id) && entry.selected) {
            entry.selectionSource = source;
        } else if (entry.selectionSource === source) {
            delete entry.selectionSource;
        }
    }
}

function updateSelectionSourceAfterUserToggle(entry) {
    if (!entry.selected) {
        delete entry.selectionSource;
        return;
    }

    if (!entry.originallyActive) {
        entry.selectionSource = 'manual';
        return;
    }

    delete entry.selectionSource;
}

function createRememberedCompareElement(state) {
    const wrapper = document.createElement('div');
    wrapper.className = 'lbg-compare-box';

    const currentIds = getCurrentSelectedEntryIds(state);
    const rememberedIds = new Set([
        ...toStringArray(state.rememberedChoice?.selectedActiveIds),
        ...toStringArray(state.rememberedChoice?.manualEntryIds),
    ]);

    const added = [...currentIds].filter((id) => !rememberedIds.has(id));
    const removed = [...rememberedIds].filter((id) => !currentIds.has(id));

    wrapper.appendChild(createCompareSection('Added', added, state));
    wrapper.appendChild(createCompareSection('Removed', removed, state));

    if (!added.length && !removed.length) {
        const same = document.createElement('div');
        same.className = 'lbg-compare-same';
        same.textContent = 'Current selection is identical to remembered choice.';
        wrapper.appendChild(same);
    }

    return wrapper;
}

function getCurrentSelectedEntryIds(state) {
    return new Set(getAllEntries(state).filter((entry) => entry.selected).map((entry) => entry.id));
}

function createCompareSection(title, ids, state) {
    const section = document.createElement('div');
    section.className = 'lbg-compare-section';

    const heading = document.createElement('strong');
    heading.textContent = `${title}:`;
    section.appendChild(heading);

    if (!ids.length) {
        const empty = document.createElement('div');
        empty.className = 'lbg-compare-empty';
        empty.textContent = 'None';
        section.appendChild(empty);
        return section;
    }

    const list = document.createElement('ul');
    list.className = 'lbg-compare-list';

    for (const id of ids) {
        const item = document.createElement('li');
        item.textContent = formatEntryNameForCompare(findEntryById(state, id), id);
        list.appendChild(item);
    }

    section.appendChild(list);
    return section;
}

function findEntryById(state, id) {
    return getAllEntries(state).find((entry) => entry.id === id) || null;
}

function formatEntryNameForCompare(entry, id) {
    if (!entry) return `Unknown entry (${id})`;
    const bookName = entry.bookName ? ` — ${entry.bookName}` : '';
    return `${entry.title || id}${bookName}`;
}

function getActivationReasonText(entry) {
    if (entry.selectionSource === 'profile') return 'Saved profile';
    if (entry.selectionSource === 'remembered') return 'Remembered choice';
    if (entry.selectionSource === 'previous') return 'Previous request choice';
    if (entry.selectionSource === 'manual' || (!entry.originallyActive && entry.selected)) return 'Manually added';

    const matchedKeywords = toStringArray(entry.matchedKeywords);
    if (entry.originallyActive && matchedKeywords.length) {
        return `Triggered by keyword: "${matchedKeywords[0]}"`;
    }

    if (entry.originallyActive) {
        switch (entry.sourceType) {
            case 'character': return 'Triggered by character link';
            case 'global': return 'Triggered by global lorebook';
            case 'chat': return 'Triggered by chat-linked lorebook';
            case 'persona': return 'Triggered by persona link';
            default: return 'Triggered by prompt match';
        }
    }

    return 'Not triggered';
}

function getKeywordMatchedText(entry) {
    const matchedKeywords = toStringArray(entry.matchedKeywords);
    if (!matchedKeywords.length) return '';
    if (matchedKeywords.length === 1) return `Keyword matched: ${matchedKeywords[0]}`;
    return `Keywords matched: ${matchedKeywords.join(', ')}`;
}

function appendHighlightedPreview(container, text, keywords) {
    const value = String(text || '');
    const highlights = toStringArray(keywords)
        .map((keyword) => String(keyword || '').trim())
        .filter((keyword) => keyword.length >= 2)
        .sort((a, b) => b.length - a.length);

    if (!highlights.length) {
        container.textContent = value;
        return;
    }

    const pattern = new RegExp(`(${highlights.map(escapeRegExp).join('|')})`, 'gi');
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(value)) !== null) {
        if (match.index > lastIndex) {
            container.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
        }

        const mark = document.createElement('mark');
        mark.className = 'lbg-keyword-highlight';
        mark.textContent = match[0];
        container.appendChild(mark);
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < value.length) {
        container.appendChild(document.createTextNode(value.slice(lastIndex)));
    }
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
            if (isBlocked(state.settings, entry)) {
                entry.selected = false;
                delete entry.selectionSource;
            } else if (isLocked(state.settings, entry)) {
                entry.selected = true;
            } else {
                entry.selected = !entry.selected;
                updateSelectionSourceAfterUserToggle(entry);
            }

            enforceEntryRules(state);
            refreshAllViews(template, state);
        }));
    }
}

function createEntryElement(entry, state, template, onToggle) {
    const locked = isLocked(state.settings, entry);
    const blocked = isBlocked(state.settings, entry);
    const favorite = isFavorite(state.settings, entry);
    const edited = hasTemporaryEdit(entry);
    const compactView = Boolean(state.settings.compactView);

    const element = document.createElement('div');
    element.className = [
        'lbg-entry',
        compactView ? 'lbg-entry-compact-view' : 'lbg-entry-detailed-view',
        entry.selected ? 'lbg-entry-selected' : 'lbg-entry-disabled',
        favorite ? 'lbg-entry-favorite' : '',
        locked ? 'lbg-entry-locked' : '',
        blocked ? 'lbg-entry-blocked' : '',
        edited ? 'lbg-entry-edited' : '',
    ].filter(Boolean).join(' ');
    element.dataset.lbgEntryId = entry.id;

    const top = document.createElement('div');
    top.className = 'lbg-entry-top';

    const label = document.createElement('label');
    label.className = 'lbg-toggle-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(entry.selected);
    checkbox.disabled = locked || blocked;
    checkbox.title = blocked ? 'Never include is enabled for this entry.' : locked ? 'Locked entries stay selected until unlocked.' : 'Include this entry in the prompt.';
    checkbox.addEventListener('change', onToggle);

    const title = document.createElement('span');
    title.className = 'lbg-entry-title';
    title.textContent = entry.title || 'Untitled entry';

    label.appendChild(checkbox);
    label.appendChild(title);

    const entryActions = document.createElement('div');
    entryActions.className = 'lbg-entry-actions';

    const favoriteButton = document.createElement('button');
    favoriteButton.type = 'button';
    favoriteButton.className = `lbg-icon-button lbg-favorite-button ${favorite ? 'is-favorite' : ''}`;
    favoriteButton.textContent = favorite ? '★' : '☆';
    favoriteButton.title = favorite ? 'Remove from favorites' : 'Add to favorites';
    favoriteButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleFavorite(state.settings, entry);
        persistState(state);
        refreshEntryViews(template, state);
    });

    if (compactView) {
        entryActions.appendChild(favoriteButton);
    } else {
        const lockButton = document.createElement('button');
        lockButton.type = 'button';
        lockButton.className = `lbg-icon-button lbg-lock-button ${locked ? 'is-locked' : ''}`;
        lockButton.textContent = locked ? '🔒' : '🔓';
        lockButton.title = locked ? 'Unlock entry' : 'Lock entry: always include in prompt';
        lockButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleLocked(state.settings, entry);
            enforceEntryRules(state);
            persistState(state);
            refreshAllViews(template, state);
        });

        const blockButton = document.createElement('button');
        blockButton.type = 'button';
        blockButton.className = `lbg-icon-button lbg-block-button ${blocked ? 'is-blocked' : ''}`;
        blockButton.textContent = '⊘';
        blockButton.title = blocked ? 'Allow this entry again' : 'Never include this entry';
        blockButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleBlocked(state.settings, entry);
            enforceEntryRules(state);
            persistState(state);
            refreshAllViews(template, state);
        });

        const menuButton = document.createElement('button');
        menuButton.type = 'button';
        menuButton.className = 'lbg-icon-button lbg-menu-button';
        menuButton.textContent = '⋯';
        menuButton.title = 'Entry actions';
        menuButton.setAttribute('aria-haspopup', 'true');
        menuButton.setAttribute('aria-expanded', 'false');

        const menu = createEntryMenu(entry, state, template);

        entryActions.appendChild(lockButton);
        entryActions.appendChild(blockButton);
        entryActions.appendChild(favoriteButton);
        entryActions.appendChild(menuButton);
        entryActions.appendChild(menu);
    }

    top.appendChild(label);
    top.appendChild(entryActions);

    const meta = document.createElement('div');
    meta.className = 'lbg-entry-meta';

    const tokenBadge = document.createElement('span');
    tokenBadge.className = 'lbg-token-badge';
    tokenBadge.textContent = `${entry.tokens || 0} tokens`;

    const bookBadge = document.createElement('span');
    bookBadge.className = 'lbg-book-badge';
    bookBadge.textContent = entry.bookName || 'Unknown book';

    meta.appendChild(tokenBadge);
    meta.appendChild(bookBadge);

    if (!compactView) {
        const sourceBadge = document.createElement('span');
        sourceBadge.className = 'lbg-source-badge';
        sourceBadge.textContent = getSourceLabel(entry.sourceType) || 'external';

        const matchBadge = document.createElement('span');
        matchBadge.className = 'lbg-match-badge';
        matchBadge.textContent = entry.originallyActive ? `match: ${entry.matchType || 'prompt'}` : 'manual candidate';

        meta.appendChild(sourceBadge);
        meta.appendChild(matchBadge);
        if (locked) meta.appendChild(createStatusBadge('Locked', 'lbg-lock-badge'));
        if (blocked) meta.appendChild(createStatusBadge('Never include', 'lbg-block-badge'));
        if (edited) meta.appendChild(createStatusBadge('Edited for this prompt', 'lbg-edit-badge'));
    }

    const tags = createEntryTagRow(entry, state.settings);

    element.appendChild(top);
    element.appendChild(meta);
    if (tags.childElementCount) element.appendChild(tags);
    if (compactView) return element;

    const reason = document.createElement('div');
    reason.className = 'lbg-activation-reason';
    reason.textContent = getActivationReasonText(entry);
    element.appendChild(reason);

    const keywordText = getKeywordMatchedText(entry);
    if (keywordText) {
        const keyword = document.createElement('div');
        keyword.className = 'lbg-keyword-match';
        keyword.textContent = keywordText;
        element.appendChild(keyword);
    }

    const keys = document.createElement('div');
    keys.className = 'lbg-keys';
    keys.textContent = buildKeysText(entry);

    const preview = document.createElement('pre');
    preview.className = 'lbg-preview';
    appendHighlightedPreview(preview, shorten(getEntryPromptContent(entry), 500), entry.matchedKeywords);

    if (edited) {
        const editHint = document.createElement('div');
        editHint.className = 'lbg-edit-hint';
        editHint.textContent = 'Temporary prompt version is shown below. Original Lorebook entry is unchanged.';
        element.appendChild(editHint);
    }

    element.appendChild(keys);
    element.appendChild(preview);

    return element;
}

function createEntryMenu(entry, state, template) {
    const menu = document.createElement('div');
    menu.className = 'lbg-entry-menu';

    const currentTags = getEntryTags(state.settings, entry);
    const standardTags = getAllAvailableTags(state.settings).filter((tag) => tag.type === 'standard');

    const editAction = document.createElement('button');
    editAction.type = 'button';
    editAction.className = 'lbg-menu-action';
    editAction.textContent = 'Edit for this prompt';
    editAction.title = 'Temporarily replace this entry content for the current generation. The original lorebook entry is not edited.';
    editAction.addEventListener('click', async () => {
        template.find('.lbg-entry-menu').removeClass('is-open');
        const result = await showTemporaryEditDialog(entry);
        if (!result) return;

        if (result.action === 'reset') {
            clearTemporaryEdit(entry);
        } else if (result.action === 'save') {
            setTemporaryEdit(entry, result.content);
        }

        refreshAllViews(template, state);
    });
    menu.appendChild(editAction);

    if (hasTemporaryEdit(entry)) {
        const resetEditAction = document.createElement('button');
        resetEditAction.type = 'button';
        resetEditAction.className = 'lbg-menu-action';
        resetEditAction.textContent = 'Reset temporary edit';
        resetEditAction.addEventListener('click', () => {
            clearTemporaryEdit(entry);
            refreshAllViews(template, state);
        });
        menu.appendChild(resetEditAction);
    }

    const favoriteAction = document.createElement('button');
    favoriteAction.type = 'button';
    favoriteAction.className = 'lbg-menu-action';
    favoriteAction.textContent = isFavorite(state.settings, entry) ? 'Remove from favorites' : 'Add to favorites';
    favoriteAction.addEventListener('click', () => {
        toggleFavorite(state.settings, entry);
        persistState(state);
        refreshEntryViews(template, state);
    });
    menu.appendChild(favoriteAction);

    menu.appendChild(createMenuSectionTitle('Standard tags'));
    const standardGrid = document.createElement('div');
    standardGrid.className = 'lbg-menu-tag-grid';
    for (const tag of standardTags) {
        const tagButton = createMenuTagButton(tag, state.settings, currentTags.includes(tag.name));
        tagButton.addEventListener('click', () => {
            addEntryTag(state.settings, entry, tag.name);
            refreshTagDependentViews(template, state);
        });
        standardGrid.appendChild(tagButton);
    }
    menu.appendChild(standardGrid);

    menu.appendChild(createMenuSectionTitle('Custom tag'));
    const customRow = document.createElement('div');
    customRow.className = 'lbg-menu-custom-row';

    const input = document.createElement('input');
    input.className = 'text_pole lbg-menu-custom-input';
    input.type = 'text';
    input.placeholder = 'Type custom tag...';
    input.maxLength = 40;

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'menu_button lbg-small-button';
    addButton.textContent = 'Add';

    const addCustomTag = () => {
        const tagName = normalizeTagName(input.value);
        if (!tagName) return;
        addEntryTag(state.settings, entry, tagName);
        input.value = '';
        refreshTagDependentViews(template, state);
    };

    addButton.addEventListener('click', addCustomTag);
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addCustomTag();
        }
    });

    customRow.appendChild(input);
    customRow.appendChild(addButton);
    menu.appendChild(customRow);

    if (currentTags.length) {
        menu.appendChild(createMenuSectionTitle('Remove from this entry'));
        const removeGrid = document.createElement('div');
        removeGrid.className = 'lbg-menu-tag-grid';
        for (const tagName of currentTags) {
            const tag = { name: tagName, label: formatTagLabel(tagName), color: getTagColor(state.settings, tagName) };
            const removeButton = createMenuTagButton(tag, state.settings, false, '× ');
            removeButton.addEventListener('click', () => {
                removeEntryTag(state.settings, entry, tagName);
                refreshTagDependentViews(template, state);
            });
            removeGrid.appendChild(removeButton);
        }
        menu.appendChild(removeGrid);

        const clearEntryTags = document.createElement('button');
        clearEntryTags.type = 'button';
        clearEntryTags.className = 'lbg-menu-action lbg-menu-danger';
        clearEntryTags.textContent = 'Clear all tags from this entry';
        clearEntryTags.addEventListener('click', () => {
            for (const tagName of currentTags) {
                removeEntryTag(state.settings, entry, tagName);
            }
            refreshTagDependentViews(template, state);
        });
        menu.appendChild(clearEntryTags);
    }

    const manageTags = document.createElement('button');
    manageTags.type = 'button';
    manageTags.className = 'lbg-menu-action';
    manageTags.textContent = 'Open tag manager';
    manageTags.addEventListener('click', () => {
        const manager = template.find('#lbgTagManager');
        manager.prop('open', true);
        renderTagManagerList(template, state);
        manager[0]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        template.find('.lbg-entry-menu').removeClass('is-open');
    });
    menu.appendChild(manageTags);

    return menu;
}

function showTemporaryEditDialog(entry) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'lbg-edit-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'lbg-edit-dialog';
        dialog.style.height = `${getSavedEditDialogHeight()}px`;

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'lbg-edit-resize-handle';
        resizeHandle.textContent = 'Drag to resize';

        const title = document.createElement('h3');
        title.textContent = 'Edit for this prompt';

        const subtitle = document.createElement('div');
        subtitle.className = 'lbg-edit-subtitle';
        subtitle.textContent = `${entry.bookName || 'Lorebook'} / ${entry.title || 'Entry'}`;

        const hint = document.createElement('div');
        hint.className = 'lbg-edit-hint';
        hint.textContent = 'Original lorebook entry remains untouched. This text is used only for the current prompt.';

        const textarea = document.createElement('textarea');
        textarea.className = 'text_pole lbg-edit-textarea';
        textarea.value = getEntryPromptContent(entry);

        const footer = document.createElement('div');
        footer.className = 'lbg-edit-footer';

        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'menu_button';
        reset.textContent = 'Reset to original';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'menu_button';
        cancel.textContent = 'Cancel';

        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'menu_button';
        save.textContent = 'Save for this prompt';

        footer.appendChild(reset);
        footer.appendChild(cancel);
        footer.appendChild(save);
        dialog.appendChild(resizeHandle);
        dialog.appendChild(title);
        dialog.appendChild(subtitle);
        dialog.appendChild(hint);
        dialog.appendChild(textarea);
        dialog.appendChild(footer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        document.body.classList.add('lbg-edit-open');
        textarea.focus();

        const cleanup = (result) => {
            document.body.classList.remove('lbg-edit-open');
            overlay.remove();
            resolve(result);
        };

        reset.addEventListener('click', () => cleanup({ action: 'reset' }));
        cancel.addEventListener('click', () => cleanup(null));
        save.addEventListener('click', () => cleanup({ action: 'save', content: textarea.value }));
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) cleanup(null);
        });

        installEditDialogResize(resizeHandle, dialog);
    });
}

function getSavedEditDialogHeight() {
    const minimum = Math.max(360, Math.round(window.innerHeight * 0.5));
    const maximum = Math.max(minimum, Math.round(window.innerHeight * 0.9));
    const saved = Number(localStorage.getItem('LorebookGatekeeper_editDialogHeight') || 0);
    return Math.min(maximum, Math.max(minimum, saved || minimum));
}

function installEditDialogResize(handle, dialog) {
    let startY = 0;
    let startHeight = 0;

    const onMove = (event) => {
        const y = event.touches?.[0]?.clientY ?? event.clientY;
        const delta = startY - y;
        const minimum = Math.max(320, Math.round(window.innerHeight * 0.5));
        const maximum = Math.max(minimum, Math.round(window.innerHeight * 0.92));
        const nextHeight = Math.min(maximum, Math.max(minimum, startHeight + delta));
        dialog.style.height = `${nextHeight}px`;
        localStorage.setItem('LorebookGatekeeper_editDialogHeight', String(nextHeight));
    };

    const onEnd = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onEnd);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
    };

    const onStart = (event) => {
        startY = event.touches?.[0]?.clientY ?? event.clientY;
        startHeight = dialog.getBoundingClientRect().height;
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
        event.preventDefault();
    };

    handle.addEventListener('mousedown', onStart);
    handle.addEventListener('touchstart', onStart, { passive: false });
}

function refreshTagDependentViews(template, state) {
    persistState(state);
    renderTagFilterList(template, state);
    renderTagManagerList(template, state);
    refreshEntryViews(template, state);
}

function createMenuSectionTitle(text) {
    const title = document.createElement('div');
    title.className = 'lbg-menu-section-title';
    title.textContent = text;
    return title;
}

function createMenuTagButton(tag, settings, selected, prefix = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lbg-menu-tag ${selected ? 'is-selected' : ''}`;
    button.style.setProperty('--tag-color', tag.color || getTagColor(settings, tag.name));
    button.textContent = `${prefix}${tag.label || formatTagLabel(tag.name)}`;
    return button;
}

function createEntryTagRow(entry, settings) {
    const row = document.createElement('div');
    row.className = 'lbg-entry-tags';

    for (const tagName of getEntryTags(settings, entry)) {
        row.appendChild(createStaticTagChip(tagName, settings));
    }

    return row;
}

function createStaticTagChip(tagName, settings) {
    const chip = document.createElement('span');
    chip.className = 'lbg-tag';
    chip.style.setProperty('--tag-color', getTagColor(settings, tagName));

    const dot = document.createElement('span');
    dot.className = 'lbg-tag-dot';

    const label = document.createElement('span');
    label.className = 'lbg-tag-label';
    label.textContent = formatTagLabel(tagName);

    chip.appendChild(dot);
    chip.appendChild(label);
    return chip;
}

function createStatusBadge(text, className) {
    const badge = document.createElement('span');
    badge.className = `lbg-status-badge ${className}`;
    badge.textContent = text;
    return badge;
}

function filterAndSortEntries(entries, query, sortMode, state) {
    return sortEntries(filterEntriesByTags(filterEntries(entries, query, state), state), sortMode, state);
}

function filterEntries(entries, query, state) {
    if (!query) return entries;

    return entries.filter((entry) => {
        const haystack = [
            entry.title,
            entry.bookName,
            entry.content,
            entry.keys?.join?.(' '),
            entry.keysecondary?.join?.(' '),
            getEntryTags(state.settings, entry).join(' '),
        ].map((value) => String(value || '').toLowerCase()).join('\n');
        return haystack.includes(query);
    });
}

function filterEntriesByTags(entries, state) {
    const selectedTags = toStringArray(state.settings.tagFilter?.selectedTags);
    if (!selectedTags.length) return entries;

    const mode = state.settings.tagFilter?.mode === 'and' ? 'and' : 'or';
    return entries.filter((entry) => {
        const entryTags = new Set(getEntryTags(state.settings, entry));
        if (mode === 'and') return selectedTags.every((tag) => entryTags.has(tag));
        return selectedTags.some((tag) => entryTags.has(tag));
    });
}

function sortEntries(entries, sortMode, state) {
    const copy = [...entries];
    copy.sort((a, b) => {
        const favoriteDelta = Number(isFavorite(state.settings, b)) - Number(isFavorite(state.settings, a));
        if (favoriteDelta) return favoriteDelta;

        if (sortMode === 'tokens_asc') return (a.tokens || 0) - (b.tokens || 0);
        if (sortMode === 'book') return String(a.bookName || '').localeCompare(String(b.bookName || '')) || String(a.title || '').localeCompare(String(b.title || ''));
        if (sortMode === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
        return (b.tokens || 0) - (a.tokens || 0);
    });
    return copy;
}

function sortInactiveEntries(entries, sortMode, state) {
    const preferred = new Set(toStringArray(state.settings.preferredInactiveBookNames));
    const sorted = sortEntries(entries, sortMode, state);
    sorted.sort((a, b) => Number(preferred.has(b.bookName)) - Number(preferred.has(a.bookName)));
    return sorted;
}

function updateStats(template, state) {
    const selectedActiveEntries = state.activeEntries.filter((entry) => entry.selected);
    const disabledEntries = state.activeEntries.filter((entry) => !entry.selected);
    const manualEntries = state.inactiveEntries.filter((entry) => entry.selected);

    const activeTokens = sumTokens(state.activeEntries);
    const selectedTokens = sumTokens(selectedActiveEntries) + sumTokens(manualEntries);
    const addedTokens = sumTokens(manualEntries);
    const savedTokens = sumTokens(disabledEntries);

    template.find('#lbgActiveCount').text(state.activeEntries.length);
    template.find('#lbgInactiveCount').text(state.inactiveEntries.length);
    template.find('#lbgBeforeTokens').text(activeTokens);
    template.find('#lbgSelectedTokens').text(selectedTokens);
    template.find('#lbgAddedTokens').text(addedTokens);
    template.find('#lbgSavedTokens').text(savedTokens);
}

function saveCurrentSelectionAsProfile(template, state) {
    const selectedCount = getAllEntries(state).filter((entry) => entry.selected).length;
    if (!selectedCount) {
        toastr.info('Lorebook Gatekeeper: select at least one entry before saving a profile.');
        return;
    }

    const nameInput = template.find('#lbgProfileName');
    const name = String(nameInput.val() || '').trim() || window.prompt('Profile name:', '') || '';
    if (!String(name).trim()) return;

    const profile = createProfileFromEntries(name, getAllEntries(state));
    state.profiles = upsertProfile(profile);
    nameInput.val('');
    renderProfiles(template, state);
    toastr.success(`Lorebook Gatekeeper: profile "${profile.name}" saved.`);
}

function renderProfiles(template, state) {
    const container = template.find('#lbgProfilesList');
    if (!container.length) return;

    state.profiles = loadProfiles();
    container.empty();

    if (!state.profiles.length) {
        container.append(createNoticeElement('No saved profiles yet. Save the current selection to create one.'));
        return;
    }

    for (const profile of state.profiles) {
        container.append(createProfileElement(profile, state));
    }
}

function createProfileElement(profile, state) {
    const card = document.createElement('div');
    card.className = 'lbg-profile-card';

    const currentIds = new Set(getAllEntries(state).map((entry) => entry.id));
    const selectedIds = toStringArray(profile.selectedEntryIds);
    const missingIds = selectedIds.filter((id) => !currentIds.has(id));

    const header = document.createElement('div');
    header.className = 'lbg-profile-card-header';

    const title = document.createElement('strong');
    title.textContent = profile.name;

    const count = document.createElement('span');
    count.className = 'lbg-profile-count';
    count.textContent = `${selectedIds.length} entries${missingIds.length ? ` • ${missingIds.length} missing` : ''}`;

    header.appendChild(title);
    header.appendChild(count);

    const meta = document.createElement('div');
    meta.className = 'lbg-profile-meta';
    meta.textContent = `Updated: ${formatProfileDate(profile.updatedAt)}`;

    const preview = document.createElement('div');
    preview.className = 'lbg-profile-preview';
    preview.textContent = profile.entries?.length
        ? profile.entries.slice(0, 8).map((entry) => `${entry.title}${entry.bookName ? ` — ${entry.bookName}` : ''}`).join('; ')
        : 'Saved entry IDs only.';

    const actions = document.createElement('div');
    actions.className = 'lbg-profile-actions';

    actions.appendChild(createProfileActionButton('Apply profile', 'apply', profile.id));
    actions.appendChild(createProfileActionButton('Replace with current', 'replace', profile.id));
    actions.appendChild(createProfileActionButton('Delete', 'delete', profile.id, 'lbg-profile-danger'));

    if (missingIds.length) {
        const missing = document.createElement('details');
        missing.className = 'lbg-profile-missing';
        const summary = document.createElement('summary');
        summary.textContent = 'Missing entries';
        const list = document.createElement('div');
        list.textContent = missingIds.join(', ');
        missing.appendChild(summary);
        missing.appendChild(list);
        card.appendChild(header);
        card.appendChild(meta);
        card.appendChild(preview);
        card.appendChild(missing);
        card.appendChild(actions);
        return card;
    }

    card.appendChild(header);
    card.appendChild(meta);
    card.appendChild(preview);
    card.appendChild(actions);
    return card;
}

function createProfileActionButton(text, action, profileId, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `menu_button lbg-profile-action ${extraClass}`.trim();
    button.textContent = text;
    button.setAttribute('data-lbg-profile-action', action);
    button.setAttribute('data-lbg-profile-id', profileId);
    return button;
}

function applyProfileToState(profile, state) {
    const selectedIds = new Set(toStringArray(profile.selectedEntryIds));

    for (const entry of getAllEntries(state)) {
        entry.selected = selectedIds.has(entry.id);
        if (entry.selected) entry.selectionSource = 'profile';
        else if (entry.selectionSource === 'profile') delete entry.selectionSource;
    }

    enforceEntryRules(state);
}

function updatePromptPreview(template, state) {
    const output = template.find('#lbgPromptPreviewOutput');
    const info = template.find('#lbgPromptPreviewInfo');

    if (!state.promptPreview) {
        info.text('Prompt preview is unavailable for this generation event.');
        output.text('');
        return;
    }

    const variant = state.promptPreviewVariant || 'before';
    const format = state.promptPreviewFormat || 'pretty';

    const value = variant === 'after' ? buildAfterPromptValue(state) : clonePromptValue(state.promptPreview.payload);
    const text = formatPromptValue(value, state.promptPreview.type, format);
    const line = state.promptPreview.type === 'chat'
        ? `${state.promptPreview.label || 'Chat payload'} • ${Array.isArray(value) ? value.length : 0} messages • ${variant}`
        : `${state.promptPreview.label || 'Text prompt'} • ${text.length} characters • ${variant}`;

    info.text(line);
    output.text(text);
}

function buildAfterPromptValue(state) {
    const result = buildConfirmedResult(state);

    if (state.promptPreview?.type === 'chat') {
        const chat = clonePromptValue(state.promptPreview.payload);
        if (!Array.isArray(chat)) return chat;
        removeEntriesFromChat(chat, result.disabledEntries);
        replaceEditedEntriesInChat(chat, result.selectedActiveEntries);
        injectManualEntriesIntoChat(chat, result.manualEntries);
        return chat;
    }

    if (state.promptPreview?.type === 'text') {
        let prompt = String(state.promptPreview.payload || '');
        prompt = removeEntriesFromTextPrompt(prompt, result.disabledEntries);
        prompt = replaceEditedEntriesInTextPrompt(prompt, result.selectedActiveEntries);
        prompt = injectManualEntriesIntoTextPrompt(prompt, result.manualEntries);
        return prompt;
    }

    return clonePromptValue(state.promptPreview?.payload);
}

function formatPromptValue(value, type, format) {
    if (type === 'chat') {
        try {
            return JSON.stringify(value, null, format === 'pretty' ? 2 : 0);
        } catch (_) {
            return String(value || '');
        }
    }

    if (typeof value === 'string') return value;

    try {
        return JSON.stringify(value, null, format === 'pretty' ? 2 : 0);
    } catch (_) {
        return String(value || '');
    }
}

function clonePromptValue(value) {
    try {
        if (typeof structuredClone === 'function') return structuredClone(value);
    } catch (_) {
        // Fallback below.
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return value;
    }
}

function getAllEntries(state) {
    return [...state.activeEntries, ...state.inactiveEntries];
}

function buildKeysText(entry) {
    const primary = toStringArray(entry.keys);
    const secondary = toStringArray(entry.keysecondary);
    const parts = [];
    if (primary.length) parts.push(`Keys: ${primary.join(', ')}`);
    if (secondary.length) parts.push(`Secondary: ${secondary.join(', ')}`);
    return parts.join(' • ') || 'No keys listed.';
}

function getSourcePriority(sourceType) {
    switch (sourceType) {
        case 'chat': return 0;
        case 'character': return 1;
        case 'persona': return 2;
        case 'global': return 3;
        default: return 10;
    }
}

function getSourceLabel(sourceType) {
    switch (sourceType) {
        case 'chat': return 'chat-linked';
        case 'character': return 'character-linked';
        case 'persona': return 'persona-linked';
        case 'global': return 'global';
        case 'manual': return 'manual';
        default: return sourceType || 'other';
    }
}

function createNoticeElement(text) {
    const notice = document.createElement('div');
    notice.className = 'lbg-notice';
    notice.textContent = text;
    return notice;
}

function shorten(text, maxLength) {
    const value = String(text || '');
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}…`;
}

function persistState(state) {
    saveSettings(state.settings);
}

function formatProfileDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'unknown';
    return date.toLocaleString();
}

function escapeSelectorValue(value) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
}

function toStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || '').trim()).filter(Boolean);
}
