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

    // How long the post-grant flash (.is-auto-granted, blue 4-head ring)
    // stays on a bar after a landed auto-decide — see _syncAutoGrant in
    // scripts/9.4-projects-render.js for the state rule and
    // styles/8-projects.css §4c for the paint recipe.
    AUTO_GRANT_FLASH_MS: 4800,

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

    // Hover tooltip. Every `title` in this widget became a `data-tip` read by
    // _wireTooltips: a native tooltip is painted by the browser chrome, so its
    // offset and type size are unreachable from CSS, and both were wanted
    // different here. TIP_DY is the whole placement rule for a pointer —
    // 20px is roughly where Chrome/Windows puts the native pane (below the
    // cursor hotspot, clear of the arrow), +5px is the requested nudge.
    // Conversions must keep the accessible path intact on their own: `title`
    // is an AT-visible attribute and `data-tip` is not, so a site only moves
    // over once its text is already reachable as content, aria-label or
    // aria-describedby.
    TIP_DX: 12,
    TIP_DY: 25,
    TIP_GAP: 8,        // element-anchored (keyboard focus) vertical gap
    TIP_MARGIN: 8,     // keep-inside-viewport padding
    TIP_DELAY_MS: 350, // native-ish dwell, so a mouse crossing the row is quiet

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
    _autoGranted: null,     // cwdKey (lowercased) -> flash-until ms; see _syncAutoGrant
    _armLastMins: 0,        // last committed duration, session-memory only
    _armPopSeq: 0,
    _armPopCloser: null,    // document-level pointerdown handler while a popover is open
    _tabAlertOn: false,
    _tabAlertTimer: null,
    _tabAlertRestore: null, // original favicon href + title, captured at first alert
    _tipEl: null,           // the single reused pane; created lazily on first hover
    _tipFor: null,          // element the pane is currently showing (or awaiting)
    _tipTimer: null,        // dwell timer before a pointer-triggered show
    _tipAt: null,           // last pointer position, or null for element-anchored

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
        this._wireTooltips();
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
        this._autoGranted = new Map();
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
};
