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
    POLL_MS: 10 * 1000,        // re-read claude-projects.js
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
            this._queueAlerts(bars);
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
            agents: agentRows,
            // A lone agent doesn't earn a row of its own — its type is folded
            // into this conversation's meta line instead. See _hasDetail.
            foldedAgent: agentRows.length === 1 ? agentRows[0] : null
        };
    },

    _computeBar(cwdKey, sessions, now, idleMs) {
        const ordered = sessions.slice().sort((a, b) =>
            (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
        const chats = ordered.map((s, i) => this._computeChat(s, i + 1, now, idleMs));

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
        for (const bar of barsMap.values()) {
            next[bar.cwdKey] = bar.state;
            if (bar.state === 'needs-you' && this._barStates[bar.cwdKey] !== 'needs-you') {
                // Names the conversation only when the project holds more
                // than one — otherwise the project name already identifies it.
                this._alertQueue.push(
                    bar.count > 1 && bar.detail ? `${bar.name} — ${bar.detail}` : bar.name);
            }
        }
        this._barStates = next;
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
        const ul = document.getElementById('projectsRow')?.querySelector('.projects-row');
        if (!ul) return;
        // Delegated: bars are created and destroyed constantly, the row
        // element itself never is (_closeRow only empties it).
        ul.addEventListener('click', (e) => {
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
        } else if (!li.dataset.autoDismissed && !sticky) {
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
