// ==========================================
// 1-CORE-MANAGERS.JS - Data & State Management
// Anderson Homepage v3.0
//
// Contents:
// - COLOR_PALETTE (configuration)
// - AppState (state management)
// - Storage (localStorage operations)
// - GroupManager (group CRUD)
// - WebsiteManager (website CRUD)
// ==========================================

// ========================================
// CONFIGURATION & CONSTANTS
// ========================================

// Single source of truth for the release stamp. A release bumps these two and
// adds a CHANGELOG.md entry — nothing else. AppInit.applyVersionStamp() writes
// them into the <title>, the menu's "What's new" item, and the changelog modal
// header, so those three spots can never drift out of sync.
const APP_VERSION = 'v4.22';
const APP_RELEASE_DATE = '2026-08-02';

// Six hues, two intensities each. Intensity is the hierarchy tool now — a
// "calm" 0.10 tint for groups that shouldn't shout, a "bold" 0.28 tint for
// the ones that should — instead of twelve interchangeable swatches at one
// identical strength. Green is deliberately absent: it's reserved app-wide
// for the Today & Now beam and the calendar "now" bar, so it can't also mean
// "here's a group colour".
const COLOR_PALETTE = [
    { name: 'Blue', value: 'rgba(56, 132, 255, 0.10)' },
    { name: 'Blue (bold)', value: 'rgba(56, 132, 255, 0.28)' },
    { name: 'Teal', value: 'rgba(0, 190, 164, 0.10)' },
    { name: 'Teal (bold)', value: 'rgba(0, 190, 164, 0.28)' },
    { name: 'Amber', value: 'rgba(255, 138, 76, 0.10)' },
    { name: 'Amber (bold)', value: 'rgba(255, 138, 76, 0.28)' },
    { name: 'Violet', value: 'rgba(190, 110, 255, 0.10)' },
    { name: 'Violet (bold)', value: 'rgba(190, 110, 255, 0.28)' },
    { name: 'Rose', value: 'rgba(255, 92, 138, 0.10)' },
    { name: 'Rose (bold)', value: 'rgba(255, 92, 138, 0.28)' },
    { name: 'Slate', value: 'rgba(140, 155, 175, 0.10)' },
    { name: 'Slate (bold)', value: 'rgba(140, 155, 175, 0.28)' }
];

// ---------------------------------------------------------------------------
// LEGACY_COLOR_MAP — one-time migration from the old 12-swatch Material
// palette (all fixed at 0.25 alpha) to the new one, keyed by the exact old
// `value` string. 0.25 sits much closer to the new "bold" tier (0.28) than
// the "calm" one (0.10), so every legacy colour lands on its nearest hue's
// bold swatch. Groups don't validate colour against palette membership
// anywhere (Utils.isValidColor only checks CSS syntax), so an unmapped
// custom/legacy value would keep rendering fine on its own — this map exists
// so old groups pick up the new hue language (and so the old "Forest Green"
// stops putting the now-reserved green back on screen). Applied once during
// Storage.load()'s group migration pass; safe to run every load since it's a
// no-op once a group's colour is no longer an old-palette string.
const LEGACY_COLOR_MAP = {
    'rgba(30, 136, 229, 0.25)': 'rgba(56, 132, 255, 0.28)',   // Ocean Blue -> Blue (bold)
    'rgba(76, 175, 80, 0.25)': 'rgba(0, 190, 164, 0.28)',     // Forest Green -> Teal (bold) — green is reserved now
    'rgba(255, 152, 0, 0.25)': 'rgba(255, 138, 76, 0.28)',    // Sunset Orange -> Amber (bold)
    'rgba(156, 39, 176, 0.25)': 'rgba(190, 110, 255, 0.28)',  // Royal Purple -> Violet (bold)
    'rgba(233, 30, 99, 0.25)': 'rgba(255, 92, 138, 0.28)',    // Rose Pink -> Rose (bold)
    'rgba(0, 150, 136, 0.25)': 'rgba(0, 190, 164, 0.28)',     // Teal -> Teal (bold)
    'rgba(255, 87, 34, 0.25)': 'rgba(255, 138, 76, 0.28)',    // Deep Orange -> Amber (bold)
    'rgba(63, 81, 181, 0.25)': 'rgba(56, 132, 255, 0.28)',    // Indigo -> Blue (bold)
    'rgba(205, 220, 57, 0.25)': 'rgba(255, 138, 76, 0.28)',   // Lime -> Amber (bold)
    'rgba(0, 188, 212, 0.25)': 'rgba(0, 190, 164, 0.28)',     // Cyan -> Teal (bold)
    'rgba(255, 193, 7, 0.25)': 'rgba(255, 138, 76, 0.28)',    // Amber -> Amber (bold)
    'rgba(121, 85, 72, 0.25)': 'rgba(140, 155, 175, 0.28)'    // Brown -> Slate (bold)
};

// ========================================
// STATE MANAGEMENT
// ========================================

const AppState = {
    websites: [],
    groups: [],
    currentView: 'grid',
    editingId: null,
    editingGroupId: null,
    iconSize: 80,
    draggedElement: null,
    draggedId: null,
    draggedType: null,
    draggedGroupIndex: null
};

// ========================================
// STORAGE MANAGER
// ========================================

