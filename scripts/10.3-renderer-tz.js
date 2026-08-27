// ==========================================
// UI Renderer Module - Time Zone Comparison (part 10.3 of the renderer family)
// Extends UIRenderer (scripts/10-renderer.js) with the Calendar card's
// multi-timezone viewer (World-Time-Buddy-style stacked bars). Reads its data
// model from CalendarManager (scripts/5.1-calendar-tz.js) — never computes
// zone/date arithmetic itself, only formats what the model hands back.
// Must load after 10.1-renderer-calendar.js.
// ==========================================

// Fallback zone list for browsers without Intl.supportedValuesOf (Safari <17,
// older WebViews). Not exhaustive — just enough well-known IANA ids to cover
// every populated UTC offset so the picker is never empty.
const TZ_FALLBACK_ZONES = [
    'UTC', 'Pacific/Midway', 'Pacific/Honolulu', 'America/Anchorage',
    'America/Los_Angeles', 'America/Tijuana', 'America/Denver', 'America/Phoenix',
    'America/Chicago', 'America/Mexico_City', 'America/New_York', 'America/Toronto',
    'America/Bogota', 'America/Caracas', 'America/Halifax', 'America/Santiago',
    'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'Atlantic/Azores',
    'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid',
    'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Amsterdam',
    'Europe/Warsaw', 'Europe/Athens', 'Europe/Helsinki', 'Europe/Istanbul',
    'Europe/Moscow', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos',
    'Africa/Nairobi', 'Asia/Jerusalem', 'Asia/Dubai', 'Asia/Karachi',
    'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Bangkok',
    'Asia/Ho_Chi_Minh', 'Asia/Jakarta', 'Asia/Shanghai', 'Asia/Hong_Kong',
    'Asia/Singapore', 'Asia/Taipei', 'Asia/Seoul', 'Asia/Tokyo',
    'Australia/Perth', 'Australia/Adelaide', 'Australia/Sydney', 'Australia/Brisbane',
    'Pacific/Guam', 'Pacific/Auckland', 'Pacific/Fiji'
];

