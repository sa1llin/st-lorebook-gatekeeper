// IMPORTANT:
// This file is loaded from /scripts/extensions/third-party/st-lorebook-gatekeeper/src/.
// script.js is located at the web root, so the correct relative path is ../../../../../script.js.
// Using ../../../../script.js resolves to /scripts/script.js and causes 404 on load.
import { getRequestHeaders, chat_metadata, characters, this_chid } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';
import { power_user } from '../../../../power-user.js';

let worldInfoModulePromise = null;

export async function collectWorldInfoEntries() {
    const context = getSafeContext();
    const worldInfoModule = await getWorldInfoModule();
    const bookNames = await getAvailableWorldInfoNames(context, worldInfoModule);
    const loadWorldInfoFn = getLoadWorldInfoFunction(context, worldInfoModule);
    const sourceHints = getLorebookSourceHints(context, worldInfoModule);

    if (!bookNames.length) {
        console.warn('Lorebook Gatekeeper: no World Info books were found. Review will open with an empty lorebook list.');
        return [];
    }

    const entries = [];

    for (const bookName of bookNames) {
        try {
            const book = await loadWorldInfoFn(bookName);
            const sourceType = sourceHints.get(bookName) || 'other';
            entries.push(...normalizeBookEntries(bookName, book, sourceType));
        } catch (error) {
            console.warn(`Lorebook Gatekeeper: failed to load world info book "${bookName}".`, error);
        }
    }

    return dedupeEntries(entries);
}

function getSafeContext() {
    try {
        if (typeof getContext === 'function') return getContext();
    } catch (error) {
        console.warn('Lorebook Gatekeeper: getContext import failed.', error);
    }

    try {
        return globalThis.SillyTavern?.getContext?.() ?? null;
    } catch (error) {
        console.warn('Lorebook Gatekeeper: SillyTavern.getContext failed.', error);
        return null;
    }
}

async function getWorldInfoModule() {
    if (!worldInfoModulePromise) {
        worldInfoModulePromise = import('../../../../world-info.js')
            .catch((error) => {
                console.warn('Lorebook Gatekeeper: direct world-info.js import failed. API fallback will be used.', error);
                return null;
            });
    }

    return await worldInfoModulePromise;
}

async function getAvailableWorldInfoNames(context, worldInfoModule) {
    const sources = [];

    try {
        if (typeof context?.getWorldInfoNames === 'function') sources.push(context.getWorldInfoNames());
    } catch (error) {
        console.warn('Lorebook Gatekeeper: context.getWorldInfoNames failed.', error);
    }

    if (Array.isArray(worldInfoModule?.world_names)) sources.push(worldInfoModule.world_names);

    try {
        if (typeof worldInfoModule?.updateWorldInfoList === 'function' && !flattenNames(sources).length) {
            await worldInfoModule.updateWorldInfoList();
            if (Array.isArray(worldInfoModule?.world_names)) sources.push(worldInfoModule.world_names);
        }
    } catch (error) {
        console.warn('Lorebook Gatekeeper: updateWorldInfoList fallback failed.', error);
    }

    const apiNames = await fetchWorldInfoNamesFromSettingsApi();
    if (apiNames.length) sources.push(apiNames);

    const domNames = getWorldInfoNamesFromDom();
    if (domNames.length) sources.push(domNames);

    return flattenNames(sources);
}

function flattenNames(sources) {
    const names = [];

    for (const source of sources) {
        if (!Array.isArray(source)) continue;

        for (const name of source) {
            const normalized = String(name || '').trim();
            if (normalized && !names.includes(normalized)) names.push(normalized);
        }
    }

    return names;
}

async function fetchWorldInfoNamesFromSettingsApi() {
    try {
        const response = await fetch('/api/settings/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({}),
            cache: 'no-cache',
        });

        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data?.world_names) ? data.world_names : [];
    } catch (error) {
        console.warn('Lorebook Gatekeeper: /api/settings/get fallback failed.', error);
        return [];
    }
}