const Storage = {
    // ---------------------------------------------------------------------------
    // ALL_APP_KEYS — canonical list of every localStorage key the app uses.
    // This is the single source of truth shared with DbManager.APP_KEYS and the
    // export/import path. 'backgroundImage' is intentionally absent: it can be
    // many MBs and lives in IndexedDB (ImageStore) so it never bloats the quota.
    // 'calendarBuckets' holds per-calendar event caches (potentially large) and
    // is also excluded from the JSON export — it will be rebuilt on next fetch.
    // 'calendarProxyToken' IS included in the key list so it round-trips through
    // the SQLite mirror, but is explicitly nulled in the JSON export for security.
    // 'claudeProjectsSeen' is deliberately excluded: it's machine-derived (which
    // project folders this machine has seen Claude Code sessions in) and would
    // just be repopulated by the next hook event, so it never belongs in a backup.
    // ---------------------------------------------------------------------------
    ALL_APP_KEYS: [
        'websites', 'groups', 'theme', 'view', 'iconSize',
        'backgroundPosition', 'backgroundBlur',
        'calendarProxyUrl', 'calendarProxyToken', 'calendarSources',
        'calendarRefreshInterval', 'calendarDaysAhead', 'calendarGrouping', 'calendarHeight',
        'calendarCountdownPlacement', 'calendarCountdownWindow',
        'calendarCountdownWarnMins', 'calendarCountdownUrgentMins',
        'calendarUpcomingBarCount', 'calendarUpcomingBarFormat',
        'calendarCachedEvents', 'calendarLastFetched', 'calendarBuckets',
        'columnLayout', 'timezone1', 'timezone2', 'timezone3',
        'timezone1Label', 'timezone2Label', 'timezone3Label',
        'pomodoroState', 'pomodoroHistory', 'todos', 'todoArchive',
        'todoFontSettings', 'calendarFontSettings',
        'virtualGroupPositions', 'minimapOpen',
        'claudeProjectsSettings', 'claudeProjectsNames'
    ],

    // Current export format version. Bump when the shape changes in a
    // backwards-incompatible way so import() can apply migrations.
    EXPORT_VERSION: 2,

    save() {
        // Website icons (base64) live in IndexedDB, not localStorage — keep them
        // out of the saved JSON so they don't bloat or exhaust the ~5MB quota.
        // They stay on the in-memory objects for rendering.
        const slimWebsites = AppState.websites.map(w => {
            if (w.icon) { const { icon, ...rest } = w; return rest; }
            return w;
        });
        Utils.safeLocalStorageSet('websites', JSON.stringify(slimWebsites));
        Utils.safeLocalStorageSet('groups', JSON.stringify(AppState.groups));
    },

    load() {
        const savedWebsites = localStorage.getItem('websites');
        if (savedWebsites) {
            const parsed = Utils.safeJSONParse(savedWebsites, []);
            AppState.websites = Array.isArray(parsed) ? parsed : [];
        }

        const savedGroups = localStorage.getItem('groups');
        if (savedGroups) {
            const parsed = Utils.safeJSONParse(savedGroups, null);
            if (Array.isArray(parsed) && parsed.length > 0) {
                AppState.groups = parsed;
            }
        }

        if (!savedGroups || !Array.isArray(AppState.groups) || AppState.groups.length === 0) {
            AppState.groups = [{
                id: 'ungrouped',
                name: 'My Apps',
                color: COLOR_PALETTE[0].value,
                width: 'full',
                position: 999999,
            }];
            this.save();
        }

        // Migrate: Ensure all groups have required properties
        let colCounter = 0;
        let migratedLegacyColor = false;
        AppState.groups.forEach((group, index) => {
            if (!group.width) group.width = 'full';
            if (group.collapsed === undefined) group.collapsed = false;

            // Migrate: snap old 12-swatch Material colours onto the new palette
            // (see LEGACY_COLOR_MAP above). Anything else — a custom colour, or
            // an already-migrated one — passes through untouched.
            // hasOwn, not a bare lookup: a stored colour of "constructor" or
            // "toString" would otherwise hit Object.prototype, resolve truthy,
            // and assign a *function* to group.color — which JSON.stringify then
            // drops on save, silently losing the group's colour for good.
            if (typeof group.color === 'string' && Object.hasOwn(LEGACY_COLOR_MAP, group.color)) {
                group.color = LEGACY_COLOR_MAP[group.color];
                migratedLegacyColor = true;
            }

            if (group.position === undefined) {
                if (group.id === 'ungrouped') {
                    group.position = 999999;
                } else if (group.order !== undefined) {
                    group.position = group.order + 1;
                } else {
                    group.position = index + 1;
                }
            }

            // Migrate: assign column (1 or 2) if missing
            if (group.column === undefined) {
                if (group.width === 'full' || group.id === 'ungrouped') {
                    group.column = 1; // full-width spans both, column value ignored
                } else {
                    // Alternate non-full groups between columns
                    group.column = (colCounter % 2) + 1;
                    colCounter++;
                }
            }
        });

        // Persist the colour migration immediately so it doesn't silently
        // depend on the user happening to edit a group afterwards.
        if (migratedLegacyColor) this.save();

        this.sortGroups();

        AppState.websites.forEach(website => {
            if (!website.groupId) website.groupId = 'ungrouped';
            if (website.clickCount === undefined) website.clickCount = 0;
            if (website.lastOpened === undefined) website.lastOpened = null;
            if (website.favorite === undefined) website.favorite = false;
        });

        const savedView = localStorage.getItem('view');
        if (savedView) {
            AppState.currentView = savedView;
        }

        const savedSize = localStorage.getItem('iconSize');
        if (savedSize) {
            AppState.iconSize = parseInt(savedSize);
        }
    },

    sortGroups() {
        AppState.groups.sort((a, b) => {
            if (a.id === 'ungrouped') return 1;
            if (b.id === 'ungrouped') return -1;
            return (a.position || 0) - (b.position || 0);
        });
    },

    // -----------------------------------------------------------------------
    // export() — complete, versioned snapshot of ALL app state.
    //
    // Strategy: snapshot every key in ALL_APP_KEYS from localStorage, then
    // layer on the IndexedDB-resident blobs (backgroundImage, website icons)
    // so the exported file is fully self-contained. Wrap the whole thing in a
    // version envelope so import() can detect old/new shapes.
    //
    // calendarProxyToken is intentionally nulled before serialisation (security).
    // calendarBuckets is intentionally excluded (large cache, rebuilt on fetch).
    // backgroundImage is pulled from IndexedDB and folded in as a data: URL.
    // -----------------------------------------------------------------------
    async export() {
        const envelope = await this._buildExportEnvelope();

        const date = new Date().toISOString().slice(0, 10);
        const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `anderson-homepage-backup-${date}.json`;
        a.click();
        URL.revokeObjectURL(url);
        UI.showToast('Data exported successfully');
    },

    // -----------------------------------------------------------------------
    // _buildExportEnvelope() — builds the same versioned snapshot object that
    // export() writes to a file, without triggering a download or a toast.
    // Shared by export() (manual backup) and import() (automatic pre-import
    // safety snapshot below) so both stay in sync with a single source of truth.
    // -----------------------------------------------------------------------
    async _buildExportEnvelope() {
        // Collect every localStorage key the app uses
        const lsSnapshot = {};
        for (const key of this.ALL_APP_KEYS) {
            const raw = localStorage.getItem(key);
            lsSnapshot[key] = raw !== null ? raw : null;
        }

        // Security: never export the proxy token
        lsSnapshot.calendarProxyToken = null;

        // Cache keys are large and ephemeral — exclude them from the export
        // so the file stays reasonably sized. They rebuild on next fetch.
        delete lsSnapshot.calendarBuckets;
        delete lsSnapshot.calendarCachedEvents;
        delete lsSnapshot.calendarLastFetched;

        // Background image lives in IndexedDB (possibly many MBs of base64).
        // Fall back to any legacy localStorage copy for mid-migration backups.
        let backgroundImage = null;
        try { backgroundImage = await window.ImageStore?.get('backgroundImage'); } catch { /* ignore */ }
        if (!backgroundImage) backgroundImage = localStorage.getItem('backgroundImage');

        // Website icons also live in IndexedDB — fold them back into each website
        // entry so the exported JSON is fully self-contained.
        let icons = {};
        try { icons = (await window.ImageStore?.getAllIcons()) || {}; } catch { /* ignore */ }

        // Parse websites from the snapshot and reattach icons
        const websitesParsed = Utils.safeJSONParse(lsSnapshot.websites, []);
        const websitesForExport = Array.isArray(websitesParsed)
            ? websitesParsed.map(w => ({ ...w, icon: w.icon || icons[w.id] || null }))
            : [];

        // Build the versioned envelope
        return {
            version: this.EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            data: {
                ...lsSnapshot,
                // Override the raw 'websites' string with the icon-hydrated array
                // (stored as the parsed object so the file is readable JSON)
                websites: websitesForExport,
                // Groups are already in lsSnapshot as a JSON string; also keep
                // them parsed for readability — import() handles both shapes.
                groups: Utils.safeJSONParse(lsSnapshot.groups, AppState.groups),
                // Image blobs folded in explicitly
                backgroundImage
            }
        };
    },

    // -----------------------------------------------------------------------
    // import(file) — restore from a backup file.
    //
    // Accepts both the new versioned envelope (v2+) and the old flat format
    // (v1 / no version field) for backwards compatibility.
    //
    // Guard rails:
    //   - File size capped at 100 MB to prevent runaway reads.
    //   - JSON parse errors caught and reported.
    //   - Shape validation before touching localStorage.
    //   - All known keys cleared then selectively re-written.
    //   - Calls UIRenderer.render() + location.reload() to pick up new state.
    // -----------------------------------------------------------------------
    async import(file) {
        // Guard against absurdly large files (100 MB)
        if (file.size > 100 * 1024 * 1024) {
            UI.showToast('File is too large to import (max 100 MB).');
            return;
        }

        let raw;
        try {
            raw = await file.text();
        } catch {
            UI.showToast('Could not read the file. Import failed.');
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            UI.showToast('Invalid JSON file. Import failed.');
            return;
        }

        if (!parsed || typeof parsed !== 'object') {
            UI.showToast('Invalid backup format. Import failed.');
            return;
        }

        // Detect envelope format: new (v2+) vs old flat (v1)
        let data;
        if (typeof parsed.version === 'number' && parsed.data && typeof parsed.data === 'object') {
            // New versioned format
            data = parsed.data;
        } else {
            // Old flat format — treat the whole object as data
            data = parsed;
        }

        // Basic shape guards
        if (data.websites !== undefined && !Array.isArray(data.websites)) {
            UI.showToast('Invalid websites data in backup. Import failed.');
            return;
        }
        if (data.groups !== undefined && !Array.isArray(data.groups)) {
            UI.showToast('Invalid groups data in backup. Import failed.');
            return;
        }

        // ---- Validate and sanitise websites ----
        const rawWebsites = data.websites || [];
        const websites = rawWebsites.filter(w =>
            w && typeof w === 'object' && typeof w.name === 'string' && typeof w.url === 'string'
        );
        const websitesDropped = rawWebsites.length - websites.length;

        // Neutralise (rather than drop) any imported website whose URL uses a
        // disallowed scheme (javascript:, data:, vbscript:, etc.) — the entry
        // survives the import but can no longer execute code when clicked.
        let websitesNeutralized = 0;
        websites.forEach(w => {
            if (w.url && !Utils.isSafeUrl(w.url)) {
                w.url = '';
                websitesNeutralized++;
            }
        });

        // ---- Validate and sanitise groups ----
        const rawGroups = data.groups || AppState.groups;
        const groups = rawGroups.filter(g =>
            g && typeof g === 'object' && typeof g.id === 'string' && typeof g.name === 'string'
        );
        const groupsDropped = rawGroups.length - groups.length;

        // ---- Safety snapshot: capture the CURRENT state before it's overwritten ----
        // Import wipes and replaces every app key below, so take a best-effort
        // backup of what's live right now — same shape as a manual export — and
        // stash it under its own key so the previous state is recoverable if this
        // file turns out to be bad. Taken here, before AppState/localStorage are
        // touched, so it reflects the true pre-import state. Never blocks a
        // legitimate import: any failure (including localStorage quota) is
        // swallowed and the import proceeds regardless.
        try {
            const snapshot = await this._buildExportEnvelope();
            Utils.safeLocalStorageSet('preImportBackup', JSON.stringify({
                timestamp: new Date().toISOString(),
                envelope: snapshot
            }));
        } catch { /* best-effort only — must never block the import */ }

        AppState.websites = websites;
        AppState.groups = groups.length > 0 ? groups : AppState.groups;

        // Orphan guard: websites pointing at a group that wasn't in the backup
        const importedGroupIds = new Set(AppState.groups.map(g => g.id));
        AppState.websites.forEach(website => {
            if (!website.groupId || !importedGroupIds.has(website.groupId)) {
                website.groupId = 'ungrouped';
            }
            if (!website.id) website.id = crypto.randomUUID();
            if (website.clickCount === undefined) website.clickCount = 0;
            if (website.lastOpened === undefined) website.lastOpened = null;
            if (website.favorite === undefined) website.favorite = false;
        });

        let importColCounter = 0;
        AppState.groups.forEach((group, index) => {
            if (!group.width) group.width = 'full';
            if (group.collapsed === undefined) group.collapsed = false;
            if (group.column === undefined) {
                if (group.width === 'full' || group.id === 'ungrouped') {
                    group.column = 1;
                } else {
                    group.column = (importColCounter % 2) + 1;
                    importColCounter++;
                }
            }
            if (group.position === undefined) {
                group.position = group.id === 'ungrouped' ? 999999 : index + 1;
            }
        });

        if (!AppState.groups.some(g => g.id === 'ungrouped')) {
            AppState.groups.push({
                id: 'ungrouped', name: 'My Apps', color: COLOR_PALETTE[0].value,
                width: 'full', position: 999999
            });
        }

        // Clear every known app localStorage key for a clean restore
        this.ALL_APP_KEYS.forEach(key => localStorage.removeItem(key));
        // Also clear legacy keys that may exist from older builds
        ['backgroundImage', 'calendarIcsUrl'].forEach(key => localStorage.removeItem(key));

        // ---- Website icons ----
        // Move imported icons into IndexedDB and strip them from the localStorage
        // copy — a full backup can carry MBs of base64 icons.
        if (window.ImageStore) {
            try { await window.ImageStore.clearAllIcons(); } catch { /* ignore */ }
            for (const w of AppState.websites) {
                if (typeof w.icon === 'string' && w.icon.startsWith('data:')) {
                    try { await window.ImageStore.setIcon(w.id, w.icon); } catch { /* ignore */ }
                }
            }
        }
        const slimWebsites = AppState.websites.map(w => {
            if (w.icon) { const { icon, ...rest } = w; return rest; }
            return w;
        });
        Utils.safeLocalStorageSet('websites', JSON.stringify(slimWebsites));
        Utils.safeLocalStorageSet('groups', JSON.stringify(AppState.groups));

        // ---- Scalar / enum settings ----
        const allowedThemes = ['light', 'dark'];
        const allowedViews = ['grid', 'list'];
        const allowedPositions = ['cover', 'contain', 'stretch', 'stretch-horizontal', 'stretch-vertical', 'center', 'tile'];
        const allowedBlurs = ['no-blur', 'light-blur', 'medium-blur', 'heavy-blur'];
        const allowedLayouts = ['50-50', '33-67', '67-33'];

        if (allowedThemes.includes(data.theme)) Utils.safeLocalStorageSet('theme', data.theme);
        if (allowedViews.includes(data.view)) Utils.safeLocalStorageSet('view', data.view);
        if (data.iconSize && !isNaN(Number(data.iconSize))) {
            Utils.safeLocalStorageSet('iconSize', String(Math.min(100, Math.max(20, Number(data.iconSize)))));
        }
        if (allowedPositions.includes(data.backgroundPosition)) Utils.safeLocalStorageSet('backgroundPosition', data.backgroundPosition);
        if (allowedBlurs.includes(data.backgroundBlur)) Utils.safeLocalStorageSet('backgroundBlur', data.backgroundBlur);
        if (allowedLayouts.includes(data.columnLayout)) Utils.safeLocalStorageSet('columnLayout', data.columnLayout);

        // ---- Background image ----
        // Restore into IndexedDB (it's a large blob; localStorage is a fallback
        // only if ImageStore is unavailable).
        if (data.backgroundImage && typeof data.backgroundImage === 'string'
            && data.backgroundImage.startsWith('data:image/')) {
            try {
                await window.ImageStore.set('backgroundImage', data.backgroundImage);
                localStorage.removeItem('backgroundImage');
            } catch {
                Utils.safeLocalStorageSet('backgroundImage', data.backgroundImage);
            }
        }

        // ---- Calendar settings ----
        // Token is excluded from exports (security); the user must re-enter it.
        if (data.calendarProxyUrl && typeof data.calendarProxyUrl === 'string'
            && data.calendarProxyUrl.startsWith('https://')) {
            Utils.safeLocalStorageSet('calendarProxyUrl', data.calendarProxyUrl);
        }
        if (data.calendarSources) {
            const parsed = Array.isArray(data.calendarSources)
                ? data.calendarSources
                : Utils.safeJSONParse(data.calendarSources, []);
            if (Array.isArray(parsed)) {
                const validated = parsed.filter(c =>
                    c && typeof c === 'object' && typeof c.url === 'string' && c.url.startsWith('https://')
                );
                if (validated.length > 0) Utils.safeLocalStorageSet('calendarSources', JSON.stringify(validated));
            }
        }
        if (data.calendarRefreshInterval && !isNaN(Number(data.calendarRefreshInterval))) {
            const clamped = Math.max(300000, Math.min(3600000, Number(data.calendarRefreshInterval)));
            Utils.safeLocalStorageSet('calendarRefreshInterval', String(clamped));
        }
        if (data.calendarDaysAhead && !isNaN(Number(data.calendarDaysAhead))) {
            const clamped = Math.max(1, Math.min(15, Number(data.calendarDaysAhead)));
            Utils.safeLocalStorageSet('calendarDaysAhead', String(clamped));
        }
        if (['tz1', 'tz2', 'none'].includes(data.calendarGrouping)) {
            Utils.safeLocalStorageSet('calendarGrouping', data.calendarGrouping);
        }
        const heightOpts = ['auto', ...Array.from({ length: 19 }, (_, i) => String(1 + i * 0.5))];
        if (heightOpts.includes(data.calendarHeight)) {
            Utils.safeLocalStorageSet('calendarHeight', data.calendarHeight);
        }

        // Countdown settings (new in v2 exports)
        const countdownPlacements = ['widget', 'calendar', 'both', 'none'];
        if (countdownPlacements.includes(data.calendarCountdownPlacement)) {
            Utils.safeLocalStorageSet('calendarCountdownPlacement', data.calendarCountdownPlacement);
        }
        if (data.calendarCountdownWindow && !isNaN(Number(data.calendarCountdownWindow))) {
            const clamped = Math.max(0, Math.min(1440, Number(data.calendarCountdownWindow)));
            Utils.safeLocalStorageSet('calendarCountdownWindow', String(clamped));
        }
        if (data.calendarCountdownWarnMins && !isNaN(Number(data.calendarCountdownWarnMins))) {
            const clamped = Math.max(1, Math.min(60, Number(data.calendarCountdownWarnMins)));
            Utils.safeLocalStorageSet('calendarCountdownWarnMins', String(clamped));
        }
        if (data.calendarCountdownUrgentMins && !isNaN(Number(data.calendarCountdownUrgentMins))) {
            const clamped = Math.max(1, Math.min(30, Number(data.calendarCountdownUrgentMins)));
            Utils.safeLocalStorageSet('calendarCountdownUrgentMins', String(clamped));
        }
        if (data.calendarUpcomingBarCount != null && !isNaN(Number(data.calendarUpcomingBarCount))) {
            const clamped = Math.max(0, Math.min(5, Number(data.calendarUpcomingBarCount)));
            Utils.safeLocalStorageSet('calendarUpcomingBarCount', String(clamped));
        }
        if (['ticker', 'list'].includes(data.calendarUpcomingBarFormat)) {
            Utils.safeLocalStorageSet('calendarUpcomingBarFormat', data.calendarUpcomingBarFormat);
        }

        // ---- Timezone clocks ----
        ['timezone1', 'timezone2', 'timezone3'].forEach(key => {
            if (data[key] && typeof data[key] === 'string' && data[key].trim() !== '') {
                Utils.safeLocalStorageSet(key, data[key]);
            }
        });
        // Custom clock labels (may be intentionally blank — allow clearing on import).
        ['timezone1Label', 'timezone2Label', 'timezone3Label'].forEach(key => {
            if (typeof data[key] === 'string') {
                Utils.safeLocalStorageSet(key, data[key].slice(0, 24).trim());
            }
        });

        // ---- Pomodoro ----
        if (data.pomodoroState) {
            const ps = typeof data.pomodoroState === 'string'
                ? Utils.safeJSONParse(data.pomodoroState, null)
                : data.pomodoroState;
            if (ps && typeof ps === 'object'
                && typeof ps.targetTime === 'number'
                && typeof ps.currentTime === 'number'
                && typeof ps.isRunning === 'boolean') {
                Utils.safeLocalStorageSet('pomodoroState', JSON.stringify(ps));
            }
        }
        if (data.pomodoroHistory) {
            const ph = Array.isArray(data.pomodoroHistory)
                ? data.pomodoroHistory
                : Utils.safeJSONParse(data.pomodoroHistory, null);
            if (Array.isArray(ph)) {
                Utils.safeLocalStorageSet('pomodoroHistory', JSON.stringify(ph));
            }
        }

        // ---- Virtual group positions ----
        // Rebuilt field by field rather than stored as given: this record is
        // read straight into layout decisions and into rendered markup, and an
        // imported file is untrusted input like any other.
        if (data.virtualGroupPositions) {
            const vgp = typeof data.virtualGroupPositions === 'string'
                ? Utils.safeJSONParse(data.virtualGroupPositions, null)
                : data.virtualGroupPositions;
            if (vgp && typeof vgp === 'object' && !Array.isArray(vgp)) {
                const clean = {};
                for (const [key, val] of Object.entries(vgp)) {
                    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
                    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
                    const entry = {};
                    const pos = Number(val.position);
                    if (Number.isFinite(pos)) entry.position = pos;
                    entry.column = Number(val.column) === 2 ? 2 : 1;
                    if (val.width === 'full') entry.width = 'full';
                    const h = Number(val.height);
                    if (Number.isFinite(h) && h > 0) entry.height = Math.min(5000, Math.round(h));
                    clean[key] = entry;
                }
                Utils.safeLocalStorageSet('virtualGroupPositions', JSON.stringify(clean));
            }
        }

        // ---- Minimap open state ----
        if (data.minimapOpen !== null && data.minimapOpen !== undefined) {
            Utils.safeLocalStorageSet('minimapOpen', String(data.minimapOpen));
        }

        // ---- To-do list ----
        if (data.todos) {
            const td = Array.isArray(data.todos)
                ? data.todos
                : Utils.safeJSONParse(data.todos, null);
            if (Array.isArray(td)) {
                Utils.safeLocalStorageSet('todos', JSON.stringify(td));
            }
        }
        if (data.todoArchive) {
            const ta = Array.isArray(data.todoArchive)
                ? data.todoArchive
                : Utils.safeJSONParse(data.todoArchive, null);
            if (Array.isArray(ta)) {
                Utils.safeLocalStorageSet('todoArchive', JSON.stringify(ta));
            }
        }

        // ---- Card font settings (To-Do + Calendar) ----
        // FontManager re-validates these on load; storing the raw object is safe.
        ['todoFontSettings', 'calendarFontSettings'].forEach(key => {
            if (!data[key]) return;
            const fs = typeof data[key] === 'string'
                ? Utils.safeJSONParse(data[key], null)
                : data[key];
            if (fs && typeof fs === 'object' && !Array.isArray(fs)) {
                Utils.safeLocalStorageSet(key, JSON.stringify(fs));
            }
        });

        // ---- Claude Projects widget settings ----
        // ProjectsWidget re-validates these on load too, but re-validating here
        // (rather than trusting the backup) keeps a hand-edited/corrupt file
        // from ever reaching localStorage with an out-of-range option.
        if (data.claudeProjectsSettings) {
            const cps = typeof data.claudeProjectsSettings === 'string'
                ? Utils.safeJSONParse(data.claudeProjectsSettings, null)
                : data.claudeProjectsSettings;
            if (cps && typeof cps === 'object' && !Array.isArray(cps)) {
                const clean = {
                    enabled: cps.enabled !== false,
                    idleMin: [1, 3, 5, 10].includes(Number(cps.idleMin)) ? Number(cps.idleMin) : 3,
                    hideMin: [10, 30, 60, 120].includes(Number(cps.hideMin)) ? Number(cps.hideMin) : 30
                };
                Utils.safeLocalStorageSet('claudeProjectsSettings', JSON.stringify(clean));
            }
        }

        // ---- Claude Projects custom names ----
        // Rebuilt key by key rather than stored as given: own string values
        // only, length-capped, and __proto__/constructor/prototype keys are
        // dropped (same prototype-pollution guard as virtualGroupPositions above).
        if (data.claudeProjectsNames) {
            const cpn = typeof data.claudeProjectsNames === 'string'
                ? Utils.safeJSONParse(data.claudeProjectsNames, null)
                : data.claudeProjectsNames;
            if (cpn && typeof cpn === 'object' && !Array.isArray(cpn)) {
                const clean = {};
                for (const [key, val] of Object.entries(cpn)) {
                    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
                    if (typeof val !== 'string') continue;
                    clean[key] = val.slice(0, 60);
                }
                Utils.safeLocalStorageSet('claudeProjectsNames', JSON.stringify(clean));
            }
        }

        // ---- Re-render in place then reload ----
        // Trigger a render so the UI reflects the imported state before the
        // reload (visible for the ~1.5 s toast window).
        try { window.UIRenderer?.render?.(); } catch { /* ignore */ }

        const skippedParts = [];
        if (websitesDropped > 0) skippedParts.push(`${websitesDropped} website${websitesDropped > 1 ? 's' : ''} skipped due to invalid data`);
        if (groupsDropped > 0) skippedParts.push(`${groupsDropped} group${groupsDropped > 1 ? 's' : ''} skipped due to invalid data`);
        if (websitesNeutralized > 0) skippedParts.push(`${websitesNeutralized} website${websitesNeutralized > 1 ? 's' : ''} had an unsafe URL removed`);
        const toastMsg = skippedParts.length > 0
            ? `Data imported (${skippedParts.join(', ')}). Refreshing...`
            : 'Data imported successfully! Refreshing...';

        UI.showToast(toastMsg);
        setTimeout(() => location.reload(), 1500);
    }
};

