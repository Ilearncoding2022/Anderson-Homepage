// ==========================================
// UI Renderer Module - Calendar (part 10.1 of the renderer family)
// Extends UIRenderer (scripts/10-renderer.js) with the calendar card
// and its event detail modal. Must load after 10-renderer.js.
// ==========================================

Object.assign(UIRenderer, {
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
        item.textContent = `${checked ? '✓ ' : ''}Set as secondary time zone column`;
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
        // "Set as secondary time zone column"). Null while the choice is unset, orphaned (no
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
        // Each gutter's corner carries its zone's short label — it is the one
        // place a time column identifies itself (the gutters show bare times).
        // The primary corner sat empty until v4.38 (user request: the primary
        // axis should name its zone the same way the secondary column does).
        const anchorTz = cm.getAnchorTimezone();
        const corner2 = tz2
            ? `<div class="cal-tl-corner cal-tl-corner2" aria-hidden="true" title="${Utils.sanitizeHTML(tz2)}">${Utils.sanitizeHTML(cm._tzLabel(tz2))}</div>`
            : '';
        const headers = corner2 + `<div class="cal-tl-corner cal-tl-corner1" aria-hidden="true" title="${Utils.sanitizeHTML(anchorTz)}">${Utils.sanitizeHTML(cm._tzLabel(anchorTz))}</div>`
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

        // "Next event" trace: a dotted line from the now-dial down to the next
        // upcoming TIMED event (never all-day — those have no point on the hour
        // axis), plus the countdown chip anchored to the dial's right end. Both
        // are computed off the SAME model this whole grid already shares, so
        // their positions can't drift from the dial or the event block they
        // aim at. Null trace (today not in the window, or no upcoming timed
        // event at all) renders neither. See CalendarManager.getTimelineTraceTarget.
        const trace = cm.getTimelineTraceTarget(model);
        const traceSegs = this._calendarTraceSegments(model, trace);
        const etaChip = this._calendarEtaChipHTML(model, trace, frac);

        const cols = model.days.map((d, di) => {
            const traceHere = traceSegs.filter(s => s.dayIdx === di).map(s =>
                `<div class="cal-tl-trace" aria-hidden="true" style="top:calc(var(--tl-gridh)*${frac(s.topPct)}); height:calc(var(--tl-gridh)*${frac(s.heightPct)})"></div>`
            ).join('');
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
            // is-in-event halves the bar (an event is running — the dial sits
            // inside its block, so the tall marker would just obscure it);
            // data-now-until carries the covering event's end so the 30s tick
            // can restore the tall state when it passes (model recomputes it,
            // so the value is always a computed finite number, but the reader
            // still coerces — same discipline as data-eta-target).
            const nowLine = d.nowTopPct != null
                ? `<div class="cal-tl-now${d.nowInEvent ? ' is-in-event' : ''}" style="top:calc(var(--tl-gridh)*${frac(d.nowTopPct)})"${d.nowInEvent && Number.isFinite(d.nowUntilMs) ? ` data-now-until="${d.nowUntilMs}"` : ''} aria-hidden="true"></div>` : '';
            // The chip only ever lands in today's column (it's anchored to the
            // dial), so it's cheap to gate here rather than threading di through
            // a second helper.
            const eta = (di === trace?.todayIdx) ? etaChip : '';
            return `
                <div class="cal-tl-col${d.day.isToday ? ' is-today' : ''}" style="grid-row:${hourRow}; grid-column:${di + (tz2 ? 3 : 2)}; height:var(--tl-gridh); ${lineBg}">
                    ${nowLine}${traceHere}${blocks || ''}${eta}
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

    // ---- Timeline "next event" trace + countdown ----------------------------
    // Turns a CalendarManager.getTimelineTraceTarget() result into the list of
    // per-column segments _calendarTimeline paints. Every value here is a
    // percentage in the SAME 0–100 space as nowTopPct/topPct/gaps — the model's
    // compressed (gap-collapsed) minute mapping — so 0% is always "top of any
    // day's column" and 100% "bottom of any day's column", regardless of which
    // day it is. That's what makes "full-height intermediate day" just
    // {topPct:0, heightPct:100} with no re-derivation.
    // Segments are pushed in temporal order (dial-outward: today, then
    // increasing day index) and _calendarTimeline renders columns in ascending
    // day-index order too, so the resulting DOM order already matches temporal
    // order — _wireCalendarTrace relies on that (via querySelectorAll order,
    // no separate index needed) to grow the line dial-first.
    _calendarTraceSegments(model, trace) {
        if (!trace) return [];
        // No trace while an event is running (or starting within the minute) —
        // same gate as the countdown chip in _calendarEtaChipHTML: the
        // half-height in-event dial state drops the whole "path to the next
        // event" projection, not just its label. The eta tick's re-renders
        // (start via the chip's 60s threshold, end via _tickCalendarNowState)
        // are what bring it back. _wireCalendarTrace already handles zero
        // segments (a null trace renders none either).
        if (model.days[trace.todayIdx].nowInEvent) return [];
        const nowTopPct = model.days[trace.todayIdx].nowTopPct;
        const segs = [];
        if (trace.kind === 'today') {
            segs.push({ dayIdx: trace.todayIdx, topPct: nowTopPct, heightPct: trace.topPct - nowTopPct });
        } else if (trace.kind === 'later') {
            segs.push({ dayIdx: trace.todayIdx, topPct: nowTopPct, heightPct: 100 - nowTopPct });
            for (let i = trace.todayIdx + 1; i < trace.dayIdx; i++) {
                segs.push({ dayIdx: i, topPct: 0, heightPct: 100 });
            }
            segs.push({ dayIdx: trace.dayIdx, topPct: 0, heightPct: trace.topPct });
        } else if (trace.kind === 'beyond') {
            segs.push({ dayIdx: trace.todayIdx, topPct: nowTopPct, heightPct: 100 - nowTopPct });
            for (let i = trace.todayIdx + 1; i < model.days.length; i++) {
                segs.push({ dayIdx: i, topPct: 0, heightPct: 100 });
            }
        }
        // Degenerate (≤0-height) segments — the target starting exactly on the
        // dial, or a single-day window with nothing after today — would give
        // the WAAPI wiring a zero-length clip-path range to divide by.
        return segs.filter(s => s.heightPct > 0.01);
    },

    // Countdown chip HTML: anchored at the dial's own top (right end only —
    // the left covers the running event's time text, documented). `data-eta-
    // target` carries the target's epoch ms for the live 30s tick in
    // _tickCalendarEta to read back with Number() (events data is untrusted,
    // so the value is coerced, never templated as a trusted number, and the
    // formatted text is still run through sanitizeHTML below even though
    // today's formatter only ever emits digits/':'/'min' — it's the one text
    // sink in this feature, so it stays defensive on principle).
    //
    // Normally aria-hidden: the upcoming-events ticker/bar already announces
    // this same "next event in…" information. But when that bar is off
    // (CalendarManager.getUpcomingBarCount() === 0) this chip is the ONLY
    // place the information exists at all, so in that case only it becomes a
    // real accessible note instead — _tickCalendarEta keeps the aria-label in
    // sync on every tick alongside the visible text.
    _calendarEtaChipHTML(model, trace, frac) {
        if (!trace) return '';
        // No chip while an event is running (or starting within the minute) —
        // the half-height dial state deliberately drops the countdown; the
        // ticker/bar still carries "next event in…" for screen readers, and
        // the onlySource case below is moot because there is nothing to say
        // mid-event that the running block isn't already saying.
        if (model.days[trace.todayIdx].nowInEvent) return '';
        const nowTopPct = model.days[trace.todayIdx].nowTopPct;
        const text = this._calEtaText(trace.startMs);
        if (!text) return '';
        const safeText = Utils.sanitizeHTML(text);
        const onlySource = (window.CalendarManager?.getUpcomingBarCount?.() ?? 0) === 0;
        const a11y = onlySource ? `role="note" aria-label="Next event in ${safeText}"` : `aria-hidden="true"`;
        return `<div class="cal-tl-eta" style="top:calc(var(--tl-gridh)*${frac(nowTopPct)})" data-eta-target="${trace.startMs}" ${a11y}>${safeText}</div>`;
    },

    // "42 min" under an hour, "4h25m" at/above it (2026-08-08 user request —
    // was "H:MM", which read as a clock time rather than a duration; minutes
    // are UNPADDED, matching the "#h#m" the change was specified as, and the
    // beyond-24h case just keeps counting hours: "117h0m").
    // Still deliberately NOT formatBarCountdown, even though the two now
    // agree on #h#m: that one prefixes "in ", rolls over to days ("in 3d4h")
    // and says "42m" under the hour where this says "42 min". Different
    // control, different audience — don't "unify" them.
    // Returns '' once the target has passed, AND on any non-finite input —
    // both callers rely on '' meaning "hide the chip", not a literal
    // "NaNhNaNm" string.
    _calEtaText(targetMs) {
        const mins = Math.ceil((targetMs - Date.now()) / 60000);
        if (!Number.isFinite(mins) || mins <= 0) return '';
        if (mins < 60) return `${mins} min`;
        const h = Math.floor(mins / 60), m = mins % 60;
        return `${h}h${m}m`;
    },

    // Grow-one-dot-at-a-time loop for the trace, via the Web Animations API.
    // CSS keyframes can't do this: the dot-by-dot look needs a `steps()` count
    // derived from each segment's MEASURED pixel length, and a global CSS
    // animation would be neutered by the `!important` reduced-motion killer in
    // styles/5-pomodoro.css long before that per-segment math could even run —
    // WAAPI bypasses that killer, so this checks prefers-reduced-motion itself
    // and renders a static, fully-drawn line instead of animating.
    //
    // Called after every render (from _applyTimelineScroll's rAF `finally`,
    // after _fitTimelineEventText and the scroll anchoring — this is
    // decoration and must never be able to break either of those), by a
    // ResizeObserver on .calendar-timeline for retunes that skip re-render
    // entirely (drag ticks / keyboard steps), and by a one-time
    // prefers-reduced-motion change listener (see _attachDelegatedHandlers).
    //
    // A signature (timeline element identity + segment count + rounded total
    // px + reduced-motion flag) short-circuits redundant re-wires: observe()
    // fires immediately on a freshly-observed element, so every render would
    // otherwise wire twice — once here, once a frame later from the RO's own
    // first callback — and during a card-height drag the RO fires every
    // frame, which without this restarts the "grow" phase every frame and
    // the line never finishes drawing for the length of the drag.
    _wireCalendarTrace() {
        const tl = document.querySelector('.calendar-group .calendar-timeline');
        if (!tl) {
            this._calTraceAnims?.forEach(a => { try { a.cancel(); } catch { /* already done */ } });
            this._calTraceAnims = null;
            this._calTraceSignature = null;
            // Card left timeline mode (or the DOM) entirely — nothing left to
            // observe for retunes until a render brings a timeline back.
            this._calTraceObserver?.disconnect();
            this._calTraceObserverEl = null;
            return;
        }

        this._ensureCalendarTraceObserver(tl);

        const segs = [...tl.querySelectorAll('.cal-tl-trace')];
        if (!segs.length) {
            this._calTraceAnims?.forEach(a => { try { a.cancel(); } catch { /* already done */ } });
            this._calTraceAnims = null;
            this._calTraceSignature = null;
            return;
        }

        const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        // Segment order matches DOM order (see _calendarTraceSegments), which
        // is what lets a single running total double as each segment's slice
        // of the shared cycle. Measured either way (even under reduced
        // motion) so a layout change while reduced still busts the signature.
        const lens = segs.map(el => el.getBoundingClientRect().height);
        const total = lens.reduce((a, b) => a + b, 0);

        const sig = { tl, count: segs.length, total: Math.round(total), reduced };
        const prev = this._calTraceSignature;
        const unchanged = prev && prev.tl === sig.tl && prev.count === sig.count
            && prev.total === sig.total && prev.reduced === sig.reduced;
        if (unchanged) return;
        this._calTraceSignature = sig;

        this._calTraceAnims?.forEach(a => { try { a.cancel(); } catch { /* already done */ } });
        this._calTraceAnims = null;

        if (reduced) return;   // cancel() above already reverts to no clip (fully drawn) — nothing left to set
        if (!(total > 0)) return;   // hidden / zero-height card mid-teardown

        const DOT_PITCH = 7;    // px — matches the background-position pitch in CSS
        const RATE = 90;        // px/sec of growth → ~1.5-2.5s for a typical trace
        const HOLD_MS = 1200;   // fully-drawn pause before the line clears and regrows
        const growMs = Math.max(400, (total / RATE) * 1000);
        const cycleMs = growMs + HOLD_MS;
        const holdFrac = HOLD_MS / cycleMs;

        let acc = 0;
        const start = document.timeline.currentTime;
        this._calTraceAnims = segs.map((el, i) => {
            const segStart = acc / total;
            acc += lens[i];
            const segEnd = acc / total;
            // This segment's slice of the cycle, squeezed into the growth
            // phase (everything before the shared hold) so every segment
            // finishes drawing in sequence, dial outward, before the hold.
            const growStart = segStart * (1 - holdFrac);
            const growEnd = segEnd * (1 - holdFrac);
            const steps = Math.max(1, Math.round(lens[i] / DOT_PITCH));
            const anim = el.animate([
                { clipPath: 'inset(0 0 100% 0)', offset: 0 },
                { clipPath: 'inset(0 0 100% 0)', offset: growStart, easing: `steps(${steps}, end)` },
                { clipPath: 'inset(0 0 0% 0)', offset: growEnd },
                { clipPath: 'inset(0 0 0% 0)', offset: 1 },
            ], { duration: cycleMs, iterations: Infinity });
            // Shared absolute origin — without this each segment's `animate()`
            // call starts its own clock the instant it's created, which is
            // close enough to look synced on a fast machine and visibly isn't
            // on a slow one.
            anim.startTime = start;
            return anim;
        });
    },

    // One ResizeObserver per (re-rendered) timeline element — a render replaces
    // the node wholesale, so this only needs to notice the element changed and
    // re-subscribe; it does not need to survive across renders itself.
    //
    // This does NOT observe --tl-gridh rewrites directly (a CSS custom
    // property change fires no ResizeObserver callback on its own) — it works
    // because _sizeTimelineHours only ever CHANGES that variable when
    // tl.clientHeight has already changed (drag ticks, keyboard steps, window
    // resize), which is exactly the box-size change this observes.
    _ensureCalendarTraceObserver(tl) {
        if (this._calTraceObserverEl === tl) return;
        this._calTraceObserver?.disconnect();
        this._calTraceObserverEl = tl;
        this._calTraceObserver = new ResizeObserver(() => {
            // Trailing debounce (~150ms), not per-frame: a card-height drag
            // fires this every frame, and the clip-path keyframes are
            // %-based so they stay correct throughout the drag regardless —
            // one re-wire once the drag settles is enough, and cheaper than
            // fighting the signature check every frame for no visible gain.
            clearTimeout(this._calTraceRoTimer);
            this._calTraceRoTimer = setTimeout(() => this._wireCalendarTrace(), 150);
        });
        this._calTraceObserver.observe(tl);
    },

    // Live-updates the countdown chip between renders — the card only
    // re-renders on the ~5-min fetch cycle or explicit navigation, and a
    // static chip reading stale minutes is exactly what an earlier version of
    // this control was removed for. Piggybacks a single interval created once
    // in _attachDelegatedHandlers. Absolute-time math (data-eta-target is the
    // target's epoch ms) means a throttled hidden tab self-corrects the moment
    // it's checked again rather than drifting.
    _tickCalendarEta() {
        const chip = document.querySelector('.calendar-group .cal-tl-eta');
        if (!chip) { this._tickCalendarNowState(); return; }
        const target = Number(chip.dataset.etaTarget);
        if (!Number.isFinite(target)) { chip.remove(); return; }   // malformed — nothing to keep showing
        // 60s, not 0: the in-event dial state (half bar, no chip) begins one
        // minute BEFORE the target starts — ">1 minute before the event" is
        // the tall state's spec — so the re-render below has to fire at that
        // boundary, not at the start itself. buildTimelineModel applies the
        // same 1-minute lead, so the re-render lands already in-event.
        if (target - Date.now() > 60000) {
            const text = this._calEtaText(target);
            chip.textContent = text;
            // Only present when this chip is the sole accessible source (see
            // _calendarEtaChipHTML) — keep it in sync with the visible text.
            if (chip.hasAttribute('aria-label')) chip.setAttribute('aria-label', `Next event in ${text}`);
            return;
        }

        // Expired (or inside the final minute): one lightweight re-render so
        // the dial takes its in-event state and the line + chip retarget the
        // event that follows, without a refetch. A drag replaces the exact
        // DOM the pointer is captured on — defer like every other scoped
        // calendar re-render does (renderCalendarCard/renderTodoCard) rather
        // than racing it; this timer is the one caller of a scoped re-render
        // that isn't itself gesture-driven, so it's the one that needs to ask.
        if (this._cardDragActive()) { this._deferCardRender('__calendar__'); return; }

        // Guard against looping if the model still resolves to this same (or
        // another already-imminent) target — hide the chip and wait for the
        // next real render instead of re-rendering every tick. The <= 60000
        // mirrors the lead above: a same-day imminent target never re-renders
        // a chip (nowInEvent suppresses it), but a target on a LATER day
        // within the minute — now straddling midnight — can, and would
        // otherwise re-render every 30s until it passed.
        this.refreshCalendarDayView();
        const after = document.querySelector('.calendar-group .cal-tl-eta');
        if (after) {
            const afterTarget = Number(after.dataset.etaTarget);
            if (!Number.isFinite(afterTarget) || afterTarget <= target || afterTarget - Date.now() <= 60000) after.remove();
        }
    },

    // The mirror transition: an event ENDS. No chip exists mid-event (the
    // in-event dial state suppresses it), so the eta tick above has nothing
    // to watch — instead the dial carries data-now-until (the covering
    // event's end, stamped by _calendarTimeline) and this re-renders once it
    // passes, restoring the tall dial + countdown chip. No loop guard needed:
    // containment is strict (nowMin < endMin in buildTimelineModel), so a
    // passed `until` can never re-produce the same in-event record.
    _tickCalendarNowState() {
        const dial = document.querySelector('.calendar-group .cal-tl-now.is-in-event');
        if (!dial) return;
        const until = Number(dial.dataset.nowUntil);
        if (!Number.isFinite(until) || until - Date.now() > 0) return;
        if (this._cardDragActive()) { this._deferCardRender('__calendar__'); return; }
        this.refreshCalendarDayView();
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
});
