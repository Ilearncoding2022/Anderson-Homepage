// ==========================================
// 8-USAGE.JS - Claude Token-Usage Header Widget (v4.13)
//
// Renders three small segmented gauges in the header (Session / Week /
// Fable (Week)) from `usage-data.js` at the app root — a machine-generated,
// gitignored file written every 10 minutes by tools/update-claude-usage.ps1
// (a Task Scheduler job that polls Anthropic's usage endpoint with the local
// Claude Code login). The file assigns `window.ClaudeUsage`:
//
//   { fetchedAt: "<UTC ISO>", limits: [{ kind, label, percent, resetsAt, severity }] }
//
// The file is (re)loaded by injecting a <script> tag with a cache-busting
// query — fetch() can't read local files from file://. If it never loads
// (fresh clone, updater not installed) the widget simply stays hidden.
// ==========================================

const UsageWidget = {
    RELOAD_MS: 5 * 60 * 1000,   // re-read usage-data.js
    TICK_MS: 60 * 1000,         // refresh "Resets in …" and staleness
    STALE_MS: 30 * 60 * 1000,   // dim the widget when data is older than this

    // The only kinds the generator emits; anything else in a hand-edited or
    // corrupted file is skipped rather than reaching querySelector.
    KINDS: ['session', 'weekly_all', 'weekly_scoped'],

    _loaded: false,
    _linksBound: false,
    _reloadTimer: null,
    _tickTimer: null,

    start() {
        const widget = document.getElementById('usageWidget');
        if (!widget) return;
        this._bindLinks(widget);
        clearInterval(this._reloadTimer);
        clearInterval(this._tickTimer);
        this._load();
        this._reloadTimer = setInterval(() => this._load(), this.RELOAD_MS);
        this._tickTimer = setInterval(() => this._tick(), this.TICK_MS);
    },

    // Title → claude.ai/new, gauges/countdowns → usage settings. A plain
    // anchor (or window.open) would open a FOREGROUND tab and yank focus off
    // the homepage, so the click is intercepted and replayed as a synthetic
    // ctrl/cmd+click, which Chromium honours as "open in background tab".
    // Keyboard activation (Enter) fires a click event too, so this covers it.
    _bindLinks(widget) {
        if (this._linksBound) return;
        this._linksBound = true;
        widget.addEventListener('click', (e) => {
            const link = e.target.closest('a.usage-link');
            if (!link || !widget.contains(link)) return;
            e.preventDefault();
            const a = document.createElement('a');
            a.href = link.href;
            a.rel = 'noopener';
            a.dispatchEvent(new MouseEvent('click', { ctrlKey: true, metaKey: true }));
        });
    },

    // Re-inject the data script; ?t= busts the cache (works on file:// in
    // Chromium — the query is ignored for file lookup but keys the cache).
    _load() {
        document.getElementById('usageDataScript')?.remove();
        const s = document.createElement('script');
        s.id = 'usageDataScript';
        s.src = `usage-data.js?t=${Date.now()}`;
        s.onload = () => this._render();
        // Missing file: keep the widget hidden on machines without the
        // updater; if we rendered once, keep the last data (staleness will
        // flag it via _tick).
        s.onerror = () => s.remove();
        document.head.appendChild(s);
    },

    _render() {
        const data = window.ClaudeUsage;
        const widget = document.getElementById('usageWidget');
        if (!widget || !data || !Array.isArray(data.limits)) return;

        const seen = new Set();
        for (const limit of data.limits) {
            if (!this.KINDS.includes(limit.kind)) continue;
            const row = widget.querySelector(`.usage-row[data-kind="${limit.kind}"]`);
            if (!row) continue;
            seen.add(limit.kind);
            const pct = Math.max(0, Math.min(100, Number(limit.percent) || 0));
            // The gauge is a fixed 0-100 scale, so the reading is where the
            // marker SITS, not how much of the bar is filled. Inset the travel
            // by half the marker's width at each end so it stays fully inside
            // the capsule's rounded caps at 0% and 100%.
            const marker = row.querySelector('.usage-marker');
            if (marker) marker.style.left = `calc(3px + ${pct} * (100% - 6px) / 100)`;
            const pctEl = row.querySelector('.usage-pct');
            if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
            const bar = row.querySelector('.usage-bar');
            if (bar) {
                bar.setAttribute('aria-valuenow', String(Math.round(pct)));
                this._updateSegments(bar, pct);
            }
            // Green ≤49%, yellow 50–79%, red ≥80% — or earlier if the API says so.
            const danger = pct >= 80 || limit.severity === 'danger' || limit.severity === 'exceeded';
            const warn = pct >= 50 || limit.severity === 'warn' || limit.severity === 'elevated';
            row.classList.toggle('is-danger', danger);
            row.classList.toggle('is-warn', warn && !danger);
        }
        if (seen.size === 0) return;

        // A limit absent from this payload (plan change, model rename) hides
        // its row — a frozen last-known bar would read as live data.
        widget.querySelectorAll('.usage-row').forEach(row => {
            row.hidden = !seen.has(row.dataset.kind);
        });

        this._loaded = true;
        widget.hidden = false;
        this._tick();
    },

    // The ten colour blocks are real elements (styled/animated per segment in
    // 2-components.css), built here on first render rather than repeated three
    // times in the HTML. --seg-i feeds each segment's animation-delay;
    // --pulse-cycle (used-count × 0.5s, matching the 0.5s per-segment delay in
    // the CSS) makes the pulse walk 1 → current and restart. Purely
    // decorative — aria-valuenow/valuetext carry the reading.
    _updateSegments(bar, pct) {
        let segs = bar.querySelector('.usage-segs');
        if (!segs) {
            segs = document.createElement('span');
            segs.className = 'usage-segs';
            for (let i = 0; i < 10; i++) {
                const seg = document.createElement('span');
                seg.className = 'usage-seg';
                seg.style.setProperty('--seg-i', i);
                segs.appendChild(seg);
            }
            bar.prepend(segs);   // before the marker/pct so it paints underneath
        }
        // ceil, so any non-zero usage lights (and pulses) at least segment 1.
        const used = Math.min(10, Math.ceil(pct / 10));
        segs.style.setProperty('--pulse-cycle', `${Math.max(1, used) * 0.5}s`);
        segs.querySelectorAll('.usage-seg').forEach((seg, i) => {
            seg.classList.toggle('is-used', i < used);
        });
    },

    _tick() {
        if (!this._loaded) return;
        const data = window.ClaudeUsage;
        const widget = document.getElementById('usageWidget');
        if (!widget || !data) return;

        for (const limit of (data.limits || [])) {
            if (!this.KINDS.includes(limit.kind)) continue;
            const row = widget.querySelector(`.usage-row[data-kind="${limit.kind}"]`);
            if (!row) continue;
            const parts = this._resetsParts(limit.resetsAt);
            const el = row.querySelector('.usage-resets');
            if (el) {
                // Fixed sub-spans (word / d / h / m) instead of one string, so
                // CSS can column-align the units across rows — otherwise the
                // session's "4h 57m" sits under another row's "3d 21h" with
                // hours over days.
                el.querySelector('.usage-resets-word').textContent = parts ? parts.word : '';
                el.querySelector('.usage-unit-d').textContent = parts ? parts.d : '';
                el.querySelector('.usage-unit-h').textContent = parts ? parts.h : '';
                el.querySelector('.usage-unit-m').textContent = parts ? parts.m : '';
            }
            const resets = parts ? parts.text : '';
            const bar = row.querySelector('.usage-bar');
            if (bar) {
                const pctText = row.querySelector('.usage-pct')?.textContent || '';
                bar.setAttribute('aria-valuetext', resets ? `${pctText}, ${resets.toLowerCase()}` : pctText);
            }
        }

        const fetched = Date.parse(data.fetchedAt);
        const fetchedLabel = Number.isFinite(fetched) ? new Date(fetched).toLocaleString() : 'an unknown time';
        const stale = !Number.isFinite(fetched) || (Date.now() - fetched > this.STALE_MS);
        widget.classList.toggle('is-stale', stale);
        widget.title = stale
            ? `Usage data from ${fetchedLabel} — updater may be stopped or the Claude Code login expired`
            : `Usage data from ${fetchedLabel}`;
        // Real text for screen readers — opacity/::after/title aren't announced.
        const note = document.getElementById('usageStaleNote');
        if (note) note.textContent = stale ? `Usage data outdated (from ${fetchedLabel})` : '';
    },

    // Split into { word, d, h, m, text }: the sub-spans get the pieces, the
    // aria-valuetext keeps the flat sentence. Empty slots stay empty strings —
    // the CSS grid reserves their column so units align across rows.
    _resetsParts(resetsAt) {
        const ms = Date.parse(resetsAt) - Date.now();
        if (!Number.isFinite(ms)) return null;
        if (ms <= 0) return { word: 'resetting…', d: '', h: '', m: '', text: 'resetting…' };
        const mins = Math.ceil(ms / 60000);
        const hours = Math.floor(mins / 60);
        let d = '', h = '', m = '';
        if (mins < 60) {
            m = `${mins}m`;
        } else if (hours < 24) {
            h = `${hours}h`;
            m = `${mins % 60}m`;
        } else {
            d = `${Math.floor(hours / 24)}d`;
            h = `${hours % 24}h`;
        }
        const text = `Resets in ${[d, h, m].filter(Boolean).join(' ')}`;
        return { word: 'Resets in', d, h, m, text };
    }
};

window.UsageWidget = UsageWidget;

// Scripts sit at the end of <body>, so the DOM is ready.
UsageWidget.start();
