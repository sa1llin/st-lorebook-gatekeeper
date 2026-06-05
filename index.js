import { eventSource, event_types, main_api, stopGeneration } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import {
    world_info_case_sensitive,
    world_info_depth,
    world_info_include_names,
    world_info_match_whole_words,
} from '../../../world-info.js';
import { findActiveEntries, splitActiveAndInactive } from './src/activationMatcher.js';
import { collectWorldInfoEntries } from './src/worldInfoCollector.js';
import { addTokenCounts, buildTokenStats } from './src/tokenCounter.js';
import { getSettings, saveSettings } from './src/settings.js';
import { getPromptTextFromChat } from './src/promptAdapter.js';
import {
    injectManualEntriesIntoChat,
    injectManualEntriesIntoTextPrompt,
    removeEntriesFromChat,
    removeEntriesFromTextPrompt,
    replaceEditedEntriesInChat,
    replaceEditedEntriesInTextPrompt,
} from './src/promptPatcher.js';
import { showLorebookReviewPopup } from './src/reviewPopup.js';
import { MODULE_NAME } from './src/constants.js';
import { isLocked } from './src/entryMetaStore.js';
import {
    queueItemizedPromptCorrection,
    scheduleItemizedPromptCorrectionFlush,
} from './src/itemizationPatch.js';

const settings = getSettings();

function validateRequiredEvents() {
    if (!('CHAT_COMPLETION_PROMPT_READY' in event_types)) {
        throw new Error(`${MODULE_NAME}: CHAT_COMPLETION_PROMPT_READY event is not available. Update SillyTavern.`);
    }

    if (!('GENERATE_AFTER_COMBINE_PROMPTS' in event_types)) {
        throw new Error(`${MODULE_NAME}: GENERATE_AFTER_COMBINE_PROMPTS event is not available. Update SillyTavern.`);
    }
}

function addLaunchButton() {
    const extensionsMenu = document.getElementById('prompt_inspector_wand_container') ?? document.getElementById('extensionsMenu');

    if (!extensionsMenu) {
        console.warn(`${MODULE_NAME}: extensions menu was not found. Toggle buttons were not added.`);
        return;
    }

    const launchButton = document.createElement('div');
    launchButton.id = 'lorebookGatekeeperButton';
    launchButton.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
    launchButton.tabIndex = 0;
    launchButton.title = 'Toggle Lorebook Gatekeeper';

    const icon = document.createElement('i');
    const textSpan = document.createElement('span');

    function updateButtonView() {
        icon.className = settings.enabled ? 'fa-solid fa-book-open-reader' : 'fa-solid fa-book';
        textSpan.textContent = settings.enabled ? 'Lorebook Gatekeeper: ON' : 'Lorebook Gatekeeper: OFF';
    }

    updateButtonView();
    launchButton.appendChild(icon);
    launchButton.appendChild(textSpan);
    extensionsMenu.appendChild(launchButton);

    launchButton.addEventListener('click', () => {
        settings.enabled = !settings.enabled;
        saveSettings(settings);
        updateButtonView();
        toastr.info(`${MODULE_NAME} ${settings.enabled ? 'enabled' : 'disabled'}.`);
    });

    const triggerButton = document.createElement('div');
    triggerButton.id = 'lorebookGatekeeperTriggerWordButton';
    triggerButton.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
    triggerButton.tabIndex = 0;
    triggerButton.title = 'Toggle trigger word recognition diagnostics';

    const triggerIcon = document.createElement('i');
    const triggerText = document.createElement('span');

    function updateTriggerButtonView() {
        const enabled = Boolean(settings.triggerWordDetectionEnabled);
        triggerIcon.className = enabled ? 'fa-solid fa-key' : 'fa-solid fa-keyboard';
        triggerText.textContent = enabled ? 'Trigger word recognition: ON' : 'Trigger word recognition: OFF';
    }

    updateTriggerButtonView();
    triggerButton.appendChild(triggerIcon);
    triggerButton.appendChild(triggerText);
    extensionsMenu.appendChild(triggerButton);

    triggerButton.addEventListener('click', () => {
        settings.triggerWordDetectionEnabled = !Boolean(settings.triggerWordDetectionEnabled);
        saveSettings(settings);
        updateTriggerButtonView();

        if (settings.triggerWordDetectionEnabled) {
            toastr.warning(
                'Trigger word recognition is experimental and may be inaccurate. SillyTavern does not expose the exact internal matched keyword to third-party extensions.',
                `${MODULE_NAME}: warning`,
                { timeOut: 9000, extendedTimeOut: 9000 },
            );
        } else {
            toastr.info(`${MODULE_NAME}: trigger word recognition disabled.`);
        }
    });
}

