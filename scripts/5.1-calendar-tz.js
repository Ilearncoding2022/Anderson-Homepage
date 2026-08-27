// ==========================================
// 5.1-CALENDAR-TZ.JS - extends CalendarManager (family 5.x)
// Anderson Homepage
//
// Multi-timezone comparison tool: up to 4 IANA zones stacked on one shared
// absolute-time axis (World-Time-Buddy style), a draggable dial, and an
// optional marked range. This file is DATA ONLY — geometry (percentages,
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
    tzDialMs: null,
    tzRangeStartMs: null,
    tzRangeEndMs: null
});

Object.assign(CalendarManager, {
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
        return { zones, primary };
    },

    setTzToolConfig(cfg) {
        const zones = this._validateTzZones(cfg && cfg.zones);
        if (zones.length === 0) return;   // nothing valid survived — leave the stored config alone
        let primary = parseInt(cfg && cfg.primary, 10);
        if (!Number.isFinite(primary)) primary = 0;
        primary = Math.min(Math.max(primary, 0), zones.length - 1);
        Utils.safeLocalStorageSet(this.config.storageKeys.tzTool, JSON.stringify({ zones, primary }));
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

    _tzStartDateStr(primaryTz) {
        const s = this.state.tzStartDateStr;
        if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        return this._dateOnly(new Date(), primaryTz);
    },

    // { startMs, endMs, spanMs, primaryTz, dateStrs: [d0,d1,d2,d3] }
    // spanMs is 95/96/97 hours across a DST edge in the primary zone and that
    // is correct — NEVER startMs + 4*86400000. dateStrs are date-only UTC
    // strings (see getDayViewWindow's identical discipline in 5-calendar.js);
    // each row later walks its OWN local dates through _zonedDayStartMs
    // rather than reusing these.
    getTzWindow() {
        const cfg = this.getTzToolConfig();
        const primaryTz = cfg.zones[cfg.primary];
        const d0 = this._tzStartDateStr(primaryTz);
        const dateStrs = [d0];
        for (let i = 1; i < 4; i++) dateStrs.push(this._addDaysUTC(dateStrs[i - 1], 1));
        const d4 = this._addDaysUTC(dateStrs[3], 1);
        const startMs = this._zonedDayStartMs(d0, primaryTz);
        const endMs = this._zonedDayStartMs(d4, primaryTz);
        return { startMs, endMs, spanMs: endMs - startMs, primaryTz, dateStrs };
    },

    // ---- Per-zone geometry helpers (raw ms; buildTzModel converts to %) ------

    // Calendar-day blocks for `zone` that overlap [startMs, endMs), clipped to
    // the window. Walked from THIS zone's own local date at startMs, not from
    // the primary's day boundaries — a non-primary zone's day rarely lines up
    // with the primary's.
    _zoneDaySegments(zone, startMs, endMs) {
        const segs = [];
        let dateStr = this._dateOnly(new Date(startMs), zone);
        let dayStart = this._zonedDayStartMs(dateStr, zone);
        while (dayStart < endMs) {
            const nextDateStr = this._addDaysUTC(dateStr, 1);
            const nextStart = this._zonedDayStartMs(nextDateStr, zone);
            segs.push({
                dateStr,
                segStart: Math.max(dayStart, startMs),
                segEnd: Math.min(nextStart, endMs)
            });
            dateStr = nextDateStr;
            dayStart = nextStart;
        }
        return segs;
    },

    // Night = local 22:00 -> next-day 06:00, via _zonedTimeMs so a DST jump
    // inside the night yields the true absolute span. Starts scanning from
    // the local day BEFORE the window's first date so a night that began the
    // evening before startMs, and straddles it, still gets a (clipped)
    // segment instead of silently starting mid-window.
    _zoneNightSegments(zone, startMs, endMs) {
        const segs = [];
        let dateStr = this._addDaysUTC(this._dateOnly(new Date(startMs), zone), -1);
        for (let i = 0; i < 10; i++) {   // a 4-day window spans at most ~6 local days; 10 is a safe bound
            const nightStart = this._zonedTimeMs(dateStr, 22, 0, zone);
            if (nightStart > endMs) break;
            const nextDateStr = this._addDaysUTC(dateStr, 1);
            const nightEnd = this._zonedTimeMs(nextDateStr, 6, 0, zone);
            const segStart = Math.max(nightStart, startMs);
            const segEnd = Math.min(nightEnd, endMs);
            if (segEnd > segStart) segs.push({ startMs: segStart, endMs: segEnd });
            dateStr = nextDateStr;
        }
        return segs;
    },

    // Hour gridlines every 3rd hour (0,3,...,21) for every local day
    // overlapping the window. Fast path when the local day is exactly 24h;
    // otherwise (23h/25h DST-transition days) each tick is computed
    // individually via _zonedTimeMs, since the fast arithmetic would
    // misplace every tick after the transition.
    _zoneHourTicks(zone, startMs, endMs, pct) {
        const ticks = [];
        let dateStr = this._dateOnly(new Date(startMs), zone);
        let dayStart = this._zonedDayStartMs(dateStr, zone);
        while (dayStart < endMs) {
            const nextDateStr = this._addDaysUTC(dateStr, 1);
            const nextStart = this._zonedDayStartMs(nextDateStr, zone);
            const isRegularDay = (nextStart - dayStart) === 86400000;
            for (let h = 0; h < 24; h += 3) {
                const tickMs = isRegularDay ? dayStart + h * 3600000 : this._zonedTimeMs(dateStr, h, 0, zone);
                if (tickMs < startMs || tickMs > endMs) continue;
                const isLabeled = h === 6 || h === 12 || h === 18;
                ticks.push({
                    leftPct: pct(tickMs),
                    hour: h,
                    isLabeled,
                    label: isLabeled ? (h === 6 ? '6a' : h === 12 ? '12p' : '6p') : ''
                });
            }
            dateStr = nextDateStr;
            dayStart = nextStart;
        }
        return ticks;
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
    // (Monday math shared with _baseOffsetFromToday's week view). inSpan
    // marks the 4 dates the window would cover if that cell were picked as
    // the start — a date-only approximation of the real (DST-adjusted) ms
    // window, which is fine for a picker highlight.
    _tzPickerDays() {
        const cfg = this.getTzToolConfig();
        const primaryTz = cfg.zones[cfg.primary];
        const todayStr = this._dateOnly(new Date(), primaryTz);
        const [ty, tmo, td] = todayStr.split('-').map(Number);
        const todayBase = new Date(Date.UTC(ty, tmo - 1, td));
        const dow = todayBase.getUTCDay();               // 0=Sun..6=Sat
        const mondayOffset = -((dow + 6) % 7);            // days since Monday
        const startDateStr = this._tzStartDateStr(primaryTz);
        const [sy, smo, sd] = startDateStr.split('-').map(Number);
        const spanStart = Date.UTC(sy, smo - 1, sd);
        const spanEnd = spanStart + 4 * 86400000;

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
        const { startMs, endMs, spanMs, primaryTz } = this.getTzWindow();
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

        // Events: primary row only. The fallback colour matches
        // DEFAULT_CAL_COLOR (scripts/10-renderer.js) — a literal here rather
        // than a reference to that global, since this file loads before it.
        const FALLBACK_EVENT_COLOR = '#5B9DFF';
        const events = this._tzPrimaryEvents(startMs, endMs).map(({ ev, start, effectiveEnd }) => {
            const segStart = Math.max(start, startMs);
            const segEnd = Math.min(effectiveEnd, endMs);
            const left = pct(segStart);
            return {
                leftPct: left,
                widthPct: Math.max(0, pct(segEnd) - left),
                title: ev.title || '',
                color: Utils.isValidColor(ev._calColor) ? ev._calColor : FALLBACK_EVENT_COLOR
            };
        }).filter(e => e.widthPct > 0);

        const rows = zones.map((zone, idx) => {
            const days = this._zoneDaySegments(zone, startMs, endMs).map(d => {
                const { wkday, dateLabel } = this._tzDateLabel(d.dateStr);
                const left = pct(d.segStart);
                return { leftPct: left, widthPct: Math.max(0, pct(d.segEnd) - left), wkday, dateLabel, dateStr: d.dateStr };
            }).filter(d => d.widthPct > 0);

            const nights = this._zoneNightSegments(zone, startMs, endMs).map(n => {
                const left = pct(n.startMs);
                return { leftPct: left, widthPct: Math.max(0, pct(n.endMs) - left) };
            }).filter(n => n.widthPct > 0);

            const ticks = this._zoneHourTicks(zone, startMs, endMs, pct);

            const dialDate = new Date(dialMs);
            const readout = { time: this._tzClockStr(dialDate, zone), date: this._tzFriendlyDate(dialDate, zone) };

            return {
                zone,
                label: this._tzZoneName(zone),
                offsetLabel: this._tzOffsetLabel(zone),
                isPrimary: idx === primaryIdx,
                days, nights, ticks, readout,
                events: idx === primaryIdx ? events : []
            };
        });

        return { startMs, endMs, spanMs, primaryTz, primaryIdx, nowPct, dial, range, rows };
    },

    // ---- Mutators (each ends in a scoped refresh) ------------------------------

    // Keeps the dial if it still falls inside the new window; nulls it
    // otherwise (buildTzModel re-materializes it to "now" on the next call).
    // The range is clipped the same way — but if the new window doesn't
    // overlap it AT ALL (a jump far away, not a slide), there is nothing left
    // to clip to, so it is cleared rather than left dangling.
    setTzStartDate(dateStr) {
        if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
        const [y, mo, d] = dateStr.split('-').map(Number);
        const check = new Date(Date.UTC(y, mo - 1, d));
        if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return;

        this.state.tzStartDateStr = dateStr;
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

    setTzRangeStartAtDial() {
        if (this.state.tzDialMs == null) return;
        this.state.tzRangeStartMs = this.state.tzDialMs;
        // A fresh start point invalidates a stale end that no longer follows it.
        if (this.state.tzRangeEndMs != null && this.state.tzRangeEndMs <= this.state.tzRangeStartMs) {
            this.state.tzRangeEndMs = null;
        }
        window.UIRenderer?.refreshCalendarDayView();
    },

    // No-op unless a start exists and the dial is strictly after it.
    setTzRangeEndAtDial() {
        if (this.state.tzRangeStartMs == null || this.state.tzDialMs == null) return;
        if (this.state.tzDialMs <= this.state.tzRangeStartMs) return;
        this.state.tzRangeEndMs = this.state.tzDialMs;
        window.UIRenderer?.refreshCalendarDayView();
    },

    clearTzRange() {
        this.state.tzRangeStartMs = null;
        this.state.tzRangeEndMs = null;
        window.UIRenderer?.refreshCalendarDayView();
    }
});
