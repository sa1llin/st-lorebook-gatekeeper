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

    const extensionsMenu = document.getElementById('prompt_inspector_wand_container') ?? document.getElementById('extensionsMenu');

    if (!extensionsMenu) {
        console.warn(`${MODULE_NAME}: extensions menu was not found. Toggle button was not added.`);
        return;
    }

    extensionsMenu.appendChild(launchButton);

    launchButton.addEventListener('click', () => {
        settings.enabled = !settings.enabled;
        saveSettings(settings);
        updateButtonView();
        toastr.info(`${MODULE_NAME} ${settings.enabled ? 'enabled' : 'disabled'}.`);
    });
}

function isLikelyChatCompletionMode() {
    return String(main_api || '').toLowerCase() === 'openai';
}

async function reviewPrompt(promptText, options = {}) {
    const allEntries = await collectWorldInfoEntries();
    const activeEntries = findActiveEntries(allEntries, promptText, {
        triggerScanText: options.triggerScanText,
        triggerScanMessages: options.triggerScanMessages,
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
    const triggerScanMessages = getTriggerScanMessages(fallbackChat);
    const defaultScanDepth = getWorldInfoScanDepth();
    const includeNames = getWorldInfoIncludeNames();
    const caseSensitive = Boolean(world_info_case_sensitive);
    const matchWholeWords = Boolean(world_info_match_whole_words);

    const triggerScanText = buildTriggerScanTextFromMessages(triggerScanMessages, defaultScanDepth, includeNames);

    console.debug(`${MODULE_NAME}: trigger scan prepared.`, {
        sourceMessages: triggerScanMessages.length,
        defaultScanDepth,
        triggerScanTextLength: triggerScanText.length,
    });

    return {
        triggerScanText,
        triggerScanMessages,
        defaultScanDepth,
        includeNames,
        caseSensitive,
        matchWholeWords,
    };
}

function getTriggerScanMessages(fallbackChat = []) {
    const context = getSafeContext();
    const candidates = [
        context?.chat,
        globalThis.chat,
        fallbackChat,
    ];

    for (const candidate of candidates) {
        if (!Array.isArray(candidate) || !candidate.length) continue;

        const messages = normalizeTriggerMessages(candidate);
        if (messages.length) return messages;
    }

    return [];
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
    const importedDepth = Number(world_info_depth);
    if (Number.isFinite(importedDepth) && importedDepth >= 0) return Math.floor(importedDepth);

    const candidates = [
        getNumericDomValue('#world_info_depth'),
        getNumericDomValue('#world_info_depth_counter'),
        getNumericDomValue('#wi_depth'),
        getNumericDomValue('#world_info_scan_depth'),
        getNumericDomValue('[name="world_info_depth"]'),
        getNestedNumber(globalThis, ['world_info_depth']),
        getNestedNumber(globalThis, ['power_user', 'world_info_depth']),
        getNestedNumber(globalThis, ['power_user', 'world_info', 'depth']),
        getNestedNumber(globalThis, ['SillyTavern', 'settings', 'world_info_depth']),
    ];

    const context = getSafeContext();
    candidates.push(
        getNestedNumber(context, ['world_info_depth']),
        getNestedNumber(context, ['worldInfoDepth']),
        getNestedNumber(context, ['worldInfoSettings', 'depth']),
        getNestedNumber(context, ['powerUserSettings', 'world_info_depth']),
        getNestedNumber(context, ['extensionSettings', 'world_info_depth']),
    );

    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value >= 0) return Math.floor(value);
    }

    return 2;
}

function getWorldInfoIncludeNames() {
    if (typeof world_info_include_names === 'boolean') return world_info_include_names;
    return true;
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
        const triggerScanOptions = buildTriggerScanOptions(data.chat);
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
        const triggerScanOptions = buildTriggerScanOptions();
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
