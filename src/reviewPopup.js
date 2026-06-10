import { saveSettings } from './settings.js';
import { ALL_LOREBOOKS_FILTER, CANCEL_GENERATION_RESULT, MAX_RENDERED_ENTRIES } from './constants.js';
import { countTextTokens, sumTokens } from './tokenCounter.js';
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
    injectManualEntriesIntoTextPrompt,
    removeEntriesFromTextPrompt,
    replaceEditedEntriesInTextPrompt,
} from './promptPatcher.js';

const SCENARIOS_STORAGE_KEY = 'lorebookGatekeeperScenariosV1';
const DEFAULT_SCENARIO_DESCRIPTION = 'Saved selection preset.';

export async function showLorebookReviewPopup({ activeEntries, inactiveEntries, statsBefore, settings, promptText = '' }) {
    ensureEntryMetaSettings(settings);
    ensureUpgradeSettings(settings);

    return await new Promise((resolve) => {
        const state = {
            activeEntries: activeEntries.map((entry) => createStateEntry(entry, true, true, settings)),
            inactiveEntries: inactiveEntries.map((entry) => createStateEntry(entry, false, false, settings)),
            settings,
            statsBefore,
            promptText: String(promptText || ''),
            rememberedChoice: loadRememberedChoice(),
            previousChoice: loadPreviousChoice(),
            inactiveBookFilter: ALL_LOREBOOKS_FILTER,
            compareRememberedVisible: false,
            activeTab: 'entries',
            dirtyTabs: new Set(),
            selectedManagerTags: new Set(),
            rememberChoice: false,
            root: null,
            resolve,
            searchQuery: '',
            lbgSearchFocus: null
        };

        enforceEntryRules(state);
        openReviewOverlay(state);
    });
}

function ensureUpgradeSettings(settings) {
    if (!Array.isArray(settings.tagOrder)) settings.tagOrder = [];
    if (!settings.scenarioUi || typeof settings.scenarioUi !== 'object') settings.scenarioUi = {};
    lbgEnsureAdvancedFeatureSettings(settings);
}