// ========================================
// GROUP MANAGER
// ========================================

const GroupManager = {
    add(groupData) {
        if (!groupData.position) {
            const regularGroups = AppState.groups.filter(g => g.id !== 'ungrouped');
            const maxPosition = regularGroups.length > 0
                ? Math.max(...regularGroups.map(g => g.position || 0))
                : 0;
            groupData.position = maxPosition + 1;
        }

        if (!groupData.width) groupData.width = 'full';

        AppState.groups.push(groupData);
        Storage.sortGroups();
        Storage.save();
        if (window.UIRenderer) UIRenderer.render();
        UI.showToast('Group added successfully!');
    },

    update(id, groupData) {
        const index = AppState.groups.findIndex(g => g.id === id);
        if (index !== -1) {
            if (groupData.position === undefined) {
                groupData.position = AppState.groups[index].position;
            }
            if (!groupData.width) {
                groupData.width = AppState.groups[index].width || 'full';
            }

            AppState.groups[index] = groupData;
            Storage.sortGroups();
            Storage.save();
            if (window.UIRenderer) UIRenderer.render();
            UI.showToast('Group updated successfully!');
        }
    },

    delete(id) {
        if (id === 'ungrouped') {
            UI.showToast('Cannot delete the default "My Apps" group!');
            return;
        }

        const deletedGroup = { ...this.getById(id) };
        if (!deletedGroup.id) return;

        const movedWebsites = AppState.websites
            .filter(w => w.groupId === id)
            .map(w => w.id);

        AppState.websites.forEach(w => {
            if (w.groupId === id) w.groupId = 'ungrouped';
        });

        AppState.groups = AppState.groups.filter(g => g.id !== id);
        Storage.save();
        if (window.UIRenderer) UIRenderer.render();

        UI.showUndoToast(`"${deletedGroup.name}" deleted`, () => {
            AppState.groups.push(deletedGroup);
            movedWebsites.forEach(wId => {
                const w = WebsiteManager.getById(wId);
                if (w) w.groupId = id;
            });
            Storage.sortGroups();
            Storage.save();
            if (window.UIRenderer) UIRenderer.render();
            UI.showToast('Group restored!');
        });
    },

    toggleCollapse(id) {
        const group = this.getById(id);
        if (!group) return;
        group.collapsed = !group.collapsed;
        Storage.save();
        // Collapsing/expanding only changes this one group's own height/content —
        // no other group's position or column is affected — so it's safe to
        // scope the DOM update to just this group instead of a full render().
        if (window.UIRenderer) UIRenderer.renderGroup(id);
    },

    collapseAll() {
        AppState.groups.forEach(g => { g.collapsed = true; });
        Storage.save();
        if (window.UIRenderer) UIRenderer.render();
    },

    expandAll() {
        AppState.groups.forEach(g => { g.collapsed = false; });
        Storage.save();
        if (window.UIRenderer) UIRenderer.render();
    },

    getById(id) {
        return AppState.groups.find(g => g.id === id);
    }
};

