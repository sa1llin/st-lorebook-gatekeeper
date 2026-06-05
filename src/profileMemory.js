const PROFILE_STORAGE_KEY = 'LorebookGatekeeper_saved_profiles_v1';

export function loadProfiles() {
    try {
        const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((profile) => profile && typeof profile === 'object')
            .map(normalizeProfile)
            .filter((profile) => profile.id && profile.name);
    } catch (error) {
        console.warn('Lorebook Gatekeeper: failed to load saved profiles.', error);
        return [];
    }
}

export function saveProfiles(profiles) {
    const normalized = Array.isArray(profiles) ? profiles.map(normalizeProfile).filter((profile) => profile.id && profile.name) : [];
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
}

export function createProfileFromEntries(name, entries) {
    const selectedEntries = Array.isArray(entries) ? entries.filter((entry) => entry?.selected) : [];
    const createdAt = new Date().toISOString();

    return normalizeProfile({
        id: createProfileId(),
        name: String(name || '').trim() || 'Untitled profile',
        createdAt,
        updatedAt: createdAt,
        selectedEntryIds: selectedEntries.map((entry) => String(entry.id || entry.stableId || '')).filter(Boolean),
        entries: selectedEntries.map((entry) => ({
            id: String(entry.id || entry.stableId || ''),
            stableId: String(entry.stableId || entry.id || ''),
            title: String(entry.title || 'Untitled entry'),
            bookName: String(entry.bookName || ''),
            sourceType: String(entry.sourceType || ''),
            originallyActive: Boolean(entry.originallyActive),
        })).filter((entry) => entry.id),
    });
}

export function upsertProfile(profile) {
    const normalized = normalizeProfile(profile);
    const profiles = loadProfiles();
    const index = profiles.findIndex((item) => item.id === normalized.id);

    if (index >= 0) profiles[index] = normalized;
    else profiles.push(normalized);

    return saveProfiles(profiles);
}

export function deleteProfile(profileId) {
    const id = String(profileId || '');
    return saveProfiles(loadProfiles().filter((profile) => profile.id !== id));
}

export function replaceProfileSelection(profileId, entries) {
    const profiles = loadProfiles();
    const index = profiles.findIndex((profile) => profile.id === profileId);
    if (index < 0) return profiles;

    const replacement = createProfileFromEntries(profiles[index].name, entries);
    replacement.id = profiles[index].id;
    replacement.createdAt = profiles[index].createdAt;
    replacement.updatedAt = new Date().toISOString();
    profiles[index] = normalizeProfile(replacement);

    return saveProfiles(profiles);
}

function normalizeProfile(profile) {
    const selectedEntryIds = toStringArray(profile?.selectedEntryIds);
    const entries = Array.isArray(profile?.entries) ? profile.entries : [];
    const entryIdsFromItems = entries.map((entry) => String(entry?.id || entry?.stableId || '')).filter(Boolean);
    const uniqueIds = uniqueStrings([...selectedEntryIds, ...entryIdsFromItems]);

    return {
        id: String(profile?.id || createProfileId()),
        name: String(profile?.name || 'Untitled profile').trim() || 'Untitled profile',
        createdAt: String(profile?.createdAt || new Date().toISOString()),
        updatedAt: String(profile?.updatedAt || profile?.createdAt || new Date().toISOString()),
        selectedEntryIds: uniqueIds,
        entries: entries.map((entry) => ({
            id: String(entry?.id || entry?.stableId || ''),
            stableId: String(entry?.stableId || entry?.id || ''),
            title: String(entry?.title || 'Untitled entry'),
            bookName: String(entry?.bookName || ''),
            sourceType: String(entry?.sourceType || ''),
            originallyActive: Boolean(entry?.originallyActive),
        })).filter((entry) => entry.id),
    };
}

function createProfileId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `profile_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function uniqueStrings(values) {
    return [...new Set(toStringArray(values))];
}
