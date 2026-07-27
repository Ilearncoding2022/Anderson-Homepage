// ==========================================
// 8-USAGE.JS - Claude Token-Usage Header Widget (v4.9)
//
// Renders three small progress bars in the header (Session / Week /
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
    _reloadTimer: null,
    _tickTimer: null,

    start() {
        if (!document.getElementById('usageWidget')) return;
        clearInterval(this._reloadTimer);
        clearInterval(this._tickTimer);
        this._load();
        this._reloadTimer = setInterval(() => this._load(), this.RELOAD_MS);
        this._tickTimer = setInterval(() => this._tick(), this.TICK_MS);
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
            const fill = row.querySelector('.usage-fill');
            if (fill) fill.style.width = `${pct}%`;
            const pctEl = row.querySelector('.usage-pct');
            if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
            const bar = row.querySelector('.usage-bar');
            if (bar) bar.setAttribute('aria-valuenow', String(Math.round(pct)));
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

    _tick() {
        if (!this._loaded) return;
        const data = window.ClaudeUsage;
        const widget = document.getElementById('usageWidget');
        if (!widget || !data) return;

        for (const limit of (data.limits || [])) {
            if (!this.KINDS.includes(limit.kind)) continue;
            const row = widget.querySelector(`.usage-row[data-kind="${limit.kind}"]`);
            if (!row) continue;
            const resets = this._resetsLabel(limit.resetsAt);
            const el = row.querySelector('.usage-resets');
            if (el) el.textContent = resets;
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

    _resetsLabel(resetsAt) {
        const ms = Date.parse(resetsAt) - Date.now();
        if (!Number.isFinite(ms)) return '';
        if (ms <= 0) return 'resetting…';
        const mins = Math.ceil(ms / 60000);
        if (mins < 60) return `Resets in ${mins}m`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `Resets in ${hours}h ${mins % 60}m`;
        const days = Math.floor(hours / 24);
        return `Resets in ${days}d ${hours % 24}h`;
    }
};

window.UsageWidget = UsageWidget;

// Scripts sit at the end of <body>, so the DOM is ready.
UsageWidget.start();
