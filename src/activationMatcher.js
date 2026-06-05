export function findActiveEntries(entries, promptText, options = {}) {
    const normalizedPrompt = normalizeForMatching(promptText);

    return entries
        .map((entry) => {
            const matchType = getEntryMatchType(entry, promptText, normalizedPrompt);
            if (matchType === 'none') return null;

            const triggerScanTexts = buildTriggerScanTextsForEntry(entry, options);
            const matchedKeywords = findMatchedKeywords(entry, triggerScanTexts, options);

            return {
                ...entry,
                active: true,
                originallyActive: true,
                selected: true,
                matchType,
                matchedKeywords,
                triggerMatchSource: matchedKeywords.length ? getFirstTriggerMatchSource(entry, triggerScanTexts, matchedKeywords, options) : '',
            };
        })
        .filter(Boolean);
}

export function splitActiveAndInactive(entries, activeEntries) {
    const activeIds = new Set(activeEntries.map((entry) => entry.id));

    return {
        activeEntries,
        inactiveEntries: entries
            .filter((entry) => !activeIds.has(entry.id))
            .map((entry) => ({
                ...entry,
                active: false,
                originallyActive: false,
                selected: false,
                matchType: 'none',
                matchedKeywords: [],
                triggerMatchSource: '',
            })),
    };
}

function buildTriggerScanTextsForEntry(entry, options = {}) {
    const scanDepth = getEntryScanDepth(entry, options.defaultScanDepth);
    const includeNames = options.includeNames !== false;
    const texts = [];

    if (Array.isArray(options.triggerScanMessageSources) && options.triggerScanMessageSources.length) {
        for (const source of options.triggerScanMessageSources) {
            const messages = Array.isArray(source?.messages) ? source.messages : [];
            const text = buildScanTextFromMessages(messages, scanDepth, includeNames);
            addUniqueScanText(texts, text, source?.label || 'messages');
        }
    }

    if (Array.isArray(options.triggerScanMessages) && options.triggerScanMessages.length) {
        const text = buildScanTextFromMessages(options.triggerScanMessages, scanDepth, includeNames);
        addUniqueScanText(texts, text, 'triggerScanMessages');
    }

    if (Array.isArray(options.triggerScanTexts)) {
        for (const item of options.triggerScanTexts) {
            if (typeof item === 'string') {
                addUniqueScanText(texts, item, 'triggerScanText');
            } else {
                addUniqueScanText(texts, item?.text, item?.label || 'triggerScanText');
            }
        }
    }

    if (Object.prototype.hasOwnProperty.call(options, 'triggerScanText')) {
        addUniqueScanText(texts, options.triggerScanText, 'triggerScanText');
    }

    return texts;
}

function addUniqueScanText(texts, value, label = 'scan') {
    const text = normalizeForMatching(value);
    if (!text) return;
    if (texts.some((item) => item.text === text)) return;
    texts.push({ text, label });
}

function buildScanTextFromMessages(messages, scanDepth, includeNames = true) {
    const depth = Number(scanDepth);
    if (!Number.isFinite(depth) || depth <= 0 || !Array.isArray(messages) || !messages.length) return '';

    return messages
        .slice(-Math.floor(depth))
        .map((message) => formatMessageForScan(message, includeNames))
        .filter(Boolean)
        .join('\n');
}

function formatMessageForScan(message, includeNames = true) {
    if (typeof message === 'string') return message;

    const content = extractMessageContent(message);
    if (!content) return '';

    if (!includeNames) return content;

    const name = String(
        message?.name
        ?? message?.sender
        ?? message?.extra?.name
        ?? message?.role
        ?? '',
    ).trim();

    return name ? `${name}: ${content}` : content;
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

function getEntryScanDepth(entry, fallbackDepth) {
    const candidates = [
        entry?.scanDepth,
        entry?.scan_depth,
        entry?.raw?.scanDepth,
        entry?.raw?.scan_depth,
        entry?.raw?.scan_depth_override,
        entry?.raw?.scanDepthOverride,
    ];

    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }

    const fallback = Number(fallbackDepth);
    return Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : 2;
}

function findMatchedKeywords(entry, triggerScanTexts, options = {}) {
    const keys = getEntryKeywords(entry);
    if (!keys.length) return [];

    const scanTexts = normalizeScanTextList(triggerScanTexts);
    if (!scanTexts.length) return [];

    const matched = [];

    for (const key of keys) {
        if (!key || matched.some((value) => value.toLowerCase() === key.toLowerCase())) continue;

        for (const item of scanTexts) {
            const match = matchKeyword(item.text, key, {
                caseSensitive: getEntryBooleanOption(entry, 'caseSensitive', options.caseSensitive),
                matchWholeWords: getEntryBooleanOption(entry, 'matchWholeWords', options.matchWholeWords),
            });

            if (match) {
                matched.push(match);
                break;
            }
        }
    }

    return matched;
}

