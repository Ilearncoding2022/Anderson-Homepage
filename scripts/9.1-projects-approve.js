// ==========================================
// 9.1-PROJECTS-APPROVE.JS - extends ProjectsWidget (family 9.x)
//
// Remote approve (v4.17): poll the broker, overlay held requests onto the
// session data, and answer them from the bar's Allow/Deny buttons. Split out
// of scripts/9-projects.js verbatim; see that file's header for the shared
// architecture and scripts/9.2-projects-autoallow.js for the auto-allow
// override layered on top of this.
// ==========================================

Object.assign(ProjectsWidget, {

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
            this._autoGranted?.clear();
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
});