function createStateEntry(entry, selected, originallyActive, settings) {
    const content = String(entry?.content || '');
    const stateEntry = {
        ...entry,
        stableId: entry.stableId || entry.id,
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
    for (const entry of allEntries(state)) applyEntryRule(entry, state.settings);
}

function applyEntryRule(entry, settings) {
    if (isBlocked(settings, entry)) {
        entry.selected = false;
        return;
    }
    if (isLocked(settings, entry)) entry.selected = true;
}

function openReviewOverlay(state) {
    closeExistingOverlay();

    const overlay = el('div', 'lbg-mobile-overlay lbg-desktop-overlay');
    const panel = el('div', 'lbg-mobile-panel lbg-desktop-panel');
    const body = el('div', 'lbg-mobile-body lbg-desktop-body');
    const footer = el('div', 'lbg-mobile-footer lbg-sticky-footer');

    state.root = body;

    panel.appendChild(body);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.body.classList.add('lbg-mobile-open');

    renderRoot(state);
    renderFooter(state, footer, overlay);
}

function closeExistingOverlay() {
    document.querySelectorAll('.lbg-mobile-overlay').forEach((node) => node.remove());
    document.body.classList.remove('lbg-mobile-open');
}

function cleanupOverlay(overlay) {
    document.body.classList.remove('lbg-mobile-open');
    overlay.remove();
}

function renderFooter(state, footer, overlay) {
    footer.innerHTML = '';

    const cancelGeneration = button('Cancel generation', 'lbg-footer-button lbg-footer-danger');
    const sendWithoutChanges = button('Send without changes', 'lbg-footer-button lbg-footer-secondary');
    const confirm = button('Confirm changes', 'lbg-footer-button lbg-footer-primary');

    cancelGeneration.addEventListener('click', () => {
        cleanupOverlay(overlay);
        state.resolve({ action: 'cancel', disabledEntries: [], manualEntries: [], selectedActiveEntries: [] });
    }, { once: true });

    sendWithoutChanges.addEventListener('click', () => {
        cleanupOverlay(overlay);
        state.resolve(buildPersistentRuleResult(state));
    }, { once: true });

    confirm.addEventListener('click', () => {
        state.previousChoice = savePreviousChoiceFromState(state);
        if (state.rememberChoice) {
            state.rememberedChoice = saveRememberedChoiceFromState(state);
        }
        saveSettings(state.settings);
        cleanupOverlay(overlay);
        state.resolve(buildConfirmedResult(state));
    }, { once: true });

    footer.append(cancelGeneration, sendWithoutChanges, confirm);
}

function buildConfirmedResult(state) {
    enforceEntryRules(state);
    const selectedActiveEntries = state.activeEntries.filter((entry) => entry.selected);
    const disabledEntries = state.activeEntries.filter((entry) => !entry.selected);
    const manualEntries = state.inactiveEntries.filter((entry) => entry.selected);

    return { action: 'confirm', selectedActiveEntries, disabledEntries, manualEntries };
}

function buildPersistentRuleResult(state) {
    const shouldForceDisable = (entry) => lbgIsUnlinkedConstantActiveEntry(entry) && !isLocked(state.settings, entry);
    const selectedActiveEntries = state.activeEntries.filter((entry) => !isBlocked(state.settings, entry) && !shouldForceDisable(entry));
    const disabledEntries = state.activeEntries.filter((entry) => isBlocked(state.settings, entry) || shouldForceDisable(entry));
    const manualEntries = state.inactiveEntries.filter((entry) => isLocked(state.settings, entry) && !isBlocked(state.settings, entry));

    if (!disabledEntries.length && !manualEntries.length) {
        return { action: 'discard', disabledEntries: [], manualEntries: [], selectedActiveEntries: [] };
    }

    return { action: 'confirm', selectedActiveEntries, disabledEntries, manualEntries };
}

function renderRoot(state) {
    const root = state.root;
    if (!root) return;
    root.innerHTML = '';

    const shell = el('div', 'lbg-root lbg-upgraded-root');
    shell.appendChild(renderHeader(state));
    shell.appendChild(renderTabs(state));

    const content = el('div', 'lbg-tab-content');
    if (state.activeTab === 'entries') content.appendChild(renderEntriesTab(state));
    if (state.activeTab === 'preview') content.appendChild(renderPreviewTab(state));
    if (state.activeTab === 'scenarios') content.appendChild(renderScenariosTab(state));

    shell.appendChild(content);
    root.appendChild(shell);

    lbgApplyUiCustomization(state);
    lbgRestoreSearchFocus(state);
}

function renderHeader(state) {
    const header = el('div', 'lbg-header lbg-panel-block lbg-header-upgraded');
    const titleBlock = el('div', 'lbg-title-block');
    const title = el('h3');
    title.textContent = 'Lorebook Gatekeeper';
    const subtitle = el('div', 'lbg-subtitle');
    subtitle.textContent = 'Review activated Lorebook / World Info entries before sending the prompt.';
    titleBlock.append(title, subtitle);

    header.append(titleBlock, renderStats(state));
    return header;
}

function renderStats(state) {
    const stats = calculateStats(state);
    const wrapper = el('div', 'lbg-stats lbg-stats-grid');

    wrapper.append(
        statCard('Activated', stats.activeCount, 'entries', 'lbg-stat-neutral'),
        statCard('Before', stats.beforeTokens, 'tokens', 'lbg-stat-muted'),
        statCard('Selected', stats.selectedTokens, 'tokens', 'lbg-stat-bright'),
        statCard('Added', stats.addedTokens, 'tokens', 'lbg-stat-neutral'),
        statCard('Saved', stats.savedTokens, 'tokens', stats.savedTokens > 0 ? 'lbg-stat-good' : stats.savedTokens < 0 ? 'lbg-stat-bad' : 'lbg-stat-neutral'),
    );

    return wrapper;
}

function statCard(label, value, suffix, className) {
    const card = el('div', `lbg-stat-card ${className}`);
    const labelNode = el('span', 'lbg-stat-label');
    labelNode.textContent = label;
    const valueNode = el('strong', 'lbg-stat-value');
    valueNode.textContent = String(value);
    const suffixNode = el('span', 'lbg-stat-suffix');
    suffixNode.textContent = suffix;
    card.append(labelNode, valueNode, suffixNode);
    return card;
}

function calculateStats(state) {
    const selectedActive = state.activeEntries.filter((entry) => entry.selected);
    const selectedManual = state.inactiveEntries.filter((entry) => entry.selected);
    const selectedTokens = sumTokens([...selectedActive, ...selectedManual]);
    const addedTokens = sumTokens(selectedManual);
    const beforeTokens = Number(state.statsBefore?.activeTokens || sumTokens(state.activeEntries));

    return {
        activeCount: state.activeEntries.length,
        inactiveCount: state.inactiveEntries.length,
        beforeTokens,
        selectedTokens,
        addedTokens,
        savedTokens: beforeTokens - selectedTokens,
    };
}

function renderTabs(state) {
    const tabs = el('div', 'lbg-tabs lbg-panel-block');
    tabs.append(
        tabButton(state, 'entries', 'Entries'),
        tabButton(state, 'preview', 'Preview'),
        tabButton(state, 'scenarios', 'Scenarios'),
    );
    return tabs;
}

function tabButton(state, tabName, text) {
    const item = button(text, `lbg-tab-button ${state.activeTab === tabName ? 'is-active' : ''}`);
    if (state.dirtyTabs.has(tabName)) {
        const badge = el('span', 'lbg-dirty-badge');
        badge.textContent = '•';
        badge.title = 'There are unsaved changes';
        item.appendChild(badge);
    }
    item.addEventListener('click', () => {
        state.activeTab = tabName;
        renderRoot(state);
    });
    return item;
}

function renderEntriesTab(state) {
    lbgEnsureAdvancedFeatureSettings(state.settings);

    const fragment = document.createDocumentFragment();
    const builders = {
        search: () => renderSearchPanel(state),
        tags: () => renderTagFilterPanel(state),
        controls: () => renderControlPanel(state),
        memory: () => renderMemoryPanel(state),
        active: () => renderEntriesSection(state, true),
        inactive: () => renderEntriesSection(state, false),
    };

    for (const key of lbgGetLayoutOrder(state.settings)) {
        const build = builders[key];
        if (!build) continue;
        const node = build();
        fragment.appendChild(lbgMakeLayoutDraggable(node, key, state));
    }

    return fragment;
}

function renderSearchPanel(state) {
    lbgEnsureAdvancedFeatureSettings(state.settings);

    const panel = el('div', 'lbg-toolbar lbg-panel-block lbg-search-panel');

    const search = el('input', 'text_pole');
    search.id = 'lbgSearch';
    search.type = 'search';
    search.placeholder = 'Search entries by scope selection...';
    search.value = state.searchQuery || '';
    search.addEventListener('input', () => {
        state.searchQuery = search.value;
        lbgRenderRootKeepingSearchFocus(state, search);
    });

    const sort = el('select', 'text_pole');
    sort.innerHTML = `
        <option value="tokens_desc">Tokens: high to low</option>
        <option value="tokens_asc">Tokens: low to high</option>
        <option value="book">Book name</option>
        <option value="title">Entry title</option>
    `;
    sort.value = state.settings.sortMode || 'tokens_desc';
    sort.addEventListener('change', () => {
        state.settings.sortMode = sort.value;
        persistState(state);
        renderRoot(state);
    });

    const view = el('select', 'text_pole lbg-view-mode-select');
    view.innerHTML = `
        <option value="detailed">Detailed View</option>
        <option value="compact">Compact View</option>
    `;
    view.value = state.settings.compactView ? 'compact' : 'detailed';
    view.addEventListener('change', () => {
        state.settings.compactView = view.value === 'compact';
        persistState(state);
        renderRoot(state);
    });

    const firstRow = el('div', 'lbg-search-row');
    firstRow.append(search, sort, view, lbgRenderGroupFilter(state));

    panel.append(
        firstRow,
        lbgRenderSearchScopeControls(state),
        lbgRenderUiCustomizationPanel(state)
    );

    return panel;
}

function renderTagFilterPanel(state) {
    const panel = el('div', 'lbg-tag-filter-panel lbg-panel-block');
    const header = el('div', 'lbg-filter-header');
    const title = el('div', 'lbg-filter-title');
    const selectedTags = new Set(state.settings.tagFilter?.selectedTags || []);
    title.innerHTML = `<strong>Tags</strong> <span class="lbg-muted">${selectedTags.size} selected</span>`;

    const actions = el('div', 'lbg-filter-actions');
    const mode = el('select', 'text_pole lbg-compact-select');
    mode.innerHTML = '<option value="or">OR</option><option value="and">AND</option>';
    mode.value = state.settings.tagFilter?.mode || 'or';
    mode.addEventListener('change', () => {
        state.settings.tagFilter.mode = mode.value === 'and' ? 'and' : 'or';
        persistState(state);
        renderRoot(state);
    });

    const clear = button('Clear', 'lbg-small-button');
    clear.addEventListener('click', () => {
        state.settings.tagFilter.selectedTags = [];
        persistState(state);
        renderRoot(state);
    });

    actions.append(mode, clear);
    header.append(title, actions);

    const selectedRow = el('div', 'lbg-selected-tag-list');
    for (const tagName of orderedTags(state).filter((tag) => selectedTags.has(tag.name)).map((tag) => tag.name)) {
        selectedRow.appendChild(createSelectedTagChip(state, tagName));
    }

    const filterList = el('div', 'lbg-tag-filter-list');
    for (const tag of orderedTags(state)) {
        const tagButton = button(tag.label, `lbg-filter-tag ${selectedTags.has(tag.name) ? 'is-selected' : ''}`);
        tagButton.style.setProperty('--tag-color', pastelizeColor(tag.color));
        tagButton.title = tag.type === 'standard' ? 'Standard tag' : 'Custom tag';
        tagButton.addEventListener('click', () => {
            const next = new Set(state.settings.tagFilter.selectedTags || []);
            if (next.has(tag.name)) next.delete(tag.name);
            else next.add(tag.name);
            state.settings.tagFilter.selectedTags = [...next];
            markDirty(state, 'entries');
            persistState(state);
            renderRoot(state);
        });
        filterList.appendChild(tagButton);
    }

    panel.append(header);
    if (selectedRow.childElementCount) panel.appendChild(selectedRow);
    panel.append(filterList, renderTagManager(state));
    return panel;
}

function createSelectedTagChip(state, tagName) {
    const chip = el('span', 'lbg-tag lbg-selected-tag');
    chip.style.setProperty('--tag-color', pastelizeColor(getTagColor(state.settings, tagName)));
    const dot = el('span', 'lbg-tag-dot');
    const label = el('span', 'lbg-tag-label');
    label.textContent = formatTagLabel(tagName);
    const remove = button('×', 'lbg-tag-remove');
    remove.title = 'Remove from selected filters';
    remove.addEventListener('click', () => {
        state.settings.tagFilter.selectedTags = toStringArray(state.settings.tagFilter.selectedTags).filter((tag) => tag !== tagName);
        persistState(state);
        renderRoot(state);
    });
    chip.append(dot, label, remove);
    return chip;
}

function renderTagManager(state) {
    const details = el('details', 'lbg-tag-manager-panel');
    const summary = el('summary');
    summary.textContent = 'Tag manager';
    details.appendChild(summary);

    const body = el('div', 'lbg-tag-manager-body');
    const hint = el('div', 'lbg-tag-manager-hint');
    hint.textContent = 'Select tags, clear them from entries, delete custom tags, or drag rows to change visual order.';

    const layout = el('div', 'lbg-tag-manager-layout');
    const list = el('div', 'lbg-tag-manager-list');
    const usageCounts = getTagUsageCounts(state.settings);

    for (const tag of orderedTags(state)) {
        const row = el('div', 'lbg-tag-manager-row');
        row.draggable = true;
        row.dataset.tagName = tag.name;
        row.addEventListener('dragstart', (event) => {
            event.dataTransfer?.setData('text/plain', tag.name);
            row.classList.add('is-dragging');
        });
        row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
        row.addEventListener('dragover', (event) => event.preventDefault());
        row.addEventListener('drop', (event) => {
            event.preventDefault();
            const sourceName = event.dataTransfer?.getData('text/plain');
            if (!sourceName || sourceName === tag.name) return;
            reorderTags(state, sourceName, tag.name);
            markDirty(state, 'entries');
            persistState(state);
            renderRoot(state);
        });

        const check = el('input');
        check.type = 'checkbox';
        check.checked = state.selectedManagerTags.has(tag.name);
        check.addEventListener('change', () => {
            if (check.checked) state.selectedManagerTags.add(tag.name);
            else state.selectedManagerTags.delete(tag.name);
            renderRoot(state);
        });

        const chip = createStaticTagChip(tag.name, state.settings);
        chip.classList.add('lbg-tag-manager-chip');

        const meta = el('span', 'lbg-tag-manager-meta');
        meta.textContent = `${tag.type} • ${usageCounts[tag.name] || 0} use${usageCounts[tag.name] === 1 ? '' : 's'}`;

        row.append(check, chip, meta);
        list.appendChild(row);
    }

    const actionPanel = el('div', 'lbg-tag-manager-actions-panel');
    const selectedCount = el('div', 'lbg-muted');
    selectedCount.textContent = `${state.selectedManagerTags.size} selected`;

    const selectAll = button('Select all', 'lbg-small-button');
    selectAll.addEventListener('click', () => {
        for (const tag of orderedTags(state)) state.selectedManagerTags.add(tag.name);
        renderRoot(state);
    });

    const clearSelection = button('Clear selection', 'lbg-small-button');
    clearSelection.addEventListener('click', () => {
        state.selectedManagerTags.clear();
        renderRoot(state);
    });

    const clearFromEntries = button('Clear selected from entries', 'lbg-small-button');
    clearFromEntries.disabled = state.selectedManagerTags.size === 0;
    clearFromEntries.addEventListener('click', () => {
        if (!state.selectedManagerTags.size) return;
        if (!window.confirm('Remove selected tags from all entries?')) return;
        for (const tagName of state.selectedManagerTags) deleteTagGlobally(state.settings, tagName);
        state.selectedManagerTags.clear();
        markDirty(state, 'entries');
        persistState(state);
        renderRoot(state);
    });

    const deleteCustom = button('Delete custom selected', 'lbg-small-button lbg-menu-danger');
    deleteCustom.disabled = ![...state.selectedManagerTags].some((tagName) => isCustomTag(state, tagName));
    deleteCustom.addEventListener('click', () => {
        const customTags = [...state.selectedManagerTags].filter((tagName) => isCustomTag(state, tagName));
        if (!customTags.length) return;
        if (!window.confirm(`Delete ${customTags.length} custom tag(s) everywhere?`)) return;
        for (const tagName of customTags) deleteTagGlobally(state.settings, tagName);
        state.selectedManagerTags.clear();
        markDirty(state, 'entries');
        persistState(state);
        renderRoot(state);
    });

    actionPanel.append(selectedCount, selectAll, clearSelection, clearFromEntries, deleteCustom);
    layout.append(list, actionPanel);
    body.append(hint, layout);
    details.appendChild(body);
    return details;
}

function isCustomTag(state, tagName) {
    const tag = orderedTags(state).find((item) => item.name === tagName);
    return tag?.type === 'custom';
}

function reorderTags(state, sourceName, targetName) {
    const names = orderedTags(state).map((tag) => tag.name);
    const from = names.indexOf(sourceName);
    const to = names.indexOf(targetName);
    if (from === -1 || to === -1) return;
    names.splice(to, 0, names.splice(from, 1)[0]);
    state.settings.tagOrder = names;
}

function orderedTags(state) {
    const tags = getAllAvailableTags(state.settings);
    const order = Array.isArray(state.settings.tagOrder) ? state.settings.tagOrder : [];
    const index = new Map(order.map((name, position) => [name, position]));

    return [...tags].sort((a, b) => {
        const ai = index.has(a.name) ? index.get(a.name) : Number.MAX_SAFE_INTEGER;
        const bi = index.has(b.name) ? index.get(b.name) : Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        if (a.type !== b.type) return a.type === 'standard' ? -1 : 1;
        return a.label.localeCompare(b.label);
    });
}

function renderControlPanel(state) {
    const panel = el('div', 'lbg-actions lbg-panel-block');
    const showInactiveLabel = el('label', 'lbg-inline-check');
    const showInactive = el('input');
    showInactive.type = 'checkbox';
    showInactive.checked = Boolean(state.settings.showInactiveEntries);
    showInactive.addEventListener('change', () => {
        state.settings.showInactiveEntries = showInactive.checked;
        persistState(state);
        renderRoot(state);
    });
    showInactiveLabel.append(showInactive, text('Show inactive entries for manual selection'));

    const actions = el('div', 'lbg-action-buttons');
    const enableAll = button('Enable all active', '');
    enableAll.addEventListener('click', () => {
        state.activeEntries.forEach((entry) => {
            entry.selected = !isBlocked(state.settings, entry);
            delete entry.selectionSource;
        });
        enforceEntryRules(state);
        markDirty(state, 'entries');
        renderRoot(state);
    });

    const disableAll = button('Deselect all active', '');
    disableAll.addEventListener('click', () => {
        state.activeEntries.forEach((entry) => {
            if (!isLocked(state.settings, entry) && !isBlocked(state.settings, entry)) {
                entry.selected = false;
                delete entry.selectionSource;
            }
        });
        enforceEntryRules(state);
        markDirty(state, 'entries');
        renderRoot(state);
    });

    actions.append(enableAll, disableAll);
    panel.append(showInactiveLabel, actions);
    return panel;
}

function renderMemoryPanel(state) {
    const panel = el('div', 'lbg-memory-panel lbg-panel-block');
    const remember = el('label', 'lbg-inline-check');
    const checkbox = el('input');
    checkbox.id = 'lbgRememberChoice';
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(state.rememberChoice);
    checkbox.addEventListener('change', () => {
        state.rememberChoice = checkbox.checked;
    });
    remember.append(checkbox, text('Remember my choice after confirmation'));

    const actions = el('div', 'lbg-memory-actions');
    const applyRemembered = button('Apply remembered choice', '');
    applyRemembered.disabled = !state.rememberedChoice;
    applyRemembered.addEventListener('click', () => {
        state.rememberedChoice = loadRememberedChoice();
        if (!state.rememberedChoice) {
            toastr.info('Lorebook Gatekeeper: no remembered choice to apply.');
            renderRoot(state);
            return;
        }
        applyRememberedChoiceToState(state, state.rememberedChoice);
        markChoiceAppliedToState(state, state.rememberedChoice, 'remembered');
        enforceEntryRules(state);
        markDirty(state, 'entries');
        toastr.success('Lorebook Gatekeeper: remembered choice applied.');
        renderRoot(state);
    });

    const compare = button('Compare with remembered', '');
    compare.disabled = !state.rememberedChoice;
    compare.addEventListener('click', () => {
        state.rememberedChoice = loadRememberedChoice();
        if (!state.rememberedChoice) {
            state.compareRememberedVisible = false;
            toastr.info('Lorebook Gatekeeper: no remembered choice to compare.');
        } else {
            state.compareRememberedVisible = !state.compareRememberedVisible;
        }
        renderRoot(state);
    });

    const applyPrevious = button('Apply previous request choice', '');
    applyPrevious.disabled = !state.previousChoice;
    applyPrevious.addEventListener('click', () => {
        state.previousChoice = loadPreviousChoice();
        if (!state.previousChoice) {
            toastr.info('Lorebook Gatekeeper: no previous request choice to apply.');
            renderRoot(state);
            return;
        }
        applyPreviousChoiceToState(state, state.previousChoice);
        markChoiceAppliedToState(state, state.previousChoice, 'previous');
        enforceEntryRules(state);
        markDirty(state, 'entries');
        toastr.success('Lorebook Gatekeeper: previous request choice applied.');
        renderRoot(state);
    });

    const clear = button('Clear remembered choice', '');
    clear.disabled = !state.rememberedChoice;
    clear.addEventListener('click', () => {
        clearRememberedChoice();
        state.rememberedChoice = null;
        state.compareRememberedVisible = false;
        toastr.info('Lorebook Gatekeeper: remembered choice cleared.');
        renderRoot(state);
    });

    actions.append(applyRemembered, compare, applyPrevious, clear);

    const rememberedInfo = el('div', 'lbg-memory-info');
    rememberedInfo.textContent = formatRememberedChoiceInfo(state.rememberedChoice);
    const previousInfo = el('div', 'lbg-memory-info');
    previousInfo.textContent = formatPreviousChoiceInfo(state.previousChoice);

    panel.append(remember, actions, rememberedInfo);
    if (state.compareRememberedVisible && state.rememberedChoice) panel.appendChild(createRememberedCompareElement(state));
    panel.appendChild(previousInfo);
    return panel;
}

function markChoiceAppliedToState(state, choice, source) {
    const selectedIds = new Set([
        ...toStringArray(choice?.selectedActiveIds),
        ...toStringArray(choice?.manualEntryIds),
    ]);

    for (const entry of allEntries(state)) {
        if (selectedIds.has(entry.id) && entry.selected) entry.selectionSource = source;
        else if (entry.selectionSource === source) delete entry.selectionSource;
    }
}

function createRememberedCompareElement(state) {
    const wrapper = el('div', 'lbg-compare-box');
    const currentIds = getCurrentSelectedEntryIds(state);
    const rememberedIds = new Set([
        ...toStringArray(state.rememberedChoice?.selectedActiveIds),
        ...toStringArray(state.rememberedChoice?.manualEntryIds),
    ]);
    const added = [...currentIds].filter((id) => !rememberedIds.has(id));
    const removed = [...rememberedIds].filter((id) => !currentIds.has(id));

    wrapper.append(createCompareSection('Added', added, state), createCompareSection('Removed', removed, state));
    if (!added.length && !removed.length) {
        const same = el('div', 'lbg-compare-same');
        same.textContent = 'Current selection is identical to remembered choice.';
        wrapper.appendChild(same);
    }

    return wrapper;
}

function createCompareSection(title, ids, state) {
    const section = el('div', 'lbg-compare-section');
    const heading = el('strong');
    heading.textContent = `${title}:`;
    section.appendChild(heading);

    if (!ids.length) {
        const empty = el('div', 'lbg-compare-empty');
        empty.textContent = 'None';
        section.appendChild(empty);
        return section;
    }

    const list = el('ul', 'lbg-compare-list');
    for (const id of ids) {
        const item = el('li');
        item.textContent = formatEntryNameForCompare(findEntryById(state, id), id);
        list.appendChild(item);
    }
    section.appendChild(list);
    return section;
}

function getCurrentSelectedEntryIds(state) {
    return new Set(allEntries(state).filter((entry) => entry.selected).map((entry) => entry.id));
}

function findEntryById(state, id) {
    return allEntries(state).find((entry) => entry.id === id) || null;
}

function formatEntryNameForCompare(entry, id) {
    if (!entry) return `Unknown entry (${id})`;
    const bookName = entry.bookName ? ` — ${entry.bookName}` : '';
    return `${entry.title || id}${bookName}`;
}

function renderEntriesSection(state, active) {
    const section = el('div', 'lbg-panel-block lbg-entry-section');
    const header = el('div', 'lbg-section-header');
    const title = el('h4');
    title.textContent = active ? 'Activated entries' : 'Inactive entries';
    const count = el('span');

    let entries = active ? getVisibleActiveEntries(state) : getVisibleInactiveEntries(state);
    count.innerHTML = `<strong>${entries.length}</strong> visible`;
    header.append(title, count);
    section.appendChild(header);

    if (!active) {
        section.id = 'lbgInactiveSection';
        section.hidden = !state.settings.showInactiveEntries;
        section.appendChild(renderInactiveControls(state));
        if (!state.settings.showInactiveEntries) return section;
    }

    const list = el('div', 'lbg-list');
    const renderedEntries = active ? entries : entries.slice(0, MAX_RENDERED_ENTRIES);
    if (!renderedEntries.length) list.appendChild(createNoticeElement('No entries found matching filters.'));
    else renderedEntries.forEach((entry) => list.appendChild(createEntryElement(entry, state)));

    if (!active && entries.length > MAX_RENDERED_ENTRIES) {
        list.appendChild(createNoticeElement(`Showing ${MAX_RENDERED_ENTRIES} of ${entries.length} inactive entries. Use search to narrow the list.`));
    }

    section.appendChild(list);
    return section;
}

function renderInactiveControls(state) {
    const wrapper = el('div', 'lbg-inactive-controls');

    const filterRow = el('div', 'lbg-book-filter-row');
    const label = el('label');
    label.textContent = 'Show inactive entries from lorebook:';
    const select = el('select', 'text_pole');
    select.appendChild(createOption(ALL_LOREBOOKS_FILTER, 'All lorebooks'));
    for (const info of getBookInfos(state.inactiveEntries)) {
        select.appendChild(createOption(info.bookName, `${info.bookName}${info.sourceLabel ? ` (${info.sourceLabel})` : ''}`));
    }
    select.value = state.inactiveBookFilter || ALL_LOREBOOKS_FILTER;
    select.addEventListener('change', () => {
        state.inactiveBookFilter = select.value || ALL_LOREBOOKS_FILTER;
        renderRoot(state);
    });
    filterRow.append(label, select);

    const priority = el('div', 'lbg-priority-panel');
    const priorityHeader = el('div', 'lbg-priority-header');
    const priorityText = el('div');
    priorityText.innerHTML = '<strong>Prioritize inactive lorebooks</strong><div class="lbg-priority-hint">Selected lorebooks stay visible together with all others, but their inactive entries are shown first.</div>';
    const actions = el('div', 'lbg-priority-actions');
    const linked = button('Use linked/global first', '');
    linked.addEventListener('click', () => {
        state.settings.preferredInactiveBookNames = getLinkedBookNames(state.inactiveEntries);
        persistState(state);
        renderRoot(state);
    });
    const clear = button('Clear priority', '');
    clear.addEventListener('click', () => {
        state.settings.preferredInactiveBookNames = [];
        persistState(state);
        renderRoot(state);
    });
    actions.append(linked, clear);
    priorityHeader.append(priorityText, actions);
    priority.append(priorityHeader, renderPreferredBookChoices(state));

    wrapper.append(filterRow, priority);
    return wrapper;
}

function renderPreferredBookChoices(state) {
    const container = el('div', 'lbg-book-choice-list');
    const bookInfos = getBookInfos(state.inactiveEntries);
    const availableBookNames = new Set(bookInfos.map((info) => info.bookName));
    const preferred = new Set(toStringArray(state.settings.preferredInactiveBookNames).filter((bookName) => availableBookNames.has(bookName)));
    state.settings.preferredInactiveBookNames = [...preferred];

    if (!bookInfos.length) {
        container.appendChild(createNoticeElement('No inactive lorebooks found.'));
        return container;
    }

    for (const info of bookInfos) {
        const label = el('label', 'lbg-book-choice');
        const checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.checked = preferred.has(info.bookName);
        checkbox.addEventListener('change', () => {
            const next = new Set(toStringArray(state.settings.preferredInactiveBookNames));
            if (checkbox.checked) next.add(info.bookName);
            else next.delete(info.bookName);
            state.settings.preferredInactiveBookNames = [...next].filter((bookName) => availableBookNames.has(bookName));
            persistState(state);
            renderRoot(state);
        });
        label.append(checkbox, text(`${info.bookName}${info.sourceLabel ? ` (${info.sourceLabel})` : ''}`));
        container.appendChild(label);
    }

    return container;
}

function createEntryElement(entry, state) {
    const locked = isLocked(state.settings, entry);
    const blocked = isBlocked(state.settings, entry);
    const favorite = isFavorite(state.settings, entry);
    const edited = hasTemporaryEdit(entry);
    const compactView = Boolean(state.settings.compactView);

    const card = el('div', [
        'lbg-entry',
        'lbg-card-entry',
        compactView ? 'lbg-entry-compact-view' : 'lbg-entry-detailed-view',
        entry.selected ? 'lbg-entry-selected' : 'lbg-entry-disabled',
        favorite ? 'lbg-entry-favorite' : '',
        locked ? 'lbg-entry-locked' : '',
        blocked ? 'lbg-entry-blocked' : '',
        edited ? 'lbg-entry-edited' : '',
    ].filter(Boolean).join(' '));

    const top = el('div', 'lbg-entry-top');
    const label = el('label', 'lbg-toggle-row');
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(entry.selected);
    checkbox.disabled = locked || blocked;
    checkbox.addEventListener('change', () => {
        toggleEntrySelection(entry, state);
        renderRoot(state);
    });

    const title = el('span', 'lbg-entry-title');
    title.textContent = `📖 ${entry.title || 'Untitled entry'}`;
    label.append(checkbox, title);

    const actions = el('div', 'lbg-entry-actions');
    actions.append(
        entryIconButton(locked ? '🔒' : '🔓', locked ? 'Unlock entry' : 'Lock entry', `lbg-lock-button ${locked ? 'is-locked' : ''}`, () => {
            toggleLocked(state.settings, entry);
            enforceEntryRules(state);
            persistState(state);
            markDirty(state, 'entries');
            renderRoot(state);
        }),
        entryIconButton('🚫', blocked ? 'Allow this entry' : 'Never include', `lbg-block-button ${blocked ? 'is-blocked' : ''}`, () => {
            toggleBlocked(state.settings, entry);
            enforceEntryRules(state);
            persistState(state);
            markDirty(state, 'entries');
            renderRoot(state);
        }),
        entryIconButton(favorite ? '★' : '☆', favorite ? 'Unfavorite' : 'Favorite', `lbg-favorite-button ${favorite ? 'is-favorite' : ''}`, () => {
            toggleFavorite(state.settings, entry);
            persistState(state);
            renderRoot(state);
        }),
        entryIconButton('✎', 'Edit text', 'lbg-edit-button', () => openEditModal(entry, state)),
    );

    top.append(label, actions);
    card.appendChild(top);

    const meta = el('div', 'lbg-entry-meta');
    meta.append(
        badge(`${entry.tokens || 0} tokens`, 'lbg-token-badge'),
        badge(entry.bookName || 'Unknown book', 'lbg-book-badge'),
    );
    if (!compactView) {
        meta.append(
            badge(getSourceLabel(entry.sourceType) || 'external', 'lbg-source-badge'),
            badge(getActivationReasonText(entry), 'lbg-match-badge'),
        );
        if (locked) meta.appendChild(badge('Locked', 'lbg-lock-badge'));
        if (blocked) meta.appendChild(badge('Blocked', 'lbg-block-badge'));
    }
    card.appendChild(meta);

    const tags = createEntryTagRow(entry, state);
    if (tags.childElementCount) card.appendChild(tags);

    if (!compactView) {
        const details = el('div', 'lbg-entry-details');
        const keys = el('div', 'lbg-keys');
        keys.textContent = buildKeysText(entry);
        const preview = el('pre', 'lbg-preview');
        appendHighlightedPreview(preview, shorten(getEntryPromptContent(entry), 500), entry.matchedKeywords);
        details.append(keys, preview, createEntryMenuInline(entry, state));
        card.appendChild(details);
    } else {
        card.appendChild(createEntryMenuInline(entry, state));
    }

    return card;
}

function toggleEntrySelection(entry, state) {
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
    markDirty(state, 'entries');
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

function entryIconButton(icon, title, className, onClick) {
    const btn = button(icon, `lbg-icon-button ${className}`);
    btn.title = title;
    btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    return btn;
}

function createEntryMenuInline(entry, state) {
    const details = el('details', 'lbg-entry-menu-inline');
    const summary = el('summary', 'lbg-menu-button');
    summary.textContent = 'More actions';
    details.appendChild(summary);

    const menu = el('div', 'lbg-entry-menu-body');
    const standardTitle = el('div', 'lbg-menu-section-title');
    standardTitle.textContent = 'Tags';
    const tagGrid = el('div', 'lbg-menu-tag-grid');
    const currentTags = new Set(getEntryTags(state.settings, entry));

    for (const tag of orderedTags(state)) {
        const tagButton = button(tag.label, 'lbg-menu-tag-button');
        tagButton.style.setProperty('--tag-color', pastelizeColor(tag.color));
        tagButton.disabled = currentTags.has(tag.name);
        tagButton.addEventListener('click', () => {
            addEntryTag(state.settings, entry, tag.name);
            persistState(state);
            markDirty(state, 'entries');
            renderRoot(state);
        });
        tagGrid.appendChild(tagButton);
    }

    const customRow = el('div', 'lbg-menu-custom-row');
    const input = el('input', 'text_pole lbg-menu-custom-input');
    input.placeholder = 'Custom tag';
    const add = button('Add', 'lbg-small-button');
    add.addEventListener('click', () => {
        const tagName = normalizeTagName(input.value);
        if (!tagName) return;
        addEntryTag(state.settings, entry, tagName);
        persistState(state);
        markDirty(state, 'entries');
        renderRoot(state);
    });
    customRow.append(input, add);

    menu.append(standardTitle, tagGrid, customRow);
    menu.appendChild(lbgCreateGroupControls(entry, state));

    details.appendChild(menu);
    return details;
}

function createEntryTagRow(entry, state) {
    const row = el('div', 'lbg-entry-tags lbg-entry-tags-compact');
    const tags = getEntryTags(state.settings, entry);

    for (const tagName of tags) {
        const chip = createStaticTagChip(tagName, state.settings);
        const remove = button('×', 'lbg-tag-remove');
        remove.addEventListener('click', (event) => {
            event.stopPropagation();
            removeEntryTag(state.settings, entry, tagName);
            persistState(state);
            markDirty(state, 'entries');
            renderRoot(state);
        });
        chip.appendChild(remove);
        row.appendChild(chip);
    }

    for (const groupName of lbgGetEntryGroups(state.settings, entry)) {
        row.appendChild(lbgCreateGroupChip(groupName, false));
    }

    return row;
}

function createStaticTagChip(tagName, settings) {
    const chip = el('span', 'lbg-tag lbg-tag-compact');
    chip.style.setProperty('--tag-color', pastelizeColor(getTagColor(settings, tagName)));
    const dot = el('span', 'lbg-tag-dot');
    const label = el('span', 'lbg-tag-label');
    label.textContent = formatTagLabel(tagName);
    chip.append(dot, label);
    return chip;
}

async function openEditModal(entry, state) {
    document.querySelectorAll('.lbg-edit-overlay').forEach((node) => node.remove());

    const overlay = el('div', 'lbg-edit-overlay');
    const modal = el('div', 'lbg-edit-modal');
    const header = el('div', 'lbg-edit-header');
    const title = el('strong', 'lbg-edit-title');
    title.textContent = `Edit for this prompt: ${entry.title || 'Untitled entry'}`;
    const close = button('×', 'lbg-edit-close');
    header.append(title, close);

    const textarea = el('textarea', 'lbg-edit-textarea');
    textarea.value = getEntryPromptContent(entry);

    const footer = el('div', 'lbg-edit-footer');
    const reset = button('Reset to original', 'lbg-edit-action lbg-footer-secondary');
    const discard = button('Close without applying', 'lbg-edit-action lbg-footer-secondary');
    const apply = button('Apply temporary edit', 'lbg-edit-action lbg-footer-primary');
    footer.append(reset, discard, apply);

    modal.append(header, textarea, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.classList.add('lbg-edit-open');

    const cleanup = () => {
        document.body.classList.remove('lbg-edit-open');
        overlay.remove();
    };

    close.addEventListener('click', cleanup);
    discard.addEventListener('click', cleanup);
    reset.addEventListener('click', () => {
        clearTemporaryEdit(entry);
        entry.tokens = countEntryTokensFallback(entry);
        markDirty(state, 'entries');
        cleanup();
        renderRoot(state);
    });
    apply.addEventListener('click', async () => {
        setTemporaryEdit(entry, textarea.value);
        entry.tokens = await countTextTokens(getEntryPromptContent(entry), entry.id);
        markDirty(state, 'entries');
        cleanup();
        renderRoot(state);
    });
}

function countEntryTokensFallback(entry) {
    return Math.ceil(String(entry.originalContent || entry.content || '').length / 4);
}

function renderPreviewTab(state) {
    const panel = el('div', 'lbg-panel-block lbg-preview-tab');
    const header = el('div', 'lbg-preview-header');
    const title = el('div');
    title.innerHTML = '<strong>Prompt preview</strong><div class="lbg-muted">Read-only preview after Gatekeeper adjustment.</div>';
    const copy = button('📋 Copy', 'lbg-small-button lbg-copy-button');
    header.append(title, copy);

    const pre = el('pre', 'lbg-prompt-preview');
    const prompt = buildFinalPromptPreview(state);
    appendPromptHighlight(pre, prompt || 'No prompt text available.');
    copy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(prompt);
        toastr.success('Prompt preview copied.');
    });

    panel.append(header, pre);
    return panel;
}

function buildFinalPromptPreview(state) {
    const disabledEntries = state.activeEntries.filter((entry) => !entry.selected);
    const selectedActiveEntries = state.activeEntries.filter((entry) => entry.selected);
    const manualEntries = state.inactiveEntries.filter((entry) => entry.selected);

    let result = String(state.promptText || '');
    result = removeEntriesFromTextPrompt(result, disabledEntries);
    result = replaceEditedEntriesInTextPrompt(result, selectedActiveEntries);
    result = injectManualEntriesIntoTextPrompt(result, manualEntries);
    return result;
}

function appendPromptHighlight(container, prompt) {
    container.textContent = '';
    const value = String(prompt || '');
    const pattern = /({{[^{}]+}})/g;
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(value)) !== null) {
        if (match.index > lastIndex) container.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
        const mark = el('span', 'lbg-prompt-variable');
        mark.textContent = match[0];
        container.appendChild(mark);
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < value.length) container.appendChild(document.createTextNode(value.slice(lastIndex)));
}

