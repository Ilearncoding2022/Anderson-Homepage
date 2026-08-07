// ==========================================
// 9.2-PROJECTS-AUTOALLOW.JS - extends ProjectsWidget (family 9.x)
//
// Auto-allow (v4.22): a per-project timed override armed from the bar's
// hourglass button, layered on top of scripts/9.1-projects-approve.js. Split
// out of scripts/9-projects.js verbatim; see that file's header for the
// shared architecture.
// ==========================================

Object.assign(ProjectsWidget, {

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
        // Before the swell, not after: the number and the pulse are one event.
        this._paintArmTally(btn);
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
            const tallyEl = btn.querySelector('.pb-arm-tally-n');
            if (tallyEl && tallyEl.textContent !== '') tallyEl.textContent = '';
            const label = `Auto-allow permission requests in ${bar.name} for a timed window`;
            if (btn.getAttribute('aria-label') !== label) {
                btn.setAttribute('aria-label', label);
                this._setTip(btn, 'Auto-allow for a timed window…');
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
        this._paintArmTally(btn);
        const mins = Math.ceil(remaining / 60000);
        const key = (li?.dataset.cwdKey || '').toLowerCase();
        const count = this._autoAllow.get(key)?.count || 0;
        const label = `Stop auto-allow — ${count} approved so far, ${mins} minute${mins === 1 ? '' : 's'} left`;
        // The tooltip tracks the live count every tick — it used to be
        // rewritten only on the minute rollover below, which let the hover
        // text trail the pill's own tally by up to a minute. The pane is
        // aria-hidden and _setTip no-ops on unchanged text, so this refresh
        // costs no announcements and no attribute churn.
        this._setTip(btn, label);
        // Minute-granular accessible name (same churn rule as _tickTime) —
        // rewriting a focused control's label re-announces in some AT, and
        // the pill is focused right after arming. The bucket is the minute
        // ALONE: the tally is read at rewrite time (so it can lag up to a
        // minute) rather than added to the key, where every landed approval
        // would force the exact per-event churn this guard exists to stop.
        const bucket = String(mins);
        if (btn.dataset.armBucket !== bucket) {
            btn.dataset.armBucket = bucket;
            btn.setAttribute('aria-label', label);
        }
    },

    /**
     * The running tally beside the countdown — how many requests this armed
     * window has actually approved. Read from _autoAllow, the same counter the
     * pill's aria-label uses, so it is the *landed* count (a request the
     * broker had already released increments nothing) and it survives a
     * refresh with the window rather than restarting at zero. Painted from the
     * 1 s tick and again from _ackAutoAllow, so a landing is reflected at once
     * instead of up to a second later.
     */
    _paintArmTally(btn) {
        const nEl = btn.querySelector('.pb-arm-tally-n');
        if (!nEl) return;
        const key = (btn.closest('.project-bar')?.dataset.cwdKey || '').toLowerCase();
        const txt = String(this._autoAllow?.get(key)?.count || 0);
        if (nEl.textContent !== txt) nEl.textContent = txt;
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
                // Summaries are ellipsis-truncated; the tooltip carries the
                // rest for mouse users (textContent already does for AT).
                this._setTip(sumEl, a.summary);
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
        // is advertised outside Settings. aria-keyshortcuts carries it for AT,
        // which is what the `title` used to do (as an accessible description)
        // before the tooltip stopped being a native one.
        this._setTip(btn, 'Ctrl+Enter');
        if (!btn.hasAttribute('aria-keyshortcuts')) btn.setAttribute('aria-keyshortcuts', 'Control+Enter');
    },
});