function isLikelyChatCompletionMode() {
    return String(main_api || '').toLowerCase() === 'openai';
}

async function reviewPrompt(promptText, options = {}) {
    const allEntries = await collectWorldInfoEntries();
    const activeEntries = findActiveEntries(allEntries, promptText, {
        enableTriggerWordDetection: Boolean(settings.triggerWordDetectionEnabled),
        triggerScanText: options.triggerScanText,
        triggerScanTexts: options.triggerScanTexts,
        triggerScanMessages: options.triggerScanMessages,
        triggerScanMessageSources: options.triggerScanMessageSources,
        defaultScanDepth: options.defaultScanDepth,
        includeNames: options.includeNames,
        caseSensitive: options.caseSensitive,
        matchWholeWords: options.matchWholeWords,
    });
    const { inactiveEntries } = splitActiveAndInactive(allEntries, activeEntries);
    const hasLockedEntries = allEntries.some((entry) => isLocked(settings, entry));

    if (options.skipWhenNoActive && activeEntries.length === 0 && !hasLockedEntries && !settings.showManualOnlyWhenNoActive) {
        console.debug(`${MODULE_NAME}: skipped preliminary prompt review because no active or locked Lorebook entries were detected.`);
        return { action: 'discard', disabledEntries: [], manualEntries: [], selectedActiveEntries: [] };
    }

    await addTokenCounts(activeEntries);
    if (settings.countInactiveTokens) await addTokenCounts(inactiveEntries);

    const statsBefore = buildTokenStats(activeEntries, inactiveEntries);
    const result = await showLorebookReviewPopup({ activeEntries, inactiveEntries, statsBefore, settings });

    saveSettings(settings);
    return result;
}

async function handleReviewResult(result, applyChanges) {
    if (!result || result.action === 'discard') return;

    if (result.action === 'cancel') {
        await stopGeneration();
        return;
    }

    if (result.action === 'confirm') await applyChanges(result);
}

function buildTriggerScanOptions(fallbackChat = []) {
    const triggerScanMessageSources = getTriggerScanMessageSources(fallbackChat);
    const defaultScanDepth = getWorldInfoScanDepth();
    const includeNames = getWorldInfoIncludeNames();
    const caseSensitive = getWorldInfoCaseSensitive();
    const matchWholeWords = getWorldInfoMatchWholeWords();

    const triggerScanTexts = triggerScanMessageSources
        .map((source) => ({
            label: source.label,
            text: buildTriggerScanTextFromMessages(source.messages, defaultScanDepth, includeNames),
        }))
        .filter((source) => source.text);

    const primaryScanText = triggerScanTexts[0]?.text || '';

    console.debug(`${MODULE_NAME}: trigger scan prepared.`, {
        sources: triggerScanMessageSources.map((source) => ({
            label: source.label,
            messages: source.messages.length,
        })),
        defaultScanDepth,
        includeNames,
        caseSensitive,
        matchWholeWords,
        triggerScanTextLength: primaryScanText.length,
        triggerScanSourceCount: triggerScanTexts.length,
    });

    return {
        triggerScanText: primaryScanText,
        triggerScanTexts,
        triggerScanMessages: triggerScanMessageSources[0]?.messages || [],
        triggerScanMessageSources,
        defaultScanDepth,
        includeNames,
        caseSensitive,
        matchWholeWords,
    };
}

function getTriggerScanMessageSources(fallbackChat = []) {
    const context = getSafeContext();
    const sources = [
        { label: 'context.chat', value: context?.chat },
        { label: 'globalThis.chat', value: globalThis.chat },
        { label: 'event.chat', value: fallbackChat },
    ];

    const result = [];
    const seen = new Set();

    for (const source of sources) {
        if (!Array.isArray(source.value) || !source.value.length) continue;

        const messages = normalizeTriggerMessages(source.value);
        if (!messages.length) continue;

        const signature = messages
            .map((message) => `${message.name || ''}:${message.role || ''}:${message.content || ''}`)
            .join('\n---\n');

        if (seen.has(signature)) continue;
        seen.add(signature);

        result.push({ label: source.label, messages });
    }

    return result;
}

function getTriggerScanMessages(fallbackChat = []) {
    return getTriggerScanMessageSources(fallbackChat)[0]?.messages || [];
}

function normalizeTriggerMessages(messages) {
    return messages
        .filter((message) => isChatHistoryMessage(message))
        .map((message) => ({
            name: getMessageName(message),
            content: extractMessageContent(message),
            role: String(message?.role || '').toLowerCase(),
        }))
        .filter((message) => message.content);
}

