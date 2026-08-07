// ==========================================
// 9.4-PROJECTS-RENDER.JS - extends ProjectsWidget (family 9.x)
//
// Row rendering / reconciliation, expand/collapse, the hover tooltip, the
// shared 1s ticker, open/close collapse choreography, and visibility
// handling. Split out of scripts/9-projects.js verbatim; see that file's
// header for the shared architecture.
// ==========================================

Object.assign(ProjectsWidget, {

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
            this._setTip(more, hiddenNames);
            // The tooltip is mouse-only and a bare listitem isn't
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
                        <span class="pb-arm-tally" aria-hidden="true">
                            <span class="pb-arm-tally-n"></span>
                            <svg class="ico pb-arm-tick" aria-hidden="true"><use href="#ico-check-bold"></use></svg>
                        </span>
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
        this._syncAutoGrant(li, bar);
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
        // Mouse-only by design: every word of this is already visible on the
        // bar (name, chip, state, activity) — the tooltip exists because those
        // are ellipsis-truncated, so nothing is lost to AT by not being a
        // `title`. See _wireTooltips.
        this._setTip(li, newTitle);

        this._tickNode(li);
    },

    /**
     * Blue 4-head running-light ring (.is-auto-granted, styles/8-projects.css
     * §4c): a brief post-grant flash, not a "waiting" indicator. There is no
     * state where an armed project's held request sits attached to its bar
     * IN PARALLEL with a class we could paint blue — every path that puts a
     * request on a bar (_applyApprovalOverlay) sets needs-you, which
     * _deriveState propagates, which is exactly what makes that bar orange.
     * That covers the sweep's own leftovers too (a request left un-answered
     * because `_approveBusy` was already holding it, or because it tripped
     * the `_autoFailed` fallback after two dead /decide POSTs): those still
     * flow through the same overlay and render as needs-you, not blue. So
     * this is what the feature observably is — a brief "that just got
     * auto-approved" flash, timed by AUTO_GRANT_FLASH_MS from the moment
     * _autoDecide's fetch actually lands (scripts/9.2-projects-autoallow.js).
     *
     * Pure class toggle on the existing bar node — reconciled in place on
     * every render pass exactly like is-needs-you/is-armed, and never read
     * by _deriveState, alerts, sorting or expansion.
     *
     * The `!armed` branch below (not just "expired") matters because
     * _autoDecide's fetch can land up to ~4s after the sweep queued it: a
     * disarm (_disarm, cap-eviction, _closeRow, approve-off) firing in that
     * window is guarded on the write side (_autoDecide only sets the flash
     * if the project is still armed at landing time), but a project can also
     * be disarmed AFTER a flash was already set — this is the read side of
     * that same guarantee, so a stale flash can never survive its project
     * losing its armed window.
     */
    _syncAutoGrant(li, bar) {
        const key = bar.cwdKey.toLowerCase();
        // _syncArm (called just above) has already disarmed any entry whose
        // deadline lapsed this pass, so .has() here already means "armed
        // right now".
        const armed = !!this._autoAllow?.has(key);
        const until = this._autoGranted?.get(key) || 0;
        const flashing = armed && until > Date.now();
        if (!flashing) this._autoGranted?.delete(key); // expired, or its project isn't armed — stop carrying it
        li.classList.toggle('is-auto-granted', flashing);
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

    // ----------------------------------------
    // Hover tooltip (replaces this widget's native `title` tooltips)
    // ----------------------------------------

    /**
     * One delegated set of listeners on the document, keyed off `[data-tip]`.
     * Delegated rather than per-node because bars, chat rows, approval rows and
     * settings rows are all created and destroyed constantly — and because the
     * two surfaces this covers (the row under the header, the Settings project
     * list) have no common ancestor below <body>. Nothing outside this widget
     * sets `data-tip`, so the handlers no-op everywhere else.
     */
    _wireTooltips() {
        const target = (e) => (e.target instanceof Element ? e.target.closest('[data-tip]') : null);

        // pointerover/out (not enter/leave) so one listener covers the whole
        // document; the relatedTarget check turns them into enter/leave for
        // the matched ancestor, so moving between a bar's own children doesn't
        // restart the dwell.
        document.addEventListener('pointerover', (e) => {
            if (e.pointerType === 'touch') return;   // no hover on touch; long-press is the OS's job
            const el = target(e);
            if (!el || el === this._tipFor) return;
            this._openTip(el, { x: e.clientX, y: e.clientY });
        });
        document.addEventListener('pointerout', (e) => {
            const el = target(e);
            if (!el || el !== this._tipFor) return;
            // Leaving for a descendant of the same target is not leaving.
            if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
            this._hideTip();
        });
        // Follow the cursor while the pane is up, the same as the native one.
        document.addEventListener('pointermove', (e) => {
            if (!this._tipFor || e.pointerType === 'touch') return;
            const el = target(e);
            if (el !== this._tipFor) return;
            this._tipAt = { x: e.clientX, y: e.clientY };
            if (this._tipEl && !this._tipEl.hidden) this._placeTip();
        });

        // Keyboard parity: focus shows it immediately (no dwell — a Tab stop is
        // already a deliberate landing) and anchors it to the element, since
        // there is no cursor to sit under. :focus-visible, not :focus — a
        // mouse click focuses too, and the native tooltip it replaces never
        // appeared on click. (pointerdown's hide has already run by then, so
        // without this the pane would pop straight back up under the cursor.)
        document.addEventListener('focusin', (e) => {
            const el = target(e);
            // Tested on the focused node, anchored on its [data-tip] ancestor:
            // the tip-bearing element is often a wrapper (the settings row
            // holds the path, the input is what takes focus).
            const kbd = e.target instanceof Element && e.target.matches(':focus-visible');
            if (el && kbd) this._openTip(el, null);
            else if (this._tipFor) this._hideTip();
        });
        document.addEventListener('focusout', (e) => {
            if (target(e) === this._tipFor) this._hideTip();
        });

        // Escape dismisses without moving focus (WCAG 1.4.13 "dismissable").
        // Capture, and no stopPropagation: the arm popover's own Escape
        // handler must still run in the same keystroke.
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._tipFor) this._hideTip();
        }, true);

        // Anything that moves the anchor out from under the pane. Scroll is
        // captured because the settings modal and the row scroll internally.
        document.addEventListener('scroll', () => this._hideTip(), true);
        document.addEventListener('pointerdown', () => this._hideTip(), true);
        window.addEventListener('blur', () => this._hideTip());
        window.addEventListener('resize', () => this._hideTip());
    },

    /** Arm the dwell (pointer) or show at once (focus). `at` is the pointer
     *  position, or null to anchor under the element itself. */
    _openTip(el, at) {
        this._hideTip();
        if (!el.dataset.tip) return;
        this._tipFor = el;
        this._tipAt = at;
        if (!at) { this._paintTip(); return; }
        this._tipTimer = setTimeout(() => {
            this._tipTimer = null;
            // The node can be gone by now — a render pass replaces rows under
            // a resting cursor several times a minute.
            if (this._tipFor && this._tipFor.isConnected) this._paintTip();
            else this._hideTip();
        }, this.TIP_DELAY_MS);
    },

    _hideTip() {
        clearTimeout(this._tipTimer);
        this._tipTimer = null;
        this._tipFor = null;
        this._tipAt = null;
        if (this._tipEl) {
            this._tipEl.classList.remove('is-on');
            this._tipEl.hidden = true;
        }
    },

    /** Fill and place the pane. textContent only — every string here is
     *  ultimately broker- or hook-derived (project names, chat titles, command
     *  summaries) and is treated as untrusted, same as everywhere else. */
    _paintTip() {
        const el = this._tipFor;
        const text = el?.dataset.tip;
        if (!text) { this._hideTip(); return; }
        if (!this._tipEl) {
            const tip = document.createElement('div');
            tip.className = 'pb-tip';
            // Not role="tooltip"/aria-describedby: every converted site already
            // carries this text as content, aria-label or aria-describedby, so
            // wiring it up again would double the announcement.
            tip.setAttribute('aria-hidden', 'true');
            tip.hidden = true;
            document.body.appendChild(tip);
            this._tipEl = tip;
        }
        this._tipEl.textContent = text;
        this._tipEl.hidden = false;   // must be laid out before it can be measured
        this._placeTip();
        this._tipEl.classList.add('is-on');
    },

    /** Position below the cursor (or below the element, keyboard path),
     *  clamped into the viewport and flipped above if it would not fit. */
    _placeTip() {
        const tip = this._tipEl;
        const el = this._tipFor;
        if (!tip || !el) return;
        const box = tip.getBoundingClientRect();
        let x, y, flipY;
        if (this._tipAt) {
            x = this._tipAt.x + this.TIP_DX;
            y = this._tipAt.y + this.TIP_DY;
            flipY = this._tipAt.y - this.TIP_GAP - box.height;
        } else {
            const anchor = el.getBoundingClientRect();
            x = anchor.left;
            y = anchor.bottom + this.TIP_GAP;
            flipY = anchor.top - this.TIP_GAP - box.height;
        }
        const maxX = window.innerWidth - box.width - this.TIP_MARGIN;
        x = Math.max(this.TIP_MARGIN, Math.min(x, maxX));
        // Below is the default; flip above only when below genuinely overflows
        // AND above has room, so a tall pane in a short window still shows.
        if (y + box.height > window.innerHeight - this.TIP_MARGIN && flipY >= this.TIP_MARGIN) {
            y = flipY;
        }
        y = Math.max(this.TIP_MARGIN, Math.min(y, window.innerHeight - box.height - this.TIP_MARGIN));
        tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    },

    /** Set/clear a tooltip on one element, keeping the pane in sync if it is
     *  the one on screen. Call sites guard on change themselves, but a render
     *  pass that rewrites the hovered node must not leave stale text up. */
    _setTip(el, text) {
        if (!el) return;
        const val = text || '';
        if ((el.dataset.tip || '') === val) return;
        if (val) el.dataset.tip = val;
        else delete el.dataset.tip;
        if (el === this._tipFor) {
            if (!val) this._hideTip();
            else if (this._tipEl && !this._tipEl.hidden) this._paintTip();
        }
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
            this._setTip(titleEl, chat.title);
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
        // The post-grant flash (.is-auto-granted) is timed to disappear at a
        // specific moment — one rotation of the blue ring — not on whatever
        // render happens to come along next. Left to the render passes alone
        // it would only be re-evaluated by the 2s approval poll (which sees
        // no change right after a grant, so doesn't fire) or the 6s data
        // poll, stretching the flash to 4.8-10.8s and cutting it off at an
        // arbitrary rotation angle instead of a full sweep. Gated so the
        // common case (nothing ever granted) adds no per-second work.
        if (this._autoGranted?.size) {
            const now = Date.now();
            for (const [key, until] of this._autoGranted) {
                if (until > now && this._autoAllow?.has(key)) continue; // still flashing on an armed project
                this._autoGranted.delete(key);
                for (const li of ul.querySelectorAll('.project-bar')) {
                    if ((li.dataset.cwdKey || '').toLowerCase() === key) {
                        li.classList.remove('is-auto-granted');
                        break;
                    }
                }
            }
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
            this._autoGranted?.clear();
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
});