function renderScenariosTab(state) {
    const panel = el('div', 'lbg-panel-block lbg-scenarios-tab');
    const quick = el('div', 'lbg-scenario-quick-save');
    const saveCurrent = button('Save current state as scenario', 'lbg-scenario-save-button');
    saveCurrent.addEventListener('click', () => {
        const name = window.prompt('Scenario name:', 'New scenario');
        if (!String(name || '').trim()) return;
        const description = window.prompt('Description:', DEFAULT_SCENARIO_DESCRIPTION) || DEFAULT_SCENARIO_DESCRIPTION;
        saveScenario(buildScenarioFromState(state, name, description));
        markDirty(state, 'scenarios');
        toastr.success('Scenario saved.');
        renderRoot(state);
    });
    quick.appendChild(saveCurrent);

    const list = el('div', 'lbg-scenario-list');
    const scenarios = loadScenarios();
    if (!scenarios.length) list.appendChild(createNoticeElement('No saved scenarios yet.'));
    else scenarios.forEach((scenario) => list.appendChild(createScenarioCard(state, scenario)));

    panel.append(quick, list);
    return panel;
}

function createScenarioCard(state, scenario) {
    const card = el('div', 'lbg-scenario-card');
    const title = el('h4');
    title.textContent = scenario.name || 'Untitled scenario';
    const description = el('p');
    description.textContent = scenario.description || DEFAULT_SCENARIO_DESCRIPTION;

    const actions = el('div', 'lbg-scenario-actions');
    const apply = button('Apply', 'lbg-footer-primary');
    apply.addEventListener('click', () => {
        applyScenarioToState(state, scenario);
        enforceEntryRules(state);
        markDirty(state, 'entries');
        toastr.success(`Scenario Applied.`);
        renderRoot(state);
    });

    const remove = button('Delete', 'lbg-footer-danger');
    remove.addEventListener('click', () => {
        if (!window.confirm('Delete scenario?')) return;
        deleteScenario(scenario.id);
        markDirty(state, 'scenarios');
        renderRoot(state);
    });

    actions.append(apply, remove);
    card.append(title, description, actions);
    return card;
}

