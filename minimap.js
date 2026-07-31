// ==========================================
// MINIMAP.JS - Layout Minimap Panel
// Anderson Homepage v3.0
//
// Provides a visual overview of group layout
// with drag-to-reorder and width cycling.
// Uses pointer events (separate from card drag).
// ==========================================

const Minimap = {
    _isOpen: false,
    _panel: null,
    _blocksContainer: null,
    _dragState: null,
    _dragRafId: null,

    init() {
        this._isOpen = localStorage.getItem('minimapOpen') === 'true';
        this._trackHeaderHeight();
        this._createPanel();
        this._attachDragHandlers();
    },

    /**
     * Publish the header's height as --rail-top so the tab rail can sit just
     * below it (see .minimap-panel in styles/6-minimap.css).
     *
     * Measured rather than hardcoded because the header genuinely changes
     * height: the clocks reflow at several widths, the usage widget appears
     * once its data file loads, and the selected clock grows when chosen. A
     * fixed offset would leave the rail overlapping the header on a tall
     * header and floating below it on a short one.
     */
    _trackHeaderHeight() {
        const header = document.querySelector('.header');
        if (!header) return;
        const publish = () => {
            const h = Math.round(header.getBoundingClientRect().height);
            if (h > 0) document.documentElement.style.setProperty('--rail-top', h + 'px');
        };
        publish();
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(publish).observe(header);
        } else {
            window.addEventListener('resize', publish);
        }
    },

    _createPanel() {
        const panel = document.createElement('div');
        panel.className = 'minimap-panel' + (this._isOpen ? ' open' : '');
        panel.id = 'minimapPanel';
        panel.innerHTML = `
            <div class="minimap-tabs"></div>
            <div class="minimap-content" id="minimapContent">
                <div class="minimap-header">
                    <span class="minimap-title">Layout</span>
                </div>
                <div class="minimap-full-section minimap-full-top"></div>
                <div class="minimap-blocks">
                    <div class="minimap-col" data-col="1"></div>
                    <div class="minimap-col" data-col="2"></div>
                </div>
                <div class="minimap-full-section"></div>
            </div>
        `;
        document.body.appendChild(panel);

        // The tab rail carries the app's menu button as well as the minimap's own
        // toggle, so the two read as one control cluster — and both open their
        // panel leftward from a rail that stays put. .controls is authored in the
        // HTML (with its dropdown and its click wiring already attached — moving a
        // node keeps both), and is adopted here rather than rebuilt.
        const tabs = panel.querySelector('.minimap-tabs');
        const controls = document.querySelector('.controls');
        if (controls) tabs.appendChild(controls);
        tabs.insertAdjacentHTML('beforeend',
            `<button class="minimap-toggle" title="Toggle Minimap" aria-label="Toggle Minimap"
                     aria-expanded="${this._isOpen}" aria-controls="minimapContent">⊞</button>`);

        this._panel = panel;
        this._blocksContainer = panel.querySelector('.minimap-blocks');
        this._col1 = panel.querySelector('.minimap-col[data-col="1"]');
        this._col2 = panel.querySelector('.minimap-col[data-col="2"]');
        this._fullTopSection = panel.querySelector('.minimap-full-top');
        this._fullSection = panel.querySelector('.minimap-full-section:not(.minimap-full-top)');

        panel.querySelector('.minimap-toggle').addEventListener('click', () => this.toggle());
    },

    toggle() {
        this._setOpen(!this._isOpen);
    },

    /**
     * Close the Layout panel from outside (the menu button does this before
     * opening the dropdown — they share the same tab rail and open leftward
     * over the same strip of screen, so both open at once is two panels
     * fighting for one space). No-op when already closed, so it never
     * rewrites the stored state for nothing.
     */
    close() {
        if (this._isOpen) this._setOpen(false);
    },

    _setOpen(open) {
        this._isOpen = open;
        this._panel.classList.toggle('open', open);
        this._panel.querySelector('.minimap-toggle')
            ?.setAttribute('aria-expanded', String(open));
        // Persisted, deliberately: the panel is restored on load from this
        // value, so a close that didn't stick would reopen behind the user's
        // back on the next reload.
        Utils.safeLocalStorageSet('minimapOpen', String(open));
    },

    render() {
        if (!this._blocksContainer) return;

        // Load stored virtual group positions
        const vPos = UIRenderer._getVirtualPositions();

        // Build virtual groups to include in minimap
        const virtualGroups = [];

        const favorites = AppState.websites.filter(w => w.favorite);
        if (favorites.length > 0) {
            const fv = vPos['__favorites__'] || {};
            virtualGroups.push({ id: '__favorites__', name: 'Favorites', color: 'rgba(255, 193, 7, 0.2)', position: fv.position ?? -3, column: fv.column ?? 1, _virtual: true });
        }

        const recentlyOpened = AppState.websites.filter(w => w.lastOpened);
        if (recentlyOpened.length > 0) {
            const rv = vPos['__recent__'] || {};
            virtualGroups.push({ id: '__recent__', name: 'Recently Opened', color: 'rgba(33, 150, 243, 0.2)', position: rv.position ?? -2, column: rv.column ?? 1, _virtual: true });
        }

        // Calendar is always present
        const cv = vPos['__calendar__'] || {};
        virtualGroups.push({ id: '__calendar__', name: 'Calendar', color: 'rgba(120, 160, 220, 0.18)', position: cv.position ?? -1, column: cv.column ?? 2, _virtual: true, _full: cv.width === 'full' });

        // To-Do is always present
        const tv = vPos['__todo__'] || {};
        virtualGroups.push({ id: '__todo__', name: 'To-Do', color: 'rgba(156, 39, 176, 0.18)', position: tv.position ?? -1, column: tv.column ?? 1, _virtual: true, _full: tv.width === 'full' });

        const allGroups = [...virtualGroups, ...AppState.groups];
        const sortedGroups = [...allGroups].sort((a, b) => {
            if (a.id === 'ungrouped') return 1;
            if (b.id === 'ungrouped') return -1;
            return (a.position || 0) - (b.position || 0);
        });

        this._col1.innerHTML = '';
        this._col2.innerHTML = '';
        this._fullTopSection.innerHTML = '';
        this._fullSection.innerHTML = '';

        sortedGroups.forEach(group => {
            const block = this._createBlock(group);
            if (group.id === 'ungrouped') {
                this._fullSection.appendChild(block);
            } else if (group._full) {
                // Mirrors the page: full-width special cards band above the grid.
                this._fullTopSection.appendChild(block);
            } else if (group.column === 2) {
                this._col2.appendChild(block);
            } else {
                this._col1.appendChild(block);
            }
        });

        // Measure actual group heights after next frame
        requestAnimationFrame(() => this._measureGroupHeights());
    },

    _createBlock(group) {
        const block = document.createElement('div');
        block.className = 'minimap-block';
        block.dataset.groupId = group.id;

        // Column class
        if (group.id === 'ungrouped' || group._full) {
            block.classList.add('mm-full');
        } else if (group.column === 2) {
            block.classList.add('mm-half', 'mm-col-2');
        } else {
            block.classList.add('mm-half', 'mm-col-1');
        }

        if (group.collapsed) {
            block.classList.add('mm-collapsed');
        }

        // Background color. Gated through isValidColor because `background` is a
        // shorthand: an imported group colour of `url(http://…)` is a legal value
        // here and would fire an outbound request from an app that is meant to
        // make none. ui-renderer.js gates the same field the same way.
        block.style.background = Utils.isValidColor(group.color)
            ? group.color
            : 'rgba(100,100,100,0.3)';

        const name = Utils.sanitizeHTML(group.name);
        let websiteCount;
        if (group.id === '__favorites__') {
            websiteCount = AppState.websites.filter(w => w.favorite).length;
        } else if (group.id === '__recent__') {
            websiteCount = AppState.websites.filter(w => w.lastOpened).length;
        } else if (group.id === '__calendar__') {
            const cm = window.CalendarManager;
            websiteCount = cm?.getUpcomingEvents()?.length || 0;
        } else if (group.id === '__todo__') {
            websiteCount = window.TodoManager?.getTodos()?.length || 0;
        } else {
            websiteCount = AppState.websites.filter(w =>
                (w.groupId || 'ungrouped') === group.id
            ).length;
        }

        const countUnit = group.id === '__calendar__' ? 'event'
            : group.id === '__todo__' ? 'task' : 'site';

        block.innerHTML = `
            <span class="minimap-block-label">${name}</span>
            <span class="minimap-block-count">${websiteCount} ${countUnit}${websiteCount !== 1 ? 's' : ''}</span>
        `;

        // Click block to scroll to group (but not during drag)
        block.addEventListener('click', (e) => {
            if (this._dragState?.didDrag) return;
            this._scrollToGroup(group.id);
        });

        return block;
    },

    _measureGroupHeights() {
        const blocks = this._panel.querySelectorAll('.minimap-block');
        if (blocks.length === 0) return;

        const heights = [];
        blocks.forEach(block => {
            const groupId = block.dataset.groupId;
            const groupEl = document.querySelector(`.app-group[data-group-id="${CSS.escape(groupId)}"]`);
            const h = groupEl ? groupEl.offsetHeight : 100;
            heights.push({ block, h, groupId });
        });

        // Match calendar block height to the first 2 col-2 groups (same as main layout)
        const col2Blocks = blocks.length > 0
            ? [...this._col2.querySelectorAll('.minimap-block')]
            : [];
        if (col2Blocks.length >= 2) {
            const col2Gap = parseFloat(getComputedStyle(this._col2).gap) || 0;
            const col2g1 = col2Blocks[0].dataset.groupId;
            const col2g2 = col2Blocks[1].dataset.groupId;
            const h1 = heights.find(x => x.groupId === col2g1)?.h || 100;
            const h2 = heights.find(x => x.groupId === col2g2)?.h || 100;
            // Only meaningful while the calendar is actually sharing the right
            // column and letting 'auto' size it. Once it is full-width or
            // carries a hand-dragged height, its measured height is the truth.
            const calLayout = window.UIRenderer?._getCardLayout?.('__calendar__') || {};
            const calAutoSized = calLayout.width !== 'full'
                && calLayout.height == null
                && (window.CalendarManager?.getHeight?.() || 'auto') === 'auto';
            const calEntry = calAutoSized ? heights.find(x => x.groupId === '__calendar__') : null;
            if (calEntry) {
                // Use the actual combined height of the 2 right-column groups
                const columns = document.querySelectorAll('.groups-column');
                const mainGap = columns.length >= 2 ? (parseFloat(getComputedStyle(columns[1]).gap) || 0) : 0;
                calEntry.h = h1 + h2 + mainGap;
            }
        }

        const maxH = Math.max(...heights.map(x => x.h), 1);

        heights.forEach(({ block, h }) => {
            if (block.classList.contains('mm-collapsed')) {
                block.style.height = '21px';
            } else {
                const scaled = Math.max(34, Math.round((h / maxH) * 101));
                block.style.height = scaled + 'px';
            }
        });
    },

    _attachDragHandlers() {
        // Use pointerdown on the blocks container
        document.addEventListener('pointerdown', (e) => {
            const block = e.target.closest('.minimap-block');
            if (!block || !this._panel.contains(block)) return;
            if (e.button !== 0) return;

            e.preventDefault();
            const rect = block.getBoundingClientRect();
            this._dragState = {
                block,
                groupId: block.dataset.groupId,
                startX: e.clientX,
                startY: e.clientY,
                offsetX: e.clientX - rect.left,
                offsetY: e.clientY - rect.top,
                didDrag: false,
                placeholder: null
            };

            block.setPointerCapture(e.pointerId);
        });

        document.addEventListener('pointermove', (e) => {
            if (!this._dragState) return;
            const { block, startX, startY } = this._dragState;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // Threshold before starting drag
            if (!this._dragState.didDrag && Math.abs(dx) + Math.abs(dy) < 5) return;

            if (!this._dragState.didDrag) {
                this._dragState.didDrag = true;
                block.classList.add('mm-dragging');

                // Create placeholder
                const placeholder = document.createElement('div');
                placeholder.className = 'minimap-drop-indicator';
                this._dragState.placeholder = placeholder;

                // Float the block
                const rect = block.getBoundingClientRect();
                block.style.position = 'fixed';
                block.style.zIndex = '200';
                block.style.width = rect.width + 'px';
                block.style.left = rect.left + 'px';
                block.style.top = rect.top + 'px';
                block.style.pointerEvents = 'none';
            }

            // Store the latest pointer position and coalesce the visual
            // update + drop-indicator recomputation into a single
            // requestAnimationFrame, so repeated native pointermove events
            // don't each force a synchronous layout.
            this._dragState.pointerX = e.clientX;
            this._dragState.pointerY = e.clientY;
            this._scheduleDragFrame();
        });

        document.addEventListener('pointerup', (e) => {
            if (!this._dragState) return;

            // If a drag-frame update is still pending, run it synchronously
            // now so the drop reflects the latest pointer position, then
            // cancel the scheduled frame so it can't fire after drag end.
            if (this._dragRafId !== null) {
                cancelAnimationFrame(this._dragRafId);
                this._dragRafId = null;
                this._runDragFrame();
            }

            const { block, didDrag, placeholder, groupId } = this._dragState;

            block.releasePointerCapture(e.pointerId);

            if (didDrag) {
                block.classList.remove('mm-dragging');
                block.style.position = '';
                block.style.zIndex = '';
                block.style.width = '';
                block.style.left = '';
                block.style.top = '';
                block.style.pointerEvents = '';

                if (placeholder && placeholder.parentNode) {
                    this._reorderGroups();
                }
            }

            // Clear drag state after a tick (so click handler can check didDrag)
            const state = this._dragState;
            setTimeout(() => {
                if (this._dragState === state) this._dragState = null;
            }, 0);
        });
    },

    // Schedule a single rAF to coalesce pointermove handling (visual drag
    // position + drop-indicator recomputation) into once-per-frame work,
    // instead of doing layout reads/writes on every native pointermove.
    _scheduleDragFrame() {
        if (this._dragRafId !== null) return;
        this._dragRafId = requestAnimationFrame(() => {
            this._dragRafId = null;
            this._runDragFrame();
        });
    },

    // Runs the coalesced per-frame drag update using the most recent
    // pointer coordinates stored on _dragState.
    _runDragFrame() {
        if (!this._dragState || !this._dragState.didDrag) return;
        const { block, offsetX, offsetY, pointerX, pointerY } = this._dragState;
        if (pointerX === undefined || pointerY === undefined) return;

        // Move the dragged block. The block is position:fixed and excluded
        // from the drop-indicator's column queries (:not(.mm-dragging)), so
        // writing its position here doesn't invalidate the measurements
        // taken inside _updateDropIndicator.
        block.style.left = (pointerX - offsetX) + 'px';
        block.style.top = (pointerY - offsetY) + 'px';

        // Find insertion point (2D-aware for CSS columns)
        this._updateDropIndicator(pointerX, pointerY);
    },

    _updateDropIndicator(pointerX, pointerY) {
        const { placeholder } = this._dragState;
        if (!placeholder) return;

        // Remove the existing placeholder first - it must not occupy space
        // while we measure the other blocks below, otherwise it would skew
        // their reported positions/heights.
        if (placeholder.parentNode) placeholder.remove();

        // ---- READ PHASE: gather all layout measurements up front ----
        const containerRect = this._blocksContainer.getBoundingClientRect();
        const containerMidX = containerRect.left + containerRect.width / 2;
        const targetCol = pointerX < containerMidX ? 1 : 2;

        // Get the target column container
        const targetColEl = targetCol === 1 ? this._col1 : this._col2;

        // Find blocks in the target column and read each of their rects once
        const colBlocks = [...targetColEl.querySelectorAll('.minimap-block:not(.mm-dragging)')]
            .map(b => ({ block: b, rect: b.getBoundingClientRect() }))
            .sort((a, b) => a.rect.top - b.rect.top);

        // Find insertion point by Y position
        let insertBefore = null;
        for (const { block: b, rect } of colBlocks) {
            const midY = rect.top + rect.height / 2;
            if (pointerY < midY) {
                insertBefore = b;
                break;
            }
        }

        // ---- WRITE PHASE: apply DOM mutations ----
        this._dragState.targetColumn = targetCol;
        if (colBlocks.length === 0) {
            targetColEl.appendChild(placeholder);
        } else if (insertBefore) {
            targetColEl.insertBefore(placeholder, insertBefore);
        } else {
            targetColEl.appendChild(placeholder);
        }
    },

    // Re-measure block heights against the live cards without rebuilding the
    // blocks. Used after a card resize, where only the proportions changed.
    syncHeights() {
        if (this._panel) this._measureGroupHeights();
    },

    _reorderGroups() {
        const vPos = UIRenderer._getVirtualPositions();
        const draggedId = this._dragState?.groupId;
        const targetColumn = this._dragState?.targetColumn;

        // Collect all IDs with their column from the current DOM state
        const assignFromContainer = (container, col) => {
            let pos = 1;
            for (const child of container.children) {
                if (!child.classList.contains('minimap-block')) continue;
                const id = child.dataset.groupId;
                if (!id || id === 'ungrouped') continue;

                const effectiveCol = (id === draggedId && targetColumn) ? targetColumn : col;

                if (id.startsWith('__')) {
                    const existing = vPos[id] || {};
                    vPos[id] = { ...existing, position: pos, column: effectiveCol };
                    // Landing in a column IS the gesture for leaving the
                    // full-width band — otherwise the drop indicator tracks the
                    // pointer, the toast says "Layout updated", and the card
                    // doesn't move. Only for the card actually dragged: every
                    // other virtual group here was already in a column.
                    if (id === draggedId) vPos[id].width = 'column';
                } else {
                    const group = GroupManager.getById(id);
                    if (group) {
                        group.position = pos;
                        if (id === draggedId && targetColumn) {
                            group.column = targetColumn;
                        }
                    }
                }
                pos++;
            }
        };

        // For the dragged block: it's currently floating, so we need to
        // figure out its position from the placeholder
        // First, insert dragged ID at placeholder position
        const placeholder = this._dragState?.placeholder;
        if (placeholder && placeholder.parentNode && draggedId) {
            // Create a temporary marker with the dragged ID
            const marker = document.createElement('div');
            marker.className = 'minimap-block';
            marker.dataset.groupId = draggedId;
            placeholder.parentNode.insertBefore(marker, placeholder);
            placeholder.remove();

            // Now assign positions from both columns
            assignFromContainer(this._col1, 1);
            assignFromContainer(this._col2, 2);

            // Clean up marker
            marker.remove();
        } else {
            assignFromContainer(this._col1, 1);
            assignFromContainer(this._col2, 2);
        }

        // Full-width special cards band above the grid, so they keep positions
        // low — which also lands them near the top of a column if their width
        // is later toggled back.
        let topPos = -100;
        for (const child of this._fullTopSection.children) {
            if (!child.classList.contains('minimap-block')) continue;
            const id = child.dataset.groupId;
            if (!id || !id.startsWith('__')) continue;
            // A block being dragged out of the band is still parented here
            // (it's floated with position:fixed, not reparented). Skip it, or
            // this loop would undo the column assignment made above.
            if (id === draggedId) continue;
            const existing = vPos[id] || {};
            vPos[id] = { ...existing, position: topPos };
            topPos++;
        }

        // Full-width groups keep their positions high
        let fullPos = 100;
        for (const child of this._fullSection.children) {
            if (!child.classList.contains('minimap-block')) continue;
            const id = child.dataset.groupId;
            if (!id) continue;
            if (id === 'ungrouped') continue;
            if (id.startsWith('__')) {
                const existing = vPos[id] || {};
                vPos[id] = { ...existing, position: fullPos, column: 1 };
            } else {
                const group = GroupManager.getById(id);
                if (group) group.position = fullPos;
            }
            fullPos++;
        }

        UIRenderer._saveVirtualPositions(vPos);
        Storage.sortGroups();
        Storage.save();
        if (window.UIRenderer) UIRenderer.render();
        UI.showToast('Layout updated!');
    },

    _scrollToGroup(groupId) {
        const groupEl = document.querySelector(`.app-group[data-group-id="${CSS.escape(groupId)}"]`);
        if (groupEl) {
            groupEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Brief highlight
            groupEl.style.outline = '2px solid rgba(100, 181, 246, 0.6)';
            setTimeout(() => { groupEl.style.outline = ''; }, 1500);
        }
    }
};

window.Minimap = Minimap;
