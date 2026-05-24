import { itemizedPrompts } from '../../../../../script.js';
import { formatManualEntries, removeEntriesFromTextPrompt } from './promptPatcher.js';
import { countTextTokens } from './tokenCounter.js';

const FLUSH_DELAYS_MS = [0, 25, 100, 300, 750];
let pendingPatch = null;

export async function queueItemizedPromptCorrection({
    finalPrompt,
    selectedActiveEntries = [],
    disabledEntries = [],
    manualEntries = [],
}) {
    const flattenedPrompt = flattenPrompt(finalPrompt);
    const worldInfoString = buildWorldInfoString(selectedActiveEntries, manualEntries);

    pendingPatch = {
        minItemizedLength: Array.isArray(itemizedPrompts) ? itemizedPrompts.length : 0,
        finalPrompt: clonePrompt(finalPrompt),
        flattenedPrompt,
        worldInfoString,
        disabledEntries,
        manualEntries,
        selectedActiveEntries,
        finalPromptTokens: await countTextTokens(flattenedPrompt, 'final patched prompt'),
        worldInfoStringTokens: await countTextTokens(worldInfoString, 'patched world info'),
        createdAt: Date.now(),
    };
}

export function scheduleItemizedPromptCorrectionFlush() {
    if (!pendingPatch) return;
    for (const delay of FLUSH_DELAYS_MS) {
        setTimeout(() => applyPendingPatch(), delay);
    }
}

function applyPendingPatch() {
    if (!pendingPatch || !Array.isArray(itemizedPrompts)) return;
    if (itemizedPrompts.length <= pendingPatch.minItemizedLength) return;

    const target = itemizedPrompts[itemizedPrompts.length - 1];
    if (!target || target.lorebookGatekeeperPatchedAt >= pendingPatch.createdAt) return;

    target.rawPrompt = clonePrompt(pendingPatch.finalPrompt);
    target.finalPrompt = pendingPatch.flattenedPrompt;
    target.worldInfoString = pendingPatch.worldInfoString;

    patchStringField(target, 'storyString', pendingPatch);
    patchStringField(target, 'beforeScenarioAnchor', pendingPatch);
    patchStringField(target, 'afterScenarioAnchor', pendingPatch);
    patchStringField(target, 'allAnchors', pendingPatch);
    patchStringField(target, 'mesSendString', pendingPatch);

    target.lorebookGatekeeperPatchedAt = Date.now();
    target.lorebookGatekeeper = {
        finalPromptTokens: pendingPatch.finalPromptTokens,
        worldInfoStringTokens: pendingPatch.worldInfoStringTokens,
        disabledActive: pendingPatch.disabledEntries.length,
        manualEntries: pendingPatch.manualEntries.length,
    };

    if (target.main_api === 'openai') {
        target.oaiTotalTokens = pendingPatch.finalPromptTokens;
    }

    pendingPatch = null;
}

function patchStringField(target, fieldName, patch) {
    if (typeof target?.[fieldName] !== 'string') return;
    target[fieldName] = removeEntriesFromTextPrompt(target[fieldName], patch.disabledEntries);
}

function buildWorldInfoString(selectedActiveEntries, manualEntries) {
    const activeText = selectedActiveEntries
        .map((entry) => String(entry.content || '').trim())
        .filter(Boolean)
        .join('\n\n');

    const manualText = formatManualEntries(manualEntries);
    return [activeText, manualText].filter(Boolean).join('\n\n').trim();
}

function clonePrompt(prompt) {
    try {
        return structuredClone(prompt);
    } catch {
        return JSON.parse(JSON.stringify(prompt));
    }
}

function flattenPrompt(prompt) {
    if (Array.isArray(prompt)) {
        return prompt
            .map((message) => {
                if (typeof message?.content === 'string') return message.content;
                if (Array.isArray(message?.content)) {
                    return message.content.map((part) => part?.text || part?.content || '').join('\n');
                }
                return '';
            })
            .filter(Boolean)
            .join('\n\n');
    }

    if (typeof prompt === 'string') return prompt;

    if (prompt && typeof prompt === 'object') {
        try {
            return JSON.stringify(prompt);
        } catch {
            return String(prompt);
        }
    }

    return '';
}
