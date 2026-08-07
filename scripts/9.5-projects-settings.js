// ==========================================
// 9.5-PROJECTS-SETTINGS.JS - extends ProjectsWidget (family 9.x)
//
// Settings: enable / idle / hide, and the project names list. Split out of
// scripts/9-projects.js verbatim; see that file's header for the shared
// architecture. This is the LAST file in the 9.x family loaded by the page,
// so the start() bootstrap lives at the very end of this file — start() runs
// immediately and needs every other family member's Object.assign to have
// already run.
// ==========================================

Object.assign(ProjectsWidget, {

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
                    this._setTip(label, wantTitle);
                    // Also on the row, so the path is readable from anywhere
                    // along it — the label itself is ellipsis-truncated and
                    // can be a narrow target for the one folder name that's
                    // ambiguous enough to need the tooltip.
                    this._setTip(row, wantTitle);
                    // data-tip is invisible to AT, unlike the `title` this
                    // replaced — so the path moves to a real description on
                    // the input, which is the thing AT actually lands on.
                    const pathEl = row.querySelector('.projects-name-path');
                    if (pathEl && pathEl.textContent !== wantTitle) pathEl.textContent = wantTitle;
                }
                const removeBtn = row.querySelector('.projects-name-remove');
                if (removeBtn) {
                    const removeLabel = `Remove ${info.folder} from this list`;
                    if (removeBtn.getAttribute('aria-label') !== removeLabel) {
                        removeBtn.setAttribute('aria-label', removeLabel);
                        this._setTip(removeBtn, removeLabel);
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
        const seq = this._nameRowSeq++;
        const inputId = `projectsNameInput-${seq}`;
        const pathId = `projectsNamePath-${seq}`;
        // Static shell; the folder name, the tooltip, the path description and
        // the remove button's accessible name are all set via
        // textContent/attributes in _renderNamesList. The only interpolated
        // values are the two ids, generated from a counter here.
        row.innerHTML = `
            <label class="projects-name-label" for="${inputId}"></label>
            <input type="text" class="projects-name-input" id="${inputId}" autocomplete="off" maxlength="60" aria-describedby="${pathId}">
            <span class="projects-name-path sr-only" id="${pathId}"></span>
            <button type="button" class="projects-name-remove glass-control">
                <svg class="ico" aria-hidden="true"><use href="#ico-trash"></use></svg>
            </button>`;
        list.appendChild(row);
        return row;
    }
});

window.ProjectsWidget = ProjectsWidget;

// Scripts sit at the end of <body>, so the DOM is ready.
ProjectsWidget.start();