function isChatHistoryMessage(message) {
    if (typeof message === 'string') return Boolean(message.trim());

    const role = String(message?.role || '').toLowerCase();

    // Raw SillyTavern chat messages usually do not have a role field and use `mes`.
    if (!role) return Boolean(extractMessageContent(message));

    // If we only have the final Chat Completion prompt, ignore system/tool messages.
    return role === 'user' || role === 'assistant';
}

function buildTriggerScanTextFromMessages(messages, scanDepth, includeNames = true) {
    const depth = Number(scanDepth);
    if (!Number.isFinite(depth) || depth <= 0 || !Array.isArray(messages) || !messages.length) return '';

    return messages
        .slice(-Math.floor(depth))
        .map((message) => formatMessageForTriggerScan(message, includeNames))
        .filter(Boolean)
        .join('\n');
}

function formatMessageForTriggerScan(message, includeNames = true) {
    const content = extractMessageContent(message);
    if (!content) return '';

    if (!includeNames) return content;

    const name = getMessageName(message);
    return name ? `${name}: ${content}` : content;
}

function getMessageName(message) {
    if (typeof message === 'string' || !message) return '';

    return String(
        message.name
        ?? message.sender
        ?? message.extra?.name
        ?? message.role
        ?? '',
    ).trim();
}

function extractMessageContent(message) {
    if (!message) return '';

    if (typeof message === 'string') return message;
    if (typeof message.mes === 'string') return message.mes;
    if (typeof message.message === 'string') return message.message;
    if (typeof message.content === 'string') return message.content;
    if (typeof message.text === 'string') return message.text;

    if (Array.isArray(message.content)) {
        return message.content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (typeof part?.text === 'string') return part.text;
                if (typeof part?.content === 'string') return part.content;
                if (typeof part?.message === 'string') return part.message;
                return '';
            })
            .filter(Boolean)
            .join('\n');
    }

    return '';
}

function getWorldInfoScanDepth() {
    const candidates = [];

    // Prefer live UI/context values over the imported binding: in some SillyTavern builds
    // the imported value can be stale during third-party extension execution.
    candidates.push(
        getNumericDomValue('#world_info_depth'),
        getNumericDomValue('#world_info_depth_counter'),
        getNumericDomValue('#wi_depth'),
        getNumericDomValue('#world_info_scan_depth'),
        getNumericDomValue('[name="world_info_depth"]'),
    );

    const context = getSafeContext();
    candidates.push(
        getNestedNumber(context, ['world_info_depth']),
        getNestedNumber(context, ['worldInfoDepth']),
        getNestedNumber(context, ['worldInfoSettings', 'depth']),
        getNestedNumber(context, ['powerUserSettings', 'world_info_depth']),
        getNestedNumber(context, ['extensionSettings', 'world_info_depth']),
        getNestedNumber(globalThis, ['world_info_depth']),
        getNestedNumber(globalThis, ['power_user', 'world_info_depth']),
        getNestedNumber(globalThis, ['power_user', 'world_info', 'depth']),
        getNestedNumber(globalThis, ['SillyTavern', 'settings', 'world_info_depth']),
        Number(world_info_depth),
    );

    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }

    // This extension is only explaining keyword activation. If ST reports an unusable
    // depth, keep diagnostics useful and avoid falling back to the whole prompt/history.
    return 2;
}

function getWorldInfoIncludeNames() {
    const candidates = [
        getBooleanDomValue('#world_info_include_names'),
        getNestedBoolean(getSafeContext(), ['world_info_include_names']),
        getNestedBoolean(getSafeContext(), ['worldInfoSettings', 'includeNames']),
        getNestedBoolean(globalThis, ['world_info_include_names']),
        world_info_include_names,
    ];

    for (const candidate of candidates) {
        const value = normalizeBoolean(candidate);
        if (typeof value === 'boolean') return value;
    }

    return true;
}

function getWorldInfoCaseSensitive() {
    const candidates = [
        getBooleanDomValue('#world_info_case_sensitive'),
        getNestedBoolean(getSafeContext(), ['world_info_case_sensitive']),
        getNestedBoolean(getSafeContext(), ['worldInfoSettings', 'caseSensitive']),
        getNestedBoolean(globalThis, ['world_info_case_sensitive']),
        world_info_case_sensitive,
    ];

    for (const candidate of candidates) {
        const value = normalizeBoolean(candidate);
        if (typeof value === 'boolean') return value;
    }

    return false;
}