function buildScenarioFromState(state, name, description) {
    return {
        id: `scenario-${Date.now()}`,
        name: String(name).trim(),
        description: String(description).trim(),
        updatedAt: Date.now(),
        selectedActiveIds: state.activeEntries.filter((entry) => entry.selected).map((entry) => entry.id),
        disabledActiveIds: state.activeEntries.filter((entry) => !entry.selected).map((entry) => entry.id),
        manualEntryIds: state.inactiveEntries.filter((entry) => entry.selected).map((entry) => entry.id),
    };
}

function applyScenarioToState(state, scenario) {
    const selectedActiveIds = new Set(toStringArray(scenario.selectedActiveIds));
    const disabledActiveIds = new Set(toStringArray(scenario.disabledActiveIds));
    const manualEntryIds = new Set(toStringArray(scenario.manualEntryIds));

    for (const entry of state.activeEntries) {
        if (disabledActiveIds.has(entry.id)) entry.selected = false;
        else if (selectedActiveIds.has(entry.id)) entry.selected = true;
    }
    for (const entry of state.inactiveEntries) {
        entry.selected = manualEntryIds.has(entry.id);
    }
}

function loadScenarios() {
    try {
        const raw = localStorage.getItem(SCENARIOS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function saveScenario(scenario) {
    const scenarios = loadScenarios();
    scenarios.push(scenario);
    localStorage.setItem(SCENARIOS_STORAGE_KEY, JSON.stringify(scenarios));
}

function deleteScenario(id) {
    const scenarios = loadScenarios().filter((s) => s.id !== id);
    localStorage.setItem(SCENARIOS_STORAGE_KEY, JSON.stringify(scenarios));
}

function getVisibleActiveEntries(state) {
    return lbgSortEntries(
        lbgFilterEntriesForReview(state.activeEntries, state),
        state.settings.sortMode || 'tokens_desc',
        state
    );
}

function getVisibleInactiveEntries(state) {
    const entries = lbgFilterInactiveEntriesByBook(
        lbgFilterEntriesForReview(state.inactiveEntries, state),
        state.inactiveBookFilter
    );
    return lbgSortInactiveEntries(entries, state.settings.sortMode || 'tokens_desc', state);
}

function sortEntries(entries, sortMode, state) {
    const favoriteWeight = (entry) => isFavorite(state.settings, entry) ? -1 : 0;
    return [...entries].sort((a, b) => {
        const favDiff = favoriteWeight(a) - favoriteWeight(b);
        if (favDiff !== 0) return favDiff;
        if (sortMode === 'tokens_asc') return Number(a.tokens || 0) - Number(b.tokens || 0);
        if (sortMode === 'book') return String(a.bookName || '').localeCompare(String(b.bookName || '')) || String(a.title || '').localeCompare(String(b.title || ''));
        if (sortMode === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
        return Number(b.tokens || 0) - Number(a.tokens || 0);
    });
}

function sortInactiveEntries(entries, sortMode, state) {
    const preferred = new Set(toStringArray(state.settings.preferredInactiveBookNames));
    return sortEntries(entries, sortMode, state).sort((a, b) => {
        const preferredDiff = (preferred.has(b.bookName) ? 1 : 0) - (preferred.has(a.bookName) ? 1 : 0);
        if (preferredDiff !== 0) return preferredDiff;
        return Number(a.sourcePriority ?? 99) - Number(b.sourcePriority ?? 99);
    });
}

function getBookInfos(entries) {
    const byName = new Map();
    for (const entry of entries) {
        const bookName = String(entry.bookName || '').trim();
        if (!bookName) continue;
        byName.set(bookName, {
            bookName,
            sourceType: entry.sourceType || 'other',
            sourcePriority: getSourcePriority(entry.sourceType),
            sourceLabel: getSourceLabel(entry.sourceType),
        });
    }
    return [...byName.values()].sort((a, b) => a.bookName.localeCompare(b.bookName));
}

function getLinkedBookNames(entries) {
    return getBookInfos(entries).map((info) => info.bookName);
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
        default: return 'other';
    }
}

function getActivationReasonText(entry) {
    if (entry.selectionSource === 'remembered') return 'Remembered';
    if (entry.selectionSource === 'manual') return 'Manual add';
    if (entry.originallyActive) return `Triggered: ${entry.matchType}`;
    return 'Inactive';
}

function buildKeysText(entry) {
    return `Keys: ${toStringArray(entry.keys).join(', ')}`;
}

function getEntryPromptContent(entry) {
    return Object.prototype.hasOwnProperty.call(entry, 'temporaryContent') ? String(entry.temporaryContent) : String(entry.content);
}

function hasTemporaryEdit(entry) {
    return Object.prototype.hasOwnProperty.call(entry, 'temporaryContent');
}

function clearTemporaryEdit(entry) { delete entry.temporaryContent; }
function setTemporaryEdit(entry, content) { entry.temporaryContent = content; }

function appendHighlightedPreview(container, textValue, keywords) {
    container.textContent = textValue;
}

function shorten(textValue, maxLength) {
    return textValue.length > maxLength ? textValue.slice(0, maxLength) + '…' : textValue;
}

function createOption(value, label) {
    const opt = el('option'); opt.value = value; opt.textContent = label; return opt;
}

function createNoticeElement(message) {
    const d = el('div', 'lbg-notice'); d.textContent = message; return d;
}

function badge(label, className) {
    const s = el('span', className); s.textContent = label; return s;
}

function persistState(state) { saveSettings(state.settings); }
function markDirty(state, tabName) { state.dirtyTabs.add(tabName); }
function allEntries(state) { return [...state.activeEntries, ...state.inactiveEntries]; }
function pastelizeColor(color) { return color; }

function button(label, className = '') {
    const b = el('button', className); b.type = 'button'; b.textContent = label; return b;
}
function text(value) { return document.createTextNode(value); }
function el(tagName, className = '') {
    const n = document.createElement(tagName); if (className) n.className = className; return n;
}
function toStringArray(value) { return Array.isArray(value) ? value.map(String) : []; }


// ==========================================
// ИНТЕГРИРОВАННЫЙ РАСШИРЕННЫЙ ФУНКЦИОНАЛ РАСШИРЕНИЯ (LBG_FUNCTIONAL_FEATURES)
// ==========================================

const LBG_GROUP_FILTER_ALL = '__all__';
const LBG_GROUP_FILTER_UNGROUPED = '__ungrouped__';
const LBG_DEFAULT_SEARCH_SCOPES = ['title', 'tags', 'keys', 'context'];
const LBG_SEARCH_SCOPE_LABELS = {
    title: 'Title',
    tags: 'Tags',
    keys: 'Keys',
    context: 'Context',
};
const LBG_DEFAULT_LAYOUT_ORDER = ['search', 'tags', 'controls', 'memory', 'active', 'inactive'];

function lbgEnsureAdvancedFeatureSettings(settings) {
    if (!settings || typeof settings !== 'object') return;

    if (!Array.isArray(settings.searchScopes) || !settings.searchScopes.length) {
        settings.searchScopes = [...LBG_DEFAULT_SEARCH_SCOPES];
    }
    if (!settings.entryGroups || typeof settings.entryGroups !== 'object') {
        settings.entryGroups = {};
    }
    if (!Array.isArray(settings.groupOrder)) settings.groupOrder = [];
    if (typeof settings.groupFilter !== 'string') settings.groupFilter = LBG_GROUP_FILTER_ALL;

    if (!settings.uiCustomization || typeof settings.uiCustomization !== 'object') {
        settings.uiCustomization = {};
    }
    const ui = settings.uiCustomization;
    ui.fontScale = lbgClampNumber(ui.fontScale, 0.75, 1.35, 1);
    ui.buttonScale = lbgClampNumber(ui.buttonScale, 0.75, 1.6, 1);
    ui.entryDensity = lbgClampNumber(ui.entryDensity, 0.6, 1.5, 1);
    ui.entryWidth = lbgClampNumber(ui.entryWidth, 55, 100, 100);
    ui.panelWidth = lbgClampNumber(ui.panelWidth, 620, 1600, 980);

    if (!Array.isArray(settings.uiLayoutOrder) || !settings.uiLayoutOrder.length) {
        settings.uiLayoutOrder = [...LBG_DEFAULT_LAYOUT_ORDER];
    }
}

function lbgClampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function lbgGetLayoutOrder(settings) {
    lbgEnsureAdvancedFeatureSettings(settings);
    return [...settings.uiLayoutOrder];
}

function lbgEntryMetaId(entry) {
    return String(entry?.stableId || entry?.id || `${entry?.bookName || ''}:${entry?.title || ''}`);
}

function lbgNormalizeGroupName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

function lbgGetEntryGroups(settings, entry) {
    const id = lbgEntryMetaId(entry);
    return toStringArray(settings.entryGroups[id]).map(lbgNormalizeGroupName).filter(Boolean);
}

function lbgSetEntryGroups(settings, entry, groups) {
    const id = lbgEntryMetaId(entry);
    const cleanGroups = toStringArray(groups).map(lbgNormalizeGroupName).filter(Boolean);
    if (cleanGroups.length) settings.entryGroups[id] = cleanGroups;
    else delete settings.entryGroups[id];

    for (const group of cleanGroups) {
        if (!settings.groupOrder.includes(group)) settings.groupOrder.push(group);
    }
}

function lbgAddEntryGroup(settings, entry, groupName) {
    const group = lbgNormalizeGroupName(groupName);
    if (!group) return false;
    const groups = lbgGetEntryGroups(settings, entry);
    if (!groups.includes(group)) groups.push(group);
    lbgSetEntryGroups(settings, entry, groups);
    return true;
}

function lbgRemoveEntryGroup(settings, entry, groupName) {
    const group = lbgNormalizeGroupName(groupName);
    if (!group) return;
    const groups = lbgGetEntryGroups(settings, entry).filter((item) => item !== group);
    lbgSetEntryGroups(settings, entry, groups);
}

function lbgGetAllGroups(settings) {
    const groups = new Set(settings.groupOrder);
    for (const values of Object.values(settings.entryGroups || {})) {
        for (const group of toStringArray(values)) {
            const normalized = lbgNormalizeGroupName(group);
            if (normalized) groups.add(normalized);
        }
    }
    return [...groups].filter(Boolean);
}

function lbgCreateGroupChip(groupName, removable, onRemove) {
    const chip = el('span', `lbg-group-chip`);
    chip.style = "background: rgba(105, 145, 255, 0.15); border: 1px solid rgba(130, 170, 255, 0.4); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-flex; align-items: center;";
    chip.textContent = `Group: ${groupName}`;
    if (removable && typeof onRemove === 'function') {
        const remove = button('×', 'lbg-tag-remove');
        remove.style = "background:none; border:none; margin-left: 4px; color:red; cursor:pointer;";
        remove.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
        chip.appendChild(remove);
    }
    return chip;
}

function lbgCreateGroupControls(entry, state) {
    const wrapper = el('div', 'lbg-group-menu-section');
    wrapper.style = "margin-top: 10px; border-top: 1px solid #333; padding-top: 8px;";
    const title = el('div', 'lbg-menu-section-title');
    title.textContent = 'Groups Management';

    const current = el('div', 'lbg-current-group-list');
    const currentGroups = lbgGetEntryGroups(state.settings, entry);
    if (!currentGroups.length) {
        const empty = el('div'); empty.style = "font-size:11px; color:#666;"; empty.textContent = "No groups assigned";
        current.appendChild(empty);
    } else {
        for (const group of currentGroups) {
            current.appendChild(lbgCreateGroupChip(group, true, () => {
                lbgRemoveEntryGroup(state.settings, entry, group);
                persistState(state);
                renderRoot(state);
            }));
        }
    }

    const customRow = el('div', 'lbg-menu-custom-row');
    customRow.style = "display:flex; gap: 4px; margin-top:6px;";
    const input = el('input', 'text_pole');
    input.placeholder = 'Add to group name...';
    const add = button('Add', 'lbg-small-button');
    add.addEventListener('click', () => {
        if (lbgAddEntryGroup(state.settings, entry, input.value)) {
            persistState(state);
            renderRoot(state);
        }
    });
    customRow.append(input, add);
    wrapper.append(title, current, customRow);
    return wrapper;
}

function lbgRenderGroupFilter(state) {
    const select = el('select', 'text_pole lbg-group-filter-select');
    select.appendChild(createOption(LBG_GROUP_FILTER_ALL, '📁 All Groups'));
    select.appendChild(createOption(LBG_GROUP_FILTER_UNGROUPED, '❌ Ungrouped'));

    for (const group of lbgGetAllGroups(state.settings)) {
        select.appendChild(createOption(group, `📁 ${group}`));
    }
    select.value = state.settings.groupFilter || LBG_GROUP_FILTER_ALL;
    select.addEventListener('change', () => {
        state.settings.groupFilter = select.value;
        persistState(state);
        renderRoot(state);
    });
    return select;
}

function lbgRenderSearchScopeControls(state) {
    const wrapper = el('div', 'lbg-search-scope-row');
    wrapper.style = "display: flex; gap: 12px; margin-top: 6px; font-size: 12px; color: #aaa;";
    const label = el('span', 'lbg-search-scope-title');
    label.innerHTML = '<strong>Search target scope:</strong>';
    wrapper.appendChild(label);

    for (const scope of LBG_DEFAULT_SEARCH_SCOPES) {
        const scopeLabel = el('label');
        scopeLabel.style = "display:flex; align-items:center; gap: 4px; cursor:pointer;";
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = state.settings.searchScopes.includes(scope);
        input.addEventListener('change', () => {
            const selected = new Set(state.settings.searchScopes);
            if (input.checked) selected.add(scope);
            else selected.delete(scope);

            if (selected.size === 0) { selected.add(scope); input.checked = true; }
            state.settings.searchScopes = [...selected];
            persistState(state);
            renderRoot(state);
        });
        scopeLabel.append(input, document.createTextNode(LBG_SEARCH_SCOPE_LABELS[scope]));
        wrapper.appendChild(scopeLabel);
    }
    return wrapper;
}

function lbgRenderUiCustomizationPanel(state) {
    const details = el('details', 'lbg-ui-customizer');
    details.style = "margin-top:8px; border: 1px solid #333; padding: 6px; border-radius:6px; background: rgba(0,0,0,0.2);";
    const summary = el('summary');
    summary.textContent = '⚙️ Advanced Interface Sizing';
    summary.style = "cursor:pointer; font-size:12px; font-weight:bold;";
    details.appendChild(summary);

    const body = el('div', 'lbg-ui-customizer-body');
    body.style = "display:flex; flex-direction:column; gap:6px; margin-top:6px;";
    const ui = state.settings.uiCustomization;

    body.append(
        lbgCreateRangeControl('Font Scale', ui.fontScale, 0.75, 1.35, 0.05, (val) => { ui.fontScale = val; persistState(state); lbgApplyUiCustomization(state); }),
        lbgCreateRangeControl('Buttons Scale', ui.buttonScale, 0.75, 1.6, 0.05, (val) => { ui.buttonScale = val; persistState(state); lbgApplyUiCustomization(state); }),
        lbgCreateRangeControl('Card Density', ui.entryDensity, 0.6, 1.5, 0.05, (val) => { ui.entryDensity = val; persistState(state); lbgApplyUiCustomization(state); }),
        lbgCreateRangeControl('Entry Width (%)', ui.entryWidth, 55, 100, 1, (val) => { ui.entryWidth = val; persistState(state); lbgApplyUiCustomization(state); }),
        lbgCreateRangeControl('Window Width (px)', ui.panelWidth, 620, 1600, 20, (val) => { ui.panelWidth = val; persistState(state); lbgApplyUiCustomization(state); })
    );

    details.appendChild(body);
    return details;
}

function lbgCreateRangeControl(label, val, min, max, step, onChange) {
    const r = el('div'); r.style = "display:grid; grid-template-columns: 120px 1fr 40px; align-items:center; font-size:11px;";
    const l = el('span'); l.textContent = label;
    const v = el('span'); v.textContent = val; v.style = "text-align:right;";
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = min; slider.max = max; slider.step = step; slider.value = val;
    slider.addEventListener('input', () => { v.textContent = slider.value; onChange(Number(slider.value)); });
    r.append(l, slider, v);
    return r;
}

function lbgApplyUiCustomization(state) {
    const shell = state.root?.querySelector('.lbg-root');
    if (!shell) return;
    const ui = state.settings.uiCustomization;
    shell.style.setProperty('--lbg-ui-font-scale', ui.fontScale);
    shell.style.setProperty('--lbg-ui-button-scale', ui.buttonScale);
    shell.style.setProperty('--lbg-entry-density', ui.entryDensity);
    shell.style.setProperty('--lbg-entry-width', `${ui.entryWidth}%`);
    shell.style.setProperty('--lbg-panel-width', `${ui.panelWidth}px`);

    const panel = state.root?.closest('.lbg-mobile-panel, .lbg-desktop-panel');
    if (panel) panel.style.setProperty('width', `${ui.panelWidth}px`);
}

function lbgRenderRootKeepingSearchFocus(state, input) {
    if (input) {
        state.lbgSearchFocus = {
            start: input.selectionStart,
            end: input.selectionEnd,
            scrollTop: state.root ? state.root.scrollTop : 0
        };
    }
    renderRoot(state);
}

function lbgRestoreSearchFocus(state) {
    if (!state.lbgSearchFocus) return;
    const focusState = state.lbgSearchFocus;
    state.lbgSearchFocus = null;

    requestAnimationFrame(() => {
        if (state.root && focusState.scrollTop) state.root.scrollTop = focusState.scrollTop;
        const search = document.getElementById('lbgSearch');
        if (!search) return;
        search.focus();
        try { search.setSelectionRange(focusState.start, focusState.end); } catch (e) {}
    });
}

function lbgMakeLayoutDraggable(node, key, state) {
    if (!node) return node;
    node.classList.add('lbg-layout-draggable');
    
    const handle = el('div', 'lbg-drag-handle');
    handle.textContent = '↕ Drag to reorder section layout';
    handle.style = "background:#222; font-size:10px; padding:2px 6px; text-align:center; color:#777; cursor:grab; border-radius:4px; border:1px dashed #444; margin-bottom:4px;";
    handle.draggable = true;

    handle.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', key);
        node.style.opacity = '0.4';
    });
    handle.addEventListener('dragend', () => { node.style.opacity = '1'; });
    node.addEventListener('dragover', (e) => e.preventDefault());
    node.addEventListener('drop', (e) => {
        e.preventDefault();
        const sourceKey = e.dataTransfer.getData('text/plain');
        if (!sourceKey || sourceKey === key) return;

        const order = state.settings.uiLayoutOrder;
        const fromIdx = order.indexOf(sourceKey);
        const toIdx = order.indexOf(key);
        if (fromIdx !== -1 && toIdx !== -1) {
            order.splice(toIdx, 0, order.splice(fromIdx, 1)[0]);
            persistState(state);
            renderRoot(state);
        }
    });

    node.insertBefore(handle, node.firstChild);
    return node;
}

function lbgEntryMatchesSearch(entry, state) {
    const query = String(state.searchQuery || '').toLowerCase().trim();
    if (!query) return true;

    return state.settings.searchScopes.some((scope) => {
        if (scope === 'title') return String(entry.title || '').toLowerCase().includes(query);
        if (scope === 'tags') return getEntryTags(state.settings, entry).join(' ').toLowerCase().includes(query);
        if (scope === 'keys') return [...toStringArray(entry.keys), ...toStringArray(entry.secondaryKeys)].join(' ').toLowerCase().includes(query);
        if (scope === 'context') return String(entry.content || '').toLowerCase().includes(query);
        return false;
    });
}

function lbgFilterEntriesForReview(entries, state) {
    return entries.filter((entry) => {
        const matchesSearch = lbgEntryMatchesSearch(entry, state);
        
        // Фильтрация по Группам
        const filter = state.settings.groupFilter || LBG_GROUP_FILTER_ALL;
        let matchesGroup = true;
        const groups = lbgGetEntryGroups(state.settings, entry);
        if (filter === LBG_GROUP_FILTER_UNGROUPED) matchesGroup = (groups.length === 0);
        else if (filter !== LBG_GROUP_FILTER_ALL) matchesGroup = groups.includes(filter);

        return matchesSearch && matchesGroup;
    });
}

function lbgIsUnlinkedConstantActiveEntry(entry) { return entry?.matchType === 'unlinked-constant'; }
function lbgSortEntries(entries, mode, state) { return sortEntries(entries, mode, state); }
function lbgSortInactiveEntries(entries, mode, state) { return sortInactiveEntries(entries, mode, state); }
function lbgFilterInactiveEntriesByBook(entries, bookFilter) { return filterInactiveEntriesByBook(entries, bookFilter); }