// ========================================
// WEBSITE MANAGER
// ========================================

const WebsiteManager = {
    // Write a website's icon to IndexedDB. Only ever WRITES (never deletes), so a
    // save that happens before icons have hydrated can't wipe a stored icon.
    // Orphaned icons (from deletes/imports) are pruned in hydrateIcons() on load.
    _persistIcon(id, icon) {
        if (!window.ImageStore || !icon) return;
        ImageStore.setIcon(id, icon).catch(() => {});
    },

    add(websiteData) {
        const groupId = websiteData.groupId || 'ungrouped';
        const websitesInGroup = AppState.websites.filter(w =>
            (w.groupId || 'ungrouped') === groupId
        );
        websiteData.position = websitesInGroup.length;

        AppState.websites.push(websiteData);
        Storage.save();
        this._persistIcon(websiteData.id, websiteData.icon);
        if (window.UIRenderer) {
            // A brand-new website only ever affects the single group it's added
            // to — it always starts un-favorited and never-opened (the add form
            // has no fields for those), so it can't also change the Favorites /
            // Recently Opened virtual sections. renderGroup() itself falls back
            // to a full render if that group isn't in the DOM yet (e.g. the very
            // first website, coming from the empty state).
            if (websiteData.favorite || websiteData.lastOpened) {
                UIRenderer.render();
            } else {
                UIRenderer.renderGroup(groupId);
            }
            UIRenderer.updateIconSizes();
        }
        UI.showToast('Website added successfully!');
    },

    update(id, websiteData) {
        const index = AppState.websites.findIndex(w => w.id === id);
        if (index !== -1) {
            const oldWebsite = AppState.websites[index];
            if (websiteData.position === undefined) {
                websiteData.position = oldWebsite.position;
            }

            AppState.websites[index] = websiteData;
            Storage.save();
            this._persistIcon(id, websiteData.icon);
            if (window.UIRenderer) {
                // Safe to scope to a single group only when the website's group
                // didn't change (the edit form's group dropdown can move it to a
                // different group, which is a two-group/structural change) AND
                // neither the old nor new state touches a virtual section
                // (Favorites / Recently Opened) — otherwise more than this one
                // group's DOM could need updating, so fall back to a full render.
                const oldGroupId = oldWebsite.groupId || 'ungrouped';
                const newGroupId = websiteData.groupId || 'ungrouped';
                const touchesVirtual = oldWebsite.favorite || websiteData.favorite
                    || oldWebsite.lastOpened || websiteData.lastOpened;
                if (oldGroupId === newGroupId && !touchesVirtual) {
                    UIRenderer.renderGroup(newGroupId);
                } else {
                    UIRenderer.render();
                }
                UIRenderer.updateIconSizes();
            }
            UI.showToast('Website updated successfully!');
        }
    },

    delete(id) {
        const deletedWebsite = { ...this.getById(id) };
        if (!deletedWebsite.id) return;

        const groupId = deletedWebsite.groupId || 'ungrouped';
        // A favorited or recently-opened website also appears in a virtual
        // section (Favorites / Recently Opened) — removing/restoring it changes
        // that section too, so those cases fall back to a full render() rather
        // than the single-group scoped update.
        const touchesVirtual = Boolean(deletedWebsite.favorite || deletedWebsite.lastOpened);

        AppState.websites = AppState.websites.filter(w => w.id !== id);

        const groupWebsites = AppState.websites
            .filter(w => (w.groupId || 'ungrouped') === groupId)
            .sort((a, b) => (a.position || 0) - (b.position || 0));
        groupWebsites.forEach((w, index) => {
            w.position = index;
        });

        Storage.save();
        // Leave the icon in IndexedDB so Undo can restore instantly; it's pruned
        // as an orphan on the next load if the delete isn't undone.
        if (window.UIRenderer) {
            if (touchesVirtual) {
                UIRenderer.render();
            } else {
                UIRenderer.renderGroup(groupId);
            }
            UIRenderer.updateIconSizes();
        }

        UI.showUndoToast(`"${deletedWebsite.name}" deleted`, () => {
            AppState.websites.push(deletedWebsite);
            WebsiteManager.ensurePositions();
            Storage.save();
            WebsiteManager._persistIcon(deletedWebsite.id, deletedWebsite.icon); // restore its icon
            if (window.UIRenderer) {
                if (touchesVirtual) {
                    UIRenderer.render();
                } else {
                    UIRenderer.renderGroup(groupId);
                }
                UIRenderer.updateIconSizes();
            }
            UI.showToast('Website restored!');
        });
    },

    getById(id) {
        return AppState.websites.find(w => w.id === id);
    },

    moveToGroup(websiteId, targetGroupId) {
        const website = this.getById(websiteId);
        if (!website) return;

        const oldGroupId = website.groupId;
        website.groupId = targetGroupId;

        if (oldGroupId !== targetGroupId) {
            const websitesInTargetGroup = AppState.websites.filter(w =>
                (w.groupId || 'ungrouped') === targetGroupId && w.id !== websiteId
            );
            website.position = websitesInTargetGroup.length > 0
                ? Math.max(...websitesInTargetGroup.map(w => w.position || 0)) + 1
                : 0;
        }

        Storage.save();
        if (window.UIRenderer) {
            UIRenderer.render();
            UIRenderer.updateIconSizes();
        }
    },

    swapPositions(draggedId, targetId) {
        const draggedWebsite = this.getById(draggedId);
        const targetWebsite = this.getById(targetId);

        if (!draggedWebsite || !targetWebsite) return;

        const draggedGroup = draggedWebsite.groupId || 'ungrouped';
        const targetGroup = targetWebsite.groupId || 'ungrouped';

        if (draggedGroup !== targetGroup) {
            this.moveToGroup(draggedId, targetGroup);
            return;
        }

        const groupWebsites = AppState.websites
            .filter(w => (w.groupId || 'ungrouped') === draggedGroup)
            .sort((a, b) => (a.position || 0) - (b.position || 0));

        const draggedGroupIndex = groupWebsites.findIndex(w => w.id === draggedId);
        const targetGroupIndex = groupWebsites.findIndex(w => w.id === targetId);

        if (draggedGroupIndex === -1 || targetGroupIndex === -1) return;

        [groupWebsites[draggedGroupIndex], groupWebsites[targetGroupIndex]] =
        [groupWebsites[targetGroupIndex], groupWebsites[draggedGroupIndex]];

        groupWebsites.forEach((website, index) => {
            website.position = index;
        });

        Storage.save();
    },

    trackOpen(id) {
        const website = this.getById(id);
        if (!website) return;
        website.clickCount = (website.clickCount || 0) + 1;
        website.lastOpened = new Date().toISOString();
        Storage.save();
    },

    toggleFavorite(id) {
        const website = this.getById(id);
        if (!website) return;
        website.favorite = !website.favorite;
        Storage.save();
        if (window.UIRenderer) {
            UIRenderer.render();
            UIRenderer.updateIconSizes();
        }
        UI.showToast(website.favorite ? 'Added to favorites!' : 'Removed from favorites');
    },

    ensurePositions() {
        let needsSave = false;
        const groups = [...new Set(AppState.websites.map(w => w.groupId || 'ungrouped'))];

        groups.forEach(groupId => {
            const groupWebsites = AppState.websites
                .filter(w => (w.groupId || 'ungrouped') === groupId);

            if (groupWebsites.some(w => w.position === undefined)) {
                groupWebsites.forEach((website, index) => {
                    website.position = index;
                    needsSave = true;
                });
            }
        });

        if (needsSave) Storage.save();
    },

    // Called after the first render. Moves any legacy localStorage icons into
    // IndexedDB (one-time migration) and loads stored icons onto the in-memory
    // websites, then re-renders so the icons appear. Runs off the critical path.
    async hydrateIcons() {
        if (!window.ImageStore) return;

        // 1. Migrate icons that an older build left inline in localStorage.
        const legacy = AppState.websites.filter(
            w => typeof w.icon === 'string' && w.icon.startsWith('data:')
        );
        if (legacy.length) {
            for (const w of legacy) {
                try { await ImageStore.setIcon(w.id, w.icon); } catch { /* ignore */ }
            }
            Storage.save(); // re-save localStorage without the (now migrated) icons
        }

        // 2. Attach stored icons to websites that don't already have one in memory.
        let stored = {};
        try { stored = await ImageStore.getAllIcons(); } catch { /* ignore */ }
        let changed = false;
        for (const w of AppState.websites) {
            if (!w.icon && stored[w.id]) { w.icon = stored[w.id]; changed = true; }
        }

        // 3. Prune orphaned icons (deleted-and-not-undone websites, stale imports).
        const liveIds = new Set(AppState.websites.map(w => w.id));
        for (const id of Object.keys(stored)) {
            if (!liveIds.has(id)) {
                try { await ImageStore.deleteIcon(id); } catch { /* ignore */ }
            }
        }

        if ((changed || legacy.length) && window.UIRenderer) {
            UIRenderer.render();
            UIRenderer.updateIconSizes();
        }
    }
};

