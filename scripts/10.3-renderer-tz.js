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
            <div class="cal-tz-view${model.showEvents ? ' has-events' : ''}">
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
        // model.windowLabel already collapses a one-day window to a single
        // date rather than "Aug 24 – Aug 24".
        const safeRangeLabel = Utils.sanitizeHTML(model.windowLabel || '');
        return `
            <div class="cal-tz-toolbar">
                <div class="cal-tz-slots">
                    ${chips}
                    ${addBtn}
                </div>
                <div class="cal-tz-actions">
                    ${this._tzFormatToggle(model)}
                    <button type="button" class="cal-tz-datebtn" onclick="UIRenderer.toggleTzDatePicker(this)"
                            aria-haspopup="true" aria-expanded="false"
                            title="Change date range" aria-label="Change date range. Currently ${safeRangeLabel}">
                        <svg class="ico ico-sm" aria-hidden="true"><use href="#ico-calendar-days"></use></svg>
                        ${safeRangeLabel}
                        <span class="cal-tz-chevron" aria-hidden="true"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-chevron"></use></svg></span>
                    </button>
                    <button type="button" class="cal-tz-evbtn" onclick="CalendarManager.toggleTzEvents()"
                            aria-pressed="${model.showEvents ? 'true' : 'false'}"
                            title="${model.showEvents ? 'Hide events' : 'Show events'}"
                            aria-label="${model.showEvents ? 'Hide events — show bare date bars' : 'Show events on the primary bar'}">
                        <svg class="ico ico-sm" aria-hidden="true"><use href="#ico-calendar"></use></svg>
                    </button>
                </div>
            </div>`;
    },

    // Two explicit segments rather than one flipping button: a lone toggle
    // labelled "24H" is ambiguous about whether it reports the current state
    // or the action, and this control is read at a glance while scanning the
    // hour labels underneath it.
    _tzFormatToggle(model) {
        const seg = (label, is24, title) =>
            `<button type="button" class="cal-tz-fmt-seg" aria-pressed="${model.hour24 === is24 ? 'true' : 'false'}"
                     onclick="CalendarManager.setTzHour24(${is24})" title="${title}">${label}</button>`;
        return `
            <div class="cal-tz-fmt" role="group" aria-label="Time format">
                ${seg('AM/PM', false, 'Show hours as AM/PM')}
                ${seg('24H', true, 'Show hours on a 24-hour clock')}
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
        // --tz-rows is what lets the full-height overlays (.cal-tz-dial and
        // .cal-tz-hover) actually span the stack: `grid-row: 1 / -1` needs an
        // EXPLICIT last row line to reach, and the row tracks here are
        // otherwise entirely implicit. See the grid-template-rows note on
        // .cal-tz-bars.
        // --tz-cells (unitless) sizes the hour grid AND the bars' min-width, so
        // a window too wide to show 25px cells scrolls rather than squeezing
        // the labels out of legibility. --tz-cell-pct is the same number as a
        // percentage, which is what lets the dial's cell highlight snap
        // without any JS layout read.
        const cells = Math.max(1, model.hourCount || 1);
        const dialCellPct = this._tzPct(Math.floor(model.dial.pct / model.cellPct) * model.cellPct);
        return `
            <div class="cal-tz-bars"
                 style="--tz-rows:${model.rows.length};--tz-cells:${cells};--tz-cell-pct:${this._tzPct(model.cellPct)}%;--tz-dial-pct:${this._tzPct(model.dial.pct)}%;--tz-dialcell-pct:${dialCellPct}%;--tz-hovercell-pct:${dialCellPct}%;--tz-now-pct:${this._tzPct(nowPct)}%;--tz-r-left:${this._tzPct(rangeLeft)}%;--tz-r-width:${this._tzPct(rangeWidth)}%"
                 data-start-ms="${model.startMs}" data-span-ms="${model.spanMs}" data-cells="${cells}">
                ${rowsHTML}
                <div class="cal-tz-dial" role="slider" tabindex="0" aria-orientation="horizontal"
                     aria-valuemin="0" aria-valuemax="${spanMin}" aria-valuenow="${dialMin}"
                     aria-valuetext="${Utils.sanitizeHTML(valuetext)}" aria-label="Time dial"
                     onkeydown="UIRenderer.tzDialKeydown(event)">
                    <span class="cal-tz-dial-grip" aria-hidden="true"></span>
                </div>
                <div class="cal-tz-hover" hidden aria-hidden="true"></div>
            </div>`;
    },

    // Row anatomy — a WorldTimeBuddy-style grid of labelled hour cells.
    //
    // The row's `grid-row` is set EXPLICITLY rather than left to auto-place.
    // The full-height overlays (.cal-tz-dial, .cal-tz-hover) are explicitly
    // placed at `grid-row: 1 / -1` in column 2, and auto-placement refuses to
    // put an auto-placed item into a cell an explicitly-placed one already
    // occupies — so the rows got pushed into implicit tracks BELOW the
    // overlays, leaving the overlays spanning three empty 0px tracks. Two
    // explicitly-placed items are allowed to overlap, which is the whole
    // point: the dial and the hover box are meant to lie over every row.
    //
    //   .cal-tz-track   the recessed channel; its first child is
    //                   .cal-tz-cells, a `repeat(var(--tz-cells), 1fr)` grid
    //                   of one cell per ABSOLUTE hour. Uniform width is not a
    //                   style choice: every other layer in this widget is
    //                   positioned by percentage against the same box, so
    //                   equal columns are what keeps the cells, the dial, the
    //                   range band and the now line all agreeing about where
    //                   a given instant is.
    //   .cal-tz-cell    two stacked lines — "7"/"am", or "9:30"/"am" in a
    //                   half-offset zone. The local-midnight cell instead
    //                   carries the DATE ("Thu"/"Sep 10") and is the row's
    //                   only day-boundary marker, which is why nothing here
    //                   draws a separate midnight rule any more.
    //   event pills     absolutely positioned over the bottom strip of the
    //                   track, which .cal-tz-view.has-events reserves for
    //                   them; with events off the cells take the full height.
    _tzRow(row, idx, nowIsNull, hasRange) {
        const safeLabel = Utils.sanitizeHTML(row.label);
        const safeOffset = Utils.sanitizeHTML(row.offsetLabel);
        const readout = row.readout || { time: '', date: '' };

        // The second line is omitted entirely in 24-hour mode rather than
        // rendered empty — an empty span still occupies a line box and would
        // push the hour off centre.
        const cellsHTML = (row.cells || []).map(c => {
            const cls = `cal-tz-cell is-${c.band}${c.isDate ? ' is-date' : ''}`;
            const bot = c.bot ? `<span class="cal-tz-cell-b">${Utils.sanitizeHTML(c.bot)}</span>` : '';
            return `<div class="${cls}" aria-hidden="true"><span class="cal-tz-cell-t">${
                Utils.sanitizeHTML(c.top)}</span>${bot}</div>`;
        }).join('');

        // Pills carry their lane in data-lane (CSS owns the two bottom
        // offsets) and render their title only when the model says the box is
        // wide enough to hold one; the name is always on the tooltip. They are
        // the one thing over the cells that takes pointer events — `closest`
        // still walks up to .cal-tz-bar, so the drag handler is unaffected.
        const eventsHTML = row.isPrimary ? (row.events || []).map(ev => {
            const color = Utils.isValidColor(ev.color) ? ev.color : DEFAULT_CAL_COLOR;
            const safeTitle = Utils.sanitizeHTML(ev.title || 'Untitled');
            return `<div class="cal-tz-ev" data-lane="${ev.lane === 1 ? '1' : '0'}" style="left:${this._tzPct(ev.leftPct)}%;width:${this._tzPct(ev.widthPct)}%;--ev-c:${color}" title="${safeTitle}">${
                ev.showTitle ? `<span class="cal-tz-ev-title">${safeTitle}</span>` : ''
            }</div>`;
        }).join('') : '';

        const moreHTML = row.isPrimary ? (row.eventsOverflow || []).map(o => {
            const names = (o.titles || []).slice(0, 6).map(t => t || 'Untitled').join(', ');
            const safeNames = Utils.sanitizeHTML(names + ((o.titles || []).length > 6 ? '…' : ''));
            const n = Math.max(1, Math.round(o.count) || 1);
            return `<span class="cal-tz-ev-more" style="left:${this._tzPct(o.leftPct)}%" title="${safeNames}"
                          aria-label="${n} more event${n === 1 ? '' : 's'}: ${safeNames}">+${n}</span>`;
        }).join('') : '';

        const bandHTML = hasRange ? `<div class="cal-tz-band" aria-hidden="true"></div>` : '';
        // Always present so the eta-tick hook only ever has to toggle `hidden`
        // (never create/destroy nodes outside a full rebuild) — see _tzTickUpdate.
        const nowlineHTML = `<div class="cal-tz-nowline"${nowIsNull ? ' hidden' : ''} aria-hidden="true"></div>`;

        // The relative-offset badge is suppressed on the primary row, where
        // it would always read "0" — the filled star already says which row
        // everything else is measured against.
        const relHTML = row.relLabel
            ? `<span class="cal-tz-rel" title="${Utils.sanitizeHTML(row.relLabel)} hours from ${Utils.sanitizeHTML(row.label)}'s reference zone" aria-label="${Utils.sanitizeHTML(row.relLabel)} hours from the primary zone">${Utils.sanitizeHTML(row.relLabel)}</span>`
            : '';

        return `
            <div class="cal-tz-row${row.isPrimary ? ' is-primary' : ''}" data-idx="${idx}" style="grid-row:${idx + 1}">
                <div class="cal-tz-rowhead">
                    <button type="button" class="cal-tz-star" onclick="CalendarManager.setTzPrimary(${idx})"
                            aria-pressed="${row.isPrimary ? 'true' : 'false'}"
                            title="Make ${safeLabel} primary" aria-label="Make ${safeLabel} primary">
                        <span aria-hidden="true">★</span>
                    </button>
                    <span class="cal-tz-zname">${safeLabel}</span>
                    <span class="cal-tz-gmt">${safeOffset}</span>
                    ${relHTML}
                    <span class="cal-tz-readout" data-idx="${idx}">
                        <span class="cal-tz-readout-time">${Utils.sanitizeHTML(readout.time || '')}</span><span class="cal-tz-readout-date">${Utils.sanitizeHTML(readout.date || '')}</span>
                    </span>
                </div>
                <div class="cal-tz-bar" role="group" aria-label="Times in ${safeLabel}">
                    <div class="cal-tz-track">
                        <div class="cal-tz-cells">${cellsHTML}</div>
                        ${eventsHTML}
                        ${moreHTML}
                        ${bandHTML}
                        ${nowlineHTML}
                    </div>
                </div>
            </div>`;
    },

    // ---- Range readout / commit bar -------------------------------------------
    // Marking a range is a drag on any row and nothing else — there is no
    // button pair here mirroring the dial, because the dial and the range are
    // no longer coupled (see setTzRange). With no range marked this bar is
    // pure affordance text; that is the only thing telling a first-time user
    // the rows are draggable, so don't drop it for being "just a hint".
    _tzRangeBar(model) {
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
        return `
            <div class="cal-tz-rangebar" aria-live="polite">
                <span class="cal-tz-range-hint">Drag across any row to select a time window.</span>
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
        // The highlighted hour cell under the dial. CSS cannot floor a
        // percentage to a column, so the snap is done here and published as a
        // second variable — still "vars only", still no layout read, one extra
        // setProperty per frame.
        const cells = Number(bars.dataset.cells);
        if (Number.isFinite(cells) && cells > 0) {
            const cellPct = 100 / cells;
            const idx = Math.min(cells - 1, Math.max(0, Math.floor(pct / cellPct)));
            bars.style.setProperty('--tz-dialcell-pct', `${this._tzPct(idx * cellPct)}%`);
        }
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

    // ========================================
    // HOVER — the 60-minute box that follows the cursor across the stack
    // ========================================

    // Same cheap-path contract as the drag: one CSS custom property, no DOM
    // rebuild, and at most ONE getBoundingClientRect per animation frame
    // (pointermove fires far faster than that, so the reads are coalesced
    // exactly the way _attachTzDragHandler coalesces its own frames).
    //
    // The box spans every row, not just the row under the cursor — reading
    // one hour across all four zones at once is the entire point of the
    // widget, and it is what makes hovering a secondary row useful rather
    // than decorative.
    // Clicking away from the rows drops the selection.
    //
    // The allowlist is the whole design here. "Outside the sliders" cannot
    // mean "outside .cal-tz-bars", because the range bar's own Copy and Clear
    // buttons live outside it — clearing on the way to Copy would make the
    // button impossible to use. So the rule is: a click that lands on any
    // control belonging to this tool is never a dismissal, and everything
    // else is.
    //
    // Registered once on the card container (which survives
    // refreshCalendarDayView, unlike the view inside it), and only while the
    // tool is open. A pointerdown that turns into a drag is ignored: the
    // gesture's own commit path already owns the range by then.
    _attachTzClearOutsideHandler(container) {
        container.addEventListener('click', (e) => {
            const cm = window.CalendarManager;
            if (!cm?.state?.tzToolActive) return;
            if (cm.state.tzRangeStartMs == null) return;
            if (this._tzDragActive) return;
            const t = e.target;
            if (!t?.closest) return;
            // Inside the rows: the pointer handler decided what happens.
            if (t.closest('.cal-tz-bars')) return;
            // Any of the tool's own chrome, including the range bar the Clear
            // and Copy buttons sit in.
            if (t.closest('.cal-tz-toolbar, .cal-tz-rangebar, .cal-tz-popover, .calendar-header, .cal-tz-scroll')) return;
            cm.clearTzRange?.();
        });
    },

    // How close to a range edge counts as "grabbing" it, in px. Wide enough
    // to hit with a mouse, narrow enough that a 25px cell is still mostly
    // click-through to the bar underneath.
    TZ_EDGE_GRAB_PX: 7,

    // Which edge of the marked range the pointer is over, or null. Measured
    // off the live CSS custom properties rather than the band's DOM box: the
    // band is pointer-events:none (so clicks reach the bar), and during a
    // resize the vars move a frame ahead of any committed state.
    _tzEdgeAt(bars, clientX) {
        const cm = window.CalendarManager;
        if (cm?.state?.tzRangeStartMs == null || cm?.state?.tzRangeEndMs == null) return null;
        const trackEl = bars.querySelector('.cal-tz-dial') || bars.querySelector('.cal-tz-bar');
        if (!trackEl) return null;
        const rect = trackEl.getBoundingClientRect();
        if (rect.width <= 0) return null;
        const left = parseFloat(bars.style.getPropertyValue('--tz-r-left'));
        const width = parseFloat(bars.style.getPropertyValue('--tz-r-width'));
        if (!Number.isFinite(left) || !Number.isFinite(width) || width <= 0) return null;
        const x0 = rect.left + (left / 100) * rect.width;
        const x1 = rect.left + ((left + width) / 100) * rect.width;
        const grab = this.TZ_EDGE_GRAB_PX;
        const d0 = Math.abs(clientX - x0);
        const d1 = Math.abs(clientX - x1);
        if (d0 > grab && d1 > grab) return null;
        // A one-cell range puts both edges within a grab width of each other;
        // whichever is nearer wins, so the range can still be widened from
        // either side rather than one edge always shadowing the other.
        return d0 <= d1 ? 'start' : 'end';
    },

    _attachTzHoverHandler(container) {
        const hide = () => {
            const bars = container.querySelector('.cal-tz-bars');
            const box = bars?.querySelector('.cal-tz-hover');
            if (box && !box.hasAttribute('hidden')) box.setAttribute('hidden', '');
            bars?.classList.remove('is-edge-grab');
            this._tzHoverPending = null;
        };
        this._tzHideTzHover = hide;

        const runFrame = () => {
            this._tzHoverRaf = null;
            const pend = this._tzHoverPending;
            if (!pend) return;
            const { bars, clientX } = pend;
            if (!bars.isConnected) return;
            const box = bars.querySelector('.cal-tz-hover');
            const trackEl = bars.querySelector('.cal-tz-dial') || bars.querySelector('.cal-tz-bar');
            if (!box || !trackEl) return;
            const cells = Math.max(1, Number(bars.dataset.cells) || 1);
            const rect = trackEl.getBoundingClientRect();
            if (rect.width <= 0) return;
            const frac = (clientX - rect.left) / rect.width;
            // Outside the track entirely (the row head, or past the last
            // cell): no cell to box, so take the indicator away rather than
            // pinning it to an edge it isn't over.
            if (frac < 0 || frac >= 1) { hide(); return; }
            const idx = Math.min(cells - 1, Math.max(0, Math.floor(frac * cells)));
            bars.style.setProperty('--tz-hovercell-pct', `${this._tzPct(idx * (100 / cells))}%`);
            box.removeAttribute('hidden');
            // The only discoverability the resize handles get: without the
            // cursor change nothing tells you the range edges are draggable.
            bars.classList.toggle('is-edge-grab', !!this._tzEdgeAt(bars, clientX));
        };

        container.addEventListener('pointermove', (e) => {
            // Mouse (and pen) only: a touch pointermove would leave the box
            // stranded at the last touched cell with no leave event coming.
            if (e.pointerType === 'touch') return;
            // While a drag is live the range band and the dial already track
            // the pointer; a third box chasing them is noise.
            if (this._tzDragActive) { hide(); return; }
            const bars = e.target.closest?.('.cal-tz-bars');
            const overBar = e.target.closest?.('.cal-tz-row .cal-tz-bar');
            if (!bars || !overBar) { hide(); return; }
            this._tzHoverPending = { bars, clientX: e.clientX };
            if (this._tzHoverRaf === null || this._tzHoverRaf === undefined) {
                this._tzHoverRaf = requestAnimationFrame(runFrame);
            }
        });

        // pointerout bubbles (pointerleave does not), so one delegated
        // listener on the container covers every row.
        container.addEventListener('pointerout', (e) => {
            if (e.pointerType === 'touch') return;
            const to = e.relatedTarget;
            if (to && to.closest?.('.cal-tz-row .cal-tz-bar')) return;   // moved between cells, still inside
            hide();
        });
        container.addEventListener('pointercancel', hide);
    },

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

            const startMs = Number(bars.dataset.startMs);
            const spanMs = Number(bars.dataset.spanMs);
            if (!Number.isFinite(startMs) || !Number.isFinite(spanMs) || spanMs <= 0) return;
            const cellCount = Math.max(1, Number(bars.dataset.cells) || 1);

            // Pointer x is measured against the grid's SECOND column, not
            // against .cal-tz-bars. Everything that draws — the dial line, the
            // range band, every day/night/tick segment — positions with plain
            // percentages inside that column (see the subgrid note at the top
            // of section 15 in 3.1-groups-calendar.css), while the .cal-tz-bars
            // rect also spans the ~156px rowhead column and the 0.75rem gap.
            // Dividing by the wrong width lands the dial ~30px right of the
            // cursor at the far end of the track, and skews a painted range the
            // same way. .cal-tz-dial is the reference because it IS that column
            // (grid-column: 2, grid-row: 1 / -1) and is always rendered.
            const trackEl = bars.querySelector('.cal-tz-dial') || bars.querySelector('.cal-tz-bar') || bars;

            e.preventDefault();
            try { e.target.setPointerCapture?.(e.pointerId); } catch { /* capture is best-effort */ }

            const pointerFrac = (clientX) => {
                const rect = trackEl.getBoundingClientRect();
                return rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
            };

            // The dial keeps its own 15-minute snap: it is the precise instant
            // the readouts and the keyboard slider work in.
            const pointerToMs = (clientX) => {
                const raw = startMs + pointerFrac(clientX) * spanMs;
                const snapped = Math.round(raw / 900000) * 900000;
                return Math.min(startMs + spanMs, Math.max(startMs, snapped));
            };

            // A painted range snaps to whole hour CELLS instead, so the
            // selection always lands on the column boundaries the user can
            // actually see — dragging across "9am 10am 11am" selects exactly
            // those three, never 9:15-11:45.
            const pointerToCell = (clientX) =>
                Math.min(cellCount - 1, Math.max(0, Math.floor(pointerFrac(clientX) * cellCount)));
            const cellEdgeMs = (i) => startMs + (Math.min(cellCount, Math.max(0, i)) / cellCount) * spanMs;

            // A resize handle sits ON a boundary, so it takes the cell on its
            // OWN side of it: the start handle the cell to its right, the end
            // handle the cell to its left. Plain floor() for both would put the
            // end handle in the cell AFTER the boundary it is sitting on, and
            // merely grabbing it without moving would extend the range by an
            // hour. Past the opposite edge the bias stops mattering — the
            // min/max below picks the crossing up either way.
            const resizeCell = (clientX, which) => {
                const raw = pointerFrac(clientX) * cellCount;
                const i = which === 'end' ? Math.ceil(raw) - 1 : Math.floor(raw);
                return Math.min(cellCount - 1, Math.max(0, i));
            };

            // Grabbing an edge of an existing range resizes it instead of
            // starting a new one. Checked before anything else because the
            // edge sits ON a cell that would otherwise begin a fresh paint.
            const edge = onDial ? null : this._tzEdgeAt(bars, e.clientX);
            const cm0 = window.CalendarManager;
            const fixedCell = edge
                ? Math.round((((edge === 'start' ? cm0.state.tzRangeEndMs : cm0.state.tzRangeStartMs) - startMs) / spanMs) * cellCount)
                : null;

            const state = {
                bars, startMs, spanMs, pointerToMs,
                pointerId: e.pointerId,
                startX: e.clientX,
                // Every bar behaves the same: drag paints a range, click marks
                // a single hour. The old primary-only rule meant the two
                // secondary rows silently did something different from the one
                // above them, which is exactly the affordance worldtimebuddy
                // gets right — any row is a slider.
                mode: onDial ? 'dial' : (edge ? 'resize' : 'bar'),
                edge,
                // For a resize the OPPOSITE edge is the anchor, so dragging the
                // left handle past the right one flips the range rather than
                // collapsing it. Stored as a cell boundary index, which is what
                // cellEdgeMs consumes.
                fixedCell,
                moved: false,
                rangeAnchorCell: null,
                pendingRange: null,
                pendingClientX: e.clientX,
                rafId: null,
                preDialPct: bars.style.getPropertyValue('--tz-dial-pct'),
                preDialCell: bars.style.getPropertyValue('--tz-dialcell-pct'),
                preRLeft: bars.style.getPropertyValue('--tz-r-left'),
                preRWidth: bars.style.getPropertyValue('--tz-r-width'),
            };
            this._tzDrag = state;
            this._tzDragActive = true;
            this._tzHideTzHover?.();

            // Coalesce pointermove handling into one rAF per frame — the shape
            // mirrors minimap.js's _scheduleDragFrame/_runDragFrame.
            const runFrame = () => {
                state.rafId = null;
                if (this._tzDrag !== state) return;
                const dx = state.pendingClientX - state.startX;
                if (!state.moved) {
                    // A resize commits on the first pixel: the pointer is
                    // already on the handle, so there is no "did they mean to
                    // click instead" ambiguity to wait out.
                    if (state.mode !== 'resize' && Math.abs(dx) < 5) return;
                    state.moved = true;
                    if (state.mode === 'bar') {
                        // Committing to a range paint: anchor on the cell under
                        // the POINTERDOWN, not wherever we have dragged to.
                        state.rangeAnchorCell = pointerToCell(state.startX);
                        state.mode = 'range';
                    }
                    // 'resize' deliberately stays 'resize'. A paint anchors on a
                    // CELL (both ends inclusive); a resize anchors on the
                    // opposite edge's BOUNDARY, which must not move even when
                    // the dragged edge crosses it. Forcing the two through one
                    // formula shifted that fixed edge by an hour on every flip.
                }
                if (state.mode === 'range' || state.mode === 'resize') {
                    let lo, hi;
                    if (state.mode === 'resize') {
                        const c = resizeCell(state.pendingClientX, state.edge);
                        // min/max against the fixed boundary: the untouched edge
                        // stays put, and dragging past it flips the range around
                        // that boundary instead of collapsing it to nothing.
                        lo = cellEdgeMs(Math.min(c, state.fixedCell));
                        hi = cellEdgeMs(Math.max(c + 1, state.fixedCell));
                    } else {
                        // Inclusive of both end cells, so a drag that never
                        // leaves the cell it started in still selects that hour.
                        const c = pointerToCell(state.pendingClientX);
                        lo = cellEdgeMs(Math.min(state.rangeAnchorCell, c));
                        hi = cellEdgeMs(Math.max(state.rangeAnchorCell, c) + 1);
                    }
                    bars.style.setProperty('--tz-r-left', `${this._tzPct(((lo - startMs) / spanMs) * 100)}%`);
                    bars.style.setProperty('--tz-r-width', `${this._tzPct(((hi - lo) / spanMs) * 100)}%`);
                    state.pendingRange = { startMs: lo, endMs: hi };
                } else {
                    this._tzWriteDial(bars, pointerToMs(state.pendingClientX), startMs, spanMs);
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
                    bars.style.setProperty('--tz-dialcell-pct', state.preDialCell || '0%');
                    bars.style.setProperty('--tz-r-left', state.preRLeft || '0%');
                    bars.style.setProperty('--tz-r-width', state.preRWidth || '0%');
                    this._flushDeferredRender();
                    return;
                }

                if (!state.moved) {
                    const x = ev ? ev.clientX : state.startX;
                    if (state.mode === 'resize') {
                        // Pressed a resize handle and let go without moving.
                        // That is a no-op, NOT a click on the cell underneath:
                        // otherwise merely touching a handle would collapse the
                        // whole window down to the single hour beneath it.
                        this._flushDeferredRender();
                        return;
                    }
                    if (state.mode === 'dial') {
                        // On the dial itself a click is just a nudge of the dial.
                        cm?.setTzDialMs?.(pointerToMs(x));
                    } else {
                        // Anywhere on a row: the clicked hour BECOMES the
                        // window, replacing whatever was selected. One click is
                        // therefore both "clear the old selection" and "select
                        // this hour" — the two are the same gesture, so there is
                        // no state where a stale range outlives the click that
                        // replaced it. The dial follows to the window's start so
                        // the row readouts agree with the chips.
                        const c = pointerToCell(x);
                        cm?.setTzDialMs?.(cellEdgeMs(c));
                        cm?.setTzRange?.(cellEdgeMs(c), cellEdgeMs(c + 1));
                    }
                } else if ((state.mode === 'range' || state.mode === 'resize') && state.pendingRange) {
                    // One commit, one refresh — and the dial stays where it
                    // was, which is why the paint only ever wrote --tz-r-left/
                    // --tz-r-width and never touched --tz-dial-pct.
                    const { startMs: lo, endMs: hi } = state.pendingRange;
                    if (hi > lo) {
                        cm?.setTzRange?.(lo, hi);
                    } else {
                        // Both ends snapped to the same quarter-hour: nothing to
                        // mark, and setTzRange declines it — so no rebuild is
                        // coming to regenerate the vars. Put the band back by
                        // hand or an existing range would silently disappear
                        // from the bars while still living in state.
                        bars.style.setProperty('--tz-r-left', state.preRLeft || '0%');
                        bars.style.setProperty('--tz-r-width', state.preRWidth || '0%');
                    }
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

    // Two-click range picker, not a single start-date picker.
    //
    //   1st click  -> that date becomes the start AND the whole window (1 day);
    //                 everything outside [start, start+MAX-1] dims, because
    //                 those dates cannot be an end for this start.
    //   2nd click  inside the undimmed tail -> that date is the end; commit and
    //                 close, the interaction is finished.
    //              on the start itself      -> reset back to the 1-day window
    //                 and wait for a fresh end pick.
    //              on a dimmed date         -> that is a NEW start (step 1 again).
    //
    // Dimmed cells stay clickable on purpose: dimming says "not a valid end",
    // and the escape hatch from a wrong start is to click the date you actually
    // wanted, not to first undo the one you picked.
    //
    // Every click commits immediately, which rebuilds the card body and so
    // REPLACES the button this popover is anchored to — hence `anchor` is a
    // live reference re-acquired after each commit rather than the captured
    // `btn`. Everything downstream (dismiss detection, aria-expanded, refocus
    // on close, repositioning under a label that changes width) reads it.
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

        const MAX = Number(cm.TZ_MAX_DAYS) || 3;
        let anchor = btn;

        const weekHead = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
            .map(w => `<span class="cal-tz-datepop-wd" aria-hidden="true">${w}</span>`).join('');

        // Only the immutable bits are baked into the markup; is-start/is-end/
        // is-inspan/is-dim and the roving tabindex are all owned by paint().
        const cellsHTML = days.map((d, i) => {
            const full = this._tzFullDateLabel(d.dateStr) || d.label || d.dateStr;
            const safeFull = Utils.sanitizeHTML(full);
            return `<button type="button" class="cal-tz-daycell${d.isToday ? ' is-today' : ''}" id="calTzDayCell-${i}"
                            data-datestr="${Utils.sanitizeHTML(d.dateStr)}" aria-pressed="false"
                            aria-label="${safeFull}" title="${safeFull}" tabindex="-1">${Utils.sanitizeHTML(String(d.dayNum))}</button>`;
        }).join('');

        const pop = document.createElement('div');
        pop.className = 'cal-tz-popover cal-tz-datepop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Choose date range');
        pop.innerHTML = `
            <div class="cal-tz-datepop-head">${weekHead}</div>
            <div class="cal-tz-datepop-grid">${cellsHTML}</div>
            <p class="cal-tz-datepop-hint" role="status"></p>`;
        document.body.appendChild(pop);
        this._tzPositionPopover(pop, anchor);

        const cells = [...pop.querySelectorAll('.cal-tz-daycell')];
        const hint = pop.querySelector('.cal-tz-datepop-hint');

        // Opening selection = the committed window. `end` is null for a 1-day
        // window, which is also the "waiting for an end pick" state — the two
        // are deliberately the same state, so reopening the picker resumes
        // exactly where the last interaction left off.
        const sel = {
            start: days.find(d => d.isStart)?.dateStr || null,
            end: days.find(d => d.isEnd)?.dateStr || null
        };
        const labelOf = (dateStr) => days.find(d => d.dateStr === dateStr)?.label || dateStr || '';

        const paint = () => {
            const spanLen = (sel.start && sel.end) ? (cm._daysBetweenUTC(sel.start, sel.end) + 1) : 1;
            let startIdx = -1;
            cells.forEach((cell, i) => {
                const ds = cell.dataset.datestr;
                const off = sel.start ? cm._daysBetweenUTC(sel.start, ds) : NaN;
                const isStart = !!sel.start && ds === sel.start;
                const isEnd = !!sel.end && ds === sel.end;
                if (isStart) startIdx = i;
                cell.classList.toggle('is-start', isStart);
                cell.classList.toggle('is-end', isEnd);
                cell.classList.toggle('is-inspan', !isStart && !isEnd && Number.isFinite(off) && off > 0 && off < spanLen);
                cell.classList.toggle('is-dim', !!sel.start && !(Number.isFinite(off) && off >= 0 && off < MAX));
                cell.setAttribute('aria-pressed', (isStart || isEnd) ? 'true' : 'false');
                cell.tabIndex = -1;
            });
            // Roving tabindex: the selected start owns the tab stop, except
            // while a cell has focus — repainting must not move the tab stop
            // out from under the keyboard user mid-interaction.
            const focused = cells.indexOf(document.activeElement);
            const stop = focused >= 0 ? focused : (startIdx >= 0 ? startIdx : 0);
            if (cells[stop]) cells[stop].tabIndex = 0;

            if (!sel.start) hint.textContent = 'Pick a start date.';
            else if (!sel.end) hint.textContent = `${labelOf(sel.start)} · 1 day. Pick an end date (up to ${MAX} days), or click it again to reset.`;
            else hint.textContent = `${labelOf(sel.start)} – ${labelOf(sel.end)} · ${spanLen} days.`;
        };

        const close = (refocus) => {
            pop.remove();
            document.removeEventListener('click', this._tzPickerDismiss, true);
            document.removeEventListener('keydown', this._tzPickerKeydown, true);
            this._tzPickerDismiss = this._tzPickerKeydown = this._tzPickerClose = null;
            this._tzPickerKind = this._tzPickerInvoker = null;
            anchor?.setAttribute('aria-expanded', 'false');
            if (refocus && anchor?.isConnected) anchor.focus();
        };
        this._tzPickerClose = close;
        this._tzPickerKind = 'date';
        this._tzPickerInvoker = anchor;
        anchor.setAttribute('aria-expanded', 'true');

        const commit = (startStr, dayCount) => {
            cm.setTzStartDate?.(startStr, dayCount);
            const fresh = document.querySelector('.calendar-group .cal-tz-datebtn');
            if (fresh) {
                anchor = fresh;
                this._tzPickerInvoker = anchor;
                anchor.setAttribute('aria-expanded', 'true');
            }
            // The button's label changes width with the window, so re-anchor
            // even when the node itself survived (a no-op commit).
            this._tzPositionPopover(pop, anchor);
        };

        const pick = (cell) => {
            const ds = cell?.dataset.datestr;
            if (!ds) return;
            if (sel.start) {
                const off = cm._daysBetweenUTC(sel.start, ds);
                if (off === 0) {
                    sel.end = null;
                    commit(sel.start, 1);
                    paint();
                    return;
                }
                if (Number.isFinite(off) && off > 0 && off < MAX) {
                    sel.end = ds;
                    commit(sel.start, off + 1);
                    paint();
                    close(true);
                    return;
                }
            }
            sel.start = ds;
            sel.end = null;
            commit(ds, 1);
            paint();
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

        this._tzPickerDismiss = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(false); };
        this._tzPickerKeydown = (e) => { if (e.key === 'Escape') close(true); };
        document.addEventListener('click', this._tzPickerDismiss, true);
        document.addEventListener('keydown', this._tzPickerKeydown, true);

        paint();
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
