// ==========================================
// 9-PROJECTS.JS - Project Status Bar (v4.14)
//
// Renders a row of "project status bars" below the header showing what each
// live Claude Code session (VS Code extension or CLI) is doing, fed by
// Claude Code hooks. The hook script (tools/claude-status-hook.js) writes a
// per-session spool file and re-merges all spool files into claude-projects.js
// at the app root (gitignored, atomic-written), assigning `window.ClaudeProjects`:
//
//   { schemaVersion, generatedAt, sessions: [{ sessionId, cwd, cwdKey, folder,
//     state, activity, startedAt, lastEventAt, pendingSince, pendingTool,
//     lastTool, permissionMode }] }
//
// The file is (re)loaded by injecting a <script> tag with a cache-busting
// query, same trick as scripts/8-usage.js — fetch() can't read local files
// from file://. If it never loads (fresh clone, hooks not installed, or every
// session has ended) the row simply stays hidden.
//
// claude-projects.js is untrusted input as far as this widget is concerned —
// it's written by a separate process and could in principle be stale,
// malformed, or hand-edited. _processData() and _renderNamesList() fail
// closed (try/catch + hide the row) rather than throw, and every field
// consumed from a session record is coerced to the expected type first.
// ==========================================

const ProjectsWidget = {
    POLL_MS: 10 * 1000,        // re-read claude-projects.js
    TICK_MS: 1000,              // refresh the "time since" numbers
    MAX_BARS: 6,
    SEEN_MAX_AGE_MS: 60 * 24 * 60 * 60 * 1000,   // prune claudeProjectsSeen after 60 days
    SEEN_MAX_ENTRIES: 100,                       // cap claudeProjectsSeen at the 100 most-recent
    SEEN_MIN_BUMP_MS: 60 * 1000,                 // only persist a lastSeen bump every >=60s

    SETTINGS_KEY: 'claudeProjectsSettings',
    NAMES_KEY: 'claudeProjectsNames',
    SEEN_KEY: 'claudeProjectsSeen',

    IDLE_OPTIONS: [1, 3, 5, 10],
    HIDE_OPTIONS: [10, 30, 60, 120],

    PRIORITY: { 'needs-you': 0, working: 1, 'your-turn': 2, idle: 3 },

    STATE_LABEL: {
        working: 'Working',
        'needs-you': 'Needs approval',
        'your-turn': 'Your turn',
        idle: 'Idle'
    },

    STATE_TITLE_WORD: {
        working: 'working',
        'needs-you': 'needs your approval',
        'your-turn': 'your turn',
        idle: 'idle'
    },

    _settings: null,
    _names: null,
    _seen: null,
    _lastSessions: [],
    _nameRowSeq: 0,
    _badDataWarned: false,
    _pollTimer: null,
    _tickTimer: null,
    _closeFallbackTimer: null,
    _closeEndHandler: null,
    _alertQueue: [],
    _alertClearTimer: null,

    start() {
        if (!document.getElementById('projectsRow')) return;

        this._settings = this._loadSettings();
        this._names = this._loadNames();
        this._seen = this._loadSeen();

        this._wireSettingsControls();
        this._wireNamesList();
        this._wireSettingsOpenTriggers();
        this._wireVisibilityPause();

        clearInterval(this._pollTimer);
        clearInterval(this._tickTimer);
        this._load();
        this._pollTimer = setInterval(() => this._load(), this.POLL_MS);
        this._tickTimer = setInterval(() => this._tick(), this.TICK_MS);
    },

    /** Coerce to string, never throw regardless of what disk/localStorage handed us. */
    _str(v) {
        return typeof v === 'string' ? v : '';
    },

    // ----------------------------------------
    // Load / poll (mirrors scripts/8-usage.js)
    // ----------------------------------------

    _load() {
        // Disabled means off: no fetch, no merge-parse, no DOM diffing every
        // poll — unless Settings is open, in which case the names list (which
        // works regardless of the enabled toggle) still needs fresh data.
        if (!this._settings.enabled && !this._isSettingsOpen()) return;
        document.getElementById('projectsDataScript')?.remove();
        const s = document.createElement('script');
        s.id = 'projectsDataScript';
        s.src = `claude-projects.js?t=${Date.now()}`;
        s.onload = () => this._processData();
        // Missing file (no hooks installed, or every session ended and the
        // merge step deleted the target): render nothing rather than leave a
        // stale row up.
        s.onerror = () => { s.remove(); this._closeRow(); };
        document.head.appendChild(s);
    },

    _processData() {
        try {
            const data = window.ClaudeProjects;
            // schemaVersion !== 1 means the writer (tools/claude-status-hook.js)
            // is a version this widget doesn't understand — the generator
            // always writes a fresh file, so a mismatch means real version
            // skew, not a stale-but-still-valid file. Treated the same as
            // missing/malformed.
            if (!data || typeof data !== 'object' || !Array.isArray(data.sessions) || data.schemaVersion !== 1) {
                if (!this._badDataWarned) {
                    this._badDataWarned = true;
                    console.warn('[ProjectsWidget] claude-projects.js missing, malformed, or schema mismatch; hiding project row.');
                }
                this._closeRow();
                return;
            }
            this._badDataWarned = false;

            const now = Date.now();

            // Every session is untrusted input from disk: keep only objects,
            // and coerce the string-typed fields consumed below so a
            // corrupted or hand-edited claude-projects.js can't throw
            // partway through a render.
            const sessions = data.sessions
                .filter(s => s && typeof s === 'object')
                .map(s => ({
                    ...s,
                    cwdKey: this._str(s.cwdKey),
                    cwd: this._str(s.cwd),
                    folder: this._str(s.folder),
                    activity: this._str(s.activity) || null,
                    state: this._str(s.state),
                    lastEventAt: this._str(s.lastEventAt),
                    pendingSince: typeof s.pendingSince === 'string' ? s.pendingSince : null,
                }));

            // Seen/names tracking runs regardless of the enabled toggle or a
            // stale generatedAt, so the Settings tab's name list stays current.
            this._updateSeen(sessions, now);
            this._lastSessions = sessions;
            // Rendering the names list is only useful while Settings is open —
            // gated here so a background 10s poll never diffs DOM the user
            // can't see. It's also rendered once, directly, at the moment the
            // modal opens (see _wireSettingsOpenTriggers).
            if (this._isSettingsOpen()) this._renderNamesList();

            if (!this._settings.enabled) {
                this._closeRow();
                return;
            }

            const generatedMs = Date.parse(data.generatedAt);
            const hideMs = this._settings.hideMin * 60000;
            if (!Number.isFinite(generatedMs) || (now - generatedMs) > hideMs) {
                this._closeRow();
                return;
            }

            const idleMs = this._settings.idleMin * 60000;
            const kept = sessions.filter(s => {
                const t = Date.parse(s.lastEventAt);
                return Number.isFinite(t) && (now - t) <= hideMs;
            });
            if (kept.length === 0) {
                this._closeRow();
                return;
            }

            const groups = new Map();
            for (const s of kept) {
                const key = s.cwdKey || String(s.cwd || '').toLowerCase();
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(s);
            }

            const bars = new Map();
            for (const [key, sessionsForKey] of groups) {
                bars.set(key, this._computeBar(key, sessionsForKey, now, idleMs));
            }
            this._renderRow(bars);
        } catch (e) {
            console.warn('[ProjectsWidget]', e);
            this._closeRow();
        }
    },

    // ----------------------------------------
    // Derivation
    // ----------------------------------------

    _deriveState(session, now, idleMs) {
        if (session.state === 'needs-you') return 'needs-you';
        const t = Date.parse(session.lastEventAt);
        if (Number.isFinite(t) && (now - t) > idleMs) return 'idle';
        return session.state === 'your-turn' ? 'your-turn' : 'working';
    },

    _computeBar(cwdKey, sessions, now, idleMs) {
        let overallState = 'idle';
        let overallRank = 4;
        for (const s of sessions) {
            const st = this._deriveState(s, now, idleMs);
            s.__effState = st;
            const rank = this.PRIORITY[st];
            if (rank < overallRank) {
                overallRank = rank;
                overallState = st;
            }
        }

        const primary = sessions.reduce((a, b) =>
            Date.parse(a.lastEventAt) >= Date.parse(b.lastEventAt) ? a : b);

        let sinceIso = primary.lastEventAt;
        if (overallState === 'needs-you') {
            const pendings = sessions.filter(s =>
                s.__effState === 'needs-you' && s.pendingSince && Number.isFinite(Date.parse(s.pendingSince)));
            if (pendings.length) {
                const newest = pendings.reduce((a, b) =>
                    Date.parse(a.pendingSince) >= Date.parse(b.pendingSince) ? a : b);
                sinceIso = newest.pendingSince;
            }
        }

        const folder = primary.folder || cwdKey;
        const rawName = this._names[cwdKey];
        const customName = (typeof rawName === 'string' ? rawName : '').trim();

        return {
            cwdKey,
            name: customName || folder,
            folder,
            count: sessions.length,
            state: overallState,
            activity: primary.activity || null,
            sinceIso
        };
    },

    // ----------------------------------------
    // Row rendering / reconciliation — keyed by cwdKey, never rebuilt.
    // ----------------------------------------

    _renderRow(barsMap) {
        const wrap = document.getElementById('projectsRow');
        const ul = wrap?.querySelector('.projects-row');
        if (!wrap || !ul) return;

        const all = Array.from(barsMap.values());
        if (all.length === 0) {
            this._closeRow();
            return;
        }

        // Select the 6 most urgent (tie: newest activity), then display the
        // selection in stable alphabetical order — position is spatial memory,
        // the blink is the attention mechanism.
        const bySelect = [...all].sort((a, b) => {
            const pr = this.PRIORITY[a.state] - this.PRIORITY[b.state];
            if (pr !== 0) return pr;
            return Date.parse(b.sinceIso) - Date.parse(a.sinceIso);
        });
        const overflow = Math.max(0, all.length - this.MAX_BARS);
        const selected = bySelect.slice(0, this.MAX_BARS);
        selected.sort((a, b) => a.cwdKey < b.cwdKey ? -1 : a.cwdKey > b.cwdKey ? 1 : 0);
        const selectedKeys = new Set(selected.map(b => b.cwdKey));

        // The overflow indicator is a 7th grid item — detach it while we
        // reconcile the bars so it never confuses the DOM-order walk below.
        const moreExisting = ul.querySelector('.projects-more');
        moreExisting?.remove();

        // Remove bars no longer selected (dropped session, filtered by
        // hideMin, or bumped out by the 6-bar cap). No exit animation.
        ul.querySelectorAll('.project-bar').forEach(li => {
            if (!selectedKeys.has(li.dataset.cwdKey)) li.remove();
        });

        this._openRow();

        // Add new bars, update survivors in place, reposition into
        // alphabetical order without recreating existing nodes (would replay
        // the enter animation, reset the blink phase, and drop tooltips).
        let cursor = ul.firstElementChild;
        for (const bar of selected) {
            let li = ul.querySelector(`.project-bar[data-cwd-key="${CSS.escape(bar.cwdKey)}"]`);
            if (!li) li = this._createBar(bar.cwdKey);
            if (cursor !== li) ul.insertBefore(li, cursor);
            cursor = li.nextElementSibling;
            this._updateBar(li, bar);
        }

        if (overflow > 0) {
            const more = document.createElement('li');
            more.className = 'projects-more';
            more.textContent = `+${overflow} more`;
            const hiddenNames = bySelect.slice(this.MAX_BARS).map(b => b.name).join(', ');
            more.title = hiddenNames;
            // The title tooltip is mouse-only and a bare listitem isn't
            // focusable — the aria-label is the only non-visual path to the
            // hidden names (listitem, unlike generic, supports naming).
            more.setAttribute('aria-label', `${overflow} more: ${hiddenNames}`);
            ul.appendChild(more);
        }

        ul.dataset.count = String(selected.length);
        this._flushAlerts();
    },

    // Needs-you announcements queue up during reconciliation so two projects
    // flipping in the same poll share one message instead of the second
    // overwriting the first before assistive tech ever saw it.
    _flushAlerts() {
        if (this._alertQueue.length === 0) return;
        const names = this._alertQueue;
        this._alertQueue = [];
        const alertEl = document.getElementById('projectsAlert');
        if (!alertEl) return;
        const joined = names.length === 1
            ? names[0]
            : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
        alertEl.textContent = `${joined} need${names.length === 1 ? 's' : ''} your approval.`;
        // Clear once read so a later, unrelated DOM change can't replay it.
        clearTimeout(this._alertClearTimer);
        this._alertClearTimer = setTimeout(() => { alertEl.textContent = ''; }, 8000);
    },

    _createBar(cwdKey) {
        const li = document.createElement('li');
        li.className = 'project-bar glass-surface is-new';
        li.dataset.cwdKey = cwdKey;
        li.dataset.state = '';
        // Static shell only — every piece of user-controlled text (name,
        // count, state, activity) is set via textContent afterwards, never
        // interpolated into this markup.
        li.innerHTML = `
            <div class="pb-head">
                <span class="pb-name"></span>
                <span class="pb-count" hidden></span>
                <span class="pb-time" role="timer" aria-live="off"></span>
            </div>
            <div class="pb-meta">
                <span class="pb-ind" aria-hidden="true">
                    <span class="pb-dot"></span>
                    <svg class="ico pb-alert" aria-hidden="true"><use href="#ico-alert"></use></svg>
                </span>
                <span class="pb-state"></span>
            </div>`;
        li.addEventListener('animationend', () => li.classList.remove('is-new'), { once: true });
        return li;
    },

    // `now` isn't needed here — the tooltip no longer bakes in an elapsed-time
    // sentence (see below) and the ticking .pb-time text is recomputed by
    // _tickBar() below from a fresh Date.now() of its own.
    _updateBar(li, bar) {
        const prevState = li.dataset.state;
        if (prevState !== bar.state) {
            li.classList.remove('is-working', 'is-needs-you', 'is-your-turn', 'is-idle');
            li.classList.add(`is-${bar.state}`);
            li.dataset.state = bar.state;
            if (bar.state === 'needs-you' && prevState !== 'needs-you') {
                this._alertQueue.push(bar.name);
            }
        }

        const nameEl = li.querySelector('.pb-name');
        if (nameEl && nameEl.textContent !== bar.name) nameEl.textContent = bar.name;

        const countEl = li.querySelector('.pb-count');
        if (countEl) {
            if (bar.count > 1) {
                const txt = `×${bar.count}`;
                if (countEl.textContent !== txt) countEl.textContent = txt;
                if (countEl.hidden) countEl.hidden = false;
            } else if (!countEl.hidden) {
                countEl.hidden = true;
            }
        }

        const stateEl = li.querySelector('.pb-state');
        const stateLabel = this.STATE_LABEL[bar.state] || bar.state;
        if (stateEl && stateEl.textContent !== stateLabel) stateEl.textContent = stateLabel;

        // .pb-activity doesn't exist in the static shell — it's added/removed
        // as activity appears/disappears rather than left as an empty node.
        let activityEl = li.querySelector('.pb-activity');
        if (bar.activity) {
            if (!activityEl) {
                activityEl = document.createElement('span');
                activityEl.className = 'pb-activity';
                li.querySelector('.pb-meta').appendChild(activityEl);
            }
            if (activityEl.textContent !== bar.activity) activityEl.textContent = bar.activity;
        } else if (activityEl) {
            activityEl.remove();
        }

        // The shared 1s ticker reads this to update .pb-time without
        // recomputing the whole bar list.
        li.dataset.since = bar.sinceIso;

        // Recency lives in the ticking .pb-time number + its aria-label, not
        // here — baking a "Last activity N ago" sentence into the title too
        // meant it went stale the instant the mouse stopped moving.
        const stateWord = this.STATE_TITLE_WORD[bar.state] || bar.state;
        const countTxt = bar.count > 1 ? ` (${bar.count} sessions)` : '';
        const detail = bar.activity ? `${stateWord}, ${bar.activity}` : stateWord;
        const newTitle = `${bar.name}${countTxt} — ${detail}.`;
        if (li.title !== newTitle) li.title = newTitle;

        this._tickBar(li);
    },

    // ----------------------------------------
    // Shared 1s ticker
    // ----------------------------------------

    _tick() {
        const wrap = document.getElementById('projectsRow');
        const ul = wrap?.querySelector('.projects-row');
        if (!ul) return;
        ul.querySelectorAll('.project-bar').forEach(li => this._tickBar(li));
    },

    _tickBar(li) {
        const since = li.dataset.since;
        if (!since) return;
        const ms = Date.now() - Date.parse(since);
        const timeEl = li.querySelector('.pb-time');
        if (!timeEl) return;
        const clock = this._clockElapsed(ms);
        if (timeEl.textContent !== clock) timeEl.textContent = clock;
        // Minute-granular aria-label (same rationale as the countdown label
        // in scripts/5-calendar.js ~line 701) so a screen reader isn't
        // re-announced every second — aria-live is "off" on this element, but
        // the bucket guard also means any future live-region wiring, or a
        // user re-focusing the element, doesn't see label churn every tick.
        const bucket = Number.isFinite(ms) ? String(Math.floor(ms / 60000)) : 'unknown';
        if (li.dataset.timeBucket !== bucket) {
            li.dataset.timeBucket = bucket;
            timeEl.setAttribute('aria-label', `Last activity ${this._humanElapsed(ms)} ago`);
        }
    },

    _clockElapsed(ms) {
        if (!Number.isFinite(ms)) return '—';
        const totalSec = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(totalSec / 3600);
        if (h >= 24) return '>24h';
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        const pad2 = n => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
    },

    _humanElapsed(ms) {
        if (!Number.isFinite(ms)) return 'unknown time';
        const sec = Math.max(0, Math.round(ms / 1000));
        if (sec < 60) return `${sec} second${sec === 1 ? '' : 's'}`;
        const min = Math.round(sec / 60);
        if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`;
        const hr = Math.round(min / 60);
        if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'}`;
        return 'over a day';
    },

    // ----------------------------------------
    // Open/close collapse choreography
    // ----------------------------------------

    _openRow() {
        const wrap = document.getElementById('projectsRow');
        if (!wrap) return;
        // Cancel a pending close (fallback timer AND its transitionend
        // listener) — otherwise a close-then-reopen within the 240ms window
        // (e.g. quickly re-ticking the enable checkbox) leaves a stale
        // listener that hides the row again right after it reopens.
        clearTimeout(this._closeFallbackTimer);
        if (this._closeEndHandler) {
            wrap.removeEventListener('transitionend', this._closeEndHandler);
            this._closeEndHandler = null;
        }
        if (wrap.hidden) {
            wrap.hidden = false;
            void wrap.offsetHeight; // force reflow so the transition triggers
        }
        wrap.classList.add('is-open');
    },

    _closeRow() {
        const wrap = document.getElementById('projectsRow');
        if (!wrap || wrap.hidden) return;
        // Double-close guard: a close already in flight (transitionend
        // listener still attached) owns the eventual hide + bar-clear.
        // Re-entering here would hit the "already closed" branch below
        // (classList no longer has is-open mid-transition) and hide the row
        // before its close transition actually finished.
        if (this._closeEndHandler) return;

        const ul = wrap.querySelector('.projects-row');
        // Clears the bars only once the close has actually completed — not
        // here, and not on an interrupted close (_openRow cancels the
        // handler+timer below before either ever fires). Fixes both a stale
        // data-state re-suppressing the next needs-you announcement on
        // orphaned bars, and the 1s ticker running forever over a hidden row.
        const clearBars = () => {
            ul?.replaceChildren();
            if (ul) ul.dataset.count = '0';
        };

        if (!wrap.classList.contains('is-open')) {
            wrap.hidden = true;
            clearBars();
            return;
        }
        wrap.classList.remove('is-open');
        const onEnd = (e) => {
            if (e.target !== wrap || e.propertyName !== 'grid-template-rows') return;
            wrap.hidden = true;
            wrap.removeEventListener('transitionend', onEnd);
            this._closeEndHandler = null;
            clearTimeout(this._closeFallbackTimer);
            clearBars();
        };
        this._closeEndHandler = onEnd;
        wrap.addEventListener('transitionend', onEnd);
        clearTimeout(this._closeFallbackTimer);
        this._closeFallbackTimer = setTimeout(() => {
            wrap.removeEventListener('transitionend', onEnd);
            this._closeEndHandler = null;
            wrap.hidden = true;
            clearBars();
        }, 300);
    },

    // ----------------------------------------
    // Visibility: pause polling/ticking while the tab is hidden.
    // ----------------------------------------

    _wireVisibilityPause() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                clearInterval(this._pollTimer);
                clearInterval(this._tickTimer);
                this._pollTimer = null;
                this._tickTimer = null;
            } else if (!this._pollTimer) {
                this._pollTimer = setInterval(() => this._load(), this.POLL_MS);
                this._tickTimer = setInterval(() => this._tick(), this.TICK_MS);
                this._load();
            }
        });
    },

    // ----------------------------------------
    // Settings: enable / idle / hide
    // ----------------------------------------

    _loadSettings() {
        const parsed = Utils.safeJSONParse(localStorage.getItem(this.SETTINGS_KEY), null);
        // Rebase onto a null-prototype object before merging so a stored key
        // like "__proto__" or "constructor" can't reach Object.prototype.
        const safeParsed = (parsed && typeof parsed === 'object')
            ? Object.assign(Object.create(null), parsed)
            : null;
        const s = Object.assign(
            { enabled: true, idleMin: 3, hideMin: 30 },
            safeParsed || {}
        );
        s.enabled = s.enabled !== false;
        s.idleMin = this.IDLE_OPTIONS.includes(Number(s.idleMin)) ? Number(s.idleMin) : 3;
        s.hideMin = this.HIDE_OPTIONS.includes(Number(s.hideMin)) ? Number(s.hideMin) : 30;
        return s;
    },

    _persistSettings() {
        Utils.safeLocalStorageSet(this.SETTINGS_KEY, JSON.stringify(this._settings));
    },

    _isSettingsOpen() {
        return !!document.getElementById('settingsModal')?.classList.contains('show');
    },

    _wireSettingsOpenTriggers() {
        // The names list only needs to be current at the moment Settings
        // becomes visible — hooked here (rather than in the modal's own open
        // path in 2-ui-controllers.js / 3-app-init.js) to keep this widget
        // self-contained.
        //
        // _load() is what actually keeps the list current while the widget
        // is disabled (its top-of-function guard skips everything unless
        // Settings is open) — reused here instead of only re-rendering from
        // whatever _seen/_lastSessions already hold. Deferred one tick:
        // this script's own click listener (registered when it starts,
        // synchronously, before DOMContentLoaded) fires before App.init()'s
        // (registered ON DOMContentLoaded) opens the modal, so _load()'s
        // _isSettingsOpen() check would otherwise run one beat too early.
        const refresh = () => queueMicrotask(() => this._load());
        document.getElementById('settingsBtn')?.addEventListener('click', refresh);
        document.getElementById('settingsTabBtnProjects')?.addEventListener('click', refresh);
    },

    _wireSettingsControls() {
        const enabledEl = document.getElementById('projectsEnabled');
        const idleEl = document.getElementById('projectsIdleMin');
        const hideEl = document.getElementById('projectsHideMin');

        if (enabledEl) {
            enabledEl.checked = this._settings.enabled;
            enabledEl.addEventListener('change', () => {
                this._settings.enabled = enabledEl.checked;
                this._persistSettings();
                if (this._settings.enabled) this._processData();
                else this._closeRow();
            });
        }
        if (idleEl) {
            idleEl.value = String(this._settings.idleMin);
            idleEl.addEventListener('change', () => {
                this._settings.idleMin = this.IDLE_OPTIONS.includes(parseInt(idleEl.value, 10))
                    ? parseInt(idleEl.value, 10) : 3;
                this._persistSettings();
                this._processData();
            });
        }
        if (hideEl) {
            hideEl.value = String(this._settings.hideMin);
            hideEl.addEventListener('change', () => {
                this._settings.hideMin = this.HIDE_OPTIONS.includes(parseInt(hideEl.value, 10))
                    ? parseInt(hideEl.value, 10) : 30;
                this._persistSettings();
                this._processData();
            });
        }
    },

    // ----------------------------------------
    // Settings: project names list
    // ----------------------------------------

    _loadNames() {
        const parsed = Utils.safeJSONParse(localStorage.getItem(this.NAMES_KEY), null);
        return (parsed && typeof parsed === 'object')
            ? Object.assign(Object.create(null), parsed)
            : Object.create(null);
    },

    _persistNames() {
        Utils.safeLocalStorageSet(this.NAMES_KEY, JSON.stringify(this._names));
    },

    _loadSeen() {
        const parsed = Utils.safeJSONParse(localStorage.getItem(this.SEEN_KEY), null);
        return (parsed && typeof parsed === 'object')
            ? Object.assign(Object.create(null), parsed)
            : Object.create(null);
    },

    _persistSeen() {
        Utils.safeLocalStorageSet(this.SEEN_KEY, JSON.stringify(this._seen));
    },

    _updateSeen(sessions, now) {
        const nowIso = new Date(now).toISOString();
        let changed = false;

        for (const s of sessions) {
            const key = s.cwdKey;
            if (!key) continue;
            const folder = s.folder || key;
            const cwd = (s.cwd || folder).slice(0, 260);
            const existing = this._seen[key];
            if (!existing) {
                this._seen[key] = { folder, cwd, lastSeen: nowIso };
                changed = true;
                continue;
            }
            if (existing.folder !== folder) {
                existing.folder = folder;
                changed = true;
            }
            if (existing.cwd !== cwd) {
                existing.cwd = cwd;
                changed = true;
            }
            // Only bump lastSeen (and thus trigger a persist) once the
            // project has moved by at least a minute — avoids a localStorage
            // write on every 10s poll for a session that's just sitting idle.
            const prevMs = Date.parse(existing.lastSeen);
            if (!Number.isFinite(prevMs) || (now - prevMs) >= this.SEEN_MIN_BUMP_MS) {
                existing.lastSeen = nowIso;
                changed = true;
            }
        }

        const cutoff = now - this.SEEN_MAX_AGE_MS;
        for (const [key, info] of Object.entries(this._seen)) {
            const t = Date.parse(info?.lastSeen);
            if (!Number.isFinite(t) || t < cutoff) {
                delete this._seen[key];
                changed = true;
            }
        }

        // Cap at the N most-recently-seen projects, evicting the oldest.
        // claudeProjectsNames (custom renames) is deliberately never pruned
        // here — a rename is durable user data even after its project ages
        // out of "seen".
        const entries = Object.entries(this._seen);
        if (entries.length > this.SEEN_MAX_ENTRIES) {
            entries.sort((a, b) => Date.parse(a[1]?.lastSeen) - Date.parse(b[1]?.lastSeen));
            const evictCount = entries.length - this.SEEN_MAX_ENTRIES;
            for (let i = 0; i < evictCount; i++) delete this._seen[entries[i][0]];
            changed = true;
        }

        if (changed) this._persistSeen();
    },

    _wireNamesList() {
        const list = document.getElementById('projectNamesList');
        if (!list) return;
        list.addEventListener('change', (e) => {
            const input = e.target.closest('.projects-name-input');
            if (!input) return;
            const row = input.closest('.projects-name-row');
            const key = row?.dataset.cwdKey;
            if (!key) return;
            const val = input.value.slice(0, 60).trim();
            if (val) this._names[key] = val;
            else delete this._names[key];
            this._persistNames();
            // Reflect the rename on any visible bar immediately, without
            // waiting for the next 10s poll.
            this._processData();
        });
    },

    _renderNamesList() {
        try {
            const list = document.getElementById('projectNamesList');
            if (!list) return;

            const entries = new Map(); // cwdKey -> { folder, path }
            for (const [key, info] of Object.entries(this._seen)) {
                const folder = this._str(info?.folder) || key;
                const path = this._str(info?.cwd) || folder;
                entries.set(key, { folder, path });
            }
            for (const s of this._lastSessions) {
                if (!s.cwdKey) continue;
                const folder = this._str(s.folder) || s.cwdKey;
                const path = this._str(s.cwd) || folder;
                entries.set(s.cwdKey, { folder, path });
            }

            if (entries.size === 0) {
                list.querySelectorAll('.projects-name-row').forEach(row => row.remove());
                if (!list.querySelector('.projects-names-empty')) {
                    const empty = document.createElement('p');
                    empty.className = 'projects-names-empty';
                    empty.textContent = 'No projects seen yet.';
                    list.appendChild(empty);
                }
                return;
            }
            list.querySelector('.projects-names-empty')?.remove();

            const sorted = Array.from(entries.entries())
                .sort((a, b) => a[1].folder.localeCompare(b[1].folder, undefined, { sensitivity: 'base' }));

            // Never clobber a row the user is actively typing in.
            const focusedRow = document.activeElement?.closest?.('.projects-name-row');
            const focusedKey = focusedRow?.dataset.cwdKey;

            const seenKeys = new Set();
            for (const [key, info] of sorted) {
                seenKeys.add(key);
                let row = list.querySelector(`.projects-name-row[data-cwd-key="${CSS.escape(key)}"]`);
                if (!row) row = this._createNameRow(key, list);

                const label = row.querySelector('.projects-name-label');
                if (label) {
                    if (label.textContent !== info.folder) label.textContent = info.folder;
                    // Skip the title when it would just repeat the visible
                    // label (folder and full path happen to be the same, or
                    // no path is known yet) — a tooltip that echoes what's
                    // already on screen is noise, not help.
                    const wantTitle = info.path && info.path !== info.folder ? info.path : '';
                    if (label.title !== wantTitle) label.title = wantTitle;
                }
                const input = row.querySelector('.projects-name-input');
                if (input && key !== focusedKey) {
                    if (input.placeholder !== info.folder) input.placeholder = info.folder;
                    const rawName = this._names[key];
                    const val = typeof rawName === 'string' ? rawName : '';
                    if (input.value !== val) input.value = val;
                }
            }

            list.querySelectorAll('.projects-name-row').forEach(row => {
                // The focused-row guard mirrors the value/placeholder guard
                // above: never destroy the row the user is typing in, even if
                // its entry just aged out of _seen.
                if (!seenKeys.has(row.dataset.cwdKey) && row.dataset.cwdKey !== focusedKey) row.remove();
            });

            // Reposition into alphabetical order without recreating focused rows.
            let cursor = list.firstElementChild;
            for (const [key] of sorted) {
                const row = list.querySelector(`.projects-name-row[data-cwd-key="${CSS.escape(key)}"]`);
                if (!row) continue;
                if (cursor !== row) list.insertBefore(row, cursor);
                cursor = row.nextElementSibling;
            }
        } catch (e) {
            console.warn('[ProjectsWidget]', e);
        }
    },

    _createNameRow(cwdKey, list) {
        const row = document.createElement('div');
        row.className = 'projects-name-row';
        row.dataset.cwdKey = cwdKey;
        const inputId = `projectsNameInput-${this._nameRowSeq++}`;
        row.innerHTML = `
            <label class="projects-name-label" for="${inputId}"></label>
            <input type="text" class="projects-name-input" id="${inputId}" autocomplete="off" maxlength="60">`;
        list.appendChild(row);
        return row;
    }
};

window.ProjectsWidget = ProjectsWidget;

// Scripts sit at the end of <body>, so the DOM is ready.
ProjectsWidget.start();
