// ==========================================
// UI Renderer Module - To-Do (part 10.2 of the renderer family)
// Extends UIRenderer (scripts/10-renderer.js) with the To-Do card.
// Must load after 10-renderer.js.
// ==========================================

Object.assign(UIRenderer, {
    // ========================================
    // TO-DO SECTION
    // ========================================

    createTodoSection() {
        const tm = window.TodoManager;
        const todos = tm?.getTodos() || [];
        const remaining = tm?.remainingCount() || 0;
        const addOpen = this._todoAddOpen || (this._todoAddOpen = new Set());
        const collapsed = this._todoCollapsed || (this._todoCollapsed = new Set());

        const itemsHTML = todos.map(task => {
            const pSafe = Utils.sanitizeHTML(task.id);
            const pName = Utils.sanitizeHTML(task.text || '(untitled task)');
            const subsHTML = task.subtasks.map(sub => this._renderTodoItem(sub, task.id)).join('');
            // The add-subtask field is hidden until the user opens it with the + button.
            const subAddHTML = addOpen.has(task.id)
                ? `<input type="text" class="todo-subadd" data-todo-action="add-sub"
                          data-id="${pSafe}" placeholder="+ Add subtask" aria-label="Add subtask to ${pName}">`
                : '';
            // Collapse only has meaning while there are subtasks to hide; a task
            // whose last subtask was deleted renders expanded again without its
            // stale Set entry needing cleanup.
            const isCollapsed = collapsed.has(task.id) && task.subtasks.length > 0;
            return `
                <div class="todo-row${isCollapsed ? ' collapsed' : ''}" data-id="${pSafe}">
                    ${this._renderTodoItem(task, null, isCollapsed ? task.subtasks.length : 0)}
                    <div class="todo-subs">
                        ${subsHTML}
                        ${subAddHTML}
                    </div>
                </div>`;
        }).join('');

        const emptyHTML = todos.length === 0
            ? '<div class="todo-empty">No tasks yet — add one below.</div>'
            : '';

        const todoLayout = this._getCardLayout('__todo__');

        return `
            <div class="app-group virtual-group todo-group"
                 data-group-id="__todo__"
                 data-card-width="${todoLayout.width}"
                 style="--card-tint: rgba(156, 39, 176, 0.18);">
                <div class="group-header">
                    <div class="group-title-container">
                        <div class="group-title has-ico"><svg class="ico" aria-hidden="true"><use href="#ico-note"></use></svg> To-Do <span class="group-count">(${remaining})</span></div>
                    </div>
                    <div class="group-actions">
                        ${this._cardWidthButton('__todo__')}
                        <button type="button" class="group-action-btn todo-archive-btn" data-todo-action="open-archive"
                                title="View archive (deleted & done)" aria-label="View archive — deleted and done items"><svg class="ico" aria-hidden="true"><use href="#ico-archive"></use></svg></button>
                    </div>
                </div>
                <div class="todo-list">
                    ${emptyHTML}
                    ${itemsHTML}
                    <input type="text" class="todo-add" data-todo-action="add-task"
                           placeholder="+ Add a task" aria-label="Add a task">
                </div>
                ${this._cardResizeHandle('__todo__')}
            </div>
        `;
    },

    // Fold/unfold one task's subtask list. Shared by the row's chevron button
    // and the double-click gesture; a no-op for tasks without subtasks.
    _toggleTodoCollapse(id, { refocusBtn = false } = {}) {
        const task = TodoManager._find(id);
        if (!task || task.subtasks.length === 0) return;
        const set = this._todoCollapsed || (this._todoCollapsed = new Set());
        set.has(id) ? set.delete(id) : set.add(id);
        if (refocusBtn) this._pendingTodoFocus = { action: 'collapse', id };
        this.renderTodoCard();
    },

    // Render a single task or subtask row. `parentId` is null for top-level
    // tasks. `hiddenSubCount` > 0 marks a collapsed task and puts a "▸ N" chip
    // on the row so the hidden subtasks aren't mistaken for deleted ones.
    _renderTodoItem(task, parentId, hiddenSubCount = 0) {
        const tm = window.TodoManager;
        const isSub = parentId !== null && parentId !== undefined;
        const ids = isSub
            ? `data-id="${Utils.sanitizeHTML(parentId)}" data-sub="${Utils.sanitizeHTML(task.id)}"`
            : `data-id="${Utils.sanitizeHTML(task.id)}"`;

        const urgency = tm.URGENCY_LEVELS.includes(task.urgency) ? task.urgency : 'tbd';
        const urgencyLabel = tm.URGENCY_LABELS[urgency];
        const overdue = task.dueDate && !task.done && task.dueDate < tm.todayStr() ? 'overdue' : '';
        const safeText = Utils.sanitizeHTML(task.text);
        // Accessible name for each row's controls, so screen-reader users can tell
        // otherwise-identical rows apart. Falls back to a generic noun when empty.
        const kind = isSub ? 'subtask' : 'task';
        const name = Utils.sanitizeHTML(task.text || `(untitled ${kind})`);
        // Only top-level tasks can have subtasks (one level deep), so the + button
        // is omitted on subtask rows. It toggles that task's add-subtask field.
        const addOpen = this._todoAddOpen?.has(task.id) ? 'true' : 'false';
        const addSubBtn = isSub ? '' : `
                <button type="button" class="todo-addsub-btn" data-todo-action="add-sub-toggle" ${ids}
                        title="Add subtask" aria-label="Add subtask to ${name}" aria-expanded="${addOpen}">+</button>`;

        // Drag handle: pointer-drags to reorder, or focus it and use ↑/↓ keys.
        // The grip glyph itself is decorative; the button carries the label.
        const dragHandle = `
                <button type="button" class="todo-drag-handle" data-todo-action="drag" ${ids}
                        title="Drag to reorder (or use ↑/↓ keys)"
                        aria-label="Reorder ${name}. Use Arrow Up and Arrow Down to move."><span aria-hidden="true">⠿</span></button>`;

        // Chevron right of the grip: folds/unfolds the subtask list — the
        // button twin of the double-click gesture (and the keyboard path to
        // it). While collapsed the button also carries the hidden-subtask
        // count, so one control says both "folded" and "how many". Every
        // top-level row renders one, but a row with no subtasks keeps only an
        // invisible disabled copy so the text column stays aligned across rows.
        const isCollapsed = hiddenSubCount > 0;
        const hasSubs = !isSub && task.subtasks.length > 0;
        const countHTML = isCollapsed
            ? `<span class="todo-collapse-count" aria-hidden="true">${hiddenSubCount}</span>`
            : '';
        const collapseBtn = isSub ? '' : `
                <button type="button" class="todo-collapse-btn${isCollapsed ? ' is-collapsed' : ''}" data-todo-action="collapse-toggle" ${ids}
                        ${hasSubs ? '' : 'disabled tabindex="-1"'} aria-expanded="${isCollapsed ? 'false' : 'true'}"
                        title="${isCollapsed ? `Expand ${hiddenSubCount} hidden subtask${hiddenSubCount === 1 ? '' : 's'}` : 'Collapse subtasks'}"
                        aria-label="${isCollapsed ? `Expand ${hiddenSubCount} hidden subtask${hiddenSubCount === 1 ? '' : 's'} of ${name}` : `Collapse subtasks of ${name}`}"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-chevron"></use></svg>${countHTML}</button>`;

        // ---- Schedule control (due date + repeat) ----
        // A single compact button replaces the old inline date field and the
        // recurrence pill: it shows the due date (and a small ⟳ when the task
        // repeats) and opens the schedule modal where both are edited. This keeps
        // the row uncluttered — nothing extra shows for the common no-repeat case.
        const recur = task.recur || 'none';
        const hasRecur = recur !== 'none';
        const recurLabel = tm.RECUR_LABELS?.[recur] ?? recur;
        const dateText = task.dueDate ? this._formatTodoDate(task.dueDate) : '';
        const scheduleAria = (task.dueDate
            ? `Schedule for ${name}: due ${dateText}`
            : `Schedule for ${name}: no due date`)
            + (hasRecur ? `, repeats ${recurLabel}` : '')
            + '. Activate to edit.';
        const dateFace = task.dueDate
            ? `<span class="ts-date">${Utils.sanitizeHTML(dateText)}</span>`
            : `<span class="ts-date ts-empty" aria-hidden="true"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-calendar"></use></svg></span>`;
        const recurChip = hasRecur
            ? `<span class="ts-recur recur-${Utils.sanitizeHTML(recur)}" aria-hidden="true" title="Repeats ${Utils.sanitizeHTML(recurLabel)}"><svg class="ico ico-sm" aria-hidden="true"><use href="#ico-refresh"></use></svg></span>`
            : '';
        const scheduleBtn = `
                <button type="button" class="todo-schedule-btn ${overdue}${hasRecur ? ' has-recur' : ''}" data-todo-action="schedule" ${ids}
                        title="Due date & repeat — click to edit"
                        aria-label="${scheduleAria}">${dateFace}${recurChip}</button>`;

        // The text field is a <textarea>, not a text input, so a long task wraps
        // onto a second line instead of scrolling out of sight sideways. It is
        // written one row tall and _fitTodoText grows it to at most two; past
        // that the text is clipped. Enter still commits the edit (the keydown
        // handler blurs it), so no newline can be typed into a task. The value
        // is element content here, not an attribute — nothing may sit between
        // the tag's ">" and safeText or it would become leading whitespace.
        return `
            <div class="todo-item ${isSub ? 'todo-sub' : ''} ${task.done ? 'done' : ''}" ${ids}>
                ${dragHandle}${collapseBtn}
                ${(() => {
                    // Done items wear a progress ring around the check: the arc
                    // sweeps the DONE_ARCHIVE_DELAY_MS window, and a closed loop
                    // means the sweep is about to file the item away. The CSS
                    // animation runs the window client-side; a negative delay
                    // phases it to the true elapsed time so re-renders (and
                    // reloads) resume mid-arc instead of restarting. The static
                    // --done-progress is the reduced-motion fallback, where the
                    // animation is disabled and the ring only steps on renders.
                    let ring = '';
                    if (task.done && typeof task.doneAt === 'number') {
                        const total = tm.DONE_ARCHIVE_DELAY_MS / 1000;
                        const elapsed = Math.max(0, Math.min(total, (Date.now() - task.doneAt) / 1000));
                        ring = ` style="--done-ring-dur:${total}s; --done-ring-delay:-${elapsed.toFixed(1)}s; --done-progress:${(elapsed / total).toFixed(4)}"`;
                    }
                    return `<button type="button" class="todo-done-btn" data-todo-action="toggle" ${ids}${ring}
                        aria-pressed="${task.done}" title="${task.done ? 'Mark not done' : 'Mark done'}"
                        aria-label="${task.done ? 'Mark not done' : 'Mark done'}: ${name}"><svg class="ico" aria-hidden="true"><use href="#ico-check-bold"></use></svg></button>`;
                })()}
                <textarea class="todo-text" data-todo-action="text" ${ids} rows="1"
                       placeholder="${isSub ? 'Subtask' : 'Task'}…" aria-label="${isSub ? 'Subtask' : 'Task'} text"
                       >${safeText}</textarea>
                <button type="button" class="todo-urgency urg-${urgency}" data-todo-action="urgency" ${ids}
                        title="Urgency: ${urgencyLabel} — click to change"
                        aria-label="Urgency for ${name}: ${urgencyLabel}. Activate to change.">${urgencyLabel}</button>
                ${scheduleBtn}${addSubBtn}
                <button type="button" class="todo-del" data-todo-action="del" ${ids}
                        title="Delete" aria-label="Delete ${name}">×</button>
            </div>
        `;
    },

    // Short human label for a YYYY-MM-DD due date shown on the schedule button.
    // Parses the parts directly (no timezone shift) and adds the year only when
    // it isn't the current year, to keep the chip compact.
    _formatTodoDate(dateStr) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
        if (!m) return dateStr || '';
        const d = new Date(+m[1], +m[2] - 1, +m[3]);
        if (isNaN(d)) return dateStr;
        const opts = { month: 'short', day: 'numeric' };
        if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
        return d.toLocaleDateString('en-US', opts);
    },

    // Schedule modal for one task/subtask: edit the due date AND the repeat
    // cadence in one place (the row only triggers this, keeping it uncluttered).
    // Mirrors the calendar-event modal: dynamic build, focus trap, Escape, and
    // backdrop close. Changes apply live — they re-render the card underneath
    // while this modal (on document.body) stays open.
    _openTodoSchedule(id, subId) {
        const tm = window.TodoManager;
        const item = tm?._resolve(id, subId);
        if (!item) return;

        const name = Utils.sanitizeHTML(item.text || 'this task');
        const dueVal = item.dueDate ? Utils.sanitizeHTML(item.dueDate) : '';
        const levels = tm.RECUR_LEVELS || ['none', 'daily', 'weekly', 'monthly'];
        const labels = tm.RECUR_LABELS || { none: 'No repeat', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
        const curRecur = levels.includes(item.recur) ? item.recur : 'none';

        const repeatBtns = levels.map(lv => `
            <button type="button" class="todo-recur-opt recur-${lv}${lv === curRecur ? ' selected' : ''}"
                    data-recur="${lv}" aria-pressed="${lv === curRecur ? 'true' : 'false'}">${Utils.sanitizeHTML(labels[lv] ?? lv)}</button>`).join('');

        document.getElementById('todoScheduleModal')?.remove();

        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'todoScheduleModal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'todoScheduleTitle');
        modal.innerHTML = `
            <div class="modal-content todo-schedule-content">
                <div class="modal-header">
                    <h2 id="todoScheduleTitle" class="has-ico"><svg class="ico" aria-hidden="true"><use href="#ico-calendar-days"></use></svg> Schedule</h2>
                    <button class="close-modal" id="closeTodoSchedule" aria-label="Close">×</button>
                </div>
                <div class="todo-schedule-body">
                    <p class="todo-schedule-name">${name}</p>
                    <div class="todo-schedule-field">
                        <label for="todoScheduleDate" class="todo-schedule-legend">Due date</label>
                        <div class="todo-schedule-date-row">
                            <input type="date" id="todoScheduleDate" class="todo-schedule-date" value="${dueVal}">
                            <button type="button" id="todoScheduleToday" class="todo-schedule-today">Today</button>
                            <button type="button" id="todoScheduleClear" class="todo-schedule-clear">Clear</button>
                        </div>
                    </div>
                    <div class="todo-schedule-field">
                        <span class="todo-schedule-legend">Repeat</span>
                        <div class="todo-schedule-repeat" role="group" aria-label="Repeat cadence">
                            ${repeatBtns}
                        </div>
                    </div>
                    <p class="todo-schedule-hint">Completing a repeating task moves its due date to the next occurrence.</p>
                    <div class="todo-schedule-actions">
                        <button type="button" class="todo-schedule-done" id="todoScheduleDone">Done</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);

        const close = () => {
            Utils.releaseFocus(modal, this._todoScheduleTrap);
            this._todoScheduleTrap = null;
            modal.remove();
            // The row was re-rendered by the live edits, so re-query the live
            // schedule button to restore focus to it.
            const sel = subId
                ? `.todo-schedule-btn[data-id="${CSS.escape(id)}"][data-sub="${CSS.escape(subId)}"]`
                : `.todo-schedule-btn[data-id="${CSS.escape(id)}"]:not([data-sub])`;
            document.querySelector(sel)?.focus();
        };

        // Due date — apply on change; "Clear" removes it.
        const dateInput = modal.querySelector('#todoScheduleDate');
        dateInput.addEventListener('change', () => {
            TodoManager.setDueDate(id, subId, dateInput.value || null);
        });
        modal.querySelector('#todoScheduleToday').addEventListener('click', () => {
            const today = TodoManager.todayStr();
            dateInput.value = today;
            TodoManager.setDueDate(id, subId, today);
        });
        modal.querySelector('#todoScheduleClear').addEventListener('click', () => {
            dateInput.value = '';
            TodoManager.setDueDate(id, subId, null);
        });

        // Repeat cadence — apply on click, reflect the selection in place.
        modal.querySelectorAll('.todo-recur-opt').forEach(btn => {
            btn.addEventListener('click', () => {
                TodoManager.setRecur(id, subId, btn.dataset.recur);
                modal.querySelectorAll('.todo-recur-opt').forEach(b => {
                    const on = b === btn;
                    b.classList.toggle('selected', on);
                    b.setAttribute('aria-pressed', on ? 'true' : 'false');
                });
            });
        });

        modal.querySelector('#closeTodoSchedule').addEventListener('click', close);
        modal.querySelector('#todoScheduleDone').addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

        this._todoScheduleTrap = Utils.trapFocus(modal);
    },

    // Delegated handlers for every To-Do interaction. Attached once to the main
    // container (whose innerHTML is replaced on each render).
    _attachTodoHandlers(container) {
        const ids = (el) => ({ id: el.dataset.id, sub: el.dataset.sub || null });

        container.addEventListener('change', (e) => {
            const el = e.target.closest('[data-todo-action]');
            if (!el) return;
            const action = el.dataset.todoAction;
            const { id, sub } = ids(el);
            if (action === 'text') {
                TodoManager.setText(id, sub, el.value);
            }
            // Note: the due date is set inside the schedule modal (see
            // _openTodoSchedule), not from an inline row field anymore.
        });

        container.addEventListener('click', (e) => {
            const el = e.target.closest('[data-todo-action]');
            if (!el) return;
            const action = el.dataset.todoAction;
            const { id, sub } = ids(el);
            if (action === 'toggle') {
                e.preventDefault();
                sub ? TodoManager.toggleSubtask(id, sub) : TodoManager.toggleTask(id);
            } else if (action === 'urgency') {
                e.preventDefault();
                TodoManager.cycleUrgency(id, sub);
            } else if (action === 'schedule') {
                e.preventDefault();
                this._openTodoSchedule(id, sub);
            } else if (action === 'del') {
                e.preventDefault();
                const item = TodoManager._resolve(id, sub);
                const label = item && item.text && item.text.trim()
                    ? `"${item.text.trim()}"`
                    : (sub ? 'this subtask' : 'this task');
                // Deleting only moves the item into the archive (kept for
                // TodoManager.ARCHIVE_TTL_DAYS days) — nothing is actually lost —
                // so a non-blocking undo toast replaces the old confirm() dialog,
                // matching the pattern already used for website/group deletes.
                // The archived entry keeps the same id as the live item, so Undo
                // can restore it directly from the archive. delete() returns
                // null when nothing was archived (an empty subtask just
                // disappears) — no toast then: there is nothing to undo.
                this._todoAddOpen?.delete(id);
                const archId = TodoManager.delete(id, sub);
                if (archId) {
                    UI.showUndoToast(`${label} deleted`, () => {
                        TodoManager.restoreFromArchive(archId);
                    });
                }
            } else if (action === 'add-sub-toggle') {
                e.preventDefault();
                const set = this._todoAddOpen || (this._todoAddOpen = new Set());
                if (set.has(id)) {
                    set.delete(id);
                } else {
                    set.add(id);
                    // The add field lives inside .todo-subs, which a collapsed
                    // task hides — opening it must expand the task or the focus
                    // restore below would target a display:none input.
                    this._todoCollapsed?.delete(id);
                    this._pendingTodoFocus = { action: 'add-sub', id };
                }
                this.renderTodoCard();
            } else if (action === 'collapse-toggle') {
                e.preventDefault();
                // Keep focus on the chevron across the re-render so the fold
                // can be worked entirely from the keyboard.
                this._toggleTodoCollapse(id, { refocusBtn: true });
            } else if (action === 'open-archive') {
                e.preventDefault();
                this.openTodoArchive();
            }
        });

        // Double-click on a task row folds/unfolds its subtask list. Top-level
        // tasks only (subtasks have nothing to fold), and never from the row's
        // controls — a double-click on a button is just two clicks, and on the
        // text field it is word-select (any selection the browser makes there
        // is discarded with the field itself when the card re-renders).
        container.addEventListener('dblclick', (e) => {
            const item = e.target.closest('.todo-item');
            if (!item || item.classList.contains('todo-sub')) return;
            if (e.target.closest('button, input')) return;
            this._toggleTodoCollapse(item.dataset.id);
        });

        // Re-wrap the edited field as it's typed in — the row only re-renders on
        // commit (blur/Enter), so without this the field would stay at the row
        // count it had when the card was built.
        container.addEventListener('input', (e) => {
            const el = e.target.closest('.todo-text');
            if (el) this._fitTodoTextField(el);
        });

        container.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const el = e.target.closest('[data-todo-action]');
            if (!el) return;
            const action = el.dataset.todoAction;
            if (action === 'add-task') {
                e.preventDefault();
                TodoManager.addTask(el.value);
            } else if (action === 'add-sub') {
                e.preventDefault();
                TodoManager.addSubtask(el.dataset.id, el.value);
            } else if (action === 'text') {
                e.preventDefault();
                // Commit this row, then continue the list: a new empty row is
                // inserted directly below it and focused for immediate typing.
                // The commit must be explicit (not via blur) because the insert
                // re-renders the card, which would race the change event.
                const id = el.dataset.id;
                const sub = el.dataset.sub || null;
                TodoManager.setText(id, sub, el.value);
                sub ? TodoManager.insertSubtaskAfter(id, sub)
                    : TodoManager.insertTaskAfter(id);
            }
        });

        this._attachTodoDragHandlers(container);

        // Delegated handler for calendar event detail rows (item 13). Attached
        // once here alongside the other container-level handlers.
        container.addEventListener('click', (e) => {
            // Let the "Join" link open the call directly instead of the detail modal.
            if (e.target.closest('[data-cal-join]')) return;
            const row = e.target.closest('[data-cal-event="1"]');
            if (row) { e.preventDefault(); this._openCalendarEventDetail(row); }
        });
        container.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (e.target.closest('[data-cal-join]')) return; // activate the Join link itself
            const row = e.target.closest('[data-cal-event="1"]');
            if (row) { e.preventDefault(); this._openCalendarEventDetail(row); }
        });

        // Archive actions and closing the archive modal live outside this
        // container (in the modal / Settings tab), so own them here from the
        // document. This handler is attached once and is in the same module as
        // openTodoArchive, so closing never depends on separate wiring.
        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-todo-arch-action]');
            if (el) {
                const action = el.dataset.todoArchAction;
                const archId = el.dataset.archId;
                // Which archive the entry lives in ('deleted' | 'done') —
                // stamped on the buttons by _renderArchiveItem.
                const src = el.dataset.archSrc === 'done' ? 'done' : 'deleted';
                if (action === 'restore') {
                    TodoManager.restoreFromArchive(archId, src);
                } else if (action === 'del-forever') {
                    if (window.confirm('Permanently delete this archived item? This cannot be undone.')) {
                        TodoManager.deleteFromArchive(archId, src);
                    }
                } else if (action === 'close') {
                    this.closeTodoArchive();
                }
                return;
            }
            const tab = e.target.closest('#todoArchTabs .changelog-tab');
            if (tab) { this.showTodoArchiveTab(tab.dataset.tab); return; }
            // Click on the modal backdrop (outside the content) closes it.
            if (e.target.id === 'todoArchiveModal') this.closeTodoArchive();
        });

        // Arrow-key roving between the two archive tabs, same pattern as the
        // changelog tablist (3-app-init.js).
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const tab = e.target.closest?.('#todoArchTabs .changelog-tab');
            if (!tab) return;
            e.preventDefault();
            const next = tab.dataset.tab === 'deleted' ? 'done' : 'deleted';
            this.showTodoArchiveTab(next);
            document.getElementById(next === 'done' ? 'todoArchTabDone' : 'todoArchTabDeleted')?.focus();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const modal = document.getElementById('todoArchiveModal');
            if (modal && modal.classList.contains('show')) this.closeTodoArchive();
        });
    },

    // Drag-and-drop (and keyboard) reordering for tasks and subtasks. Attached
    // once alongside the other To-Do handlers. A task is the whole `.todo-row`
    // (so its subtasks travel with it); a subtask is its own `.todo-item.todo-sub`
    // and can only be reordered within its parent's `.todo-subs`.
    _attachTodoDragHandlers(container) {
        // Find the row to insert a dragged element before, based on pointer Y:
        // the first sibling whose vertical midpoint is below the cursor.
        const dragAfter = (siblings, y) => {
            let closest = null;
            let closestOffset = Number.NEGATIVE_INFINITY;
            for (const el of siblings) {
                if (el.classList.contains('dragging')) continue;
                const box = el.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;
                if (offset < 0 && offset > closestOffset) {
                    closestOffset = offset;
                    closest = el;
                }
            }
            return closest;
        };

        const disarm = () => {
            if (this._todoArmedDrag) {
                this._todoArmedDrag.removeAttribute('draggable');
                this._todoArmedDrag = null;
            }
        };

        // HTML5 drag only fires from a draggable element, but making each row
        // permanently draggable would block text selection in its inputs. So arm
        // `draggable` only while the pointer is pressed on the grip handle.
        container.addEventListener('mousedown', (e) => {
            const handle = e.target.closest('.todo-drag-handle');
            if (!handle) return;
            const dragEl = handle.closest('.todo-item.todo-sub')
                || handle.closest('.todo-row');
            if (!dragEl) return;
            dragEl.setAttribute('draggable', 'true');
            this._todoArmedDrag = dragEl;
        });
        document.addEventListener('mouseup', disarm);

        container.addEventListener('dragstart', (e) => {
            // Only handle drags armed via a To-Do grip (mousedown set _todoArmedDrag).
            // Other draggables in this container (website cards) leave it null, so we
            // ignore them here. The dragstart target is the row itself, not the grip.
            const dragEl = this._todoArmedDrag;
            if (!dragEl || e.target !== dragEl) return;
            this._todoDragEl = dragEl;
            this._todoDragKind = dragEl.classList.contains('todo-sub') ? 'sub' : 'task';
            dragEl.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            // Firefox needs data set for a drag to start.
            try { e.dataTransfer.setData('text/plain', dragEl.dataset.id || ''); } catch (_) {}
        });

        container.addEventListener('dragover', (e) => {
            const dragEl = this._todoDragEl;
            if (!dragEl) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (this._todoDragKind === 'task') {
                const list = dragEl.parentElement; // .todo-list
                const rows = list.querySelectorAll(':scope > .todo-row');
                const after = dragAfter(rows, e.clientY);
                if (after) list.insertBefore(dragEl, after);
                else list.insertBefore(dragEl, list.querySelector('.todo-add'));
            } else {
                // Subtask: reorder only within its own parent's list, never across.
                const subs = dragEl.parentElement; // .todo-subs
                const items = subs.querySelectorAll(':scope > .todo-item.todo-sub');
                const after = dragAfter(items, e.clientY);
                if (after) subs.insertBefore(dragEl, after);
                else subs.insertBefore(dragEl, subs.querySelector('.todo-subadd'));
            }
        });

        // Allow drop without the browser's "snap-back" animation.
        container.addEventListener('drop', (e) => {
            if (this._todoDragEl) e.preventDefault();
        });

        // Commit the new DOM order back to the data model (which re-renders).
        container.addEventListener('dragend', () => {
            const dragEl = this._todoDragEl;
            if (!dragEl) { disarm(); return; }
            dragEl.classList.remove('dragging');
            if (this._todoDragKind === 'task') {
                const list = dragEl.parentElement;
                const ids = [...list.querySelectorAll(':scope > .todo-row')].map(r => r.dataset.id);
                this._todoDragEl = null;
                this._todoDragKind = null;
                disarm();
                TodoManager.reorderTasks(ids);
            } else {
                const subs = dragEl.parentElement;
                const parentId = dragEl.dataset.id;
                const ids = [...subs.querySelectorAll(':scope > .todo-item.todo-sub')]
                    .map(el => el.dataset.sub);
                this._todoDragEl = null;
                this._todoDragKind = null;
                disarm();
                TodoManager.reorderSubtasks(parentId, ids);
            }
        });

        // Keyboard reordering: focus a grip handle and press ↑/↓.
        container.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            const handle = e.target.closest('.todo-drag-handle');
            if (!handle) return;
            e.preventDefault();
            const delta = e.key === 'ArrowUp' ? -1 : 1;
            const id = handle.dataset.id;
            const sub = handle.dataset.sub || null;
            // Set the focus target first: the move re-renders synchronously and
            // consumes _pendingTodoFocus during that render. Clear it if no move
            // happened (already at an end) so it can't leak to a later render.
            this._pendingTodoFocus = { action: 'reorder', id, sub };
            const moved = sub
                ? TodoManager.moveSubtask(id, sub, delta)
                : TodoManager.moveTask(id, delta);
            if (!moved) this._pendingTodoFocus = null;
        });
    },

    // ---- To-Do archive views (shared by the header modal and Settings tab) ----

    openTodoArchive() {
        const modal = document.getElementById('todoArchiveModal');
        if (!modal) return;
        this.renderTodoArchive(document.getElementById('todoArchiveModalBody'));
        modal.classList.add('show');
        this._archiveFocusTrap = Utils.trapFocus(modal);
    },

    closeTodoArchive() {
        const modal = document.getElementById('todoArchiveModal');
        if (!modal) return;
        Utils.releaseFocus(modal, this._archiveFocusTrap);
        this._archiveFocusTrap = null;
        modal.classList.remove('show');
    },

    // Re-render whichever archive views are currently visible. This is called
    // from every TodoManager._rerender(), which since v4.27 includes the 60s
    // done-sweep timer and cross-tab storage events — so it must never move
    // focus unless the render itself detached the focused control.
    refreshArchiveViews() {
        const modal = document.getElementById('todoArchiveModal');
        if (modal && modal.classList.contains('show')) {
            const hadFocus = modal.contains(document.activeElement);
            this.renderTodoArchive(document.getElementById('todoArchiveModalBody'));
            // No trap rebuild: only the panels' innerHTML was replaced, the
            // trap's handler lives on the modal and re-queries focusables per
            // Tab (Utils.trapFocus), and a rebuild would re-run the initial
            // focus() — yanking focus on every background refresh.
            // But if the focused control itself was rebuilt away (e.g. the
            // Restore button just clicked), focus fell to <body>, outside the
            // trap — land on the active tab so keyboard flow stays inside.
            if (hadFocus && !modal.contains(document.activeElement)) {
                modal.querySelector('#todoArchTabs .changelog-tab.active')?.focus();
            }
        }
        // The Settings copy is rendered fresh by openSettings(); repainting it
        // while that modal is closed is pure waste on a 60s timer.
        const settingsBody = document.getElementById('todoArchiveSettings');
        const settingsModal = document.getElementById('settingsModal');
        if (settingsBody && settingsModal?.classList.contains('show')) {
            this.renderTodoArchive(settingsBody, 'h4');
        }
    },

    // Flip the archive modal between its Deleted and Done panels — the same
    // moves as AppInit.showChangelogTab, scoped to this modal's tablist.
    showTodoArchiveTab(name) {
        document.querySelectorAll('#todoArchTabs .changelog-tab').forEach(tab => {
            const on = tab.dataset.tab === name;
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-selected', String(on));
        });
        document.querySelectorAll('#todoArchiveModalBody .todo-archive-panel').forEach(panel => {
            panel.hidden = panel.dataset.tab !== name;
            if (!panel.hidden) panel.scrollTop = 0;
        });
    },

    // Renders BOTH archives (deleted + done) into whichever surface `container`
    // is: the modal body (which carries the two tab panels — each archive goes
    // into its own) or the Settings → To-Do container (no tabs; both sections
    // stacked, `headingLevel` keeping the outline flat under the tab's h3).
    renderTodoArchive(container, headingLevel = 'h3') {
        if (!container) return;
        const tm = window.TodoManager;
        const ttl = tm?.ARCHIVE_TTL_DAYS ?? 14;
        const deleted = tm?.getArchive() || [];
        const done = tm?.getDoneArchive() || [];

        const list = (items, src, emptyText) => items.length === 0
            ? `<div class="todo-empty">${emptyText}</div>`
            : items.map(a => this._renderArchiveItem(a, src)).join('');
        const emptyDeleted = `No deleted items. Deleted tasks are kept here for ${ttl} days.`;
        const emptyDone = `No completed items. Done tasks land here 10 minutes after being checked off and stay for ${ttl} days.`;

        const delPanel = container.querySelector('#todoArchPanelDeleted');
        const donePanel = container.querySelector('#todoArchPanelDone');
        if (delPanel && donePanel) {
            delPanel.innerHTML = list(deleted, 'deleted', emptyDeleted);
            donePanel.innerHTML = list(done, 'done', emptyDone);
            const chip = (id, n) => {
                const el = document.getElementById(id)?.querySelector('.changelog-tab-count');
                if (el) el.textContent = n ? String(n) : '';
            };
            chip('todoArchTabDeleted', deleted.length);
            chip('todoArchTabDone', done.length);
            return;
        }

        const tag = headingLevel === 'h4' ? 'h4' : 'h3';
        const section = (title, items, src, emptyText) => `
            <div class="todo-archive-section">
                <${tag} class="todo-archive-heading">${title} <span class="group-count">(${items.length})</span></${tag}>
                ${list(items, src, emptyText)}
            </div>`;
        container.innerHTML =
            section('Deleted', deleted, 'deleted', emptyDeleted) +
            section('Done', done, 'done', emptyDone);
    },

    _renderArchiveItem(a, src = 'deleted') {
        const tm = window.TodoManager;
        const safeId = Utils.sanitizeHTML(a.id);
        const name = Utils.sanitizeHTML(a.text || '(untitled task)');
        const urgency = tm.URGENCY_LEVELS.includes(a.urgency) ? a.urgency : 'tbd';
        const urgencyLabel = tm.URGENCY_LABELS[urgency];
        const days = tm.daysUntilPurge(tm.archiveStamp(a));

        const meta = [`<span class="todo-urgency urg-${urgency}">${urgencyLabel}</span>`];
        if (a.isSub) {
            const parent = Utils.sanitizeHTML(a.parentText || '(untitled task)');
            meta.push(`<span class="todo-archive-parent">subtask of "${parent}"</span>`);
        }
        if (a.dueDate) meta.push(`<span class="todo-archive-due">Due ${Utils.sanitizeHTML(a.dueDate)}</span>`);
        meta.push(`<span class="todo-archive-purge">purges in ${days} day${days === 1 ? '' : 's'}</span>`);

        const subs = Array.isArray(a.subtasks) && a.subtasks.length
            ? `<ul class="todo-archive-subs">${a.subtasks.map(s =>
                  `<li class="${s.done ? 'done' : ''}">${Utils.sanitizeHTML(s.text || '(untitled subtask)')}</li>`).join('')}</ul>`
            : '';

        return `
            <div class="todo-archive-item ${a.done ? 'done' : ''}">
                <div class="todo-archive-main">
                    <div class="todo-archive-title">${name}</div>
                    <div class="todo-archive-meta">${meta.join('')}</div>
                    ${subs}
                </div>
                <div class="todo-archive-actions">
                    <button type="button" class="todo-archive-action restore" data-todo-arch-action="restore"
                            data-arch-id="${safeId}" data-arch-src="${src}"
                            aria-label="${src === 'done' ? `Return ${name} to To-Do` : `Restore ${name}`}">${src === 'done' ? 'Return to To-Do' : 'Restore'}</button>
                    <button type="button" class="todo-archive-action del-forever" data-todo-arch-action="del-forever"
                            data-arch-id="${safeId}" data-arch-src="${src}"
                            aria-label="Delete ${name} forever">Delete forever</button>
                </div>
            </div>
        `;
    },

    updateIconSizes() {
        document.documentElement.style.setProperty('--icon-size', `${AppState.iconSize}px`);
        const cardSize = parseInt(AppState.iconSize) + 60;
        document.documentElement.style.setProperty('--card-size', `${cardSize}px`);
        const gap = Math.max(8, Math.round(AppState.iconSize * 0.2)) + 5;
        document.documentElement.style.setProperty('--card-gap', `${gap}px`);
        this.matchCalendarHeight();
    },

    // Dynamically set calendar events container height. A hand-dragged height
    // wins outright; otherwise 'auto' mode aligns with the first 2 groups in the
    // right column, and any other setting is a multiplier that sets the card
    // height to that many single-row card heights.
    matchCalendarHeight() {
        const calendarGroup = document.querySelector('.calendar-group');
        const eventsContainer = calendarGroup?.querySelector('.calendar-events-container');
        if (!calendarGroup || !eventsContainer) return;

        // Never fight an in-flight drag: the stored height is still the
        // pre-drag value, so applying it here would snap the card back out
        // from under the pointer. Checked before anything else so a drag really
        // is a no-op here, ticker measurement included.
        if (this._cardDragActive() && this._cardResize.id === '__calendar__') return;

        // Size the upcoming-event ticker here too — this runs on every card render
        // path and on the debounced window resize.
        this._sizeUpcomingTicker(calendarGroup);

        this._applyCalendarHeight(calendarGroup, eventsContainer);

        // Retunes the hour-row height to whatever room the height ladder
        // above just gave the card — depends on that box already being
        // definite, so it has to run after, not before.
        this._sizeTimelineHours();

        // Sized once here rather than at each return below: several of those
        // exits are early (too few columns to measure against), and skipping
        // the sync there left the grip reporting a stale height to assistive
        // tech — it claimed the card was at its minimum when it wasn't.
        this._syncResizeHandleValue(calendarGroup);
    },

    // The height ladder itself: manual > 'auto' (match the two cards alongside)
    // > multiplier. Split out so every exit path gets the sync above.
    _applyCalendarHeight(calendarGroup, eventsContainer) {
        // A height dragged onto the card overrides both 'auto' and the
        // multiplier. Clearing it (Home on the grip, or moving the settings
        // slider) hands control back to the branches below.
        const manual = this._getCardLayout('__calendar__').height;
        if (manual != null) {
            // This path doesn't go through _clearCardHeightPx, so a minHeight
            // left behind by a previous automatic pass (below) needs clearing
            // by hand — otherwise it would stop a smaller dragged height from
            // ever taking effect.
            eventsContainer.style.minHeight = '';
            this._applyCardHeightPx(calendarGroup, manual);
            return;
        }

        // No manual height in play — drop anything a previous drag left behind
        // so the automatic sizing below is what actually takes effect.
        this._clearCardHeightPx(eventsContainer);

        const heightSetting = window.CalendarManager?.getHeight?.() || 'auto';

        let targetHeight;
        if (heightSetting === 'auto') {
            // 'Auto' means "as tall as the two cards beside me", which has no
            // meaning once the calendar is a full-width band outside the grid —
            // let the stylesheet's default height stand instead.
            if (calendarGroup.dataset.cardWidth === 'full') {
                this._pinTimelineFallbackMinHeight(eventsContainer);
                return;
            }
            // Measure combined height of first 2 right-column groups + gap
            // between them. The bails fall back to the same stylesheet cap as
            // the full-width branch, so they need the same minHeight pin — or
            // a timeline there shrink-wraps and sits pinned at TL_HOUR_MIN.
            const columns = document.querySelectorAll('.groups-column');
            if (columns.length < 2) { this._pinTimelineFallbackMinHeight(eventsContainer); return; }
            const col2 = columns[1];
            const col2Groups = col2.querySelectorAll('.app-group');
            if (col2Groups.length < 2) { this._pinTimelineFallbackMinHeight(eventsContainer); return; }
            const gap = parseFloat(getComputedStyle(col2).gap) || 0;
            targetHeight = col2Groups[0].offsetHeight + col2Groups[1].offsetHeight + gap;
        } else {
            // multiplier × one card-row pitch (card height + grid gap)
            const multiplier = parseFloat(heightSetting) || 2;
            const root = getComputedStyle(document.documentElement);
            const cardSize = parseFloat(root.getPropertyValue('--card-size')) || 180;
            const cardGap = parseFloat(root.getPropertyValue('--card-gap')) || 16;
            targetHeight = multiplier * (cardSize + cardGap);
        }

        // Subtract the calendar group's non-scrollable parts (header, padding, border)
        const minH = heightSetting === 'auto' ? 150 : 60;
        const maxH = Math.max(minH, targetHeight - this._cardOverhead(calendarGroup));
        eventsContainer.style.maxHeight = maxH + 'px';
        // max-height alone caps a box but doesn't give it a size — short
        // content still shrink-wraps, leaving a timeline (flex: 1 1 auto)
        // nothing to grow into. Pin minHeight to the same figure so the box
        // is definite; list mode has no such need and keeps shrink-to-content.
        if (eventsContainer.querySelector('.calendar-timeline')) {
            eventsContainer.style.minHeight = maxH + 'px';
        } else {
            eventsContainer.style.minHeight = '';
        }
    },

    // When the height ladder can't compute a target (full-width band, or too
    // few right-column groups to measure against), the stylesheet's 38vh
    // max-height is the fallback — a cap that doesn't reserve room, so a
    // timeline needs a matching minHeight or the flex chain shrink-wraps it
    // to whatever loaded first. List mode keeps shrink-to-content.
    _pinTimelineFallbackMinHeight(eventsContainer) {
        eventsContainer.style.minHeight =
            eventsContainer.querySelector('.calendar-timeline') ? '38vh' : '';
    },

    // Retune the timeline's hour-row height to whatever vertical room
    // _applyCalendarHeight just gave the card: clamp(available / spanHours,
    // TL_HOUR_MIN, TL_HOUR_MAX) px/hour. Within the clamps the grid exactly
    // fills the card (no scroll, no dead air); denser spans hit TL_HOUR_MIN
    // and scroll as today does; sparser spans hit TL_HOUR_MAX and leave calm
    // dead air below rather than stretching rows to fill it. Every timeline
    // position is a calc() fraction of --tl-gridh, so writing that one
    // variable rescales the whole grid coherently. One measurement pass, no
    // rebuild — the header row and all-day band are sized by their own
    // content, not by hour height, so nothing measured here feeds back into
    // what was just measured; a convergence loop would only be needed if it did.
    _sizeTimelineHours() {
        const tl = document.querySelector('.calendar-group .calendar-timeline');
        if (!tl) return; // list mode / chip day views have no timeline

        const spanMin = parseFloat(tl.dataset.spanMin);
        if (!(spanMin > 0)) return;

        // Room above the hour row is measured as the gutter's content offset,
        // not by summing the header/all-day cells: with align-items:start each
        // grid row track is as tall as its TALLEST cell, and the first cell is
        // not necessarily it (a wrapped "TODAY · MON 4 AUG" header, or an
        // all-day chip on day 3 only). The offset also folds in the row-gaps
        // and fractional heights an integer offsetHeight sum would round away.
        // clientHeight (not offsetHeight) excludes the horizontal scrollbar,
        // which would otherwise get counted as room for hour rows.
        const gutter = tl.querySelector('.cal-tl-gutter');
        if (!gutter) return;
        const gutterTop = gutter.getBoundingClientRect().top
            - tl.getBoundingClientRect().top + tl.scrollTop;
        // The last hour label centers on the grid's bottom edge via
        // translateY(-50%); without headroom for its lower half, an
        // exactly-fitted grid always overflows by half a line and shows a
        // pointless ~5px scroll range.
        const label = gutter.querySelector('.cal-tl-hour');
        const avail = tl.clientHeight - gutterTop - (label ? label.offsetHeight / 2 : 0);
        if (!(avail > 0)) return; // card is display:none or mid-teardown

        const spanHours = spanMin / 60;
        const hourH = Math.min(this.TL_HOUR_MAX, Math.max(this.TL_HOUR_MIN, avail / spanHours));
        tl.style.setProperty('--tl-gridh', (spanHours * hourH).toFixed(1) + 'px');
    },

    // To-Do has no automatic sizing mode — it is either the stylesheet default
    // (max-height: 60vh) or a height the user dragged onto it.
    matchTodoHeight() {
        const todoGroup = document.querySelector('.todo-group');
        const list = todoGroup?.querySelector('.todo-list');
        if (!todoGroup || !list) return;
        if (this._cardDragActive() && this._cardResize.id === '__todo__') return;

        // Row heights depend on how the task text wraps, so settle that first —
        // this runs on every path that re-evaluates the card's box (render,
        // scoped To-Do re-render, debounced window resize, font-size change).
        this._fitTodoText(todoGroup);

        const manual = this._getCardLayout('__todo__').height;
        if (manual == null) {
            this._clearCardHeightPx(list);
            this._syncResizeHandleValue(todoGroup);
            return;
        }
        this._applyCardHeightPx(todoGroup, manual);
    },

    // ---- To-Do text wrapping -------------------------------------------------
    // Task/subtask fields wrap and may take up to TODO_TEXT_MAX_ROWS lines; text
    // past that is clipped (CSS overflow) rather than shown. A textarea has no
    // content-driven auto-height in CSS, so the row count is set here.
    TODO_TEXT_MAX_ROWS: 2,

    _fitTodoText(scope) {
        (scope || document).querySelectorAll('.todo-text')
            .forEach(el => this._fitTodoTextField(el));
    },

    // Grow one field to the fewest rows that hold its text, capped at the max.
    // Counting rows (rather than measuring a pixel height) keeps this correct
    // under the card's font-size setting and its sub-1 `zoom` companion, whose
    // scaling would otherwise have to be undone by hand. scrollHeight and
    // clientHeight both include padding, so they compare directly; the 2px
    // tolerance absorbs sub-pixel line-height rounding on a field that really
    // does fit on one line.
    _fitTodoTextField(el) {
        if (!el) return;
        for (let rows = 1; rows <= this.TODO_TEXT_MAX_ROWS; rows++) {
            el.rows = rows;
            if (el.scrollHeight <= el.clientHeight + 2) return;
        }
    },

    // ---- Timeline scroll position -------------------------------------------
    // The hour-grid timeline scrolls internally, and every calendar re-render
    // (including the periodic background fetch) rebuilds it from scratch. Read
    // the outgoing scrollTop BEFORE the rebuild and hand it back to
    // _applyTimelineScroll afterwards, so a refresh never yanks the view out
    // from under someone who scrolled somewhere deliberately.
    _readTimelineScroll() {
        const tl = document.querySelector('.calendar-group .calendar-timeline');
        return tl ? tl.scrollTop : null;
    },

    // Give each timeline event block as many text lines as its pixel height allows,
    // so a tall block fills its height instead of truncating on one line. Block
    // heights are fixed (set inline from the event's duration), so CSS alone can't
    // do it — -webkit-line-clamp needs an integer line count. Measure one rendered
    // line from a hidden probe (the --cal-z-* zoom vars make rem math unreliable),
    // then set the clamp per block from its inline height. Setting the clamp never
    // changes a block's own height (its text is overflow-hidden inside a fixed box),
    // so this is safe to run before the scroll-anchoring math in _applyTimelineScroll.
    _fitTimelineEventText(timeline) {
        if (!timeline) return;
        const events = timeline.querySelectorAll('.cal-tl-event');
        if (!events.length) return;

        // One hidden probe carrying the real font/zoom cascade → one line's height.
        // position:absolute keeps it out of the grid flow; removed before it paints.
        const probe = document.createElement('div');
        probe.className = 'cal-tl-event';
        probe.style.cssText = 'position:absolute; visibility:hidden; pointer-events:none; top:0; left:0; width:120px; height:auto; min-height:0;';
        probe.innerHTML = '<span class="cal-tl-event-text"><span class="cal-tl-event-time">00–00</span><span class="cal-tl-event-title">Mg</span></span>';
        timeline.appendChild(probe);
        const probeText = probe.querySelector('.cal-tl-event-text');
        const lineH = probeText ? probeText.offsetHeight : 0;
        timeline.removeChild(probe);
        if (!lineH) return;

        // Block heights are calc() fractions of --tl-gridh, so the px value is
        // fraction × the variable's current value — recovered from the inline
        // style string rather than measured, keeping this loop free of
        // per-block layout (a rendered-height read per block would interleave
        // with the clamp writes below and force a reflow each iteration).
        const gridH = parseFloat(timeline.style.getPropertyValue('--tl-gridh')) || 0;
        const FRAC_RE = /var\(--tl-gridh\)\s*\*\s*([\d.]+)/;
        events.forEach(el => {
            const text = el.querySelector('.cal-tl-event-text');
            if (!text) return;
            // Minus 2px for the 1px top+bottom padding on .cal-tl-event. The
            // same 3px floor the inline max() applies; the stylesheet's 14px
            // min-height is deliberately ignored, as the old px parse was.
            const m = FRAC_RE.exec(el.style.height);
            const inner = (m ? Math.max(3, gridH * parseFloat(m[1])) : 0) - 2;
            const lines = Math.max(1, Math.floor(inner / lineH));
            text.style.webkitLineClamp = String(lines);
            text.style.lineClamp = String(lines);
        });
    },

    // Anchor the viewport on the current-time line when the outgoing timeline was
    // still sitting exactly where we last anchored it (i.e. the user never
    // scrolled it) or when there was no timeline at all — the first render of the
    // session, or the timeline having just been switched on. The now-line is
    // placed from the calendar's configured timezone, so the landing spot follows
    // that timezone. Otherwise the user's own position wins.
    //
    // Re-anchoring rather than replaying the pixel value matters on the refresh
    // after the first fetch: the event data changes the compressed hour mapping,
    // so the old pixel offset no longer points at the same hour. The mapping is
    // also time-dependent — the hour holding "now" is kept uncollapsed, so the
    // grid re-flows whenever the clock crosses an hour into or out of a gap.
    //
    // Runs in rAF — the timeline needs its final height (matchCalendarHeight) and
    // layout before scrollTop means anything.
    _applyTimelineScroll(prev) {
        // A pending "jump to today" (Today button) forces re-anchoring on the
        // now-line even if the user had scrolled the outgoing timeline away from
        // it. One-shot flag, consumed on this render.
        const forceNow = this._calTlForceNow === true;
        this._calTlForceNow = false;
        const userMoved = !forceNow && prev != null
            && (this._calTlAnchoredTop == null || Math.abs(prev - this._calTlAnchoredTop) > 1);

        requestAnimationFrame(() => {
            const tl = document.querySelector('.calendar-group .calendar-timeline');
            if (!tl) return;
            // Fit each event block's text to its height (runs on every render path
            // through this hook). Before the scroll math below — it never changes a
            // block's own height, so the now-line geometry stays valid.
            this._fitTimelineEventText(tl);
            if (userMoved) { tl.scrollTop = prev; return; }

            const now = tl.querySelector('.cal-tl-now');
            if (!now) return;   // "now" isn't inside the rendered window — leave it at the top

            // Distance from the scroll box's top edge to the now-line, in its
            // current scroll state. Landing it ~35% down the viewport keeps the
            // preceding hour visible and clears the sticky day headers.
            const delta = now.getBoundingClientRect().top - tl.getBoundingClientRect().top;
            tl.scrollTop += delta - tl.clientHeight * 0.35;
            // Record where it actually landed (the browser clamps to the scroll
            // range) so the next render can tell our scroll from the user's.
            this._calTlAnchoredTop = tl.scrollTop;
        });
    },

    // "Today" button (day views only). Snap the window back to today, force the
    // timeline to re-anchor on the now-line even if the user had scrolled away,
    // and flash today's column so the jump is obvious.
    jumpToTodayView() {
        const cm = window.CalendarManager;
        if (!cm) return;
        this._calTlForceNow = true;     // consumed by _applyTimelineScroll
        cm.resetDayViewToToday();       // offset = 0, then renderCalendarCard()
        this._flashTodayColumn();
    },

    // Green 3-blink flash on today's column(s): the timeline day column (plus its
    // header and all-day cell) or the chip grid's day column, whichever rendered.
    // Runs after the render has rebuilt the DOM.
    _flashTodayColumn() {
        requestAnimationFrame(() => {
            const cells = document.querySelectorAll(
                '.calendar-group .cal-tl-col.is-today,'
              + '.calendar-group .cal-tl-dayhead.is-today,'
              + '.calendar-group .cal-tl-allday-cell.is-today,'
              + '.calendar-group .calendar-day-col.is-today');
            cells.forEach(el => {
                el.classList.remove('cal-today-flash');
                void el.offsetWidth;    // restart the animation if it was mid-flight
                el.classList.add('cal-today-flash');
                el.addEventListener('animationend',
                    () => el.classList.remove('cal-today-flash'), { once: true });
            });
        });
    },

    // Keep the ticker scrolling in every case. The translateX(-50%) marquee only
    // tiles seamlessly when one sequence spans at least the visible width, so when
    // there are few / short events we repeat the items (cloned, aria-hidden, not
    // tab stops) until a sequence fills the container — avoiding both the static
    // state and the blank-jump the raw technique shows for narrow content. Also
    // sets a width-proportional duration for a steady speed. Runs on render+resize.
    _sizeUpcomingTicker(scope) {
        const ticker = (scope || document).querySelector('.cal-upcoming-ticker');
        if (!ticker) return;
        const seqs = ticker.querySelectorAll('.cal-upcoming-seq');
        if (!seqs.length) return;
        // Drop clones from any previous sizing pass so we re-measure cleanly.
        seqs.forEach(s => s.querySelectorAll('[data-cal-clone="1"]').forEach(n => n.remove()));
        // Reduced motion: CSS shows a single scrollable row instead of a marquee,
        // so there's nothing to fill or time.
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const container = ticker.clientWidth;
        if (!container) return;
        seqs.forEach(seq => {
            const originals = [...seq.children];
            if (!originals.length) return;
            let guard = 0;
            while (seq.scrollWidth < container && guard++ < 50) {
                for (const el of originals) {
                    const c = el.cloneNode(true);
                    c.setAttribute('data-cal-clone', '1');
                    c.setAttribute('aria-hidden', 'true');
                    c.setAttribute('tabindex', '-1');
                    seq.appendChild(c);
                }
            }
        });
        // Width-proportional duration → steady scroll speed regardless of count.
        // Base speed 55 px/s × 0.85 × 0.9 = 42.08 px/s → 15% slower, then a
        // further 10% slower.
        const track = ticker.querySelector('.cal-upcoming-track');
        if (track) {
            const seqW = seqs[0].scrollWidth;
            track.style.setProperty('--cal-ticker-dur', Math.max(10, Math.round(seqW / (55 * 0.85 * 0.9))) + 's');
        }
    },
});
