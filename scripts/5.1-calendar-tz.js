// ==========================================
// 5.1-CALENDAR-TZ.JS - extends CalendarManager (family 5.x)
// Anderson Homepage
//
// Multi-timezone comparison tool: up to 4 IANA zones stacked on one shared
// absolute-time axis (World-Time-Buddy style), a draggable dial, and an
// optional marked range. The window is 1-3 days wide (TZ_MAX_DAYS), chosen
// in the date picker. This file is DATA ONLY — geometry (percentages,
// segment lists) and persistence, no HTML. The renderer lives in
// scripts/10.3-renderer-tz.js.
//
// Must load after scripts/5-calendar.js (extends CalendarManager, reuses
// its _zonedDayStartMs/_dateOnly/_timeStr/_tzLabel/_displayTimezones/
// getDayViewWindow/_baseOffsetFromToday/getEventsInRange/_eventHidden).
// ==========================================

// ---- Ephemeral state (precedent: dayViewOffset in 5-calendar.js) ----------
// Mode itself (tzToolActive) resets on reload; the persisted zones/primary
// live in localStorage under config.storageKeys.tzTool, added there in
// 5-calendar.js. tzDialMs is null until the first buildTzModel() call
// materializes it to "now, snapped" — after that it is a FIXED instant and
// does not track the clock (see buildTzModel's comment).
Object.assign(CalendarManager.state, {
    tzToolActive: false,
    tzStartDateStr: null,   // 'YYYY-MM-DD' in the primary zone; null = today
    tzDayCount: null,       // 1..TZ_MAX_DAYS; null = the full TZ_MAX_DAYS window
    tzDialMs: null,
    tzRangeStartMs: null,
    tzRangeEndMs: null
});

