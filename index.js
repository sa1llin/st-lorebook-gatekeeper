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

    const extensionsMenu = document.getElementById('prompt_inspector_wand_container')
        ?? document.getElementById('extensionsMenu');

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
    const activeEntries = findActiveEntries(allEntries, promptText);
    const { inactiveEntries } = splitActiveAndInactive(allEntries, activeEntries);
    const hasLockedEntries = allEntries.some((entry) => isLocked(settings, entry));

    if (options.skipWhenNoActive && activeEntries.length === 0 && !hasLockedEntries && !settings.showManualOnlyWhenNoActive) {
        console.debug(`${MODULE_NAME}: skipped preliminary prompt review because no active or locked Lorebook entries were detected.`);
        return { action: 'discard', disabledEntries: [], manualEntries: [], selectedActiveEntries: [] };
    }

    await addTokenCounts(activeEntries);
    if (settings.countInactiveTokens) await addTokenCounts(inactiveEntries);

    const statsBefore = buildTokenStats(activeEntries, inactiveEntries);
    const result = await showLorebookReviewPopup({
        activeEntries,
        inactiveEntries,
        statsBefore,
        settings,
        promptText,
    });

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

eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, async (data) => {
    if (!settings.enabled || data.dryRun || !Array.isArray(data.chat)) return;

    try {
        const promptText = getPromptTextFromChat(data.chat);
        const result = await reviewPrompt(promptText);

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

function injectTriggerReasonRollbackStyles() {
    const styleId = 'lorebook-gatekeeper-trigger-reason-rollback-style';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        .lbg-keyword-highlight {
            background: transparent !important;
            color: inherit !important;
            border: 0 !important;
            padding: 0 !important;
        }
    `;
    document.head.appendChild(style);
}

(function init() {
    validateRequiredEvents();
    settings.triggerWordDetectionEnabled = false;
    injectTriggerReasonRollbackStyles();
    addLaunchButton();
    console.log(`${MODULE_NAME}: initialized. main_api=${main_api}`);
})();
