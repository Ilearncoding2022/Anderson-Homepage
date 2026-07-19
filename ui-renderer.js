// ==========================================
// UI Renderer Module v1.4
// Handles rendering with position-based sorting
// Uses event delegation for click/drag handlers
// ==========================================

const UIRenderer = {
    _delegationAttached: false,

    // Load/save layout info for virtual groups (position + column)
    // Format: { '__recent__': { position: 2, column: 1 }, ... }
    // Backward compat: if value is a number, treat as { position: number, column: 1 }
    _getVirtualPositions() {
        const saved = localStorage.getItem('virtualGroupPositions');
        const raw = saved ? (Utils.safeJSONParse(saved, {}) || {}) : {};
        const result = {};
        for (const [id, val] of Object.entries(raw)) {
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
                ? `.todo-check[data-id="${CSS.escape(f.id)}"][data-sub="${CSS.escape(f.sub)}"]`
                : `.todo-check[data-id="${CSS.escape(f.id)}"]:not([data-sub])`;
        } else if (f.action === 'reorder') {
            // Keep focus on the drag handle the user just moved with the keyboard.
            selector = f.sub
                ? `.todo-drag-handle[data-id="${CSS.escape(f.id)}"][data-sub="${CSS.escape(f.sub)}"]`
                : `.todo-drag-handle[data-id="${CSS.escape(f.id)}"]:not([data-sub])`;
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
            const favGroup = { id: '__favorites__', name: '★ Favorites', color: 'rgba(255, 193, 7, 0.2)', position: fv.position ?? -3, column: fv.column ?? 1, collapsed: false, _virtual: true };
            allEntries.push({ group: favGroup, websites: favorites, type: 'standard' });
        }

        // Recently Opened virtual group
        const recentlyOpened = AppState.websites
            .filter(w => w.lastOpened)
            .sort((a, b) => new Date(b.lastOpened) - new Date(a.lastOpened))
            .slice(0, 3);
        if (recentlyOpened.length > 0) {
            const rv = vPos['__recent__'] || {};
            const recentGroup = { id: '__recent__', name: '🕐 Recently Opened', color: 'rgba(33, 150, 243, 0.2)', position: rv.position ?? -2, column: rv.column ?? 1, collapsed: false, _virtual: true };
            allEntries.push({ group: recentGroup, websites: recentlyOpened, type: 'standard' });
        }

        // Calendar virtual group
        const cv = vPos['__calendar__'] || {};
        const calGroup = { id: '__calendar__', position: cv.position ?? -1, column: cv.column ?? 2, _virtual: true };
        allEntries.push({ group: calGroup, type: 'calendar' });

        // To-Do virtual group
        const tv = vPos['__todo__'] || {};
        const todoGroup = { id: '__todo__', position: tv.position ?? -1, column: tv.column ?? 1, _virtual: true };
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

        // Split entries into column 1, column 2, and full-width
        const col1Entries = [];
        const col2Entries = [];
        const fullEntries = [];

        allEntries.forEach(entry => {
            const g = entry.group;
            if (g.id === 'ungrouped') {
                fullEntries.push(entry);
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
            let resizeDebounce = null;
            window.addEventListener('resize', () => {
                clearTimeout(resizeDebounce);
                resizeDebounce = setTimeout(() => this.matchCalendarHeight(), 150);
            });
            this._delegationAttached = true;
        }

        // Restore focus into the To-Do card after a mutation re-rendered it.
        this._restoreTodoFocus(container);

        // Sync minimap (full structural rebuild — groups may have moved)
        if (window.Minimap) Minimap.render();

        // Size the upcoming-event ticker (render() doesn't run matchCalendarHeight).
        this._sizeUpcomingTicker();

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
    },

    renderCalendarCard() {
        const container = document.getElementById('mainContainer');
        if (!container) { this.render(); return; }

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
                 data-position="${group.position}"
                 style="--card-tint: ${safeColor};">
                <div class="group-header">
                    <div class="group-title-container">
                        ${showCollapseButton ? `<button class="group-action-btn collapse-btn" onclick="App.toggleGroupCollapse('${safeId}')" title="${collapseTitle}">${collapseIcon}</button>` : ''}
                        <div class="group-title">
                            ${isDefault ? '<span class="default-indicator">⚓</span>' : ''}
                            ${safeName}
                            <span class="group-count">(${websites ? websites.length : 0})</span>
                        </div>
                    </div>
                    ${showActions ? `<div class="group-actions">
                        <button class="group-action-btn" onclick="App.editGroup('${safeId}')" title="Edit Group">✏️</button>
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
            : `<div class="website-icon" style="width: ${iconSize}px; height: ${iconSize}px; font-size: ${iconSize * 0.5}px;">🌐</div>`;

        const favStar = website.favorite ? '★' : '☆';
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
                    <button class="favorite-btn ${website.favorite ? 'is-favorite' : ''}" onclick="App.toggleFavorite(event, '${safeId}')" title="${favTitle}">${favStar}</button>
                    <button class="edit-btn" onclick="App.editWebsite(event, '${safeId}')" title="Edit">✏️</button>
                </div>
                <button class="new-tab-btn" title="Open in new tab">⧉</button>
            </div>
        `;
    },

    // ========================================
    // CALENDAR SECTION
    // ========================================

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
                warningBadge = `<span class="calendar-stale-badge" title="${Utils.sanitizeHTML(tip)}" aria-label="${Utils.sanitizeHTML(tip)}" role="img">⚠</span>`;
            }
        }

        const contentHTML = this._calendarContentHTML();

        // Build calendar legend from configured calendars
        const calendars = cm?.getCalendars() || [];

        return `
            <div class="app-group virtual-group calendar-group"
                 data-group-id="__calendar__"
                 style="--card-tint: rgba(76, 175, 80, 0.2);">
                <div class="group-header">
                    <div class="group-title-container">
                        <div class="group-title">
                            <a class="calendar-icon-link" href="https://calendar.google.com" title="Open Google Calendar">📅</a> Calendar${this._calendarLegendButton(calendars)}${isConfigured ? this._calendarViewDropdown(viewMode, viewLabel) : ''}${isConfigured && viewMode !== 'list' ? `<button class="calendar-timeline-toggle${cm.getTimelineMode() ? ' active' : ''}" onclick="CalendarManager.toggleTimelineMode()" role="switch" aria-checked="${cm.getTimelineMode() ? 'true' : 'false'}" title="Toggle hour-by-hour timeline" aria-label="Hour-by-hour timeline"><span class="calendar-group-toggle-icon" aria-hidden="true">◷</span>Timeline</button>` : ''}${isConfigured ? this._calendarGroupingDropdown(groupLabel) : ''}
                        </div>
                        <div class="calendar-header-meta">
                            ${isConfigured ? `<button class="calendar-refresh-btn" onclick="CalendarManager.fetchEvents()" title="Refresh now">↻</button>` : ''}
                            ${lastFetchedLabel ? `<span class="calendar-last-updated">${Utils.sanitizeHTML(lastFetchedLabel)}</span>` : ''}
                            ${warningBadge}
                            ${fetchError ? `<span class="calendar-error-dot" title="${Utils.sanitizeHTML(fetchError)}">!</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="calendar-events-container">
                    ${contentHTML}
                </div>
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

    // View picker: a menu-button dropdown (3-Day / 5-Day / Week / List). Replaces
    // the old cycling button so any view is one click away.
    _calendarViewDropdown(viewMode, viewLabel) {
        const labels = { '3day': '3-Day', '5day': '5-Day', week: 'Week', list: 'List' };
        const order = ['3day', '5day', 'week', 'list'];
        const items = order.map(m =>
            `<button class="calendar-view-menu-item" role="menuitemradio" aria-checked="${m === viewMode ? 'true' : 'false'}" onclick="CalendarManager.setViewMode('${m}')">${labels[m]}</button>`
        ).join('');
        return `<span class="calendar-view-dd">`
            + `<button class="calendar-view-toggle" onclick="UIRenderer.toggleViewMenu(this)" aria-haspopup="menu" aria-expanded="false" aria-controls="calViewMenu" title="Change calendar view" aria-label="Change calendar view. Current: ${Utils.sanitizeHTML(viewLabel)}"><span class="calendar-group-toggle-icon" aria-hidden="true">▦</span>${Utils.sanitizeHTML(viewLabel)}<span class="calendar-view-caret" aria-hidden="true">▾</span></button>`
            + `<div class="calendar-view-menu" id="calViewMenu" role="menu" aria-label="Calendar view">${items}</div>`
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
            + `<button class="calendar-view-toggle" onclick="UIRenderer.toggleViewMenu(this)" aria-haspopup="menu" aria-expanded="false" aria-controls="calGroupMenu" title="Change event grouping" aria-label="Change event grouping. Current: ${Utils.sanitizeHTML(groupLabel)}"><span class="calendar-group-toggle-icon" aria-hidden="true">⊞</span>${Utils.sanitizeHTML(groupLabel)}<span class="calendar-view-caret" aria-hidden="true">▾</span></button>`
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

    _calendarSetupPrompt() {
        return `
            <div class="calendar-setup-prompt">
                <p>Connect your Google Calendar to see upcoming events here.</p>
                <ol>
                    <li>Deploy the Apps Script proxy (see 5-calendar.js for template)</li>
                    <li>Get your calendars' secret ICS URLs from Google Calendar Settings</li>
                    <li>Open Settings (☰ menu) and paste the proxy URL, token, and ICS URLs (one per line)</li>
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
                inner = `<span class="ec-icon" aria-hidden="true">⏳</span><span class="ec-text">${Utils.sanitizeHTML(cd.text)}</span>`;
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
            const rawCalColor = ev._calColor || '#4CAF50';
            const calColor = Utils.isValidColor(rawCalColor) ? rawCalColor : '#4CAF50';
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
                ? `<a class="calendar-event-join" href="${meetUrlSafe}" target="_blank" rel="noopener"
                       data-cal-join="1" title="${meetLabelSafe}"
                       aria-label="${meetLabelSafe}: ${safeTitle}">🎥 Join</a>`
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
                <button class="cal-nav-today" onclick="CalendarManager.resetDayViewToToday()" ${win.offset === 0 ? 'disabled' : ''} aria-label="Back to today" title="Back to today">Today</button>
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
        const format = cm.getUpcomingBarFormat();
        const tz = cm.getAnchorTimezone();

        const dot = (ev) => {
            const raw = ev._calColor || '#4CAF50';
            const c = Utils.isValidColor(raw) ? raw : '#4CAF50';
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

        // Ticker: two identical sequences translated by -50% for a seamless loop.
        // Only the first is focusable/announced; the duplicate is aria-hidden and
        // not a tab stop, but stays clickable via the delegated data-cal-event.
        const itemHTML = (ev, dup) => {
            const title = Utils.sanitizeHTML(ev.title || 'Untitled');
            const t = Utils.sanitizeHTML(timeText(ev));
            const start = new Date(ev.start).getTime();
            const a11y = dup
                ? `tabindex="-1" aria-hidden="true"`
                : `tabindex="0" role="button" aria-label="View details: ${title}, starting ${t}"`;
            return `
                <span class="cal-upcoming-item cal-upcoming-tick" data-bar-start="${start}"
                      ${this._calEventDataAttrs(ev)} ${a11y}>
                    ${dot(ev)}
                    <span class="cal-upcoming-name">${title}</span>
                    <span class="cal-upcoming-time">· ${t}</span>
                </span>`;
        };
        const seq = (dup) => `<div class="cal-upcoming-seq"${dup ? ' aria-hidden="true"' : ''}>${events.map(ev => itemHTML(ev, dup)).join('')}</div>`;
        // Duration scales with item count so more events don't scroll faster
        // (the loop distance is one sequence width, which grows with the count).
        const dur = Math.max(12, events.length * 7);
        return `<div class="cal-upcoming-bar cal-upcoming-ticker" aria-label="Upcoming events">
            <div class="cal-upcoming-track" style="--cal-ticker-dur:${dur}s">${seq(false)}${seq(true)}</div>
        </div>`;
    },

    _calendarDayChip(ev, tz, dayLabel) {
        const cm = window.CalendarManager;
        const rawCalColor = ev._calColor || '#4CAF50';
        const calColor = Utils.isValidColor(rawCalColor) ? rawCalColor : '#4CAF50';

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

    // Hour-by-hour timeline for 3/5-day views. A shared hour axis (left gutter)
    // aligns time-positioned event blocks across all day columns; all-day events
    // sit in a band above the grid.
    _calendarTimeline(win) {
        const cm = window.CalendarManager;
        const model = cm.buildTimelineModel(win);
        const HOUR_H = 66;   // px per hour row
        // displaySpanMin is the COMPRESSED span: merged free stretches count as
        // one reduced-height row each, not their real length.
        const spanHours = model.displaySpanMin / 60;
        const gridH = Math.max(HOUR_H, Math.round(spanHours * HOUR_H));
        const n = model.days.length;

        // A single CSS grid holds three row-groups that share one column template
        // and one horizontal scroll, so the day headers, all-day band, and hour
        // grid stay aligned: [gutter | day-1 | … | day-N].
        // Row 1 — per-day headers (matches the chip day view's column headers).
        const headers = `<div class="cal-tl-corner" aria-hidden="true"></div>`
            + model.days.map(d =>
                `<div class="cal-tl-dayhead${d.day.isToday ? ' is-today' : ''}">${Utils.sanitizeHTML(d.day.isToday ? 'Today · ' + d.day.label : d.day.label)}</div>`
            ).join('');

        // Row 2 — all-day band (only when the window has any all-day events).
        const hasAllDay = model.days.some(d => d.allDay.length > 0);
        const alldayRow = hasAllDay
            ? `<div class="cal-tl-allday-label" aria-hidden="true">all-day</div>`
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
        const gutter = `
            <div class="cal-tl-gutter" style="grid-row:${hourRow}; grid-column:1; height:${gridH}px" aria-hidden="true">
                ${model.hours.map(h => {
                    // topPct comes from the model's compressed (gap-collapsed) mapping.
                    const top = (h.topPct / 100) * gridH;
                    return `<span class="cal-tl-hour" style="top:${top.toFixed(1)}px">${h.label}:00</span>`;
                }).join('')}
            </div>`;

        // Hour gridlines: merged gaps collapse to sub-hour rows, so hour
        // boundaries below a gap leave the fixed hour lattice and a repeating
        // gradient would drift off them. Paint one 1px background layer per
        // hour line instead, positioned off the same compressed mapping as the
        // hour labels and event blocks. (The class supplies background-color;
        // these inline layers stack on top of it.)
        const lineImg = 'linear-gradient(rgba(255,255,255,0.08), rgba(255,255,255,0.08))';
        const lineBg = model.hours.length
            ? `background-image:${model.hours.map(() => lineImg).join(',')};`
              + `background-position:${model.hours.map(h => `0 ${((h.topPct / 100) * gridH).toFixed(1)}px`).join(',')};`
              + `background-size:100% 1px;background-repeat:no-repeat;`
            : '';

        const cols = model.days.map((d, di) => {
            const blocks = d.timed.map(p => {
                const ev = p.ev;
                const rawColor = ev._calColor || '#4CAF50';
                const color = Utils.isValidColor(rawColor) ? rawColor : '#4CAF50';
                const safeTitle = Utils.sanitizeHTML(ev.title || 'Untitled');
                const startD = new Date(ev.start);
                const endD = ev.end ? new Date(ev.end) : startD;
                const timeText = `${cm._timeStr(startD, win.tz)}–${cm._timeStr(endD, win.tz)}`;
                const width = 100 / p.laneCount;
                const left = p.lane * width;
                // Position in PIXELS off gridH — the identical basis the hour labels
                // and the CSS hour gridlines use — so events lock to the hour lines
                // regardless of the column's actual rendered height (a %-basis drifts
                // if the column is ever taller/shorter than gridH).
                const topPx = (p.topPct / 100) * gridH;
                const heightPx = Math.max(3, (p.heightPct / 100) * gridH);
                return `
                    <div class="cal-tl-event"
                         style="top:${topPx.toFixed(1)}px; height:${heightPx.toFixed(1)}px; left:${left}%; width:calc(${width}% - 2px); background:${color};"
                         ${this._calEventDataAttrs(ev)}
                         tabindex="0" role="button"
                         aria-label="View details: ${safeTitle}, ${Utils.sanitizeHTML(d.day.label)}, ${Utils.sanitizeHTML(timeText)}">
                        <span class="cal-tl-event-time">${Utils.sanitizeHTML(timeText)}</span>
                        <span class="cal-tl-event-title">${safeTitle}</span>
                    </div>`;
            }).join('');
            const nowLine = d.nowTopPct != null
                ? `<div class="cal-tl-now" style="top:${((d.nowTopPct / 100) * gridH).toFixed(1)}px" aria-hidden="true"></div>` : '';
            return `
                <div class="cal-tl-col${d.day.isToday ? ' is-today' : ''}" style="grid-row:${hourRow}; grid-column:${di + 2}; height:${gridH}px; ${lineBg}">
                    ${nowLine}${blocks || ''}
                </div>`;
        }).join('');

        // Merged "no events" bands: one overlay grid item pinned onto the hour-grid
        // row spanning every day column (row index depends on the all-day band).
        // Each band is collapsed to a single reduced-height row labeled with the
        // hour range it stands in for. Positioned in PIXELS off gridH, the same
        // basis as hour labels/gridlines.
        const gapsHtml = model.gaps.length
            ? `<div class="cal-tl-gaps" style="grid-row:${hourRow}; height:${gridH}px" aria-hidden="true">
                ${model.gaps.map(g => `<div class="cal-tl-gap" style="top:${((g.topPct / 100) * gridH).toFixed(1)}px; height:${((g.heightPct / 100) * gridH).toFixed(1)}px"><span>${Utils.sanitizeHTML(g.label)} · no events</span></div>`).join('')}
               </div>`
            : '';

        return `
            <div class="calendar-timeline" style="--cal-days:${n}">
                ${headers}
                ${alldayRow}
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
            const color = Utils.isValidColor(cal.color) ? cal.color : '#4CAF50';
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
                   <a href="${Utils.sanitizeHTML(meetUrl)}" target="_blank" rel="noopener" class="cal-detail-join-link">🎥 Join video call</a>
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
                        <a href="https://calendar.google.com" target="_blank" rel="noopener" class="cal-detail-gcal-link">
                            📅 Open Google Calendar
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

        const itemsHTML = todos.map(task => {
            const pSafe = Utils.sanitizeHTML(task.id);
            const pName = Utils.sanitizeHTML(task.text || '(untitled task)');
            const subsHTML = task.subtasks.map(sub => this._renderTodoItem(sub, task.id)).join('');
            // The add-subtask field is hidden until the user opens it with the + button.
            const subAddHTML = addOpen.has(task.id)
                ? `<input type="text" class="todo-subadd" data-todo-action="add-sub"
                          data-id="${pSafe}" placeholder="+ Add subtask" aria-label="Add subtask to ${pName}">`
                : '';
            return `
                <div class="todo-row" data-id="${pSafe}">
                    ${this._renderTodoItem(task, null)}
                    <div class="todo-subs">
                        ${subsHTML}
                        ${subAddHTML}
                    </div>
                </div>`;
        }).join('');

        const emptyHTML = todos.length === 0
            ? '<div class="todo-empty">No tasks yet — add one below.</div>'
            : '';

        return `
            <div class="app-group virtual-group todo-group"
                 data-group-id="__todo__"
                 style="--card-tint: rgba(156, 39, 176, 0.18);">
                <div class="group-header">
                    <div class="group-title-container">
                        <div class="group-title">📝 To-Do <span class="group-count">(${remaining})</span></div>
                    </div>
                    <div class="group-actions">
                        <button type="button" class="group-action-btn todo-archive-btn" data-todo-action="open-archive"
                                title="View deleted-item archive" aria-label="View deleted-item archive">🗄</button>
                    </div>
                </div>
                <div class="todo-list">
                    ${emptyHTML}
                    ${itemsHTML}
                    <input type="text" class="todo-add" data-todo-action="add-task"
                           placeholder="+ Add a task" aria-label="Add a task">
                </div>
            </div>
        `;
    },

    // Render a single task or subtask row. `parentId` is null for top-level tasks.
    _renderTodoItem(task, parentId) {
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
            : `<span class="ts-date ts-empty" aria-hidden="true">📅</span>`;
        const recurChip = hasRecur
            ? `<span class="ts-recur recur-${Utils.sanitizeHTML(recur)}" aria-hidden="true" title="Repeats ${Utils.sanitizeHTML(recurLabel)}">⟳</span>`
            : '';
        const scheduleBtn = `
                <button type="button" class="todo-schedule-btn ${overdue}${hasRecur ? ' has-recur' : ''}" data-todo-action="schedule" ${ids}
                        title="Due date & repeat — click to edit"
                        aria-label="${scheduleAria}">${dateFace}${recurChip}</button>`;

        return `
            <div class="todo-item ${isSub ? 'todo-sub' : ''} ${task.done ? 'done' : ''}" ${ids}>
                ${dragHandle}
                <input type="checkbox" class="todo-check" data-todo-action="toggle" ${ids}
                       ${task.done ? 'checked' : ''} aria-label="${task.done ? 'Mark not done' : 'Mark done'}: ${name}">
                <input type="text" class="todo-text" data-todo-action="text" ${ids}
                       value="${safeText}" placeholder="${isSub ? 'Subtask' : 'Task'}…" aria-label="${isSub ? 'Subtask' : 'Task'} text">
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
                    <h2 id="todoScheduleTitle">🗓 Schedule</h2>
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
            if (action === 'toggle') {
                sub ? TodoManager.toggleSubtask(id, sub) : TodoManager.toggleTask(id);
            } else if (action === 'text') {
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
            if (action === 'urgency') {
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
                // can restore it directly from the archive.
                const archId = sub || id;
                this._todoAddOpen?.delete(id);
                TodoManager.delete(id, sub);
                UI.showUndoToast(`${label} deleted`, () => {
                    TodoManager.restoreFromArchive(archId);
                });
            } else if (action === 'add-sub-toggle') {
                e.preventDefault();
                const set = this._todoAddOpen || (this._todoAddOpen = new Set());
                if (set.has(id)) {
                    set.delete(id);
                } else {
                    set.add(id);
                    this._pendingTodoFocus = { action: 'add-sub', id };
                }
                this.renderTodoCard();
            } else if (action === 'open-archive') {
                e.preventDefault();
                this.openTodoArchive();
            }
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
                el.blur(); // commit via the change handler
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
                if (action === 'restore') {
                    TodoManager.restoreFromArchive(archId);
                } else if (action === 'del-forever') {
                    if (window.confirm('Permanently delete this archived item? This cannot be undone.')) {
                        TodoManager.deleteFromArchive(archId);
                    }
                } else if (action === 'close') {
                    this.closeTodoArchive();
                }
                return;
            }
            // Click on the modal backdrop (outside the content) closes it.
            if (e.target.id === 'todoArchiveModal') this.closeTodoArchive();
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

    // Re-render whichever archive views are currently visible.
    refreshArchiveViews() {
        const modal = document.getElementById('todoArchiveModal');
        if (modal && modal.classList.contains('show')) {
            this.renderTodoArchive(document.getElementById('todoArchiveModalBody'));
            // Re-rendering the body detaches the nodes the focus trap captured,
            // so rebuild it over the fresh DOM.
            Utils.releaseFocus(modal, this._archiveFocusTrap);
            this._archiveFocusTrap = Utils.trapFocus(modal);
        }
        const settingsBody = document.getElementById('todoArchiveSettings');
        if (settingsBody) this.renderTodoArchive(settingsBody);
    },

    renderTodoArchive(container) {
        if (!container) return;
        const tm = window.TodoManager;
        const archive = tm?.getArchive() || [];
        const ttl = tm?.ARCHIVE_TTL_DAYS ?? 14;

        if (archive.length === 0) {
            container.innerHTML = `<div class="todo-empty">No archived items. Deleted tasks are kept here for ${ttl} days.</div>`;
            return;
        }

        const section = (title, items) => items.length === 0 ? '' : `
            <div class="todo-archive-section">
                <h3 class="todo-archive-heading">${title} <span class="group-count">(${items.length})</span></h3>
                ${items.map(a => this._renderArchiveItem(a)).join('')}
            </div>`;

        container.innerHTML =
            section('Done &amp; deleted', archive.filter(a => a.done)) +
            section('Not done &amp; deleted', archive.filter(a => !a.done));
    },

    _renderArchiveItem(a) {
        const tm = window.TodoManager;
        const safeId = Utils.sanitizeHTML(a.id);
        const name = Utils.sanitizeHTML(a.text || '(untitled task)');
        const urgency = tm.URGENCY_LEVELS.includes(a.urgency) ? a.urgency : 'tbd';
        const urgencyLabel = tm.URGENCY_LABELS[urgency];
        const days = tm.daysUntilPurge(a.deletedAt);

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
                            data-arch-id="${safeId}" aria-label="Restore ${name}">Restore</button>
                    <button type="button" class="todo-archive-action del-forever" data-todo-arch-action="del-forever"
                            data-arch-id="${safeId}" aria-label="Delete ${name} forever">Delete forever</button>
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

    // Dynamically set calendar events container height. In 'auto' mode it aligns
    // with the first 2 groups in the right column; otherwise the user-selected
    // multiplier sets the card height to that many single-row card heights.
    matchCalendarHeight() {
        const calendarGroup = document.querySelector('.calendar-group');
        const eventsContainer = calendarGroup?.querySelector('.calendar-events-container');
        if (!calendarGroup || !eventsContainer) return;

        // Size the upcoming-event ticker here too — this runs on every card render
        // path and on the debounced window resize.
        this._sizeUpcomingTicker(calendarGroup);

        const heightSetting = window.CalendarManager?.getHeight?.() || 'auto';

        let targetHeight;
        if (heightSetting === 'auto') {
            // Measure combined height of first 2 right-column groups + gap between them
            const columns = document.querySelectorAll('.groups-column');
            if (columns.length < 2) return;
            const col2 = columns[1];
            const col2Groups = col2.querySelectorAll('.app-group');
            if (col2Groups.length < 2) return;
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
        const calendarStyle = getComputedStyle(calendarGroup);
        const calendarHeader = calendarGroup.querySelector('.group-header');
        const headerHeight = calendarHeader ? calendarHeader.offsetHeight : 0;
        const paddingTop = parseFloat(calendarStyle.paddingTop) || 0;
        const paddingBottom = parseFloat(calendarStyle.paddingBottom) || 0;
        const borderTop = parseFloat(calendarStyle.borderTopWidth) || 0;
        const borderBottom = parseFloat(calendarStyle.borderBottomWidth) || 0;
        const overhead = headerHeight + paddingTop + paddingBottom + borderTop + borderBottom;

        const minH = heightSetting === 'auto' ? 150 : 60;
        const maxH = Math.max(minH, targetHeight - overhead);
        eventsContainer.style.maxHeight = maxH + 'px';
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
        const userMoved = prev != null
            && (this._calTlAnchoredTop == null || Math.abs(prev - this._calTlAnchoredTop) > 1);

        requestAnimationFrame(() => {
            const tl = document.querySelector('.calendar-group .calendar-timeline');
            if (!tl) return;
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
        const track = ticker.querySelector('.cal-upcoming-track');
        if (track) {
            const seqW = seqs[0].scrollWidth;
            track.style.setProperty('--cal-ticker-dur', Math.max(8, Math.round(seqW / 55)) + 's');
        }
    },

    // ========================================
    // EVENT DELEGATION - attached once, never re-attached
    // ========================================

    _attachDelegatedHandlers(container) {
        // Click delegation for cards, new-tab buttons
        container.addEventListener('click', (e) => {
            const newTabBtn = e.target.closest('.new-tab-btn');
            if (newTabBtn) {
                e.stopPropagation();
                const card = newTabBtn.closest('.website-card');
                const url = card?.getAttribute('data-url');
                const id = card?.getAttribute('data-id');
                if (id) WebsiteManager.trackOpen(id);
                if (url) {
                    if (!Utils.isSafeUrl(url)) {
                        UI.showToast('This link was blocked for safety.');
                        return;
                    }
                    window.open(url, '_blank');
                }
                return;
            }

            // Skip if clicking action buttons (handled by inline onclick)
            if (e.target.closest('.card-actions')) return;

            const card = e.target.closest('.website-card');
            if (!card) return;
            if (card._isDragging) return;

            const url = card.getAttribute('data-url');
            const id = card.getAttribute('data-id');
            if (id) WebsiteManager.trackOpen(id);
            if (url) {
                if (!Utils.isSafeUrl(url)) {
                    UI.showToast('This link was blocked for safety.');
                    return;
                }
                window.location.href = url;
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
                window.open(url, '_blank');
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
            if (e.target.closest('.card-actions') || e.target.closest('.new-tab-btn')) return;
            card._dragIntended = true;
        });

        container.addEventListener('mouseup', (e) => {
            const card = e.target.closest('.website-card');
            if (card) card._dragIntended = false;
        });

        container.addEventListener('dragstart', (e) => {
            const card = e.target.closest('.website-card');
            if (!card) return;
            if (e.target.closest('.card-actions') || e.target.closest('.new-tab-btn')) {
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
