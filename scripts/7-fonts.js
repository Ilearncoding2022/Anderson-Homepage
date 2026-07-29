// ==========================================
// 7-FONTS.JS - Card font customization (v4.1)
// Anderson Homepage
//
// Lets the user pick a font family (applied to ALL text in a card) and a
// per-text-group font size for the To-Do and Calendar cards. Settings are
// applied as CSS custom properties on <html>, so they survive the cards being
// re-rendered, and are persisted to localStorage (and the SQLite / export
// backups, which mirror every APP_KEYS entry).
//
//   To-Do groups:   item · subtask · urgency badge · due date
//   Calendar groups: group date · time-zone row · event name · event details
//
// Each group's CSS rule reads `font-size: var(--<group>, <original default>)`,
// so an unset group simply keeps the card's original size.
// ==========================================

const FontManager = {
    KEYS: { todo: 'todoFontSettings', calendar: 'calendarFontSettings' },
    FAMILY_VAR: { todo: '--todo-font-family', calendar: '--cal-font-family' },
    MIN: 5,
    MAX: 40,

    // Curated, not exhaustive — every option here is a deliberate choice, not
    // just "whatever fonts happen to exist". The two self-hosted variable
    // fonts (already in /fonts, @font-face already declared in 1-core.css)
    // cover display and mono duty; two system fallbacks are offered only
    // because they read genuinely differently (clean grotesque, classic
    // serif). Empty value = inherit the card's normal font.
    FONT_FAMILIES: [
        { label: 'System Default', value: '' },
        { label: 'Display — Space Grotesk', value: 'var(--font-ui)' },
        { label: 'Mono — JetBrains Mono', value: 'var(--font-mono)' },
        { label: 'Segoe UI', value: '"Segoe UI", Roboto, Helvetica, sans-serif' },
        { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
    ],

    // Legacy fonts removed from FONT_FAMILIES map onto their nearest curated
    // replacement so a saved pick doesn't just vanish to System Default. Any
    // legacy stack built on a serif face keeps a serif (Georgia); anything
    // monospace becomes the new mono; everything else (the sans-serif grab
    // bag, plus Comic Sans) becomes the new display face. Applied once in
    // _validFamily() before falling back to ''.
    LEGACY_FAMILY_MAP: {
        'Arial, Helvetica, sans-serif': 'var(--font-ui)',
        'Helvetica, Arial, sans-serif': 'var(--font-ui)',
        'Verdana, Geneva, sans-serif': 'var(--font-ui)',
        'Tahoma, Geneva, sans-serif': 'var(--font-ui)',
        '"Trebuchet MS", Helvetica, sans-serif': 'var(--font-ui)',
        'Calibri, Candara, Segoe, sans-serif': 'var(--font-ui)',
        '"Times New Roman", Times, serif': 'Georgia, "Times New Roman", serif',
        'Garamond, "Times New Roman", serif': 'Georgia, "Times New Roman", serif',
        '"Palatino Linotype", "Book Antiqua", Palatino, serif': 'Georgia, "Times New Roman", serif',
        '"Courier New", Courier, monospace': 'var(--font-mono)',
        'Consolas, "Lucida Console", monospace': 'var(--font-mono)',
        '"Comic Sans MS", "Comic Sans", cursive': 'var(--font-ui)',
    },

    // Per-card text groups: CSS variable + original-default px + display label.
    // The default px values mirror the original rem font-sizes in the CSS.
    // Each group has a font-size variable (`var`) and a companion zoom variable
    // (`zvar`). Sizes at/above the browser's minimum font size use `var` alone;
    // smaller sizes hold `var` at the floor and shrink with `zoom` (which the
    // minimum-font-size clamp does not apply to), so any size renders.
    GROUPS: {
        todo: {
            item:     { var: '--todo-fs-item',     zvar: '--todo-z-item',     def: 15, label: 'To-Do item' },
            sub:      { var: '--todo-fs-sub',      zvar: '--todo-z-sub',      def: 14, label: 'Subtask' },
            badge:    { var: '--todo-fs-badge',    zvar: '--todo-z-badge',    def: 10, label: 'Task badge' },
            subbadge: { var: '--todo-fs-subbadge', zvar: '--todo-z-subbadge', def: 10, label: 'Subtask badge' },
            date:     { var: '--todo-fs-date',     zvar: '--todo-z-date',     def: 12, label: 'Due date' },
        },
        calendar: {
            groupdate: { var: '--cal-fs-groupdate', zvar: '--cal-z-groupdate', def: 11, label: 'Group date' },
            tz:        { var: '--cal-fs-tz',        zvar: '--cal-z-tz',        def: 12, label: 'Time-zone row' },
            event:     { var: '--cal-fs-event',     zvar: '--cal-z-event',     def: 14, label: 'Event name' },
            details:   { var: '--cal-fs-details',   zvar: '--cal-z-details',   def: 12, label: 'Event details' },
        },
    },

    // Effective minimum rendered font size (the browser's "minimum font size"
    // setting). Detected once at init; 1 means no meaningful floor.
    _minFont: 1,

    state: {
        todo: { family: '', sizes: {} },
        calendar: { family: '', sizes: {} },
    },

    initialize() {
        this._minFont = this._detectMinFont();
        this.state.todo = this._load('todo');
        this.state.calendar = this._load('calendar');
        this.apply();
        this.renderControls('todo');
        this.renderControls('calendar');
        this._bind();
    },

    // Measure the browser's enforced minimum font size by comparing the rendered
    // width of a string at font-size:1px vs 100px. With a minimum set, the "1px"
    // text is actually painted at the minimum, so the ratio reveals it.
    _detectMinFont() {
        try {
            const probe = document.createElement('span');
            probe.textContent = 'MMMMMMMMMMMMMMMM';
            probe.setAttribute('aria-hidden', 'true');
            probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;white-space:nowrap;visibility:hidden;margin:0;padding:0;font:1px/1 monospace;';
            document.body.appendChild(probe);
            const w1 = probe.getBoundingClientRect().width;
            probe.style.fontSize = '100px';
            const w100 = probe.getBoundingClientRect().width;
            probe.remove();
            if (w1 > 0 && w100 > 0) {
                const eff = (w1 / w100) * 100;
                if (isFinite(eff) && eff >= 1) return eff;
            }
        } catch { /* fall through */ }
        return 1;
    },

    // ---- Validation / persistence ----

    _validFamily(v) {
        if (this.FONT_FAMILIES.some(f => f.value === v)) return v;
        // A pick from the old 14-font list: map it to its nearest curated
        // replacement instead of silently resetting to System Default.
        // hasOwn, not a bare lookup — a stored value of "constructor" or
        // "toString" would otherwise resolve off Object.prototype and make this
        // return a function, breaking its own string contract.
        if (typeof v === 'string' && Object.hasOwn(this.LEGACY_FAMILY_MAP, v)) {
            return this.LEGACY_FAMILY_MAP[v];
        }
        return '';
    },

    _clamp(n, fallback) {
        n = Math.round(Number(n));
        if (!isFinite(n)) return fallback;
        return Math.min(this.MAX, Math.max(this.MIN, n));
    },

    _load(card) {
        const raw = Utils.safeJSONParse(localStorage.getItem(this.KEYS[card]), null);
        const out = { family: '', sizes: {} };
        if (raw && typeof raw === 'object') {
            out.family = this._validFamily(raw.family);
            if (raw.sizes && typeof raw.sizes === 'object') {
                for (const [key, g] of Object.entries(this.GROUPS[card])) {
                    const v = raw.sizes[key];
                    if (v != null && isFinite(Number(v))) out.sizes[key] = this._clamp(v, g.def);
                }
            }
        }
        return out;
    },

    _save(card) {
        Utils.safeLocalStorageSet(this.KEYS[card], JSON.stringify(this.state[card]));
    },

    // Current px for a group: the user's override, or the original default.
    _size(card, key) {
        const v = this.state[card].sizes[key];
        return v != null ? v : this.GROUPS[card][key].def;
    },

    // ---- Apply to the page (CSS variables on <html>) ----

    apply() {
        const root = document.documentElement.style;
        // Round up + 1px of slack so the held font-size is safely above the
        // browser's clamp even if detection is a touch low.
        const floor = Math.max(1, Math.ceil(this._minFont) + 1);

        for (const card of ['todo', 'calendar']) {
            const fam = this.state[card].family;
            if (fam) root.setProperty(this.FAMILY_VAR[card], fam);
            else root.removeProperty(this.FAMILY_VAR[card]);

            for (const [key, g] of Object.entries(this.GROUPS[card])) {
                const v = this.state[card].sizes[key];
                if (v == null) {
                    root.removeProperty(g.var);
                    root.removeProperty(g.zvar);
                } else if (v >= floor) {
                    // Above the clamp — plain font-size, no zoom (no distortion).
                    root.setProperty(g.var, `${v}px`);
                    root.removeProperty(g.zvar);
                } else {
                    // Below the clamp — hold font-size at the floor and scale down.
                    root.setProperty(g.var, `${floor}px`);
                    root.setProperty(g.zvar, String(v / floor));
                }
            }
        }

        // How many rows a To-Do task's text needs depends on these sizes, and a
        // size change doesn't re-render the card — re-fit the fields here.
        // No-op before the first render (there is no card to find yet).
        window.UIRenderer?.matchTodoHeight?.();
    },

    // ---- Mutations ----

    setFamily(card, value) {
        if (!this.GROUPS[card]) return;
        this.state[card].family = this._validFamily(value);
        this._save(card);
        this.apply();
    },

    setSize(card, key, px) {
        const g = this.GROUPS[card]?.[key];
        if (!g) return;
        this.state[card].sizes[key] = this._clamp(px, g.def);
        this._save(card);
        this.apply();
    },

    reset(card) {
        if (!this.GROUPS[card]) return;
        this.state[card] = { family: '', sizes: {} };
        this._save(card);
        this.apply();
        this.renderControls(card);
    },

    // ---- Settings UI ----

    _containerId(card) {
        return card === 'todo' ? 'todoFontSettings' : 'calendarFontSettings';
    },

    renderControls(card) {
        const container = document.getElementById(this._containerId(card));
        if (!container) return;
        const fam = this.state[card].family;

        const familyOpts = this.FONT_FAMILIES.map(f =>
            `<option value="${Utils.sanitizeHTML(f.value)}" ${f.value === fam ? 'selected' : ''}>${Utils.sanitizeHTML(f.label)}</option>`
        ).join('');

        const rows = Object.entries(this.GROUPS[card]).map(([key, g]) => `
            <div class="font-size-row">
                <span class="font-size-label">${Utils.sanitizeHTML(g.label)}</span>
                <div class="font-stepper" data-font-card="${card}" data-font-group="${key}">
                    <button type="button" class="font-step-btn" data-font-step="-1"
                            aria-label="Decrease ${Utils.sanitizeHTML(g.label)} size">−</button>
                    <input type="number" class="font-size-input" min="${this.MIN}" max="${this.MAX}" step="1"
                           value="${this._size(card, key)}"
                           aria-label="${Utils.sanitizeHTML(g.label)} font size in pixels">
                    <button type="button" class="font-step-btn" data-font-step="1"
                            aria-label="Increase ${Utils.sanitizeHTML(g.label)} size">+</button>
                    <span class="font-size-unit">px</span>
                </div>
            </div>`).join('');

        container.innerHTML = `
            <div class="font-controls">
                <div class="font-family-field">
                    <label class="font-family-label" for="${card}FontFamily">Font type</label>
                    <select id="${card}FontFamily" class="font-family-select" data-font-card="${card}" data-font-family>${familyOpts}</select>
                </div>
                <div class="font-size-grid">${rows}</div>
                <button type="button" class="font-reset-btn" data-font-reset="${card}">Reset to defaults</button>
            </div>`;
    },

    _bind() {
        if (this._bound) return;
        this._bound = true;

        ['todo', 'calendar'].forEach(card => {
            const el = document.getElementById(this._containerId(card));
            if (!el) return;

            el.addEventListener('change', (e) => {
                const family = e.target.closest('[data-font-family]');
                if (family) {
                    this.setFamily(family.dataset.fontCard, family.value);
                    return;
                }
                const input = e.target.closest('.font-size-input');
                if (input) {
                    const wrap = input.closest('.font-stepper');
                    const g = this.GROUPS[wrap.dataset.fontCard][wrap.dataset.fontGroup];
                    const clamped = this._clamp(input.value, g.def);
                    input.value = clamped;
                    this.setSize(wrap.dataset.fontCard, wrap.dataset.fontGroup, clamped);
                }
            });

            el.addEventListener('click', (e) => {
                const step = e.target.closest('[data-font-step]');
                if (step) {
                    const wrap = step.closest('.font-stepper');
                    const input = wrap.querySelector('.font-size-input');
                    const g = this.GROUPS[wrap.dataset.fontCard][wrap.dataset.fontGroup];
                    const next = this._clamp(Number(input.value) + Number(step.dataset.fontStep), g.def);
                    input.value = next;
                    this.setSize(wrap.dataset.fontCard, wrap.dataset.fontGroup, next);
                    return;
                }
                const reset = e.target.closest('[data-font-reset]');
                if (reset) this.reset(reset.dataset.fontReset);
            });
        });
    },
};

window.FontManager = FontManager;
