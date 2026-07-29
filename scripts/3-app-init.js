// ==========================================
// 3-APP-INIT.JS - Application Bootstrap
// Anderson Homepage v3.0
//
// Contents:
// - App (main controller & initialization)
// - Global exports (window.*)
// - DOMContentLoaded listener
// ==========================================

// ========================================
// MAIN APPLICATION CONTROLLER
// ========================================

const App = {
    _clockIntervalId: null,

    // Stamps APP_VERSION / APP_RELEASE_DATE into the three places they surface,
    // so a release only ever edits the constants in 1-core-managers.js. Uses
    // textContent throughout, except the menu item below — its icon is a
    // sprite reference, which only innerHTML can render. APP_VERSION is a
    // trusted build-time constant, never user input, so that's safe here.
    applyVersionStamp() {
        document.title = `Anderson Homepage ${APP_VERSION} (${APP_RELEASE_DATE})`;

        const menuItem = document.getElementById('changelogBtn');
        if (menuItem) menuItem.innerHTML =
            `<svg class="ico" aria-hidden="true"><use href="#ico-clipboard"></use></svg> What's new (${APP_VERSION})`;

        const meta = document.querySelector('.changelog-meta');
        if (meta) meta.textContent = `Anderson Homepage ${APP_VERSION} · ${APP_RELEASE_DATE}`;
    },

    init() {
        this.applyVersionStamp();

        Storage.load();
        Theme.load();
        Background.load();

        WebsiteManager.ensurePositions();

        // Apply card font settings before first paint so sizes/family are correct
        // from the start (the controls live in the Settings modal's tabs).
        if (window.FontManager) FontManager.initialize();

        if (window.TodoManager) TodoManager.initialize();

        if (window.UIRenderer) {
            UIRenderer.render();
        }

        // Icons live in IndexedDB now; load them onto the cards just after the
        // first (icon-less) paint so they don't delay it. Also migrates any
        // legacy inline icons out of localStorage.
        if (window.WebsiteManager) WebsiteManager.hydrateIcons();

        this.attachEventListeners();
        this.initClock();
        this._wireGlobalShortcuts();

        if (window.StorageMeter) StorageMeter.start();

        if (AppState.currentView === 'list') {
            ViewManager.setListView();
        }

        this.initIconSizeSlider();

        // Initialize Pomodoro timer module
        if (window.PomodoroApp) {
            PomodoroApp.init();
        } else {
            setTimeout(() => {
                if (window.PomodoroApp) PomodoroApp.init();
            }, 500);
        }

        // Initialize Calendar module
        if (window.CalendarManager) {
            CalendarManager.initialize();
            this._initCalendarSettings();
        } else {
            setTimeout(() => {
                if (window.CalendarManager) {
                    CalendarManager.initialize();
                    this._initCalendarSettings();
                }
            }, 500);
        }

        // Baseline fill for every slider in the static markup, now that their
        // values have been restored above. (paintRangeFill is defined in
        // attachEventListeners, which ran earlier in init.)
        document.querySelectorAll('input[type="range"]').forEach((el) => window.paintRangeFill?.(el));
    },

    _initCalendarSettings() {
        const proxyUrlInput = document.getElementById('calendarProxyUrl');
        const tokenInput = document.getElementById('calendarProxyToken');
        const daysAheadSelect = document.getElementById('calendarDaysAhead');
        const refreshSelect = document.getElementById('calendarRefreshInterval');
        const heightSlider = document.getElementById('calendarHeight');
        const heightLabel = document.getElementById('calendarHeightLabel');
        const cdPlacementSelect = document.getElementById('calendarCountdownPlacement');
        const cdWindowSelect = document.getElementById('calendarCountdownWindow');
        const cdWarnInput = document.getElementById('calendarCountdownWarnMins');
        const cdUrgentInput = document.getElementById('calendarCountdownUrgentMins');
        const barCountSelect = document.getElementById('calendarUpcomingBarCount');
        const barFormatSelect = document.getElementById('calendarUpcomingBarFormat');
        const addBtn = document.getElementById('addCalendarBtn');

        if (proxyUrlInput) proxyUrlInput.value = CalendarManager.getProxyUrl();
        if (tokenInput) tokenInput.value = CalendarManager.getProxyToken();
        if (daysAheadSelect) daysAheadSelect.value = String(CalendarManager.getDaysAhead());
        if (refreshSelect) refreshSelect.value = String(CalendarManager.getRefreshInterval());
        if (cdPlacementSelect) cdPlacementSelect.value = CalendarManager.getCountdownPlacement();
        if (cdWindowSelect) cdWindowSelect.value = CalendarManager.getCountdownWindow();
        if (cdWarnInput) cdWarnInput.value = String(CalendarManager.getCountdownWarnMins());
        if (cdUrgentInput) cdUrgentInput.value = String(CalendarManager.getCountdownUrgentMins());
        if (barCountSelect) barCountSelect.value = String(CalendarManager.getUpcomingBarCount());
        if (barFormatSelect) barFormatSelect.value = CalendarManager.getUpcomingBarFormat();

        // Card height slider: leftmost stop (0.5) represents 'auto'
        const heightVal = CalendarManager.getHeight();
        if (heightSlider) heightSlider.value = heightVal === 'auto' ? '0.5' : heightVal;
        if (heightLabel) heightLabel.textContent = heightVal === 'auto' ? 'Auto' : `${heightVal}×`;
        if (heightSlider) window.paintRangeFill?.(heightSlider);

        // Render existing calendar sources
        this._renderCalendarSources();

        // Debounced fetch after any settings change
        let calFetchDebounce = null;
        const debouncedCalendarFetch = () => {
            clearTimeout(calFetchDebounce);
            calFetchDebounce = setTimeout(() => CalendarManager.fetchEvents(), 500);
        };

        proxyUrlInput?.addEventListener('change', (e) => {
            CalendarManager.setProxyUrl(e.target.value.trim());
            debouncedCalendarFetch();
        });
        tokenInput?.addEventListener('change', (e) => {
            CalendarManager.setProxyToken(e.target.value.trim());
            debouncedCalendarFetch();
        });
        daysAheadSelect?.addEventListener('change', (e) => {
            CalendarManager.setDaysAhead(parseInt(e.target.value, 10));
            // Scoped: only the calendar card needs to reflect the new range.
            if (window.UIRenderer) { UIRenderer.renderCalendarCard(); UIRenderer.matchCalendarHeight(); }
        });
        refreshSelect?.addEventListener('change', (e) => {
            CalendarManager.setRefreshInterval(parseInt(e.target.value, 10));
        });

        const rerenderCalendar = () => {
            if (window.UIRenderer) { UIRenderer.renderCalendarCard(); UIRenderer.matchCalendarHeight(); }
        };
        cdPlacementSelect?.addEventListener('change', (e) => {
            CalendarManager.setCountdownPlacement(e.target.value);
            rerenderCalendar();
        });
        cdWindowSelect?.addEventListener('change', (e) => {
            CalendarManager.setCountdownWindow(e.target.value);
            rerenderCalendar();
        });
        // Clamp threshold inputs to 1–180 and reflect the stored value back into the field.
        cdWarnInput?.addEventListener('change', (e) => {
            CalendarManager.setCountdownWarnMins(e.target.value);
            e.target.value = String(CalendarManager.getCountdownWarnMins());
            rerenderCalendar();
        });
        cdUrgentInput?.addEventListener('change', (e) => {
            CalendarManager.setCountdownUrgentMins(e.target.value);
            e.target.value = String(CalendarManager.getCountdownUrgentMins());
            rerenderCalendar();
        });
        barCountSelect?.addEventListener('change', (e) => {
            CalendarManager.setUpcomingBarCount(parseInt(e.target.value, 10));
            rerenderCalendar();
        });
        barFormatSelect?.addEventListener('change', (e) => {
            CalendarManager.setUpcomingBarFormat(e.target.value);
            rerenderCalendar();
        });
        heightSlider?.addEventListener('input', (e) => {
            const raw = parseFloat(e.target.value);
            const val = raw < 1 ? 'auto' : String(raw); // below 1× = Auto
            CalendarManager.setHeight(val);
            if (heightLabel) heightLabel.textContent = val === 'auto' ? 'Auto' : `${val}×`;
            // A height dragged onto the card outranks this slider, so the slider
            // would look dead while one is set — moving it takes control back.
            if (window.UIRenderer) {
                UIRenderer._setCardLayout('__calendar__', { height: null });
                UIRenderer.matchCalendarHeight();
            }
        });

        // Add calendar button
        addBtn?.addEventListener('click', () => {
            const colors = CalendarManager.config.calendarColors;
            const calendars = CalendarManager.getCalendars();
            const nextColor = colors[calendars.length % colors.length].value;
            CalendarManager.addCalendar('', nextColor, '');
            this._renderCalendarSources();
        });

        // Delegate change/click events on calendar sources list
        const list = document.getElementById('calendarSourcesList');
        list?.addEventListener('change', (e) => {
            const entry = e.target.closest('.calendar-source-entry');
            if (!entry) return;
            const idx = parseInt(entry.dataset.index, 10);
            const name = entry.querySelector('.cal-src-name')?.value?.trim() || '';
            const color = entry.querySelector('.cal-src-color')?.value || '';
            const url = entry.querySelector('.cal-src-url')?.value?.trim() || '';
            // Update swatch color live
            const swatch = entry.querySelector('.cal-src-swatch');
            if (swatch) swatch.style.background = color;
            // Warn if embed URL format is used instead of ICS
            const urlInput = entry.querySelector('.cal-src-url');
            const warning = entry.querySelector('.cal-src-embed-warning');
            if (CalendarManager.isEmbedUrl(url)) {
                if (!warning) {
                    urlInput.insertAdjacentHTML('afterend',
                        '<div class="cal-src-embed-warning"><svg class="ico" aria-hidden="true"><use href="#ico-alert"></use></svg> Embed URLs are not supported. Use the ICS URL from Google Calendar Settings → calendar → "Public address in iCal format"</div>');
                }
                return; // Don't save or fetch with embed URL
            } else if (warning) {
                warning.remove();
            }
            CalendarManager.updateCalendar(idx, name, color, url);
            debouncedCalendarFetch();
        });
        list?.addEventListener('click', (e) => {
            if (e.target.closest('.cal-src-remove')) {
                const entry = e.target.closest('.calendar-source-entry');
                if (!entry) return;
                const idx = parseInt(entry.dataset.index, 10);
                CalendarManager.removeCalendar(idx);
                this._renderCalendarSources();
                debouncedCalendarFetch();
            }
        });
    },

    _renderCalendarSources() {
        const list = document.getElementById('calendarSourcesList');
        if (!list) return;
        const calendars = CalendarManager.getCalendars();
        const colors = CalendarManager.config.calendarColors;

        const colorOptions = colors.map(c =>
            `<option value="${c.value}">${c.name}</option>`
        ).join('');

        list.innerHTML = calendars.map((cal, i) => `
            <div class="calendar-source-entry" data-index="${i}">
                <div class="cal-src-row">
                    <input type="text" class="cal-src-name" value="${Utils.sanitizeHTML(cal.name)}" placeholder="Calendar name">
                    <div class="cal-src-color-group">
                        <span class="cal-src-swatch" style="background: ${Utils.isValidColor(cal.color) ? cal.color : 'transparent'};"></span>
                        <select class="cal-src-color">
                            ${colors.map(c =>
                                `<option value="${c.value}" ${c.value === cal.color ? 'selected' : ''}>${c.name}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <button type="button" class="cal-src-remove" title="Remove">×</button>
                </div>
                <input type="url" class="cal-src-url" value="${Utils.sanitizeHTML(cal.url)}" placeholder="https://calendar.google.com/calendar/ical/.../basic.ics">
            </div>
        `).join('');
    },

    initIconSizeSlider() {
        const sizeSlider = document.getElementById('sizeSlider');
        const sizeLabel = document.getElementById('sizeLabel');

        if (sizeSlider) {
            sizeSlider.value = AppState.iconSize;
            window.paintRangeFill?.(sizeSlider);
        }

        if (sizeLabel) {
            sizeLabel.textContent = `${AppState.iconSize}px`;
        }
    },

    // Cached timezone values (avoid reading localStorage every second)
    _cachedTimezones: {
        tz1: null,
        tz2: null,
        tz3: null
    },

    _loadTimezones() {
        this._cachedTimezones.tz1 = localStorage.getItem('timezone1') || 'local';
        this._cachedTimezones.tz2 = localStorage.getItem('timezone2') || 'UTC';
        this._cachedTimezones.tz3 = localStorage.getItem('timezone3') || 'none';
    },

    // Current GMT offset for a stored clock value ('local'/'UTC'/IANA id), e.g.
    // "GMT+7" or "GMT-5". Returns '' for the disabled sentinel or an invalid zone.
    // Uses 'shortOffset' so the number is DST-accurate at the moment settings open.
    _gmtOffset(value) {
        if (!value || value === 'none') return '';
        const tz = value === 'local'
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : value;
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: tz, timeZoneName: 'shortOffset'
            }).formatToParts(new Date());
            let name = parts.find(p => p.type === 'timeZoneName')?.value || '';
            if (name === 'GMT') name = 'GMT+0';   // UTC and friends report bare "GMT"
            return name;
        } catch (_) {
            return '';
        }
    },

    // Append the live "(GMT±N)" offset to every option in the three clock selects.
    // The pristine label is cached on the option once (dataset.base) so repeated
    // calls — e.g. each time Settings opens under a new DST state — don't stack.
    annotateTimezoneOffsets() {
        document.querySelectorAll('.timezone-select').forEach(sel => {
            Array.from(sel.options).forEach(opt => {
                if (opt.dataset.base === undefined) opt.dataset.base = opt.textContent;
                const off = this._gmtOffset(opt.value);
                opt.textContent = off ? `${opt.dataset.base} · ${off}` : opt.dataset.base;
            });
        });
    },

    // ---- Clock slot reordering (Settings → Appearance → Clocks) ----
    //
    // Everything downstream of a clock — the header clocks, the 1/2/3 grouping
    // shortcuts, CalendarManager._resolveZone, the custom labels — is keyed by
    // slot number, so "make this clock #1" is purely a matter of moving the
    // stored (zone, label) pairs between slots. The three Settings rows keep
    // their fixed #1/#2/#3 labels and never move; only the values do.

    _clockDefaults: { 1: 'local', 2: 'UTC', 3: 'none' },

    _readClockSlots() {
        return [1, 2, 3].map(slot => ({
            slot,
            tz: localStorage.getItem('timezone' + slot) || this._clockDefaults[slot],
            label: localStorage.getItem('timezone' + slot + 'Label') || ''
        }));
    },

    // Push the stored slot values back into the Settings controls, and refresh
    // which grips are usable. Shared by openSettings() and every reorder.
    _syncClockInputs() {
        this._readClockSlots().forEach(({ slot, tz, label }) => {
            const select = document.getElementById('timezone' + slot);
            if (select) select.value = tz;
            const input = document.getElementById('timezone' + slot + 'Label');
            if (input) input.value = label;
            const grip = document.querySelector(`.clock-drag-handle[data-clock-slot="${slot}"]`);
            if (grip) {
                grip.disabled = tz === 'none';
                grip.title = grip.disabled
                    ? 'Give this clock a time zone to reorder it'
                    : 'Drag to reorder (or use ↑/↓ keys)';
            }
        });
    },

    // Move the clock values into a new slot order. `order` lists the source slot
    // numbers top to bottom — [3, 1, 2] puts clock #3's zone and label in slot
    // #1. Returns true if anything actually moved.
    _applyClockOrder(order) {
        const bySlot = new Map(this._readClockSlots().map(c => [c.slot, c]));
        let next = order.map(s => bySlot.get(s)).filter(Boolean);
        if (next.length !== bySlot.size) return false;

        // Only slot #3 offers "Disabled", and updateClock() only knows how to
        // hide clock 3 — so a disabled clock sinks to the bottom wherever it was
        // dropped, and the clocks that do have a zone keep their new order.
        next = [...next.filter(c => c.tz !== 'none'), ...next.filter(c => c.tz === 'none')];
        if (next.every((c, i) => c.slot === i + 1)) return false;

        // Calendar grouping is stored per slot ('tz1'|'tz2'|'tz3'), so follow the
        // zone to its new slot — otherwise reordering would silently regroup the
        // calendar by whichever zone landed in the old slot.
        const cm = window.CalendarManager;
        const grouping = cm?.getGrouping?.();
        let newGrouping = null;
        if (grouping && grouping !== 'none') {
            const from = Number(grouping.slice(2));
            const to = next.findIndex(c => c.slot === from) + 1;
            if (to > 0 && to !== from) newGrouping = 'tz' + to;
        }

        next.forEach((c, i) => {
            Utils.safeLocalStorageSet('timezone' + (i + 1), c.tz);
            Utils.safeLocalStorageSet('timezone' + (i + 1) + 'Label', c.label);
        });

        this._syncClockInputs();
        this._loadTimezones();
        this.updateClock();
        // setGrouping re-renders the calendar card itself; without it the card
        // still needs a repaint for the reordered per-event zone rows.
        if (newGrouping) cm.setGrouping(newGrouping);
        else if (window.UIRenderer) UIRenderer.renderCalendarCard();
        return true;
    },

    _disarmClockDrag() {
        if (this._clockArmedDrag) {
            this._clockArmedDrag.removeAttribute('draggable');
            this._clockArmedDrag = null;
        }
    },

    // Rows live in slot order at rest; dragover shuffles them for live feedback,
    // so put them back before the values move into their new slots.
    _restoreClockRowOrder(container) {
        [...container.querySelectorAll(':scope > .clock-row')]
            .sort((a, b) => Number(a.dataset.clockSlot) - Number(b.dataset.clockSlot))
            .forEach(row => container.appendChild(row));
    },

    // Wire the grips: HTML5 drag (armed only while a grip is held, so the row's
    // select and text input stay usable) plus ↑/↓ on a focused grip. Same idiom
    // as the To-Do list's reorder handles.
    _wireClockReorder() {
        const container = document.getElementById('clockRows');
        if (!container) return;
        const rows = () => [...container.querySelectorAll(':scope > .clock-row')];

        container.addEventListener('mousedown', (e) => {
            const handle = e.target.closest('.clock-drag-handle');
            if (!handle || handle.disabled) return;
            const row = handle.closest('.clock-row');
            if (!row) return;
            row.setAttribute('draggable', 'true');
            this._clockArmedDrag = row;
        });
        document.addEventListener('mouseup', () => this._disarmClockDrag());

        container.addEventListener('dragstart', (e) => {
            const row = this._clockArmedDrag;
            if (!row || e.target !== row) return;
            this._clockDragRow = row;
            row.classList.add('clock-dragging');
            e.dataTransfer.effectAllowed = 'move';
            // Firefox needs data set for a drag to start.
            try { e.dataTransfer.setData('text/plain', row.dataset.clockSlot || ''); } catch (_) {}
        });

        container.addEventListener('dragover', (e) => {
            const row = this._clockDragRow;
            if (!row) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const after = rows().find(r => {
                if (r === row) return false;
                const box = r.getBoundingClientRect();
                return e.clientY < box.top + box.height / 2;
            });
            if (after) container.insertBefore(row, after);
            else container.appendChild(row);
        });

        // Allow drop without the browser's "snap-back" animation.
        container.addEventListener('drop', (e) => {
            if (this._clockDragRow) e.preventDefault();
        });

        container.addEventListener('dragend', () => {
            const row = this._clockDragRow;
            this._clockDragRow = null;
            this._disarmClockDrag();
            if (!row) return;
            row.classList.remove('clock-dragging');
            const order = rows().map(r => Number(r.dataset.clockSlot));
            this._restoreClockRowOrder(container);
            this._applyClockOrder(order);
        });

        // Keyboard reordering: focus a grip and press ↑/↓.
        container.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            const handle = e.target.closest('.clock-drag-handle');
            if (!handle || handle.disabled) return;
            e.preventDefault();
            const from = Number(handle.dataset.clockSlot);
            const to = from + (e.key === 'ArrowUp' ? -1 : 1);
            if (to < 1 || to > 3) return;
            const order = [1, 2, 3];
            [order[from - 1], order[to - 1]] = [order[to - 1], order[from - 1]];
            // The rows don't move, so follow the clock the user is carrying to
            // the grip of the slot it landed in.
            if (this._applyClockOrder(order)) {
                container.querySelector(`.clock-drag-handle[data-clock-slot="${to}"]`)?.focus();
            }
        });
    },

    initClock() {
        // Guard: clear any existing clock interval before creating a new one so a
        // second call (e.g. from test code) can't accumulate duplicate timers.
        if (this._clockIntervalId) {
            clearInterval(this._clockIntervalId);
            this._clockIntervalId = null;
        }
        this._loadTimezones();
        this.updateClock();
        this._wireClockGroupingClicks();
        this._clockIntervalId = setInterval(() => this.updateClock(), 1000);
    },

    // Clicking (or pressing Enter/Space on) a header clock groups the calendar by
    // that clock's zone — the same choice as Settings → Calendar grouping. This
    // also lights that clock with the ROYGBIV highlight via setGrouping(). Wired
    // once, delegated on .header-center so it survives clock3 showing/hiding and
    // the per-second innerHTML rebuilds of each clock's contents.
    _wireClockGroupingClicks() {
        const center = document.querySelector('.header-center');
        if (!center || this._clockClicksWired) return;
        this._clockClicksWired = true;

        const idToMode = { clock: 'tz1', clock2: 'tz2', clock3: 'tz3' };
        const activate = (target) => {
            const clockEl = target?.closest?.('.digital-clock');
            if (!clockEl || !center.contains(clockEl)) return;
            const mode = idToMode[clockEl.id];
            if (!mode) return;
            this._activateClockGrouping(mode);
        };

        center.addEventListener('click', (e) => activate(e.target));
        center.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
            const clockEl = e.target?.closest?.('.digital-clock');
            if (!clockEl || !center.contains(clockEl)) return;
            e.preventDefault();   // Space would otherwise scroll the page
            e.stopPropagation();  // keep Space from also toggling the pomodoro timer
            activate(e.target);
        });
    },

    // Is the calendar's "Today & Now" action available right now? The button only
    // renders for a configured calendar in a non-list view, so its presence is the
    // single source of truth — the shortcuts below can't outlive the button.
    _todayNowAvailable() {
        return !!document.querySelector('.cal-header-today');
    },

    // Run the "Today & Now" action, reporting whether it applied.
    _jumpToTodayNow() {
        if (!this._todayNowAvailable() || !window.UIRenderer) return false;
        UIRenderer.jumpToTodayView();
        return true;
    },

    // Group the calendar by clock slot 'tz1'|'tz2'|'tz3'. Shared by the clock
    // click/Enter/Space delegate above and the 1/2/3 shortcuts so both paths
    // behave identically.
    _activateClockGrouping(mode) {
        const cm = window.CalendarManager;
        if (!cm) return;
        if (mode === 'tz3' && this._cachedTimezones.tz3 === 'none') return;

        // Re-selecting the clock that's already grouping the calendar has nothing
        // to change, so it acts as "Today & Now" for that zone instead. Compared by
        // resolved zone, not by slot: two clocks set to the same zone are one
        // selection as far as the highlight (and the grouping menu) is concerned.
        const zone = cm._resolveZone?.(`timezone${mode.slice(2)}`);
        if (zone && zone === cm.getGroupingTimezone?.() && this._jumpToTodayNow()) return;

        // In a non-list view with the timeline on and today already inside the
        // visible day range, re-anchor the timeline on the now-line as part of
        // the grouping change — without moving the date window. The flag is
        // consumed by _applyTimelineScroll during the setGrouping re-render; if
        // "now" isn't in the rendered window it's a harmless no-op.
        try {
            const nonList = (cm.getViewMode?.() || 'list') !== 'list';
            const timeline = !!cm.getTimelineMode?.();
            const todayInRange = (cm.getDayViewWindow?.().days || []).some(d => d.isToday);
            if (nonList && timeline && todayInRange && window.UIRenderer) {
                window.UIRenderer._calTlForceNow = true;
            }
        } catch { /* scroll assist is best-effort; grouping change still applies */ }

        cm.setGrouping(mode);
    },

    // Global shortcuts: 1/2/3 pick the main clock (calendar grouping + rainbow
    // highlight) when focus isn't on a control; / and Ctrl/Cmd+K focus search.
    _wireGlobalShortcuts() {
        if (this._globalShortcutsWired) return;
        this._globalShortcutsWired = true;

        document.addEventListener('keydown', (e) => {
            // Let an open modal own the keyboard (same guard as the pomodoro keys).
            if (document.querySelector('.modal.show')) return;

            const searchInput = document.getElementById('searchInput');

            // Ctrl/Cmd+K focuses search from anywhere, including other inputs.
            // e.code so it works on non-Latin keyboard layouts too.
            if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyK') {
                e.preventDefault();   // browsers bind Ctrl+K to the address bar
                searchInput?.focus();
                searchInput?.select();
                return;
            }

            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.target?.matches?.('input, textarea, select, [contenteditable]')) return;
            // Not while a button has focus — except the clocks themselves
            // (role=button), where Enter/Space already changes grouping.
            if (e.target.closest?.('button, [role="button"]') && !e.target.closest?.('.digital-clock')) return;

            if (e.key === '/') {
                e.preventDefault();   // Firefox binds / to quick-find
                searchInput?.focus();
                return;
            }

            // Enter is the shortcut for the calendar's "Today & Now" button, but
            // only when nothing focusable owns it — a focused link or event row
            // should still activate itself.
            if (e.key === 'Enter') {
                if (e.target.closest?.('a, [tabindex], [data-cal-event]')) return;
                if (this._jumpToTodayNow()) e.preventDefault();
                return;
            }

            const keyToMode = { '1': 'tz1', '2': 'tz2', '3': 'tz3' };
            const mode = keyToMode[e.key];
            if (!mode) return;
            this._activateClockGrouping(mode);   // no-ops when tz3 is disabled
        });
    },

    updateClock() {
        const timezone1 = this._cachedTimezones.tz1;
        const timezone2 = this._cachedTimezones.tz2;
        const timezone3 = this._cachedTimezones.tz3;

        this.updateClockDisplay('clock', timezone1, 'timezone1');
        this.updateClockDisplay('clock2', timezone2, 'timezone2');

        const clock3El = document.getElementById('clock3');
        if (clock3El) {
            if (timezone3 === 'none') {
                clock3El.style.display = 'none';
            } else {
                clock3El.style.display = '';
                this.updateClockDisplay('clock3', timezone3, 'timezone3');
            }
            // A third clock widens the centre column by ~190px, which is width the
            // usage widget's title/countdowns can no longer have. CSS can't see an
            // inline display:none, so mirror the state onto the header as a class
            // (see the .header.has-three-clocks rules in 2-components.css).
            document.querySelector('.header')
                ?.classList.toggle('has-three-clocks', timezone3 !== 'none');
        }

        this._applyClockGroupingHighlight();
    },

    // Give the header clock whose zone is the calendar's active grouping zone a
    // slowly rotating ROYGBIV colour (CSS handles the animation). Grouping 'none'
    // clears it. getGrouping() normalises to the first clock resolving to the
    // grouped zone, so exactly one clock is ever highlighted. Called each tick, so
    // a grouping change picks up within a second; toggle() is a no-op when the
    // class is already in the desired state, so it never restarts the animation.
    _applyClockGroupingHighlight() {
        const modeToId = { tz1: 'clock', tz2: 'clock2', tz3: 'clock3' };
        const grouping = window.CalendarManager?.getGrouping?.();
        const activeId = (grouping && grouping !== 'none') ? modeToId[grouping] : null;
        ['clock', 'clock2', 'clock3'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.toggle('clock-rainbow', id === activeId);
            el.setAttribute('aria-pressed', String(id === activeId));
        });
    },

    updateClockDisplay(elementId, timezone, slotKey) {
        const clockElement = document.getElementById(elementId);
        if (!clockElement) return;

        const now = new Date();

        let options = {};
        let timezoneName = timezone;

        if (timezone === 'local') {
            options = { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
            timezoneName = 'Local Time';
        } else {
            options = { timeZone: timezone };
            // Handle both "UTC" and "America/New_York" formats
            const parts = timezone.split('/');
            timezoneName = parts[parts.length - 1].replace(/_/g, ' ');
        }

        // A user-supplied custom label (Settings → Clocks) overrides the derived
        // name here and everywhere else the zone is shown (e.g. calendar rows).
        const customLabel = slotKey
            ? (localStorage.getItem(slotKey + 'Label') || '').trim()
            : '';
        if (customLabel) timezoneName = customLabel;

        const dateStr = now.toLocaleDateString('en-US', {
            ...options, weekday: 'short', month: 'short', day: 'numeric'
        });

        const timeStr = now.toLocaleTimeString('en-US', {
            ...options, hour: '2-digit', minute: '2-digit', hour12: false
        });

        // City and time share one baseline row (.clock-headline) now that size
        // no longer carries their hierarchy — see 2-components.css. The date
        // drops to its own small line below rather than sitting beside the time.
        clockElement.innerHTML = `
            <div class="clock-headline">
                <span class="clock-city">${Utils.sanitizeHTML(timezoneName)}</span>
                <span class="clock-time">${timeStr}</span>
            </div>
            <div class="clock-date">${dateStr}</div>
        `;
    },

    attachEventListeners() {
        // Paint the filled portion of range sliders up to the thumb. WebKit reads
        // the resulting --fill in its track gradient; Firefox uses the native
        // ::-moz-range-progress pseudo and ignores it. Delegated so it covers every
        // range input, present or added later; callers repaint on programmatic sets.
        window.paintRangeFill = (el) => {
            if (!el || el.type !== 'range') return;
            const min = parseFloat(el.min) || 0;
            const max = parseFloat(el.max);
            const val = parseFloat(el.value);
            const pct = (max > min) ? ((val - min) / (max - min)) * 100 : 0;
            el.style.setProperty('--fill', Math.max(0, Math.min(100, pct)) + '%');
        };
        document.addEventListener('input', (e) => {
            if (e.target && e.target.type === 'range') window.paintRangeFill(e.target);
        });

        document.getElementById('themeToggle')?.addEventListener('click', Theme.toggle);

        const searchForm = document.getElementById('searchForm');
        if (searchForm) {
            searchForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const query = document.getElementById('searchInput')?.value.trim();
                if (query) {
                    window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                }
            });
        }

        // Live client-side filter: as the user types, dim/hide website cards and
        // groups that don't match; Escape clears the filter. Does NOT rebuild DOM —
        // toggles .filtered-hidden / .filtered-dim on existing nodes only.
        this._attachSearchFilter();

        const hamburgerBtn = document.getElementById('hamburgerBtn');
        if (hamburgerBtn) {
            hamburgerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMenu();
            });
        }

        document.addEventListener('click', (e) => {
            const menu = document.getElementById('dropdownMenu');
            const hamburger = document.getElementById('hamburgerBtn');
            if (menu && hamburger && !menu.contains(e.target) && !hamburger.contains(e.target)) {
                menu.classList.remove('show');
            }
        });

        document.getElementById('addWebsiteBtn')?.addEventListener('click', () => {
            if (window.AppModal) AppModal.openAdd();
            this.closeMenu();
        });
        document.getElementById('addGroupBtn')?.addEventListener('click', () => {
            if (window.GroupModal) GroupModal.openAdd();
            this.closeMenu();
        });
        document.getElementById('settingsBtn')?.addEventListener('click', () => {
            this.openSettings();
            this.closeMenu();
        });
        document.getElementById('closeSettings')?.addEventListener('click', () => this.closeSettings());

        // Changelog modal (opened from "What's new" in the dropdown menu)
        document.getElementById('changelogBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openChangelog();
        });
        document.getElementById('closeChangelog')?.addEventListener('click', () => this.closeChangelog());
        const changelogModal = document.getElementById('changelogModal');
        if (changelogModal) {
            changelogModal.addEventListener('click', (e) => {
                if (e.target === changelogModal) this.closeChangelog();
            });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && changelogModal?.classList.contains('show')) this.closeChangelog();
        });

        const settingsModal = document.getElementById('settingsModal');
        if (settingsModal) {
            settingsModal.addEventListener('click', (e) => {
                if (e.target === settingsModal) this.closeSettings();
            });
        }

        // Note: the To-Do archive modal's close/backdrop/Escape handling lives in
        // ui-renderer.js (UIRenderer._attachTodoHandlers), alongside the code that
        // opens it, so it shares the same lifecycle and never depends on this file.

        // Settings tab switching (Appearance / Calendar / To-Do / Pomodoro / Projects / Data)
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;
                document.querySelectorAll('.settings-tab').forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });
                document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                tab.setAttribute('aria-selected', 'true');
                document.querySelector(`.settings-tab-content[data-tab="${targetTab}"]`)?.classList.add('active');
            });
        });

        document.getElementById('gridView')?.addEventListener('click', ViewManager.setGridView);
        document.getElementById('listView')?.addEventListener('click', ViewManager.setListView);

        const sizeSlider = document.getElementById('sizeSlider');
        if (sizeSlider) {
            // input: update CSS custom properties live — pure CSS change, no DOM rebuild.
            sizeSlider.addEventListener('input', (e) => {
                const size = e.target.value;
                const sizeLabel = document.getElementById('sizeLabel');
                if (sizeLabel) sizeLabel.textContent = `${size}px`;
                // Set all three size-related variables so the grid and cards resize
                // instantly via CSS without any DOM rebuild.
                document.documentElement.style.setProperty('--icon-size', `${size}px`);
                const cardSize = parseInt(size) + 60;
                document.documentElement.style.setProperty('--card-size', `${cardSize}px`);
                const gap = Math.max(8, Math.round(parseInt(size) * 0.2)) + 5;
                document.documentElement.style.setProperty('--card-gap', `${gap}px`);
            });
            // change (pointer released): persist the value to AppState + localStorage.
            // No DOM rebuild needed — CSS is already correct from the input handler.
            sizeSlider.addEventListener('change', (e) => {
                const size = e.target.value;
                AppState.iconSize = parseInt(size);
                Utils.safeLocalStorageSet('iconSize', size);
                if (window.UIRenderer) UIRenderer.matchCalendarHeight();
            });
        }

        document.getElementById('bgImage')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) await Background.setImage(file);
        });
        document.getElementById('bgPosition')?.addEventListener('change', (e) => Background.applyPosition(e.target.value));
        document.getElementById('bgBlur')?.addEventListener('change', (e) => Background.applyBlur(e.target.value));
        document.getElementById('clearBgImage')?.addEventListener('click', () => Background.clear());

        document.getElementById('columnLayout')?.addEventListener('change', (e) => {
            Utils.safeLocalStorageSet('columnLayout', e.target.value);
            if (window.UIRenderer) UIRenderer.render();
        });

        ['timezone1', 'timezone2', 'timezone3'].forEach(key => {
            document.getElementById(key)?.addEventListener('change', (e) => {
                Utils.safeLocalStorageSet(key, e.target.value);
                this._loadTimezones();
                this.updateClock();
                // Enabling/disabling a clock changes whether its grip can move it.
                this._syncClockInputs();
            });
        });

        this._wireClockReorder();

        // Custom per-clock labels: override the derived zone name in the header
        // clocks and anywhere else the zone is shown (calendar event rows/headers).
        ['timezone1', 'timezone2', 'timezone3'].forEach(key => {
            document.getElementById(key + 'Label')?.addEventListener('input', (e) => {
                Utils.safeLocalStorageSet(key + 'Label', e.target.value.trim());
                this.updateClock();
                if (window.UIRenderer) UIRenderer.renderCalendarCard();
            });
        });

        document.getElementById('exportData')?.addEventListener('click', () => Storage.export());
        document.getElementById('importData')?.addEventListener('click', () => {
            document.getElementById('importFile')?.click();
        });
        document.getElementById('importFile')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) await Storage.import(file);
        });
    },

    // ---- Live search filter (item 11) ----
    // Matches website cards by name/URL. Toggling CSS classes only — no DOM rebuild.
    _attachSearchFilter() {
        const input = document.getElementById('searchInput');
        if (!input) return;

        const applyFilter = (query) => {
            const container = document.getElementById('mainContainer');
            if (!container) return;
            const q = query.trim().toLowerCase();

            // Remove any existing hint
            container.querySelector('.search-no-matches')?.remove();

            if (!q) {
                // Clear all filter classes
                container.querySelectorAll('.website-card.filtered-hidden').forEach(c => c.classList.remove('filtered-hidden'));
                container.querySelectorAll('.app-group.filtered-group-hidden').forEach(g => g.classList.remove('filtered-group-hidden'));
                return;
            }

            const groups = container.querySelectorAll('.app-group');
            let totalVisible = 0;

            groups.forEach(group => {
                // Skip virtual groups (calendar, todo) — only filter website-card groups
                const isVirtual = group.classList.contains('virtual-group');
                if (isVirtual) return;

                const cards = group.querySelectorAll('.website-card');
                let visibleInGroup = 0;

                cards.forEach(card => {
                    // Match against the visible name text and the stored URL
                    const nameEl = card.querySelector('.website-name');
                    const name = (nameEl?.textContent || '').toLowerCase();
                    const url = (card.getAttribute('data-url') || '').toLowerCase();
                    const matches = name.includes(q) || url.includes(q);
                    card.classList.toggle('filtered-hidden', !matches);
                    if (matches) visibleInGroup++;
                });

                // Hide the entire group when none of its cards match
                group.classList.toggle('filtered-group-hidden', visibleInGroup === 0);
                totalVisible += visibleInGroup;
            });

            // Show a "no matches" hint if nothing was found
            if (totalVisible === 0) {
                const hint = document.createElement('div');
                hint.className = 'search-no-matches';
                hint.textContent = `No websites match "${query.trim()}"`;
                container.querySelector('.groups-container')?.appendChild(hint);
            }
        };

        input.addEventListener('input', (e) => applyFilter(e.target.value));

        // Escape clears the filter without submitting
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                input.value = '';
                applyFilter('');
            }
        });
    },

    toggleMenu() {
        const menu = document.getElementById('dropdownMenu');
        if (menu) menu.classList.toggle('show');
    },

    closeMenu() {
        const menu = document.getElementById('dropdownMenu');
        if (menu) menu.classList.remove('show');
    },

    openSettings() {
        const modal = document.getElementById('settingsModal');
        if (modal) {
            const columnLayout = localStorage.getItem('columnLayout') || '5-5';
            const layoutSelect = document.getElementById('columnLayout');
            if (layoutSelect) layoutSelect.value = columnLayout;

            // Refresh "(GMT±N)" offsets before showing the selected values so the
            // dropdowns reflect the current DST state each time Settings opens.
            this.annotateTimezoneOffsets();
            this._syncClockInputs();

            if (window.UIRenderer) {
                UIRenderer.renderTodoArchive(document.getElementById('todoArchiveSettings'), 'h4');
            }

            modal.classList.add('show');
            this._settingsFocusTrap = Utils.trapFocus(modal);
        }
    },

    closeSettings() {
        const modal = document.getElementById('settingsModal');
        if (modal) {
            Utils.releaseFocus(modal, this._settingsFocusTrap);
            this._settingsFocusTrap = null;
            modal.classList.remove('show');
        }
    },

    editWebsite(event, id) {
        event.preventDefault();
        event.stopPropagation();
        if (window.AppModal) AppModal.openEdit(id);
    },

    deleteWebsite(event, id) {
        event.preventDefault();
        event.stopPropagation();
        WebsiteManager.delete(id);
    },

    editGroup(id) {
        if (window.GroupModal) GroupModal.openEdit(id);
    },

    deleteGroup(id) {
        GroupManager.delete(id);
    },

    toggleFavorite(event, id) {
        event.preventDefault();
        event.stopPropagation();
        WebsiteManager.toggleFavorite(id);
    },

    toggleGroupCollapse(id) {
        GroupManager.toggleCollapse(id);
    },

    collapseAllGroups() {
        GroupManager.collapseAll();
    },

    expandAllGroups() {
        GroupManager.expandAll();
    },

    // Lazy-load the SQLite persistence layer after first paint. The three files
    // are loaded in order (sql-wasm → its WASM binary → db-manager) so the
    // dependency chain holds; db-manager self-bootstraps once it executes.
    loadDbModule() {
        const sources = ['lib/sql-wasm.js', 'lib/sql-wasm-binary.js', 'scripts/db-manager.js'];
        const loadNext = (i) => {
            if (i >= sources.length) return;
            const s = document.createElement('script');
            s.src = sources[i];
            s.onload = () => loadNext(i + 1);
            s.onerror = () => loadNext(i + 1); // skip a missing file but keep going
            document.body.appendChild(s);
        };
        const start = () => loadNext(0);
        if ('requestIdleCallback' in window) {
            requestIdleCallback(start, { timeout: 1500 });
        } else {
            setTimeout(start, 200);
        }
    },

    // ---- Changelog (rendered from CHANGELOG.md) ----

    async openChangelog() {
        const modal = document.getElementById('changelogModal');
        const body = document.getElementById('changelogBody');
        if (!modal || !body) return;
        this.closeMenu();
        modal.classList.add('show');

        if (this._changelogHTML) {
            body.innerHTML = this._changelogHTML;
        } else {
            body.innerHTML = '<p class="changelog-loading">Loading…</p>';
            try {
                const res = await fetch('CHANGELOG.md', { cache: 'no-cache' });
                if (!res.ok) throw new Error('fetch failed');
                this._changelogHTML = this._renderMarkdown(await res.text());
                body.innerHTML = this._changelogHTML;
            } catch {
                body.innerHTML = '<p class="changelog-loading">Couldn\'t load the changelog. Open the app via the local server (serve.bat) so it can read CHANGELOG.md.</p>';
            }
        }

        // (Re)build the focus trap now that the final content is in place.
        Utils.releaseFocus(modal, this._changelogTrap);
        this._changelogTrap = Utils.trapFocus(modal);
    },

    closeChangelog() {
        const modal = document.getElementById('changelogModal');
        if (!modal) return;
        Utils.releaseFocus(modal, this._changelogTrap);
        this._changelogTrap = null;
        modal.classList.remove('show');
    },

    // Inline markdown on already HTML-escaped text: `code`, **bold**, [text](url),
    // and the changelog's _(…)_ date annotations (italic markers just stripped to
    // avoid clashing with underscores inside `tz/paths`).
    _mdInline(text) {
        return text
            .replace(/_\(([^)]*)\)_/g, '($1)')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')  // bold first (may wrap italics)
            .replace(/\*([^*]+?)\*/g, '<em>$1</em>')           // then single-* italics
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, url) => {
                // esc() upstream leaves quotes intact, so escape them here or a
                // URL containing one could break out of the href attribute.
                const safe = (/^(https?:|#|mailto:)/.test(url) ? url : '#').replace(/"/g, '&quot;');
                return `<a href="${safe}" target="_blank" rel="noopener">${t}</a>`;
            });
    },

    // Minimal Markdown → HTML for the changelog's format (headings, bullet lists,
    // blockquotes, paragraphs). Wrapped/indented continuation lines are re-joined.
    _renderMarkdown(md) {
        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Re-join lines that are indented continuations of the previous line.
        // Split on \r?\n: CHANGELOG.md is CRLF on Windows, and a \r left at the
        // end of a joined line silently truncated every wrapped bullet, because
        // the bullet/heading captures below use `.`, which does not match \r.
        const logical = [];
        for (const raw of md.split(/\r?\n/)) {
            const isContinuation = /^\s+\S/.test(raw) && !/^\s*[-*>#]/.test(raw)
                && logical.length && logical[logical.length - 1].trim() !== '';
            if (isContinuation) logical[logical.length - 1] += ' ' + raw.trim();
            else logical.push(raw);
        }

        let html = '', inList = false, inQuote = false;
        const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
        const closeQuote = () => { if (inQuote) { html += '</blockquote>'; inQuote = false; } };

        for (const line of logical) {
            const t = line.replace(/\s+$/, '');
            if (/^\[[^\]]+\]:\s/.test(t)) continue;           // skip reference link defs
            if (/^#\s+Changelog\s*$/.test(t)) continue;        // redundant with the modal title
            if (t === '') { closeList(); closeQuote(); continue; }

            let m;
            if ((m = t.match(/^###\s+(.*)/))) { closeList(); closeQuote(); html += `<h4>${this._mdInline(esc(m[1]))}</h4>`; }
            else if ((m = t.match(/^##\s+(.*)/))) { closeList(); closeQuote(); html += `<h3>${this._mdInline(esc(m[1]))}</h3>`; }
            else if ((m = t.match(/^#\s+(.*)/))) { closeList(); closeQuote(); html += `<h2>${this._mdInline(esc(m[1]))}</h2>`; }
            else if ((m = t.match(/^>\s?(.*)/))) { closeList(); if (!inQuote) { html += '<blockquote>'; inQuote = true; } html += `${this._mdInline(esc(m[1]))} `; }
            else if ((m = t.match(/^[-*]\s+(.*)/))) { closeQuote(); if (!inList) { html += '<ul>'; inList = true; } html += `<li>${this._mdInline(esc(m[1]))}</li>`; }
            else { closeList(); closeQuote(); html += `<p>${this._mdInline(esc(t))}</p>`; }
        }
        closeList();
        closeQuote();
        return html;
    }
};

// ========================================
// STORAGE CAPACITY METER
// Shows localStorage usage in the footer and warns as it approaches the
// browser's ~5 MB quota (past which writes silently fail).
// ========================================

const StorageMeter = {
    LIMIT_BYTES: 5 * 1024 * 1024,
    _timer: null,

    // Approximate bytes in localStorage. The engine stores UTF-16, but this
    // app's data is overwhelmingly ASCII (JSON + base64), so 1 char ≈ 1 byte
    // tracks the real quota closely and keeps the "/ 5 MB" reference honest.
    usedBytes() {
        let total = 0;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key == null) continue;
                total += key.length + (localStorage.getItem(key) || '').length;
            }
        } catch { /* localStorage unavailable */ }
        return total;
    },

    update() {
        const meter = document.getElementById('storageMeter');
        const fill = document.getElementById('storageMeterFill');
        const text = document.getElementById('storageMeterText');
        if (!meter || !fill || !text) return;

        const used = this.usedBytes();
        const pct = (used / this.LIMIT_BYTES) * 100;
        const usedMB = used / (1024 * 1024);
        const limitMB = this.LIMIT_BYTES / (1024 * 1024);

        fill.style.width = Math.min(100, pct).toFixed(1) + '%';

        let label = `Storage: ${usedMB.toFixed(2)} MB / ${limitMB.toFixed(0)} MB (${Math.round(pct)}%)`;
        meter.classList.remove('is-warn', 'is-danger');
        if (pct >= 90) {
            meter.classList.add('is-danger');
            label += pct >= 100 ? ' — FULL' : ' — nearly full';
        } else if (pct >= 75) {
            meter.classList.add('is-warn');
        }
        text.textContent = label;
    },

    start() {
        this.update();
        if (this._timer) clearInterval(this._timer);
        // Refresh periodically so the meter reflects ongoing edits.
        this._timer = setInterval(() => this.update(), 2000);
    }
};

// ========================================
// GLOBAL EXPORTS
// ========================================

window.AppState = AppState;
window.Storage = Storage;
window.Theme = Theme;
window.Background = Background;
window.ImageStore = ImageStore;
window.GroupManager = GroupManager;
window.WebsiteManager = WebsiteManager;
window.ViewManager = ViewManager;
window.UI = UI;
window.Utils = Utils;
window.App = App;
window.StorageMeter = StorageMeter;
window.COLOR_PALETTE = COLOR_PALETTE;

// ========================================
// INITIALIZATION
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    App.init();
    if (window.Minimap) Minimap.init();
    // Pull the heavy SQLite backup engine (~850 KB WASM + the .db read) off the
    // critical path: load it once the page is painted and the main thread is idle.
    App.loadDbModule();
});