function getWorldInfoMatchWholeWords() {
    const candidates = [
        getBooleanDomValue('#world_info_match_whole_words'),
        getNestedBoolean(getSafeContext(), ['world_info_match_whole_words']),
        getNestedBoolean(getSafeContext(), ['worldInfoSettings', 'matchWholeWords']),
        getNestedBoolean(globalThis, ['world_info_match_whole_words']),
        world_info_match_whole_words,
    ];

    for (const candidate of candidates) {
        const value = normalizeBoolean(candidate);
        if (typeof value === 'boolean') return value;
    }

    return false;
}

function getSafeContext() {
    try {
        if (typeof getContext === 'function') return getContext();
    } catch {
        // fall through to global context fallback
    }

    try {
        return globalThis.SillyTavern?.getContext?.() ?? null;
    } catch {
        return null;
    }
}

function getBooleanDomValue(selector) {
    try {
        const element = document.querySelector(selector);
        if (!element) return null;

        if (typeof element.checked === 'boolean') return element.checked;

        const value = element.value ?? element.textContent;
        return normalizeBoolean(value);
    } catch {
        return null;
    }
}

function getNestedBoolean(source, path) {
    try {
        let current = source;
        for (const key of path) {
            if (typeof current === 'function') current = current();
            current = current?.[key];
        }

        return normalizeBoolean(current);
    } catch {
        return null;
    }
}

function normalizeBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on', 'checked'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off', 'unchecked'].includes(normalized)) return false;
    }

    return null;
}

function getNumericDomValue(selector) {
    try {
        const element = document.querySelector(selector);
        if (!element) return null;
        const value = element.value ?? element.textContent;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    } catch {
        return null;
    }
}

function getNestedNumber(source, path) {
    try {
        let current = source;
        for (const key of path) {
            if (typeof current === 'function') current = current();
            current = current?.[key];
        }
        const number = Number(current);
        return Number.isFinite(number) ? number : null;
    } catch {
        return null;
    }
}

eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, async (data) => {
    if (!settings.enabled || data.dryRun || !Array.isArray(data.chat)) return;

    try {
        const promptText = getPromptTextFromChat(data.chat);
        const triggerScanOptions = settings.triggerWordDetectionEnabled
            ? buildTriggerScanOptions(data.chat)
            : {};
        const result = await reviewPrompt(promptText, triggerScanOptions);

        await handleReviewResult(result, async ({ disabledEntries, manualEntries, selectedActiveEntries }) => {
            removeEntriesFromChat(data.chat, disabledEntries);
            replaceEditedEntriesInChat(data.chat, selectedActiveEntries);
            injectManualEntriesIntoChat(data.chat, manualEntries);

            await queueItemizedPromptCorrection({
                finalPrompt: data.chat,
                selectedActiveEntries,
                disabledEntries,
                manualEntries,
            });

            console.debug(`${MODULE_NAME}: chat completion prompt updated.`);
        });
    } catch (error) {
        console.error(`${MODULE_NAME}: failed to review chat completion prompt.`, error);
        toastr.error(`${MODULE_NAME}: failed to review prompt. Check browser console.`);
    }
});

eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, async (data) => {
    if (!settings.enabled || data.dryRun || typeof data.prompt !== 'string') return;

    if (isLikelyChatCompletionMode()) {
        console.debug(`${MODULE_NAME}: skipped GENERATE_AFTER_COMBINE_PROMPTS because CHAT_COMPLETION_PROMPT_READY will handle this generation.`);
        return;
    }

    try {
        const triggerScanOptions = settings.triggerWordDetectionEnabled
            ? buildTriggerScanOptions()
            : {};
        const result = await reviewPrompt(data.prompt, { ...triggerScanOptions, skipWhenNoActive: true });

        await handleReviewResult(result, async ({ disabledEntries, manualEntries, selectedActiveEntries }) => {
            data.prompt = removeEntriesFromTextPrompt(data.prompt, disabledEntries);
            data.prompt = replaceEditedEntriesInTextPrompt(data.prompt, selectedActiveEntries);
            data.prompt = injectManualEntriesIntoTextPrompt(data.prompt, manualEntries);

            await queueItemizedPromptCorrection({
                finalPrompt: data.prompt,
                selectedActiveEntries,
                disabledEntries,
                manualEntries,
            });

            console.debug(`${MODULE_NAME}: text completion prompt updated.`);
        });
    } catch (error) {
        console.error(`${MODULE_NAME}: failed to review text completion prompt.`, error);
        toastr.error(`${MODULE_NAME}: failed to review prompt. Check browser console.`);
    }
});

eventSource.on(event_types.GENERATE_AFTER_DATA, () => {
    scheduleItemizedPromptCorrectionFlush();
});

(function init() {
    validateRequiredEvents();
    addLaunchButton();
    console.log(`${MODULE_NAME}: initialized. main_api=${main_api}`);
})();
