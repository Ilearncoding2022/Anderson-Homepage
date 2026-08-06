// ==========================================
// 6-TODO.JS - To-Do List Module (v3.0)
// Anderson Homepage
//
// A movable "To-Do" card rendered as a virtual group (__todo__), repositioned
// via the minimap like the Calendar card. Each task supports one level of
// subtasks, a due date, and an urgency badge (TBD / Trivial / Medium / Urgent /
// ASAP). Tasks and subtasks can be reordered by drag-and-drop (a task carries
// its subtasks with it).
//
// Check semantics (v4.27: completion never flows upward):
//   - Toggling a task cascades that done-state to all of its subtasks.
//   - Checking subtasks — even the last one — never checks the parent; the
//     user checks the task off themselves.
//   - Incompleteness DOES flow upward: a done parent that gains a not-done
//     subtask (uncheck, add, restore) goes back to not-done, so "parent is
//     done" always still means "everything in it is done" — the sweep relies
//     on that to archive a due parent as a whole tree.
//
// Recurring tasks (v3.1):
//   Each task/subtask carries a `recur` field ('none'|'daily'|'weekly'|'monthly').
//   When a recurring item is completed it is NOT left done — instead its dueDate
//   is rolled forward by one period and done is reset to false (next occurrence).
//   - Recurring PARENT toggled done → roll parent dueDate forward, uncheck parent
//     and all subtasks (same cascade as a normal check, then recur resets done).
//   - Recurring SUBTASK toggled done → roll that subtask's dueDate forward,
//     uncheck it; the not-done rolled-forward subtask also un-checks a done
//     parent (incompleteness flows upward).
//   Consequence (accepted): a recurring item never stays done, so it never
//   reaches the done archive — it rolls forward instead.
//
// Done archive (v4.27):
//   Every done item carries `doneAt` (ms). Ten minutes after being checked off
//   (DONE_ARCHIVE_DELAY_MS — the done button's progress ring animates this
//   same window), _sweepDone moves it into a second archive (DONE_ARCHIVE_KEY),
//   separate from the deleted-item archive but with the same TTL. A due top-level task takes
//   its remaining subtasks with it; a due subtask inside a not-yet-due parent
//   leaves individually (as an isSub entry, same shape delete() uses). The
//   invariant doneAt ⇔ done is maintained everywhere done is written, because
//   the sweep clock reads doneAt only.
//   Done-archive entries are stamped `archivedAt`; deleted entries keep their
//   historical `deletedAt` (no migration). Restoring from the done archive
//   always yields a fresh, unchecked top-level task.
// ==========================================

