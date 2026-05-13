import { getContext } from '../../../../extensions.js';
import { getTokenCountAsync as getTokenCountAsyncDirect } from '../../../../tokenizers.js';
import { TOKEN_CACHE_KEY } from './constants.js';

export async function addTokenCounts(entries) {
    const tokenCounter = getTokenCounter();
    const cache = readTokenCache();
    let changed = false;

    for (const entry of entries) {
        const cacheKey = buildCacheKey(entry);

        if (Number.isFinite(cache[cacheKey])) {
            entry.tokens = cache[cacheKey];
            continue;
        }

        try {
            entry.tokens = typeof tokenCounter === 'function' ? await tokenCounter(entry.content) : estimateTokens(entry.content);
        } catch (error) {
            console.warn(`Lorebook Gatekeeper: token count failed for ${entry.id}.`, error);
            entry.tokens = estimateTokens(entry.content);
        }

        cache[cacheKey] = entry.tokens;
        changed = true;
    }

    if (changed) writeTokenCache(cache);
    return entries;
}

export function buildTokenStats(activeEntries, inactiveEntries = []) {
    const activeTokens = sumTokens(activeEntries);
    const inactiveTokens = sumTokens(inactiveEntries);
    return { activeCount: activeEntries.length, inactiveCount: inactiveEntries.length, activeTokens, inactiveTokens, totalKnownTokens: activeTokens + inactiveTokens };
}

export function sumTokens(entries) {
    return entries.reduce((sum, entry) => sum + Number(entry.tokens || 0), 0);
}

function getTokenCounter() {
    try {
        const context = typeof getContext === 'function' ? getContext() : null;
        if (typeof context?.getTokenCountAsync === 'function') return context.getTokenCountAsync.bind(context);
    } catch (error) {
        console.warn('Lorebook Gatekeeper: context token counter unavailable.', error);
    }

    if (typeof getTokenCountAsyncDirect === 'function') return getTokenCountAsyncDirect;

    try {
        const context = globalThis.SillyTavern?.getContext?.();
        if (typeof context?.getTokenCountAsync === 'function') return context.getTokenCountAsync.bind(context);
    } catch (error) {
        console.warn('Lorebook Gatekeeper: global token counter unavailable.', error);
    }

    return null;
}

function estimateTokens(text) {
    return Math.ceil(String(text || '').length / 4);
}

function buildCacheKey(entry) {
    return `${entry.bookName}:${entry.uid}:${entry.content.length}:${hashString(entry.content)}`;
}

function hashString(value) {
    let hash = 0;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
    }
    return String(hash);
}

function readTokenCache() {
    try {
        const raw = localStorage.getItem(TOKEN_CACHE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function writeTokenCache(cache) {
    try {
        const keys = Object.keys(cache);
        const trimmed = {};
        const maxItems = 5000;
        for (const key of keys.slice(Math.max(0, keys.length - maxItems))) trimmed[key] = cache[key];
        localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify(trimmed));
    } catch (error) {
        console.warn('Lorebook Gatekeeper: failed to write token cache.', error);
    }
}
