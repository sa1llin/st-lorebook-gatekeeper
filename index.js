import { eventSource, event_types, main_api, stopGeneration } from '../../../../script.js';
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

function buildTriggerScanTextFromChat(chat) {
    if (!Array.isArray(chat) || !chat.length) return '';

    const depth = getWorldInfoScanDepth();
    if (depth <= 0) return '';

    const historyLikeMessages = chat.filter((message) => {
        const role = String(message?.role || '').toLowerCase();
        return role === 'user' || role === 'assistant';
    });

    const sourceMessages = historyLikeMessages.length ? historyLikeMessages : chat;

    return sourceMessages
        .slice(-depth)
        .map(formatMessageForTriggerScan)
        .filter(Boolean)
        .join('\n');
}

function formatMessageForTriggerScan(message) {
    const name = String(message?.name || message?.sender || '').trim();
    const content = extractMessageContent(message);

    if (!content) return '';
    return name ? `${name}: ${content}` : content;
}

function extractMessageContent(message) {
    if (!message) return '';

    if (typeof message === 'string') return message;
    if (typeof message.content === 'string') return message.content;
    if (typeof message.mes === 'string') return message.mes;
    if (typeof message.message === 'string') return message.message;

    if (Array.isArray(message.content)) {
        return message.content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (typeof part?.text === 'string') return part.text;
                if (typeof part?.content === 'string') return part.content;
                return '';
            })
            .filter(Boolean)
            .join('\n');
    }

    return '';
}

function getWorldInfoScanDepth() {
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
        getNestedNumber(globalThis, ['SillyTavern', 'getContext']),
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

    // Safe fallback: prevents old hidden history from being treated as the current trigger source.
    return 2;
}

function getSafeContext() {
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
        const triggerScanText = buildTriggerScanTextFromChat(data.chat);
        const result = await reviewPrompt(promptText, { triggerScanText });

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
        const result = await reviewPrompt(data.prompt, { skipWhenNoActive: true });

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
