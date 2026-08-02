// ==========================================
// 9-PROJECTS.JS - Project Status Bar (v4.15)
//
// Renders a row of "project status bars" below the header showing what each
// live Claude Code session (VS Code extension or CLI) is doing, fed by
// Claude Code hooks. The hook script (tools/claude-status-hook.js) writes a
// per-session spool file and re-merges all spool files into claude-projects.js
// at the app root (gitignored, atomic-written), assigning `window.ClaudeProjects`:
//
//   { schemaVersion, generatedAt, sessions: [{ sessionId, cwd, cwdKey, folder,
//     title, state, activity, startedAt, lastEventAt, mainEventAt,
//     pendingSince, pendingTool, lastTool, permissionMode,
//     agents: [{ agentId, agentType, state, activity, startedAt,
//                lastEventAt, pendingSince, pendingTool, lastTool }] }] }
//
// Three levels, and the UI keeps them distinct (v4.15):
//   project      one bar, keyed by cwdKey — a directory, i.e. a VS Code window
//   conversation one session inside it (1-5 are routine) — labelled by a
//                snippet of its first prompt, in the expandable detail list
//   agent        one subagent inside a conversation — an indented row under it
// A session's own state/activity describe its MAIN thread only; `agents` is
// live workers only (the hook drops them on SubagentStop), which is what lets
// "main stopped but agents still running" render as working rather than as
// your-turn. schemaVersion 1 (pre-v4.15 hook) is still accepted and renders
// flat: no title, no agents, one chat row per session.
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
    POLL_MS: 6 * 1000,         // re-read claude-projects.js
    // The same poll while the tab is hidden. Slower, but NOT stopped, which
    // is what it used to be: pausing it froze window.ClaudeProjects at the
    // moment the tab went away, and _processData measures that snapshot
    // against a live clock. A tab left behind VS Code for longer than
    // hideMin therefore failed *every* arriving permission request — the
    // staleness gate returned above _queueAlerts (no sound) and above
    // _releaseUnattached (no handback either), so the request just sat there
    // until the broker's 150s hold ran out. Chromium throttles a hidden
    // tab's timers to once per minute after five minutes hidden anyway, so
    // this is a ceiling on the cadence, not a promise about it — the
    // forced reload in _bailWithApprovals is what makes the response prompt.
    POLL_HIDDEN_MS: 30 * 1000,
    TICK_MS: 1000,              // refresh the "time since" numbers
    MAX_BARS: 6,
    MAX_CHAT_ROWS: 6,           // per project, then "+N more"
    MAX_AGENT_ROWS: 8,          // per conversation, then "+N more"
    // Agents are aged out on their own clock, NOT the user's idle setting: an
    // agent inside one long tool call (a test suite, a slow fetch) can easily
    // out-wait a 1-3 minute idle threshold while being perfectly alive, and
    // dropping it would flip its conversation back to "Your turn".
    AGENT_IDLE_MS: 15 * 60 * 1000,
    SEEN_MAX_AGE_MS: 60 * 24 * 60 * 60 * 1000,   // prune claudeProjectsSeen after 60 days
    SEEN_MAX_ENTRIES: 100,                       // cap claudeProjectsSeen at the 100 most-recent
    SEEN_MIN_BUMP_MS: 60 * 1000,                 // only persist a lastSeen bump every >=60s

    // Remote approve (v4.17): the loopback broker that holds Claude Code
    // permission requests (tools/claude-approve-broker.js). Polled fast — a
    // held request is a person waiting — but only while the page is visible
    // AND the setting is on; each /pending poll doubles as the heartbeat
    // that tells the broker the buttons are actually on screen. No poll for
    // ~8s and the broker releases everything back to the VS Code dialog,
    // which is what makes "homepage closed" equal "feature off".
    APPROVE_BASE: 'http://127.0.0.1:8765',
    APPROVE_POLL_MS: 2000,

    // Auto-allow (v4.22): a per-project timed override, armed from the bar's
    // hourglass button. While armed, every broker-held request from that
    // project is answered "allow" at the poll stage — it never becomes a
    // button row, a needs-you state, a sound, or a tab alert. The window is
    // hard-capped: the expiry is checked at DECISION time (not render time),
    // so a throttled background tab can never approve past the deadline.
    // State lives in sessionStorage — a REFRESH resumes the countdown (a
    // disappearing window on F5 was the first field complaint), but the
    // storage dies with the tab, so "homepage closed == feature off" still
    // holds, and the absolute deadline means nothing can resume past it.
    ARM_MIN: 5,
    ARM_MAX: 60,
    ARM_STEP: 5,
    ARM_DEFAULT: 30,
    ARM_EXPIRING_MS: 60 * 1000,   // last-minute visual state on the pill

    // Alert sound for a new permission request. Spaces in the filename are
    // encoded because this is a URL, not a path.
    SOUND_SRC: 'Claude%20permission%20request%202.mp3',
    SOUND_COOLDOWN_MIN: 1,
    SOUND_COOLDOWN_MAX: 60,

    // Tab alert while a permission request is waiting. Both frames must read
    // as "pending" on their own: a background tab's timers are throttled to
    // once per second, then once per MINUTE after five minutes hidden, so the
    // blink can freeze on either frame — and a pinned tab shows no title
    // text, which makes the favicon the only signal there. Spaces encoded
    // because these are URLs, not paths.
    TAB_ALERT_ICONS: ['Favicon%20-%20Question%201.png', 'Favicon%20-%20Question%202.png'],
    TAB_ALERT_TITLE: 'Approve❓',
    TAB_ALERT_BLINK_MS: 1000,

    SETTINGS_KEY: 'claudeProjectsSettings',
    NAMES_KEY: 'claudeProjectsNames',
    SEEN_KEY: 'claudeProjectsSeen',
    EXPANDED_KEY: 'claudeProjectsExpanded',
    AUTO_ALLOW_KEY: 'claudeProjectsAutoAllow',   // sessionStorage, not localStorage

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

    // needs-you without Allow/Deny buttons attached means the dialog is in
    // VS Code — the held request ran out its homepage window (broker 150 s),
    // the tool isn't mediated, or remote approve is off. Same state, but the
    // place to act moved, and the label has to say so: after an expiry the
    // buttons vanish while the state stays needs-you, and an unchanged
    // "Needs approval" reads as if there were still something to click here.
    VSCODE_STATE_LABEL: 'Approve in VS Code',
    VSCODE_TITLE_WORD: 'waiting for approval in VS Code',

    _settings: null,
    _names: null,
    _seen: null,
    _expanded: null,
    _lastSessions: [],
    _barStates: Object.create(null),
    _nameRowSeq: 0,
    _barSeq: 0,
    _badDataWarned: false,
    _pollTimer: null,
    _tickTimer: null,
    _closeFallbackTimer: null,
    _closeEndHandler: null,
    _alertQueue: [],
    _alertClearTimer: null,
    _approveTimer: null,
    _approvals: [],
    _approveOnline: null,   // null = not yet tried, false = unreachable, true = talking
    _approveBusy: null,     // Set of approval ids with a /decide in flight
    _approveToken: '',      // per-broker-start secret; see _loadApproveToken
    _alertSeen: null,       // announced-and-still-waiting -> { at, done }; see _queueAlerts
    _staleReloadKey: null,  // generatedAt already retried once by _bailWithApprovals
    _approveMode: '',       // broker's own 'on' | 'disabled'
    _approveInFlight: false,
    _decided: null,         // ids answered here, suppressed until the broker forgets them
    _unattached: null,      // id -> consecutive polls with no bar to render on
    _audio: null,
    _lastSoundMs: 0,
    _allowAllBusy: false,
    _autoAllow: null,       // cwdKey (lowercased) -> { until: ms, count: n }
    _autoFailed: null,      // approval id -> consecutive failed auto /decide POSTs
    _armLastMins: 0,        // last committed duration, session-memory only
    _armPopSeq: 0,
    _armPopCloser: null,    // document-level pointerdown handler while a popover is open
    _tabAlertOn: false,
    _tabAlertTimer: null,
    _tabAlertRestore: null, // original favicon href + title, captured at first alert

    start() {
        if (!document.getElementById('projectsRow')) return;

        this._settings = this._loadSettings();
        this._names = this._loadNames();
        this._seen = this._loadSeen();
        this._expanded = this._loadExpanded();

        this._wireSettingsControls();
        this._wireNamesList();
        this._wireSettingsOpenTriggers();
        this._wireRowInteraction();
        this._wireApproveShortcut();
        this._wireApproveGoodbye();
        this._wireVisibilityPause();

        // Collections first: _load()'s script onload is async today, but the
        // approval paths reached from _processData must never find these
        // half-initialised.
        this._approveBusy = new Set();
        this._alertSeen = new Map();
        this._decided = new Set();
        this._unattached = new Map();
        this._autoAllow = this._loadAutoAllow();
        this._autoFailed = new Map();
        clearInterval(this._pollTimer);
        clearInterval(this._tickTimer);
        this._load();
        // Cadence by visibility from the very first tick: this page is often
        // opened into a background tab at boot (serve.bat / serve-hidden.vbs),
        // which never fires a visibilitychange to correct it afterwards.
        this._syncDataPoll();
        if (!document.hidden) this._tickTimer = setInterval(() => this._tick(), this.TICK_MS);
        this._syncApprovePoll();
    },

    /** (Re)start the claude-projects.js poll at the cadence for the current
     *  visibility — see POLL_HIDDEN_MS for why hidden is slow, not off. */
    _syncDataPoll() {
        clearInterval(this._pollTimer);
        this._pollTimer = setInterval(() => this._load(),
            document.hidden ? this.POLL_HIDDEN_MS : this.POLL_MS);
    },

    /** Coerce to string, never throw regardless of what disk/localStorage handed us. */
    _str(v) {
        return typeof v === 'string' ? v : '';
    },

    /** Whole number within [min, max]; anything unparseable becomes fallback. */
    _clampInt(v, min, max, fallback) {
        const n = Math.round(Number(v));
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, n));
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
        // _syncTabAlert here too: this is the one path that skips
        // _processData's finally, and a held approval can outlive the data
        // file (every session ended, merge deleted it).
        // _bailWithApprovals before the close: a held request needs either a
        // retry (the hook writes tmp-file + rename, so a fetch can legitimately
        // land in the gap) or a handback — never a silent wait.
        s.onerror = () => {
            s.remove();
            this._bailWithApprovals(null);
            this._closeRow();
            this._syncTabAlert();
        };
        document.head.appendChild(s);
    },

    _processData() {
        try {
            const data = window.ClaudeProjects;
            // An unknown schemaVersion means the writer
            // (tools/claude-status-hook.js) is a version this widget doesn't
            // understand — the generator always writes a fresh file, so a
            // mismatch means real version skew, not a stale-but-still-valid
            // file. Treated the same as missing/malformed. 1 stays accepted
            // so an older hook (or a file written moments before an upgrade)
            // still renders, just without titles or agents.
            if (!data || typeof data !== 'object' || !Array.isArray(data.sessions)
                || (data.schemaVersion !== 1 && data.schemaVersion !== 2)) {
                if (!this._badDataWarned) {
                    this._badDataWarned = true;
                    console.warn('[ProjectsWidget] claude-projects.js missing, malformed, or schema mismatch; hiding project row.');
                }
                this._bailWithApprovals(data && data.generatedAt);
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
                    sessionId: this._str(s.sessionId),
                    cwdKey: this._str(s.cwdKey),
                    cwd: this._str(s.cwd),
                    folder: this._str(s.folder),
                    title: this._str(s.title),
                    activity: this._str(s.activity) || null,
                    state: this._str(s.state),
                    startedAt: this._str(s.startedAt),
                    lastEventAt: this._str(s.lastEventAt),
                    // Absent on schemaVersion 1 — the session's own clock is
                    // then the main thread's clock, which is exactly right
                    // for a file that has no agents in it.
                    mainEventAt: this._str(s.mainEventAt) || this._str(s.lastEventAt),
                    pendingSince: typeof s.pendingSince === 'string' ? s.pendingSince : null,
                    pendingTool: this._str(s.pendingTool),
                    agents: (Array.isArray(s.agents) ? s.agents : [])
                        .filter(a => a && typeof a === 'object')
                        .map(a => ({
                            agentId: this._str(a.agentId),
                            agentType: this._str(a.agentType),
                            activity: this._str(a.activity) || null,
                            state: this._str(a.state),
                            startedAt: this._str(a.startedAt),
                            lastEventAt: this._str(a.lastEventAt),
                            pendingSince: typeof a.pendingSince === 'string' ? a.pendingSince : null,
                            pendingTool: this._str(a.pendingTool),
                        }))
                        .filter(a => a.agentId),
                }));

            // Remote-approve overlay (v4.17): a request held by the broker is
            // a real "needs approval" that the spool can never know about —
            // the whole point of the design is that no PermissionRequest
            // event fires for it. Painted onto the freshly-coerced local
            // copies (never onto window.ClaudeProjects itself) BEFORE any
            // state derivation, so the existing needs-you rules — precedence
            // over the idle clock, auto-expand, the announcement — all apply
            // to broker-held requests for free.
            // Auto-allow (v4.22) runs BEFORE the overlay: requests belonging
            // to an armed project are answered and stripped here, so they
            // never flip a thread to needs-you, never render buttons, never
            // play the sound, and never flash the tab. Both arrival paths
            // (broker poll and data reload) converge on this one sweep.
            this._sweepArmedApprovals(sessions);

            this._applyApprovalOverlay(sessions);

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
                this._bailWithApprovals(data.generatedAt);
                this._closeRow();
                return;
            }

            const idleMs = this._settings.idleMin * 60000;
            const kept = sessions.filter(s => {
                const t = Date.parse(s.lastEventAt);
                return Number.isFinite(t) && (now - t) <= hideMs;
            });
            if (kept.length === 0) {
                this._bailWithApprovals(data.generatedAt);
                this._closeRow();
                return;
            }
            // Rendered from this file, so a later stale episode gets its own
            // retry rather than inheriting a spent one.
            this._staleReloadKey = null;

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
            // Held requests that found no bar this pass get handed back to
            // VS Code rather than stalling invisibly — see _releaseUnattached.
            if (this._approvals.length) {
                const attached = new Set();
                for (const bar of bars.values()) {
                    for (const a of bar.approvals) attached.add(a.id);
                }
                this._releaseUnattached(attached);
            }
            this._queueAlerts(bars);
            this._renderRow(bars);
            this._syncAllowAll();
        } catch (e) {
            console.warn('[ProjectsWidget]', e);
            this._closeRow();
        } finally {
            // finally, not the happy path: _processData has four early
            // returns and every _approvals mutation converges here, so this
            // is the one spot where the tab alert can track the truth on
            // every path.
            this._syncTabAlert();
        }
    },

    // ----------------------------------------
    // Remote approve (v4.17): poll the broker, overlay held requests onto
    // the session data, and answer them from the bar's Allow/Deny buttons.
    // Every failure here fails toward "the VS Code dialog appears" — this
    // widget can delay an approval (150s worst case), never grant one.
    // ----------------------------------------

    /**
     * Start/stop the 2s broker poll to match setting + page visibility.
     *
     * Deliberately NOT gated on document.hidden. That gate was the original
     * design ("buttons nobody can see must not hold a request"), and it was
     * wrong in practice: `hidden` covers a fully OCCLUDED window too, so
     * working in VS Code with the homepage behind it stopped the poll and
     * bounced every request back to a dialog after ~16 s — the log recorded
     * it as cause `homepage-gone`. Since the sound already announces a
     * request whether or not the window is visible, and the 150 s hold still
     * caps how long anything waits, the poll now keeps running while hidden
     * and simply says so (?hidden=1), which tells the broker to judge
     * liveness on a clock that survives background timer throttling.
     * "Homepage closed == feature off" still holds, via the explicit goodbye
     * in _wireApproveGoodbye().
     *
     * Also refuses to run inside a frame. Approving is code execution, and a
     * framed homepage is clickjackable: a hostile page can overlay bait on
     * the Allow button, and the resulting click is a genuine same-origin
     * event no token or Origin check can distinguish. Nothing serves this
     * app with frame-ancestors headers (python -m http.server), so the
     * capability declines to exist in a frame rather than trusting one.
     */
    _syncApprovePoll() {
        let framed = true;
        try { framed = window.top !== window.self; } catch (_e) { /* cross-origin parent */ }
        const want = this._settings.enabled && this._settings.approve && !framed;
        if (want && !this._approveTimer) {
            this._approveTimer = setInterval(() => this._pollApprovals(), this.APPROVE_POLL_MS);
            this._pollApprovals();
        } else if (!want && this._approveTimer) {
            clearInterval(this._approveTimer);
            this._approveTimer = null;
            // Turning the feature off ends every armed auto-allow window
            // with it — a countdown that can no longer approve anything
            // would be a lie on the bar. Announced, so the end of an armed
            // window is never silent to AT.
            const hadArmed = !!this._autoAllow?.size;
            const hadState = this._approvals.length || hadArmed;
            this._approvals = [];
            this._autoAllow?.clear();
            this._persistAutoAllow();
            if (hadArmed) {
                this._alertQueue.push({ sentence: 'Auto-allow stopped.' });
                this._flushAlerts();
            }
            if (hadState) this._processData();
        }
    },

    /**
     * The broker mints a secret per start and publishes it two ways: a file
     * only it and the hook can read, and approve-token.json at the app root
     * for this page. Fetched same-origin — the page server sends no CORS
     * headers, so no other origin can read it, and JSON (unlike a
     * `window.X = "..."` script) can't be loaded cross-origin via <script>.
     * The token then rides on every broker call in a NON-safelisted header,
     * which forces a CORS preflight a foreign origin cannot pass.
     *
     * No token means no buttons: the feature simply stays dormant and
     * Claude Code keeps prompting in VS Code, which is the correct failure.
     */
    async _loadApproveToken() {
        try {
            const res = await fetch(`approve-token.json?t=${Date.now()}`, {
                signal: AbortSignal.timeout(1500),
                cache: 'no-store'
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            const token = this._str(data?.token);
            this._approveToken = /^[0-9a-f]{64}$/.test(token) ? token : '';
        } catch (_e) {
            this._approveToken = '';
        }
        return this._approveToken;
    },

    async _pollApprovals() {
        // A slow poll must not overlap the next tick's — two in flight can
        // land out of order and resurrect a list the newer one had dropped.
        if (this._approveInFlight) return;
        this._approveInFlight = true;
        try {
            // A restarted broker mints a new token, so a 403 means "re-read
            // the file", not "give up" — one retry, then the next poll.
            let token = this._approveToken || await this._loadApproveToken();
            if (!token) throw new Error('no-token');
            // ?hidden=1 is not "I'm gone" — it's "judge my liveness on the
            // slow clock", because a background tab's timers are throttled.
            const url = `${this.APPROVE_BASE}/pending${document.hidden ? '?hidden=1' : ''}`;
            let res = await fetch(url, {
                signal: AbortSignal.timeout(1500),
                cache: 'no-store',
                headers: { 'X-Approve-Token': token }
            });
            if (res.status === 403) {
                token = await this._loadApproveToken();
                if (!token) throw new Error('no-token');
                res = await fetch(url, {
                    signal: AbortSignal.timeout(1500),
                    cache: 'no-store',
                    headers: { 'X-Approve-Token': token }
                });
            }
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();

            // Broker responses are localhost-only but still coerced like any
            // other outside input, same stance as claude-projects.js itself.
            const next = (Array.isArray(data?.pending) ? data.pending : [])
                .filter(a => a && typeof a === 'object')
                .map(a => ({
                    id: this._str(a.id).slice(0, 128),
                    sessionId: this._str(a.sessionId).slice(0, 128),
                    agentId: this._str(a.agentId) || null,
                    agentType: this._str(a.agentType).slice(0, 64),
                    toolName: this._str(a.toolName).slice(0, 64),
                    summary: this._str(a.summary).slice(0, 160),
                    createdAt: this._str(a.createdAt)
                }))
                .filter(a => a.id && a.sessionId && a.toolName);

            // A poll issued before our own /decide landed still lists the id
            // we just answered; without this the row visibly reappears for
            // one cycle. The suppression lifts as soon as the broker stops
            // reporting it.
            for (const id of this._decided) {
                if (!next.some(a => a.id === id)) this._decided.delete(id);
            }
            if (this._autoFailed) {
                for (const id of this._autoFailed.keys()) {
                    if (!next.some(a => a.id === id)) this._autoFailed.delete(id);
                }
            }
            const visible = this._decided.size
                ? next.filter(a => !this._decided.has(a.id))
                : next;

            const mode = this._str(data?.mode);
            const changed = visible.length !== this._approvals.length
                || visible.some((a, i) => a.id !== this._approvals[i].id);
            // mode belongs in the status test: with a steady (usually empty)
            // pending list, a sentinel appearing would otherwise leave
            // Settings claiming "connected" forever — the one message that
            // must never lie, since it's how the panic switch is confirmed.
            const statusChanged = this._approveOnline !== true || changed || mode !== this._approveMode;
            this._approveOnline = true;
            this._approveMode = mode;

            if (changed) {
                this._approvals = visible;
                // A brand-new session's very first tool call can be held
                // before the 10s data poll has ever seen that session; the
                // approval needs a bar to land on, so refresh the data file
                // rather than waiting out the poll.
                const known = new Set(this._lastSessions.map(s => s.sessionId));
                if (visible.some(a => !known.has(a.sessionId))) this._load();
                else this._processData();
            }
            if (statusChanged) this._updateApproveStatus(mode);
            // The reminder's clock lives here, not on the render pass: a
            // request that changes nothing renders nothing, and this poll is
            // the only thing that keeps running at a useful rate while the
            // tab is hidden — which is the case the reminder exists for.
            this._maybeRemind(Date.now());
        } catch (_e) {
            const wentOffline = this._approveOnline !== false;
            this._approveOnline = false;
            this._approveMode = '';
            if (this._approvals.length) {
                this._approvals = [];
                this._processData();
            }
            if (wentOffline) this._updateApproveStatus('');
        } finally {
            this._approveInFlight = false;
        }
    },

    /**
     * A bail-out path in _processData was reached — data missing, malformed,
     * stale, or every session aged past hideMin — while the broker still
     * holds requests for us. Two things have to happen here, and until v4.23
     * neither did: every one of those paths returns *above* both
     * _queueAlerts and _releaseUnattached, so a held request got no sound,
     * no buttons and no handback, and simply sat until the 150s hold expired.
     *
     *  - One forced reload first. The usual reason the snapshot is stale is
     *    that the tab is hidden and its poll is slow (POLL_HIDDEN_MS, and
     *    Chromium throttles that further) — while the file itself is fresh,
     *    because the status hook rewrote it for this very tool call. Keyed
     *    on the generatedAt we just rejected so one attempt is spent per
     *    distinct file: a genuinely stale file cannot start a reload loop.
     *  - Then hand the requests back. If the reload changed nothing there is
     *    no bar to put buttons on, and _releaseUnattached is exactly the
     *    machinery for that ("I can't show this — let VS Code ask"), with
     *    its own two-miss hysteresis on top of the retry above.
     */
    _bailWithApprovals(stamp) {
        if (!this._approvals.length) return;
        const key = `k:${stamp || ''}`;
        if (this._staleReloadKey !== key) {
            this._staleReloadKey = key;
            this._load();
            return;
        }
        this._releaseUnattached(new Set());
    },

    /**
     * A held request whose session never appears in claude-projects.js has
     * no bar to put buttons on — the status hook isn't installed for that
     * project, or the session aged out of the merged file. Left alone the
     * user would see Claude frozen for the full 150 s hold with neither a
     * button nor a dialog, which is the worst failure this design can
     * produce. So the page hands it back: "I can't show this — let VS Code
     * ask." Two consecutive misses, because the first poll after a brand-new
     * session starts legitimately races the data reload.
     */
    _releaseUnattached(attachedIds) {
        for (const a of this._approvals) {
            if (attachedIds.has(a.id) || this._approveBusy.has(a.id)) {
                this._unattached.delete(a.id);
                continue;
            }
            const misses = (this._unattached.get(a.id) || 0) + 1;
            this._unattached.set(a.id, misses);
            if (misses < 2) continue;
            this._unattached.delete(a.id);
            this._approveBusy.add(a.id);
            this._decided.add(a.id);
            this._approvals = this._approvals.filter(x => x.id !== a.id);
            console.warn('[ProjectsWidget] approval for an unknown session handed back to VS Code:', a.toolName);
            fetch(`${this.APPROVE_BASE}/decide`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Approve-Token': this._approveToken
                },
                body: JSON.stringify({ id: a.id, decision: 'passthrough' }),
                signal: AbortSignal.timeout(4000)
            }).catch(() => { /* broker gone: it releases on its own */ })
              .finally(() => this._approveBusy.delete(a.id));
        }
        for (const id of this._unattached.keys()) {
            if (!this._approvals.some(a => a.id === id)) this._unattached.delete(id);
        }
    },

    /**
     * Mutates the freshly-coerced session copies so a held request reads
     * exactly like a hook-reported permission wait: state, pendingSince and
     * pendingTool on the right THREAD (main vs one agent — the same
     * per-thread rule the spool enforces). The raw list also rides along on
     * the session for the button strip.
     */
    _applyApprovalOverlay(sessions) {
        if (!this._settings.approve || this._approvals.length === 0) return;
        const bySession = new Map();
        for (const a of this._approvals) {
            if (!bySession.has(a.sessionId)) bySession.set(a.sessionId, []);
            bySession.get(a.sessionId).push(a);
        }
        for (const s of sessions) {
            const apps = bySession.get(s.sessionId);
            if (!apps) continue;
            s.__approvals = apps;
            for (const a of apps) {
                // An agent id the spool doesn't know (its record raced out)
                // falls back to the main thread — the request must surface
                // SOMEWHERE rather than be dropped for tidiness.
                const target = (a.agentId && s.agents.find(g => g.agentId === a.agentId)) || s;
                target.state = 'needs-you';
                // Number.isFinite, not a bare comparison: an unparseable
                // pendingSince makes every comparison false, which would
                // keep the junk value and silently drop the tool name from
                // the bar (_computeChat filters unparseable pendings out).
                const prevMs = Date.parse(target.pendingSince);
                if (!Number.isFinite(prevMs) || Date.parse(a.createdAt) >= prevMs) {
                    target.pendingSince = a.createdAt;
                    target.pendingTool = a.toolName;
                }
            }
        }
    },

    // ----------------------------------------
    // Auto-allow (v4.22): a per-project timed override. Armed by a trusted
    // click on the bar's hourglass button; while armed, every broker-held
    // request from that project is answered "allow" by _sweepArmedApprovals.
    // The invariants that must survive any refactor:
    //  - Arming requires a real user gesture (isTrusted, checked in the
    //    delegated listeners) — same rule as the Allow buttons themselves.
    //  - The expiry is enforced at DECISION time, per request, in the sweep.
    //    No timer, tick, or render is load-bearing for the deadline: a
    //    throttled background tab delays decisions, never extends the window.
    //  - Still one /decide per tool_use_id, never a broker-side switch —
    //    arming is standing intent held by THIS page, and dies with it.
    //  - Memory-only state: reload or close disarms. "Homepage closed ==
    //    feature off" applies to the override exactly as to the buttons.
    //  - Auto decisions carry `auto: true` so approve-log.jsonl can tell an
    //    armed window (cause `homepage-auto`) from a click.
    // ----------------------------------------

    /**
     * Armed windows survive a REFRESH, not a departure: sessionStorage is
     * per-tab, so a reload (plain or hard) resumes the countdown while
     * closing the tab ends the feature with the page. Deadlines are stored
     * absolute, so a restore can never extend a window, and anything
     * malformed, expired, or implausibly far out fails toward OFF —
     * dropped, never clamped up.
     */
    _loadAutoAllow() {
        const map = new Map();
        try {
            const parsed = JSON.parse(sessionStorage.getItem(this.AUTO_ALLOW_KEY) || 'null');
            if (parsed && typeof parsed === 'object') {
                const now = Date.now();
                const maxUntil = now + this.ARM_MAX * 60000 + 5000;
                for (const [key, v] of Object.entries(parsed)) {
                    if (map.size >= 32) break;
                    const until = Number(v?.until);
                    if (!key || !Number.isFinite(until)) continue;
                    if (until <= now || until > maxUntil) continue;
                    map.set(key.toLowerCase(), {
                        until,
                        count: this._clampInt(v?.count, 0, 9999, 0)
                    });
                }
            }
        } catch (_e) { /* unreadable storage: stay disarmed */ }
        return map;
    },

    _persistAutoAllow() {
        try {
            if (!this._autoAllow || this._autoAllow.size === 0) {
                sessionStorage.removeItem(this.AUTO_ALLOW_KEY);
                return;
            }
            const obj = {};
            for (const [k, v] of this._autoAllow) obj[k] = { until: v.until, count: v.count };
            sessionStorage.setItem(this.AUTO_ALLOW_KEY, JSON.stringify(obj));
        } catch (_e) { /* storage blocked: the window becomes memory-only */ }
    },

    /**
     * Answer held requests belonging to an armed project before they can
     * surface. Runs inside _processData against the freshly-coerced session
     * list — the one source that maps sessionId -> project directory — so a
     * brand-new session's first request is swept the moment its cwd is
     * known, and an unknown session falls through to the ordinary button
     * path (fail toward a human seeing it).
     */
    _sweepArmedApprovals(sessions) {
        // Explicit even though _syncApprovePoll clears _autoAllow when either
        // setting flips off — a non-local invariant is not enough protection
        // for the app's most consequential code path.
        if (!this._settings.enabled || !this._settings.approve) return;
        if (!this._autoAllow || this._autoAllow.size === 0) return;
        if (this._approvals.length === 0) return;
        const now = Date.now();
        const hideMs = this._settings.hideMin * 60000;
        const keyById = new Map();
        for (const s of sessions) {
            // Only sessions that will actually render a bar: no bar means no
            // armed pill and no disarm control, and a grant with no visible
            // stop button is the worst shape this feature can fail in. A
            // session past hideMin falls through to _releaseUnattached's
            // hand-back instead.
            const t = Date.parse(s.lastEventAt);
            if (!Number.isFinite(t) || (now - t) > hideMs) continue;
            keyById.set(s.sessionId, s.cwdKey || String(s.cwd || '').toLowerCase());
        }
        const rest = [];
        for (const a of this._approvals) {
            const barKey = keyById.get(a.sessionId) || '';
            const entry = barKey ? this._autoAllow.get(barKey.toLowerCase()) : null;
            // A request whose auto /decide keeps failing gets its buttons
            // back rather than staying invisible for the rest of the hold.
            const broken = (this._autoFailed?.get(a.id) || 0) >= 2;
            // The deadline check lives here, at the moment of decision.
            if (entry && !broken && now < entry.until && !this._approveBusy.has(a.id)) {
                this._autoDecide(a, entry, barKey);
            } else {
                rest.push(a);
            }
        }
        if (rest.length !== this._approvals.length) this._approvals = rest;
    },

    /** One /decide {allow, auto:true} for one swept request. */
    _autoDecide(a, entry, barKey) {
        if (this._decided.has(a.id)) return;
        this._approveBusy.add(a.id);
        this._decided.add(a.id);
        fetch(`${this.APPROVE_BASE}/decide`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Approve-Token': this._approveToken
            },
            body: JSON.stringify({ id: a.id, decision: 'allow', auto: true }),
            signal: AbortSignal.timeout(4000)
        }).then(async (res) => {
            if (!res.ok) throw new Error(String(res.status));
            const outcome = await res.json().catch(() => null);
            // gone:true means the hold already lapsed (hook timeout, broker
            // sweep) — nothing was approved, so the tally must not move.
            if (outcome && outcome.ok === true) {
                entry.count += 1;
                this._persistAutoAllow();   // the tally survives a refresh too
                this._ackAutoAllow(barKey);
            }
            this._autoFailed?.delete(a.id);
        }).catch(() => {
            // Didn't land: forget we answered so the next poll re-lists it —
            // back through the sweep if still armed, or as buttons once the
            // failure count trips the sweep's fallback (a request must never
            // sit invisible for the whole hold). A fully dead /decide path
            // is backstopped by the broker's own hold timeout (VS Code asks).
            this._decided.delete(a.id);
            this._autoFailed?.set(a.id, (this._autoFailed.get(a.id) || 0) + 1);
        }).finally(() => this._approveBusy.delete(a.id));
    },

    /** One quiet swell of the armed pill's fill per landed auto-approval —
     *  perceptible peripherally, demanding nothing. Fill alpha only; the
     *  global reduced-motion animation killer is allowed to remove it. */
    _ackAutoAllow(barKey) {
        const li = document.querySelector(
            `.project-bar[data-cwd-key="${CSS.escape(barKey)}"]`);
        const btn = li?.querySelector('.pb-arm.is-armed');
        if (!btn) return;
        btn.classList.remove('is-ack');
        void btn.offsetWidth; // restart for back-to-back approvals
        btn.classList.add('is-ack');
        clearTimeout(btn._ackTimer);
        btn._ackTimer = setTimeout(() => btn.classList.remove('is-ack'), 1400);
    },

    /**
     * End an armed window. Mutation + announcement only — callers own the
     * re-render, because this is reachable from inside one (_syncArm). The
     * Map delete doubles as the idempotency guard.
     */
    _disarm(key, reason, name) {
        if (!this._autoAllow || !this._autoAllow.delete(key)) return false;
        this._persistAutoAllow();
        this._alertQueue.push({ sentence: reason === 'expired'
            ? `Auto-allow expired on ${name}.`
            : `Auto-allow stopped on ${name}.` });
        return true;
    },

    /**
     * Reconcile the hourglass pill on one bar. An unarmed button hides
     * whenever remote approve can't actually deliver (setting off, broker
     * unreachable, sentinel) — arming would be a promise the page can't
     * keep. An ARMED pill stays visible regardless: the countdown is real
     * and the disarm control must never disappear while the state exists.
     */
    _syncArm(li, bar) {
        const btn = li.querySelector('.pb-arm');
        if (!btn) return;
        const key = bar.cwdKey.toLowerCase();
        let entry = this._autoAllow.get(key);
        if (entry && Date.now() >= entry.until) {
            // Lapsed between ticks (or while the tab was hidden): announce
            // once, render unarmed. The queued alert flushes at the end of
            // this same render pass (_renderRow -> _flushAlerts).
            this._disarm(key, 'expired', bar.name);
            entry = null;
        }
        const armed = !!entry;
        const avail = this._settings.approve && this._approveOnline === true
            && this._approveMode !== 'disabled';
        const show = armed || avail;
        if (btn.hidden !== !show) btn.hidden = !show;
        li.classList.toggle('is-armed', armed);
        btn.classList.toggle('is-armed', armed);
        if (!armed) {
            btn.classList.remove('is-expiring', 'is-ack');
            delete btn.dataset.until;
            delete btn.dataset.armBucket;
            // Restore the disclosure semantics an armed render removed —
            // unarmed, the button opens the popover again.
            if (!btn.hasAttribute('aria-haspopup')) {
                btn.setAttribute('aria-haspopup', 'dialog');
                btn.setAttribute('aria-expanded', 'false');
            }
            const countEl = btn.querySelector('.pb-arm-count');
            if (countEl && countEl.textContent !== '') countEl.textContent = '';
            const label = `Auto-allow permission requests in ${bar.name} for a timed window`;
            if (btn.getAttribute('aria-label') !== label) {
                btn.setAttribute('aria-label', label);
                btn.title = 'Auto-allow for a timed window…';
            }
            // Hidden entirely ⇒ any open duration popover goes with it; a
            // visible unarmed button keeps its popover (user mid-choice).
            if (!show) this._closeArmPop(li, false);
            return;
        }
        btn.dataset.until = String(entry.until);
        this._closeArmPop(li, false); // click on an armed pill means "stop"
        // An armed pill opens nothing — announcing "has popup, collapsed"
        // on what is now a stop button would be a lie to AT.
        btn.removeAttribute('aria-haspopup');
        btn.removeAttribute('aria-expanded');
        this._tickArm(btn);
    },

    /** Countdown, expiring state and labels for one armed pill. Display
     *  only — the enforcement copy of the deadline is in the sweep. */
    _tickArm(btn) {
        const until = Number(btn.dataset.until);
        if (!Number.isFinite(until)) return;
        const li = btn.closest('.project-bar');
        const remaining = until - Date.now();
        if (remaining <= 0) {
            const key = (li?.dataset.cwdKey || '').toLowerCase();
            const name = li?.querySelector('.pb-name')?.textContent || 'this project';
            if (this._disarm(key, 'expired', name)) {
                this._flushAlerts();
                // Deferred: this is reachable from inside a render pass
                // (via _syncArm), and _processData must never re-enter.
                setTimeout(() => this._processData(), 0);
            }
            return;
        }
        btn.classList.toggle('is-expiring', remaining <= this.ARM_EXPIRING_MS);
        const total = Math.ceil(remaining / 1000);
        const mm = String(Math.floor(total / 60)).padStart(2, '0');
        const ss = String(total % 60).padStart(2, '0');
        const txt = `${mm}:${ss}`;
        const countEl = btn.querySelector('.pb-arm-count');
        if (countEl && countEl.textContent !== txt) countEl.textContent = txt;
        // Minute-granular accessible name (same churn rule as _tickTime) —
        // rewriting a focused control's label re-announces in some AT, and
        // the pill is focused right after arming. The bucket is the minute
        // ALONE: the tally is read at rewrite time (so it can lag up to a
        // minute) rather than added to the key, where every landed approval
        // would force the exact per-event churn this guard exists to stop.
        const mins = Math.ceil(remaining / 60000);
        const bucket = String(mins);
        if (btn.dataset.armBucket !== bucket) {
            btn.dataset.armBucket = bucket;
            const key = (li?.dataset.cwdKey || '').toLowerCase();
            const count = this._autoAllow.get(key)?.count || 0;
            const label = `Stop auto-allow — ${count} approved so far, ${mins} minute${mins === 1 ? '' : 's'} left`;
            btn.setAttribute('aria-label', label);
            btn.title = label;
        }
    },

    /** Trusted click on the hourglass: armed pill stops; unarmed opens the
     *  duration popover (or closes it, acting as its own toggle). */
    _onArmClick(btn) {
        const li = btn.closest('.project-bar');
        const key = (li?.dataset.cwdKey || '').toLowerCase();
        if (!key) return;
        // Branch on the Map, not the is-armed class: the class can lag one
        // tick behind an expiry, and a click on that stale pill must not
        // open the popover underneath it.
        const entry = this._autoAllow.get(key);
        if (entry) {
            // One click stops it — never confirm the safe direction. An
            // entry whose deadline just passed is announced as what it is.
            const name = li.querySelector('.pb-name')?.textContent || 'this project';
            const reason = Date.now() >= entry.until ? 'expired' : 'stopped';
            if (this._disarm(key, reason, name)) {
                this._flushAlerts();
                this._processData();
            }
            return;
        }
        if (btn.classList.contains('is-armed')) {
            // Stale pill (expiry raced the render): just resync.
            this._processData();
            return;
        }
        const pop = li.querySelector('.pb-armpop');
        if (!pop) return;
        if (!pop.hidden) this._closeArmPop(li, true);
        else this._openArmPop(li);
    },

    _openArmPop(li) {
        // One decision at a time — any other bar's open popover closes.
        document.querySelectorAll('.project-bar.is-arming').forEach(other => {
            if (other !== li) this._closeArmPop(other, false);
        });
        const pop = li.querySelector('.pb-armpop');
        const btn = li.querySelector('.pb-arm');
        const range = pop?.querySelector('.pb-armpop-range');
        if (!pop || !btn || !range) return;
        const name = li.querySelector('.pb-name')?.textContent || 'this project';
        pop.setAttribute('aria-label', `Auto-allow permissions in ${name}`);
        // Prefill with the last duration committed this session — a user
        // who always picks 10 shouldn't re-drag from 30 every time.
        range.value = String(this._armLastMins || this.ARM_DEFAULT);
        // Read by _armFromPop's age guard — a commit landing within 400ms of
        // the popover appearing is a slip (double-press, key repeat), not a
        // considered choice of a standing grant.
        pop.dataset.shownAt = String(Date.now());
        pop.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        // z-index above the following bars in the grid, or the popover
        // paints underneath them — .project-bar establishes no stacking
        // context of its own.
        li.classList.add('is-arming');
        // The row wrap clips (overflow:hidden drives its 0fr collapse), and
        // the popover hangs below the bar — without this the action buttons
        // are cut off on every bar in the grid's last row.
        document.getElementById('projectsRow')?.classList.add('has-armpop');
        this._paintArmPop(li);
        range.focus();
        // Outside pointerdown closes. Capture phase, registered per open —
        // and any stale closer is removed FIRST: a bar torn down with its
        // popover open (row closed mid-choice) would otherwise leave an
        // orphan whose late firing removes the wrong listener.
        if (this._armPopCloser) {
            document.removeEventListener('pointerdown', this._armPopCloser, true);
            this._armPopCloser = null;
        }
        this._armPopCloser = (e) => {
            if (!li.querySelector('.pb-arm-wrap')?.contains(e.target)) {
                // noSteal: the browser is about to focus whatever was
                // clicked; yanking focus back to the hourglass would fight
                // the user's own gesture.
                this._closeArmPop(li, false, true);
            }
        };
        document.addEventListener('pointerdown', this._armPopCloser, true);
    },

    _closeArmPop(li, restoreFocus, noSteal) {
        const pop = li?.querySelector('.pb-armpop');
        if (!pop || pop.hidden) return;
        const btn = li.querySelector('.pb-arm');
        const hadFocus = pop.contains(document.activeElement);
        pop.hidden = true;
        btn?.setAttribute('aria-expanded', 'false');
        li.classList.remove('is-arming');
        // Only one popover can be open, so the wrap unclips exactly with it.
        document.getElementById('projectsRow')?.classList.remove('has-armpop');
        if (this._armPopCloser) {
            document.removeEventListener('pointerdown', this._armPopCloser, true);
            this._armPopCloser = null;
        }
        // Focus must not be silently dropped to <body> when the subtree it
        // lived in goes hidden — same rule as _focusAfterDecision.
        if (!noSteal && (restoreFocus || hadFocus)) {
            if (btn && !btn.hidden) {
                btn.focus();
            } else {
                li.tabIndex = -1;
                li.focus();
            }
        }
    },

    /** Live readout + arm-button label while the popover is open. */
    _paintArmPop(li) {
        const pop = li.querySelector('.pb-armpop');
        if (!pop || pop.hidden) return;
        const range = pop.querySelector('.pb-armpop-range');
        const mins = this._clampInt(range?.value, this.ARM_MIN, this.ARM_MAX, this.ARM_DEFAULT);
        const val = pop.querySelector('.pb-armpop-val');
        const txt = `${mins} min`;
        if (val && val.textContent !== txt) val.textContent = txt;
        // Arming also answers everything currently waiting on this bar —
        // that is plainly the intent, and the label is what keeps it from
        // being a surprise.
        const armBtn = pop.querySelector('.pb-armpop-arm');
        const held = (li.__bar?.approvals || []).length;
        // The duration stays in the committing control's label even when
        // requests are waiting — that label is the statement of what is
        // being granted, and "allow N now" is the rider, not the deal.
        const label = held > 0
            ? `Arm ${mins} min · allow ${held} now`
            : `Arm ${mins} min`;
        if (armBtn && armBtn.textContent !== label) armBtn.textContent = label;
    },

    /** Commit the popover's duration. Reached only from trusted gestures. */
    _armFromPop(li) {
        if (!li) return;
        const key = (li.dataset.cwdKey || '').toLowerCase();
        const pop = li.querySelector('.pb-armpop');
        if (!key || !pop || pop.hidden) return;
        // Same bait-and-switch/slip guard as _decideApproval, and it matters
        // more here: this commit grants a standing window, not one call.
        const shownMs = Number(pop.dataset.shownAt);
        if (Number.isFinite(shownMs) && Date.now() - shownMs < 400) return;
        const range = pop.querySelector('.pb-armpop-range');
        const mins = this._clampInt(range?.value, this.ARM_MIN, this.ARM_MAX, this.ARM_DEFAULT);
        this._armLastMins = mins;
        this._autoAllow.set(key, { until: Date.now() + mins * 60000, count: 0 });
        this._persistAutoAllow();
        const name = li.querySelector('.pb-name')?.textContent || 'this project';
        this._alertQueue.push({ sentence:
            `Auto-allow armed for ${mins} minutes on ${name}.` });
        this._closeArmPop(li, false);
        // Re-render paints the armed pill, and its sweep answers anything
        // already held for this project — the same code path every later
        // auto-approval takes. Also flushes the alert queued above.
        this._processData();
        const btn = li.querySelector('.pb-arm');
        if (btn && !btn.hidden) btn.focus();
    },

    /** One row per held request, reconciled in place under the bar head so
     *  it stays visible (and clickable) even when the project is collapsed. */
    _renderApprovalStrip(li, bar) {
        const strip = li.querySelector('.pb-approvals');
        if (!strip) return;
        const approvals = bar.approvals || [];
        if (approvals.length === 0) {
            if (!strip.hidden) {
                strip.hidden = true;
                strip.replaceChildren();
            }
            return;
        }
        strip.hidden = false;
        const stripLabel = `Permission requests in ${bar.name}`;
        if (strip.getAttribute('aria-label') !== stripLabel) {
            // role=list (matching .pb-chats/.pb-agents) rather than group:
            // assistive tech announces the item count, so "2 items" is a
            // passive signal that a second request is waiting.
            strip.setAttribute('role', 'list');
            strip.setAttribute('aria-label', stripLabel);
        }

        const keep = new Set();
        for (const a of approvals) {
            keep.add(a.id);
            let row = strip.querySelector(`.pb-approval[data-approval-id="${CSS.escape(a.id)}"]`);
            if (!row) {
                // Static shell; every user-influenced string (tool, summary,
                // context, labels) is set via textContent/attributes below.
                row = document.createElement('div');
                row.className = 'pb-approval';
                row.setAttribute('role', 'listitem');
                row.dataset.approvalId = a.id;
                // Read by the anti-clickjack age guard in _decideApproval.
                row.dataset.shownAt = String(Date.now());
                row.innerHTML = `
                    <span class="pb-approval-what">
                        <span class="pb-approval-tool"></span>
                        <span class="pb-approval-summary"></span>
                    </span>
                    <span class="pb-approval-ctx"></span>
                    <span class="pb-approval-actions">
                        <button type="button" class="pb-approval-btn pb-approval-allow glass-control" data-decision="allow">Allow</button>
                        <button type="button" class="pb-approval-btn pb-approval-deny glass-control" data-decision="deny">Deny</button>
                    </span>`;
                strip.appendChild(row);
            }
            const toolEl = row.querySelector('.pb-approval-tool');
            if (toolEl.textContent !== a.toolName) toolEl.textContent = a.toolName;
            const sumEl = row.querySelector('.pb-approval-summary');
            if (sumEl.textContent !== a.summary) {
                sumEl.textContent = a.summary;
                // Summaries are ellipsis-truncated; the title carries the
                // rest for mouse users (textContent already does for AT).
                sumEl.title = a.summary;
            }
            sumEl.hidden = !a.summary;
            const ctxEl = row.querySelector('.pb-approval-ctx');
            if (ctxEl.textContent !== a.context) ctxEl.textContent = a.context;
            ctxEl.hidden = !a.context;
            const allowBtn = row.querySelector('.pb-approval-allow');
            const denyBtn = row.querySelector('.pb-approval-deny');
            // Two Bash calls in one project would otherwise share a name
            // ("Allow Bash in X") — the distinguishing text sits on
            // non-focusable spans a button list never reaches. The verb
            // stays first, so the visible label remains the name's prefix.
            const detail = [a.summary, a.context].filter(Boolean).join(' — ');
            const short = detail.length > 60 ? detail.slice(0, 57) + '…' : detail;
            const where = short ? `${short} — in ${bar.name}` : `in ${bar.name}`;
            const allowLabel = `Allow ${a.toolName}: ${where}`;
            const denyLabel = `Deny ${a.toolName}: ${where}`;
            if (allowBtn.getAttribute('aria-label') !== allowLabel) allowBtn.setAttribute('aria-label', allowLabel);
            if (denyBtn.getAttribute('aria-label') !== denyLabel) denyBtn.setAttribute('aria-label', denyLabel);
        }
        strip.querySelectorAll('.pb-approval').forEach(row => {
            if (!keep.has(row.dataset.approvalId)) row.remove();
        });
    },

    async _decideApproval(btn) {
        const row = btn.closest('.pb-approval');
        const id = row?.dataset.approvalId;
        // Explicit both ways: a markup slip that loses data-decision must
        // not fall through to the granting verb.
        const decision = btn.dataset.decision;
        if (!id || (decision !== 'allow' && decision !== 'deny')) return;
        if (this._approveBusy.has(id)) return;
        // Blunts bait-and-switch clickjacking (swap an innocent target for
        // Allow just as the click lands). Imperceptible to a real user, who
        // must still travel to the button.
        const shownMs = Number(row.dataset.shownAt);
        if (Number.isFinite(shownMs) && Date.now() - shownMs < 400) return;
        this._approveBusy.add(id);
        row.classList.add('is-deciding');
        // aria-disabled, NOT disabled: disabling the focused button drops
        // focus to <body> and removes it from the tab order the instant a
        // keyboard user presses Enter. _approveBusy is the real guard.
        row.querySelectorAll('.pb-approval-btn').forEach(b => b.setAttribute('aria-disabled', 'true'));
        try {
            const res = await fetch(`${this.APPROVE_BASE}/decide`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Approve-Token': this._approveToken
                },
                body: JSON.stringify({ id, decision }),
                signal: AbortSignal.timeout(4000)
            });
            if (!res.ok) throw new Error(String(res.status));
            const outcome = await res.json().catch(() => null);
            // ok:true and gone:true land here together on purpose: either
            // way the request is no longer decidable, so drop the row now
            // instead of letting it flash until the next poll.
            this._decided.add(id);
            this._approvals = this._approvals.filter(a => a.id !== id);
            this._announceDecision(row, decision, outcome && outcome.gone === true);
            // Focus must move before the row is removed by the re-render,
            // or a keyboard user is dumped back at <body>.
            this._focusAfterDecision(row);
            this._processData();
        } catch (_e) {
            row.classList.remove('is-deciding');
            row.querySelectorAll('.pb-approval-btn').forEach(b => b.removeAttribute('aria-disabled'));
            this._approveOnline = false;
            this._updateApproveStatus('');
        } finally {
            this._approveBusy.delete(id);
        }
    },

    /** The row is about to vanish; say what happened, since a disappearing
     *  row is not an outcome anyone can perceive. */
    _announceDecision(row, decision, gone) {
        const tool = row.querySelector('.pb-approval-tool')?.textContent || 'Request';
        // Object, not string: a bare name would get "needs your approval"
        // appended by _flushAlerts, which is the opposite of what happened.
        // The expired case says where the request went — the click landed on
        // buttons that were already dead, and the dialog is now VS Code's.
        this._alertQueue.push({ sentence: gone
            ? `${tool} request expired here — approve or deny in VS Code.`
            : `${tool} ${decision === 'allow' ? 'allowed' : 'denied'}.` });
        this._flushAlerts();
    },

    /** Keep keyboard focus near where it was: the next request's buttons,
     *  the previous row's, or the project's own disclosure control. */
    _focusAfterDecision(row) {
        if (!row.contains(document.activeElement)) return; // mouse user: leave focus alone
        const bar = row.closest('.project-bar');
        const next = row.nextElementSibling?.querySelector('.pb-approval-btn')
            || row.previousElementSibling?.querySelector('.pb-approval-btn')
            || bar?.querySelector('.pb-toggle:not([hidden])');
        if (next) {
            next.focus();
            return;
        }
        // Last resort — the bar itself. A plain <li> can't take focus, and
        // without tabindex the browser silently drops focus to <body>,
        // stranding a keyboard user at the top of the page. -1 keeps it out
        // of the tab order while allowing this programmatic focus.
        if (!bar) return;
        bar.tabIndex = -1;
        bar.focus();
    },

    /**
     * Approve everything currently waiting, in one click.
     *
     * Still one /decide per request, never a broker-side "allow everything"
     * switch: each held call is its own HTTP response, and the rule that an
     * approval names exactly one tool_use_id is what keeps a stale row from
     * ever releasing something the user hasn't seen. This button is a
     * convenience over that rule, not an exception to it.
     */
    async _allowAll(btn, ignoreAgeGuard) {
        if (this._allowAllBusy) return;
        const pending = this._approvals.filter(a => !this._approveBusy.has(a.id));
        if (pending.length === 0) return;
        // Same bait-and-switch guard as the per-row buttons: this one grants
        // everything at once, so it matters more here, not less. Skipped for
        // the keyboard shortcut — clickjacking works by moving something
        // under the pointer, which a key press has no equivalent of, so
        // there the guard would only be a dead window at the exact moment
        // the user is trying to react quickly.
        const shownMs = Number(btn?.dataset.shownAt);
        if (!ignoreAgeGuard && Number.isFinite(shownMs) && Date.now() - shownMs < 400) return;

        this._allowAllBusy = true;
        if (btn) btn.setAttribute('aria-disabled', 'true');
        pending.forEach(a => this._approveBusy.add(a.id));

        const results = await Promise.all(pending.map(a =>
            fetch(`${this.APPROVE_BASE}/decide`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Approve-Token': this._approveToken
                },
                body: JSON.stringify({ id: a.id, decision: 'allow' }),
                signal: AbortSignal.timeout(4000)
            }).then(res => res.ok).catch(() => false)
                .finally(() => this._approveBusy.delete(a.id))
        ));

        const ok = results.filter(Boolean).length;
        // Only the ones that actually landed are dropped locally; a failed
        // request stays on screen so it can be retried per row.
        const settled = new Set(pending.filter((_a, i) => results[i]).map(a => a.id));
        settled.forEach(id => this._decided.add(id));
        this._approvals = this._approvals.filter(a => !settled.has(a.id));
        this._allowAllBusy = false;
        if (btn) btn.removeAttribute('aria-disabled');
        if (ok < pending.length) {
            this._approveOnline = false;
            this._updateApproveStatus('');
        }
        this._alertQueue.push(ok === 1
            ? '1 request allowed.'
            : `${ok} requests allowed.`);
        this._flushAlerts();
        this._processData();
    },

    /**
     * Ctrl+Enter approves everything waiting, without reaching for the mouse.
     *
     * Deliberately narrow about focus. It fires when nothing on the page owns
     * the keyboard, or when an *Allow* button already does — the two states
     * where "yes, all of it" is unambiguous. It does NOT fire from a focused
     * Deny button (the user's hands are literally on the opposite verb), from
     * a text field, or while a modal is open, which is the same rule the
     * app's other global shortcuts follow.
     */
    /**
     * Tell the broker the moment this page really goes away — closed tab,
     * navigation, refresh. Without it, "homepage closed == feature off"
     * would take as long as the hidden liveness window (3 minutes), during
     * which a request could be held with genuinely nobody watching. With it,
     * a close releases everything to VS Code immediately.
     *
     * pagehide, not beforeunload/unload: it is the event that actually fires
     * reliably on a closing tab. keepalive lets the request outlive the page
     * — sendBeacon can't be used here because it cannot carry the auth
     * header. A visibility change deliberately does NOT send this; hidden is
     * not gone.
     */
    _wireApproveGoodbye() {
        window.addEventListener('pagehide', () => {
            if (!this._settings.approve || !this._approveToken) return;
            // While an auto-allow window is armed, leave WITHOUT the goodbye.
            // pagehide can't tell a refresh from a close, and /bye releases
            // every held request to a VS Code dialog — which turned an F5
            // into "go answer VS Code" even though the user had explicitly
            // granted a window (the first field complaint against v4.22).
            // A refresh lands back inside the broker's 8s heartbeat window,
            // so held requests survive the gap and the restored window
            // (sessionStorage) answers them on the first poll. A real close
            // ends the tab's sessionStorage, and the broker's stale-
            // heartbeat sweep still releases everything — just on the
            // bounded clock (~16s visible, worst-case HOLD_MS hidden)
            // instead of instantly. Unarmed pages say goodbye exactly as
            // before.
            if (this._autoAllow?.size) return;
            try {
                fetch(`${this.APPROVE_BASE}/bye`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Approve-Token': this._approveToken
                    },
                    body: '{}',
                    keepalive: true
                }).catch(() => {});
            } catch (_e) { /* page is going away; nothing to recover */ }
        });
    },

    _wireApproveShortcut() {
        document.addEventListener('keydown', (e) => {
            if (!e.isTrusted) return;
            if (e.key !== 'Enter' || !e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
            if (this._approvals.length === 0) return;
            if (document.querySelector('.modal.show')) return;

            const active = document.activeElement;
            const nothingFocused = !active
                || active === document.body
                || active === document.documentElement;
            const onAllowButton = active?.matches?.('#projectsAllowAll, .pb-approval-allow');
            if (!nothingFocused && !onAllowButton) return;

            e.preventDefault();
            this._allowAll(document.getElementById('projectsAllowAll'), true);
        });
    },

    /** The button only exists while something is waiting — a bulk-approve
     *  control sitting there permanently is an invitation to click it out of
     *  habit, and it would have nothing to act on anyway. */
    _syncAllowAll() {
        const btn = document.getElementById('projectsAllowAll');
        if (!btn) return;
        const n = this._approvals.length;
        if (n === 0) {
            if (!btn.hidden) {
                btn.hidden = true;
                delete btn.dataset.shownAt;
            }
            return;
        }
        if (btn.hidden) {
            btn.hidden = false;
            btn.dataset.shownAt = String(Date.now());
        }
        const text = `Allow all (${n})`;
        if (btn.textContent !== text) btn.textContent = text;
        const label = n === 1
            ? 'Allow the 1 waiting permission request'
            : `Allow all ${n} waiting permission requests`;
        if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
        // Discoverability for the shortcut — the tooltip is the only place it
        // is advertised outside Settings.
        if (btn.title !== 'Ctrl+Enter') btn.title = 'Ctrl+Enter';
    },

    // ----------------------------------------
    // Tab alert (favicon flash + title)
    // ----------------------------------------

    _syncTabAlert() {
        this._setTabAlert(this._approvals.length > 0);
    },

    /**
     * Flash the tab while anything is waiting: the favicon alternates
     * between the two question-mark frames and the title becomes
     * "Approve❓". The normal favicon is deliberately never a blink frame —
     * a throttled background tab can freeze the blink on either frame, and
     * a frozen frame must still read as "needs approval". On a pinned tab
     * the title text never renders, but writing it while the tab is
     * inactive still triggers Chromium's attention dot, and it shows in the
     * hover tooltip — kept for those two, not as the primary signal.
     *
     * Idempotent: callers pass the derived boolean and never track
     * transitions, so every path that empties _approvals — decided, allowed
     * in bulk, handed back, broker gone, feature toggled off — turns this
     * off without individual wiring.
     */
    _setTabAlert(on) {
        on = !!on;
        if (on === this._tabAlertOn) return;
        this._tabAlertOn = on;
        const link = document.querySelector('link[rel="icon"]');
        if (on) {
            // Captured at first use, not at start(): 3-app-init.js writes
            // the versioned title after this widget exists, and restoring
            // must return exactly what the user's tab normally shows.
            if (!this._tabAlertRestore) {
                this._tabAlertRestore = { icon: link ? link.href : '', title: document.title };
            }
            let frame = 0;
            const paint = () => {
                if (link) link.href = this.TAB_ALERT_ICONS[frame++ % 2];
            };
            paint(); // the alert must show even if no timer tick ever fires
            document.title = this.TAB_ALERT_TITLE;
            this._tabAlertTimer = setInterval(paint, this.TAB_ALERT_BLINK_MS);
        } else {
            clearInterval(this._tabAlertTimer);
            this._tabAlertTimer = null;
            if (link && this._tabAlertRestore.icon) link.href = this._tabAlertRestore.icon;
            document.title = this._tabAlertRestore.title;
        }
    },

    // ----------------------------------------
    // Alert sound
    // ----------------------------------------

    /**
     * Play the "something needs you" sound, at most once per cooldown.
     *
     * `force` is for the volume slider's own preview, which has to be
     * audible on every drag-release regardless of the cooldown — it is the
     * only way to hear what the setting does.
     *
     * Returns whether the sound was actually started, which is what
     * _maybeRemind tests: a reminder is spent once per waiting request, and
     * spending it on a call the cooldown swallowed would use up the second
     * chance without ever making a noise.
     */
    _playAlertSound(force) {
        const vol = this._settings.soundVolume;
        if (!vol) return false; // 0 = silenced, and never even loads the file
        const now = Date.now();
        if (!force && now - this._lastSoundMs < this._settings.soundCooldownSec * 1000) return false;
        this._lastSoundMs = now;
        try {
            if (!this._audio) {
                this._audio = new Audio(this.SOUND_SRC);
                this._audio.preload = 'auto';
            }
            this._audio.volume = Math.max(0, Math.min(1, vol / 100));
            this._audio.currentTime = 0;
            // Autoplay policy rejects until the page has been interacted
            // with, and a missing file rejects too. Neither is worth a
            // console error every time a request arrives.
            this._audio.play?.().catch(() => {});
        } catch (_e) { /* no audio support: stay silent */ }
        return true;
    },

    /**
     * Second chance (v4.23): something announced is STILL waiting once the
     * user's own "play at most once every N" interval has gone by, so say it
     * once more — once per waiting thing, never a loop.
     *
     * The first cue is easy to miss and expensive to miss: a permission
     * request has a hard ~150s life at the broker, the tab alert is silent
     * by nature, and the sound is a 1.3s clip that may land while a
     * Bluetooth output is still waking up. One repeat costs nothing when it
     * was heard the first time (the request is usually answered long before
     * the interval elapses, which drops it from the book).
     *
     * Reuses the cooldown as the delay rather than adding a second knob:
     * "at most one of these every N" already reads as the pace of this
     * widget's noise, and the repeat obeys it like any other sound.
     *
     * At most one sound per pass — the cooldown inside _playAlertSound would
     * swallow the rest anyway, and anything still due simply comes back on
     * the next pass, which staggers a fan-out instead of stacking it.
     */
    _maybeRemind(now) {
        if (!this._alertSeen?.size) return;
        const waitMs = this._settings.soundCooldownSec * 1000;
        for (const rec of this._alertSeen.values()) {
            if (rec.done || (now - rec.at) < waitMs) continue;
            // Not marked done unless it made a noise: see _playAlertSound.
            if (!this._playAlertSound(false)) return;
            rec.done = true;
            return;
        }
    },

    /** The status sentence in Settings -> Projects, so a dead broker looks
     *  like what it is instead of like a broken homepage. */
    _updateApproveStatus(mode) {
        const el = document.getElementById('projectsApproveStatus');
        if (!el) return;
        let text = '';
        if (this._settings.approve) {
            if (this._approveOnline === false) {
                text = 'Approval service is offline — VS Code will prompt as usual.';
            } else if (mode === 'disabled') {
                text = 'Approval service is disabled (approve-off.cmd) — VS Code will prompt as usual.';
            } else if (this._approveOnline === true) {
                text = 'Approval service connected.';
            }
        }
        if (el.textContent !== text) el.textContent = text;
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

    /**
     * One conversation = one session record, rolled up over its main thread
     * plus its live agents.
     *
     * The three rules that make this truthful:
     *  - needs-you anywhere in the conversation wins; an approval must never
     *    be masked by a sibling thread that happens to be working.
     *  - a live agent means the conversation is working, even when the main
     *    thread reported your-turn. Background agents outlive the turn that
     *    spawned them, and "Your turn" while five agents grind away is the
     *    single most misleading thing this widget could say.
     *  - the main thread is aged out by its OWN clock (mainEventAt), not the
     *    session's, which any agent event bumps.
     */
    _computeChat(session, ordinal, now, idleMs) {
        // AGENT_IDLE_MS, not the user's idleMin — see the constant.
        const agentIdleMs = Math.max(idleMs, this.AGENT_IDLE_MS);
        const agents = session.agents.map(a => ({
            ...a,
            __effState: this._deriveState(a, now, agentIdleMs)
        }));
        // An agent with no events for that long was almost certainly killed
        // without a SubagentStop; it shouldn't hold the conversation in
        // "working" forever. (_deriveState returns needs-you before it
        // considers the clock, so an agent waiting on approval is never
        // filtered out here.)
        const live = agents.filter(a => a.__effState !== 'idle');

        const mainEff = this._deriveState(
            { state: session.state, lastEventAt: session.mainEventAt }, now, idleMs);

        let state;
        if (mainEff === 'needs-you' || live.some(a => a.__effState === 'needs-you')) state = 'needs-you';
        else if (live.length) state = 'working';
        else state = mainEff;

        // Whichever thread moved most recently is the one worth describing.
        const threads = [{ activity: session.activity, lastEventAt: session.mainEventAt }, ...live];
        const newest = threads.reduce((a, b) =>
            Date.parse(a.lastEventAt) >= Date.parse(b.lastEventAt) ? a : b);

        let sinceIso = session.lastEventAt;
        let pendingTool = '';
        if (state === 'needs-you') {
            const pendings = [
                { pendingSince: session.pendingSince, pendingTool: session.pendingTool },
                ...live.map(a => ({ pendingSince: a.pendingSince, pendingTool: a.pendingTool }))
            ].filter(p => p.pendingSince && Number.isFinite(Date.parse(p.pendingSince)));
            if (pendings.length) {
                const newestPending = pendings.reduce((a, b) =>
                    Date.parse(a.pendingSince) >= Date.parse(b.pendingSince) ? a : b);
                sinceIso = newestPending.pendingSince;
                pendingTool = newestPending.pendingTool;
            }
        }

        const agentRows = live
            .slice()
            .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0))
            .map(a => ({
                agentId: a.agentId,
                label: a.agentType || 'agent',
                state: a.__effState,
                activity: a.activity,
                // In a parallel fan-out, WHICH tool is blocked is the first
                // thing worth knowing before clicking Allow — the bar and
                // chat rows already name it, so the agent row must too.
                pendingTool: a.pendingTool,
                sinceIso: a.pendingSince && a.__effState === 'needs-you' ? a.pendingSince : a.lastEventAt,
                // Whether THIS agent's request has buttons on the bar — its
                // row must say "approve in VS Code" when it doesn't, same
                // distinction as the bar/chat labels, at agent granularity.
                hasApproval: (session.__approvals || []).some(r => r.agentId === a.agentId)
            }));

        return {
            sessionId: session.sessionId,
            // A session that has only ever seen slash commands (or predates
            // the v4.15 hook) has no title; the ordinal keeps it addressable.
            title: session.title || `Chat ${ordinal}`,
            hasTitle: !!session.title,
            state,
            activity: newest.activity || session.activity || null,
            pendingTool,
            sinceIso,
            // Recency sort key, distinct from sinceIso on purpose: sinceIso
            // becomes pendingSince during needs-you (it feeds the waiting
            // clock), while ordering should follow the last real event —
            // which any agent bumps.
            lastActiveMs: Date.parse(session.lastEventAt) || 0,
            agents: agentRows,
            // A lone agent doesn't earn a row of its own — its type is folded
            // into this conversation's meta line instead. See _hasDetail.
            foldedAgent: agentRows.length === 1 ? agentRows[0] : null,
            // Broker-held permission requests (remote approve, v4.17) —
            // attached by _applyApprovalOverlay, consumed by _computeBar.
            approvals: session.__approvals || []
        };
    },

    _computeBar(cwdKey, sessions, now, idleMs) {
        // Ordinals are assigned by startedAt so an untitled "Chat 2" keeps
        // its number for its whole life; the DISPLAY order is most recent
        // activity first, applied after, so renumbering never follows a sort.
        // (sort() is stable: same-timestamp chats keep startedAt order.)
        const ordered = sessions.slice().sort((a, b) =>
            (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
        const chats = ordered.map((s, i) => this._computeChat(s, i + 1, now, idleMs));
        chats.sort((a, b) => b.lastActiveMs - a.lastActiveMs);

        let overallState = 'idle';
        let overallRank = 4;
        for (const chat of chats) {
            const rank = this.PRIORITY[chat.state];
            if (rank < overallRank) {
                overallRank = rank;
                overallState = chat.state;
            }
        }

        const primary = chats.reduce((a, b) =>
            Date.parse(a.sinceIso) >= Date.parse(b.sinceIso) ? a : b);

        let sinceIso = primary.sinceIso;
        let attention = null;
        if (overallState === 'needs-you') {
            const pendings = chats.filter(c => c.state === 'needs-you');
            if (pendings.length) {
                const newest = pendings.reduce((a, b) =>
                    Date.parse(a.sinceIso) >= Date.parse(b.sinceIso) ? a : b);
                sinceIso = newest.sinceIso;
                attention = newest;
            }
        }

        const folder = ordered[ordered.length - 1].folder || cwdKey;
        const rawName = this._names[cwdKey];
        const customName = (typeof rawName === 'string' ? rawName : '').trim();
        const agentCount = chats.reduce((n, c) => n + c.agents.length, 0);
        const describing = attention || primary;

        // A project running one conversation IS that conversation — repeating
        // its state and clock one level down says nothing the bar didn't
        // already say. Its title (when it has a real one) moves up onto the
        // bar instead, so the information survives without the hierarchy.
        const single = chats.length === 1 ? chats[0] : null;
        const folded = single && single.foldedAgent ? single.foldedAgent : null;

        // Every held request in this project, flattened for the button strip
        // on the bar — deliberately NOT spread across the detail rows, so the
        // buttons are visible and clickable even while the project is
        // collapsed (collapsed projects render no detail rows at all). The
        // context string says which conversation/agent is asking when the
        // bar alone doesn't pin that down.
        const approvals = [];
        for (const chat of chats) {
            for (const a of chat.approvals) {
                approvals.push({
                    id: a.id,
                    toolName: a.toolName,
                    summary: a.summary,
                    context: [
                        chats.length > 1 ? chat.title : '',
                        a.agentId ? (a.agentType || 'agent') : ''
                    ].filter(Boolean).join(' · ')
                });
            }
        }

        return {
            cwdKey,
            name: customName || folder,
            folder,
            count: chats.length,
            agentCount,
            state: overallState,
            // With an approval outstanding the useful label is the tool
            // that's blocked, not whatever another thread is busy with.
            // When a lone agent is named on this line, the activity shown
            // beside it has to be that agent's — pairing its name with the
            // main thread's last move ("general-purpose · delegating") reads
            // as a claim about the agent that isn't true.
            activity: (attention && attention.pendingTool)
                || (folded && folded.state !== 'needs-you' && folded.activity)
                || describing.activity || null,
            detail: single ? (single.hasTitle ? single.title : '') : describing.title,
            // Only when both levels below collapse: one conversation, one
            // agent. Its type is the one thing neither the bar nor a row
            // would otherwise show.
            agentLabel: folded ? folded.label : '',
            sinceIso,
            // chats is already sorted most-recent-first, so its head is the
            // project's own recency — used to order the bars themselves.
            lastActiveMs: chats[0].lastActiveMs,
            approvals,
            chats
        };
    },

    /**
     * Is there anything below this bar worth disclosing? A level is only
     * worth rendering when it holds more than one thing: one conversation is
     * the project, one agent is the conversation. Both collapse into the
     * bar's own meta line, and the disclosure control disappears with them.
     */
    _hasDetail(bar) {
        if (bar.count > 1) return true;
        return !!bar.chats[0] && bar.chats[0].agents.length > 1;
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
        // selection most-recently-active first. This replaced stable
        // alphabetical order (v4.17) by explicit request: with 2-3 VS Code
        // windows live, the project being worked on belongs leftmost. A bar
        // only moves on a poll that saw a newer event elsewhere, and
        // reconciliation below repositions nodes without recreating them.
        const bySelect = [...all].sort((a, b) => {
            const pr = this.PRIORITY[a.state] - this.PRIORITY[b.state];
            if (pr !== 0) return pr;
            return Date.parse(b.sinceIso) - Date.parse(a.sinceIso);
        });
        const overflow = Math.max(0, all.length - this.MAX_BARS);
        const selected = bySelect.slice(0, this.MAX_BARS);
        selected.sort((a, b) => (b.lastActiveMs - a.lastActiveMs)
            || (a.cwdKey < b.cwdKey ? -1 : a.cwdKey > b.cwdKey ? 1 : 0));
        const selectedKeys = new Set(selected.map(b => b.cwdKey));

        // An armed project that loses its bar — evicted by the 6-bar cap or
        // aged out of the data — loses its window with it. The pill is the
        // only disarm control, and a grant must never continue without one
        // on screen. (Eviction is not exotic here: auto-swept requests never
        // flip needs-you, so an armed project sorts below blocked ones.)
        if (this._autoAllow.size) {
            const live = new Set();
            for (const k of selectedKeys) live.add(k.toLowerCase());
            for (const key of [...this._autoAllow.keys()]) {
                if (live.has(key)) continue;
                const bar = all.find(b => b.cwdKey.toLowerCase() === key);
                this._disarm(key, 'stopped', bar ? bar.name : 'a hidden project');
            }
        }

        // The overflow indicator is a 7th grid item — detach it while we
        // reconcile the bars so it never confuses the DOM-order walk below.
        const moreExisting = ul.querySelector('.projects-more');
        moreExisting?.remove();

        // Remove bars no longer selected (dropped session, filtered by
        // hideMin, or bumped out by the 6-bar cap). No exit animation.
        // A removed bar's open auto-allow popover must close first, or its
        // document-level pointerdown closer leaks (the cleanup sweep in
        // _openArmPop can't see detached nodes).
        ul.querySelectorAll('.project-bar').forEach(li => {
            if (!selectedKeys.has(li.dataset.cwdKey)) {
                this._closeArmPop(li, false);
                li.remove();
            }
        });

        this._openRow();

        // Add new bars, update survivors in place, reposition into recency
        // order without recreating existing nodes (would replay the enter
        // animation, reset the blink phase, and drop tooltips).
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

    /**
     * Queue an announcement for every project that just entered needs-you.
     *
     * Deliberately driven by the full bar set and a state map of its own,
     * not by the DOM: only the 6 most urgent bars are rendered, so a
     * transition on a project that didn't make the cut would never be
     * detected at all — silence, from the one widget whose job is to tell
     * you Claude is blocked.
     *
     * `_alertSeen` is the book of what has been announced and is still
     * waiting: `a:<id>` for a broker-held request, `b:<cwdKey>` for a
     * needs-you project whose dialog is in VS Code. It carries the moment we
     * said it and whether the second chance has been spent, which is all
     * _maybeRemind needs — and dropping a key is what makes an answered
     * request stop being reminded about.
     */
    _queueAlerts(barsMap) {
        const next = Object.create(null);
        const queuedBefore = this._alertQueue.length;
        const now = Date.now();
        // A second approval landing in an already-needs-you project moves no
        // bar state, so the transition test below would stay silent about
        // the one thing that just started blocking. Tracked by id instead.
        const liveKeys = new Set();
        for (const bar of barsMap.values()) {
            for (const a of bar.approvals) {
                const key = `a:${a.id}`;
                liveKeys.add(key);
                if (!this._alertSeen.has(key)) {
                    this._alertSeen.set(key, { at: now, done: false });
                    this._alertQueue.push(`${a.toolName} in ${bar.name}`);
                }
            }
        }
        for (const bar of barsMap.values()) {
            next[bar.cwdKey] = bar.state;
            // Already announced by id just above — don't say it twice.
            if (bar.approvals.length) continue;
            if (bar.state !== 'needs-you') continue;
            const key = `b:${bar.cwdKey}`;
            liveKeys.add(key);
            if (this._barStates[bar.cwdKey] !== 'needs-you') {
                // Names the conversation only when the project holds more
                // than one — otherwise the project name already identifies it.
                this._alertSeen.set(key, { at: now, done: false });
                this._alertQueue.push(
                    bar.count > 1 && bar.detail ? `${bar.name} — ${bar.detail}` : bar.name);
            }
        }
        // Answered, expired, or auto-allowed: nothing left to remind about.
        for (const key of this._alertSeen.keys()) {
            if (!liveKeys.has(key)) this._alertSeen.delete(key);
        }
        this._barStates = next;
        // One sound for whatever this pass turned up, whether the request
        // landed here as buttons or went to a VS Code dialog — both are "a
        // project needs you", and both are announced above. The cooldown
        // collapses a burst (an agent fan-out blocking together) into one.
        if (this._alertQueue.length > queuedBefore) this._playAlertSound(false);
        this._maybeRemind(now);
    },

    // Needs-you announcements queue up during reconciliation so two projects
    // flipping in the same poll share one message instead of the second
    // overwriting the first before assistive tech ever saw it.
    _flushAlerts() {
        if (this._alertQueue.length === 0) return;
        const entries = this._alertQueue;
        this._alertQueue = [];
        const alertEl = document.getElementById('projectsAlert');
        if (!alertEl) return;
        // Two kinds of entry: bare names (aggregated into one "… need your
        // approval." sentence) and { sentence } objects that already say
        // what happened and must be read verbatim — a decision outcome with
        // the approval suffix bolted on ("Bash allowed. needs your
        // approval.") announces the opposite of what just happened.
        const names = entries.filter(e => typeof e === 'string');
        const parts = [];
        if (names.length) {
            const joined = names.length === 1
                ? names[0]
                : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
            parts.push(`${joined} need${names.length === 1 ? 's' : ''} your approval.`);
        }
        for (const e of entries) {
            if (e && typeof e === 'object' && e.sentence) parts.push(e.sentence);
        }
        alertEl.textContent = parts.join(' ');
        // Clear once read so a later, unrelated DOM change can't replay it.
        clearTimeout(this._alertClearTimer);
        this._alertClearTimer = setTimeout(() => { alertEl.textContent = ''; }, 8000);
    },

    _createBar(cwdKey) {
        const li = document.createElement('li');
        li.className = 'project-bar glass-surface is-new';
        li.dataset.cwdKey = cwdKey;
        li.dataset.state = '';
        const detailId = `pbDetail-${this._barSeq++}`;
        const armSeq = this._armPopSeq++;
        const armRangeId = `pbArmRange-${armSeq}`;
        const armPopId = `pbArmPop-${armSeq}`;
        // Static shell only — every piece of user-controlled text (name,
        // count, state, activity, and now conversation titles and agent
        // types) is set via textContent afterwards, never interpolated into
        // this markup. The interpolated values are detailId, armRangeId and
        // armPopId (counters) and the ARM_* numeric constants.
        // The .pb-armpop-val readout is aria-hidden: an <output>/status role
        // repainted on every slider input would spam a live region with what
        // the range control itself already announces.
        li.innerHTML = `
            <div class="pb-head">
                <button type="button" class="pb-toggle" aria-expanded="false" aria-controls="${detailId}">
                    <svg class="ico pb-chev" aria-hidden="true"><use href="#ico-chevron"></use></svg>
                </button>
                <span class="pb-name"></span>
                <span class="pb-count" hidden></span>
                <span class="pb-time" role="timer" aria-live="off"></span>
                <span class="pb-arm-wrap">
                    <button type="button" class="pb-arm" hidden aria-haspopup="dialog" aria-expanded="false" aria-controls="${armPopId}">
                        <svg class="ico pb-arm-ico" aria-hidden="true"><use href="#ico-hourglass"></use></svg>
                        <svg class="ico pb-arm-stop" aria-hidden="true"><use href="#ico-stop"></use></svg>
                        <span class="pb-arm-count"></span>
                    </button>
                    <div class="pb-armpop" id="${armPopId}" role="dialog" hidden>
                        <div class="pb-armpop-head">
                            <span class="pb-armpop-title">Auto-allow for</span>
                            <span class="pb-armpop-val" aria-hidden="true">${this.ARM_DEFAULT} min</span>
                        </div>
                        <input type="range" class="pb-armpop-range" id="${armRangeId}"
                            min="${this.ARM_MIN}" max="${this.ARM_MAX}" step="${this.ARM_STEP}"
                            value="${this.ARM_DEFAULT}" aria-label="Auto-allow duration in minutes">
                        <div class="pb-armpop-scale" aria-hidden="true"><span>${this.ARM_MIN}</span><span>${this.ARM_MAX}</span></div>
                        <div class="pb-armpop-actions">
                            <button type="button" class="pb-armpop-cancel glass-control">Cancel</button>
                            <button type="button" class="pb-armpop-arm glass-control">Arm ${this.ARM_DEFAULT} min</button>
                        </div>
                    </div>
                </span>
            </div>
            <div class="pb-meta">
                <span class="pb-ind" aria-hidden="true">
                    <span class="pb-dot"></span>
                    <svg class="ico pb-alert" aria-hidden="true"><use href="#ico-alert"></use></svg>
                </span>
                <span class="pb-state"></span>
            </div>
            <div class="pb-approvals" hidden></div>
            <div class="pb-detail" id="${detailId}" hidden>
                <ul class="pb-chats" role="list"></ul>
            </div>`;
        li.addEventListener('animationend', () => li.classList.remove('is-new'), { once: true });
        return li;
    },

    _countChip(bar) {
        const parts = [];
        if (bar.count > 1) parts.push(`${bar.count} chats`);
        // Suppressed when the lone agent's type is already on the meta line —
        // "1 agent · general-purpose · coding" says "one" twice.
        if (bar.agentCount > 0 && !bar.agentLabel) {
            parts.push(`${bar.agentCount} agent${bar.agentCount === 1 ? '' : 's'}`);
        }
        return parts.join(' · ');
    },

    // `now` isn't needed here — the tooltip no longer bakes in an elapsed-time
    // sentence (see below) and the ticking .pb-time text is recomputed by
    // _tickBar() below from a fresh Date.now() of its own.
    _updateBar(li, bar) {
        // Kept on the node so the toggle handler can re-render the detail
        // list immediately on click instead of waiting out the 10s poll.
        li.__bar = bar;

        const prevState = li.dataset.state;
        if (prevState !== bar.state) {
            li.classList.remove('is-working', 'is-needs-you', 'is-your-turn', 'is-idle');
            li.classList.add(`is-${bar.state}`);
            li.dataset.state = bar.state;
        }

        const nameEl = li.querySelector('.pb-name');
        if (nameEl && nameEl.textContent !== bar.name) nameEl.textContent = bar.name;

        const countEl = li.querySelector('.pb-count');
        if (countEl) {
            const txt = this._countChip(bar);
            if (txt) {
                if (countEl.textContent !== txt) countEl.textContent = txt;
                if (countEl.hidden) countEl.hidden = false;
            } else if (!countEl.hidden) {
                countEl.hidden = true;
            }
        }

        const stateEl = li.querySelector('.pb-state');
        const stateLabel = bar.state === 'needs-you' && !bar.approvals.length
            ? this.VSCODE_STATE_LABEL
            : (this.STATE_LABEL[bar.state] || bar.state);
        if (stateEl && stateEl.textContent !== stateLabel) stateEl.textContent = stateLabel;

        // .pb-activity doesn't exist in the static shell — it's added/removed
        // as activity appears/disappears rather than left as an empty node.
        // It also absorbs whatever the levels below folded up into it: the
        // conversation name (which chat the state belongs to) and, when a
        // lone agent is doing the work, its type.
        const metaText = [bar.detail, bar.agentLabel, bar.activity].filter(Boolean).join(' · ');
        let activityEl = li.querySelector('.pb-activity');
        if (metaText) {
            if (!activityEl) {
                activityEl = document.createElement('span');
                activityEl.className = 'pb-activity';
                li.querySelector('.pb-meta').appendChild(activityEl);
            }
            if (activityEl.textContent !== metaText) activityEl.textContent = metaText;
        } else if (activityEl) {
            activityEl.remove();
        }

        // The shared 1s ticker reads this to update the number without
        // recomputing the whole bar list.
        const timeEl = li.querySelector('.pb-time');
        if (timeEl) timeEl.dataset.since = bar.sinceIso;

        this._renderApprovalStrip(li, bar);
        this._syncArm(li, bar);
        this._syncExpansion(li, bar);

        // Recency lives in the ticking .pb-time number + its aria-label, not
        // here — baking a "Last activity N ago" sentence into the title too
        // meant it went stale the instant the mouse stopped moving.
        const stateWord = bar.state === 'needs-you' && !bar.approvals.length
            ? this.VSCODE_TITLE_WORD
            : (this.STATE_TITLE_WORD[bar.state] || bar.state);
        const chip = this._countChip(bar);
        const countTxt = chip ? ` (${chip})` : '';
        const detail = [stateWord, bar.agentLabel, bar.activity].filter(Boolean).join(', ');
        const newTitle = `${bar.name}${countTxt} — ${detail}.`;
        if (li.title !== newTitle) li.title = newTitle;

        this._tickNode(li);
    },

    // ----------------------------------------
    // Expand / collapse: conversations and their agents
    // ----------------------------------------

    _loadExpanded() {
        const parsed = Utils.safeJSONParse(localStorage.getItem(this.EXPANDED_KEY), null);
        return (parsed && typeof parsed === 'object')
            ? Object.assign(Object.create(null), parsed)
            : Object.create(null);
    },

    _persistExpanded() {
        Utils.safeLocalStorageSet(this.EXPANDED_KEY, JSON.stringify(this._expanded));
    },

    _wireRowInteraction() {
        // Sits in the label column, outside the .projects-row list, so it
        // needs its own listener rather than the delegated one below.
        document.getElementById('projectsAllowAll')?.addEventListener('click', (e) => {
            if (e.isTrusted) this._allowAll(e.currentTarget);
        });

        const ul = document.getElementById('projectsRow')?.querySelector('.projects-row');
        if (!ul) return;
        // Delegated: bars are created and destroyed constantly, the row
        // element itself never is (_closeRow only empties it).
        ul.addEventListener('click', (e) => {
            const decisionBtn = e.target.closest('.pb-approval-btn');
            if (decisionBtn) {
                // Only a real user gesture may grant a permission.
                if (e.isTrusted) this._decideApproval(decisionBtn);
                return;
            }
            // Auto-allow: arming (and the popover that leads to it) grants
            // permissions, so every path demands a trusted gesture — the
            // same rule as the Allow buttons.
            const armBtn = e.target.closest('.pb-arm');
            if (armBtn) {
                if (e.isTrusted) this._onArmClick(armBtn);
                return;
            }
            const popArm = e.target.closest('.pb-armpop-arm');
            if (popArm) {
                if (e.isTrusted) this._armFromPop(popArm.closest('.project-bar'));
                return;
            }
            const popCancel = e.target.closest('.pb-armpop-cancel');
            if (popCancel) {
                this._closeArmPop(popCancel.closest('.project-bar'), true);
                return;
            }
            // Clicks elsewhere inside the popover (its own backing) must not
            // fall through to the bar.
            if (e.target.closest('.pb-armpop')) return;
            const btn = e.target.closest('.pb-toggle');
            if (!btn) return;
            const li = btn.closest('.project-bar');
            const key = li?.dataset.cwdKey;
            if (!key) return;
            const open = btn.getAttribute('aria-expanded') !== 'true';
            if (open) this._expanded[key] = true;
            else delete this._expanded[key];
            this._persistExpanded();
            // A deliberate toggle takes ownership. Clearing autoExpanded
            // alone isn't enough: with an approval still outstanding, the
            // next poll would just auto-expand again and the user could
            // never keep a blocked project collapsed. autoDismissed says
            // "the user has already seen this one", and is cleared only when
            // the project leaves needs-you (i.e. per episode, not forever).
            delete li.dataset.autoExpanded;
            if (open) delete li.dataset.autoDismissed;
            else li.dataset.autoDismissed = '1';
            this._applyExpansion(li, open, li.__bar);
        });

        // Auto-allow popover: live readout while the slider moves…
        ul.addEventListener('input', (e) => {
            const range = e.target.closest('.pb-armpop-range');
            if (range) this._paintArmPop(range.closest('.project-bar'));
        });
        // …Escape closes without arming; Enter on the slider commits (range
        // inputs don't submit natively). Enter on the popover's buttons is
        // left alone — it must activate the button it's focused on, and a
        // synthesized Enter "click" is filtered by the isTrusted checks in
        // the click handler above.
        ul.addEventListener('keydown', (e) => {
            const pop = e.target.closest('.pb-armpop');
            if (!pop) return;
            if (e.key === 'Escape') {
                e.stopPropagation();
                this._closeArmPop(pop.closest('.project-bar'), true);
            } else if (e.key === 'Enter' && !e.repeat && e.target.closest('.pb-armpop-range')) {
                // !e.repeat: buttons activate on keydown, so holding Enter on
                // the hourglass would otherwise open the popover and have the
                // OS key-repeat commit it before the user ever saw a slider.
                // The popover's own 400ms age guard (_armFromPop) covers the
                // quick deliberate double-press the repeat check can't.
                e.preventDefault();
                if (e.isTrusted) this._armFromPop(pop.closest('.project-bar'));
            }
        });
        // Tabbing out of the popover closes it (without yanking focus back).
        ul.addEventListener('focusout', (e) => {
            const wrap = e.target.closest('.pb-arm-wrap');
            if (!wrap) return;
            if (e.relatedTarget && wrap.contains(e.relatedTarget)) return;
            const pop = wrap.querySelector('.pb-armpop');
            if (pop && !pop.hidden) this._closeArmPop(wrap.closest('.project-bar'), false);
        });
    },

    /**
     * Reconcile the disclosure state. Expansion is sticky per project, with
     * one override: a conversation that needs approval expands itself so the
     * blocked chat is named without a click, and re-collapses once resolved —
     * but only if the user never touched the control themselves.
     */
    _syncExpansion(li, bar) {
        const btn = li.querySelector('.pb-toggle');
        if (!btn) return;

        // Nothing below is worth showing: no control, nothing to open. The
        // button leaves the layout rather than sitting there disabled — a
        // dead affordance on most bars is worse than the small reflow when a
        // project starts delegating.
        if (!this._hasDetail(bar)) {
            btn.hidden = true;
            this._applyExpansion(li, false, bar);
            return;
        }
        if (btn.hidden) btn.hidden = false;

        const sticky = !!this._expanded[bar.cwdKey];
        let open;

        if (bar.state !== 'needs-you') {
            // Episode over: both markers reset, the user's sticky choice rules.
            delete li.dataset.autoExpanded;
            delete li.dataset.autoDismissed;
            open = sticky;
        } else if (li.dataset.autoExpanded) {
            open = true;
        // An approval-driven needs-you already shows its buttons on the bar
        // strip, which sits outside the collapsible detail. Auto-expanding
        // for it would open and re-collapse on every mediated tool call —
        // several times a minute, jumping the whole row. Hook-reported
        // permission waits (rare, long-lived) still expand as before.
        } else if (!li.dataset.autoDismissed && !sticky && !bar.approvals.length) {
            li.dataset.autoExpanded = '1';
            open = true;
        } else {
            open = sticky;
        }

        this._applyExpansion(li, open, bar);
    },

    _applyExpansion(li, open, bar) {
        const btn = li.querySelector('.pb-toggle');
        const detail = li.querySelector('.pb-detail');
        if (!btn || !detail) return;

        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        const name = bar ? bar.name : '';
        // Names what's actually inside: with one conversation the detail
        // holds its agents, not a conversation list.
        const kind = bar && bar.count > 1 ? 'conversations' : 'agents';
        const label = `${open ? 'Hide' : 'Show'} ${kind} in ${name}`;
        if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
        li.classList.toggle('is-expanded', open);

        // With the conversation list open, the meta row is pure duplication —
        // it describes the newest chat, and that chat's own row is now on
        // screen saying the same thing. It returns on collapse, where it's the
        // bar's only state summary. Agents-only detail (count === 1) keeps it:
        // the folded conversation title on the bar isn't repeated by agent
        // rows.
        const meta = li.querySelector('.pb-meta');
        if (meta) meta.hidden = !!(open && bar && bar.count > 1);

        if (!open) {
            detail.hidden = true;
            // Emptied, not just hidden: the 1s ticker walks live [data-since]
            // nodes, and a collapsed project shouldn't cost anything.
            detail.querySelector('.pb-chats')?.replaceChildren();
            return;
        }
        detail.hidden = false;
        if (bar) {
            this._renderDetail(detail.querySelector('.pb-chats'), bar);
            // One walk for the whole subtree — the row builders deliberately
            // don't tick their own nodes. Needed here (not only in
            // _updateBar) because the click handler renders on expand.
            this._tickNode(detail);
        }
    },

    /**
     * Render whichever level actually holds more than one thing. With
     * several conversations that's the conversation list (each of which may
     * expose its own agents); with one, the conversation level is skipped
     * entirely and its agents hang directly off the project.
     */
    _renderDetail(list, bar) {
        if (!list) return;
        const chatLevel = bar.count > 1;
        list.classList.toggle('is-agents-only', !chatLevel);
        if (chatLevel) {
            list.querySelectorAll(':scope > .pb-agent, :scope > .pb-agents-more')
                .forEach(node => node.remove());
            this._renderChats(list, bar);
            return;
        }
        list.querySelectorAll(':scope > .pb-chat, :scope > .pb-chats-more')
            .forEach(node => node.remove());
        this._renderAgents(list, bar.chats[0]);
    },

    _renderChats(list, bar) {
        if (!list) return;
        // Bounded like the other two levels. Sessions only leave the merged
        // file on SessionEnd or after hideMin (up to 2h), so a long day in
        // one project can otherwise stack up an arbitrarily tall list.
        // Needs-you first so a cap can never hide a blocked conversation.
        const ordered = bar.chats.length > this.MAX_CHAT_ROWS
            ? bar.chats.slice().sort((a, b) => this.PRIORITY[a.state] - this.PRIORITY[b.state])
                .slice(0, this.MAX_CHAT_ROWS)
                .sort((a, b) => bar.chats.indexOf(a) - bar.chats.indexOf(b))
            : bar.chats;
        const overflow = bar.chats.length - ordered.length;
        const keys = new Set();
        let cursor = list.firstElementChild;

        for (const chat of ordered) {
            keys.add(chat.sessionId);
            let row = list.querySelector(`.pb-chat[data-session-id="${CSS.escape(chat.sessionId)}"]`);
            if (!row) row = this._createChatRow(chat.sessionId);
            if (cursor !== row) list.insertBefore(row, cursor);
            cursor = row.nextElementSibling;
            this._updateChatRow(row, chat);
        }

        list.querySelectorAll('.pb-chat').forEach(row => {
            if (!keys.has(row.dataset.sessionId)) row.remove();
        });

        let moreEl = list.querySelector('.pb-chats-more');
        if (overflow > 0) {
            if (!moreEl) {
                moreEl = document.createElement('li');
                moreEl.className = 'pb-chats-more';
            }
            // Re-appended even when it already exists: the cursor walk above
            // only orders .pb-chat rows, so this has to be put back last.
            list.appendChild(moreEl);
            const txt = `+${overflow} more conversation${overflow === 1 ? '' : 's'}`;
            if (moreEl.textContent !== txt) moreEl.textContent = txt;
        } else if (moreEl) {
            moreEl.remove();
        }
    },

    _createChatRow(sessionId) {
        const row = document.createElement('li');
        row.className = 'pb-chat';
        row.dataset.sessionId = sessionId;
        row.dataset.state = '';
        row.innerHTML = `
            <div class="pb-chat-head">
                <span class="pb-chat-dot" aria-hidden="true"></span>
                <span class="pb-chat-title"></span>
                <span class="pb-chat-time" role="timer" aria-live="off" data-since=""></span>
            </div>
            <div class="pb-chat-meta">
                <span class="pb-chat-state"></span>
                <span class="pb-chat-activity"></span>
            </div>
            <ul class="pb-agents" role="list"></ul>`;
        return row;
    },

    _updateChatRow(row, chat) {
        if (row.dataset.state !== chat.state) {
            row.classList.remove('is-working', 'is-needs-you', 'is-your-turn', 'is-idle');
            row.classList.add(`is-${chat.state}`);
            row.dataset.state = chat.state;
        }
        row.classList.toggle('is-untitled', !chat.hasTitle);

        const titleEl = row.querySelector('.pb-chat-title');
        if (titleEl && titleEl.textContent !== chat.title) {
            titleEl.textContent = chat.title;
            // Titles are ellipsis-truncated; without this a mouse user has no
            // way to read the rest (textContent already carries it for AT).
            titleEl.title = chat.title;
        }

        const stateEl = row.querySelector('.pb-chat-state');
        const stateLabel = chat.state === 'needs-you' && !chat.approvals.length
            ? this.VSCODE_STATE_LABEL
            : (this.STATE_LABEL[chat.state] || chat.state);
        if (stateEl && stateEl.textContent !== stateLabel) stateEl.textContent = stateLabel;

        const actEl = row.querySelector('.pb-chat-activity');
        // A single agent has no row of its own, so its type rides here —
        // otherwise "who is doing this" would be lost with the row.
        const folded = chat.foldedAgent;
        const actText = [
            folded ? folded.label : '',
            chat.state === 'needs-you' && chat.pendingTool
                ? chat.pendingTool
                // Same reason as the bar: the activity next to an agent's
                // name must be that agent's, not the main thread's.
                : ((folded && folded.state !== 'needs-you' && folded.activity) || chat.activity || '')
        ].filter(Boolean).join(' · ');
        if (actEl) {
            if (actEl.textContent !== actText) actEl.textContent = actText;
            actEl.hidden = !actText;
        }

        const timeEl = row.querySelector('.pb-chat-time');
        if (timeEl) timeEl.dataset.since = chat.sinceIso;

        // Agent rows only when there's more than one to distinguish.
        this._renderAgents(row.querySelector('.pb-agents'), chat.foldedAgent ? null : chat);
    },

    // A null chat means this level folded away (one agent, or none) — clear
    // any rows left from when it didn't.
    _renderAgents(list, chat) {
        if (!list) return;
        const agents = chat ? chat.agents : [];
        const shown = agents.slice(0, this.MAX_AGENT_ROWS);
        const overflow = agents.length - shown.length;
        const keys = new Set();
        let cursor = list.firstElementChild;

        for (const agent of shown) {
            keys.add(agent.agentId);
            let row = list.querySelector(`.pb-agent[data-agent-id="${CSS.escape(agent.agentId)}"]`);
            if (!row) {
                row = document.createElement('li');
                row.className = 'pb-agent';
                row.dataset.agentId = agent.agentId;
                row.dataset.state = '';
                row.innerHTML = `
                    <span class="pb-agent-dot" aria-hidden="true"></span>
                    <span class="pb-agent-type"></span>
                    <span class="pb-agent-activity"></span>
                    <span class="pb-agent-time" role="timer" aria-live="off" data-since=""></span>`;
            }
            if (cursor !== row) list.insertBefore(row, cursor);
            cursor = row.nextElementSibling;

            if (row.dataset.state !== agent.state) {
                row.classList.remove('is-working', 'is-needs-you', 'is-your-turn', 'is-idle');
                row.classList.add(`is-${agent.state}`);
                row.dataset.state = agent.state;
            }
            const typeEl = row.querySelector('.pb-agent-type');
            if (typeEl && typeEl.textContent !== agent.label) typeEl.textContent = agent.label;
            const actEl = row.querySelector('.pb-agent-activity');
            // Falls back to the state word rather than rendering nothing: an
            // agent that hasn't reported an activity yet would otherwise be a
            // bare type name, with its state conveyed by dot colour alone.
            // Lowercased: this column speaks in activity words ("coding",
            // "reading"), and a capitalized chip label mixed in reads as a
            // seam. The chip register stays capitalized one level up.
            const actText = agent.state === 'needs-you'
                ? [agent.hasApproval ? 'needs approval' : 'approve in VS Code', agent.pendingTool]
                    .filter(Boolean).join(' · ')
                : (agent.activity || (this.STATE_LABEL[agent.state] || '').toLowerCase());
            if (actEl) {
                if (actEl.textContent !== actText) actEl.textContent = actText;
                actEl.hidden = !actText;
            }
            const timeEl = row.querySelector('.pb-agent-time');
            if (timeEl) timeEl.dataset.since = agent.sinceIso;
        }

        list.querySelectorAll('.pb-agent').forEach(row => {
            if (!keys.has(row.dataset.agentId)) row.remove();
        });

        // Never silently truncate: if agents are being withheld, say so.
        let moreEl = list.querySelector('.pb-agents-more');
        if (overflow > 0) {
            if (!moreEl) {
                moreEl = document.createElement('li');
                moreEl.className = 'pb-agents-more';
            }
            // Re-appended even when it already exists: the cursor walk above
            // only orders .pb-agent rows, so this has to be put back last.
            list.appendChild(moreEl);
            const txt = `+${overflow} more agent${overflow === 1 ? '' : 's'}`;
            if (moreEl.textContent !== txt) moreEl.textContent = txt;
        } else if (moreEl) {
            moreEl.remove();
        }
    },

    // ----------------------------------------
    // Shared 1s ticker
    // ----------------------------------------

    // Every elapsed readout — project, conversation, agent — is a node
    // carrying its own data-since, so one walk updates all three levels.
    // Collapsed projects contribute exactly one node each (their detail list
    // is emptied on collapse), keeping the common case as cheap as it was.
    _tick() {
        const wrap = document.getElementById('projectsRow');
        const ul = wrap?.querySelector('.projects-row');
        if (!ul) return;
        ul.querySelectorAll('[data-since]').forEach(el => this._tickTime(el));
        // Armed auto-allow pills count down on the same shared ticker. This
        // is display only — expiry is enforced at decision time in
        // _sweepArmedApprovals, so a paused ticker (hidden tab) never
        // extends a window. Gated so the common case (nothing armed) adds
        // no per-second query at all.
        if (this._autoAllow?.size) {
            ul.querySelectorAll('.pb-arm[data-until]').forEach(el => this._tickArm(el));
        }
    },

    /** Update every elapsed readout inside one node (self included). */
    _tickNode(root) {
        if (root.dataset && root.dataset.since !== undefined) this._tickTime(root);
        root.querySelectorAll?.('[data-since]').forEach(el => this._tickTime(el));
    },

    _tickTime(el) {
        const since = el.dataset.since;
        if (!since) return;
        const ms = Date.now() - Date.parse(since);
        const clock = this._clockElapsed(ms);
        if (el.textContent !== clock) el.textContent = clock;
        // Minute-granular aria-label (same rationale as the countdown label
        // in scripts/5-calendar.js ~line 701) so a screen reader isn't
        // re-announced every second — aria-live is "off" on this element, but
        // the bucket guard also means any future live-region wiring, or a
        // user re-focusing the element, doesn't see label churn every tick.
        const bucket = Number.isFinite(ms) ? String(Math.floor(ms / 60000)) : 'unknown';
        if (el.dataset.timeBucket !== bucket) {
            el.dataset.timeBucket = bucket;
            el.setAttribute('aria-label', `Last activity ${this._humanElapsed(ms)} ago`);
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
        // No row means no armed pill, and the pill is the only disarm
        // control — an auto-allow window must never keep granting with no
        // visible stop button, so every armed window ends with the row.
        if (this._autoAllow?.size) {
            this._autoAllow.clear();
            this._persistAutoAllow();
            this._alertQueue.push({ sentence: 'Auto-allow stopped — its project left the row.' });
            this._flushAlerts();
        }
        // A popover open at close time must be torn down NOW, not when the
        // 240ms collapse finishes: it holds a document-level listener, and
        // its overflow escape hatch would let the collapsing row paint
        // outside its box.
        document.querySelectorAll('.project-bar.is-arming')
            .forEach(li => this._closeArmPop(li, false, true));
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
    // Visibility: slow the data poll and pause the ticker while hidden.
    // ----------------------------------------

    _wireVisibilityPause() {
        document.addEventListener('visibilitychange', () => {
            // The data poll SLOWS, it no longer stops — see POLL_HIDDEN_MS.
            // Stopping it froze the snapshot every staleness gate is measured
            // against, which is how a tab left behind VS Code long enough
            // turned an arriving permission request into 150s of silence.
            this._syncDataPoll();
            if (document.hidden) {
                // The 1s ticker does stop: nothing it writes is on screen,
                // and every readout it maintains is recomputed by the render
                // that follows the tab coming forward.
                clearInterval(this._tickTimer);
                this._tickTimer = null;
            } else {
                if (!this._tickTimer) {
                    this._tickTimer = setInterval(() => this._tick(), this.TICK_MS);
                }
                this._load();
            }
            // The approval poll runs in both states now (see
            // _syncApprovePoll) — this call keeps it consistent with the
            // settings, and the immediate poll below closes the gap left by
            // a throttled background tick when the window comes forward.
            this._syncApprovePoll();
            if (!document.hidden && this._approveTimer) this._pollApprovals();
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
            { enabled: true, idleMin: 3, hideMin: 30, approve: false, soundVolume: 60, soundCooldownSec: 10 },
            safeParsed || {}
        );
        s.enabled = s.enabled !== false;
        // Free-range numbers, unlike the fixed option lists below: clamp
        // rather than fall back, so a stored 200 means "loudest", not "reset
        // to default". Non-numeric resolves to the default.
        s.soundVolume = this._clampInt(s.soundVolume, 0, 100, 60);
        s.soundCooldownSec = this._clampInt(
            s.soundCooldownSec, this.SOUND_COOLDOWN_MIN, this.SOUND_COOLDOWN_MAX, 10);
        // Opt-in, and strictly boolean: remote approval is a consequential
        // capability, so corrupted storage must resolve to OFF.
        s.approve = s.approve === true;
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
                this._syncApprovePoll();
            });
        }
        const volEl = document.getElementById('projectsSoundVolume');
        const volOut = document.getElementById('projectsSoundVolumeOut');
        if (volEl) {
            const paint = () => {
                if (volOut) volOut.textContent = `${this._settings.soundVolume}%`;
                window.paintRangeFill?.(volEl);
            };
            volEl.value = String(this._settings.soundVolume);
            paint();
            // input: live readout while dragging. change: commit + preview,
            // so the level is heard once per adjustment rather than on every
            // pixel of the drag.
            volEl.addEventListener('input', () => {
                this._settings.soundVolume = this._clampInt(volEl.value, 0, 100, 60);
                paint();
            });
            volEl.addEventListener('change', () => {
                this._settings.soundVolume = this._clampInt(volEl.value, 0, 100, 60);
                paint();
                this._persistSettings();
                this._playAlertSound(true);
            });
        }

        const coolEl = document.getElementById('projectsSoundCooldown');
        if (coolEl) {
            coolEl.value = String(this._settings.soundCooldownSec);
            coolEl.addEventListener('change', () => {
                const n = this._clampInt(
                    coolEl.value, this.SOUND_COOLDOWN_MIN, this.SOUND_COOLDOWN_MAX,
                    this._settings.soundCooldownSec);
                this._settings.soundCooldownSec = n;
                // Written back so a typed 0, 99 or "abc" visibly becomes the
                // value actually in force, instead of the field disagreeing
                // with the setting.
                coolEl.value = String(n);
                this._persistSettings();
            });
        }

        const approveEl = document.getElementById('projectsApproveEnabled');
        if (approveEl) {
            approveEl.checked = this._settings.approve;
            approveEl.addEventListener('change', () => {
                this._settings.approve = approveEl.checked;
                this._persistSettings();
                this._approveOnline = null;
                this._approveMode = '';
                this._updateApproveStatus('');
                this._syncApprovePoll();
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

    /**
     * Is this directory a PROJECT, or an agent's private working copy?
     *
     * A `isolation: 'worktree'` subagent runs in `<repo>\.claude\worktrees\
     * agent-<id>`, and a session whose first event arrived from a subagent
     * could be recorded under that path (the hook refuses a subagent's cwd
     * now, but entries banked before that fix — or from a session that only
     * ever reported one — are still in localStorage). Those are throwaway
     * directories: they exist for minutes, can never be usefully renamed,
     * and clutter the list they'd otherwise sit in forever.
     */
    _isProjectLevel(cwdKey, folder) {
        const key = String(cwdKey || '').replace(/\//g, '\\');
        if (key.includes('\\.claude\\worktrees\\')) return false;
        if (/^agent-[0-9a-f-]{4,}$/i.test(String(folder || '').trim())) return false;
        return true;
    },

    _updateSeen(sessions, now) {
        const nowIso = new Date(now).toISOString();
        let changed = false;
        let namesChanged = false;

        for (const s of sessions) {
            const key = s.cwdKey;
            if (!key) continue;
            if (!this._isProjectLevel(key, s.folder)) continue;
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
            // Agent worktrees banked by an older build are swept out here
            // once, not merely hidden at render time — otherwise they'd keep
            // occupying the 100-entry cap and pushing real projects out.
            if (!this._isProjectLevel(key, info?.folder)) {
                delete this._seen[key];
                if (key in this._names) {
                    delete this._names[key];
                    namesChanged = true;
                }
                changed = true;
                continue;
            }
            if (!Number.isFinite(t) || t < cutoff) {
                delete this._seen[key];
                changed = true;
            }
        }
        if (namesChanged) this._persistNames();

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

        // claudeProjectsExpanded rides on _seen's lifetime — unlike a rename
        // it carries nothing worth keeping for a project that has aged out,
        // and it's keyed by full path, so left alone it would grow forever.
        let expiredExpanded = false;
        for (const key of Object.keys(this._expanded)) {
            if (!this._seen[key]) {
                delete this._expanded[key];
                expiredExpanded = true;
            }
        }
        if (expiredExpanded) this._persistExpanded();
    },

    _wireNamesList() {
        const list = document.getElementById('projectNamesList');
        if (!list) return;
        // Delegated — rows are created and removed as projects come and go.
        list.addEventListener('click', (e) => {
            const btn = e.target.closest('.projects-name-remove');
            if (!btn) return;
            const row = btn.closest('.projects-name-row');
            const key = row?.dataset.cwdKey;
            if (!key) return;
            this._forgetProject(key, row);
        });
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

    /**
     * Drop one project from this list: its seen record, its custom name and
     * its sticky expansion. A project that is still running is re-added by
     * the very next poll (under its folder name) — it is live, and hiding a
     * running project from its own settings list would be a lie. Deleting a
     * finished one is what this is for, and it sticks.
     */
    _forgetProject(key, row) {
        const wasNamed = key in this._names;
        delete this._seen[key];
        delete this._names[key];
        delete this._expanded[key];
        this._persistSeen();
        if (wasNamed) this._persistNames();
        this._persistExpanded();
        // Move focus off the button before it disappears, or a keyboard user
        // is dropped back to <body>.
        if (row?.contains(document.activeElement)) {
            const next = row.nextElementSibling?.querySelector('.projects-name-remove')
                || row.previousElementSibling?.querySelector('.projects-name-remove')
                || document.getElementById('projectNamesList');
            if (next === document.getElementById('projectNamesList')) next.tabIndex = -1;
            next?.focus?.();
        }
        row?.remove();
        // Repaint the bars too: a removed custom name reverts the visible
        // bar to its folder name without waiting out the 10s poll.
        this._processData();
        this._renderNamesList();
    },

    _renderNamesList() {
        try {
            const list = document.getElementById('projectNamesList');
            if (!list) return;

            // Projects only — an agent's worktree is not something you name.
            const entries = new Map(); // cwdKey -> { folder, path }
            for (const [key, info] of Object.entries(this._seen)) {
                const folder = this._str(info?.folder) || key;
                if (!this._isProjectLevel(key, folder)) continue;
                const path = this._str(info?.cwd) || folder;
                entries.set(key, { folder, path });
            }
            for (const s of this._lastSessions) {
                if (!s.cwdKey) continue;
                const folder = this._str(s.folder) || s.cwdKey;
                if (!this._isProjectLevel(s.cwdKey, folder)) continue;
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
                    // Also on the row, so the path is readable from anywhere
                    // along it — the label itself is ellipsis-truncated and
                    // can be a narrow target for the one folder name that's
                    // ambiguous enough to need the tooltip.
                    if (row.title !== wantTitle) row.title = wantTitle;
                }
                const removeBtn = row.querySelector('.projects-name-remove');
                if (removeBtn) {
                    const removeLabel = `Remove ${info.folder} from this list`;
                    if (removeBtn.getAttribute('aria-label') !== removeLabel) {
                        removeBtn.setAttribute('aria-label', removeLabel);
                        removeBtn.title = removeLabel;
                    }
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
        // Static shell; the folder name, the tooltip and the remove button's
        // accessible name are all set via textContent/attributes in
        // _renderNamesList. The one interpolated value is inputId, generated
        // from a counter here.
        row.innerHTML = `
            <label class="projects-name-label" for="${inputId}"></label>
            <input type="text" class="projects-name-input" id="${inputId}" autocomplete="off" maxlength="60">
            <button type="button" class="projects-name-remove glass-control">
                <svg class="ico" aria-hidden="true"><use href="#ico-trash"></use></svg>
            </button>`;
        list.appendChild(row);
        return row;
    }
};

window.ProjectsWidget = ProjectsWidget;

// Scripts sit at the end of <body>, so the DOM is ready.
ProjectsWidget.start();