const TodoManager = {
    STORAGE_KEY: 'todos',
    ARCHIVE_KEY: 'todoArchive',
    DONE_ARCHIVE_KEY: 'todoDoneArchive',
    ARCHIVE_TTL_DAYS: 14,
    DONE_ARCHIVE_DELAY_MS: 10 * 60 * 1000,
    // Ordered low → high; the badge cycles in this order and wraps back to 'tbd'.
    // 'asap' is the highest level, sitting above 'urgent'.
    URGENCY_LEVELS: ['tbd', 'trivial', 'medium', 'urgent', 'asap'],
    URGENCY_LABELS: { tbd: 'TBD', trivial: 'Trivial', medium: 'Medium', urgent: 'Urgent', asap: 'ASAP' },
    // Recurrence levels; cycles in this order and wraps back to 'none'.
    RECUR_LEVELS: ['none', 'daily', 'weekly', 'monthly'],
    RECUR_LABELS: { none: 'No repeat', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' },

    state: { todos: [], archive: [], doneArchive: [] },

    initialize() {
        this.load();
        this._attachCrossTabSync();
        // A self-owned timer keeps the module independent of the app-level
        // clock tick. 10s cadence: the done button's progress ring closes at
        // exactly DONE_ARCHIVE_DELAY_MS, so the sweep must follow within a
        // beat or a visibly "complete" ring lingers.
        if (!this._sweepIntervalId) {
            this._sweepIntervalId = setInterval(() => this._sweepDone(), 10 * 1000);
        }
    },

    // Keep every open tab's To-Do card in sync. The browser fires a `storage`
    // event in *other* tabs whenever localStorage changes, so a change saved in
    // one tab reloads and re-renders the rest immediately — no polling needed.
    _attachCrossTabSync() {
        if (this._crossTabAttached) return;
        this._crossTabAttached = true;
        window.addEventListener('storage', (e) => {
            // Only react to our keys. e.key === null means storage was cleared
            // wholesale (e.g. via clear()), which we also want to pick up.
            if (e.key !== null && e.key !== this.STORAGE_KEY && e.key !== this.ARCHIVE_KEY
                && e.key !== this.DONE_ARCHIVE_KEY) return;
            this._syncFromStorage();
        });
    },

    // Is the user mid-edit in this tab's card (typing a task, picking a date)?
    // Shared guard: both the cross-tab sync and the done-sweep must not yank a
    // half-typed .todo-add/.todo-subadd away with a re-render.
    _isEditingTodoCard() {
        const ae = document.activeElement;
        return !!(ae && ae.closest && ae.closest('.todo-group')
            && ae.matches('input, textarea'));
    },

    // Reload state from localStorage and re-render. If the user is mid-edit,
    // defer briefly so their in-progress input isn't yanked away, then retry
    // until it's safe.
    _syncFromStorage() {
        if (this._isEditingTodoCard()) {
            clearTimeout(this._syncRetryId);
            this._syncRetryId = setTimeout(() => this._syncFromStorage(), 2000);
            return;
        }
        clearTimeout(this._syncRetryId);
        this.load();
        this._rerender();
    },

    load() {
        const raw = Utils.safeJSONParse(localStorage.getItem(this.STORAGE_KEY), []);
        this._stampedDoneAt = false;
        this.state.todos = Array.isArray(raw)
            ? raw.map(t => this._normalizeTask(t, false)).filter(Boolean)
            : [];
        const stampedTodos = this._stampedDoneAt;
        const arch = Utils.safeJSONParse(localStorage.getItem(this.ARCHIVE_KEY), []);
        this.state.archive = Array.isArray(arch)
            ? arch.map(a => this._normalizeArchived(a)).filter(Boolean)
            : [];
        const doneArch = Utils.safeJSONParse(localStorage.getItem(this.DONE_ARCHIVE_KEY), []);
        this.state.doneArchive = Array.isArray(doneArch)
            ? doneArch.map(a => this._normalizeArchived(a, 'archivedAt')).filter(Boolean)
            : [];
        this._pruneArchive();
        // Items checked off more than DONE_ARCHIVE_DELAY_MS before this load
        // (browser closed in between) archive now rather than waiting for the
        // first timer tick.
        this._sweepDone(false);
        // Legacy done items (pre-doneAt) were stamped in memory by
        // _normalizeTask; persist the stamp or every reload restarts their 1h
        // clock and they never archive.
        if (stampedTodos) this.save();
    },

    save() {
        Utils.safeLocalStorageSet(this.STORAGE_KEY, JSON.stringify(this.state.todos));
    },

    saveArchive() {
        Utils.safeLocalStorageSet(this.ARCHIVE_KEY, JSON.stringify(this.state.archive));
    },

    saveDoneArchive() {
        Utils.safeLocalStorageSet(this.DONE_ARCHIVE_KEY, JSON.stringify(this.state.doneArchive));
    },

    getTodos() {
        return this.state.todos;
    },

    // Count of incomplete top-level tasks (shown in the card/minimap header).
    remainingCount() {
        return this.state.todos.filter(t => !t.done).length;
    },

    // ---- Validation / normalization ----

    _validDate(s) {
        return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    },

    _validUrgency(u) {
        return this.URGENCY_LEVELS.includes(u) ? u : 'tbd';
    },

    _validRecur(r) {
        return this.RECUR_LEVELS.includes(r) ? r : 'none';
    },

    todayStr() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    },

    _normalizeTask(t, isSub) {
        if (!t || typeof t !== 'object') return null;
        const task = {
            id: typeof t.id === 'string' && t.id ? t.id : crypto.randomUUID(),
            text: typeof t.text === 'string' ? t.text : '',
            done: t.done === true,
            doneAt: typeof t.doneAt === 'number' && isFinite(t.doneAt) ? t.doneAt : null,
            dueDate: this._validDate(t.dueDate) ? t.dueDate : null,
            urgency: this._validUrgency(t.urgency),
            recur: this._validRecur(t.recur)
        };
        if (!isSub) {
            task.subtasks = Array.isArray(t.subtasks)
                ? t.subtasks.map(s => this._normalizeTask(s, true)).filter(Boolean)
                : [];
            // Completion never flows upward, but a loaded done parent must
            // still mean "everything in it is done" (the sweep archives it as
            // a tree) — un-check it if any child isn't.
            if (task.done && task.subtasks.length > 0 && !task.subtasks.every(s => s.done)) {
                task.done = false;
            }
        }
        // doneAt ⇔ done: items done before this field existed get their clock
        // started now (they archive one delay-window after the upgrade, not
        // instantly).
        // The flag lets load() persist the stamp once, or it only ever lives
        // in memory and resets on every reload.
        if (task.done && task.doneAt === null) {
            task.doneAt = Date.now();
            this._stampedDoneAt = true;
        }
        if (!task.done) task.doneAt = null;
        return task;
    },

    // Completion never flows upward — checking every subtask does NOT check
    // the parent — but incompleteness does: a done parent gaining a not-done
    // subtask would otherwise be swept into the done archive as a "finished"
    // tree while visibly unfinished, so it goes back to not-done and its 1h
    // clock stops.
    _uncheckIncompleteParent(parent) {
        if (!Array.isArray(parent.subtasks) || parent.subtasks.length === 0) return;
        if (parent.done && !parent.subtasks.every(s => s.done)) {
            parent.done = false;
            parent.doneAt = null;
        }
    },

    // An archived entry is a top-level task (or a lone subtask) plus the archival
    // timestamp — `deletedAt` in the deleted archive (historical name, kept so
    // stored data needs no migration), `archivedAt` in the done archive.
    // Subtask entries remember the parent they were removed from.
    _normalizeArchived(a, stampField = 'deletedAt') {
        if (!a || typeof a !== 'object') return null;
        const task = this._normalizeTask(a, false);
        if (!task) return null;
        const stamp = typeof a[stampField] === 'number' && isFinite(a[stampField])
            ? a[stampField]
            : Date.now();
        const entry = { ...task, [stampField]: stamp };
        if (a.isSub === true) {
            entry.isSub = true;
            entry.parentId = typeof a.parentId === 'string' ? a.parentId : null;
            entry.parentText = typeof a.parentText === 'string' ? a.parentText : '';
            entry.subtasks = []; // a lone subtask never has children of its own
        }
        return entry;
    },

    _archiveTtlMs() {
        return this.ARCHIVE_TTL_DAYS * 24 * 60 * 60 * 1000;
    },

    // Archival timestamp regardless of which archive an entry sits in.
    archiveStamp(a) {
        return a.archivedAt ?? a.deletedAt;
    },

    // Drop archived entries older than the retention window (both archives).
    _pruneArchive() {
        const cutoff = Date.now() - this._archiveTtlMs();
        let before = this.state.archive.length;
        this.state.archive = this.state.archive.filter(a => a.deletedAt >= cutoff);
        if (this.state.archive.length !== before) this.saveArchive();
        before = this.state.doneArchive.length;
        this.state.doneArchive = this.state.doneArchive.filter(a => a.archivedAt >= cutoff);
        if (this.state.doneArchive.length !== before) this.saveDoneArchive();
    },

    // Whole-day count remaining before an archived entry is auto-purged.
    daysUntilPurge(deletedAt) {
        const remaining = (deletedAt + this._archiveTtlMs()) - Date.now();
        return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
    },

    // Archived entries, freshly pruned, most-recently-deleted first.
    getArchive() {
        this._pruneArchive();
        return [...this.state.archive].sort((a, b) => b.deletedAt - a.deletedAt);
    },

    // Done-archive entries, freshly pruned, most-recently-archived first.
    // No sweep here: getDoneArchive is called mid-render (renderTodoArchive),
    // and a sweep's _rerender from inside a render pass would recurse.
    getDoneArchive() {
        this._pruneArchive();
        return [...this.state.doneArchive].sort((a, b) => b.archivedAt - a.archivedAt);
    },

    // Move items whose 1h done clock has elapsed into the done archive. A due
    // top-level task takes its remaining subtasks with it; a due subtask whose
    // parent isn't due yet leaves individually, and the parent's derived state
    // is recomputed (it may flip done and start its own clock, or — emptied of
    // subtasks — stand on its own flag).
    _sweepDone(rerender = true) {
        // Same mid-edit guard as _syncFromStorage: the timer must not rebuild
        // the card under a half-typed .todo-add, and — since every save here
        // is a whole-array write from this tab's snapshot — it must not write
        // over another tab's changes while our own sync is deferred. Skipping
        // the whole tick is safe: the next tick (or the next user action)
        // picks the due items up.
        if (this._isEditingTodoCard()) return;
        const now = Date.now();
        const due = (item) => item.done && typeof item.doneAt === 'number'
            && now - item.doneAt >= this.DONE_ARCHIVE_DELAY_MS;
        let moved = false;
        this.state.todos = this.state.todos.filter(task => {
            if (!due(task)) return true;
            this.state.doneArchive.push({ ...task, archivedAt: now });
            moved = true;
            return false;
        });
        for (const parent of this.state.todos) {
            const keep = parent.subtasks.filter(sub => {
                if (!due(sub)) return true;
                this.state.doneArchive.push({
                    ...sub, subtasks: [],
                    isSub: true, parentId: parent.id, parentText: parent.text || '',
                    archivedAt: now
                });
                moved = true;
                return false;
            });
            if (keep.length !== parent.subtasks.length) {
                parent.subtasks = keep;
                this._uncheckIncompleteParent(parent);
            }
        }
        if (moved) {
            this.save();
            this.saveDoneArchive();
            if (rerender) this._rerender();
        }
    },

    // ---- Lookups ----

    _find(id) {
        return this.state.todos.find(t => t.id === id) || null;
    },

    _findSub(parentId, subId) {
        const parent = this._find(parentId);
        return parent ? parent.subtasks.find(s => s.id === subId) || null : null;
    },

    _resolve(id, subId) {
        return subId ? this._findSub(id, subId) : this._find(id);
    },

    // ---- Mutations ----

    addTask(text) {
        const trimmed = (text || '').trim();
        if (!trimmed) return;
        this.state.todos.push({
            id: crypto.randomUUID(), text: trimmed, done: false, doneAt: null,
            dueDate: null, urgency: 'tbd', recur: 'none', subtasks: []
        });
        if (window.UIRenderer) UIRenderer._pendingTodoFocus = { action: 'add-task' };
        this.save();
        this._rerender();
    },

    addSubtask(parentId, text) {
        const parent = this._find(parentId);
        if (!parent) return;
        const trimmed = (text || '').trim();
        if (!trimmed) return;
        parent.subtasks.push({
            id: crypto.randomUUID(), text: trimmed, done: false, doneAt: null,
            dueDate: null, urgency: 'tbd', recur: 'none'
        });
        // A fresh, unchecked subtask means the parent can no longer be fully done.
        this._uncheckIncompleteParent(parent);
        if (window.UIRenderer) UIRenderer._pendingTodoFocus = { action: 'add-sub', id: parentId };
        this.save();
        this._rerender();
    },

    // Enter-to-continue: insert a new EMPTY task directly below an existing one
    // and hand it focus (via the renderer's pending-focus queue). Unlike
    // addTask, empty text is the point — the user types into the new row next.
    insertTaskAfter(afterId) {
        const i = this.state.todos.findIndex(t => t.id === afterId);
        if (i === -1) return;
        const task = {
            id: crypto.randomUUID(), text: '', done: false, doneAt: null,
            dueDate: null, urgency: 'tbd', recur: 'none', subtasks: []
        };
        this.state.todos.splice(i + 1, 0, task);
        if (window.UIRenderer) UIRenderer._pendingTodoFocus = { action: 'edit', id: task.id };
        this.save();
        this._rerender();
    },

    // Enter-to-continue for a subtask: new empty sibling below it, same parent.
    insertSubtaskAfter(parentId, afterSubId) {
        const parent = this._find(parentId);
        if (!parent) return;
        const i = parent.subtasks.findIndex(s => s.id === afterSubId);
        if (i === -1) return;
        const sub = {
            id: crypto.randomUUID(), text: '', done: false, doneAt: null,
            dueDate: null, urgency: 'tbd', recur: 'none'
        };
        parent.subtasks.splice(i + 1, 0, sub);
        // A fresh, unchecked subtask means the parent can no longer be fully done.
        this._uncheckIncompleteParent(parent);
        if (window.UIRenderer) UIRenderer._pendingTodoFocus = { action: 'edit', id: parentId, sub: sub.id };
        this.save();
        this._rerender();
    },

    // Returns the archived entry's id (for the Undo toast), or null when
    // nothing went to the archive.
    delete(id, subId) {
        if (subId) {
            // Subtasks are archived too (recoverable), remembering their parent
            // so they can be restored back into it if it still exists — EXCEPT
            // an empty one (no text; deadline/urgency don't count): there is
            // nothing to recover, so it just disappears instead of cluttering
            // the archive. Tasks are never exempt — an untitled task can still
            // carry named subtasks.
            const parent = this._find(id);
            if (!parent) return null;
            const sub = parent.subtasks.find(s => s.id === subId);
            if (!sub) return null;
            const isEmpty = (sub.text || '').trim() === '';
            parent.subtasks = parent.subtasks.filter(s => s.id !== subId);
            this._uncheckIncompleteParent(parent);
            if (!isEmpty) {
                this.state.archive.push({
                    ...sub, subtasks: [],
                    isSub: true, parentId: parent.id, parentText: parent.text || '',
                    deletedAt: Date.now()
                });
                this.saveArchive();
            }
            this.save();
            this._rerender();
            return isEmpty ? null : subId;
        }
        // Top-level tasks are archived (recoverable for ARCHIVE_TTL_DAYS days).
        const idx = this.state.todos.findIndex(t => t.id === id);
        if (idx === -1) return null;
        const [task] = this.state.todos.splice(idx, 1);
        this.state.archive.push({ ...task, deletedAt: Date.now() });
        this.save();
        this.saveArchive();
        this._rerender();
        return id;
    },

    // Move an archived entry back into the active list.
    // From the deleted archive: a subtask goes back into its original parent
    // when that parent still exists; otherwise (parent gone) it is restored as
    // a new top-level task.
    // From the done archive: always a fresh, unchecked top-level task —
    // regardless of whether the entry was a task or a subtask — so it doesn't
    // re-archive one delay-window later.
    restoreFromArchive(archId, src = 'deleted') {
        const fromDone = src === 'done';
        const list = fromDone ? this.state.doneArchive : this.state.archive;
        const saveList = fromDone ? () => this.saveDoneArchive() : () => this.saveArchive();
        const idx = list.findIndex(a => a.id === archId);
        if (idx === -1) return;
        const [entry] = list.splice(idx, 1);
        const { deletedAt, archivedAt, isSub, parentId, parentText, ...task } = entry;

        if (fromDone) {
            task.done = false;
            task.doneAt = null;
            (task.subtasks || []).forEach(s => { s.done = false; s.doneAt = null; });
        } else if (isSub) {
            const parent = parentId ? this._find(parentId) : null;
            if (parent) {
                const sub = this._normalizeTask(task, true);
                if (parent.subtasks.some(s => s.id === sub.id)) sub.id = crypto.randomUUID();
                parent.subtasks.push(sub);
                this._uncheckIncompleteParent(parent);
                this.save();
                saveList();
                this._rerender();
                return;
            }
            // Parent no longer exists — fall through and restore as a top-level task.
        }

        // Guard against an id collision with a current task.
        if (this.state.todos.some(t => t.id === task.id)) task.id = crypto.randomUUID();
        this.state.todos.push(this._normalizeTask(task, false));
        this.save();
        saveList();
        this._rerender();
    },

    // Permanently remove a single archived entry.
    deleteFromArchive(archId, src = 'deleted') {
        const fromDone = src === 'done';
        const list = fromDone ? this.state.doneArchive : this.state.archive;
        const next = list.filter(a => a.id !== archId);
        if (next.length !== list.length) {
            if (fromDone) this.state.doneArchive = next;
            else this.state.archive = next;
            fromDone ? this.saveDoneArchive() : this.saveArchive();
            this._rerender();
        }
    },

    // Advance a YYYY-MM-DD string (or today if null) by one recurrence period.
    // Returns a YYYY-MM-DD string. Month arithmetic clamps to the last valid day
    // of the target month (e.g. Jan 31 + 1 month → Feb 28 or Feb 29 in a leap
    // year; Mar 31 + 1 month → Apr 30).
    _advanceDueDate(dueDate, recur) {
        const base = this._validDate(dueDate) ? dueDate : this.todayStr();
        const [y, m, d] = base.split('-').map(Number);
        let ny = y, nm = m, nd = d;
        if (recur === 'daily') {
            // Add one day via Date arithmetic (handles month/year boundaries cleanly).
            const dt = new Date(y, m - 1, d + 1);
            ny = dt.getFullYear(); nm = dt.getMonth() + 1; nd = dt.getDate();
        } else if (recur === 'weekly') {
            const dt = new Date(y, m - 1, d + 7);
            ny = dt.getFullYear(); nm = dt.getMonth() + 1; nd = dt.getDate();
        } else if (recur === 'monthly') {
            nm = m + 1;
            if (nm > 12) { nm = 1; ny = y + 1; }
            // Clamp to the last valid day of the target month.
            const maxDay = new Date(ny, nm, 0).getDate(); // day-0 of next month = last day of nm
            nd = Math.min(d, maxDay);
        }
        const p = (n) => String(n).padStart(2, '0');
        return `${ny}-${p(nm)}-${p(nd)}`;
    },

    toggleTask(id) {
        const task = this._find(id);
        if (!task) return;
        task.done = !task.done;
        task.doneAt = task.done ? Date.now() : null;
        // Checking a task cascades to all subtasks; unchecking does the same.
        task.subtasks.forEach(s => { s.done = task.done; s.doneAt = task.doneAt; });

        // Rollover: if a recurring task is being completed, advance its due date
        // and reset it to not-done (and un-check all its subtasks). The user sees
        // the task immediately reappear as the next scheduled occurrence.
        if (task.done && task.recur !== 'none') {
            task.dueDate = this._advanceDueDate(task.dueDate, task.recur);
            task.done = false;
            task.doneAt = null;
            task.subtasks.forEach(s => { s.done = false; s.doneAt = null; });
        }

        if (window.UIRenderer) UIRenderer._pendingTodoFocus = { action: 'toggle', id };
        this.save();
        this._rerender();
    },

    toggleSubtask(parentId, subId) {
        const parent = this._find(parentId);
        const sub = parent && parent.subtasks.find(s => s.id === subId);
        if (!sub) return;
        sub.done = !sub.done;
        sub.doneAt = sub.done ? Date.now() : null;

        // Rollover: if a recurring subtask is being completed, advance its due
        // date and reset it to not-done. The parent's done state is then
        // recomputed — the rolled-forward subtask is not done, so the parent
        // stays not-done.
        if (sub.done && sub.recur !== 'none') {
            sub.dueDate = this._advanceDueDate(sub.dueDate, sub.recur);
            sub.done = false;
            sub.doneAt = null;
        }

        // Completion never flows upward — but unchecking a subtask under a
        // done parent un-checks the parent too.
        this._uncheckIncompleteParent(parent);
        if (window.UIRenderer) UIRenderer._pendingTodoFocus = { action: 'toggle', id: parentId, sub: subId };
        this.save();
        this._rerender();
    },

    setText(id, subId, text) {
        const item = this._resolve(id, subId);
        if (!item) return;
        item.text = (text || '').trim();
        this.save(); // no re-render: the input already shows the committed value
    },

    cycleUrgency(id, subId) {
        const item = this._resolve(id, subId);
        if (!item) return;
        const idx = this.URGENCY_LEVELS.indexOf(item.urgency);
        item.urgency = this.URGENCY_LEVELS[(idx + 1) % this.URGENCY_LEVELS.length];
        this.save();
        this._rerender();
    },

    // Set a specific recurrence level (chosen in the schedule modal). Invalid
    // values fall back to 'none' via _validRecur.
    setRecur(id, subId, value) {
        const item = this._resolve(id, subId);
        if (!item) return;
        item.recur = this._validRecur(value);
        this.save();
        this._rerender();
    },

    setDueDate(id, subId, date) {
        const item = this._resolve(id, subId);
        if (!item) return;
        item.dueDate = this._validDate(date) ? date : null;
        this.save();
        this._rerender();
    },

    // ---- Reordering (drag-and-drop) ----

    // Reorder a list of objects in place to match `orderedIds`. Any item whose id
    // isn't in the list is appended in its original relative order, so a stale or
    // partial id list can never silently drop a task/subtask.
    _applyOrder(list, orderedIds) {
        const byId = new Map(list.map(item => [item.id, item]));
        const seen = new Set();
        const next = [];
        for (const id of orderedIds) {
            const item = byId.get(id);
            if (item && !seen.has(id)) { next.push(item); seen.add(id); }
        }
        for (const item of list) {
            if (!seen.has(item.id)) next.push(item);
        }
        return next;
    },

    // Commit a new top-level task order (subtasks travel with their task).
    reorderTasks(orderedIds) {
        if (!Array.isArray(orderedIds)) return;
        this.state.todos = this._applyOrder(this.state.todos, orderedIds);
        this.save();
        this._rerender();
    },

    // Commit a new order for one task's subtasks.
    reorderSubtasks(parentId, orderedIds) {
        const parent = this._find(parentId);
        if (!parent || !Array.isArray(orderedIds)) return;
        parent.subtasks = this._applyOrder(parent.subtasks, orderedIds);
        this.save();
        this._rerender();
    },

    // Nudge a task up/down by `delta` (keyboard reordering via the drag handle).
    // Returns true if it moved, so the caller can keep focus on the handle.
    moveTask(id, delta) {
        const arr = this.state.todos;
        const i = arr.findIndex(t => t.id === id);
        if (i === -1) return false;
        const j = i + delta;
        if (j < 0 || j >= arr.length) return false;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        this.save();
        this._rerender();
        return true;
    },

    // Nudge a subtask up/down by `delta` within its parent.
    moveSubtask(parentId, subId, delta) {
        const parent = this._find(parentId);
        if (!parent) return false;
        const arr = parent.subtasks;
        const i = arr.findIndex(s => s.id === subId);
        if (i === -1) return false;
        const j = i + delta;
        if (j < 0 || j >= arr.length) return false;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        this.save();
        this._rerender();
        return true;
    },

    _rerender() {
        if (window.UIRenderer) {
            // Prefer the scoped To-Do re-render when the rendering agent has added
            // it; fall back to a full render so the call is always safe.
            UIRenderer.renderTodoCard ? UIRenderer.renderTodoCard() : UIRenderer.render();
            UIRenderer.refreshArchiveViews?.();
        }
    }
};

window.TodoManager = TodoManager;