Object.assign(CalendarManager, {
    // Widest window the tool will draw, and the cap the date picker dims
    // against. Three days of four zones is already ~72 hour ticks per row;
    // past that the bars stop being readable at card width, which is the
    // reason for the limit — it is not an arbitrary number, so if it moves,
    // re-check the tick density and .cal-tz-bars' min-width together.
    TZ_MAX_DAYS: 3,

    // Per-zone Intl.DateTimeFormat cache for _zonedTimeMs. A single
    // buildTzModel() call makes on the order of a hundred conversions (hour
    // ticks × up to 4 zones × several local days, plus night boundaries), and
    // constructing a formatter is the expensive part of that call — reuse one
    // per zone rather than one per conversion. Reset (not because it goes
    // stale — a zone's formatter is timeless — but defensively) whenever the
    // configured zone set changes.
    _tzFmtCache: {},

    // ---- Mode toggle ---------------------------------------------------------

    toggleTzTool() {
        this.state.tzToolActive = !this.state.tzToolActive;
        // Full card render: the header globe button's aria-pressed state and
        // the entire card body both change with this flip.
        window.UIRenderer?.renderCalendarCard();
    },

    // ---- Persisted config: { zones: [...IANA ids, 1-4], primary: <int> } ----

    // Shared validator for a candidate zone list: keeps only ids this engine
    // can actually format (an unformattable zone throws the moment any Intl
    // call here touches it), dedupes, caps at 4. Used by both the getter and
    // setter so "what counts as a valid zone list" has one definition; the
    // import() validation block in 1.1-core-storage.js re-implements the same
    // rule by hand because it runs before this file loads.
    _validateTzZones(list) {
        if (!Array.isArray(list)) return [];
        const seen = new Set();
        const out = [];
        for (const z of list) {
            if (typeof z !== 'string' || seen.has(z)) continue;
            try {
                new Intl.DateTimeFormat('en-US', { timeZone: z });
            } catch {
                continue;
            }
            seen.add(z);
            out.push(z);
            if (out.length >= 4) break;
        }
        return out;
    },

    // Never returns an empty zones array: an invalid/missing config falls
    // back to the header clocks' zones (so the tool starts comparing
    // something the user already set up), then to the browser's own zone.
    // showEvents defaults ON and is stored, not ephemeral: it is a standing
    // display choice like the zone set, not a per-visit view state like
    // tzToolActive/tzDayCount. Anything added here must also be handled by
    // Storage.import()'s calendarTzTool block, which re-validates by hand.
    getTzToolConfig() {
        const raw = localStorage.getItem(this.config.storageKeys.tzTool);
        const parsed = raw ? Utils.safeJSONParse(raw, null) : null;
        let zones = this._validateTzZones(parsed && parsed.zones);
        if (zones.length === 0) {
            const display = this._displayTimezones().map(t => t.id).slice(0, 4);
            zones = display.length > 0 ? display : [Intl.DateTimeFormat().resolvedOptions().timeZone];
        }
        let primary = parseInt(parsed && parsed.primary, 10);
        if (!Number.isFinite(primary)) primary = 0;
        primary = Math.min(Math.max(primary, 0), zones.length - 1);
        // Only an explicit stored `false` turns events off — a missing key
        // (every config written before this option existed) must read as on.
        const showEvents = !(parsed && parsed.showEvents === false);
        // hour24 is the mirror image: absent means 12-hour, the format the
        // cells shipped with, so only an explicit `true` opts in.
        const hour24 = !!(parsed && parsed.hour24 === true);
        return { zones, primary, showEvents, hour24 };
    },

    setTzToolConfig(cfg) {
        const zones = this._validateTzZones(cfg && cfg.zones);
        if (zones.length === 0) return;   // nothing valid survived — leave the stored config alone
        let primary = parseInt(cfg && cfg.primary, 10);
        if (!Number.isFinite(primary)) primary = 0;
        primary = Math.min(Math.max(primary, 0), zones.length - 1);
        const showEvents = !(cfg && cfg.showEvents === false);
        const hour24 = !!(cfg && cfg.hour24 === true);
        Utils.safeLocalStorageSet(this.config.storageKeys.tzTool, JSON.stringify({ zones, primary, showEvents, hour24 }));
        this._tzFmtCache = {};
        // Scoped refresh (not renderCalendarCard): zone/primary changes only
        // need the day-view body rebuilt, same as the other tz mutators.
        window.UIRenderer?.refreshCalendarDayView();
    },

    // idx targets an existing slot; no-op if zoneId already occupies a
    // DIFFERENT slot (swapping would need an explicit two-slot operation this
    // tool doesn't expose — the picker just declines the pick instead).
    setTzZone(idx, zoneId) {
        const cfg = this.getTzToolConfig();
        if (idx < 0 || idx >= cfg.zones.length || typeof zoneId !== 'string') return;
        if (cfg.zones[idx] === zoneId) return;
        try { new Intl.DateTimeFormat('en-US', { timeZone: zoneId }); } catch { return; }
        if (cfg.zones.includes(zoneId)) return;
        cfg.zones[idx] = zoneId;
        this.setTzToolConfig(cfg);
    },

    addTzZone(zoneId) {
        const cfg = this.getTzToolConfig();
        if (cfg.zones.length >= 4 || typeof zoneId !== 'string') return;
        try { new Intl.DateTimeFormat('en-US', { timeZone: zoneId }); } catch { return; }
        if (cfg.zones.includes(zoneId)) return;
        cfg.zones.push(zoneId);
        this.setTzToolConfig(cfg);
    },

    // Keeps at least one zone. Shifts primary down when a zone ABOVE it is
    // removed (indices below primary all move down by one); resets to 0 when
    // primary itself is the one removed, rather than leaving it dangling.
    removeTzZone(idx) {
        const cfg = this.getTzToolConfig();
        if (cfg.zones.length <= 1 || idx < 0 || idx >= cfg.zones.length) return;
        cfg.zones.splice(idx, 1);
        if (idx < cfg.primary) cfg.primary -= 1;
        else if (idx === cfg.primary) cfg.primary = 0;
        this.setTzToolConfig(cfg);
    },

    setTzPrimary(idx) {
        const cfg = this.getTzToolConfig();
        if (idx < 0 || idx >= cfg.zones.length) return;
        cfg.primary = idx;
        this.setTzToolConfig(cfg);
    },

    // Events off = bare date/night bars, which is what the tool is for when
    // you are only comparing wall clocks. buildTzModel skips the whole event
    // scan in that state rather than rendering it hidden.
    toggleTzEvents() {
        const cfg = this.getTzToolConfig();
        cfg.showEvents = !cfg.showEvents;
        this.setTzToolConfig(cfg);
    },

    // Takes an explicit value rather than toggling: the control is a two-way
    // segmented pair, and each half means "be this", not "flip".
    setTzHour24(on) {
        const cfg = this.getTzToolConfig();
        const next = !!on;
        if (cfg.hour24 === next) return;
        cfg.hour24 = next;
        this.setTzToolConfig(cfg);
    },

    // ---- Conversion primitive -------------------------------------------------

    _tzFormatter(tz) {
        if (!this._tzFmtCache[tz]) {
            this._tzFmtCache[tz] = new Intl.DateTimeFormat('en-US', {
                timeZone: tz, hour12: false, year: 'numeric', month: '2-digit',
                day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        }
        return this._tzFmtCache[tz];
    },

    // UTC-ms of local wall-clock (dateStr, hh:mm) in zone tz. Generalization
    // of _zonedDayStartMs's guess-and-correct: format an initial guess in tz,
    // measure how far tz's reading at that guess is from the target, and
    // subtract that offset once. (_zonedDayStartMs itself is left untouched —
    // this duplicates its algorithm rather than routing through it, since
    // that one is hardcoded to hour=minute=0 and is depended on elsewhere.)
    _zonedTimeMs(dateStr, hh, mm, tz) {
        const [y, mo, d] = dateStr.split('-').map(Number);
        const utcGuess = Date.UTC(y, mo - 1, d, hh, mm);
        if (!tz) return new Date(y, mo - 1, d, hh, mm).getTime();   // local zone
        const parts = this._tzFormatter(tz).formatToParts(new Date(utcGuess));
        const m = {};
        for (const p of parts) m[p.type] = p.value;
        let hour = +m.hour; if (hour === 24) hour = 0;   // some engines emit '24' for midnight
        const localAsUTC = Date.UTC(+m.year, +m.month - 1, +m.day, hour, +m.minute, +m.second);
        const offset = localAsUTC - utcGuess;
        return utcGuess - offset;
    },

    // dateStr -> dateStr, n days later/earlier, via date-only UTC arithmetic
    // (Date.UTC + setUTCDate) — never local Date#setDate, which can skip or
    // duplicate a day when reprojected across a DST boundary.
    _addDaysUTC(dateStr, n) {
        const [y, mo, d] = dateStr.split('-').map(Number);
        const dt = new Date(Date.UTC(y, mo - 1, d));
        dt.setUTCDate(dt.getUTCDate() + n);
        return this._dateOnly(dt, 'UTC');
    },

    // Whole days from dateStr `a` to dateStr `b` (signed, b - a). Same
    // date-only UTC discipline as _addDaysUTC — the two dates are calendar
    // labels, so a local-midnight subtraction across a DST edge would round
    // to the wrong day.
    _daysBetweenUTC(a, b) {
        const pa = String(a).split('-').map(Number);
        const pb = String(b).split('-').map(Number);
        if (pa.length !== 3 || pb.length !== 3 || pa.some(n => !Number.isFinite(n)) || pb.some(n => !Number.isFinite(n))) return NaN;
        const ta = Date.UTC(pa[0], pa[1] - 1, pa[2]);
        const tb = Date.UTC(pb[0], pb[1] - 1, pb[2]);
        return Math.round((tb - ta) / 86400000);
    },

    // Effective window width in days. Clamped on read rather than on write so
    // a restored/hand-edited state can never widen the window past the cap.
    _tzDayCount() {
        const n = parseInt(this.state.tzDayCount, 10);
        if (!Number.isFinite(n)) return this.TZ_MAX_DAYS;
        return Math.min(Math.max(n, 1), this.TZ_MAX_DAYS);
    },

    _tzStartDateStr(primaryTz) {
        const s = this.state.tzStartDateStr;
        if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        return this._dateOnly(new Date(), primaryTz);
    },

    // { startMs, endMs, spanMs, primaryTz, dayCount, dateStrs: [d0..dN] }
    // spanMs is an hour short or long of dayCount*24h across a DST edge in the
    // primary zone and that is correct — NEVER startMs + dayCount*86400000.
    // dateStrs are date-only UTC strings (see getDayViewWindow's identical
    // discipline in 5-calendar.js); each row later walks its OWN local dates
    // through _zonedDayStartMs rather than reusing these.
    getTzWindow() {
        const cfg = this.getTzToolConfig();
        const primaryTz = cfg.zones[cfg.primary];
        const dayCount = this._tzDayCount();
        const d0 = this._tzStartDateStr(primaryTz);
        const dateStrs = [d0];
        for (let i = 1; i < dayCount; i++) dateStrs.push(this._addDaysUTC(dateStrs[i - 1], 1));
        const dEnd = this._addDaysUTC(dateStrs[dayCount - 1], 1);
        const startMs = this._zonedDayStartMs(d0, primaryTz);
        const endMs = this._zonedDayStartMs(dEnd, primaryTz);
        return { startMs, endMs, spanMs: endMs - startMs, primaryTz, dayCount, dateStrs };
    },

    // ---- Per-zone geometry -----------------------------------------------

    // Whole absolute hours in the window. Derived from the REAL span, so a
    // DST day makes this 71 or 73 rather than 72 — never dayCount * 24.
    _tzHourCount(spanMs) {
        return Math.max(1, Math.round(spanMs / 3600000));
    },

    // One labelled record per absolute hour of the window, for `zone`.
    //
    // This single walk replaces what used to be three separate passes (day
    // segments, night segments, hour ticks). A WorldTimeBuddy-style grid does
    // not need them: the cell IS the tick, its band IS the shading, and its
    // midnight cell IS the date boundary. It also reads better — you see the
    // local hour written out instead of decoding a shaded region against a
    // rule.
    //
    // Cells are ABSOLUTE hours, so column k is the same instant in every row
    // and the shared-axis invariant this whole tool rests on is untouched. A
    // zone on a :30/:45 offset just reads "9:30" at the boundary, which is
    // exactly what those zones do — that is the reason the label carries
    // minutes at all, and why the band test reads the local hour rather than
    // the column index.
    _zoneHourCells(zone, startMs, hourCount, hour24) {
        const fmt = this._tzFormatter(zone);
        const cells = [];
        for (let i = 0; i < hourCount; i++) {
            const ms = startMs + i * 3600000;
            const p = {};
            for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
            let h = +p.hour;
            if (h === 24) h = 0;              // some engines emit '24' for midnight
            const min = +p.minute;

            // Local midnight takes the date cell. That cell is the day
            // boundary marker, which is why nothing else in the row draws
            // one — no separate rule, no separate label layer, and no way
            // for the two to disagree.
            if (h === 0) {
                const { wkday, dateLabel } = this._tzDateLabel(`${p.year}-${p.month}-${p.day}`);
                // Midnight sits inside the night band; the cell is set apart by
                // its rule and its uppercase date, not by a third colour.
                cells.push({ band: 'night', isDate: true, top: wkday, bot: dateLabel });
                continue;
            }

            const mm = String(min).padStart(2, '0');
            const h12 = (h % 12) || 12;
            cells.push({
                // Exactly two bands, split at 06:00 and 18:00. An earlier cut
                // had a third "shoulder" shade either side of the working day;
                // it read as a third kind of thing rather than as a gradient,
                // so day/night is the whole vocabulary now.
                band: (h >= 18 || h < 6) ? 'night' : 'day',
                isDate: false,
                // 24-hour mode is zero-padded so the column of numbers stays a
                // straight edge, and carries no second line at all — `bot` is
                // empty and the renderer drops the span rather than rendering
                // a blank one that would still take a line box.
                top: hour24
                    ? (min ? `${String(h).padStart(2, '0')}:${mm}` : String(h).padStart(2, '0'))
                    : (min ? `${h12}:${mm}` : String(h12)),
                bot: hour24 ? '' : (h < 12 ? 'am' : 'pm')
            });
        }
        return cells;
    },

    // Minutes east of UTC for `zone` at instant `ms` — the generic form of
    // the guess-and-correct in _zonedTimeMs, reading the offset out instead
    // of cancelling it.
    _tzUtcOffsetMin(zone, ms) {
        const p = {};
        for (const part of this._tzFormatter(zone).formatToParts(new Date(ms))) p[part.type] = part.value;
        let h = +p.hour;
        if (h === 24) h = 0;
        const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second);
        return Math.round((asUTC - ms) / 60000);
    },

    // The row's leading badge: hours from the PRIMARY zone, not from UTC —
    // "this call is +7 for them" is the question the tool exists to answer,
    // and each row already carries its own UTC offset in a second badge.
    // Decimal rather than integer because :30 and :45 zones exist (India
    // reads +9.5 against New York, Nepal +9.75), and evaluated at `atMs`
    // rather than now, since two zones' gap changes across a DST edge.
    _tzRelOffsetLabel(zone, primaryTz, atMs) {
        if (!zone || !primaryTz || zone === primaryTz) return '';
        let mins;
        try {
            mins = this._tzUtcOffsetMin(zone, atMs) - this._tzUtcOffsetMin(primaryTz, atMs);
        } catch (_) {
            return '';
        }
        if (!Number.isFinite(mins) || mins === 0) return '0';
        const hours = mins / 60;
        // Trim 9.50 -> 9.5 and 7.00 -> 7 without printing a bare '.'
        const body = Math.abs(hours).toFixed(2).replace(/\.?0+$/, '');
        return `${hours > 0 ? '+' : '-'}${body}`;
    },

    // Timed, non-hidden events overlapping [startMs, endMs). Hoists the
    // hidden-calendar lookup ONCE for the whole scan — _eventHidden (and by
    // extension getEventsInRange, which calls it per event) reads
    // localStorage on every call, and this model does the scan once per
    // build, not once per event.
    _tzPrimaryEvents(startMs, endMs) {
        const hidden = this.getHiddenCalendars();
        const hiddenNames = hidden.length
            ? this.getCalendars().filter(c => hidden.includes(c.url)).map(c => c.name)
            : [];
        const isHidden = (ev) => {
            if (!hidden.length) return false;
            if (ev._calUrl) return hidden.includes(ev._calUrl);
            if (ev._calName) return hiddenNames.includes(ev._calName);
            return false;
        };
        const out = [];
        for (const ev of this.state.events) {
            if (!ev || !ev.start || ev.allDay) continue;
            if (isHidden(ev)) continue;
            const start = new Date(ev.start).getTime();
            if (!Number.isFinite(start)) continue;
            const endRaw = ev.end ? new Date(ev.end).getTime() : start;
            const effectiveEnd = (Number.isFinite(endRaw) && endRaw > start) ? endRaw : start;
            if (!(start < endMs && effectiveEnd > startMs)) continue;
            out.push({ ev, start, effectiveEnd });
        }
        return out;
    },

    // Greedy first-fit lane packing for the primary row's event pills.
    //
    // The bars used to draw every event as a near-full-height 35%-opacity
    // slab, so overlapping events simply painted over one another: compounding
    // washes, colliding titles, and one-letter slivers. Pills are thin and
    // opaque instead, which only works if they never overlap — hence lanes.
    //
    // Two lanes, and no more: at TZ_EV_LANES × pill height plus gutters, a
    // third would leave no visible track above it, and a fourth would be a
    // sliver. Whatever does not fit is RETURNED, never silently dropped —
    // buildTzModel turns it into "+n" markers, so the row can always account
    // for every event it was given.
    TZ_EV_LANES: 2,

    _tzLayoutEvents(list, spanMs) {
        // Horizontal gutter as a fraction of the window, so the gap between
        // two pills in a lane stays a constant few pixels whether one day or
        // three are on screen. Without it, back-to-back events (one ending
        // exactly as the next begins) fuse into a single bar.
        const gutter = spanMs * 0.005;
        const sorted = [...list].sort((a, b) => a.segStart - b.segStart || b.segEnd - a.segEnd);
        const laneEnd = new Array(this.TZ_EV_LANES).fill(-Infinity);
        const placed = [];
        const dropped = [];
        for (const ev of sorted) {
            let lane = -1;
            for (let i = 0; i < laneEnd.length; i++) {
                if (laneEnd[i] <= ev.segStart - gutter) { lane = i; break; }
            }
            if (lane < 0) { dropped.push(ev); continue; }
            laneEnd[lane] = ev.segEnd;
            placed.push({ ...ev, lane });
        }
        return { placed, dropped };
    },

    // ---- Labels ---------------------------------------------------------------

    _tzDateLabel(dateStr) {
        const [y, mo, d] = dateStr.split('-').map(Number);
        const dt = new Date(Date.UTC(y, mo - 1, d));
        return {
            wkday: dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
            dateLabel: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
        };
    },

    // 'Tue, Sep 1' — no relative (Today/Tomorrow) labels, unlike _dayIndicator:
    // this tool compares zones against each other, where "Today" would be
    // ambiguous (it can be a different calendar date in two rows at once).
    _tzFriendlyDate(date, tz) {
        const opts = { weekday: 'short', month: 'short', day: 'numeric' };
        if (tz) opts.timeZone = tz;
        return date.toLocaleDateString('en-US', opts);
    },

    // 12-hour clock for human-readable payloads (range chips + the clipboard
    // text) — deliberately NOT _timeStr (24h, used for the dial's compact
    // mono readout): this is prose meant to be pasted into a message to
    // someone in another timezone. Some ICU builds insert U+202F (narrow
    // no-break space) before AM/PM; normalized to a plain space so the
    // copied text never carries an invisible character.
    _tzRangeTimeStr(date, tz) {
        const opts = { hour: 'numeric', minute: '2-digit', hour12: true };
        if (tz) opts.timeZone = tz;
        return new Intl.DateTimeFormat('en-US', opts).format(date).replace(/ /g, ' ');
    },

    _tzOffsetLabel(zone) {
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: zone, timeZoneName: 'shortOffset'
            }).formatToParts(new Date());
            let name = parts.find(p => p.type === 'timeZoneName')?.value || '';
            if (name === 'GMT') name = 'GMT+0';   // UTC and friends report bare "GMT"
            return name;
        } catch (_) {
            return '';
        }
    },

    // Zero-padded 24h HH:MM for the dial readouts. NOT _timeStr, which drops
    // the leading zero and omits ":00" — fine beside an event's "7 – 8", but
    // a lone readout chip reading "21" or "7" is ambiguous, and the varying
    // width defeats the tabular-nums alignment the mono chips are sized for.
    _tzClockStr(date, tz) {
        const opts = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
        if (tz) opts.timeZone = tz;
        return new Intl.DateTimeFormat('en-US', opts).format(date);
    },

    // _tzLabel falls back to the zone's short name, which for most of the world
    // is the bare offset ("GMT+9"). Every row here already shows the offset in
    // its own badge, so that fallback renders "GMT+9 (GMT+9)" and tells the user
    // nothing — and they picked the zone by city in the search list. Prefer the
    // city whenever the label degraded to an offset; a custom label or a curated
    // abbreviation (ET, VN) still wins, since neither matches this shape.
    _tzZoneName(zone) {
        const label = this._tzLabel(zone);
        if (!/^(GMT|UTC)[+-]/.test(label)) return label;
        const tail = String(zone).split('/').pop();
        return tail ? tail.replace(/_/g, ' ') : label;
    },

    // Strings only, no geometry — called on every drag frame (the renderer's
    // cheap-update path positions the dial from pointer x, then calls this
    // just to refresh the ≤4 readout chips' textContent).
    _tzDialReadouts(ms) {
        const cfg = this.getTzToolConfig();
        const date = new Date(ms);
        return cfg.zones.map(zone => ({
            label: this._tzZoneName(zone),
            time: this._tzClockStr(date, zone),
            date: this._tzFriendlyDate(date, zone)
        }));
    },

    // Multi-line plain-text copy payload, one line per zone:
    // "New York (GMT-4): Tue, Sep 1, 2:00 PM – 4:30 PM" (+' (next day)' when
    // the end's local calendar date differs from the start's). '' when no
    // range is marked.
    getTzRangeText() {
        const rs = this.state.tzRangeStartMs, re = this.state.tzRangeEndMs;
        if (rs == null || re == null || re <= rs) return '';
        const cfg = this.getTzToolConfig();
        const startDate = new Date(rs), endDate = new Date(re);
        return cfg.zones.map(zone => {
            const nextDay = this._dateOnly(startDate, zone) !== this._dateOnly(endDate, zone) ? ' (next day)' : '';
            const offset = this._tzOffsetLabel(zone);
            const zoneLabel = offset ? `${this._tzZoneName(zone)} (${offset})` : this._tzZoneName(zone);
            const dateLabel = this._tzFriendlyDate(startDate, zone);
            return `${zoneLabel}: ${dateLabel}, ${this._tzRangeTimeStr(startDate, zone)} – ${this._tzRangeTimeStr(endDate, zone)}${nextDay}`;
        }).join('\n');
    },

    // 14 cells: this Mon-Sun + next Mon-Sun, computed in the PRIMARY zone
    // (Monday math shared with _baseOffsetFromToday's week view). isStart /
    // isEnd / inSpan describe the CURRENTLY COMMITTED window — a date-only
    // approximation of the real (DST-adjusted) ms window, which is fine for a
    // picker highlight. The picker repaints those three classes itself as the
    // user clicks (see toggleTzDatePicker), so this is the opening state, not
    // a per-click source of truth.
    _tzPickerDays() {
        const cfg = this.getTzToolConfig();
        const primaryTz = cfg.zones[cfg.primary];
        const todayStr = this._dateOnly(new Date(), primaryTz);
        const [ty, tmo, td] = todayStr.split('-').map(Number);
        const todayBase = new Date(Date.UTC(ty, tmo - 1, td));
        const dow = todayBase.getUTCDay();               // 0=Sun..6=Sat
        const mondayOffset = -((dow + 6) % 7);            // days since Monday
        const startDateStr = this._tzStartDateStr(primaryTz);
        const dayCount = this._tzDayCount();
        const endDateStr = this._addDaysUTC(startDateStr, dayCount - 1);
        const [sy, smo, sd] = startDateStr.split('-').map(Number);
        const spanStart = Date.UTC(sy, smo - 1, sd);
        const spanEnd = spanStart + dayCount * 86400000;

        const cells = [];
        for (let i = 0; i < 14; i++) {
            const d = new Date(todayBase);
            d.setUTCDate(d.getUTCDate() + mondayOffset + i);
            const dateStr = this._dateOnly(d, 'UTC');
            cells.push({
                dateStr,
                dayNum: d.getUTCDate(),
                label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
                isToday: dateStr === todayStr,
                isStart: dateStr === startDateStr,
                isEnd: dayCount > 1 && dateStr === endDateStr,
                inSpan: d.getTime() >= spanStart && d.getTime() < spanEnd
            });
        }
        return cells;
    },

    // ---- The model the renderer builds every bar from -------------------------

    // Never called mid-drag (the renderer positions the dial/range live from
    // pointer x against data-start-ms/data-span-ms and only calls this on
    // commit) — so its cost (the per-zone segment walks above) is paid once
    // per rebuild, not once per frame.
    buildTzModel() {
        const cfg = this.getTzToolConfig();
        const { startMs, endMs, spanMs, primaryTz, dayCount, dateStrs } = this.getTzWindow();
        const zones = cfg.zones;
        const primaryIdx = cfg.primary;

        // Plain percent on one shared basis — every row, the dial, the range
        // band and the now-line all read the same x for the same instant.
        // Rounded to ~4 decimals; sub-hundredth-of-a-percent precision on a
        // ~600px-wide bar is invisible, and untrimmed floats would bloat the
        // CSS custom properties the renderer writes per frame.
        const pct = (ms) => {
            const raw = ((ms - startMs) / spanMs) * 100;
            return Math.round(raw * 10000) / 10000;
        };

        const now = Date.now();
        const nowPct = (now >= startMs && now <= endMs) ? pct(now) : null;

        // The dial materializes to "now, 15-min snapped" on first use and is
        // a FIXED instant from then on — it must NOT be re-clamped to a
        // moved window here (that would silently walk it every rebuild,
        // which is exactly the "does not follow the clock" rule this state
        // exists to satisfy). Only the mutators (setTzStartDate, chiefly)
        // ever change or null it out.
        if (this.state.tzDialMs == null) {
            const snapped = Math.round(Date.now() / 900000) * 900000;
            this.state.tzDialMs = Math.min(Math.max(snapped, startMs), endMs);
        }
        const dialMs = this.state.tzDialMs;
        const dial = { ms: dialMs, pct: pct(dialMs), perZone: this._tzDialReadouts(dialMs) };

        // Range survives a window move by being CLIPPED (display geometry
        // only, here) rather than cleared — the mutators are what actually
        // reclip/null the underlying state when the window itself moves.
        let range = null;
        const rs = this.state.tzRangeStartMs, re = this.state.tzRangeEndMs;
        if (rs != null && re != null && re > rs) {
            const clipStart = Math.max(rs, startMs);
            const clipEnd = Math.min(re, endMs);
            if (clipEnd > clipStart) {
                const startDate = new Date(rs), endDate = new Date(re);
                const perZone = zones.map(zone => ({
                    label: this._tzZoneName(zone),
                    start: this._tzRangeTimeStr(startDate, zone),
                    end: this._tzRangeTimeStr(endDate, zone),
                    nextDay: this._dateOnly(startDate, zone) !== this._dateOnly(endDate, zone)
                }));
                const left = pct(clipStart);
                range = { startMs: rs, endMs: re, leftPct: left, widthPct: Math.max(0, pct(clipEnd) - left), perZone };
            }
        }

        // Events: primary row only, and skipped entirely when the user has
        // them switched off (cfg.showEvents) — the whole scan, not just the
        // rendering. The fallback colour matches DEFAULT_CAL_COLOR
        // (scripts/10-renderer.js) — a literal here rather than a reference to
        // that global, since this file loads before it.
        const FALLBACK_EVENT_COLOR = '#5B9DFF';
        // A zero-length event (no end, or end <= start) used to compute a
        // 0%-wide box and get filtered away — an event on the calendar that
        // the bar silently did not show. Floor it at 15 min so it renders as
        // a small pill instead.
        const MIN_EV_MS = 900000;
        let events = [];
        let eventsOverflow = [];
        if (cfg.showEvents) {
            const raw = this._tzPrimaryEvents(startMs, endMs).map(({ ev, start, effectiveEnd }) => {
                const segStart = Math.max(start, startMs);
                const rawEnd = Math.min(effectiveEnd, endMs);
                return {
                    segStart,
                    segEnd: Math.max(rawEnd, Math.min(segStart + MIN_EV_MS, endMs)),
                    title: ev.title || '',
                    color: Utils.isValidColor(ev._calColor) ? ev._calColor : FALLBACK_EVENT_COLOR
                };
            });
            const laid = this._tzLayoutEvents(raw, spanMs);
            events = laid.placed.map(e => {
                const left = pct(e.segStart);
                const widthPct = Math.max(0, pct(e.segEnd) - left);
                return {
                    leftPct: left, widthPct, lane: e.lane, title: e.title, color: e.color,
                    // Below ~4% of the window a pill is narrower than three
                    // characters at any realistic track width, and a title
                    // there renders as the "B…"/"T…" slivers this layout
                    // exists to remove. The tooltip still carries the name.
                    showTitle: widthPct >= 4
                };
            }).filter(e => e.widthPct > 0);
            // Overflow markers. `dropped` is in ascending segStart order (the
            // packer sorted it), so a single forward pass clusters neighbours
            // into one "+n" rather than stacking unreadable badges.
            const CLUSTER_PCT = 2.2;
            for (const e of laid.dropped) {
                const left = pct(e.segStart);
                const last = eventsOverflow[eventsOverflow.length - 1];
                if (last && left - last.leftPct < CLUSTER_PCT) {
                    last.count += 1;
                    last.titles.push(e.title);
                } else {
                    eventsOverflow.push({ leftPct: left, count: 1, titles: [e.title] });
                }
            }
        }

        const hourCount = this._tzHourCount(spanMs);

        const rows = zones.map((zone, idx) => {
            const dialDate = new Date(dialMs);
            const readout = { time: this._tzClockStr(dialDate, zone), date: this._tzFriendlyDate(dialDate, zone) };

            return {
                zone,
                label: this._tzZoneName(zone),
                offsetLabel: this._tzOffsetLabel(zone),
                relLabel: idx === primaryIdx ? '' : this._tzRelOffsetLabel(zone, primaryTz, dialMs),
                isPrimary: idx === primaryIdx,
                cells: this._zoneHourCells(zone, startMs, hourCount, cfg.hour24),
                readout,
                events: idx === primaryIdx ? events : [],
                eventsOverflow: idx === primaryIdx ? eventsOverflow : []
            };
        });

        // windowLabel comes from the window's own date strings, not from a
        // row's segments — the rows no longer carry day geometry at all.
        const first = this._tzDateLabel(dateStrs[0]).dateLabel;
        const last = this._tzDateLabel(dateStrs[dateStrs.length - 1]).dateLabel;

        return {
            startMs, endMs, spanMs, primaryTz, primaryIdx, nowPct, dial, range, rows,
            dayCount, hourCount,
            cellPct: Math.round((100 / hourCount) * 10000) / 10000,
            windowLabel: last && last !== first ? `${first} – ${last}` : first,
            showEvents: cfg.showEvents, hour24: cfg.hour24
        };
    },

    // ---- Mutators (each ends in a scoped refresh) ------------------------------

    // Sets both ends of the window at once: `dateStr` is day 1, `dayCount`
    // (1..TZ_MAX_DAYS, defaulting to the current width) is how many days
    // follow it. One mutator rather than two because the two are never
    // independently meaningful — the picker always knows both, and a
    // start-only commit would briefly render a window the user never asked
    // for and refresh the card twice for one click.
    //
    // Keeps the dial if it still falls inside the new window; nulls it
    // otherwise (buildTzModel re-materializes it to "now" on the next call).
    // The range is clipped the same way — but if the new window doesn't
    // overlap it AT ALL (a jump far away, or a shrink to one day past it),
    // there is nothing left to clip to, so it is cleared rather than left
    // dangling.
    setTzStartDate(dateStr, dayCount) {
        if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
        const [y, mo, d] = dateStr.split('-').map(Number);
        const check = new Date(Date.UTC(y, mo - 1, d));
        if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return;

        let n = parseInt(dayCount, 10);
        if (!Number.isFinite(n)) n = this._tzDayCount();
        n = Math.min(Math.max(n, 1), this.TZ_MAX_DAYS);

        // Compared against the EFFECTIVE start (null means today), so
        // re-picking today's cell on a fresh window is the no-op it looks
        // like rather than a rebuild that replaces the picker's own anchor.
        const cfg = this.getTzToolConfig();
        if (this._tzStartDateStr(cfg.zones[cfg.primary]) === dateStr && this._tzDayCount() === n) return;

        this.state.tzStartDateStr = dateStr;
        this.state.tzDayCount = n;
        const { startMs, endMs } = this.getTzWindow();

        if (this.state.tzDialMs != null && (this.state.tzDialMs < startMs || this.state.tzDialMs > endMs)) {
            this.state.tzDialMs = null;
        }
        if (this.state.tzRangeStartMs != null && this.state.tzRangeEndMs != null) {
            const clipStart = Math.max(this.state.tzRangeStartMs, startMs);
            const clipEnd = Math.min(this.state.tzRangeEndMs, endMs);
            if (clipEnd > clipStart) {
                this.state.tzRangeStartMs = clipStart;
                this.state.tzRangeEndMs = clipEnd;
            } else {
                this.state.tzRangeStartMs = null;
                this.state.tzRangeEndMs = null;
            }
        }
        window.UIRenderer?.refreshCalendarDayView();
    },

    // Called from the drag-commit path (up to once per pointerup, but the
    // renderer may call it defensively) — must stay cheap and must NOT
    // trigger a refresh when the snapped value hasn't actually changed.
    setTzDialMs(ms) {
        const n = Number(ms);
        if (!Number.isFinite(n)) return;
        const { startMs, endMs } = this.getTzWindow();
        let snapped = Math.round(n / 900000) * 900000;
        snapped = Math.min(Math.max(snapped, startMs), endMs);
        if (this.state.tzDialMs === snapped) return;
        this.state.tzDialMs = snapped;
        window.UIRenderer?.refreshCalendarDayView();
    },

    // The ONE way a range is marked, and the drag paint's only commit point.
    // Both ends land in a single state write, so the range never exists
    // half-set: there is no "start marked, end pending" state to render, and
    // the dial is left exactly where the user dropped it rather than being
    // dragged along as a side effect of recording the range.
    setTzRange(loMs, hiMs) {
        const a = Number(loMs), b = Number(hiMs);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return;
        const { startMs, endMs } = this.getTzWindow();
        const clamp = (v) => Math.min(Math.max(v, startMs), endMs);
        const lo = clamp(Math.min(a, b));
        const hi = clamp(Math.max(a, b));
        if (hi <= lo) return;   // both ends snapped to one instant — a click, not a paint
        if (this.state.tzRangeStartMs === lo && this.state.tzRangeEndMs === hi) return;
        this.state.tzRangeStartMs = lo;
        this.state.tzRangeEndMs = hi;
        window.UIRenderer?.refreshCalendarDayView();
    },

    clearTzRange() {
        this.state.tzRangeStartMs = null;
        this.state.tzRangeEndMs = null;
        window.UIRenderer?.refreshCalendarDayView();
    }
});
