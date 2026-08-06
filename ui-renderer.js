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
    // CALENDAR SECTION
    // ========================================

    // ---- Shared chrome for the two special cards ----------------------------
    // Width toggle lives in .group-actions (revealed on hover/focus like the
    // other group buttons); the resize grip sits in the card's bottom-right
    // corner. The grip is a real <button> so it is reachable by keyboard —
    // ↑/↓ resize it and Home clears back to automatic height.
    // The accessible name stays fixed and aria-pressed carries the state, so a
    // screen reader says "Full width, toggle button, pressed" rather than
    // announcing the state twice (once inverted, as a state-dependent name and
    // aria-pressed together would).
    // Human label for each special card, used to tell the two otherwise
    // identical sets of controls apart in the accessibility tree.
    CARD_LABELS: { '__calendar__': 'Calendar', '__todo__': 'To-Do' },

    _cardWidthButton(id) {
        if (!this.SPECIAL_CARD_IDS.includes(id)) return '';
        const isFull = this._getCardLayout(id).width === 'full';
        const title = isFull ? 'Return card to column width' : 'Expand card to full width';
        // Name stays fixed and aria-pressed carries the state, so the state
        // isn't announced twice (once inverted). The card name is included
        // because both cards render an identical control.
        return `<button type="button" class="group-action-btn card-width-btn${isFull ? ' is-full' : ''}"
                        data-card-action="toggle-width" data-card-id="${id}"
                        aria-pressed="${isFull}" title="${title}"
                        aria-label="Full width — ${this.CARD_LABELS[id]}"><span aria-hidden="true">⇔</span></button>`;
    },

    // A separator rather than a button: this is the WAI-ARIA window-splitter
    // pattern, which is what a resize grip actually is. A <button> would be
    // wrong here — it advertises Enter/Space activation that a resize grip has
    // no meaning for, and it can't report its current size.
    //
    // The name is kept short; the key instructions live in a description node
    // so they aren't re-read in full on every focus and every value change.
    _cardResizeHandle(id) {
        if (!this.SPECIAL_CARD_IDS.includes(id)) return '';
        const stored = this._getCardLayout(id).height;
        const descId = `card-resize-help-${id.replace(/_/g, '')}`;
        return `<div class="card-resize-handle" role="separator" tabindex="0"
                     data-card-action="resize" data-card-id="${id}"
                     aria-orientation="horizontal"
                     aria-valuenow="${stored ?? this.MIN_CARD_HEIGHT}"
                     aria-valuetext="${stored ? `${stored} pixels` : 'Automatic height'}"
                     aria-valuemin="${this.MIN_CARD_HEIGHT}" aria-valuemax="${this._maxCardHeight()}"
                     aria-label="${this.CARD_LABELS[id]} card height"
                     aria-describedby="${descId}"
                     title="Drag to set card height — ↑/↓ adjust, double-click or Home for automatic"><span aria-hidden="true">◢</span></div>
                <span id="${descId}" class="sr-only">Arrow keys adjust the height, Page Up and Page Down move in larger steps, End is the tallest that fits, Home restores automatic height.</span>`;
    },

    // Open a link in a BACKGROUND tab, leaving this page in front. `target=
    // "_blank"` alone isn't enough — that opens a foreground tab and takes the
    // user away from the homepage. What actually backgrounds a new tab is the
    // platform's own modifier (Ctrl, or ⌘ on macOS), so re-dispatch the click
    // with it held and let the browser do the rest.
    //
    // The synthetic click re-enters this handler; it carries the modifier, so
    // the guard below returns early and the anchor's default action runs. A
    // genuine modified click (or a middle-click) is passed straight through for
    // the same reason — the user's own modifier already says what to do.
    openInBackgroundTab(e, a) {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '');
        a.dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true, view: window,
            ctrlKey: !mac, metaKey: mac,
        }));
    },

    /**
     * Same trick as above, for the website cards — which are <div>s, not
     * anchors, so there is nothing to re-dispatch the modified click onto.
     * A throwaway anchor is created, clicked with the platform's background
     * modifier held, and removed.
     *
     * window.open(url, '_blank') is NOT an alternative: it opens a
     * FOREGROUND tab, which is precisely the behaviour this replaces. Only
     * the modifier makes the browser open a tab behind the current one, and
     * only the browser can decide that — there is no API for it.
     *
     * Must be called from inside a real user gesture, or the popup blocker
     * stops it; every caller here is a click/auxclick handler.
     */
    openUrlInBackgroundTab(url) {
        const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '');
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        // In the document, because a detached anchor's default action is not
        // guaranteed to navigate. Hidden so it can never flash into view.
        a.style.display = 'none';
        document.body.appendChild(a);
        try {
            a.dispatchEvent(new MouseEvent('click', {
                bubbles: true, cancelable: true, view: window,
                ctrlKey: !mac, metaKey: mac,
            }));
        } finally {
            a.remove();
        }
    },

    createCalendarSection(column) {
        const cm = window.CalendarManager;
        const isConfigured = cm?.state.isConfigured;
        const events = cm?.getUpcomingEvents() || [];
        const lastFetchedLabel = cm?.getLastFetchedLabel() || '';
        const fetchError = cm?.state.fetchError;
        const groupLabel = cm?.getGroupingLabel() || '';
        const viewMode = cm?.getViewMode?.() || 'list';
        const viewLabel = cm?.getViewModeLabel?.() || 'List';

        // Stale-data / error warning badge for the header.
        // Shows when: there is a fetchError (even if cached events exist), or when
        // data is old (last fetched more than 2 refresh intervals ago).
        let warningBadge = '';
        if (isConfigured) {
            const isStale = (() => {
                if (!cm.state.lastFetched) return false;
                const interval = cm.getRefreshInterval ? cm.getRefreshInterval() : 300000;
                return (Date.now() - cm.state.lastFetched.getTime()) > interval * 2;
            })();
            if (fetchError || isStale) {
                const tip = fetchError
                    ? `Couldn't refresh — showing data from ${lastFetchedLabel}`
                    : `Data may be stale — last refreshed ${lastFetchedLabel}`;
                warningBadge = `<span class="calendar-stale-badge" title="${Utils.sanitizeHTML(tip)}" aria-label="${Utils.sanitizeHTML(tip)}" role="img"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-alert"></use></svg></span>`;
            }
        }

        const contentHTML = this._calendarContentHTML();

        // Build calendar legend from configured calendars
        const calendars = cm?.getCalendars() || [];

        const calLayout = this._getCardLayout('__calendar__');

        // Only a full-width card has room to keep the ticker inline in the header
        // beside the title cluster and the centered "Today & Now". At column width
        // it gets its own row between the header and the events area instead.
        // Safe to decide at render time: toggling the width re-renders the card.
        const isFullWidth = calLayout.width === 'full';
        const ticker = this._calendarHeaderTicker(isFullWidth ? 'header' : 'row');

        return `
            <div class="app-group virtual-group calendar-group"
                 data-group-id="__calendar__"
                 data-card-width="${calLayout.width}"
                 style="--card-tint: rgba(120,160,220,0.18);">
                <div class="group-header">
                    <div class="group-title-container">
                        <div class="group-title has-ico">
                            <a class="calendar-icon-link" href="https://calendar.google.com" target="_blank" rel="noopener"
                               title="Open Google Calendar in a background tab" aria-label="Open Google Calendar in a background tab"
                               onclick="UIRenderer.openInBackgroundTab(event, this)"><svg class="ico" aria-hidden="true"><use href="#ico-calendar"></use></svg></a> Calendar${this._calendarLegendButton(calendars)}${isConfigured ? this._calendarViewDropdown(viewMode, viewLabel) : ''}${isConfigured ? this._calendarGroupingDropdown(groupLabel) : ''}
                        </div>
                        <div class="calendar-header-meta">
                            ${isConfigured ? `<button class="calendar-refresh-btn" onclick="CalendarManager.fetchEvents()" title="Refresh now" aria-label="Refresh now"><svg class="ico" aria-hidden="true"><use href="#ico-refresh"></use></svg></button>` : ''}
                            ${lastFetchedLabel ? `<span class="calendar-last-updated">${Utils.sanitizeHTML(lastFetchedLabel)}</span>` : ''}
                            ${warningBadge}
                            ${fetchError ? `<span class="calendar-error-dot" title="${Utils.sanitizeHTML(fetchError)}">!</span>` : ''}
                            ${this._cardWidthButton('__calendar__')}
                        </div>
                        ${isFullWidth ? ticker : ''}
                        ${isConfigured && viewMode !== 'list' ? `<button class="cal-nav-today cal-header-today" onclick="UIRenderer.jumpToTodayView()" title="Jump to today · scroll to now (Enter)">Today &amp; Now</button>` : ''}
                    </div>
                </div>
                ${isFullWidth ? '' : ticker}
                <div class="calendar-events-container">
                    ${contentHTML}
                </div>
                ${this._cardResizeHandle('__calendar__')}
            </div>
        `;
    },

    // Inner HTML for the events container — the setup/error/day-view/empty/list
    // ladder. Extracted so a per-calendar visibility toggle can refresh just the
    // content (and the legend) in place without regenerating the whole card.
    _calendarContentHTML() {
        const cm = window.CalendarManager;
        const isConfigured = cm?.state.isConfigured;
        const fetchError = cm?.state.fetchError;
        const viewMode = cm?.getViewMode?.() || 'list';
        const events = cm?.getUpcomingEvents() || [];
        if (!isConfigured) return this._calendarSetupPrompt();
        if (fetchError && events.length === 0) return this._calendarErrorState(fetchError);
        if (viewMode !== 'list') return this._calendarDayView();
        if (events.length === 0 && !fetchError) return this._calendarEmptyState();
        return this._calendarEventsList(events);
    },

    // Scoped update for a calendar visibility toggle: refresh the events area and
    // the legend list in place, leaving the popover wrapper (and its open/pinned
    // state + dismiss listeners) untouched so it stays open while toggling.
    refreshCalendarEventsAndLegend(focusIndex) {
        const card = document.querySelector('.calendar-group');
        if (!card) { this.renderCalendarCard(); return; }
        const tlScroll = this._readTimelineScroll();
        const container = card.querySelector('.calendar-events-container');
        if (container) container.innerHTML = this._calendarContentHTML();
        const list = card.querySelector('.cal-legend-pop-list');
        if (list) {
            list.innerHTML = this._calendarLegendItems(window.CalendarManager?.getCalendars() || []);
            // Rebuilding the list recreates the toggle the user activated, dropping
            // keyboard focus. Restore it to the same row so screen-reader users keep
            // their place and hear the new checked state.
            if (focusIndex != null) list.querySelectorAll('.cal-legend-toggle')[focusIndex]?.focus();
        }
        this.matchCalendarHeight();
        this._applyTimelineScroll(tlScroll);
    },

    // Scoped update for day-view navigation (Today & Now, and prev/next paging):
    // rebuild only the events container, leaving the card header — and the running
    // upcoming-events ticker inside it — in place so it keeps scrolling instead of
    // restarting the way a full card re-render would. Falls back to a full render
    // if the card/container isn't in the DOM yet.
    refreshCalendarDayView() {
        const card = document.querySelector('.calendar-group');
        const container = card?.querySelector('.calendar-events-container');
        if (!container) { this.renderCalendarCard(); return; }
        const tlScroll = this._readTimelineScroll();
        container.innerHTML = this._calendarContentHTML();
        this.matchCalendarHeight();
        this._applyTimelineScroll(tlScroll);
    },

    // View picker: a menu-button dropdown (3-Day / 5-Day / Week / List). Replaces
    // the old cycling button so any view is one click away.
    _calendarViewDropdown(viewMode, viewLabel) {
        const labels = { '3day': '3-Day', '5day': '5-Day', week: 'Week', list: 'List' };
        const order = ['3day', '5day', 'week', 'list'];
        const items = order.map(m =>
            `<button class="calendar-view-menu-item" role="menuitemradio" aria-checked="${m === viewMode ? 'true' : 'false'}" onclick="CalendarManager.setViewMode('${m}')">${labels[m]}</button>`
        ).join('');
        // Timeline switch: last row in the menu, a slider-toggle rather than a
        // radio item since it's an independent on/off setting, not a view choice.
        // Disabled (but still focusable/announced) in List view, where the
        // timeline has nothing to render.
        const tlOn = window.CalendarManager?.getTimelineMode?.() || false;
        const tlDisabled = viewMode === 'list';
        const tlRow = `<div class="calendar-view-menu-sep" role="separator"></div>`
            + `<button class="calendar-view-menu-item cal-menu-switch" role="menuitemcheckbox"`
            + ` aria-checked="${tlOn ? 'true' : 'false'}"`
            + (tlDisabled ? ` aria-disabled="true"` : ` onclick="UIRenderer.toggleTimelineFromMenu(this)"`)
            + ` title="Hour-by-hour timeline${tlDisabled ? ' (day views only)' : ''}">`
            + `<span class="cal-menu-switch-label"><span aria-hidden="true">◷</span> Timeline</span>`
            + `<span class="cal-switch-track" aria-hidden="true"><span class="cal-switch-knob"></span></span>`
            + `</button>`;
        return `<span class="calendar-view-dd">`
            + `<button class="calendar-view-toggle" onclick="UIRenderer.toggleViewMenu(this)" aria-haspopup="menu" aria-expanded="false" aria-controls="calViewMenu" title="Change calendar view" aria-label="Change calendar view. Current: ${Utils.sanitizeHTML(viewLabel)}"><span class="calendar-group-toggle-icon" aria-hidden="true"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-grid"></use></svg></span>${Utils.sanitizeHTML(viewLabel)}<span class="calendar-view-caret" aria-hidden="true">▾</span></button>`
            + `<div class="calendar-view-menu" id="calViewMenu" role="menu" aria-label="Calendar view">${items}${tlRow}</div>`
            + `</span>`;
    },

    // Grouping picker: same menu-button pattern (and CSS/handler) as the view
    // dropdown. Options come from the Settings Clocks page — one per enabled
    // clock, de-duplicated by zone — plus 'No grouping'; nothing hard-coded.
    _calendarGroupingDropdown(groupLabel) {
        const cm = window.CalendarManager;
        const current = cm.getGrouping();
        const items = cm.getGroupingOptions().map(o =>
            `<button class="calendar-view-menu-item" role="menuitemradio" aria-checked="${o.mode === current ? 'true' : 'false'}" onclick="CalendarManager.setGrouping('${o.mode}')">${Utils.sanitizeHTML(o.label)}</button>`
        ).join('');
        return `<span class="calendar-view-dd">`
            + `<button class="calendar-view-toggle" onclick="UIRenderer.toggleViewMenu(this)" aria-haspopup="menu" aria-expanded="false" aria-controls="calGroupMenu" title="Change event grouping" aria-label="Change event grouping. Current: ${Utils.sanitizeHTML(groupLabel)}"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-grid"></use></svg>${Utils.sanitizeHTML(groupLabel)}<span class="calendar-view-caret" aria-hidden="true">▾</span></button>`
            + `<div class="calendar-view-menu" id="calGroupMenu" role="menu" aria-label="Event grouping">${items}</div>`
            + `</span>`;
    },

    toggleViewMenu(btn) {
        const dd = btn.closest('.calendar-view-dd');
        // The view and grouping dropdowns share this handler and its document
        // listeners — close whichever is open first (possibly the other one) so
        // no listener is orphaned when switching directly between the two.
        const wasOpen = dd.classList.contains('open');
        if (this._viewMenuClose) this._viewMenuClose(false);
        if (wasOpen) return;
        const menu = dd.querySelector('.calendar-view-menu');
        const items = [...menu.querySelectorAll('.calendar-view-menu-item')];
        const close = (refocus) => {
            dd.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
            document.removeEventListener('click', this._viewMenuDismiss, true);
            document.removeEventListener('keydown', this._viewMenuKeydown, true);
            this._viewMenuDismiss = this._viewMenuKeydown = this._viewMenuClose = null;
            if (refocus) btn.focus();
        };
        this._viewMenuClose = close;
        dd.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
        (items.find(i => i.getAttribute('aria-checked') === 'true') || items[0])?.focus();
        this._viewMenuDismiss = (e) => { if (!dd.contains(e.target)) close(false); };
        this._viewMenuKeydown = (e) => {
            if (e.key === 'Escape') { close(true); return; }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const idx = items.indexOf(document.activeElement);
                const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
                items[next]?.focus();
            }
        };
        document.addEventListener('click', this._viewMenuDismiss, true);
        document.addEventListener('keydown', this._viewMenuKeydown, true);
    },

    // The timeline switch lives inside the view menu, so toggling it tears
    // down and re-renders the whole calendar card (same as any other view
    // menu action). Re-open the fresh menu and refocus the switch afterward
    // so repeated toggling keeps giving live feedback instead of closing.
    toggleTimelineFromMenu(el) {
        if (el.getAttribute('aria-disabled') === 'true') return;
        CalendarManager.toggleTimelineMode();
        const btn = document.querySelector('.calendar-group [aria-controls="calViewMenu"]');
        if (!btn) return;
        this.toggleViewMenu(btn);
        document.querySelector('#calViewMenu .cal-menu-switch')?.focus();
    },

    // Right-click menu for a secondary header clock: one checkable item that
    // shows/hides the timeline's secondary time-zone gutter for that clock's
    // zone. Lives here (not 3-app-init) so its document-level listeners are
    // torn down with the other calendar menus (_teardownCalendarMenus) before
    // a card re-render can orphan them. Invoked from the header's delegated
    // contextmenu handler; `ev` is the contextmenu event (keyboard Shift+F10 /
    // menu key report 0,0 coordinates, so those anchor to the clock instead).
    showClockTzMenu(clockEl, zone, ev) {
        const cm = window.CalendarManager;
        if (!cm) return;
        // One open menu at a time, of any kind.
        this._viewMenuClose?.(false);
        this._closeClockTzMenu?.(false);

        const checked = cm.getSecondaryTzChoice() === zone;
        const menu = document.createElement('div');
        menu.className = 'card-context-menu clock-tz-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', `Calendar options — ${cm._tzLabel(zone)}`);
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'card-context-item';
        item.setAttribute('role', 'menuitemcheckbox');
        item.setAttribute('aria-checked', String(checked));
        item.textContent = `${checked ? '✓ ' : ''}Show in calendar`;
        menu.appendChild(item);

        let x = ev?.pageX || 0;
        let y = ev?.pageY || 0;
        if (!x && !y) {
            const r = clockEl.getBoundingClientRect();
            x = r.left + window.scrollX + r.width / 2;
            y = r.bottom + window.scrollY;
        }
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        document.body.appendChild(menu);
        // Keep the pane on screen near the viewport edges (the header spans
        // the full width, so the right edge is a real case).
        const mr = menu.getBoundingClientRect();
        if (mr.right > window.innerWidth) menu.style.left = `${Math.max(0, x - mr.width)}px`;
        if (mr.bottom > window.innerHeight) menu.style.top = `${Math.max(0, y - mr.height)}px`;

        const close = (refocus) => {
            menu.remove();
            document.removeEventListener('click', this._clockTzMenuDismiss, true);
            document.removeEventListener('keydown', this._clockTzMenuKeydown, true);
            this._clockTzMenuDismiss = this._clockTzMenuKeydown = this._closeClockTzMenu = null;
            if (refocus) clockEl.focus();
        };
        this._closeClockTzMenu = close;

        item.addEventListener('click', () => {
            // Close BEFORE toggling: the toggle re-renders the calendar card,
            // whose teardown would otherwise rip this menu's state out from
            // under the close() that follows.
            close(true);
            cm.toggleSecondaryTz(zone);
            // The choice is stored even where the column can't show right now;
            // say so instead of appearing to do nothing.
            const nowOn = cm.getSecondaryTzChoice() === zone;
            if (nowOn && (cm.getViewMode() === 'list' || !cm.getTimelineMode()
                || cm.getSecondaryTimelineZone() !== zone)) {
                UI.showToast("Saved — the second time column shows in the calendar's hour-by-hour timeline view.");
            }
        });

        // The opening event is 'contextmenu' (or a keyboard equivalent), never
        // 'click', so registering the dismiss listeners immediately is safe —
        // the gesture that opened the menu cannot also close it.
        this._clockTzMenuDismiss = (e) => { if (!menu.contains(e.target)) close(false); };
        this._clockTzMenuKeydown = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
            if (e.key === 'Tab') close(false);   // single item: don't trap, just fold
        };
        document.addEventListener('click', this._clockTzMenuDismiss, true);
        document.addEventListener('keydown', this._clockTzMenuKeydown, true);
        item.focus();
    },

    _calendarSetupPrompt() {
        return `
            <div class="calendar-setup-prompt">
                <p>Connect your Google Calendar to see upcoming events here.</p>
                <ol>
                    <li>Deploy the Apps Script proxy (see 5-calendar.js for template)</li>
                    <li>Get your calendars' secret ICS URLs from Google Calendar Settings</li>
                    <li>Open Settings (<svg class="ico ico-sm" aria-hidden="true"><use href="#ico-menu"></use></svg> menu) and paste the proxy URL, token, and ICS URLs (one per line)</li>
                </ol>
            </div>
        `;
    },

    _calendarEmptyState() {
        return `<div class="calendar-empty-state">No upcoming events in the next 7 days.</div>`;
    },

    _calendarErrorState(error) {
        return `<div class="calendar-error-state">Failed to load events: ${Utils.sanitizeHTML(error)}</div>`;
    },

    _calendarEventsList(events) {
        const cm = window.CalendarManager;
        const placement = cm.getCountdownPlacement();
        const now = new Date();

        // Build the countdown chip for one event (null if it shouldn't show one).
        // `right-column` omits the icon for emphasis.
        const buildCountdown = (ev) => {
            const cd = cm.getCountdownInfo(ev);
            if (!cd) return null;
            // Right-column stacks a static "In" label above the ticking value
            // ("In" / "2h 51m"); "Ongoing" has no "In" prefix so it fills the
            // value line alone. Other placements keep "In 2h 51m" inline.
            let inner;
            if (placement === 'right-column') {
                const hasIn = cd.text.startsWith('In ');
                const prefix = `<span class="ec-prefix" aria-hidden="true"${hasIn ? '' : ' hidden'}>In</span>`;
                const value = hasIn ? cd.text.slice(3) : cd.text;
                inner = `${prefix}<span class="ec-text">${Utils.sanitizeHTML(value)}</span>`;
            } else {
                inner = `<span class="ec-icon" aria-hidden="true"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-hourglass"></use></svg></span><span class="ec-text">${Utils.sanitizeHTML(cd.text)}</span>`;
            }
            return `<div class="event-countdown ec-${placement} tier-${cd.tier}" data-countdown-start="${cd.startMs}" data-countdown-end="${cd.endMs}" role="timer" aria-label="${Utils.sanitizeHTML(cd.ariaLabel)}">${inner}</div>`;
        };

        const renderEvent = (ev) => {
            const times = cm.formatEventTimeZones(ev).map(z => `
                <div class="calendar-event-tz">
                    <span class="tz-label">${Utils.sanitizeHTML(z.label)}</span>
                    <span class="tz-when">${Utils.sanitizeHTML(z.when)}</span>
                </div>`).join('');
            const title = Utils.sanitizeHTML(ev.title || 'Untitled');
            const location = ev.location ? Utils.sanitizeHTML(ev.location) : '';
            const rawCalColor = ev._calColor || DEFAULT_CAL_COLOR;
            const calColor = Utils.isValidColor(rawCalColor) ? rawCalColor : DEFAULT_CAL_COLOR;
            const countdown = buildCountdown(ev);

            // Store event data in data attributes for the detail modal (item 13).
            // We JSON-encode the minimal fields we need; they are extracted on click.
            const safeTitle = Utils.sanitizeHTML(ev.title || 'Untitled');
            const safeDesc = Utils.sanitizeHTML(ev.description || '');
            const safeLoc = Utils.sanitizeHTML(ev.location || '');

            // Surface a video-call join link (Meet/Zoom/Teams/Webex) as a one-click
            // button. Prefer the dedicated conferenceUrl (Google Meet's link lives in
            // the X-GOOGLE-CONFERENCE property — present once the proxy is redeployed),
            // then fall back to scanning the description/location.
            const meet = this._extractMeetLink(ev.conferenceUrl, ev.description, ev.location);
            const meetUrlSafe = meet ? Utils.sanitizeHTML(meet.url) : '';
            const meetLabelSafe = meet ? Utils.sanitizeHTML(meet.label) : '';
            const joinLink = meet
                ? `<a class="calendar-event-join has-ico" href="${meetUrlSafe}" target="_blank" rel="noopener"
                       data-cal-join="1" title="${meetLabelSafe}"
                       aria-label="${meetLabelSafe}: ${safeTitle}"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-video"></use></svg> Join</a>`
                : '';

            const startD = new Date(ev.start);
            const endD = ev.end ? new Date(ev.end) : startD;
            const isPassed = (endD > startD ? endD : startD) <= now;

            const timesCol = times + (placement === 'time-column' && countdown ? countdown : '');
            const detailsCol = `<div class="calendar-event-title">${title}</div>`
                + (placement === 'title' && countdown ? countdown : '')
                + (location ? `<div class="calendar-event-location">${location}</div>` : '')
                + joinLink;
            const sideCol = (placement === 'pill' || placement === 'right-column') && countdown ? countdown : '';

            return `
                <div class="calendar-event-item ${ev.allDay ? 'all-day' : ''}${isPassed ? ' is-passed' : ''}"
                     style="border-left-color: ${calColor}; cursor: pointer;"
                     data-cal-event="1"
                     data-cal-title="${safeTitle}"
                     data-cal-desc="${safeDesc}"
                     data-cal-loc="${safeLoc}"
                     data-cal-meet="${meetUrlSafe}"
                     data-cal-start="${Utils.sanitizeHTML(ev.start || '')}"
                     data-cal-end="${Utils.sanitizeHTML(ev.end || '')}"
                     data-cal-allday="${ev.allDay ? '1' : '0'}"
                     tabindex="0"
                     role="button"
                     aria-label="View details: ${safeTitle}${isPassed ? ' (ended)' : ''}">
                    <div class="calendar-event-times">${timesCol}</div>
                    <div class="calendar-event-details">${detailsCol}</div>
                    ${sideCol}
                </div>
            `;
        };

        // Ungrouped: flat chronological list
        if (cm.getGrouping() === 'none') {
            return events.map(renderEvent).join('');
        }

        // Grouped by the selected timezone's calendar day
        const grouped = cm.groupEventsByDay(events, cm.getGroupingTimezone());
        let html = '';
        for (const [dayLabel, dayEvents] of Object.entries(grouped)) {
            html += `<div class="calendar-day-header">${Utils.sanitizeHTML(dayLabel)}</div>`;
            for (const ev of dayEvents) html += renderEvent(ev);
        }
        return html;
    },

    _calendarDayView() {
        const cm = window.CalendarManager;
        const win = cm.getDayViewWindow();
        const buckets = cm.bucketEventsForDayView(win);
        const n = win.days.length;
        const rangeLabel = `${win.days[0].label} – ${win.days[n - 1].label}`;
        const bar = this._calendarUpcomingBar();
        const nav = `
            <div class="calendar-dayview-nav">
                <button class="cal-nav-btn" onclick="CalendarManager.pageDayView(-1)" ${cm.canPageDayView(-1) ? '' : 'disabled'} aria-label="Previous ${n} days" title="Previous ${n} days">‹</button>
                <span class="cal-nav-range">${Utils.sanitizeHTML(rangeLabel)}</span>
                <button class="cal-nav-btn" onclick="CalendarManager.pageDayView(1)" ${cm.canPageDayView(1) ? '' : 'disabled'} aria-label="Next ${n} days" title="Next ${n} days">›</button>
            </div>`;
        if (cm.getTimelineMode()) return bar + nav + this._calendarTimeline(win);
        const cols = win.days.map(d => {
            const evs = buckets[d.dateStr] || [];
            const chips = evs.length
                ? evs.map(ev => this._calendarDayChip(ev, win.tz, d.label)).join('')
                : `<div class="calendar-day-empty">No events</div>`;
            return `
                <div class="calendar-day-col${d.isToday ? ' is-today' : ''}">
                    <div class="calendar-day-col-header">${Utils.sanitizeHTML(d.isToday ? 'Today · ' + d.label : d.label)}</div>
                    <div class="calendar-day-col-events">${chips}</div>
                </div>`;
        }).join('');
        return bar + nav + `<div class="calendar-day-grid" style="--cal-days:${n}">${cols}</div>`;
    },

    // The upcoming-event strip above the day-view nav. Renders the next N future
    // timed events (CalendarManager.getUpcomingBarEvents) as either a scrolling
    // ticker or a compact list, per the Settings format. Empty string when the
    // bar is off or there are no qualifying events. Items reuse the shared
    // data-cal-* attributes so the delegated card handler opens the detail modal.
    _calendarUpcomingBar() {
        const cm = window.CalendarManager;
        const events = cm.getUpcomingBarEvents();
        if (!events.length) return '';
        // Ticker format now renders in the header instead (_calendarHeaderTicker);
        // this body-of-card bar is list-only.
        if (cm.getUpcomingBarFormat() !== 'list') return '';
        const format = cm.getUpcomingBarFormat();
        const tz = cm.getAnchorTimezone();

        const dot = (ev) => {
            const raw = ev._calColor || DEFAULT_CAL_COLOR;
            const c = Utils.isValidColor(raw) ? raw : DEFAULT_CAL_COLOR;
            return `<span class="cal-upcoming-dot" style="background:${c}" aria-hidden="true"></span>`;
        };
        const timeText = (ev) => cm.formatBarCountdown(new Date(ev.start).getTime()) || '';

        if (format === 'list') {
            const rows = events.map(ev => {
                const title = Utils.sanitizeHTML(ev.title || 'Untitled');
                const when = Utils.sanitizeHTML(cm._formatWhen(ev, tz, true));
                const t = Utils.sanitizeHTML(timeText(ev));
                const start = new Date(ev.start).getTime();
                return `
                    <div class="cal-upcoming-item cal-upcoming-row" data-bar-start="${start}"
                         ${this._calEventDataAttrs(ev)}
                         tabindex="0" role="button"
                         aria-label="View details: ${title}, ${when}, starting ${t}">
                        ${dot(ev)}
                        <span class="cal-upcoming-name">${title}</span>
                        <span class="cal-upcoming-when">${when}</span>
                        <span class="cal-upcoming-time">${t}</span>
                    </div>`;
            }).join('');
            return `<div class="cal-upcoming-bar cal-upcoming-list" aria-label="Upcoming events">${rows}</div>`;
        }
    },

    // Compact scrolling ticker for the card header (day views only — the list
    // format keeps rendering in the card body via _calendarUpcomingBar above).
    // Same dot/time helpers and double-sequence loop trick as the ticker
    // branch this replaced; only the gating and the extra cal-upcoming-header
    // class (for header-scale sizing) differ.
    //
    // `placement` is 'header' (inline in the title row, full-width cards) or
    // 'row' (its own full-width strip under the header, column-width cards).
    // Only the slot wrapper's class changes — the ticker itself is identical, so
    // _sizeUpcomingTicker measures and animates it the same way either way.
    _calendarHeaderTicker(placement = 'header') {
        const cm = window.CalendarManager;
        if (!cm?.state.isConfigured) return '';
        if ((cm.getViewMode?.() || 'list') === 'list') return '';
        if (cm.getUpcomingBarFormat() !== 'ticker') return '';
        const events = cm.getUpcomingBarEvents();
        if (!events.length) return '';
        const tz = cm.getAnchorTimezone();

        const dot = (ev) => {
            const raw = ev._calColor || DEFAULT_CAL_COLOR;
            const c = Utils.isValidColor(raw) ? raw : DEFAULT_CAL_COLOR;
            return `<span class="cal-upcoming-dot" style="background:${c}" aria-hidden="true"></span>`;
        };
        const timeText = (ev) => cm.formatBarCountdown(new Date(ev.start).getTime()) || '';

        // Ticker: two identical sequences translated by -50% for a seamless loop.
        // Only the first is focusable/announced; the duplicate is aria-hidden and
        // not a tab stop, but stays clickable via the delegated data-cal-event.
        const itemHTML = (ev, dup) => {
            const title = Utils.sanitizeHTML(ev.title || 'Untitled');
            const t = Utils.sanitizeHTML(timeText(ev));
            // The visible ticker drops the "in " prefix ("2h 59m ·"); the
            // aria-label keeps it — "starting in 2h 59m" is the natural
            // phrasing, and formatBarCountdown stays shared with the list
            // format, which still shows the word.
            const tShort = Utils.sanitizeHTML(timeText(ev).replace(/^in /, ''));
            const start = new Date(ev.start).getTime();
            const a11y = dup
                ? `tabindex="-1" aria-hidden="true"`
                : `tabindex="0" role="button" aria-label="View details: ${title}, starting ${t}"`;
            // Countdown before the name (user request): the ticking number is
            // what you scan the strip for. The "·" separator lives INSIDE the
            // time span — _tickUpcomingBar rewrites that span's textContent
            // every minute and must reproduce it, so the two must stay agreed.
            return `
                <span class="cal-upcoming-item cal-upcoming-tick" data-bar-start="${start}"
                      ${this._calEventDataAttrs(ev)} ${a11y}>
                    ${dot(ev)}
                    <span class="cal-upcoming-time">${tShort} ·</span>
                    <span class="cal-upcoming-name">${title}</span>
                </span>`;
        };
        const seq = (dup) => `<div class="cal-upcoming-seq"${dup ? ' aria-hidden="true"' : ''}>${events.map(ev => itemHTML(ev, dup)).join('')}</div>`;
        // Duration scales with item count so more events don't scroll faster
        // (the loop distance is one sequence width, which grows with the count).
        // Divided by 0.85 × 0.9 → 15% slower than the base cadence, then a
        // further 10% slower. This is the pre-measurement value (and the one used
        // under reduced motion); _sizeUpcomingTicker sets the authoritative
        // width-proportional duration.
        const dur = Math.max(16, Math.round(events.length * 7 / (0.85 * 0.9)));
        // Slot fills the header's remaining width and right-aligns the ticker,
        // which is itself only 57.8% wide (42.2% narrower than the full slot).
        // In 'row' placement the slot is a full-width block instead and the
        // ticker spans all of it.
        return `<div class="cal-upcoming-header-slot${placement === 'row' ? ' cal-upcoming-row-slot' : ''}">
            <div class="cal-upcoming-bar cal-upcoming-ticker cal-upcoming-header" aria-label="Upcoming events">
                <div class="cal-upcoming-track" style="--cal-ticker-dur:${dur}s">${seq(false)}${seq(true)}</div>
            </div>
        </div>`;
    },

    _calendarDayChip(ev, tz, dayLabel) {
        const cm = window.CalendarManager;
        const rawCalColor = ev._calColor || DEFAULT_CAL_COLOR;
        const calColor = Utils.isValidColor(rawCalColor) ? rawCalColor : DEFAULT_CAL_COLOR;

        // _timeStr expects a Date; ev.start/ev.end are ISO strings.
        const startDate = new Date(ev.start);
        const endDate = ev.end ? new Date(ev.end) : startDate;

        // Directional markers on the time line show how a multi-day span crosses this
        // column: `continues` = event's start day, `started` = its final day,
        // `spanning` = a full middle day. Applies to both all-day and timed spans.
        let timeText;
        if (ev._overnight === 'continues') {
            timeText = ev.allDay ? 'All day →' : `${cm._timeStr(startDate, tz)} →`;
        } else if (ev._overnight === 'started') {
            timeText = ev.allDay ? '→ All day' : `→ ${cm._timeStr(endDate, tz)}`;
        } else if (ev._overnight === 'spanning') {
            timeText = 'All day →';
        } else if (ev.allDay) {
            timeText = 'All day';
        } else {
            timeText = `${cm._timeStr(startDate, tz)}–${cm._timeStr(endDate, tz)}`;
        }

        const isAllDayLike = ev.allDay || ev._overnight === 'spanning';
        const safeTitle = Utils.sanitizeHTML(ev.title || 'Untitled');

        return `
            <div class="calendar-day-chip${isAllDayLike ? ' all-day' : ''}"
                 style="border-left-color: ${calColor}; cursor: pointer;"
                 ${this._calEventDataAttrs(ev)}
                 tabindex="0"
                 role="button"
                 aria-label="View details: ${safeTitle}, ${Utils.sanitizeHTML(dayLabel)}, ${Utils.sanitizeHTML(timeText)}">
                <div class="calendar-chip-time">${Utils.sanitizeHTML(timeText)}</div>
                <div class="calendar-chip-title">${safeTitle}</div>
            </div>
        `;
    },

    // The data-cal-* attribute block shared by list rows, day chips, and timeline
    // blocks. The delegated container handlers open the detail modal off these.
    _calEventDataAttrs(ev) {
        const meet = this._extractMeetLink(ev.conferenceUrl, ev.description, ev.location);
        return `data-cal-event="1"`
            + ` data-cal-title="${Utils.sanitizeHTML(ev.title || 'Untitled')}"`
            + ` data-cal-desc="${Utils.sanitizeHTML(ev.description || '')}"`
            + ` data-cal-loc="${Utils.sanitizeHTML(ev.location || '')}"`
            + ` data-cal-meet="${meet ? Utils.sanitizeHTML(meet.url) : ''}"`
            + ` data-cal-start="${Utils.sanitizeHTML(ev.start || '')}"`
            + ` data-cal-end="${Utils.sanitizeHTML(ev.end || '')}"`
            + ` data-cal-allday="${ev.allDay ? '1' : '0'}"`;
    },

    // Timeline hour-row height clamp, in px per hour. v4.26 raised both ends
    // 10% (from 30/78; 78 was 2x the legacy fixed 39) — dense spans sit at
    // the min, so that is the knob that actually changes what a day view
    // shows. Between the clamps the grid exactly fills the card, so the
    // computed height there is the card's, not these.
    TL_HOUR_MIN: 33,
    TL_HOUR_MAX: 86,

    // Hour-by-hour timeline for 3/5-day views. A shared hour axis (left gutter)
    // aligns time-positioned event blocks across all day columns; all-day events
    // sit in a band above the grid.
    _calendarTimeline(win) {
        const cm = window.CalendarManager;
        const model = cm.buildTimelineModel(win);
        // Optional secondary time-zone gutter (right-click a header clock →
        // "Show in calendar"). Null while the choice is unset, orphaned (no
        // enabled clock has the zone) or equal to the axis's own zone — the
        // whole grid then renders exactly as before, one gutter column.
        const tz2 = cm.getSecondaryTimelineZone();
        // displaySpanMin is the COMPRESSED span: merged free stretches count as
        // one reduced-height row each, not their real length.
        const spanHours = model.displaySpanMin / 60;
        // Floor-scale estimate only — _sizeTimelineHours() retunes --tl-gridh
        // immediately after layout, clamped to [TL_HOUR_MIN, TL_HOUR_MAX] px/hour.
        const gridH = Math.max(this.TL_HOUR_MIN, Math.round(spanHours * this.TL_HOUR_MIN));
        const n = model.days.length;
        // Every position/height below is a calc() fraction of --tl-gridh (set on
        // the root div) rather than a baked px value, so hour labels, gridlines,
        // event blocks, gap bands and the now-line share ONE basis by
        // construction — they can't drift apart — and the post-layout sizing
        // pass can retune the row height without re-rendering any of this.
        const frac = pct => (pct / 100).toFixed(5);

        // A single CSS grid holds three row-groups that share one column template
        // and one horizontal scroll, so the day headers, all-day band, and hour
        // grid stay aligned: [gutter | day-1 | … | day-N] — or, with a secondary
        // zone active, [gutter2 | gutter | day-1 | … | day-N]. The corner and
        // all-day-label cells are AUTO-placed, so each of those rows needs one
        // extra leading cell when the extra column exists, or auto-placement
        // shoves the day headers/cells a column right of the hour grid.
        // Row 1 — per-day headers (matches the chip day view's column headers).
        // The secondary corner carries the zone's short label — it is the one
        // place the column identifies itself (the gutter shows bare times).
        const corner2 = tz2
            ? `<div class="cal-tl-corner cal-tl-corner2" aria-hidden="true" title="${Utils.sanitizeHTML(tz2)}">${Utils.sanitizeHTML(cm._tzLabel(tz2))}</div>`
            : '';
        const headers = corner2 + `<div class="cal-tl-corner" aria-hidden="true"></div>`
            + model.days.map(d =>
                `<div class="cal-tl-dayhead${d.day.isToday ? ' is-today' : ''}">${Utils.sanitizeHTML(d.day.isToday ? 'Today · ' + d.day.label : d.day.label)}</div>`
            ).join('');

        // Row 2 — all-day band (only when the window has any all-day events).
        const hasAllDay = model.days.some(d => d.allDay.length > 0);
        const alldayRow = hasAllDay
            ? (tz2 ? `<div class="cal-tl-allday-spacer" aria-hidden="true"></div>` : '')
              + `<div class="cal-tl-allday-label" aria-hidden="true">all-day</div>`
              + model.days.map(d =>
                    `<div class="cal-tl-allday-cell${d.day.isToday ? ' is-today' : ''}">${d.allDay.map(ev => this._calendarDayChip(ev, win.tz, d.day.label)).join('')}</div>`
                ).join('')
            : '';

        // Row 3 — hour axis gutter + positioned day columns. Everything on the
        // hour row is EXPLICITLY grid-placed: the "no events" gap overlay must
        // share these cells, and a definitely-placed item makes auto-placement
        // skip its cells — auto-placed columns would be pushed out of the row.
        // Explicitly placed items may overlap freely.
        const hourRow = hasAllDay ? 3 : 2;
        // Secondary gutter: same hour lines, formatted in tz2 off each line's
        // instant (h.atMs) — real minutes included, so :30/:45-offset zones read
        // "18:30". Class is cal-tl-gutter2, deliberately NOT also cal-tl-gutter:
        // _sizeTimelineHours measures querySelector('.cal-tl-gutter') and must
        // keep finding the primary. Labels reuse .cal-tl-hour (typography and,
        // critically, its no-`zoom` rule — zoom would scale the calc() top and
        // drag the labels off the gridlines) plus a dimming modifier.
        const gutter2 = tz2 ? `
            <div class="cal-tl-gutter2" style="grid-row:${hourRow}; grid-column:1; height:var(--tl-gridh)" aria-hidden="true">
                ${model.hours.map(h =>
                    `<span class="cal-tl-hour cal-tl-hour--alt" style="top:calc(var(--tl-gridh)*${frac(h.topPct)})">${cm._paddedTimeStr(new Date(h.atMs), tz2)}</span>`
                ).join('')}
            </div>` : '';
        const gutter = `
            <div class="cal-tl-gutter" style="grid-row:${hourRow}; grid-column:${tz2 ? 2 : 1}; height:var(--tl-gridh)" aria-hidden="true">
                ${model.hours.map(h => {
                    // topPct comes from the model's compressed (gap-collapsed) mapping.
                    // "14h" notation (matching the gap bands and the secondary gutter).
                    return `<span class="cal-tl-hour" style="top:calc(var(--tl-gridh)*${frac(h.topPct)})">${h.label}h</span>`;
                }).join('')}
            </div>`;

        // Hour gridlines: merged gaps collapse to sub-hour rows, so hour
        // boundaries below a gap leave the fixed hour lattice and a repeating
        // gradient would drift off them. Paint one 1px background layer per
        // hour line instead, positioned off the same compressed mapping as the
        // hour labels and event blocks — as a calc() fraction of --tl-gridh, the
        // same variable the labels and blocks use. (The class supplies
        // background-color; these inline layers stack on top of it. Longhands
        // only — a `background:` shorthand here would wipe that background-color.)
        const lineImg = 'linear-gradient(rgba(255,255,255,0.08), rgba(255,255,255,0.08))';
        const lineBg = model.hours.length
            ? `background-image:${model.hours.map(() => lineImg).join(',')};`
              + `background-position:${model.hours.map(h => `0 calc(var(--tl-gridh)*${frac(h.topPct)})`).join(',')};`
              + `background-size:100% 1px;background-repeat:no-repeat;`
            : '';

        const cols = model.days.map((d, di) => {
            const blocks = d.timed.map(p => {
                const ev = p.ev;
                const rawColor = ev._calColor || DEFAULT_CAL_COLOR;
                const color = Utils.isValidColor(rawColor) ? rawColor : DEFAULT_CAL_COLOR;
                const safeTitle = Utils.sanitizeHTML(ev.title || 'Untitled');
                const startD = new Date(ev.start);
                const endD = ev.end ? new Date(ev.end) : startD;
                const timeText = `${cm._timeStr(startD, win.tz)}–${cm._timeStr(endD, win.tz)}`;
                const width = 100 / p.laneCount;
                const left = p.lane * width;
                // Position as a calc() fraction of --tl-gridh — the identical basis
                // the hour labels and the CSS hour gridlines use — so events lock to
                // the hour lines regardless of the column's actual rendered height
                // (a %-basis drifts if the column is ever taller/shorter than the
                // variable). The 3px floor keeps very short events tappable.
                return `
                    <div class="cal-tl-event"
                         style="top:calc(var(--tl-gridh)*${frac(p.topPct)}); height:max(3px, calc(var(--tl-gridh)*${frac(p.heightPct)})); left:${left}%; width:calc(${width}% - 2px); background:${color};"
                         ${this._calEventDataAttrs(ev)}
                         tabindex="0" role="button"
                         aria-label="View details: ${safeTitle}, ${Utils.sanitizeHTML(d.day.label)}, ${Utils.sanitizeHTML(timeText)}">
                        <span class="cal-tl-event-text"><span class="cal-tl-event-time">${Utils.sanitizeHTML(timeText)}</span><span class="cal-tl-event-title">${safeTitle}</span></span>
                    </div>`;
            }).join('');
            const nowLine = d.nowTopPct != null
                ? `<div class="cal-tl-now" style="top:calc(var(--tl-gridh)*${frac(d.nowTopPct)})" aria-hidden="true"></div>` : '';
            return `
                <div class="cal-tl-col${d.day.isToday ? ' is-today' : ''}" style="grid-row:${hourRow}; grid-column:${di + (tz2 ? 3 : 2)}; height:var(--tl-gridh); ${lineBg}">
                    ${nowLine}${blocks || ''}
                </div>`;
        }).join('');

        // Merged "no events" bands: one overlay grid item pinned onto the hour-grid
        // row spanning every day column (row index depends on the all-day band).
        // Each band is collapsed to a single reduced-height row labeled with the
        // hour range it stands in for. Positioned as a calc() fraction of
        // --tl-gridh, the same basis as hour labels/gridlines/event blocks.
        const gapsHtml = model.gaps.length
            ? `<div class="cal-tl-gaps" style="grid-row:${hourRow}; height:var(--tl-gridh)" aria-hidden="true">
                ${model.gaps.map(g => `<div class="cal-tl-gap" style="top:calc(var(--tl-gridh)*${frac(g.topPct)}); height:calc(var(--tl-gridh)*${frac(g.heightPct)})"><span>${Utils.sanitizeHTML(g.label)} · no events</span></div>`).join('')}
               </div>`
            : '';

        return `
            <div class="calendar-timeline${tz2 ? ' is-two-tz' : ''}" style="--cal-days:${n}; --tl-gridh:${gridH}px" data-span-min="${model.displaySpanMin}">
                ${headers}
                ${alldayRow}
                ${gutter2}
                ${gutter}
                ${cols}
                ${gapsHtml}
            </div>`;
    },

    _calendarLegendButton(calendars) {
        if (!calendars || !calendars.length) return '';
        return `<span class="cal-legend-wrap"><button class="cal-legend-btn" onclick="UIRenderer.toggleCalendarLegend(this)" aria-haspopup="true" aria-expanded="false" aria-controls="calLegendPopover" aria-label="Show subscribed calendars" title="Subscribed calendars">i</button><div class="cal-legend-popover" id="calLegendPopover" role="group" aria-label="Subscribed calendars"><ul class="cal-legend-pop-list">${this._calendarLegendItems(calendars)}</ul></div></span>`;
    },

    // Legend rows are switches: toggling one hides/shows that calendar's events
    // (the subscription/url is kept). aria-checked=true means the calendar is
    // visible. Passing the index (not the url) keeps urls out of inline onclick.
    _calendarLegendItems(calendars) {
        const cm = window.CalendarManager;
        return calendars.map((cal, i) => {
            const color = Utils.isValidColor(cal.color) ? cal.color : DEFAULT_CAL_COLOR;
            const hidden = cm ? cm.isCalendarHidden(cal.url) : false;
            const safeName = Utils.sanitizeHTML(cal.name);
            return `<li class="cal-legend-pop-item"><button type="button" class="cal-legend-toggle${hidden ? ' is-hidden' : ''}" role="switch" aria-checked="${hidden ? 'false' : 'true'}" onclick="CalendarManager.toggleCalendarVisibility(${i})" title="${hidden ? 'Show' : 'Hide'} ${safeName}"><span class="calendar-legend-dot" style="background:${color};"></span><span class="cal-legend-name">${safeName}</span></button></li>`;
        }).join('');
    },

    toggleCalendarLegend(btn) {
        const wrap = btn.closest('.cal-legend-wrap');
        const close = (refocus) => {
            wrap.classList.remove('pinned');
            btn.setAttribute('aria-expanded', 'false');
            document.removeEventListener('click', this._calLegendDismiss, true);
            document.removeEventListener('keydown', this._calLegendKeydown);
            this._calLegendDismiss = this._calLegendKeydown = null;
            if (refocus) btn.focus();
        };
        if (wrap.classList.contains('pinned')) { close(false); return; }
        wrap.classList.add('pinned');
        btn.setAttribute('aria-expanded', 'true');
        this._calLegendDismiss = (e) => { if (!wrap.contains(e.target)) close(false); };
        this._calLegendKeydown = (e) => { if (e.key === 'Escape') close(true); };
        document.addEventListener('click', this._calLegendDismiss, true);
        document.addEventListener('keydown', this._calLegendKeydown);
    },

    // ========================================
    // CALENDAR EVENT DETAIL MODAL (item 13)
    // ========================================

    // Detect a video-conference join link in an event's description/location.
    // Google embeds the Meet URL in the event DESCRIPTION (and X-GOOGLE-CONFERENCE),
    // so we surface it as a one-click "Join". Returns { url, label } or null. Only
    // matches https links to known hosts, so the URL is always safe to render.
    _extractMeetLink(...texts) {
        const blob = texts.filter(Boolean).join(' ');
        const patterns = [
            [/https:\/\/meet\.google\.com\/[a-z0-9-]+/i, 'Join Google Meet'],
            [/https:\/\/[a-z0-9.-]*zoom\.us\/[^\s<>"')]+/i, 'Join Zoom'],
            [/https:\/\/teams\.(?:microsoft|live)\.com\/[^\s<>"')]+/i, 'Join Microsoft Teams'],
            [/https:\/\/[a-z0-9.-]*webex\.com\/[^\s<>"')]+/i, 'Join Webex'],
        ];
        for (const [re, label] of patterns) {
            const m = blob.match(re);
            if (m) return { url: m[0], label };
        }
        return null;
    },

    // Escape text and turn http(s) URLs into clickable links. Used for the event
    // description, which commonly holds the Meet link plus other URLs. Non-URL text
    // is HTML-escaped; only http(s) links are linkified, so it's injection-safe.
    _linkifyText(text) {
        const re = /(https?:\/\/[^\s<>"')]+)/g;
        let out = '', last = 0, m;
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) out += Utils.sanitizeHTML(text.slice(last, m.index));
            const safeUrl = Utils.sanitizeHTML(m[1]);
            out += `<a href="${safeUrl}" target="_blank" rel="noopener" class="cal-detail-link">${safeUrl}</a>`;
            last = m.index + m[1].length;
        }
        if (last < text.length) out += Utils.sanitizeHTML(text.slice(last));
        return out.replace(/\n/g, '<br>');
    },

    _openCalendarEventDetail(el) {
        // Read data attributes placed by renderEvent
        const title = el.dataset.calTitle || '';
        const desc = el.dataset.calDesc || '';
        const loc = el.dataset.calLoc || '';
        const start = el.dataset.calStart || '';
        const end = el.dataset.calEnd || '';
        const allDay = el.dataset.calAllday === '1';

        // Build human-readable time string (reuse CalendarManager formatting)
        const cm = window.CalendarManager;
        let timesHTML = '';
        if (cm && start) {
            try {
                const evObj = { title, description: desc.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'"),
                    location: loc.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'"),
                    start, end, allDay };
                const zones = cm.formatEventTimeZones(evObj, true);
                timesHTML = zones.map(z => `
                    <div class="cal-detail-tz">
                        <span class="cal-detail-tz-label">${Utils.sanitizeHTML(z.label)}</span>
                        <span class="cal-detail-tz-when">${Utils.sanitizeHTML(z.when)}</span>
                    </div>`).join('');
            } catch (_) { /* ignore timezone formatting errors */ }
        }

        // Decode HTML entities in stored attribute values so we display real text
        const decodeAttr = (s) => s
            .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
            .replace(/&quot;/g,'"').replace(/&#039;/g,"'");

        const titleDecoded = decodeAttr(title);
        const descDecoded = decodeAttr(desc);
        const locDecoded = decodeAttr(loc);

        const descHTML = descDecoded
            ? `<div class="cal-detail-section"><span class="cal-detail-label">Description</span><div class="cal-detail-desc">${this._linkifyText(descDecoded)}</div></div>`
            : '';

        // Prominent "Join" button when a video-call link was detected (stored on
        // the row as data-cal-meet). Guard the protocol as defence-in-depth.
        const meetUrl = decodeAttr(el.dataset.calMeet || '');
        const joinHTML = /^https:\/\//i.test(meetUrl)
            ? `<div class="cal-detail-section cal-detail-join">
                   <a href="${Utils.sanitizeHTML(meetUrl)}" target="_blank" rel="noopener" class="cal-detail-join-link has-ico"><svg class="ico" aria-hidden="true"><use href="#ico-video"></use></svg> Join video call</a>
               </div>`
            : '';
        const locHTML = locDecoded
            ? `<div class="cal-detail-section"><span class="cal-detail-label">Location</span><div class="cal-detail-loc">${Utils.sanitizeHTML(locDecoded)}</div></div>`
            : '';
        const timesSection = timesHTML
            ? `<div class="cal-detail-section"><span class="cal-detail-label">Time</span>${timesHTML}</div>`
            : '';

        // Remove any previously-opened detail modal
        document.getElementById('calEventDetailModal')?.remove();

        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'calEventDetailModal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'calEventDetailTitle');
        modal.innerHTML = `
            <div class="modal-content cal-event-detail-content">
                <div class="modal-header">
                    <h2 id="calEventDetailTitle" class="cal-detail-title">${Utils.sanitizeHTML(titleDecoded)}</h2>
                    <button class="close-modal" id="closeCalEventDetail" aria-label="Close">×</button>
                </div>
                <div class="cal-detail-body">
                    ${joinHTML}
                    ${timesSection}
                    ${locHTML}
                    ${descHTML}
                    <div class="cal-detail-section cal-detail-gcal">
                        <a href="https://calendar.google.com" target="_blank" rel="noopener" class="cal-detail-gcal-link has-ico">
                            <svg class="ico" aria-hidden="true"><use href="#ico-calendar"></use></svg> Open Google Calendar
                        </a>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const close = () => {
            Utils.releaseFocus(modal, this._calDetailFocusTrap);
            this._calDetailFocusTrap = null;
            modal.remove();
            // Restore focus to the row that opened the modal
            el.focus();
        };

        document.getElementById('closeCalEventDetail').addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

        this._calDetailFocusTrap = Utils.trapFocus(modal);
    },

    // ========================================
    // TO-DO SECTION
    // ========================================

    createTodoSection() {
        const tm = window.TodoManager;
        const todos = tm?.getTodos() || [];
        const remaining = tm?.remainingCount() || 0;
        const addOpen = this._todoAddOpen || (this._todoAddOpen = new Set());
        const collapsed = this._todoCollapsed || (this._todoCollapsed = new Set());

        const itemsHTML = todos.map(task => {
            const pSafe = Utils.sanitizeHTML(task.id);
            const pName = Utils.sanitizeHTML(task.text || '(untitled task)');
            const subsHTML = task.subtasks.map(sub => this._renderTodoItem(sub, task.id)).join('');
            // The add-subtask field is hidden until the user opens it with the + button.
            const subAddHTML = addOpen.has(task.id)
                ? `<input type="text" class="todo-subadd" data-todo-action="add-sub"
                          data-id="${pSafe}" placeholder="+ Add subtask" aria-label="Add subtask to ${pName}">`
                : '';
            // Collapse only has meaning while there are subtasks to hide; a task
            // whose last subtask was deleted renders expanded again without its
            // stale Set entry needing cleanup.
            const isCollapsed = collapsed.has(task.id) && task.subtasks.length > 0;
            return `
                <div class="todo-row${isCollapsed ? ' collapsed' : ''}" data-id="${pSafe}">
                    ${this._renderTodoItem(task, null, isCollapsed ? task.subtasks.length : 0)}
                    <div class="todo-subs">
                        ${subsHTML}
                        ${subAddHTML}
                    </div>
                </div>`;
        }).join('');

        const emptyHTML = todos.length === 0
            ? '<div class="todo-empty">No tasks yet — add one below.</div>'
            : '';

        const todoLayout = this._getCardLayout('__todo__');

        return `
            <div class="app-group virtual-group todo-group"
                 data-group-id="__todo__"
                 data-card-width="${todoLayout.width}"
                 style="--card-tint: rgba(156, 39, 176, 0.18);">
                <div class="group-header">
                    <div class="group-title-container">
                        <div class="group-title has-ico"><svg class="ico" aria-hidden="true"><use href="#ico-note"></use></svg> To-Do <span class="group-count">(${remaining})</span></div>
                    </div>
                    <div class="group-actions">
                        ${this._cardWidthButton('__todo__')}
                        <button type="button" class="group-action-btn todo-archive-btn" data-todo-action="open-archive"
                                title="View archive (deleted & done)" aria-label="View archive — deleted and done items"><svg class="ico" aria-hidden="true"><use href="#ico-archive"></use></svg></button>
                    </div>
                </div>
                <div class="todo-list">
                    ${emptyHTML}
                    ${itemsHTML}
                    <input type="text" class="todo-add" data-todo-action="add-task"
                           placeholder="+ Add a task" aria-label="Add a task">
                </div>
                ${this._cardResizeHandle('__todo__')}
            </div>
        `;
    },

    // Fold/unfold one task's subtask list. Shared by the row's chevron button
    // and the double-click gesture; a no-op for tasks without subtasks.
    _toggleTodoCollapse(id, { refocusBtn = false } = {}) {
        const task = TodoManager._find(id);
        if (!task || task.subtasks.length === 0) return;
        const set = this._todoCollapsed || (this._todoCollapsed = new Set());
        set.has(id) ? set.delete(id) : set.add(id);
        if (refocusBtn) this._pendingTodoFocus = { action: 'collapse', id };
        this.renderTodoCard();
    },

    // Render a single task or subtask row. `parentId` is null for top-level
    // tasks. `hiddenSubCount` > 0 marks a collapsed task and puts a "▸ N" chip
    // on the row so the hidden subtasks aren't mistaken for deleted ones.
    _renderTodoItem(task, parentId, hiddenSubCount = 0) {
        const tm = window.TodoManager;
        const isSub = parentId !== null && parentId !== undefined;
        const ids = isSub
            ? `data-id="${Utils.sanitizeHTML(parentId)}" data-sub="${Utils.sanitizeHTML(task.id)}"`
            : `data-id="${Utils.sanitizeHTML(task.id)}"`;

        const urgency = tm.URGENCY_LEVELS.includes(task.urgency) ? task.urgency : 'tbd';
        const urgencyLabel = tm.URGENCY_LABELS[urgency];
        const overdue = task.dueDate && !task.done && task.dueDate < tm.todayStr() ? 'overdue' : '';
        const safeText = Utils.sanitizeHTML(task.text);
        // Accessible name for each row's controls, so screen-reader users can tell
        // otherwise-identical rows apart. Falls back to a generic noun when empty.
        const kind = isSub ? 'subtask' : 'task';
        const name = Utils.sanitizeHTML(task.text || `(untitled ${kind})`);
        // Only top-level tasks can have subtasks (one level deep), so the + button
        // is omitted on subtask rows. It toggles that task's add-subtask field.
        const addOpen = this._todoAddOpen?.has(task.id) ? 'true' : 'false';
        const addSubBtn = isSub ? '' : `
                <button type="button" class="todo-addsub-btn" data-todo-action="add-sub-toggle" ${ids}
                        title="Add subtask" aria-label="Add subtask to ${name}" aria-expanded="${addOpen}">+</button>`;

        // Drag handle: pointer-drags to reorder, or focus it and use ↑/↓ keys.
        // The grip glyph itself is decorative; the button carries the label.
        const dragHandle = `
                <button type="button" class="todo-drag-handle" data-todo-action="drag" ${ids}
                        title="Drag to reorder (or use ↑/↓ keys)"
                        aria-label="Reorder ${name}. Use Arrow Up and Arrow Down to move."><span aria-hidden="true">⠿</span></button>`;

        // Chevron right of the grip: folds/unfolds the subtask list — the
        // button twin of the double-click gesture (and the keyboard path to
        // it). While collapsed the button also carries the hidden-subtask
        // count, so one control says both "folded" and "how many". Every
        // top-level row renders one, but a row with no subtasks keeps only an
        // invisible disabled copy so the text column stays aligned across rows.
        const isCollapsed = hiddenSubCount > 0;
        const hasSubs = !isSub && task.subtasks.length > 0;
        const countHTML = isCollapsed
            ? `<span class="todo-collapse-count" aria-hidden="true">${hiddenSubCount}</span>`
            : '';
        const collapseBtn = isSub ? '' : `
                <button type="button" class="todo-collapse-btn${isCollapsed ? ' is-collapsed' : ''}" data-todo-action="collapse-toggle" ${ids}
                        ${hasSubs ? '' : 'disabled tabindex="-1"'} aria-expanded="${isCollapsed ? 'false' : 'true'}"
                        title="${isCollapsed ? `Expand ${hiddenSubCount} hidden subtask${hiddenSubCount === 1 ? '' : 's'}` : 'Collapse subtasks'}"
                        aria-label="${isCollapsed ? `Expand ${hiddenSubCount} hidden subtask${hiddenSubCount === 1 ? '' : 's'} of ${name}` : `Collapse subtasks of ${name}`}"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-chevron"></use></svg>${countHTML}</button>`;

        // ---- Schedule control (due date + repeat) ----
        // A single compact button replaces the old inline date field and the
        // recurrence pill: it shows the due date (and a small ⟳ when the task
        // repeats) and opens the schedule modal where both are edited. This keeps
        // the row uncluttered — nothing extra shows for the common no-repeat case.
        const recur = task.recur || 'none';
        const hasRecur = recur !== 'none';
        const recurLabel = tm.RECUR_LABELS?.[recur] ?? recur;
        const dateText = task.dueDate ? this._formatTodoDate(task.dueDate) : '';
        const scheduleAria = (task.dueDate
            ? `Schedule for ${name}: due ${dateText}`
            : `Schedule for ${name}: no due date`)
            + (hasRecur ? `, repeats ${recurLabel}` : '')
            + '. Activate to edit.';
        const dateFace = task.dueDate
            ? `<span class="ts-date">${Utils.sanitizeHTML(dateText)}</span>`
            : `<span class="ts-date ts-empty" aria-hidden="true"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-calendar"></use></svg></span>`;
        const recurChip = hasRecur
            ? `<span class="ts-recur recur-${Utils.sanitizeHTML(recur)}" aria-hidden="true" title="Repeats ${Utils.sanitizeHTML(recurLabel)}"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-refresh"></use></svg></span>`
            : '';
        const scheduleBtn = `
                <button type="button" class="todo-schedule-btn ${overdue}${hasRecur ? ' has-recur' : ''}" data-todo-action="schedule" ${ids}
                        title="Due date & repeat — click to edit"
                        aria-label="${scheduleAria}">${dateFace}${recurChip}</button>`;

        // The text field is a <textarea>, not a text input, so a long task wraps
        // onto a second line instead of scrolling out of sight sideways. It is
        // written one row tall and _fitTodoText grows it to at most two; past
        // that the text is clipped. Enter still commits the edit (the keydown
        // handler blurs it), so no newline can be typed into a task. The value
        // is element content here, not an attribute — nothing may sit between
        // the tag's ">" and safeText or it would become leading whitespace.
        return `
            <div class="todo-item ${isSub ? 'todo-sub' : ''} ${task.done ? 'done' : ''}" ${ids}>
                ${dragHandle}${collapseBtn}
                ${(() => {
                    // Done items wear a progress ring around the check: the arc
                    // sweeps the DONE_ARCHIVE_DELAY_MS window, and a closed loop
                    // means the sweep is about to file the item away. The CSS
                    // animation runs the window client-side; a negative delay
                    // phases it to the true elapsed time so re-renders (and
                    // reloads) resume mid-arc instead of restarting. The static
                    // --done-progress is the reduced-motion fallback, where the
                    // animation is disabled and the ring only steps on renders.
                    let ring = '';
                    if (task.done && typeof task.doneAt === 'number') {
                        const total = tm.DONE_ARCHIVE_DELAY_MS / 1000;
                        const elapsed = Math.max(0, Math.min(total, (Date.now() - task.doneAt) / 1000));
                        ring = ` style="--done-ring-dur:${total}s; --done-ring-delay:-${elapsed.toFixed(1)}s; --done-progress:${(elapsed / total).toFixed(4)}"`;
                    }
                    return `<button type="button" class="todo-done-btn" data-todo-action="toggle" ${ids}${ring}
                        aria-pressed="${task.done}" title="${task.done ? 'Mark not done' : 'Mark done'}"
                        aria-label="${task.done ? 'Mark not done' : 'Mark done'}: ${name}"><svg class="ico" aria-hidden="true"><use href="#ico-check-bold"></use></svg></button>`;
                })()}
                <textarea class="todo-text" data-todo-action="text" ${ids} rows="1"
                       placeholder="${isSub ? 'Subtask' : 'Task'}…" aria-label="${isSub ? 'Subtask' : 'Task'} text"
                       >${safeText}</textarea>
                <button type="button" class="todo-urgency urg-${urgency}" data-todo-action="urgency" ${ids}
                        title="Urgency: ${urgencyLabel} — click to change"
                        aria-label="Urgency for ${name}: ${urgencyLabel}. Activate to change.">${urgencyLabel}</button>
                ${scheduleBtn}${addSubBtn}
                <button type="button" class="todo-del" data-todo-action="del" ${ids}
                        title="Delete" aria-label="Delete ${name}">×</button>
            </div>
        `;
    },

    // Short human label for a YYYY-MM-DD due date shown on the schedule button.
    // Parses the parts directly (no timezone shift) and adds the year only when
    // it isn't the current year, to keep the chip compact.
    _formatTodoDate(dateStr) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
        if (!m) return dateStr || '';
        const d = new Date(+m[1], +m[2] - 1, +m[3]);
        if (isNaN(d)) return dateStr;
        const opts = { month: 'short', day: 'numeric' };
        if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
        return d.toLocaleDateString('en-US', opts);
    },

    // Schedule modal for one task/subtask: edit the due date AND the repeat
    // cadence in one place (the row only triggers this, keeping it uncluttered).
    // Mirrors the calendar-event modal: dynamic build, focus trap, Escape, and
    // backdrop close. Changes apply live — they re-render the card underneath
    // while this modal (on document.body) stays open.
    _openTodoSchedule(id, subId) {
        const tm = window.TodoManager;
        const item = tm?._resolve(id, subId);
        if (!item) return;

        const name = Utils.sanitizeHTML(item.text || 'this task');
        const dueVal = item.dueDate ? Utils.sanitizeHTML(item.dueDate) : '';
        const levels = tm.RECUR_LEVELS || ['none', 'daily', 'weekly', 'monthly'];
        const labels = tm.RECUR_LABELS || { none: 'No repeat', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
        const curRecur = levels.includes(item.recur) ? item.recur : 'none';

        const repeatBtns = levels.map(lv => `
            <button type="button" class="todo-recur-opt recur-${lv}${lv === curRecur ? ' selected' : ''}"
                    data-recur="${lv}" aria-pressed="${lv === curRecur ? 'true' : 'false'}">${Utils.sanitizeHTML(labels[lv] ?? lv)}</button>`).join('');

        document.getElementById('todoScheduleModal')?.remove();

        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'todoScheduleModal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'todoScheduleTitle');
        modal.innerHTML = `
            <div class="modal-content todo-schedule-content">
                <div class="modal-header">
                    <h2 id="todoScheduleTitle" class="has-ico"><svg class="ico" aria-hidden="true"><use href="#ico-calendar-days"></use></svg> Schedule</h2>
                    <button class="close-modal" id="closeTodoSchedule" aria-label="Close">×</button>
                </div>
                <div class="todo-schedule-body">
                    <p class="todo-schedule-name">${name}</p>
                    <div class="todo-schedule-field">
                        <label for="todoScheduleDate" class="todo-schedule-legend">Due date</label>
                        <div class="todo-schedule-date-row">
                            <input type="date" id="todoScheduleDate" class="todo-schedule-date" value="${dueVal}">
                            <button type="button" id="todoScheduleToday" class="todo-schedule-today">Today</button>
                            <button type="button" id="todoScheduleClear" class="todo-schedule-clear">Clear</button>
                        </div>
                    </div>
                    <div class="todo-schedule-field">
                        <span class="todo-schedule-legend">Repeat</span>
                        <div class="todo-schedule-repeat" role="group" aria-label="Repeat cadence">
                            ${repeatBtns}
                        </div>
                    </div>
                    <p class="todo-schedule-hint">Completing a repeating task moves its due date to the next occurrence.</p>
                    <div class="todo-schedule-actions">
                        <button type="button" class="todo-schedule-done" id="todoScheduleDone">Done</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);

        const close = () => {
            Utils.releaseFocus(modal, this._todoScheduleTrap);
            this._todoScheduleTrap = null;
            modal.remove();
            // The row was re-rendered by the live edits, so re-query the live
            // schedule button to restore focus to it.
            const sel = subId
                ? `.todo-schedule-btn[data-id="${CSS.escape(id)}"][data-sub="${CSS.escape(subId)}"]`
                : `.todo-schedule-btn[data-id="${CSS.escape(id)}"]:not([data-sub])`;
            document.querySelector(sel)?.focus();
        };

        // Due date — apply on change; "Clear" removes it.
        const dateInput = modal.querySelector('#todoScheduleDate');
        dateInput.addEventListener('change', () => {
            TodoManager.setDueDate(id, subId, dateInput.value || null);
        });
        modal.querySelector('#todoScheduleToday').addEventListener('click', () => {
            const today = TodoManager.todayStr();
            dateInput.value = today;
            TodoManager.setDueDate(id, subId, today);
        });
        modal.querySelector('#todoScheduleClear').addEventListener('click', () => {
            dateInput.value = '';
            TodoManager.setDueDate(id, subId, null);
        });

        // Repeat cadence — apply on click, reflect the selection in place.
        modal.querySelectorAll('.todo-recur-opt').forEach(btn => {
            btn.addEventListener('click', () => {
                TodoManager.setRecur(id, subId, btn.dataset.recur);
                modal.querySelectorAll('.todo-recur-opt').forEach(b => {
                    const on = b === btn;
                    b.classList.toggle('selected', on);
                    b.setAttribute('aria-pressed', on ? 'true' : 'false');
                });
            });
        });

        modal.querySelector('#closeTodoSchedule').addEventListener('click', close);
        modal.querySelector('#todoScheduleDone').addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

        this._todoScheduleTrap = Utils.trapFocus(modal);
    },

    // Delegated handlers for every To-Do interaction. Attached once to the main
    // container (whose innerHTML is replaced on each render).
    _attachTodoHandlers(container) {
        const ids = (el) => ({ id: el.dataset.id, sub: el.dataset.sub || null });

        container.addEventListener('change', (e) => {
            const el = e.target.closest('[data-todo-action]');
            if (!el) return;
            const action = el.dataset.todoAction;
            const { id, sub } = ids(el);
            if (action === 'text') {
                TodoManager.setText(id, sub, el.value);
            }
            // Note: the due date is set inside the schedule modal (see
            // _openTodoSchedule), not from an inline row field anymore.
        });

        container.addEventListener('click', (e) => {
            const el = e.target.closest('[data-todo-action]');
            if (!el) return;
            const action = el.dataset.todoAction;
            const { id, sub } = ids(el);
            if (action === 'toggle') {
                e.preventDefault();
                sub ? TodoManager.toggleSubtask(id, sub) : TodoManager.toggleTask(id);
            } else if (action === 'urgency') {
                e.preventDefault();
                TodoManager.cycleUrgency(id, sub);
            } else if (action === 'schedule') {
                e.preventDefault();
                this._openTodoSchedule(id, sub);
            } else if (action === 'del') {
                e.preventDefault();
                const item = TodoManager._resolve(id, sub);
                const label = item && item.text && item.text.trim()
                    ? `"${item.text.trim()}"`
                    : (sub ? 'this subtask' : 'this task');
                // Deleting only moves the item into the archive (kept for
                // TodoManager.ARCHIVE_TTL_DAYS days) — nothing is actually lost —
                // so a non-blocking undo toast replaces the old confirm() dialog,
                // matching the pattern already used for website/group deletes.
                // The archived entry keeps the same id as the live item, so Undo
                // can restore it directly from the archive. delete() returns
                // null when nothing was archived (an empty subtask just
                // disappears) — no toast then: there is nothing to undo.
                this._todoAddOpen?.delete(id);
                const archId = TodoManager.delete(id, sub);
                if (archId) {
                    UI.showUndoToast(`${label} deleted`, () => {
                        TodoManager.restoreFromArchive(archId);
                    });
                }
            } else if (action === 'add-sub-toggle') {
                e.preventDefault();
                const set = this._todoAddOpen || (this._todoAddOpen = new Set());
                if (set.has(id)) {
                    set.delete(id);
                } else {
                    set.add(id);
                    // The add field lives inside .todo-subs, which a collapsed
                    // task hides — opening it must expand the task or the focus
                    // restore below would target a display:none input.
                    this._todoCollapsed?.delete(id);
                    this._pendingTodoFocus = { action: 'add-sub', id };
                }
                this.renderTodoCard();
            } else if (action === 'collapse-toggle') {
                e.preventDefault();
                // Keep focus on the chevron across the re-render so the fold
                // can be worked entirely from the keyboard.
                this._toggleTodoCollapse(id, { refocusBtn: true });
            } else if (action === 'open-archive') {
                e.preventDefault();
                this.openTodoArchive();
            }
        });

        // Double-click on a task row folds/unfolds its subtask list. Top-level
        // tasks only (subtasks have nothing to fold), and never from the row's
        // controls — a double-click on a button is just two clicks, and on the
        // text field it is word-select (any selection the browser makes there
        // is discarded with the field itself when the card re-renders).
        container.addEventListener('dblclick', (e) => {
            const item = e.target.closest('.todo-item');
            if (!item || item.classList.contains('todo-sub')) return;
            if (e.target.closest('button, input')) return;
            this._toggleTodoCollapse(item.dataset.id);
        });

        // Re-wrap the edited field as it's typed in — the row only re-renders on
        // commit (blur/Enter), so without this the field would stay at the row
        // count it had when the card was built.
        container.addEventListener('input', (e) => {
            const el = e.target.closest('.todo-text');
            if (el) this._fitTodoTextField(el);
        });

        container.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const el = e.target.closest('[data-todo-action]');
            if (!el) return;
            const action = el.dataset.todoAction;
            if (action === 'add-task') {
                e.preventDefault();
                TodoManager.addTask(el.value);
            } else if (action === 'add-sub') {
                e.preventDefault();
                TodoManager.addSubtask(el.dataset.id, el.value);
            } else if (action === 'text') {
                e.preventDefault();
                // Commit this row, then continue the list: a new empty row is
                // inserted directly below it and focused for immediate typing.
                // The commit must be explicit (not via blur) because the insert
                // re-renders the card, which would race the change event.
                const id = el.dataset.id;
                const sub = el.dataset.sub || null;
                TodoManager.setText(id, sub, el.value);
                sub ? TodoManager.insertSubtaskAfter(id, sub)
                    : TodoManager.insertTaskAfter(id);
            }
        });

        this._attachTodoDragHandlers(container);

        // Delegated handler for calendar event detail rows (item 13). Attached
        // once here alongside the other container-level handlers.
        container.addEventListener('click', (e) => {
            // Let the "Join" link open the call directly instead of the detail modal.
            if (e.target.closest('[data-cal-join]')) return;
            const row = e.target.closest('[data-cal-event="1"]');
            if (row) { e.preventDefault(); this._openCalendarEventDetail(row); }
        });
        container.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (e.target.closest('[data-cal-join]')) return; // activate the Join link itself
            const row = e.target.closest('[data-cal-event="1"]');
            if (row) { e.preventDefault(); this._openCalendarEventDetail(row); }
        });

        // Archive actions and closing the archive modal live outside this
        // container (in the modal / Settings tab), so own them here from the
        // document. This handler is attached once and is in the same module as
        // openTodoArchive, so closing never depends on separate wiring.
        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-todo-arch-action]');
            if (el) {
                const action = el.dataset.todoArchAction;
                const archId = el.dataset.archId;
                // Which archive the entry lives in ('deleted' | 'done') —
                // stamped on the buttons by _renderArchiveItem.
                const src = el.dataset.archSrc === 'done' ? 'done' : 'deleted';
                if (action === 'restore') {
                    TodoManager.restoreFromArchive(archId, src);
                } else if (action === 'del-forever') {
                    if (window.confirm('Permanently delete this archived item? This cannot be undone.')) {
                        TodoManager.deleteFromArchive(archId, src);
                    }
                } else if (action === 'close') {
                    this.closeTodoArchive();
                }
                return;
            }
            const tab = e.target.closest('#todoArchTabs .changelog-tab');
            if (tab) { this.showTodoArchiveTab(tab.dataset.tab); return; }
            // Click on the modal backdrop (outside the content) closes it.
            if (e.target.id === 'todoArchiveModal') this.closeTodoArchive();
        });

        // Arrow-key roving between the two archive tabs, same pattern as the
        // changelog tablist (3-app-init.js).
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const tab = e.target.closest?.('#todoArchTabs .changelog-tab');
            if (!tab) return;
            e.preventDefault();
            const next = tab.dataset.tab === 'deleted' ? 'done' : 'deleted';
            this.showTodoArchiveTab(next);
            document.getElementById(next === 'done' ? 'todoArchTabDone' : 'todoArchTabDeleted')?.focus();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const modal = document.getElementById('todoArchiveModal');
            if (modal && modal.classList.contains('show')) this.closeTodoArchive();
        });
    },

    // Drag-and-drop (and keyboard) reordering for tasks and subtasks. Attached
    // once alongside the other To-Do handlers. A task is the whole `.todo-row`
    // (so its subtasks travel with it); a subtask is its own `.todo-item.todo-sub`
    // and can only be reordered within its parent's `.todo-subs`.
    _attachTodoDragHandlers(container) {
        // Find the row to insert a dragged element before, based on pointer Y:
        // the first sibling whose vertical midpoint is below the cursor.
        const dragAfter = (siblings, y) => {
            let closest = null;
            let closestOffset = Number.NEGATIVE_INFINITY;
            for (const el of siblings) {
                if (el.classList.contains('dragging')) continue;
                const box = el.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;
                if (offset < 0 && offset > closestOffset) {
                    closestOffset = offset;
                    closest = el;
                }
            }
            return closest;
        };

        const disarm = () => {
            if (this._todoArmedDrag) {
                this._todoArmedDrag.removeAttribute('draggable');
                this._todoArmedDrag = null;
            }
        };

        // HTML5 drag only fires from a draggable element, but making each row
        // permanently draggable would block text selection in its inputs. So arm
        // `draggable` only while the pointer is pressed on the grip handle.
        container.addEventListener('mousedown', (e) => {
            const handle = e.target.closest('.todo-drag-handle');
            if (!handle) return;
            const dragEl = handle.closest('.todo-item.todo-sub')
                || handle.closest('.todo-row');
            if (!dragEl) return;
            dragEl.setAttribute('draggable', 'true');
            this._todoArmedDrag = dragEl;
        });
        document.addEventListener('mouseup', disarm);

        container.addEventListener('dragstart', (e) => {
            // Only handle drags armed via a To-Do grip (mousedown set _todoArmedDrag).
            // Other draggables in this container (website cards) leave it null, so we
            // ignore them here. The dragstart target is the row itself, not the grip.
            const dragEl = this._todoArmedDrag;
            if (!dragEl || e.target !== dragEl) return;
            this._todoDragEl = dragEl;
            this._todoDragKind = dragEl.classList.contains('todo-sub') ? 'sub' : 'task';
            dragEl.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            // Firefox needs data set for a drag to start.
            try { e.dataTransfer.setData('text/plain', dragEl.dataset.id || ''); } catch (_) {}
        });

        container.addEventListener('dragover', (e) => {
            const dragEl = this._todoDragEl;
            if (!dragEl) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (this._todoDragKind === 'task') {
                const list = dragEl.parentElement; // .todo-list
                const rows = list.querySelectorAll(':scope > .todo-row');
                const after = dragAfter(rows, e.clientY);
                if (after) list.insertBefore(dragEl, after);
                else list.insertBefore(dragEl, list.querySelector('.todo-add'));
            } else {
                // Subtask: reorder only within its own parent's list, never across.
                const subs = dragEl.parentElement; // .todo-subs
                const items = subs.querySelectorAll(':scope > .todo-item.todo-sub');
                const after = dragAfter(items, e.clientY);
                if (after) subs.insertBefore(dragEl, after);
                else subs.insertBefore(dragEl, subs.querySelector('.todo-subadd'));
            }
        });

        // Allow drop without the browser's "snap-back" animation.
        container.addEventListener('drop', (e) => {
            if (this._todoDragEl) e.preventDefault();
        });

        // Commit the new DOM order back to the data model (which re-renders).
        container.addEventListener('dragend', () => {
            const dragEl = this._todoDragEl;
            if (!dragEl) { disarm(); return; }
            dragEl.classList.remove('dragging');
            if (this._todoDragKind === 'task') {
                const list = dragEl.parentElement;
                const ids = [...list.querySelectorAll(':scope > .todo-row')].map(r => r.dataset.id);
                this._todoDragEl = null;
                this._todoDragKind = null;
                disarm();
                TodoManager.reorderTasks(ids);
            } else {
                const subs = dragEl.parentElement;
                const parentId = dragEl.dataset.id;
                const ids = [...subs.querySelectorAll(':scope > .todo-item.todo-sub')]
                    .map(el => el.dataset.sub);
                this._todoDragEl = null;
                this._todoDragKind = null;
                disarm();
                TodoManager.reorderSubtasks(parentId, ids);
            }
        });

        // Keyboard reordering: focus a grip handle and press ↑/↓.
        container.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            const handle = e.target.closest('.todo-drag-handle');
            if (!handle) return;
            e.preventDefault();
            const delta = e.key === 'ArrowUp' ? -1 : 1;
            const id = handle.dataset.id;
            const sub = handle.dataset.sub || null;
            // Set the focus target first: the move re-renders synchronously and
            // consumes _pendingTodoFocus during that render. Clear it if no move
            // happened (already at an end) so it can't leak to a later render.
            this._pendingTodoFocus = { action: 'reorder', id, sub };
            const moved = sub
                ? TodoManager.moveSubtask(id, sub, delta)
                : TodoManager.moveTask(id, delta);
            if (!moved) this._pendingTodoFocus = null;
        });
    },

    // ---- To-Do archive views (shared by the header modal and Settings tab) ----

    openTodoArchive() {
        const modal = document.getElementById('todoArchiveModal');
        if (!modal) return;
        this.renderTodoArchive(document.getElementById('todoArchiveModalBody'));
        modal.classList.add('show');
        this._archiveFocusTrap = Utils.trapFocus(modal);
    },

    closeTodoArchive() {
        const modal = document.getElementById('todoArchiveModal');
        if (!modal) return;
        Utils.releaseFocus(modal, this._archiveFocusTrap);
        this._archiveFocusTrap = null;
        modal.classList.remove('show');
    },

    // Re-render whichever archive views are currently visible. This is called
    // from every TodoManager._rerender(), which since v4.27 includes the 60s
    // done-sweep timer and cross-tab storage events — so it must never move
    // focus unless the render itself detached the focused control.
    refreshArchiveViews() {
        const modal = document.getElementById('todoArchiveModal');
        if (modal && modal.classList.contains('show')) {
            const hadFocus = modal.contains(document.activeElement);
            this.renderTodoArchive(document.getElementById('todoArchiveModalBody'));
            // No trap rebuild: only the panels' innerHTML was replaced, the
            // trap's handler lives on the modal and re-queries focusables per
            // Tab (Utils.trapFocus), and a rebuild would re-run the initial
            // focus() — yanking focus on every background refresh.
            // But if the focused control itself was rebuilt away (e.g. the
            // Restore button just clicked), focus fell to <body>, outside the
            // trap — land on the active tab so keyboard flow stays inside.
            if (hadFocus && !modal.contains(document.activeElement)) {
                modal.querySelector('#todoArchTabs .changelog-tab.active')?.focus();
            }
        }
        // The Settings copy is rendered fresh by openSettings(); repainting it
        // while that modal is closed is pure waste on a 60s timer.
        const settingsBody = document.getElementById('todoArchiveSettings');
        const settingsModal = document.getElementById('settingsModal');
        if (settingsBody && settingsModal?.classList.contains('show')) {
            this.renderTodoArchive(settingsBody, 'h4');
        }
    },

    // Flip the archive modal between its Deleted and Done panels — the same
    // moves as AppInit.showChangelogTab, scoped to this modal's tablist.
    showTodoArchiveTab(name) {
        document.querySelectorAll('#todoArchTabs .changelog-tab').forEach(tab => {
            const on = tab.dataset.tab === name;
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-selected', String(on));
        });
        document.querySelectorAll('#todoArchiveModalBody .todo-archive-panel').forEach(panel => {
            panel.hidden = panel.dataset.tab !== name;
            if (!panel.hidden) panel.scrollTop = 0;
        });
    },

    // Renders BOTH archives (deleted + done) into whichever surface `container`
    // is: the modal body (which carries the two tab panels — each archive goes
    // into its own) or the Settings → To-Do container (no tabs; both sections
    // stacked, `headingLevel` keeping the outline flat under the tab's h3).
    renderTodoArchive(container, headingLevel = 'h3') {
        if (!container) return;
        const tm = window.TodoManager;
        const ttl = tm?.ARCHIVE_TTL_DAYS ?? 14;
        const deleted = tm?.getArchive() || [];
        const done = tm?.getDoneArchive() || [];

        const list = (items, src, emptyText) => items.length === 0
            ? `<div class="todo-empty">${emptyText}</div>`
            : items.map(a => this._renderArchiveItem(a, src)).join('');
        const emptyDeleted = `No deleted items. Deleted tasks are kept here for ${ttl} days.`;
        const emptyDone = `No completed items. Done tasks land here 10 minutes after being checked off and stay for ${ttl} days.`;

        const delPanel = container.querySelector('#todoArchPanelDeleted');
        const donePanel = container.querySelector('#todoArchPanelDone');
        if (delPanel && donePanel) {
            delPanel.innerHTML = list(deleted, 'deleted', emptyDeleted);
            donePanel.innerHTML = list(done, 'done', emptyDone);
            const chip = (id, n) => {
                const el = document.getElementById(id)?.querySelector('.changelog-tab-count');
                if (el) el.textContent = n ? String(n) : '';
            };
            chip('todoArchTabDeleted', deleted.length);
            chip('todoArchTabDone', done.length);
            return;
        }

        const tag = headingLevel === 'h4' ? 'h4' : 'h3';
        const section = (title, items, src, emptyText) => `
            <div class="todo-archive-section">
                <${tag} class="todo-archive-heading">${title} <span class="group-count">(${items.length})</span></${tag}>
                ${list(items, src, emptyText)}
            </div>`;
        container.innerHTML =
            section('Deleted', deleted, 'deleted', emptyDeleted) +
            section('Done', done, 'done', emptyDone);
    },

    _renderArchiveItem(a, src = 'deleted') {
        const tm = window.TodoManager;
        const safeId = Utils.sanitizeHTML(a.id);
        const name = Utils.sanitizeHTML(a.text || '(untitled task)');
        const urgency = tm.URGENCY_LEVELS.includes(a.urgency) ? a.urgency : 'tbd';
        const urgencyLabel = tm.URGENCY_LABELS[urgency];
        const days = tm.daysUntilPurge(tm.archiveStamp(a));

        const meta = [`<span class="todo-urgency urg-${urgency}">${urgencyLabel}</span>`];
        if (a.isSub) {
            const parent = Utils.sanitizeHTML(a.parentText || '(untitled task)');
            meta.push(`<span class="todo-archive-parent">subtask of "${parent}"</span>`);
        }
        if (a.dueDate) meta.push(`<span class="todo-archive-due">Due ${Utils.sanitizeHTML(a.dueDate)}</span>`);
        meta.push(`<span class="todo-archive-purge">purges in ${days} day${days === 1 ? '' : 's'}</span>`);

        const subs = Array.isArray(a.subtasks) && a.subtasks.length
            ? `<ul class="todo-archive-subs">${a.subtasks.map(s =>
                  `<li class="${s.done ? 'done' : ''}">${Utils.sanitizeHTML(s.text || '(untitled subtask)')}</li>`).join('')}</ul>`
            : '';

        return `
            <div class="todo-archive-item ${a.done ? 'done' : ''}">
                <div class="todo-archive-main">
                    <div class="todo-archive-title">${name}</div>
                    <div class="todo-archive-meta">${meta.join('')}</div>
                    ${subs}
                </div>
                <div class="todo-archive-actions">
                    <button type="button" class="todo-archive-action restore" data-todo-arch-action="restore"
                            data-arch-id="${safeId}" data-arch-src="${src}"
                            aria-label="${src === 'done' ? `Return ${name} to To-Do` : `Restore ${name}`}">${src === 'done' ? 'Return to To-Do' : 'Restore'}</button>
                    <button type="button" class="todo-archive-action del-forever" data-todo-arch-action="del-forever"
                            data-arch-id="${safeId}" data-arch-src="${src}"
                            aria-label="Delete ${name} forever">Delete forever</button>
                </div>
            </div>
        `;
    },

    updateIconSizes() {
        document.documentElement.style.setProperty('--icon-size', `${AppState.iconSize}px`);
        const cardSize = parseInt(AppState.iconSize) + 60;
        document.documentElement.style.setProperty('--card-size', `${cardSize}px`);
        const gap = Math.max(8, Math.round(AppState.iconSize * 0.2)) + 5;
        document.documentElement.style.setProperty('--card-gap', `${gap}px`);
        this.matchCalendarHeight();
    },

    // Dynamically set calendar events container height. A hand-dragged height
    // wins outright; otherwise 'auto' mode aligns with the first 2 groups in the
    // right column, and any other setting is a multiplier that sets the card
    // height to that many single-row card heights.
    matchCalendarHeight() {
        const calendarGroup = document.querySelector('.calendar-group');
        const eventsContainer = calendarGroup?.querySelector('.calendar-events-container');
        if (!calendarGroup || !eventsContainer) return;

        // Never fight an in-flight drag: the stored height is still the
        // pre-drag value, so applying it here would snap the card back out
        // from under the pointer. Checked before anything else so a drag really
        // is a no-op here, ticker measurement included.
        if (this._cardDragActive() && this._cardResize.id === '__calendar__') return;

        // Size the upcoming-event ticker here too — this runs on every card render
        // path and on the debounced window resize.
        this._sizeUpcomingTicker(calendarGroup);

        this._applyCalendarHeight(calendarGroup, eventsContainer);

        // Retunes the hour-row height to whatever room the height ladder
        // above just gave the card — depends on that box already being
        // definite, so it has to run after, not before.
        this._sizeTimelineHours();

        // Sized once here rather than at each return below: several of those
        // exits are early (too few columns to measure against), and skipping
        // the sync there left the grip reporting a stale height to assistive
        // tech — it claimed the card was at its minimum when it wasn't.
        this._syncResizeHandleValue(calendarGroup);
    },

    // The height ladder itself: manual > 'auto' (match the two cards alongside)
    // > multiplier. Split out so every exit path gets the sync above.
    _applyCalendarHeight(calendarGroup, eventsContainer) {
        // A height dragged onto the card overrides both 'auto' and the
        // multiplier. Clearing it (Home on the grip, or moving the settings
        // slider) hands control back to the branches below.
        const manual = this._getCardLayout('__calendar__').height;
        if (manual != null) {
            // This path doesn't go through _clearCardHeightPx, so a minHeight
            // left behind by a previous automatic pass (below) needs clearing
            // by hand — otherwise it would stop a smaller dragged height from
            // ever taking effect.
            eventsContainer.style.minHeight = '';
            this._applyCardHeightPx(calendarGroup, manual);
            return;
        }

        // No manual height in play — drop anything a previous drag left behind
        // so the automatic sizing below is what actually takes effect.
        this._clearCardHeightPx(eventsContainer);

        const heightSetting = window.CalendarManager?.getHeight?.() || 'auto';

        let targetHeight;
        if (heightSetting === 'auto') {
            // 'Auto' means "as tall as the two cards beside me", which has no
            // meaning once the calendar is a full-width band outside the grid —
            // let the stylesheet's default height stand instead.
            if (calendarGroup.dataset.cardWidth === 'full') {
                this._pinTimelineFallbackMinHeight(eventsContainer);
                return;
            }
            // Measure combined height of first 2 right-column groups + gap
            // between them. The bails fall back to the same stylesheet cap as
            // the full-width branch, so they need the same minHeight pin — or
            // a timeline there shrink-wraps and sits pinned at TL_HOUR_MIN.
            const columns = document.querySelectorAll('.groups-column');
            if (columns.length < 2) { this._pinTimelineFallbackMinHeight(eventsContainer); return; }
            const col2 = columns[1];
            const col2Groups = col2.querySelectorAll('.app-group');
            if (col2Groups.length < 2) { this._pinTimelineFallbackMinHeight(eventsContainer); return; }
            const gap = parseFloat(getComputedStyle(col2).gap) || 0;
            targetHeight = col2Groups[0].offsetHeight + col2Groups[1].offsetHeight + gap;
        } else {
            // multiplier × one card-row pitch (card height + grid gap)
            const multiplier = parseFloat(heightSetting) || 2;
            const root = getComputedStyle(document.documentElement);
            const cardSize = parseFloat(root.getPropertyValue('--card-size')) || 180;
            const cardGap = parseFloat(root.getPropertyValue('--card-gap')) || 16;
            targetHeight = multiplier * (cardSize + cardGap);
        }

        // Subtract the calendar group's non-scrollable parts (header, padding, border)
        const minH = heightSetting === 'auto' ? 150 : 60;
        const maxH = Math.max(minH, targetHeight - this._cardOverhead(calendarGroup));
        eventsContainer.style.maxHeight = maxH + 'px';
        // max-height alone caps a box but doesn't give it a size — short
        // content still shrink-wraps, leaving a timeline (flex: 1 1 auto)
        // nothing to grow into. Pin minHeight to the same figure so the box
        // is definite; list mode has no such need and keeps shrink-to-content.
        if (eventsContainer.querySelector('.calendar-timeline')) {
            eventsContainer.style.minHeight = maxH + 'px';
        } else {
            eventsContainer.style.minHeight = '';
        }
    },

    // When the height ladder can't compute a target (full-width band, or too
    // few right-column groups to measure against), the stylesheet's 38vh
    // max-height is the fallback — a cap that doesn't reserve room, so a
    // timeline needs a matching minHeight or the flex chain shrink-wraps it
    // to whatever loaded first. List mode keeps shrink-to-content.
    _pinTimelineFallbackMinHeight(eventsContainer) {
        eventsContainer.style.minHeight =
            eventsContainer.querySelector('.calendar-timeline') ? '38vh' : '';
    },

    // Retune the timeline's hour-row height to whatever vertical room
    // _applyCalendarHeight just gave the card: clamp(available / spanHours,
    // TL_HOUR_MIN, TL_HOUR_MAX) px/hour. Within the clamps the grid exactly
    // fills the card (no scroll, no dead air); denser spans hit TL_HOUR_MIN
    // and scroll as today does; sparser spans hit TL_HOUR_MAX and leave calm
    // dead air below rather than stretching rows to fill it. Every timeline
    // position is a calc() fraction of --tl-gridh, so writing that one
    // variable rescales the whole grid coherently. One measurement pass, no
    // rebuild — the header row and all-day band are sized by their own
    // content, not by hour height, so nothing measured here feeds back into
    // what was just measured; a convergence loop would only be needed if it did.
    _sizeTimelineHours() {
        const tl = document.querySelector('.calendar-group .calendar-timeline');
        if (!tl) return; // list mode / chip day views have no timeline

        const spanMin = parseFloat(tl.dataset.spanMin);
        if (!(spanMin > 0)) return;

        // Room above the hour row is measured as the gutter's content offset,
        // not by summing the header/all-day cells: with align-items:start each
        // grid row track is as tall as its TALLEST cell, and the first cell is
        // not necessarily it (a wrapped "TODAY · MON 4 AUG" header, or an
        // all-day chip on day 3 only). The offset also folds in the row-gaps
        // and fractional heights an integer offsetHeight sum would round away.
        // clientHeight (not offsetHeight) excludes the horizontal scrollbar,
        // which would otherwise get counted as room for hour rows.
        const gutter = tl.querySelector('.cal-tl-gutter');
        if (!gutter) return;
        const gutterTop = gutter.getBoundingClientRect().top
            - tl.getBoundingClientRect().top + tl.scrollTop;
        // The last hour label centers on the grid's bottom edge via
        // translateY(-50%); without headroom for its lower half, an
        // exactly-fitted grid always overflows by half a line and shows a
        // pointless ~5px scroll range.
        const label = gutter.querySelector('.cal-tl-hour');
        const avail = tl.clientHeight - gutterTop - (label ? label.offsetHeight / 2 : 0);
        if (!(avail > 0)) return; // card is display:none or mid-teardown

        const spanHours = spanMin / 60;
        const hourH = Math.min(this.TL_HOUR_MAX, Math.max(this.TL_HOUR_MIN, avail / spanHours));
        tl.style.setProperty('--tl-gridh', (spanHours * hourH).toFixed(1) + 'px');
    },

    // To-Do has no automatic sizing mode — it is either the stylesheet default
    // (max-height: 60vh) or a height the user dragged onto it.
    matchTodoHeight() {
        const todoGroup = document.querySelector('.todo-group');
        const list = todoGroup?.querySelector('.todo-list');
        if (!todoGroup || !list) return;
        if (this._cardDragActive() && this._cardResize.id === '__todo__') return;

        // Row heights depend on how the task text wraps, so settle that first —
        // this runs on every path that re-evaluates the card's box (render,
        // scoped To-Do re-render, debounced window resize, font-size change).
        this._fitTodoText(todoGroup);

        const manual = this._getCardLayout('__todo__').height;
        if (manual == null) {
            this._clearCardHeightPx(list);
            this._syncResizeHandleValue(todoGroup);
            return;
        }
        this._applyCardHeightPx(todoGroup, manual);
    },

    // ---- To-Do text wrapping -------------------------------------------------
    // Task/subtask fields wrap and may take up to TODO_TEXT_MAX_ROWS lines; text
    // past that is clipped (CSS overflow) rather than shown. A textarea has no
    // content-driven auto-height in CSS, so the row count is set here.
    TODO_TEXT_MAX_ROWS: 2,

    _fitTodoText(scope) {
        (scope || document).querySelectorAll('.todo-text')
            .forEach(el => this._fitTodoTextField(el));
    },

    // Grow one field to the fewest rows that hold its text, capped at the max.
    // Counting rows (rather than measuring a pixel height) keeps this correct
    // under the card's font-size setting and its sub-1 `zoom` companion, whose
    // scaling would otherwise have to be undone by hand. scrollHeight and
    // clientHeight both include padding, so they compare directly; the 2px
    // tolerance absorbs sub-pixel line-height rounding on a field that really
    // does fit on one line.
    _fitTodoTextField(el) {
        if (!el) return;
        for (let rows = 1; rows <= this.TODO_TEXT_MAX_ROWS; rows++) {
            el.rows = rows;
            if (el.scrollHeight <= el.clientHeight + 2) return;
        }
    },

    // ---- Timeline scroll position -------------------------------------------
    // The hour-grid timeline scrolls internally, and every calendar re-render
    // (including the periodic background fetch) rebuilds it from scratch. Read
    // the outgoing scrollTop BEFORE the rebuild and hand it back to
    // _applyTimelineScroll afterwards, so a refresh never yanks the view out
    // from under someone who scrolled somewhere deliberately.
    _readTimelineScroll() {
        const tl = document.querySelector('.calendar-group .calendar-timeline');
        return tl ? tl.scrollTop : null;
    },

    // Give each timeline event block as many text lines as its pixel height allows,
    // so a tall block fills its height instead of truncating on one line. Block
    // heights are fixed (set inline from the event's duration), so CSS alone can't
    // do it — -webkit-line-clamp needs an integer line count. Measure one rendered
    // line from a hidden probe (the --cal-z-* zoom vars make rem math unreliable),
    // then set the clamp per block from its inline height. Setting the clamp never
    // changes a block's own height (its text is overflow-hidden inside a fixed box),
    // so this is safe to run before the scroll-anchoring math in _applyTimelineScroll.
    _fitTimelineEventText(timeline) {
        if (!timeline) return;
        const events = timeline.querySelectorAll('.cal-tl-event');
        if (!events.length) return;

        // One hidden probe carrying the real font/zoom cascade → one line's height.
        // position:absolute keeps it out of the grid flow; removed before it paints.
        const probe = document.createElement('div');
        probe.className = 'cal-tl-event';
        probe.style.cssText = 'position:absolute; visibility:hidden; pointer-events:none; top:0; left:0; width:120px; height:auto; min-height:0;';
        probe.innerHTML = '<span class="cal-tl-event-text"><span class="cal-tl-event-time">00–00</span><span class="cal-tl-event-title">Mg</span></span>';
        timeline.appendChild(probe);
        const probeText = probe.querySelector('.cal-tl-event-text');
        const lineH = probeText ? probeText.offsetHeight : 0;
        timeline.removeChild(probe);
        if (!lineH) return;

        // Block heights are calc() fractions of --tl-gridh, so the px value is
        // fraction × the variable's current value — recovered from the inline
        // style string rather than measured, keeping this loop free of
        // per-block layout (a rendered-height read per block would interleave
        // with the clamp writes below and force a reflow each iteration).
        const gridH = parseFloat(timeline.style.getPropertyValue('--tl-gridh')) || 0;
        const FRAC_RE = /var\(--tl-gridh\)\s*\*\s*([\d.]+)/;
        events.forEach(el => {
            const text = el.querySelector('.cal-tl-event-text');
            if (!text) return;
            // Minus 2px for the 1px top+bottom padding on .cal-tl-event. The
            // same 3px floor the inline max() applies; the stylesheet's 14px
            // min-height is deliberately ignored, as the old px parse was.
            const m = FRAC_RE.exec(el.style.height);
            const inner = (m ? Math.max(3, gridH * parseFloat(m[1])) : 0) - 2;
            const lines = Math.max(1, Math.floor(inner / lineH));
            text.style.webkitLineClamp = String(lines);
            text.style.lineClamp = String(lines);
        });
    },

    // Anchor the viewport on the current-time line when the outgoing timeline was
    // still sitting exactly where we last anchored it (i.e. the user never
    // scrolled it) or when there was no timeline at all — the first render of the
    // session, or the timeline having just been switched on. The now-line is
    // placed from the calendar's configured timezone, so the landing spot follows
    // that timezone. Otherwise the user's own position wins.
    //
    // Re-anchoring rather than replaying the pixel value matters on the refresh
    // after the first fetch: the event data changes the compressed hour mapping,
    // so the old pixel offset no longer points at the same hour. The mapping is
    // also time-dependent — the hour holding "now" is kept uncollapsed, so the
    // grid re-flows whenever the clock crosses an hour into or out of a gap.
    //
    // Runs in rAF — the timeline needs its final height (matchCalendarHeight) and
    // layout before scrollTop means anything.
    _applyTimelineScroll(prev) {
        // A pending "jump to today" (Today button) forces re-anchoring on the
        // now-line even if the user had scrolled the outgoing timeline away from
        // it. One-shot flag, consumed on this render.
        const forceNow = this._calTlForceNow === true;
        this._calTlForceNow = false;
        const userMoved = !forceNow && prev != null
            && (this._calTlAnchoredTop == null || Math.abs(prev - this._calTlAnchoredTop) > 1);

        requestAnimationFrame(() => {
            const tl = document.querySelector('.calendar-group .calendar-timeline');
            if (!tl) return;
            // Fit each event block's text to its height (runs on every render path
            // through this hook). Before the scroll math below — it never changes a
            // block's own height, so the now-line geometry stays valid.
            this._fitTimelineEventText(tl);
            if (userMoved) { tl.scrollTop = prev; return; }

            const now = tl.querySelector('.cal-tl-now');
            if (!now) return;   // "now" isn't inside the rendered window — leave it at the top

            // Distance from the scroll box's top edge to the now-line, in its
            // current scroll state. Landing it ~35% down the viewport keeps the
            // preceding hour visible and clears the sticky day headers.
            const delta = now.getBoundingClientRect().top - tl.getBoundingClientRect().top;
            tl.scrollTop += delta - tl.clientHeight * 0.35;
            // Record where it actually landed (the browser clamps to the scroll
            // range) so the next render can tell our scroll from the user's.
            this._calTlAnchoredTop = tl.scrollTop;
        });
    },

    // "Today" button (day views only). Snap the window back to today, force the
    // timeline to re-anchor on the now-line even if the user had scrolled away,
    // and flash today's column so the jump is obvious.
    jumpToTodayView() {
        const cm = window.CalendarManager;
        if (!cm) return;
        this._calTlForceNow = true;     // consumed by _applyTimelineScroll
        cm.resetDayViewToToday();       // offset = 0, then renderCalendarCard()
        this._flashTodayColumn();
    },

    // Green 3-blink flash on today's column(s): the timeline day column (plus its
    // header and all-day cell) or the chip grid's day column, whichever rendered.
    // Runs after the render has rebuilt the DOM.
    _flashTodayColumn() {
        requestAnimationFrame(() => {
            const cells = document.querySelectorAll(
                '.calendar-group .cal-tl-col.is-today,'
              + '.calendar-group .cal-tl-dayhead.is-today,'
              + '.calendar-group .cal-tl-allday-cell.is-today,'
              + '.calendar-group .calendar-day-col.is-today');
            cells.forEach(el => {
                el.classList.remove('cal-today-flash');
                void el.offsetWidth;    // restart the animation if it was mid-flight
                el.classList.add('cal-today-flash');
                el.addEventListener('animationend',
                    () => el.classList.remove('cal-today-flash'), { once: true });
            });
        });
    },

    // Keep the ticker scrolling in every case. The translateX(-50%) marquee only
    // tiles seamlessly when one sequence spans at least the visible width, so when
    // there are few / short events we repeat the items (cloned, aria-hidden, not
    // tab stops) until a sequence fills the container — avoiding both the static
    // state and the blank-jump the raw technique shows for narrow content. Also
    // sets a width-proportional duration for a steady speed. Runs on render+resize.
    _sizeUpcomingTicker(scope) {
        const ticker = (scope || document).querySelector('.cal-upcoming-ticker');
        if (!ticker) return;
        const seqs = ticker.querySelectorAll('.cal-upcoming-seq');
        if (!seqs.length) return;
        // Drop clones from any previous sizing pass so we re-measure cleanly.
        seqs.forEach(s => s.querySelectorAll('[data-cal-clone="1"]').forEach(n => n.remove()));
        // Reduced motion: CSS shows a single scrollable row instead of a marquee,
        // so there's nothing to fill or time.
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const container = ticker.clientWidth;
        if (!container) return;
        seqs.forEach(seq => {
            const originals = [...seq.children];
            if (!originals.length) return;
            let guard = 0;
            while (seq.scrollWidth < container && guard++ < 50) {
                for (const el of originals) {
                    const c = el.cloneNode(true);
                    c.setAttribute('data-cal-clone', '1');
                    c.setAttribute('aria-hidden', 'true');
                    c.setAttribute('tabindex', '-1');
                    seq.appendChild(c);
                }
            }
        });
        // Width-proportional duration → steady scroll speed regardless of count.
        // Base speed 55 px/s × 0.85 × 0.9 = 42.08 px/s → 15% slower, then a
        // further 10% slower.
        const track = ticker.querySelector('.cal-upcoming-track');
        if (track) {
            const seqW = seqs[0].scrollWidth;
            track.style.setProperty('--cal-ticker-dur', Math.max(10, Math.round(seqW / (55 * 0.85 * 0.9))) + 's');
        }
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
