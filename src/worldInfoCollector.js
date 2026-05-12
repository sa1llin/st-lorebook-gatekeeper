export async function collectWorldInfoEntries() {
    const context = SillyTavern.getContext();

    if (typeof context.getWorldInfoNames !== 'function') {
        throw new Error('getWorldInfoNames is not available in the current SillyTavern context.');
    }

    if (typeof context.loadWorldInfo !== 'function') {
        throw new Error('loadWorldInfo is not available in the current SillyTavern context.');
    }

    const bookNames = context.getWorldInfoNames();
    const entries = [];

    for (const bookName of bookNames) {
        try {
            const book = await context.loadWorldInfo(bookName);
            const bookEntries = normalizeBookEntries(bookName, book);
            entries.push(...bookEntries);
        } catch (error) {
            console.warn(`Lorebook Gatekeeper: failed to load world info book "${bookName}".`, error);
        }
    }

    return entries;
}

function normalizeBookEntries(bookName, book) {
    if (!book || !book.entries) {
        return [];
    }

    return Object.values(book.entries)
        .map((entry) => normalizeWorldInfoEntry(bookName, entry))
        .filter(Boolean);
}

function normalizeWorldInfoEntry(bookName, entry) {
    if (!entry || entry.disable === true) {
        return null;
    }

    const content = String(entry.content || '').trim();

    if (!content) {
        return null;
    }

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
        raw: entry,
        active: false,
        matchType: 'none',
        selected: false,
        originallyActive: false,
        tokens: 0,
    };
}

function normalizeStringArray(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item)).filter(Boolean);
    }

    if (typeof value === 'string' && value.trim()) {
        return [value.trim()];
    }

    return [];
}

function cryptoRandomId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
