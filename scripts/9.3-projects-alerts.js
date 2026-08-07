// ==========================================
// 9.3-PROJECTS-ALERTS.JS - extends ProjectsWidget (family 9.x)
//
// Tab alert (favicon flash + title) and alert sound for a waiting permission
// request. Split out of scripts/9-projects.js verbatim; see that file's
// header for the shared architecture.
// ==========================================

Object.assign(ProjectsWidget, {

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
});
