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
const APP_VERSION = 'v4.36';
const APP_RELEASE_DATE = '2026-08-06';

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
