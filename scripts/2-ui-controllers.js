// ==========================================
// 2-UI-CONTROLLERS.JS - UI & Visual Controls
// Anderson Homepage v3.0
//
// Contents:
// - Theme (theme switching)
// - Background (background management)
// - ViewManager (view controls)
// - UI (toast notifications)
// - Utils (helper functions)
// ==========================================

// ========================================
// THEME MANAGER
// ========================================

const Theme = {
    toggle() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        Utils.safeLocalStorageSet('theme', newTheme);
        document.getElementById('themeToggle').textContent = newTheme === 'dark' ? '☀️' : '🌙';
    },

    load() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        document.getElementById('themeToggle').textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    }
};

// ========================================
// IMAGE STORE (IndexedDB)
// Large blobs like the background image live here, NOT in localStorage —
// a base64 image can be megabytes and would exhaust localStorage's ~5MB
// quota, silently breaking other writes (e.g. the To-Do list).
// ========================================

const ImageStore = {
    DB_NAME: 'andersonHomepageImages',
    STORE: 'images',

    _open() {
        return new Promise((resolve, reject) => {
            let req;
            try { req = indexedDB.open(this.DB_NAME, 1); }
            catch (e) { return reject(e); }
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(this.STORE)) {
                    req.result.createObjectStore(this.STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    async get(key) {
        const db = await this._open();
        try {
            return await new Promise((res, rej) => {
                const r = db.transaction(this.STORE, 'readonly').objectStore(this.STORE).get(key);
                r.onsuccess = () => res(r.result ?? null);
                r.onerror = () => rej(r.error);
            });
        } finally { db.close(); }
    },

    async set(key, value) {
        const db = await this._open();
        try {
            await new Promise((res, rej) => {
                const tx = db.transaction(this.STORE, 'readwrite');
                tx.objectStore(this.STORE).put(value, key);
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
            });
        } finally { db.close(); }
    },

    async delete(key) {
        const db = await this._open();
        try {
            await new Promise((res, rej) => {
                const tx = db.transaction(this.STORE, 'readwrite');
                tx.objectStore(this.STORE).delete(key);
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
            });
        } finally { db.close(); }
    },

    // ---- Website icons (keyed by website id under an "icon:" prefix) ----
    ICON_PREFIX: 'icon:',

    setIcon(id, base64) { return this.set(this.ICON_PREFIX + id, base64); },
    getIcon(id) { return this.get(this.ICON_PREFIX + id); },
    deleteIcon(id) { return this.delete(this.ICON_PREFIX + id); },

    // Returns every stored icon as { websiteId: base64 } in one transaction.
    async getAllIcons() {
        const db = await this._open();
        try {
            return await new Promise((res, rej) => {
                const store = db.transaction(this.STORE, 'readonly').objectStore(this.STORE);
                const keysReq = store.getAllKeys();
                const valsReq = store.getAll();
                let keys = null, vals = null;
                const finish = () => {
                    if (keys === null || vals === null) return;
                    const out = {};
                    keys.forEach((k, i) => {
                        if (typeof k === 'string' && k.startsWith(this.ICON_PREFIX)) {
                            out[k.slice(this.ICON_PREFIX.length)] = vals[i];
                        }
                    });
                    res(out);
                };
                keysReq.onsuccess = () => { keys = keysReq.result; finish(); };
                valsReq.onsuccess = () => { vals = valsReq.result; finish(); };
                keysReq.onerror = () => rej(keysReq.error);
                valsReq.onerror = () => rej(valsReq.error);
            });
        } finally { db.close(); }
    },

    // Drop every icon entry (used on full data import before restoring icons).
    async clearAllIcons() {
        const db = await this._open();
        try {
            await new Promise((res, rej) => {
                const tx = db.transaction(this.STORE, 'readwrite');
                const store = tx.objectStore(this.STORE);
                const keysReq = store.getAllKeys();
                keysReq.onsuccess = () => {
                    for (const k of keysReq.result) {
                        if (typeof k === 'string' && k.startsWith(this.ICON_PREFIX)) store.delete(k);
                    }
                };
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
            });
        } finally { db.close(); }
    },

    // ---- Pomodoro custom sounds (keyed under a "sound:" prefix) ----
    // Each value is a record { id, name, dataUrl, addedAt }. Audio data lives
    // here (IndexedDB) rather than localStorage/SQLite so multi-MB clips never
    // bloat the quota or the .db mirror — same rationale as background images.
    SOUND_PREFIX: 'sound:',

    setSound(id, record) { return this.set(this.SOUND_PREFIX + id, record); },
    deleteSound(id) { return this.delete(this.SOUND_PREFIX + id); },

    // Returns every stored custom sound as an array of records, in one transaction.
    async getAllSounds() {
        const db = await this._open();
        try {
            return await new Promise((res, rej) => {
                const store = db.transaction(this.STORE, 'readonly').objectStore(this.STORE);
                const keysReq = store.getAllKeys();
                const valsReq = store.getAll();
                let keys = null, vals = null;
                const finish = () => {
                    if (keys === null || vals === null) return;
                    const out = [];
                    keys.forEach((k, i) => {
                        if (typeof k === 'string' && k.startsWith(this.SOUND_PREFIX)) {
                            out.push(vals[i]);
                        }
                    });
                    res(out);
                };
                keysReq.onsuccess = () => { keys = keysReq.result; finish(); };
                valsReq.onsuccess = () => { vals = valsReq.result; finish(); };
                keysReq.onerror = () => rej(keysReq.error);
                valsReq.onerror = () => rej(valsReq.error);
            });
        } finally { db.close(); }
    }
};

// ========================================
// BACKGROUND MANAGER
// ========================================

const Background = {
    IMG_KEY: 'backgroundImage',

    async setImage(file) {
        try {
            if (!file.type.startsWith('image/')) {
                UI.showToast('Please select a valid image file');
                return;
            }

            const maxSize = 2 * 1024 * 1024;
            if (file.size > maxSize) {
                UI.showToast('Large image may cause issues. Converting...');
            } else {
                UI.showToast('Loading background image...');
            }

            const base64 = await Utils.fileToBase64(file);

            try {
                await ImageStore.set(this.IMG_KEY, base64);
            } catch (e) {
                UI.showToast('Failed to store background image.');
                return;
            }
            // Drop any legacy localStorage copy so it stops consuming quota.
            localStorage.removeItem('backgroundImage');

            document.body.style.backgroundImage = `url(${base64})`;

            const positionSelect = document.getElementById('bgPosition');
            const position = positionSelect ? positionSelect.value : 'cover';
            this.applyPosition(position);

            UI.showToast('Background image set successfully!');
        } catch (error) {
            UI.showToast('Failed to set background: ' + error.message);
        }
    },

    applyPosition(position) {
        const body = document.body;
        body.style.backgroundSize = '';
        body.style.backgroundPosition = '';
        body.style.backgroundRepeat = '';

        const positions = {
            'cover': { size: 'cover', position: 'center', repeat: 'no-repeat' },
            'contain': { size: 'contain', position: 'center', repeat: 'no-repeat' },
            'stretch': { size: '100% 100%', repeat: 'no-repeat' },
            'stretch-horizontal': { size: '100% auto', position: 'center', repeat: 'no-repeat' },
            'stretch-vertical': { size: 'auto 100%', position: 'center', repeat: 'no-repeat' },
            'center': { size: 'auto', position: 'center', repeat: 'no-repeat' },
            'tile': { size: 'auto', position: 'top left', repeat: 'repeat' }
        };

        const config = positions[position];
        if (config) {
            body.style.backgroundSize = config.size;
            if (config.position) body.style.backgroundPosition = config.position;
            body.style.backgroundRepeat = config.repeat;
        }

        Utils.safeLocalStorageSet('backgroundPosition', position);
    },

    applyBlur(blurLevel) {
        const overlay = document.querySelector('.overlay');
        overlay.className = 'overlay';

        if (blurLevel !== 'medium-blur') {
            overlay.classList.add(blurLevel);
        }

        Utils.safeLocalStorageSet('backgroundBlur', blurLevel);
    },

    async clear() {
        try { await ImageStore.delete(this.IMG_KEY); } catch { /* ignore */ }
        localStorage.removeItem('backgroundImage');
        localStorage.removeItem('backgroundPosition');
        document.body.style.backgroundImage = 'none';
        UI.showToast('Background image cleared!');
    },

    async load() {
        const bgPosition = localStorage.getItem('backgroundPosition') || 'cover';
        const bgBlur = localStorage.getItem('backgroundBlur') || 'medium-blur';

        const bgPositionSelect = document.getElementById('bgPosition');
        const bgBlurSelect = document.getElementById('bgBlur');
        if (bgPositionSelect) bgPositionSelect.value = bgPosition;
        if (bgBlurSelect) bgBlurSelect.value = bgBlur;
        this.applyBlur(bgBlur);

        // One-time migration: an image left in localStorage by an older build is
        // moved into IndexedDB, freeing the (often multi-MB) quota it was holding.
        const legacy = localStorage.getItem('backgroundImage');
        if (legacy) {
            try {
                await ImageStore.set(this.IMG_KEY, legacy);
                localStorage.removeItem('backgroundImage'); // only after a confirmed write
            } catch { /* keep the localStorage copy as a fallback */ }
        }

        let bgImage = null;
        try { bgImage = await ImageStore.get(this.IMG_KEY); } catch { /* ignore */ }
        if (!bgImage) bgImage = legacy; // fallback if IndexedDB is unavailable

        if (bgImage) {
            document.body.style.backgroundImage = `url(${bgImage})`;
            this.applyPosition(bgPosition);
        }
    }
};

// ========================================
// VIEW MANAGER
// ========================================

const ViewManager = {
    setGridView() {
        AppState.currentView = 'grid';
        document.getElementById('gridView').classList.add('active');
        document.getElementById('listView').classList.remove('active');
        Utils.safeLocalStorageSet('view', 'grid');
        if (window.UIRenderer) UIRenderer.render();
    },

    setListView() {
        AppState.currentView = 'list';
        document.getElementById('listView').classList.add('active');
        document.getElementById('gridView').classList.remove('active');
        Utils.safeLocalStorageSet('view', 'list');
        if (window.UIRenderer) UIRenderer.render();
    },

    updateIconSize(size) {
        AppState.iconSize = parseInt(size);
        Utils.safeLocalStorageSet('iconSize', size);

        const sizeLabel = document.getElementById('sizeLabel');
        if (sizeLabel) {
            sizeLabel.textContent = `${size}px`;
        }

        // updateIconSizes() sets the CSS custom properties; no full DOM rebuild is
        // needed because the grid reads from --card-size / --icon-size via CSS.
        if (window.UIRenderer) {
            UIRenderer.updateIconSizes();
        }
    }
};

// ========================================
// UI UTILITIES
// ========================================

const UI = {
    showToast(message) {
        const existingToast = document.querySelector('.toast');
        if (existingToast) existingToast.remove();

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 3000);
    },

    showUndoToast(message, undoCallback, duration = 5000) {
        const existingToast = document.querySelector('.toast');
        if (existingToast) existingToast.remove();

        const toast = document.createElement('div');
        toast.className = 'toast undo-toast';
        toast.innerHTML = `
            <span class="toast-message">${Utils.sanitizeHTML(message)}</span>
            <button class="toast-undo-btn">Undo</button>
        `;

        toast.querySelector('.toast-undo-btn').addEventListener('click', () => {
            undoCallback();
            toast.remove();
        });

        document.body.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, duration);
    },

    showUnsavedChangesDialog({ onSaveAndClose, onCloseWithout, onGoBack }) {
        const existing = document.querySelector('.confirm-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `
            <div class="confirm-dialog">
                <p>You have unsaved changes.</p>
                <div class="confirm-dialog-buttons">
                    <button class="confirm-btn primary" data-action="save">Save Changes and Close</button>
                    <button class="confirm-btn danger" data-action="close">Close Without Saving</button>
                    <button class="confirm-btn" data-action="back">Back to Modal</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('show'));

        const dismiss = () => {
            overlay.classList.remove('show');
            setTimeout(() => overlay.remove(), 200);
        };

        overlay.addEventListener('click', (e) => {
            const action = e.target.dataset?.action;
            if (action === 'save')  { dismiss(); onSaveAndClose(); }
            if (action === 'close') { dismiss(); onCloseWithout(); }
            if (action === 'back')  { dismiss(); onGoBack(); }
        });
    }
};

// ========================================
// UTILITY FUNCTIONS
// ========================================

const Utils = {
    sanitizeHTML(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    safeJSONParse(str, fallback = null) {
        try {
            return JSON.parse(str);
        } catch {
            return fallback;
        }
    },

    safeLocalStorageSet(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                UI.showToast('Storage full! Try removing the background image or clearing app data.');
            }
            return false;
        }
    },

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = (error) => {
                reject(new Error('Failed to read file: ' + (error.message || 'Unknown error')));
            };
            reader.readAsDataURL(file);
        });
    },

    isBase64Image(str) {
        if (!str) return false;
        return str.startsWith('data:image/');
    },

    // Validate a website/link URL before it is saved or navigated to.
    // Blocks javascript:/data:/vbscript:/blob: (and any other non-allowlisted
    // scheme) style execution vectors, since those can run arbitrary code in
    // the app's origin when clicked. Bare domains/paths with no explicit
    // scheme (e.g. "example.com") are left untouched — they can't execute
    // script and are opened as normal http(s)-ish links by the browser.
    isSafeUrl(url) {
        if (typeof url !== 'string') return false;
        const trimmed = url.trim();
        if (!trimmed) return false;

        // A scheme needs 2+ chars: this deliberately does NOT treat a single
        // letter followed by ':' (e.g. "C:/Tools/app.exe") as a scheme, so bare
        // Windows drive paths pass through. No script-executing scheme is one
        // char (javascript/data/vbscript/blob are all longer), so this is safe.
        const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.\-]+):/i);
        if (!schemeMatch) return true; // no explicit scheme — not a script vector

        const allowedSchemes = ['http', 'https', 'file', 'mailto', 'tel'];
        return allowedSchemes.includes(schemeMatch[1].toLowerCase());
    },

    // Focus trap for modal dialogs
    trapFocus(modal) {
        const focusable = modal.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
        );
        if (focusable.length === 0) return null;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        const handler = (e) => {
            if (e.key !== 'Tab') return;
            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        modal.addEventListener('keydown', handler);
        first.focus();
        return handler;
    },

    releaseFocus(modal, handler) {
        if (handler) modal.removeEventListener('keydown', handler);
    },

    // Validate CSS color value — only allow safe formats
    isValidColor(str) {
        if (!str || typeof str !== 'string') return false;
        return /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.,\s/%]+\)|hsla?\(\s*[\d.,\s/%deg]+\)|[a-zA-Z]{3,20})$/.test(str.trim());
    }
};