// ========================================
// UTILS — injected early so all managers above can call Utils.*
// The real Utils object is defined in 2-ui-controllers.js and overwrites this
// stub at script-load time. We pre-populate safeLocalStorageSet here so that
// any storage attempt that fires before 2-ui-controllers.js executes still
// gets the hardened version (with the unavailability banner).
// ========================================

// Probe whether localStorage is actually accessible. Returns true if readable
// and writable, false if blocked (private mode, sandboxed iframe, full quota
// on the probe key).
(function _hardenUtils() {
    // _storageUnavailable tracks banner state so we show it at most once.
    let _storageUnavailable = false;
    let _bannerShown = false;

    // ---- Availability probe ----
    // Runs once synchronously at load time. A tiny write+delete verifies that
    // localStorage is both accessible and not already full.
    let _available = false;
    try {
        const testKey = '__ah_probe__';
        localStorage.setItem(testKey, '1');
        localStorage.removeItem(testKey);
        _available = true;
    } catch {
        _available = false;
        _storageUnavailable = true;
    }

    // ---- Banner (created dynamically, no HTML/CSS edits required) ----
    function _showStorageBanner() {
        if (_bannerShown) return;
        _bannerShown = true;

        // Wait for the DOM to be ready before injecting the banner.
        const inject = () => {
            if (document.body) {
                _injectBanner();
            } else {
                document.addEventListener('DOMContentLoaded', _injectBanner, { once: true });
            }
        };
        inject();
    }

    function _injectBanner() {
        if (document.getElementById('ah-storage-banner')) return; // already present
        const banner = document.createElement('div');
        banner.id = 'ah-storage-banner';
        banner.setAttribute('role', 'alert');
        banner.setAttribute('aria-live', 'assertive');
        Object.assign(banner.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            right: '0',
            zIndex: '999999',
            background: '#7c2d12',
            color: '#fff',
            padding: '10px 48px 10px 16px',
            fontSize: '14px',
            fontFamily: 'system-ui, sans-serif',
            lineHeight: '1.4',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
        });
        banner.innerHTML = [
            '<span style="font-size:18px;flex-shrink:0" aria-hidden="true">&#9888;</span>',
            '<span>Changes can\'t be saved in this browser session. ',
            'Storage may be blocked (private/incognito mode) or full.</span>',
            '<button id="ah-storage-banner-close" aria-label="Dismiss" style="',
            'position:absolute;right:8px;top:50%;transform:translateY(-50%);',
            'background:transparent;border:1px solid rgba(255,255,255,0.5);',
            'color:#fff;border-radius:4px;padding:2px 8px;cursor:pointer;',
            'font-size:13px;line-height:1.4">Dismiss</button>'
        ].join('');
        document.body.prepend(banner);
        document.getElementById('ah-storage-banner-close')?.addEventListener('click', () => {
            banner.remove();
        });
    }

    // Show the banner immediately if the probe already failed.
    if (_storageUnavailable) {
        _showStorageBanner();
    }

    // ---- Expose Storage.isAvailable() ----
    // Other modules can call Storage.isAvailable() to branch on availability.
    // (Storage object is defined later in this file; we attach after its literal.)

    // ---- Patch safeLocalStorageSet (if Utils not yet defined) ----
    // 2-ui-controllers.js defines Utils and will overwrite window.Utils, but its
    // safeLocalStorageSet is a plain try/catch with a quota toast. We need to
    // also handle total unavailability (private mode / blocked storage) and the
    // no-spam banner. We wrap the function after Utils is fully constructed by
    // hooking into DOMContentLoaded — by that point both files have executed.
    document.addEventListener('DOMContentLoaded', () => {
        if (!window.Utils?.safeLocalStorageSet) return;

        const _originalSet = Utils.safeLocalStorageSet.bind(Utils);
        Utils.safeLocalStorageSet = (key, value) => {
            if (!_available) {
                // Storage is known-blocked; show banner once, then no-op writes
                // silently (don't crash callers, don't spam the banner).
                _showStorageBanner();
                return false;
            }
            try {
                localStorage.setItem(key, value);
                return true;
            } catch (e) {
                // Write failed even though the initial probe succeeded — quota
                // may have been exceeded mid-session, or permissions changed.
                _storageUnavailable = true;
                _available = false;
                _showStorageBanner();
                // Also propagate to the original handler so quota-specific
                // toasts (e.g. "Storage full! Try removing the background image")
                // still fire for QuotaExceededError.
                _originalSet(key, value);
                return false;
            }
        };

        // Attach isAvailable() to the Storage object now that it's defined.
        Storage.isAvailable = () => _available;
    }, { once: true });
})();