function getFirstTriggerMatchSource(entry, triggerScanTexts, matchedKeywords, options = {}) {
    const firstKeyword = matchedKeywords?.[0];
    if (!firstKeyword) return '';

    const scanTexts = normalizeScanTextList(triggerScanTexts);

    for (const item of scanTexts) {
        const match = matchKeyword(item.text, firstKeyword, {
            caseSensitive: getEntryBooleanOption(entry, 'caseSensitive', options.caseSensitive),
            matchWholeWords: getEntryBooleanOption(entry, 'matchWholeWords', options.matchWholeWords),
        });

        if (match) return item.label || '';
    }

    return '';
}

function normalizeScanTextList(triggerScanTexts) {
    if (!Array.isArray(triggerScanTexts)) return [];

    return triggerScanTexts
        .map((item) => {
            if (typeof item === 'string') return { text: normalizeForMatching(item), label: 'scan' };
            return {
                text: normalizeForMatching(item?.text),
                label: String(item?.label || 'scan'),
            };
        })
        .filter((item) => item.text);
}

function getEntryKeywords(entry) {
    return [
        ...(entry?.keys || []),
        ...(entry?.secondaryKeys || []),
        entry?.raw?.key,
        entry?.raw?.keysecondary,
    ]
        .flatMap(splitPossibleKeywordList)
        .map((key) => String(key || '').trim())
        .filter(Boolean);
}

function getEntryBooleanOption(entry, fieldName, fallbackValue) {
    const candidates = [
        entry?.[fieldName],
        entry?.raw?.[fieldName],
        fieldName === 'caseSensitive' ? entry?.raw?.case_sensitive : undefined,
        fieldName === 'caseSensitive' ? entry?.raw?.caseSensitive : undefined,
        fieldName === 'matchWholeWords' ? entry?.raw?.match_whole_words : undefined,
        fieldName === 'matchWholeWords' ? entry?.raw?.matchWholeWords : undefined,
    ];

    for (const value of candidates) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true') return true;
            if (normalized === 'false') return false;
        }
    }

    return Boolean(fallbackValue);
}

function matchKeyword(text, key, options = {}) {
    const scanText = String(text || '');
    const keyword = String(key || '').trim();

    if (!scanText || !keyword) return null;

    if (isRegexKey(keyword)) {
        try {
            const regex = parseRegexKey(keyword, Boolean(options.caseSensitive));
            const match = scanText.match(regex);
            return match ? match[0] : null;
        } catch (error) {
            console.warn('Lorebook Gatekeeper: invalid regex keyword skipped.', keyword, error);
            return null;
        }
    }

    const caseSensitive = Boolean(options.caseSensitive);
    const matchWholeWords = Boolean(options.matchWholeWords);
    const haystack = caseSensitive ? scanText : scanText.toLowerCase();
    const needle = caseSensitive ? keyword : keyword.toLowerCase();

    if (!matchWholeWords) {
        return haystack.includes(needle) ? keyword : null;
    }

    const escapedNeedle = escapeRegExp(needle);
    const isSingleWord = !/\s/.test(needle);

    if (!isSingleWord) {
        return haystack.includes(needle) ? keyword : null;
    }

    // Unicode-aware word boundary. JS \b / \W are ASCII-centric and behave poorly for Cyrillic keys.
    const regex = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escapedNeedle})(?=$|[^\\p{L}\\p{N}_])`, 'u');
    return regex.test(haystack) ? keyword : null;
}

function isRegexKey(key) {
    return typeof key === 'string' && key.startsWith('/') && key.lastIndexOf('/') > 0;
}

function parseRegexKey(key, caseSensitive = false) {
    const lastSlash = key.lastIndexOf('/');
    const pattern = key.slice(1, lastSlash);
    const rawFlags = key.slice(lastSlash + 1);
    const baseFlags = caseSensitive ? rawFlags : `${rawFlags}i`;
    const flags = [...new Set(baseFlags.split('').filter(Boolean))].join('');

    return new RegExp(pattern, flags);
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitPossibleKeywordList(value) {
    if (Array.isArray(value)) return value.flatMap(splitPossibleKeywordList);

    if (value && typeof value === 'object') {
        return [
            value.key,
            value.value,
            value.text,
            value.name,
        ].flatMap(splitPossibleKeywordList);
    }

    return String(value || '')
        .split(/[,;|]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function getEntryMatchType(entry, promptText, normalizedPrompt) {
    if (!entry?.content) return 'none';

    if (promptText.includes(entry.content)) return 'exact';

    const normalizedContent = normalizeForMatching(entry.content);
    if (normalizedContent && normalizedPrompt.includes(normalizedContent)) return 'normalized';

    const compactContent = normalizeCompact(entry.content);
    const compactPrompt = normalizeCompact(promptText);

    if (compactContent.length >= 80 && compactPrompt.includes(compactContent)) return 'compact';

    return 'none';
}

function normalizeForMatching(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function normalizeCompact(text) {
    return normalizeForMatching(text).replace(/\s+/g, ' ').trim();
}
