// ==========================================
// UI Renderer Module v1.4
// Handles rendering with position-based sorting
// Uses event delegation for click/drag handlers
// ==========================================

// Fallback swatch for a calendar with no configured colour. Green is reserved
// for the Today & Now beam and the timeline "now" bar, so an uncoloured
// calendar defaults to the structural blue instead.
const DEFAULT_CAL_COLOR = '#5B9DFF';

const UIRenderer = {
    _delegationAttached: false,

    // Load/save layout info for virtual groups (position + column)
    // Format: { '__recent__': { position: 2, column: 1 }, ... }
    // Backward compat: if value is a number, treat as { position: number, column: 1 }
    _getVirtualPositions() {
        const saved = localStorage.getItem('virtualGroupPositions');
        const raw = saved ? (Utils.safeJSONParse(saved, {}) || {}) : {};
        // Null-prototype result, and skip the keys that would hit an
        // Object.prototype setter instead of defining an own property: this
        // record is user-editable and can also arrive from an imported
        // settings file, so "__proto__" is reachable here.
        const result = Object.create(null);
        for (const [id, val] of Object.entries(raw)) {
            if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
            if (typeof val === 'number') {
                result[id] = { position: val, column: 1 };
            } else if (val && typeof val === 'object') {
                result[id] = val;
            }
        }
        return result;
    },

    _saveVirtualPositions(positions) {
        Utils.safeLocalStorageSet('virtualGroupPositions', JSON.stringify(positions));
    },

    // ---- Special-card layout (Calendar / To-Do) -----------------------------
    // These two cards can step out of the two-column grid ('full' width, drawn
    // as a band above the columns) and can carry a hand-dragged pixel height
    // that overrides whatever automatic sizing they would otherwise get. Both
    // live in the same virtualGroupPositions record as position/column, so they
    // ride along with export/import, the SQLite backup and minimap drags for
    // free (every writer there merges with a spread rather than replacing).
    SPECIAL_CARD_IDS: ['__calendar__', '__todo__'],
    MIN_CARD_HEIGHT: 140,

    // Both fields are normalised on the way out, so every consumer gets either a
    // usable value or a clean null — nothing downstream has to re-validate.
    _getCardLayout(id) {
        const v = this._getVirtualPositions()[id] || {};
        const h = Number(v.height);
        return {
            width: v.width === 'full' ? 'full' : 'column',
            height: Number.isFinite(h) && h > 0 ? this._clampCardHeight(h) : null
        };
    },

    // Validates on the way in as well: this record is reachable from a settings
    // import, and a bad value written here would persist across sessions.
    _setCardLayout(id, patch) {
        if (!this.SPECIAL_CARD_IDS.includes(id)) return;
        const all = this._getVirtualPositions();
        const entry = { ...(all[id] || {}) };

        if ('width' in patch) entry.width = patch.width === 'full' ? 'full' : 'column';
        if ('height' in patch) {
            const h = Number(patch.height);
            // null / NaN / nonsense all mean "back to automatic". Removing the
            // key rather than storing null keeps the record clean.
            if (Number.isFinite(h) && h > 0) entry.height = this._clampCardHeight(h);
            else delete entry.height;
        }

        all[id] = entry;
        this._saveVirtualPositions(all);
    },

    // Tallest a card may be dragged. A card taller than the viewport can never
    // be seen at once and its resize grip runs off the bottom of the screen.
    _maxCardHeight() {
        return Math.max(this.MIN_CARD_HEIGHT, Math.round(window.innerHeight * 0.9));
    },

    _clampCardHeight(px) {
        return Math.min(this._maxCardHeight(), Math.max(this.MIN_CARD_HEIGHT, Math.round(px)));
    },

    // The scrollable inner region each special card sizes when its height changes.
    _cardScrollRegion(cardEl) {
        return cardEl?.querySelector('.calendar-events-container, .todo-list') || null;
    },

    // Everything in the card that isn't the scrollable region: header, vertical
    // padding, borders — and the margins and gaps between them. Stored heights
    // are OUTER card heights, so this comes off the top before the inner region
    // is sized, which keeps a stored height meaning the same thing even when the
    // header wraps to two lines at a different card width.
    //
    // Measured as "card minus region" rather than summed from its parts:
    // offsetHeight excludes margins, so summing silently loses the header's
    // margin-bottom and any future spacing, leaving the card several pixels off
    // the size the user actually dragged. Zero when the card isn't laid out
    // (hidden or detached) — nothing is on screen to size in that case anyway.
    _cardOverhead(cardEl) {
        const region = this._cardScrollRegion(cardEl);
        const measured = region ? cardEl.offsetHeight - region.offsetHeight : 0;
        return measured > 0 ? measured : 0;
    },

    // Size a card's scroll region so the card as a whole lands on `px` tall.
    // This sets `height`, not just `max-height`: a max only ever caps a box, so
    // on its own it could shrink a card but never let one be dragged taller
    // than its own content. `max-height: none` goes with it so the stylesheet's
    // default cap (38vh / 60vh) can't quietly win. Overflow stays `auto`, so
    // content taller than the chosen size still scrolls.
    _applyCardHeightPx(cardEl, px) {
        const region = this._cardScrollRegion(cardEl);
        if (!region) return;
        const inner = this._clampCardHeight(px) - this._cardOverhead(cardEl);
        region.style.height = Math.max(60, inner) + 'px';
        region.style.maxHeight = 'none';
        // Same reasoning as maxHeight above, opposite direction: the calendar's
        // automatic pass pins minHeight so a timeline has a definite box, and
        // min-height beats height unconditionally — left in place it would stop
        // the very first shrink-drag/keystroke after a return to automatic.
        region.style.minHeight = '';
        this._syncResizeHandleValue(cardEl);
    },

    // Drop an applied manual height, handing the region back to the stylesheet
    // (or to the calendar's automatic sizing, which sets max-height itself).
    _clearCardHeightPx(region) {
        if (!region) return;
        region.style.height = '';
        region.style.maxHeight = '';
        // Shared with the To-Do card, which never sets minHeight, so this is
        // a no-op there. Calendar's automatic path (below, and
        // _applyCalendarHeight) uses minHeight to give a timeline a definite
        // box to fill; a manual height must drop that or a stale value from
        // a previous auto pass would defeat a smaller dragged height.
        region.style.minHeight = '';
    },

    // The grip reports the card's height to assistive tech as a separator's
    // value. It has to come from the laid-out card rather than the stored
    // setting, because in automatic mode there is no stored number at all.
    _syncResizeHandleValue(cardEl) {
        const grip = cardEl?.querySelector('[data-card-action="resize"]');
        if (!grip) return;
        const px = Math.round(cardEl.offsetHeight);
        grip.setAttribute('aria-valuenow', String(px));
        grip.setAttribute('aria-valuemax', String(this._maxCardHeight()));
        // valuetext carries the unit, and is the only place "automatic" is
        // exposed as a state — a bare number would announce as just "304".
        const isManual = this._getCardLayout(grip.dataset.cardId).height != null;
        grip.setAttribute('aria-valuetext', isManual ? `${px} pixels` : `${px} pixels, automatic`);
    },

    // ---- Focus-restore helper shared by render() and renderTodoCard() ----
    // Looks up the queued _pendingTodoFocus in the given scope element and
    // moves focus there, then clears the pending record.
    _restoreTodoFocus(scope) {
        if (!this._pendingTodoFocus) return;
        const f = this._pendingTodoFocus;
        this._pendingTodoFocus = null;
        let selector;
        if (f.action === 'add-sub') {
            selector = `.todo-subadd[data-id="${CSS.escape(f.id)}"]`;
        } else if (f.action === 'add-task') {
            selector = '.todo-add';
        } else if (f.action === 'toggle') {
            selector = f.sub
                ? `.todo-done-btn[data-id="${CSS.escape(f.id)}"][data-sub="${CSS.escape(f.sub)}"]`
                : `.todo-done-btn[data-id="${CSS.escape(f.id)}"]:not([data-sub])`;
        } else if (f.action === 'reorder') {
            // Keep focus on the drag handle the user just moved with the keyboard.
            selector = f.sub
                ? `.todo-drag-handle[data-id="${CSS.escape(f.id)}"][data-sub="${CSS.escape(f.sub)}"]`
                : `.todo-drag-handle[data-id="${CSS.escape(f.id)}"]:not([data-sub])`;
        } else if (f.action === 'edit') {
            // Put the caret in a freshly inserted row's text field
            // (Enter-to-continue from the row above).
            selector = f.sub
                ? `.todo-text[data-id="${CSS.escape(f.id)}"][data-sub="${CSS.escape(f.sub)}"]`
                : `.todo-text[data-id="${CSS.escape(f.id)}"]:not([data-sub])`;
        } else if (f.action === 'collapse') {
            selector = `.todo-collapse-btn[data-id="${CSS.escape(f.id)}"]`;
        }
        if (selector) scope.querySelector(selector)?.focus();
    },

    render() {
        const container = document.getElementById('mainContainer');
        const emptyState = document.getElementById('emptyState');

        if (!container || !emptyState) return;

        // A full re-render also detaches the calendar card, so clear any open
        // legend/view-menu document listeners here too (not just renderCalendarCard).
        this._teardownCalendarMenus();
        const tlScroll = this._readTimelineScroll();

        // Commit any in-progress To-Do text edit before we replace the DOM. A
        // re-render triggered while a field is focused (e.g. an async calendar
        // refresh) would otherwise destroy the input before its change event
        // fires, silently losing the edit.
        const active = document.activeElement;
        if (active && active.classList?.contains('todo-text') && window.TodoManager) {
            TodoManager.setText(active.dataset.id, active.dataset.sub || null, active.value);
        }

        if (AppState.websites.length === 0 && AppState.groups.length <= 1) {
            emptyState.style.display = 'block';
            container.innerHTML = '';
            return;
        }

        emptyState.style.display = 'none';

        const vPos = this._getVirtualPositions();

        // Build all groups (virtual + regular) into one unified list
        const allEntries = [];

        // Favorites virtual group
        const favorites = AppState.websites.filter(w => w.favorite);
        if (favorites.length > 0) {
            const fv = vPos['__favorites__'] || {};
            const favGroup = { id: '__favorites__', name: 'Favorites', color: 'rgba(255, 193, 7, 0.2)', position: Number(fv.position) || -3, column: fv.column ?? 1, collapsed: false, _virtual: true };
            allEntries.push({ group: favGroup, websites: favorites, type: 'standard' });
        }

        // Recently Opened virtual group
        const recentlyOpened = AppState.websites
            .filter(w => w.lastOpened)
            .sort((a, b) => new Date(b.lastOpened) - new Date(a.lastOpened))
            .slice(0, 3);
        if (recentlyOpened.length > 0) {
            const rv = vPos['__recent__'] || {};
            const recentGroup = { id: '__recent__', name: 'Recently Opened', color: 'rgba(33, 150, 243, 0.2)', position: Number(rv.position) || -2, column: rv.column ?? 1, collapsed: false, _virtual: true };
            allEntries.push({ group: recentGroup, websites: recentlyOpened, type: 'standard' });
        }

        // Calendar virtual group
        const cv = vPos['__calendar__'] || {};
        const calGroup = { id: '__calendar__', position: cv.position ?? -1, column: cv.column ?? 2, _virtual: true, _full: cv.width === 'full' };
        allEntries.push({ group: calGroup, type: 'calendar' });

        // To-Do virtual group
        const tv = vPos['__todo__'] || {};
        const todoGroup = { id: '__todo__', position: tv.position ?? -1, column: tv.column ?? 1, _virtual: true, _full: tv.width === 'full' };
        allEntries.push({ group: todoGroup, type: 'todo' });

        // Regular groups
        AppState.groups.forEach(group => {
            const groupWebsites = AppState.websites
                .filter(w => (w.groupId || 'ungrouped') === group.id)
                .sort((a, b) => {
                    const posA = a.position !== undefined ? a.position : 999999;
                    const posB = b.position !== undefined ? b.position : 999999;
                    return posA - posB;
                });
            allEntries.push({ group, websites: groupWebsites, type: 'standard' });
        });

        // Sort all entries together
        allEntries.sort((a, b) => {
            if (a.group.id === 'ungrouped') return 1;
            if (b.group.id === 'ungrouped') return -1;
            return (a.group.position || 0) - (b.group.position || 0);
        });

        // Split entries into the top full-width band, column 1, column 2, and
        // the bottom full-width band. Calendar/To-Do opted into full width form
        // the top band (a banner above the grid); Uncategorized keeps the
        // bottom slot it has always had. Within the top band the cards keep
        // their relative position order from the sort above.
        const fullTopEntries = [];
        const col1Entries = [];
        const col2Entries = [];
        const fullEntries = [];

        allEntries.forEach(entry => {
            const g = entry.group;
            if (g.id === 'ungrouped') {
                fullEntries.push(entry);
            } else if (g._full) {
                fullTopEntries.push(entry);
            } else if (g.column === 2) {
                col2Entries.push(entry);
            } else {
                col1Entries.push(entry);
            }
        });

        const renderEntry = (entry) => {
            if (entry.type === 'calendar') {
                return this.createCalendarSection(entry.group.column);
            }
            if (entry.type === 'todo') {
                return this.createTodoSection(entry.group.column);
            }
            return this.createGroupSection(entry.group, entry.websites);
        };

        const fullTopHTML = fullTopEntries.map(renderEntry).join('');
        const col1HTML = col1Entries.map(renderEntry).join('');
        const col2HTML = col2Entries.map(renderEntry).join('');
        const fullHTML = fullEntries.map(renderEntry).join('');

        let layout = localStorage.getItem('columnLayout') || '5-5';
        // Migrate old values
        if (layout === '50-50') layout = '5-5';
        else if (layout === '33-67') layout = '3-7';
        else if (layout === '67-33') layout = '7-3';
        const [colLeft, colRight] = layout.split('-').map(Number);

        container.innerHTML = `
            <div class="groups-container">
                ${fullTopHTML ? `<div class="groups-full-top">${fullTopHTML}</div>` : ''}
                <div class="groups-columns" style="--col-left:${colLeft};--col-right:${colRight};">
                    <div class="groups-column">${col1HTML}</div>
                    <div class="groups-column">${col2HTML}</div>
                </div>
                ${fullHTML}
            </div>
        `;

        // Grab cursor comes from CSS (.website-card { cursor: grab; }); preventing
        // child elements (the icon <img>) from initiating their own native drag is
        // baked directly into the card template (see createWebsiteCard) instead of
        // walking every descendant of every card on each render.

        // Attach delegated handlers once
        if (!this._delegationAttached) {
            this._attachDelegatedHandlers(container);
            this._attachTodoHandlers(container);
            this._attachCardLayoutHandlers(container);
            // A debounced height must not be lost to a reload or tab switch.
            window.addEventListener('pagehide', () => this._flushCardHeightPersist());
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') this._flushCardHeightPersist();
            });
            let resizeDebounce = null;
            window.addEventListener('resize', () => {
                clearTimeout(resizeDebounce);
                resizeDebounce = setTimeout(() => {
                    // Re-clamp both cards: the viewport ceiling on a manual
                    // height moves with the window.
                    this.matchCalendarHeight();
                    this.matchTodoHeight();
                }, 150);
            });
            this._delegationAttached = true;
        }

        // Restore focus into the To-Do card after a mutation re-rendered it.
        this._restoreTodoFocus(container);

        // Sync minimap (full structural rebuild — groups may have moved)
        if (window.Minimap) Minimap.render();

        // Size the upcoming-event ticker (render() doesn't run matchCalendarHeight).
        this._sizeUpcomingTicker();

        // Re-apply both cards' heights. render() replaced their DOM, so any
        // manual height (and the calendar's automatic sizing) has to be put
        // back here — most callers of render() don't follow it with anything
        // else, and without this a dragged height silently reverts.
        this.matchCalendarHeight();
        this.matchTodoHeight();

        this._applyTimelineScroll(tlScroll);
    },

    // ---- Scoped update: regenerate only the To-Do card in place ----
    // Called by TodoManager._rerender() and by add-sub-toggle. Replaces the
    // existing .todo-group node without touching any other card or the layout,
    // so website-card drag-drop, focus outside the To-Do area, and scroll
    // position are completely unaffected. Delegated handlers (already attached
    // to the container) remain valid because we only swap inner innerHTML.
    renderTodoCard() {
        const container = document.getElementById('mainContainer');
        if (!container) { this.render(); return; }

        // Replacing the card mid-drag would tear out the grip the pointer is
        // captured on. Defer until the gesture ends.
        if (this._cardDragActive()) { this._deferCardRender('__todo__'); return; }

        const existing = container.querySelector('.todo-group');
        if (!existing) { this.render(); return; }

        // Commit any in-progress To-Do text edit before replacing the card.
        const active = document.activeElement;
        if (active && active.classList?.contains('todo-text') && window.TodoManager) {
            TodoManager.setText(active.dataset.id, active.dataset.sub || null, active.value);
        }

        // Build fresh card HTML and parse it into a real element
        const html = this.createTodoSection();
        const tpl = document.createElement('div');
        tpl.innerHTML = html.trim();
        const newCard = tpl.firstElementChild;
        if (!newCard) { this.render(); return; }

        existing.replaceWith(newCard);

        // The replacement card is fresh DOM — re-apply any manual height.
        this.matchTodoHeight();

        // Restore focus inside the new card DOM
        this._restoreTodoFocus(newCard);

        // Sync the minimap header count for the To-Do block only — no full re-render
        // (structural position hasn't changed, just the task count chip).
        this._syncMinimapTodoCount();
    },

    // Patch the minimap's To-Do block count label without a full Minimap.render().
    _syncMinimapTodoCount() {
        const panel = document.getElementById('minimapPanel');
        if (!panel) return;
        const block = panel.querySelector('.minimap-block[data-group-id="__todo__"]');
        if (!block) return;
        const count = window.TodoManager?.getTodos()?.length || 0;
        const countEl = block.querySelector('.minimap-block-count');
        if (countEl) countEl.textContent = `${count} task${count !== 1 ? 's' : ''}`;
    },

    // ---- Scoped update: regenerate only the calendar card in place ----
    // Used by CalendarManager.fetchEvents() so a periodic auto-refresh does
    // not steal focus or reset scroll elsewhere.
    // Remove any document-level dismiss listeners left by an open legend popover
    // or view dropdown menu. Capture flags must match how each was registered:
    // both click handlers use capture; only the view-menu keydown uses capture.
    _teardownCalendarMenus() {
        if (this._calLegendDismiss) document.removeEventListener('click', this._calLegendDismiss, true);
        if (this._calLegendKeydown) document.removeEventListener('keydown', this._calLegendKeydown);
        if (this._viewMenuDismiss) document.removeEventListener('click', this._viewMenuDismiss, true);
        if (this._viewMenuKeydown) document.removeEventListener('keydown', this._viewMenuKeydown, true);
        this._calLegendDismiss = this._calLegendKeydown = null;
        this._viewMenuDismiss = this._viewMenuKeydown = this._viewMenuClose = null;
        // The clock context menu is body-appended, so replacing the calendar
        // card would neither remove its node nor its document listeners —
        // strip both here alongside the other calendar menus.
        if (this._clockTzMenuDismiss) document.removeEventListener('click', this._clockTzMenuDismiss, true);
        if (this._clockTzMenuKeydown) document.removeEventListener('keydown', this._clockTzMenuKeydown, true);
        this._clockTzMenuDismiss = this._clockTzMenuKeydown = this._closeClockTzMenu = null;
        document.querySelector('.clock-tz-menu')?.remove();
    },

    renderCalendarCard() {
        const container = document.getElementById('mainContainer');
        if (!container) { this.render(); return; }

        // A background refresh must not replace the card mid-drag — that would
        // tear out the grip the pointer is captured on. Defer until the
        // gesture ends; _flushDeferredRender picks it up.
        if (this._cardDragActive()) { this._deferCardRender('__calendar__'); return; }

        const existing = container.querySelector('.calendar-group');
        if (!existing) { this.render(); return; }

        // The legend popover & view menu register dismiss listeners on `document`
        // that capture soon-to-be-detached card nodes. Tear them down before
        // replacing the card so no orphaned handler survives a re-render.
        this._teardownCalendarMenus();
        const tlScroll = this._readTimelineScroll();

        const html = this.createCalendarSection();
        const tpl = document.createElement('div');
        tpl.innerHTML = html.trim();
        const newCard = tpl.firstElementChild;
        if (!newCard) { this.render(); return; }

        existing.replaceWith(newCard);

        // Height must be re-evaluated now that the content changed.
        this.matchCalendarHeight();
        this._applyTimelineScroll(tlScroll);
        // No Minimap.render() — the calendar block's position hasn't moved.
    },

    // ---- Scoped update: regenerate only ONE regular group's DOM in place ----
    // Used for website/group mutations that are known to affect exactly one
    // regular (non-virtual) group — e.g. adding/editing/deleting a website
    // within it, or toggling its collapsed state. It reuses createGroupSection
    // so the output is identical to what a full render() would produce for
    // that group, but nothing else (other groups, the calendar card, the
    // To-Do card) is touched, so their DOM, scroll position and any in-progress
    // interaction survive untouched.
    //
    // Falls back to a full render() whenever the single-group guarantee can't
    // be made: unknown/virtual group id, or the group isn't in the DOM yet
    // (e.g. the very first website being added from the empty-state screen).
    // Callers that aren't sure a mutation is single-group-safe should call
    // render() directly instead of this method.
    renderGroup(groupId) {
        const container = document.getElementById('mainContainer');
        if (!container) { this.render(); return; }

        // Virtual groups (favorites/recent/calendar/todo) are derived, not a
        // fixed data record — calendar/todo already have their own scoped
        // renderers, and favorites/recent membership can change in ways this
        // method can't safely account for. Always fall back for those.
        if (!groupId || groupId.startsWith('__')) { this.render(); return; }

        const group = GroupManager.getById(groupId);
        if (!group) { this.render(); return; }

        const existing = container.querySelector(`.app-group[data-group-id="${CSS.escape(groupId)}"]`);
        if (!existing) { this.render(); return; }

        const websites = AppState.websites
            .filter(w => (w.groupId || 'ungrouped') === groupId)
            .sort((a, b) => {
                const posA = a.position !== undefined ? a.position : 999999;
                const posB = b.position !== undefined ? b.position : 999999;
                return posA - posB;
            });

        const html = this.createGroupSection(group, websites);
        const tpl = document.createElement('div');
        tpl.innerHTML = html.trim();
        const newGroupEl = tpl.firstElementChild;
        if (!newGroupEl) { this.render(); return; }

        existing.replaceWith(newGroupEl);

        // The group's height may have changed (card added/removed/collapsed),
        // which can affect the calendar's 'auto' height match and the
        // minimap's block sizing/count — refresh both, same as a full render.
        this.matchCalendarHeight();
        if (window.Minimap) Minimap.render();
    },

    createGroupSection(group, websites) {
        if (!group) return '';

        const containerClass = AppState.currentView === 'grid' ? 'websites-grid' : 'websites-list';

        const collapsedClass = group.collapsed ? 'collapsed' : '';
        const defaultClass = group.id === 'ungrouped' ? 'default-group' : '';
        const collapseIcon = group.collapsed ? '▶' : '▼';
        const collapseTitle = group.collapsed ? 'Expand group' : 'Collapse group';

        const isDefault = group.id === 'ungrouped';
        const isVirtual = group._virtual === true;
        const showDeleteButton = !isDefault && !isVirtual;
        const showCollapseButton = !isVirtual;
        const showActions = !isVirtual;
        const virtualClass = isVirtual ? 'virtual-group' : '';
        const virtualIconId = group.id === '__favorites__' ? 'ico-star-filled'
            : group.id === '__recent__' ? 'ico-clock'
            : null;

        const websitesHTML = websites && websites.length > 0
            ? websites.map(w => this.createWebsiteCard(w, isVirtual)).join('')
            : '<div class="group-drop-zone">Drag websites here</div>';

        const safeName = Utils.sanitizeHTML(group.name);
        const safeId = Utils.sanitizeHTML(group.id);
        const rawColor = group.color || COLOR_PALETTE[0].value;
        const safeColor = Utils.isValidColor(rawColor) ? rawColor : COLOR_PALETTE[0].value;

        return `
            <div class="app-group ${collapsedClass} ${defaultClass} ${virtualClass}"
                 data-group-id="${safeId}"
                 data-position="${Number(group.position) || 0}"
                 style="--card-tint: ${safeColor};">
                <div class="group-header">
                    <div class="group-title-container">
                        ${showCollapseButton ? `<button class="group-action-btn collapse-btn" onclick="App.toggleGroupCollapse('${safeId}')" title="${collapseTitle}">${collapseIcon}</button>` : ''}
                        <div class="group-title has-ico">
                            ${isDefault ? '<span class="default-indicator"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-anchor"></use></svg></span>' : ''}
                            ${virtualIconId ? `<svg class="ico ico-sm" aria-hidden="true"><use href="#${virtualIconId}"></use></svg>` : ''}
                            ${safeName}
                            <span class="group-count">(${websites ? websites.length : 0})</span>
                        </div>
                    </div>
                    ${showActions ? `<div class="group-actions">
                        <button class="group-action-btn" onclick="App.editGroup('${safeId}')" title="Edit Group" aria-label="Edit Group"><svg class="ico" aria-hidden="true"><use href="#ico-pencil"></use></svg></button>
                        ${showDeleteButton ? `<button class="group-action-btn delete-group-btn" onclick="App.deleteGroup('${safeId}')" title="Delete Group">×</button>` : ''}
                    </div>` : ''}
                </div>
                <div class="${containerClass}" ${!isVirtual ? 'data-drop-zone="true"' : ''} ${group.collapsed ? 'style="display: none;"' : ''}>
                    ${websitesHTML}
                </div>
            </div>
        `;
    },

    createWebsiteCard(website, isVirtual = false) {
        if (!website) return '';

        const safeName = Utils.sanitizeHTML(website.name);
        const safeUrl = Utils.sanitizeHTML(website.url);
        const safeId = Utils.sanitizeHTML(website.id);
        const safeGroupId = Utils.sanitizeHTML(website.groupId || 'ungrouped');
        const safeVersion = Utils.sanitizeHTML(website.version || '');
        const safeVersionDate = Utils.sanitizeHTML(website.versionDate || '');
        const iconSrc = website.icon
            ? Utils.sanitizeHTML(website.icon)
            : '';

        const isListView = AppState.currentView === 'list';
        const iconSize = isListView ? 50 : AppState.iconSize;
        const cardStyle = !isListView ?
            `padding: ${AppState.iconSize * 0.25}px; min-height: ${parseInt(AppState.iconSize) + 60}px;` : '';

        let versionAgeDot = '';
        if (website.versionDate) {
            const versionDate = new Date(website.versionDate);
            if (!isNaN(versionDate.getTime())) {
                const ageDays = Math.floor((Date.now() - versionDate.getTime()) / (1000 * 60 * 60 * 24));
                let ageClass = 'version-age-green';
                if (ageDays > 90) ageClass = 'version-age-red';
                else if (ageDays > 30) ageClass = 'version-age-yellow';
                const ageTitle = ageDays <= 0 ? 'Updated today' : `Updated ${ageDays} day${ageDays === 1 ? '' : 's'} ago`;
                versionAgeDot = `<span class="version-age-dot ${ageClass}" title="${ageTitle}"></span>`;
            }
        }

        const versionInfo = (website.version || website.versionDate)
            ? `<div class="website-version">${safeVersion} ${website.versionDate ? `(${safeVersionDate})` : ''}</div>`
            : '';

        const icon = website.icon
            ? `<img src="${iconSrc}" alt="${safeName}" class="website-icon" draggable="false" style="width: ${iconSize}px; height: ${iconSize}px;">`
            : `<div class="website-icon" style="width: ${iconSize}px; height: ${iconSize}px;"><svg class="ico" aria-hidden="true" style="width: ${iconSize * 0.5}px; height: ${iconSize * 0.5}px;"><use href="#ico-globe"></use></svg></div>`;

        const favStarIcon = website.favorite ? 'ico-star-filled' : 'ico-star';
        const favTitle = website.favorite ? 'Remove from favorites' : 'Add to favorites';

        return `
            <div class="website-card ${isListView ? 'list-view' : ''}"
                 data-id="${safeId}"
                 data-url="${safeUrl}"
                 data-group-id="${safeGroupId}"
                 draggable="${isVirtual ? 'false' : 'true'}"
                 style="${cardStyle}">
                ${versionAgeDot}
                ${icon}
                <div class="website-info">
                    <div class="website-name">${safeName}</div>
                    ${versionInfo}
                </div>
                <div class="card-actions">
                    <button class="favorite-btn ${website.favorite ? 'is-favorite' : ''}" onclick="App.toggleFavorite(event, '${safeId}')" title="${favTitle}" aria-label="${favTitle}"><svg class="ico" aria-hidden="true"><use href="#${favStarIcon}"></use></svg></button>
                    <button class="edit-btn" onclick="App.editWebsite(event, '${safeId}')" title="Edit" aria-label="Edit website"><svg class="ico" aria-hidden="true"><use href="#ico-pencil"></use></svg></button>
                </div>
                <button class="same-tab-btn" title="Open in this tab" aria-label="Open ${safeName} in this tab"><svg class="ico" aria-hidden="true"><use href="#ico-arrow-right"></use></svg></button>
            </div>
        `;
    },

    // ========================================
    // EVENT DELEGATION - attached once, never re-attached
    // ========================================

    // Re-measure things that depend on a card's box after its height changed.
    _afterCardResize(id) {
        if (id === '__calendar__') this._sizeUpcomingTicker();
        window.Minimap?.syncHeights?.();
    },

    // Re-apply whatever height a card should currently have, reading from
    // storage: a manual height if one is set, otherwise the calendar's
    // automatic sizing or the To-Do stylesheet default. Callers that want to
    // clear a manual height must write that first — this only re-applies.
    _reapplyCardHeight(id) {
        if (id === '__calendar__') this.matchCalendarHeight();
        else if (id === '__todo__') this.matchTodoHeight();
        window.Minimap?.syncHeights?.();
    },

    // Clear a card's manual height and hand it back to automatic sizing.
    _clearManualCardHeight(id) {
        this._setCardLayout(id, { height: null });
        this._reapplyCardHeight(id);
        UI.showToast('Card height set to automatic');
    },

    // Key-repeat fires many times a second. Applying the height each keystroke
    // is cheap, but writing localStorage and re-measuring every minimap block
    // is not — so the commit trails the gesture instead of riding along with
    // it. Nothing reads the stored value mid-gesture (each step measures the
    // live card), so the delay can't cause drift.
    //
    // Timers are per card: a single shared timer would let a keystroke on one
    // card cancel the other card's pending write, applying a height on screen
    // that is never saved and reverts at the next render.
    _queueCardHeightPersist(id, height) {
        const timers = this._cardPersistTimers ||= {};
        clearTimeout(timers[id]);
        this._pendingCardHeights ||= {};
        this._pendingCardHeights[id] = height;
        timers[id] = setTimeout(() => this._flushCardHeightPersist(id), 150);
    },

    // Commit a pending height immediately. Called by the debounce timer, and on
    // page hide so a resize made in the last moments before a reload isn't lost.
    _flushCardHeightPersist(id) {
        const pending = this._pendingCardHeights;
        if (!pending) return;
        const ids = id ? [id] : Object.keys(pending);
        for (const key of ids) {
            if (pending[key] == null) continue;
            clearTimeout(this._cardPersistTimers?.[key]);
            this._setCardLayout(key, { height: pending[key] });
            delete pending[key];
            this._afterCardResize(key);
        }
    },

    // ---- Width toggle + height drag for the Calendar / To-Do cards ----------
    // Delegated on the container so the handlers survive the frequent scoped
    // re-renders of both cards (the calendar rebuilds on every background
    // fetch). While a drag is in flight those scoped re-renders are suppressed
    // — see renderCalendarCard/renderTodoCard — so the grip the pointer is
    // captured on stays in the document for the life of the gesture.
    _attachCardLayoutHandlers(container) {
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-card-action="toggle-width"]');
            if (!btn) return;
            e.preventDefault();
            // Immediate: render() below detaches e.target mid-dispatch, so any
            // later listener on this event would run against a dead node.
            e.stopImmediatePropagation();

            const id = btn.dataset.cardId;
            if (!this.SPECIAL_CARD_IDS.includes(id)) return;

            const next = this._getCardLayout(id).width === 'full' ? 'column' : 'full';
            this._setCardLayout(id, { width: next });

            // Full re-render: the card moves between the column grid and the
            // full-width band, so nothing narrower than render() will do. It
            // re-applies both cards' heights on the way out.
            this.render();

            // render() replaced the button that was just clicked — move focus to
            // its replacement so keyboard users aren't dropped onto <body>.
            document.querySelector(`[data-card-action="toggle-width"][data-card-id="${CSS.escape(id)}"]`)?.focus();
            UI.showToast(next === 'full' ? 'Card expanded to full width' : 'Card returned to column width');
        });

        // Keyboard path for the resize grip — a drag-only control would be
        // unreachable without a pointer. Steps are measured off the live card
        // rather than the stored value: the two diverge whenever a clamp bites,
        // and stepping from a stale base makes the first keypress a no-op.
        container.addEventListener('keydown', (e) => {
            const grip = e.target.closest('[data-card-action="resize"]');
            if (!grip) return;
            const id = grip.dataset.cardId;
            const card = grip.closest('.app-group');
            if (!card || !this.SPECIAL_CARD_IDS.includes(id)) return;

            const base = card.offsetHeight;
            let next;
            switch (e.key) {
                case 'ArrowUp':   next = base - (e.shiftKey ? 60 : 20); break;
                case 'ArrowDown': next = base + (e.shiftKey ? 60 : 20); break;
                // Page steps are deliberately larger than Shift+Arrow (60), or
                // the grip's own description would be telling a fib.
                case 'PageUp':    next = base - 120; break;
                case 'PageDown':  next = base + 120; break;
                case 'End':       next = this._maxCardHeight(); break;
                case 'Home':
                    e.preventDefault();
                    this._clearManualCardHeight(id);
                    return;
                default: return;
            }
            e.preventDefault();
            const height = this._clampCardHeight(next);
            this._applyCardHeightPx(card, height);
            // Calendar only: keep the hour grid filling the card on every
            // keystroke, not just once the debounce below settles — and refit
            // the line clamps, since no re-render follows to do it.
            if (id === '__calendar__') {
                this._sizeTimelineHours();
                this._fitTimelineEventText(document.querySelector('.calendar-group .calendar-timeline'));
            }
            this._queueCardHeightPersist(id, height);
        });

        // Double-click the grip to go back to automatic height — the
        // conventional affordance, and a discoverable partner to Home.
        container.addEventListener('dblclick', (e) => {
            const grip = e.target.closest('[data-card-action="resize"]');
            if (!grip) return;
            const id = grip.dataset.cardId;
            if (!this.SPECIAL_CARD_IDS.includes(id)) return;
            e.preventDefault();
            this._clearManualCardHeight(id);
        });

        container.addEventListener('pointerdown', (e) => {
            const grip = e.target.closest('[data-card-action="resize"]');
            if (!grip || e.button !== 0) return;
            const id = grip.dataset.cardId;
            const card = grip.closest('.app-group');
            if (!card || !this.SPECIAL_CARD_IDS.includes(id)) return;
            // One drag at a time. Touch pointers all report button 0, so
            // without this a second finger starts a rival gesture on the same
            // card and the two fight over its height.
            if (this._cardDragActive()) return;

            e.preventDefault();
            grip.focus();

            const state = { id, pointerId: e.pointerId, startY: e.clientY, startHeight: card.offsetHeight, moved: false, startedAt: Date.now() };
            this._cardResize = state;
            document.body.classList.add('card-resizing');
            // Capture so a release outside the window still reaches us —
            // without it an abandoned drag leaves the listeners attached and
            // every later pointer move keeps resizing the card.
            try { grip.setPointerCapture(state.pointerId); } catch { /* capture is best-effort */ }

            const liveCard = () => document.querySelector(`.app-group[data-group-id="${CSS.escape(id)}"]`);

            const onMove = (ev) => {
                if (ev.pointerId !== state.pointerId || this._cardResize !== state) return;
                const dy = ev.clientY - state.startY;
                // Matches the minimap's drag threshold. Anything smaller and
                // ordinary click jitter would pin a manual height.
                if (!state.moved && Math.abs(dy) < 5) return;
                state.moved = true;
                const el = liveCard();
                if (el) {
                    this._applyCardHeightPx(el, state.startHeight + dy);
                    // Calendar only: rescale the hour grid on every pointer
                    // tick so the drag reads as the card resizing rather than
                    // a fixed grid revealing a scrollbar. One variable write,
                    // no rebuild — that's what makes this affordable per tick.
                    // Line clamps are NOT refit here (the probe forces a
                    // layout pass per tick); the commit below settles them.
                    if (id === '__calendar__') this._sizeTimelineHours();
                }
            };

            const finish = (ev, commit) => {
                if (this._cardResize !== state) return;
                if (ev && ev.pointerId !== state.pointerId) return;
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onCancel);
                document.removeEventListener('lostpointercapture', onCancel);
                document.body.classList.remove('card-resizing');
                this._cardResize = null;

                // A click that never moved must not silently freeze the card at
                // whatever height it happened to be showing.
                if (!state.moved) { this._flushDeferredRender(); return; }

                if (!commit) {
                    // Browser-cancelled gesture: put the card back where it was
                    // rather than committing a size the user didn't finish.
                    this._reapplyCardHeight(id);
                    this._flushDeferredRender();
                    return;
                }

                const height = this._clampCardHeight(state.startHeight + (ev.clientY - state.startY));
                this._setCardLayout(id, { height });
                const el = liveCard();
                if (el) {
                    this._applyCardHeightPx(el, height);
                    if (id === '__calendar__') {
                        this._sizeTimelineHours();
                        // Settle the line clamps the move ticks skipped —
                        // nothing after this re-renders the timeline.
                        this._fitTimelineEventText(document.querySelector('.calendar-group .calendar-timeline'));
                    }
                }
                this._afterCardResize(id);
                this._flushDeferredRender();
            };
            const onUp = (ev) => finish(ev, true);
            const onCancel = (ev) => finish(ev, false);

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onCancel);
            // On document, not on the grip: lostpointercapture bubbles, but a
            // listener bound to the grip is on a detached node the moment the
            // card is re-rendered — exactly when it would be needed. pointerup
            // does the real work; this only covers capture lost mid-gesture.
            document.addEventListener('lostpointercapture', onCancel);
        });
    },

    // Card re-renders deferred because a drag was in flight (see
    // renderCalendarCard / renderTodoCard) run once the gesture ends, so a
    // background calendar refresh isn't lost until the next poll. A set, not a
    // single id: one drag can outlast requests for both cards, and keeping only
    // the newest would strand the other.
    _flushDeferredRender() {
        const pending = this._deferredCardRender;
        this._deferredCardRender = null;
        if (!pending) return;
        if (pending.has('__calendar__')) this.renderCalendarCard();
        if (pending.has('__todo__')) this.renderTodoCard();
    },

    _deferCardRender(id) {
        (this._deferredCardRender ||= new Set()).add(id);
    },

    // How long a drag may plausibly last. Past this, treat the state as dead.
    CARD_DRAG_STALE_MS: 30000,

    // True while a genuine drag is in flight. Deferring re-renders during a
    // drag means a `_cardResize` that never gets cleared would silently freeze
    // both cards' contents — added tasks wouldn't appear, calendar refreshes
    // would be swallowed — with nothing to bound it. Pointer capture plus the
    // document-level pointerup/pointercancel should always clear it, but if a
    // path ever escapes all three, this caps the damage at a few seconds
    // instead of the rest of the session.
    _cardDragActive() {
        const st = this._cardResize;
        if (!st) return false;
        if (Date.now() - st.startedAt > this.CARD_DRAG_STALE_MS) {
            this._cardResize = null;
            document.body.classList.remove('card-resizing');
            return false;
        }
        return true;
    },

    _attachDelegatedHandlers(container) {
        // Click delegation for cards, new-tab buttons
        container.addEventListener('click', (e) => {
            // The corner button is the exception to the card's own default:
            // it replaces THIS page with the site. (Before v4.17 the roles
            // were the other way round — the card navigated here and the
            // button opened a tab.)
            const sameTabBtn = e.target.closest('.same-tab-btn');
            if (sameTabBtn) {
                e.stopPropagation();
                const card = sameTabBtn.closest('.website-card');
                const url = card?.getAttribute('data-url');
                const id = card?.getAttribute('data-id');
                if (id) WebsiteManager.trackOpen(id);
                if (url) {
                    if (!Utils.isSafeUrl(url)) {
                        UI.showToast('This link was blocked for safety.');
                        return;
                    }
                    window.location.href = url;
                }
                return;
            }

            // Skip if clicking action buttons (handled by inline onclick)
            if (e.target.closest('.card-actions')) return;

            const card = e.target.closest('.website-card');
            if (!card) return;
            if (card._isDragging) return;

            // No modifier guard here, deliberately: a card is a <div>, so a
            // Ctrl/Shift-click has no default action for the browser to
            // carry out — bowing out would make the card simply do nothing.
            // (That was a real regression during v4.17.) Every primary click
            // takes the same route, and the synthetic anchor below lives
            // outside this container, so it can't re-enter this handler.
            const url = card.getAttribute('data-url');
            const id = card.getAttribute('data-id');
            if (id) WebsiteManager.trackOpen(id);
            if (url) {
                if (!Utils.isSafeUrl(url)) {
                    UI.showToast('This link was blocked for safety.');
                    return;
                }
                this.openUrlInBackgroundTab(url);
            }
        });

        // Middle-click delegation
        container.addEventListener('auxclick', (e) => {
            if (e.button !== 1) return;
            const card = e.target.closest('.website-card');
            if (!card) return;
            e.preventDefault();
            const id = card.getAttribute('data-id');
            if (id) WebsiteManager.trackOpen(id);
            const url = card.getAttribute('data-url');
            if (url) {
                if (!Utils.isSafeUrl(url)) {
                    UI.showToast('This link was blocked for safety.');
                    return;
                }
                // Middle-click means "background tab" everywhere else in the
                // browser; window.open would have raised a foreground one.
                this.openUrlInBackgroundTab(url);
            }
        });

        // Right-click context menu for delete
        container.addEventListener('contextmenu', (e) => {
            const card = e.target.closest('.website-card');
            if (!card) return;
            e.preventDefault();

            // Remove any existing context menu
            document.querySelector('.card-context-menu')?.remove();

            const id = card.getAttribute('data-id');
            if (!id) return;

            const website = WebsiteManager.getById(id);
            const isFav = website?.favorite;
            const favLabel = isFav ? 'Remove from Favorites' : 'Add to Favorites';
            const favClass = isFav ? 'unfavorite' : 'favorite';

            const menu = document.createElement('div');
            menu.className = 'card-context-menu';
            menu.innerHTML = `
                <button class="card-context-item ${favClass}" data-id="${Utils.sanitizeHTML(id)}">${favLabel}</button>
                <button class="card-context-item delete" data-id="${Utils.sanitizeHTML(id)}">Delete</button>
            `;
            menu.style.left = `${e.pageX}px`;
            menu.style.top = `${e.pageY}px`;
            document.body.appendChild(menu);

            menu.querySelector(`.${favClass}`).addEventListener('click', () => {
                App.toggleFavorite(e, id);
                menu.remove();
            });

            menu.querySelector('.delete').addEventListener('click', () => {
                App.deleteWebsite(e, id);
                menu.remove();
            });

            // Close on click elsewhere or Escape
            const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu); document.removeEventListener('keydown', escHandler); };
            const escHandler = (ev) => { if (ev.key === 'Escape') closeMenu(); };
            setTimeout(() => { document.addEventListener('click', closeMenu); document.addEventListener('keydown', escHandler); }, 0);
        });

        // Drag-and-drop delegation
        this._attachDelegatedDragHandlers(container);
    },

    _attachDelegatedDragHandlers(container) {
        // Cache references to dragged card and the set of drag-highlighted elements
        // so dragend cleanup doesn't need to re-query the whole container.
        // Cleared on dragend.
        let _draggedCard = null;
        let _dragOverCards = new Set();
        let _dragOverZones = new Set();
        let _dragOverGroups = new Set();

        container.addEventListener('mousedown', (e) => {
            const card = e.target.closest('.website-card');
            if (!card) return;
            if (e.target.closest('.card-actions') || e.target.closest('.same-tab-btn')) return;
            card._dragIntended = true;
        });

        container.addEventListener('mouseup', (e) => {
            const card = e.target.closest('.website-card');
            if (card) card._dragIntended = false;
        });

        container.addEventListener('dragstart', (e) => {
            const card = e.target.closest('.website-card');
            if (!card) return;
            if (e.target.closest('.card-actions') || e.target.closest('.same-tab-btn')) {
                e.preventDefault();
                return;
            }
            if (!card._dragIntended) {
                e.preventDefault();
                return;
            }

            const websiteId = card.getAttribute('data-id');
            const sourceGroupId = card.getAttribute('data-group-id');

            AppState.draggedElement = card;
            AppState.draggedId = websiteId;
            AppState.draggedSourceGroup = sourceGroupId;
            card._isDragging = true;
            _draggedCard = card;

            card.classList.add('dragging');
            card.style.cursor = 'grabbing';

            const sourceGroup = card.closest('.app-group');
            if (sourceGroup) {
                sourceGroup.classList.add('drag-source-group');
                _dragOverGroups.add(sourceGroup); // track for cleanup
            }

            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', websiteId);
            e.dataTransfer.setDragImage(card, e.offsetX, e.offsetY);
        });

        container.addEventListener('dragover', (e) => {
            const card = e.target.closest('.website-card');
            const zone = e.target.closest('[data-drop-zone="true"]');
            if (card && card !== AppState.draggedElement) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            } else if (zone) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            }
        });

        container.addEventListener('dragenter', (e) => {
            const card = e.target.closest('.website-card');
            if (card && card !== AppState.draggedElement) {
                card.classList.add('drag-over-card');
                _dragOverCards.add(card);
            }

            const zone = e.target.closest('[data-drop-zone="true"]');
            if (zone) {
                const targetGroup = zone.closest('.app-group');
                const targetGroupId = targetGroup?.getAttribute('data-group-id');
                if (targetGroupId && targetGroupId !== AppState.draggedSourceGroup) {
                    zone.classList.add('drag-over-drop-zone');
                    targetGroup.classList.add('drag-over-group');
                    _dragOverZones.add(zone);
                    _dragOverGroups.add(targetGroup);
                }
            }
        });

        container.addEventListener('dragleave', (e) => {
            const card = e.target.closest('.website-card');
            if (card) {
                const rect = card.getBoundingClientRect();
                if (e.clientX < rect.left || e.clientX > rect.right ||
                    e.clientY < rect.top || e.clientY > rect.bottom) {
                    card.classList.remove('drag-over-card');
                    _dragOverCards.delete(card);
                }
            }

            const zone = e.target.closest('[data-drop-zone="true"]');
            if (zone) {
                const rect = zone.getBoundingClientRect();
                if (e.clientX < rect.left || e.clientX > rect.right ||
                    e.clientY < rect.top || e.clientY > rect.bottom) {
                    zone.classList.remove('drag-over-drop-zone');
                    _dragOverZones.delete(zone);
                    const targetGroup = zone.closest('.app-group');
                    if (targetGroup) {
                        targetGroup.classList.remove('drag-over-group');
                        _dragOverGroups.delete(targetGroup);
                    }
                }
            }
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (!AppState.draggedId) return;

            // Drop on card
            const card = e.target.closest('.website-card');
            if (card) {
                card.classList.remove('drag-over-card');
                _dragOverCards.delete(card);
                const targetId = card.getAttribute('data-id');
                const targetGroupId = card.getAttribute('data-group-id');
                const draggedId = AppState.draggedId;
                const sourceGroupId = AppState.draggedSourceGroup;

                if (draggedId === targetId) return;

                AppState.draggedId = null;
                AppState.draggedSourceGroup = null;

                if (draggedId && targetId) {
                    if (sourceGroupId === targetGroupId) {
                        WebsiteManager.swapPositions(draggedId, targetId);
                        setTimeout(() => {
                            if (window.UIRenderer) {
                                UIRenderer.render();
                                UIRenderer.updateIconSizes();
                            }
                        }, 100);
                        UI.showToast('Position updated!');
                    } else {
                        WebsiteManager.moveToGroup(draggedId, targetGroupId);
                        const website = WebsiteManager.getById(draggedId);
                        const targetGroupName = AppState.groups.find(g => g.id === targetGroupId)?.name;
                        if (website && targetGroupName) {
                            UI.showToast(`Moved "${website.name}" to "${targetGroupName}"`);
                        }
                    }
                }
                return;
            }

            // Drop on zone (empty group area)
            const zone = e.target.closest('[data-drop-zone="true"]');
            if (zone) {
                const targetGroup = zone.closest('.app-group');
                const targetGroupId = targetGroup?.getAttribute('data-group-id');
                const websiteId = AppState.draggedId;
                const sourceGroupId = AppState.draggedSourceGroup;

                zone.classList.remove('drag-over-drop-zone');
                _dragOverZones.delete(zone);
                if (targetGroup) {
                    targetGroup.classList.remove('drag-over-group');
                    _dragOverGroups.delete(targetGroup);
                }

                if (websiteId && targetGroupId && targetGroupId !== sourceGroupId) {
                    if (targetGroup) {
                        targetGroup.classList.add('drop-success');
                        _dragOverGroups.add(targetGroup);
                        setTimeout(() => {
                            targetGroup.classList.remove('drop-success');
                            _dragOverGroups.delete(targetGroup);
                        }, 600);
                    }
                    WebsiteManager.moveToGroup(websiteId, targetGroupId);
                    const website = WebsiteManager.getById(websiteId);
                    const targetGroupName = AppState.groups.find(g => g.id === targetGroupId)?.name;
                    if (website && targetGroupName) {
                        UI.showToast(`Moved "${website.name}" to "${targetGroupName}"`);
                    }
                }
            }
        });

        container.addEventListener('dragend', (e) => {
            const card = e.target.closest('.website-card');
            if (!card) return;

            card._dragIntended = false;
            card.classList.remove('dragging');
            card.style.cursor = 'grab';

            // Use tracked references instead of re-querying the container
            for (const c of _dragOverCards) c.classList.remove('drag-over-card');
            _dragOverCards.clear();

            for (const z of _dragOverZones) z.classList.remove('drag-over-drop-zone');
            _dragOverZones.clear();

            for (const g of _dragOverGroups) {
                g.classList.remove('drag-source-group', 'drag-over-group', 'drop-success');
            }
            _dragOverGroups.clear();

            _draggedCard = null;

            setTimeout(() => {
                card._isDragging = false;
                AppState.draggedElement = null;
                AppState.draggedId = null;
                AppState.draggedSourceGroup = null;
            }, 300);
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    if (typeof AppState !== 'undefined' && UIRenderer) {
        UIRenderer.render();
        UIRenderer.updateIconSizes();
    }
});

window.UIRenderer = UIRenderer;