function getWorldInfoNamesFromDom() {
    const names = [];

    try {
        $('#world_info option, #world_editor_select option').each((_, option) => {
            const text = String(option?.textContent || '').trim();
            if (text && !names.includes(text)) names.push(text);
        });
    } catch (error) {
        console.warn('Lorebook Gatekeeper: DOM world info name fallback failed.', error);
    }

    return names;
}

function getLoadWorldInfoFunction(context, worldInfoModule) {
    if (typeof context?.loadWorldInfo === 'function') return context.loadWorldInfo.bind(context);
    if (typeof worldInfoModule?.loadWorldInfo === 'function') return worldInfoModule.loadWorldInfo.bind(worldInfoModule);
    return loadWorldInfoViaApi;
}

async function loadWorldInfoViaApi(bookName) {
    const response = await fetch('/api/worldinfo/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name: bookName }),
        cache: 'no-cache',
    });

    if (!response.ok) throw new Error(`/api/worldinfo/get returned ${response.status} for "${bookName}".`);
    return await response.json();
}

function getLorebookSourceHints(context, worldInfoModule) {
    const hints = new Map();
    const metadataKey = worldInfoModule?.METADATA_KEY || 'world_info';

    const chatBook = firstString(
        chat_metadata?.[metadataKey],
        context?.chatMetadata?.[metadataKey],
        globalThis.chat_metadata?.[metadataKey],
    );
    addSourceHint(hints, chatBook, 'chat');

    const personaBook = firstString(
        power_user?.persona_description_lorebook,
        context?.powerUser?.persona_description_lorebook,
        globalThis.power_user?.persona_description_lorebook,
    );
    addSourceHint(hints, personaBook, 'persona');

    const characterBook = firstString(
        characters?.[this_chid]?.data?.extensions?.world,
        context?.characters?.[context?.this_chid]?.data?.extensions?.world,
    );
    addSourceHint(hints, characterBook, 'character');

    const globalBooks = [
        ...(Array.isArray(worldInfoModule?.selected_world_info) ? worldInfoModule.selected_world_info : []),
        ...(Array.isArray(worldInfoModule?.world_info?.globalSelect) ? worldInfoModule.world_info.globalSelect : []),
        ...(Array.isArray(context?.worldInfo?.globalSelect) ? context.worldInfo.globalSelect : []),
    ];
    for (const bookName of globalBooks) addSourceHint(hints, bookName, 'global');

    return hints;
}

function addSourceHint(hints, bookName, sourceType) {
    const normalized = String(bookName || '').trim();
    if (!normalized) return;

    const current = hints.get(normalized);
    if (!current || getSourcePriority(sourceType) < getSourcePriority(current)) {
        hints.set(normalized, sourceType);
    }
}

function firstString(...values) {
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (normalized) return normalized;
    }

    return '';
}

function normalizeBookEntries(bookName, book, sourceType = 'other') {
    if (!book || !book.entries) return [];

    return Object.values(book.entries)
        .map((entry) => normalizeWorldInfoEntry(bookName, entry, sourceType))
        .filter(Boolean);
}

function normalizeWorldInfoEntry(bookName, entry, sourceType) {
    if (!entry || entry.disable === true) return null;

    const content = String(entry.content || '').trim();
    if (!content) return null;

    const uid = entry.uid ?? entry.id ?? cryptoRandomId();

    return {
        id: `${bookName}:${uid}`,
        bookName,
        uid,
        title: String(entry.comment || entry.name || `Entry ${uid}`),
        content,
        keys: normalizeStringArray(entry.key),
        secondaryKeys: normalizeStringArray(entry.keysecondary),
        order: Number(entry.order ?? 0),
        position: entry.position,
        depth: entry.depth,
        role: entry.role,
        constant: Boolean(entry.constant),
        selective: Boolean(entry.selective),
        sourceType,
        sourcePriority: getSourcePriority(sourceType),
        raw: entry,
        active: false,
        matchType: 'none',
        selected: false,
        originallyActive: false,
        tokens: 0,
    };
}

function normalizeStringArray(value) {
    if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    return [];
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

function dedupeEntries(entries) {
    const seen = new Set();
    const result = [];

    for (const entry of entries) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        result.push(entry);
    }

    return result;
}

function cryptoRandomId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
