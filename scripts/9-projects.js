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
    _approveSeen: null,     // approval ids already announced
    _approveMode: '',       // broker's own 'on' | 'disabled'
    _approveInFlight: false,
    _decided: null,         // ids answered here, suppressed until the broker forgets them
    _unattached: null,      // id -> consecutive polls with no bar to render on
    _audio: null,
    _lastSoundMs: 0,
    _allowAllBusy: false,
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

        clearInterval(this._pollTimer);
        clearInterval(this._tickTimer);
        this._load();
        this._pollTimer = setInterval(() => this._load(), this.POLL_MS);
        this._tickTimer = setInterval(() => this._tick(), this.TICK_MS);
        this._approveBusy = new Set();
        this._approveSeen = new Set();
        this._decided = new Set();
        this._unattached = new Map();
        this._syncApprovePoll();
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
        s.onerror = () => { s.remove(); this._closeRow(); this._syncTabAlert(); };
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
            if (this._approvals.length) {
                this._approvals = [];
                this._processData();
            }
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
        this._alertQueue.push(gone
            ? `${tool} request expired.`
            : `${tool} ${decision === 'allow' ? 'allowed' : 'denied'}.`);
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
     */
    _playAlertSound(force) {
        const vol = this._settings.soundVolume;
        if (!vol) return; // 0 = silenced, and never even loads the file
        const now = Date.now();
        if (!force && now - this._lastSoundMs < this._settings.soundCooldownSec * 1000) return;
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
                sinceIso: a.pendingSince && a.__effState === 'needs-you' ? a.pendingSince : a.lastEventAt
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
     */
    _queueAlerts(barsMap) {
        const next = Object.create(null);
        const queuedBefore = this._alertQueue.length;
        // A second approval landing in an already-needs-you project moves no
        // bar state, so the transition test below would stay silent about
        // the one thing that just started blocking. Tracked by id instead.
        const liveIds = new Set();
        for (const bar of barsMap.values()) {
            for (const a of bar.approvals) {
                liveIds.add(a.id);
                if (!this._approveSeen.has(a.id)) {
                    this._approveSeen.add(a.id);
                    this._alertQueue.push(`${a.toolName} in ${bar.name}`);
                }
            }
        }
        for (const id of this._approveSeen) {
            if (!liveIds.has(id)) this._approveSeen.delete(id);
        }
        for (const bar of barsMap.values()) {
            next[bar.cwdKey] = bar.state;
            // Already announced by id just above — don't say it twice.
            if (bar.approvals.length) continue;
            if (bar.state === 'needs-you' && this._barStates[bar.cwdKey] !== 'needs-you') {
                // Names the conversation only when the project holds more
                // than one — otherwise the project name already identifies it.
                this._alertQueue.push(
                    bar.count > 1 && bar.detail ? `${bar.name} — ${bar.detail}` : bar.name);
            }
        }
        this._barStates = next;
        // One sound for whatever this pass turned up, whether the request
        // landed here as buttons or went to a VS Code dialog — both are "a
        // project needs you", and both are announced above. The cooldown
        // collapses a burst (an agent fan-out blocking together) into one.
        if (this._alertQueue.length > queuedBefore) this._playAlertSound(false);
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
        const detailId = `pbDetail-${this._barSeq++}`;
        // Static shell only — every piece of user-controlled text (name,
        // count, state, activity, and now conversation titles and agent
        // types) is set via textContent afterwards, never interpolated into
        // this markup. The one interpolated value is detailId, generated
        // here from a counter.
        li.innerHTML = `
            <div class="pb-head">
                <button type="button" class="pb-toggle" aria-expanded="false" aria-controls="${detailId}">
                    <svg class="ico pb-chev" aria-hidden="true"><use href="#ico-chevron"></use></svg>
                </button>
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
        const stateLabel = this.STATE_LABEL[bar.state] || bar.state;
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
        this._syncExpansion(li, bar);

        // Recency lives in the ticking .pb-time number + its aria-label, not
        // here — baking a "Last activity N ago" sentence into the title too
        // meant it went stale the instant the mouse stopped moving.
        const stateWord = this.STATE_TITLE_WORD[bar.state] || bar.state;
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
        const stateLabel = this.STATE_LABEL[chat.state] || chat.state;
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
            const actText = agent.state === 'needs-you'
                ? 'needs approval'
                : (agent.activity || this.STATE_LABEL[agent.state] || '');
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