Object.assign(UIRenderer, {
    // Fallback list, reachable from instance methods below.
    TZ_FALLBACK_ZONES,

    // ========================================
    // TIME ZONE VIEW — top-level builder
    // ========================================

    // Renders in place of the day-view/list content when
    // CalendarManager.state.tzToolActive is set (see _calendarContentHTML,
    // scripts/10.1-renderer-calendar.js). Never called mid-drag — the cheap
    // path below (drag frames, the eta-tick hook) only ever touches CSS custom
    // properties and textContent on the DOM this produces.
    _calendarTzView() {
        const cm = window.CalendarManager;
        let model = null;
        try { model = cm?.buildTzModel?.() || null; } catch { model = null; }
        if (!cm || !model || !Array.isArray(model.rows) || model.rows.length === 0) {
            return `<div class="cal-tz-view"><div class="calendar-empty-state">Couldn't build the time zone comparison — try reopening the tool.</div></div>`;
        }
        return `
            <div class="cal-tz-view">
                ${this._tzToolbar(model)}
                <div class="cal-tz-scroll">
                    ${this._tzBars(model)}
                </div>
                ${this._tzRangeBar(model)}
            </div>`;
    },

    // ---- Toolbar: zone chips + "add" slot + start-date button ---------------
    _tzToolbar(model) {
        const rows = model.rows;
        const chips = rows.map((row, i) => this._tzChip(row, i, rows.length)).join('');
        const addBtn = rows.length < 4
            ? `<button type="button" class="cal-tz-add" onclick="UIRenderer.toggleTzZonePicker(this, -1)"
                       aria-haspopup="listbox" aria-expanded="false" title="Add time zone" aria-label="Add time zone">
                   <span aria-hidden="true">+</span>
               </button>`
            : '';
        const primaryRow = model.rows[model.primaryIdx] || model.rows[0];
        const days = primaryRow?.days || [];
        const rangeLabel = days.length ? `${days[0].dateLabel} – ${days[days.length - 1].dateLabel}` : '';
        const safeRangeLabel = Utils.sanitizeHTML(rangeLabel);
        return `
            <div class="cal-tz-toolbar">
                <div class="cal-tz-slots">
                    ${chips}
                    ${addBtn}
                </div>
                <button type="button" class="cal-tz-datebtn" onclick="UIRenderer.toggleTzDatePicker(this)"
                        aria-haspopup="true" aria-expanded="false"
                        title="Change start date" aria-label="Change start date. Current range: ${safeRangeLabel}">
                    <svg class="ico ico-sm" aria-hidden="true"><use href="#ico-calendar-days"></use></svg>
                    ${safeRangeLabel}
                    <span class="cal-tz-chevron" aria-hidden="true"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-chevron"></use></svg></span>
                </button>
            </div>`;
    },

    _tzChip(row, idx, total) {
        const safeLabel = Utils.sanitizeHTML(row.label);
        const safeOffset = Utils.sanitizeHTML(row.offsetLabel);
        const canRemove = total > 1;
        return `
            <div class="cal-tz-chip${row.isPrimary ? ' is-primary' : ''}" data-idx="${idx}">
                <button type="button" class="cal-tz-star" onclick="CalendarManager.setTzPrimary(${idx})"
                        aria-pressed="${row.isPrimary ? 'true' : 'false'}"
                        title="Make ${safeLabel} primary" aria-label="Make ${safeLabel} primary">
                    <span aria-hidden="true">★</span>
                </button>
                <button type="button" class="cal-tz-chipbtn" onclick="UIRenderer.toggleTzZonePicker(this, ${idx})"
                        aria-haspopup="listbox" aria-expanded="false"
                        title="Change time zone" aria-label="Change time zone — currently ${safeLabel}">
                    <span class="cal-tz-chiplabel">${safeLabel}</span><span class="cal-tz-gmt">${safeOffset}</span>
                </button>
                ${canRemove ? `<button type="button" class="cal-tz-chip-remove" onclick="CalendarManager.removeTzZone(${idx})"
                        title="Remove ${safeLabel}" aria-label="Remove ${safeLabel}"><span aria-hidden="true">✕</span></button>` : ''}
            </div>`;
    },

    // ---- Stacked bars ---------------------------------------------------------
    // The only element carrying real geometry state: --tz-dial-pct/--tz-now-pct/
    // --tz-r-left/--tz-r-width plus data-start-ms/data-span-ms, all read back by
    // the drag handler and the tick hook WITHOUT ever calling buildTzModel again.
    _tzBars(model) {
        const nowIsNull = model.nowPct == null;
        const hasRange = !!model.range;
        const rowsHTML = model.rows.map((row, i) => this._tzRow(row, i, nowIsNull, hasRange)).join('');
        const spanMin = Math.max(1, Math.round(model.spanMs / 60000));
        const dialMin = Math.min(spanMin, Math.max(0, Math.round((model.dial.ms - model.startMs) / 60000)));
        const primaryRow = model.rows[model.primaryIdx] || model.rows[0];
        const pr = primaryRow?.readout || { time: '', date: '' };
        const valuetext = primaryRow ? `${pr.time}, ${pr.date} — ${primaryRow.label}` : '';
        const nowPct = nowIsNull ? 0 : model.nowPct;
        const rangeLeft = hasRange ? model.range.leftPct : 0;
        const rangeWidth = hasRange ? model.range.widthPct : 0;
        return `
            <div class="cal-tz-bars"
                 style="--tz-dial-pct:${this._tzPct(model.dial.pct)}%;--tz-now-pct:${this._tzPct(nowPct)}%;--tz-r-left:${this._tzPct(rangeLeft)}%;--tz-r-width:${this._tzPct(rangeWidth)}%"
                 data-start-ms="${model.startMs}" data-span-ms="${model.spanMs}">
                ${rowsHTML}
                <div class="cal-tz-dial" role="slider" tabindex="0" aria-orientation="horizontal"
                     aria-valuemin="0" aria-valuemax="${spanMin}" aria-valuenow="${dialMin}"
                     aria-valuetext="${Utils.sanitizeHTML(valuetext)}" aria-label="Time dial"
                     onkeydown="UIRenderer.tzDialKeydown(event)">
                    <span class="cal-tz-dial-grip" aria-hidden="true"></span>
                </div>
            </div>`;
    },

    _tzRow(row, idx, nowIsNull, hasRange) {
        const safeLabel = Utils.sanitizeHTML(row.label);
        const safeOffset = Utils.sanitizeHTML(row.offsetLabel);
        const readout = row.readout || { time: '', date: '' };

        const daysHTML = (row.days || []).map((d, i) => `
                <div class="cal-tz-day${i === 0 ? ' is-first' : ''}" style="left:${this._tzPct(d.leftPct)}%;width:${this._tzPct(d.widthPct)}%">
                    <span class="cal-tz-daylabel">${Utils.sanitizeHTML(d.wkday)} · ${Utils.sanitizeHTML(d.dateLabel)}</span>
                </div>`).join('');

        const nightsHTML = (row.nights || []).map(n =>
            `<div class="cal-tz-night" style="left:${this._tzPct(n.leftPct)}%;width:${this._tzPct(n.widthPct)}%" aria-hidden="true"></div>`).join('');

        const ticksHTML = (row.ticks || []).map(t => {
            const tick = `<div class="cal-tz-tick${t.isLabeled ? ' is-labeled' : ''}" style="left:${this._tzPct(t.leftPct)}%" aria-hidden="true"></div>`;
            const lbl = t.isLabeled
                ? `<span class="cal-tz-hlabel" style="left:${this._tzPct(t.leftPct)}%" aria-hidden="true">${Utils.sanitizeHTML(t.label)}</span>`
                : '';
            return tick + lbl;
        }).join('');

        const eventsHTML = row.isPrimary ? (row.events || []).map(ev => {
            const color = Utils.isValidColor(ev.color) ? ev.color : DEFAULT_CAL_COLOR;
            const safeTitle = Utils.sanitizeHTML(ev.title || 'Untitled');
            return `<div class="cal-tz-ev" style="left:${this._tzPct(ev.leftPct)}%;width:${this._tzPct(ev.widthPct)}%;--ev-c:${color}" title="${safeTitle}">
                        <span class="cal-tz-ev-title">${safeTitle}</span>
                    </div>`;
        }).join('') : '';

        const bandHTML = hasRange ? `<div class="cal-tz-band" aria-hidden="true"></div>` : '';
        // Always present so the eta-tick hook only ever has to toggle `hidden`
        // (never create/destroy nodes outside a full rebuild) — see _tzTickUpdate.
        const nowlineHTML = `<div class="cal-tz-nowline"${nowIsNull ? ' hidden' : ''} aria-hidden="true"></div>`;

        return `
            <div class="cal-tz-row${row.isPrimary ? ' is-primary' : ''}" data-idx="${idx}">
                <div class="cal-tz-rowhead">
                    <button type="button" class="cal-tz-star" onclick="CalendarManager.setTzPrimary(${idx})"
                            aria-pressed="${row.isPrimary ? 'true' : 'false'}"
                            title="Make ${safeLabel} primary" aria-label="Make ${safeLabel} primary">
                        <span aria-hidden="true">★</span>
                    </button>
                    <span class="cal-tz-zname">${safeLabel}</span>
                    <span class="cal-tz-gmt">${safeOffset}</span>
                    <span class="cal-tz-readout" data-idx="${idx}">
                        <span class="cal-tz-readout-time">${Utils.sanitizeHTML(readout.time || '')}</span><span class="cal-tz-readout-date">${Utils.sanitizeHTML(readout.date || '')}</span>
                    </span>
                </div>
                <div class="cal-tz-bar" role="group" aria-label="Times in ${safeLabel}">
                    ${daysHTML}
                    ${nightsHTML}
                    ${ticksHTML}
                    ${eventsHTML}
                    ${bandHTML}
                    ${nowlineHTML}
                </div>
            </div>`;
    },

    // ---- Range readout / commit bar -------------------------------------------
    _tzRangeBar(model) {
        const cm = window.CalendarManager;
        if (model.range) {
            const chips = (model.range.perZone || []).map(z => {
                const safeLabel = Utils.sanitizeHTML(z.label);
                const safeStart = Utils.sanitizeHTML(z.start);
                const safeEnd = Utils.sanitizeHTML(z.end);
                const nextDay = z.nextDay ? '<span class="cal-tz-range-nextday">(next day)</span>' : '';
                return `<span class="cal-tz-range-chip">
                            <span class="cal-tz-range-zone">${safeLabel}</span>
                            <span class="cal-tz-range-time">${safeStart} – ${safeEnd}</span>${nextDay}
                        </span>`;
            }).join('');
            return `
                <div class="cal-tz-rangebar" aria-live="polite">
                    <div class="cal-tz-range-chips">${chips}</div>
                    <button type="button" class="cal-tz-range-copybtn" onclick="UIRenderer.tzCopyRange()">Copy</button>
                    <button type="button" class="cal-tz-range-clearbtn" onclick="CalendarManager.clearTzRange()"
                            title="Clear time range" aria-label="Clear time range">
                        <svg class="ico ico-sm" aria-hidden="true"><use href="#ico-trash"></use></svg>
                    </button>
                </div>`;
        }
        const hasStart = cm?.state?.tzRangeStartMs != null;
        return `
            <div class="cal-tz-rangebar" aria-live="polite">
                <button type="button" class="cal-tz-range-startbtn" onclick="CalendarManager.setTzRangeStartAtDial()">Start at dial</button>
                <button type="button" class="cal-tz-range-endbtn" onclick="CalendarManager.setTzRangeEndAtDial()"${hasStart ? '' : ' disabled'}>End at dial</button>
                ${hasStart ? `<button type="button" class="cal-tz-range-clearbtn" onclick="CalendarManager.clearTzRange()"
                        title="Clear range start" aria-label="Clear range start"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-trash"></use></svg></button>` : ''}
            </div>`;
    },

    // Guard against a malformed model (NaN/Infinity) producing invalid inline
    // CSS, which would silently drop the whole style attribute in some
    // browsers. Purely a numeric safety net — not a text sink, so this is not
    // an Utils.sanitizeHTML substitute.
    _tzPct(n) {
        return Number.isFinite(n) ? n.toFixed(3) : '0';
    },

    // ========================================
    // CHEAP-UPDATE PATH — never rebuilds the DOM, never calls buildTzModel
    // ========================================

    // Read the dial's current position back out of the live DOM (the CSS
    // custom property is the one thing guaranteed to be in sync at any point
    // during or after a drag/keyboard nudge, cheaper than re-deriving from
    // CalendarManager.state which may lag behind a debounced commit).
    _tzCurrentDialMs(bars, startMs, spanMs) {
        const pct = parseFloat(bars.style.getPropertyValue('--tz-dial-pct'));
        if (Number.isFinite(pct)) return startMs + (pct / 100) * spanMs;
        const stateMs = Number(window.CalendarManager?.state?.tzDialMs);
        return Number.isFinite(stateMs) ? stateMs : startMs;
    },

    // One CSS var + up to 4 readout chips + the dial's own aria attributes —
    // the entire "drag frame" cost budget. No layout read except the one
    // getBoundingClientRect the caller already did to turn a pointer x into ms.
    _tzWriteDial(bars, ms, startMs, spanMs) {
        const pct = spanMs > 0 ? ((ms - startMs) / spanMs) * 100 : 0;
        bars.style.setProperty('--tz-dial-pct', `${this._tzPct(pct)}%`);
        this._tzWriteReadouts(ms, bars);

        const dial = bars.querySelector('.cal-tz-dial');
        if (!dial) return;
        const spanMin = Math.max(1, Math.round(spanMs / 60000));
        const nowMin = Math.min(spanMin, Math.max(0, Math.round((ms - startMs) / 60000)));
        dial.setAttribute('aria-valuenow', String(nowMin));
        const primaryRowEl = bars.querySelector('.cal-tz-row.is-primary');
        const zname = primaryRowEl?.querySelector('.cal-tz-zname')?.textContent || '';
        const t = primaryRowEl?.querySelector('.cal-tz-readout-time')?.textContent || '';
        const d = primaryRowEl?.querySelector('.cal-tz-readout-date')?.textContent || '';
        dial.setAttribute('aria-valuetext', `${t}, ${d} — ${zname}`);
    },

    // textContent only — the two spans inside .cal-tz-readout exist precisely
    // so a drag frame never has to touch innerHTML.
    _tzWriteReadouts(ms, scope) {
        let readouts;
        try { readouts = window.CalendarManager?._tzDialReadouts?.(ms) || []; } catch { readouts = []; }
        if (!Array.isArray(readouts) || !readouts.length) return;
        const root = scope || document.querySelector('.calendar-group .cal-tz-bars');
        if (!root) return;
        root.querySelectorAll('.cal-tz-readout').forEach((chip) => {
            const idx = Number(chip.dataset.idx);
            const r = Number.isFinite(idx) ? readouts[idx] : null;
            if (!r) return;
            const t = chip.querySelector('.cal-tz-readout-time');
            const d = chip.querySelector('.cal-tz-readout-date');
            if (t) t.textContent = r.time || '';
            if (d) d.textContent = r.date || '';
        });
    },

    // Hooked from _tickCalendarEta (scripts/10.1-renderer-calendar.js) — same
    // 30s ticker as the calendar's own now-line, no new interval. Recomputes
    // only --tz-now-pct and the nowline's hidden state; never rebuilds.
    _tzTickUpdate() {
        const bars = document.querySelector('.calendar-group .cal-tz-bars');
        if (!bars) return;
        const startMs = Number(bars.dataset.startMs);
        const spanMs = Number(bars.dataset.spanMs);
        if (!Number.isFinite(startMs) || !Number.isFinite(spanMs) || spanMs <= 0) return;
        const now = Date.now();
        const inWindow = now >= startMs && now <= startMs + spanMs;
        const pct = inWindow ? ((now - startMs) / spanMs) * 100 : 0;
        bars.style.setProperty('--tz-now-pct', `${this._tzPct(pct)}%`);
        bars.querySelectorAll('.cal-tz-nowline').forEach((el) => {
            if (inWindow) el.removeAttribute('hidden');
            else el.setAttribute('hidden', '');
        });
    },

    // ========================================
    // DRAG — one delegated pointerdown, mirrors _wireCardResize
    // (scripts/10-renderer.js:803-895)
    // ========================================

    _attachTzDragHandler(container) {
        container.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const bars = e.target.closest('.cal-tz-bars');
            if (!bars) return;
            // One drag at a time, shared with the card-resize grip
            // (_cardDragActive ORs in this._tzDragActive — 10-renderer.js).
            if (this._cardDragActive()) return;

            const onDial = !!e.target.closest('.cal-tz-dial');
            const barEl = e.target.closest('.cal-tz-row .cal-tz-bar');
            if (!onDial && !barEl) return;   // rowhead / star / chip clicks pass through untouched

            const rowEl = barEl ? barEl.closest('.cal-tz-row') : null;
            const isPrimary = !!rowEl?.classList.contains('is-primary');

            const startMs = Number(bars.dataset.startMs);
            const spanMs = Number(bars.dataset.spanMs);
            if (!Number.isFinite(startMs) || !Number.isFinite(spanMs) || spanMs <= 0) return;

            e.preventDefault();
            try { e.target.setPointerCapture?.(e.pointerId); } catch { /* capture is best-effort */ }

            const pointerToMs = (clientX) => {
                const rect = bars.getBoundingClientRect();
                const pct = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
                const raw = startMs + pct * spanMs;
                const snapped = Math.round(raw / 900000) * 900000;
                return Math.min(startMs + spanMs, Math.max(startMs, snapped));
            };

            const state = {
                bars, startMs, spanMs, pointerToMs,
                pointerId: e.pointerId,
                startX: e.clientX,
                mode: onDial ? 'dial' : (isPrimary ? 'primary' : 'scrub'),
                moved: false,
                rangeAnchorMs: null,
                pendingRange: null,
                pendingClientX: e.clientX,
                rafId: null,
                preDialPct: bars.style.getPropertyValue('--tz-dial-pct'),
                preRLeft: bars.style.getPropertyValue('--tz-r-left'),
                preRWidth: bars.style.getPropertyValue('--tz-r-width'),
            };
            this._tzDrag = state;
            this._tzDragActive = true;

            // Coalesce pointermove handling into one rAF per frame — the shape
            // mirrors minimap.js's _scheduleDragFrame/_runDragFrame.
            const runFrame = () => {
                state.rafId = null;
                if (this._tzDrag !== state) return;
                const dx = state.pendingClientX - state.startX;
                if (!state.moved) {
                    if (Math.abs(dx) < 5) return;
                    state.moved = true;
                    if (state.mode === 'primary') {
                        // Committing to a range paint: anchor at the snapped
                        // POINTERDOWN position, not wherever we've dragged to.
                        state.rangeAnchorMs = pointerToMs(state.startX);
                        state.mode = 'range';
                    }
                }
                const ms = pointerToMs(state.pendingClientX);
                if (state.mode === 'range') {
                    const lo = Math.min(state.rangeAnchorMs, ms);
                    const hi = Math.max(state.rangeAnchorMs, ms);
                    bars.style.setProperty('--tz-r-left', `${this._tzPct(((lo - startMs) / spanMs) * 100)}%`);
                    bars.style.setProperty('--tz-r-width', `${this._tzPct(((hi - lo) / spanMs) * 100)}%`);
                    state.pendingRange = { startMs: lo, endMs: hi };
                } else {
                    this._tzWriteDial(bars, ms, startMs, spanMs);
                }
            };

            const scheduleFrame = () => {
                if (state.rafId !== null) return;
                state.rafId = requestAnimationFrame(runFrame);
            };

            const onMove = (ev) => {
                if (ev.pointerId !== state.pointerId || this._tzDrag !== state) return;
                state.pendingClientX = ev.clientX;
                scheduleFrame();
            };

            const finish = (ev, commit) => {
                if (this._tzDrag !== state) return;
                if (ev && ev.pointerId !== undefined && ev.pointerId !== state.pointerId) return;
                if (state.rafId !== null) { cancelAnimationFrame(state.rafId); state.rafId = null; runFrame(); }
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onCancel);
                document.removeEventListener('lostpointercapture', onCancel);
                document.removeEventListener('keydown', onKeydown, true);
                this._tzDrag = null;
                this._tzDragActive = false;

                const cm = window.CalendarManager;

                if (!commit) {
                    bars.style.setProperty('--tz-dial-pct', state.preDialPct || '0%');
                    bars.style.setProperty('--tz-r-left', state.preRLeft || '0%');
                    bars.style.setProperty('--tz-r-width', state.preRWidth || '0%');
                    this._flushDeferredRender();
                    return;
                }

                if (!state.moved) {
                    // Plain click on the dial, a primary bar, or a non-primary
                    // bar: all three mean the same thing — move the dial here.
                    cm?.setTzDialMs?.(pointerToMs(ev ? ev.clientX : state.startX));
                } else if (state.mode === 'range' && state.pendingRange) {
                    // No single "set range" mutator exists — a paint commits as
                    // two dial moves, each immediately pinned. The dial visibly
                    // ends at the range's end; that's a consequence of the given
                    // API surface, not an oversight.
                    const { startMs: lo, endMs: hi } = state.pendingRange;
                    cm?.setTzDialMs?.(lo);
                    cm?.setTzRangeStartAtDial?.();
                    cm?.setTzDialMs?.(hi);
                    cm?.setTzRangeEndAtDial?.();
                } else {
                    cm?.setTzDialMs?.(pointerToMs(ev.clientX));
                }
                this._flushDeferredRender();
            };
            const onUp = (ev) => finish(ev, true);
            const onCancel = (ev) => finish(ev, false);
            const onKeydown = (ev) => { if (ev.key === 'Escape') finish(null, false); };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onCancel);
            document.addEventListener('lostpointercapture', onCancel);
            document.addEventListener('keydown', onKeydown, true);
        });
    },

    // ========================================
    // KEYBOARD — dial slider
    // ========================================

    // Cheap path only: writes the CSS var + readouts + aria immediately (so
    // key-repeat feels 1:1), then DEBOUNCES the real state.tzDialMs commit.
    // Committing on every keystroke would call setTzDialMs -> a scoped rebuild
    // (refreshCalendarDayView) that replaces the very .cal-tz-dial the focus
    // is on, silently killing keyboard navigation after the first keypress.
    tzDialKeydown(event) {
        const dial = event.currentTarget;
        const bars = dial?.closest('.cal-tz-bars');
        if (!bars) return;
        const startMs = Number(bars.dataset.startMs);
        const spanMs = Number(bars.dataset.spanMs);
        if (!Number.isFinite(startMs) || !Number.isFinite(spanMs) || spanMs <= 0) return;
        const curMs = this._tzCurrentDialMs(bars, startMs, spanMs);
        let next;
        switch (event.key) {
            case 'ArrowLeft':  next = curMs - (event.shiftKey ? 3600000 : 900000); break;
            case 'ArrowRight': next = curMs + (event.shiftKey ? 3600000 : 900000); break;
            case 'PageUp':     next = curMs - 86400000; break;
            case 'PageDown':   next = curMs + 86400000; break;
            case 'Home':       next = startMs; break;
            case 'End':        next = startMs + spanMs; break;
            default: return;
        }
        event.preventDefault();
        next = Math.round(next / 900000) * 900000;
        next = Math.min(startMs + spanMs, Math.max(startMs, next));
        this._tzWriteDial(bars, next, startMs, spanMs);
        this._queueTzDialPersist(next);
    },

    _queueTzDialPersist(ms) {
        clearTimeout(this._tzDialPersistTimer);
        this._tzDialPersistTimer = setTimeout(() => {
            const hadFocus = document.activeElement?.classList?.contains('cal-tz-dial');
            window.CalendarManager?.setTzDialMs?.(ms);
            if (hadFocus) document.querySelector('.calendar-group .cal-tz-dial')?.focus();
        }, 250);
    },

    // ========================================
    // RANGE COPY
    // ========================================

    tzCopyRange() {
        const cm = window.CalendarManager;
        let text = '';
        try { text = cm?.getTzRangeText?.() || ''; } catch { text = ''; }
        if (!text) return;

        const btn = document.querySelector('.calendar-group .cal-tz-range-copybtn');
        const flash = () => {
            if (!btn || !btn.isConnected) return;
            if (btn.dataset.origLabel == null) btn.dataset.origLabel = btn.textContent;
            btn.textContent = 'Copied';
            btn.classList.add('is-copied');
            clearTimeout(this._tzCopyFlashTimer);
            this._tzCopyFlashTimer = setTimeout(() => {
                if (!btn.isConnected) return;
                btn.textContent = btn.dataset.origLabel || 'Copy';
                btn.classList.remove('is-copied');
                delete btn.dataset.origLabel;
            }, 1500);
        };
        // Transient-node idiom (same as openUrlInBackgroundTab,
        // scripts/10.1-renderer-calendar.js:95-113): file:// is a non-secure
        // context, so navigator.clipboard can be entirely absent — this
        // fallback is load-bearing, not a defensive extra.
        const fallbackCopy = () => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            ta.style.left = '-1000px';
            ta.setAttribute('aria-hidden', 'true');
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            try { document.execCommand('copy'); } catch { /* best-effort */ }
            ta.remove();
        };

        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(flash).catch(() => { fallbackCopy(); flash(); });
        } else {
            fallbackCopy();
            flash();
        }
    },

    // ========================================
    // POPOVERS — zone picker (combobox+listbox) and start-date grid
    // Both share one set of handles (this._tzPickerDismiss/_tzPickerKeydown/
    // _tzPickerClose) so only one of the two is ever open, and so
    // _teardownCalendarMenus (scripts/10-renderer.js) can tear down whichever
    // is open without knowing which kind it is.
    // ========================================

    _tzPositionPopover(pop, anchor) {
        const r = anchor.getBoundingClientRect();
        pop.style.left = `${r.left + window.scrollX}px`;
        pop.style.top = `${r.bottom + window.scrollY + 4}px`;
        const pr = pop.getBoundingClientRect();
        let left = r.left + window.scrollX;
        let top = r.bottom + window.scrollY + 4;
        if (pr.right > window.innerWidth) left = Math.max(0, window.scrollX + window.innerWidth - pr.width - 8);
        if (pr.bottom > window.innerHeight + window.scrollY) top = Math.max(0, r.top + window.scrollY - pr.height - 4);
        pop.style.left = `${left}px`;
        pop.style.top = `${top}px`;
    },

    // slotIdx: index of the chip being reassigned, or -1 for the "add zone"
    // slot (selecting there calls addTzZone instead of setTzZone).
    toggleTzZonePicker(btn, slotIdx) {
        const reopening = this._tzPickerKind === 'zone' && this._tzPickerInvoker === btn;
        this._tzPickerClose?.(false);
        this._viewMenuClose?.(false);
        if (reopening) return;

        const cm = window.CalendarManager;
        if (!cm) return;

        let zones;
        try {
            zones = typeof Intl.supportedValuesOf === 'function'
                ? Intl.supportedValuesOf('timeZone')
                : this.TZ_FALLBACK_ZONES;
        } catch { zones = this.TZ_FALLBACK_ZONES; }
        if (!Array.isArray(zones) || !zones.length) zones = this.TZ_FALLBACK_ZONES;

        // Built once, ever — reused verbatim across every open. Filtering as
        // the user types toggles `hidden` on these same nodes; it never
        // rebuilds them.
        if (!this._tzZoneOptionsHTML) {
            this._tzZoneOptionsHTML = zones.map((z, i) => {
                const safeZone = Utils.sanitizeHTML(z);
                let off = '';
                try { off = Utils.sanitizeHTML(cm._tzOffsetLabel?.(z) || ''); } catch { off = ''; }
                return `<li class="cal-tz-zonepop-opt" id="calTzZoneOpt-${i}" role="option" data-zone="${safeZone}">
                            <span class="cal-tz-zonepop-id">${safeZone}</span><span class="cal-tz-zonepop-off">${off}</span>
                        </li>`;
            }).join('');
        }

        const pop = document.createElement('div');
        pop.className = 'cal-tz-popover cal-tz-zonepop';
        pop.innerHTML = `
            <div class="cal-tz-zonepop-searchwrap">
                <svg class="ico ico-sm" aria-hidden="true"><use href="#ico-search"></use></svg>
                <input type="text" class="cal-tz-zonepop-input" role="combobox" aria-expanded="true"
                       aria-controls="calTzZoneList" aria-autocomplete="list" aria-activedescendant=""
                       placeholder="Search time zones…" aria-label="Search time zones">
            </div>
            <ul class="cal-tz-zonepop-list" id="calTzZoneList" role="listbox" aria-label="Time zones">
                ${this._tzZoneOptionsHTML}
            </ul>`;
        document.body.appendChild(pop);
        this._tzPositionPopover(pop, btn);

        const input = pop.querySelector('.cal-tz-zonepop-input');
        const list = pop.querySelector('.cal-tz-zonepop-list');
        const rows = [...list.querySelectorAll('.cal-tz-zonepop-opt')];
        const visibleRows = () => rows.filter(row => !row.hidden);

        const setActive = (row) => {
            list.querySelectorAll('.cal-tz-zonepop-opt.is-active').forEach(r => r.classList.remove('is-active'));
            if (row) {
                row.classList.add('is-active');
                input.setAttribute('aria-activedescendant', row.id);
                row.scrollIntoView({ block: 'nearest' });
            } else {
                input.setAttribute('aria-activedescendant', '');
            }
        };

        const close = (refocus) => {
            pop.remove();
            document.removeEventListener('click', this._tzPickerDismiss, true);
            document.removeEventListener('keydown', this._tzPickerKeydown, true);
            this._tzPickerDismiss = this._tzPickerKeydown = this._tzPickerClose = null;
            this._tzPickerKind = this._tzPickerInvoker = null;
            btn.setAttribute('aria-expanded', 'false');
            if (refocus && btn?.isConnected) btn.focus();
        };
        this._tzPickerClose = close;
        this._tzPickerKind = 'zone';
        this._tzPickerInvoker = btn;
        btn.setAttribute('aria-expanded', 'true');

        const selectZone = (zone) => {
            if (!zone) return;
            close(false);
            if (slotIdx === -1) cm.addTzZone?.(zone);
            else cm.setTzZone?.(slotIdx, zone);
        };

        const currentZone = slotIdx >= 0 ? cm.getTzToolConfig?.()?.zones?.[slotIdx] : null;
        const currentRow = currentZone ? rows.find(r => r.dataset.zone === currentZone) : null;
        setActive(currentRow || visibleRows()[0] || null);

        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            rows.forEach(r => { r.hidden = q ? !r.dataset.zone.toLowerCase().includes(q) : false; });
            setActive(visibleRows()[0] || null);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                selectZone(list.querySelector('.cal-tz-zonepop-opt.is-active')?.dataset.zone);
                return;
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const vis = visibleRows();
                if (!vis.length) return;
                const cur = list.querySelector('.cal-tz-zonepop-opt.is-active');
                const idx = vis.indexOf(cur);
                const next = e.key === 'ArrowDown' ? (idx + 1) % vis.length : (idx - 1 + vis.length) % vis.length;
                setActive(vis[next]);
            }
            // Escape is handled once, at the document level below.
        });

        list.addEventListener('click', (e) => {
            const row = e.target.closest('.cal-tz-zonepop-opt');
            if (row && !row.hidden) selectZone(row.dataset.zone);
        });

        this._tzPickerDismiss = (e) => { if (!pop.contains(e.target) && e.target !== btn) close(false); };
        this._tzPickerKeydown = (e) => { if (e.key === 'Escape') close(true); };
        document.addEventListener('click', this._tzPickerDismiss, true);
        document.addEventListener('keydown', this._tzPickerKeydown, true);

        input.focus();
    },

    toggleTzDatePicker(btn) {
        const reopening = this._tzPickerKind === 'date' && this._tzPickerInvoker === btn;
        this._tzPickerClose?.(false);
        this._viewMenuClose?.(false);
        if (reopening) return;

        const cm = window.CalendarManager;
        if (!cm) return;
        let days;
        try { days = cm._tzPickerDays?.() || []; } catch { days = []; }
        if (!Array.isArray(days) || !days.length) return;

        const weekHead = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
            .map(w => `<span class="cal-tz-datepop-wd" aria-hidden="true">${w}</span>`).join('');

        let sawStart = false;
        const cellsHTML = days.map((d, i) => {
            const cls = ['cal-tz-daycell'];
            if (d.isToday) cls.push('is-today');
            if (d.isStart) { cls.push('is-start'); sawStart = true; }
            if (d.inSpan) cls.push('is-inspan');
            const full = this._tzFullDateLabel(d.dateStr) || d.label || d.dateStr;
            const safeFull = Utils.sanitizeHTML(full);
            const tabIdx = d.isStart ? '0' : '-1';
            return `<button type="button" class="${cls.join(' ')}" id="calTzDayCell-${i}"
                            data-datestr="${Utils.sanitizeHTML(d.dateStr)}"
                            aria-label="${safeFull}" title="${safeFull}" tabindex="${tabIdx}">${Utils.sanitizeHTML(String(d.dayNum))}</button>`;
        }).join('');

        const pop = document.createElement('div');
        pop.className = 'cal-tz-popover cal-tz-datepop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Choose start date');
        pop.innerHTML = `
            <div class="cal-tz-datepop-head">${weekHead}</div>
            <div class="cal-tz-datepop-grid">${cellsHTML}</div>`;
        document.body.appendChild(pop);
        this._tzPositionPopover(pop, btn);

        const cells = [...pop.querySelectorAll('.cal-tz-daycell')];
        if (!sawStart && cells[0]) cells[0].tabIndex = 0;

        const close = (refocus) => {
            pop.remove();
            document.removeEventListener('click', this._tzPickerDismiss, true);
            document.removeEventListener('keydown', this._tzPickerKeydown, true);
            this._tzPickerDismiss = this._tzPickerKeydown = this._tzPickerClose = null;
            this._tzPickerKind = this._tzPickerInvoker = null;
            btn.setAttribute('aria-expanded', 'false');
            if (refocus && btn?.isConnected) btn.focus();
        };
        this._tzPickerClose = close;
        this._tzPickerKind = 'date';
        this._tzPickerInvoker = btn;
        btn.setAttribute('aria-expanded', 'true');

        const pick = (cell) => {
            const dateStr = cell?.dataset.datestr;
            if (!dateStr) return;
            close(false);
            cm.setTzStartDate?.(dateStr);
        };

        pop.addEventListener('click', (e) => {
            const cell = e.target.closest('.cal-tz-daycell');
            if (cell) pick(cell);
        });

        // Roving arrow focus, same pattern as toggleViewMenu
        // (scripts/10.1-renderer-calendar.js:307-315) extended to 2D.
        pop.addEventListener('keydown', (e) => {
            const cur = document.activeElement?.closest?.('.cal-tz-daycell');
            if (!cur) return;
            const idx = cells.indexOf(cur);
            let next = -1;
            switch (e.key) {
                case 'ArrowRight': next = (idx + 1) % cells.length; break;
                case 'ArrowLeft':  next = (idx - 1 + cells.length) % cells.length; break;
                case 'ArrowDown':  next = (idx + 7) % cells.length; break;
                case 'ArrowUp':    next = (idx - 7 + cells.length) % cells.length; break;
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    pick(cur);
                    return;
                default: return;
            }
            e.preventDefault();
            cells[idx].tabIndex = -1;
            cells[next].tabIndex = 0;
            cells[next].focus();
        });

        this._tzPickerDismiss = (e) => { if (!pop.contains(e.target) && e.target !== btn) close(false); };
        this._tzPickerKeydown = (e) => { if (e.key === 'Escape') close(true); };
        document.addEventListener('click', this._tzPickerDismiss, true);
        document.addEventListener('keydown', this._tzPickerKeydown, true);

        (pop.querySelector('.cal-tz-daycell.is-start') || cells[0])?.focus();
    },

    // Full accessible date string for one grid cell — built from the
    // model-supplied dateStr rather than trusting _tzPickerDays()'s `label`
    // to already be full-length (its exact contents aren't specified by the
    // data-model contract this renderer was built against).
    _tzFullDateLabel(dateStr) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
        if (!m) return '';
        try {
            const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
            return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d);
        } catch { return ''; }
    }
});
