// ==========================================
// DB-MANAGER.JS - SQLite Database Persistence
// Anderson Homepage
//
// Three layers of backup:
// 1. IndexedDB (automatic, survives partial cache clears)
// 2. File System Access API (auto-save to .db on disk, if supported)
// 3. Manual Download/Restore (works everywhere)
//
// LAZY INIT: DbManager.init() is called by bootstrapDbManager() which is
// invoked only after App.loadDbModule() fires — itself deferred to idle time
// via requestIdleCallback/setTimeout in 3-app-init.js. The SQLite WASM engine
// (~850 KB) is therefore never decoded on the critical path. Within init() the
// WASM is decoded and the DB loaded; until isReady===true all save hooks are
// no-ops.  initSqlJs is provided by lib/sql-wasm.js (loaded just before this
// file), and SQL_WASM_BINARY by lib/sql-wasm-binary.js (base64-encoded binary).
// ==========================================

const DbManager = {
    db: null,
    SQL: null,
    fileHandle: null,
    isReady: false,
    _saveTimer: null,
    _isSaving: false,
    _pendingSave: false,
    _needsPermissionGesture: false,

    // Debounce window for the SQLite export (this.db.export() serializes the
    // ENTIRE database — several MB — synchronously on the main thread). A long
    // window lets scattered localStorage writes (checkbox toggles, theme
    // changes, etc.) coalesce into far fewer exports. Any pending save is
    // flushed immediately on tab-hide/close (see _flushSave() and the
    // visibilitychange/pagehide/beforeunload listeners below), so the longer
    // window does not risk losing recent edits.
    SAVE_DEBOUNCE_MS: 30000,
    // Set to true once init() has been called so callers can check readiness
    // without waiting for the async promise to settle.
    _initStarted: false,

    // All localStorage keys the app uses — mirrors Storage.ALL_APP_KEYS in
    // 1-core-managers.js so that the SQLite mirror and the JSON export stay in
    // sync. 'backgroundImage' is intentionally absent: it lives in IndexedDB
    // (ImageStore) and can be many MBs; storing it in a SQLite TEXT column would
    // make the .db file enormous. calendarBuckets is a large cached-data key
    // that is also excluded from the mirror for the same reason.
    APP_KEYS: [
        'websites', 'groups', 'theme', 'view', 'iconSize',
        'backgroundPosition', 'backgroundBlur',
        'calendarProxyUrl', 'calendarProxyToken', 'calendarSources',
        'calendarRefreshInterval', 'calendarDaysAhead', 'calendarGrouping', 'calendarSecondaryTz', 'calendarHeight',
        'calendarCountdownPlacement', 'calendarCountdownWindow',
        'calendarCountdownWarnMins', 'calendarCountdownUrgentMins',
        'calendarUpcomingBarCount', 'calendarUpcomingBarFormat',
        'calendarCachedEvents', 'calendarLastFetched',
        'columnLayout', 'timezone1', 'timezone2', 'timezone3', 'timezone4',
        'timezone1Label', 'timezone2Label', 'timezone3Label', 'timezone4Label',
        'pomodoroState', 'pomodoroHistory', 'todos', 'todoArchive', 'todoDoneArchive',
        'todoFontSettings', 'calendarFontSettings',
        'virtualGroupPositions', 'minimapOpen',
        'claudeProjectsSettings', 'claudeProjectsNames'
    ],

    // ===================== "Effectively empty" localStorage detection =====================
    // WHY this exists: Storage.load() in 1-core-managers.js (see its ~94-118) runs
    // synchronously on every page load, long before DbManager.init() gets a chance to
    // run (init() is deferred to idle time — see the file header above). The moment
    // Storage.load() finds no valid saved groups, it immediately writes a DEFAULT
    // group (id 'ungrouped') back to localStorage via this.save() — which also
    // (re)writes 'websites' as '[]' if there were none. So by the time we get here,
    // localStorage.getItem('groups') is NEVER null, even on a truly fresh/cleared
    // browser: it already holds '[{"id":"ungrouped",...}]'. A naive
    // `!localStorage.getItem('groups')` check is therefore always false, which (a)
    // makes the `if (lsEmpty && dbHasData)` auto-restore branch below permanently
    // unreachable, and (b) sends execution into the `if (!lsEmpty)` branch instead,
    // which syncs these freshly-written EMPTY defaults into the SQLite backup —
    // permanently overwriting a real backup with nothing.
    //
    // To detect "nothing meaningful was ever here" correctly, we must treat a
    // 'websites' value that is absent or an empty array, together with a 'groups'
    // value that is absent OR contains only the single default 'ungrouped' group,
    // as still effectively empty — i.e. we see through Storage.load()'s default-
    // write rather than being fooled by it.
    //
    // Malformed JSON is treated conservatively as NON-empty (real/unknown data
    // present) so a parse hiccup can never trigger a restore that clobbers real
    // data — we only ever fall back to the DEFAULT (safe) path in that case.

    // Parses JSON, returning `undefined` (a sentinel distinct from a legitimately
    // parsed `null`) if parsing fails. Deliberately NOT Utils.safeJSONParse, whose
    // fallback value is indistinguishable from a successful-but-empty parse — we
    // need to tell "parse failed" apart from "parsed to empty" here.
    _parseOrUndefined(str) {
        try {
            return JSON.parse(str);
        } catch {
            return undefined;
        }
    },

    // True when the 'websites' localStorage value represents "no websites ever
    // saved": key absent, or parses to an empty array. Malformed JSON => false
    // (conservative — treated as real/unknown data).
    _isWebsitesEffectivelyEmpty(raw) {
        if (raw === null) return true;
        const parsed = this._parseOrUndefined(raw);
        if (parsed === undefined) return false;
        return Array.isArray(parsed) && parsed.length === 0;
    },

    // True when the 'groups' localStorage value represents "no groups ever saved
    // by the user": key absent, or parses to an array containing ONLY the single
    // default group Storage.load() auto-writes (id 'ungrouped'). Malformed JSON
    // => false (conservative — treated as real/unknown data).
    _isGroupsEffectivelyEmpty(raw) {
        if (raw === null) return true;
        const parsed = this._parseOrUndefined(raw);
        if (parsed === undefined) return false;
        return Array.isArray(parsed) && parsed.length === 1 && parsed[0]?.id === 'ungrouped';
    },

    // ===================== Lazy initialisation =====================
    // init() is only called from bootstrapDbManager(), which is itself only
    // executed after the page has painted (see bottom of this file + 3-app-init.js).
    // Nothing above calls init() eagerly, so the WASM decode never runs at load time.

    async init() {
        if (this._initStarted) return; // guard against double-call
        this._initStarted = true;
        try {
            // Decode the base64-embedded WASM binary. This is the expensive step
            // (~850 KB atob + Uint8Array allocation) and is intentionally deferred
            // to idle time via requestIdleCallback in App.loadDbModule().
            const wasmBinary = await this._loadWasm();
            this.SQL = await initSqlJs({ wasmBinary });

            // Try to load database: file handle → IndexedDB backup → fresh
            let loaded = false;

            this.fileHandle = await this._getStoredHandle();
            if (this.fileHandle) {
                loaded = await this._loadFromHandle();
            }

            if (!loaded) {
                loaded = await this._loadFromIdb();
            }

            if (!loaded) {
                this.db = new this.SQL.Database();
                this._createSchema();
            }

            this.isReady = true;
            this._hookSaves();

            // Detect data loss: localStorage empty but SQLite backup has data.
            // "Empty" here means "effectively empty" — see _isWebsitesEffectivelyEmpty()/
            // _isGroupsEffectivelyEmpty() above for why the naive presence check
            // (`!localStorage.getItem(...)`) is wrong: Storage.load() always writes
            // the default 'ungrouped' group (and '[]' websites) before we get here.
            const lsEmpty = this._isWebsitesEffectivelyEmpty(localStorage.getItem('websites'))
                && this._isGroupsEffectivelyEmpty(localStorage.getItem('groups'));
            const dbHasData = this._hasData();

            if (lsEmpty && dbHasData) {
                // Auto-restore — disable saves during reload to avoid overwriting the
                // just-restored data with empty localStorage contents.
                this.isReady = false;
                this._restoreToLocalStorage();
                this._updateUI();
                UI.showToast('Data restored from backup! Refreshing...');
                setTimeout(() => location.reload(), 1200);
                return;
            }

            if (lsEmpty && !dbHasData) {
                this._addRestoreHint();
            }

            if (!lsEmpty) {
                this._syncAllToDb();
                this._debouncedSave();
            }

            this._updateUI();
        } catch (err) {
            console.warn('DbManager: SQLite unavailable —', err.message);
            this.isReady = false;
            this._updateUI();
        }
    },

    // Decode the base64-embedded WASM binary (avoids CORS issues on file://).
    // Only called from init(), which itself only runs after idle-time deferral.
    _loadWasm() {
        if (typeof SQL_WASM_BINARY !== 'string') {
            return Promise.reject(new Error('SQL_WASM_BINARY not loaded'));
        }
        const raw = atob(SQL_WASM_BINARY);
        const buf = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
        return Promise.resolve(buf.buffer);
    },

    _createSchema() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS app_data (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);
    },

    // Hook into Utils.safeLocalStorageSet so every write triggers a debounced
    // SQLite sync. The hook is installed only after init() succeeds, so early
    // writes (before the WASM loads) pass through unchanged.
    _hookSaves() {
        if (!window.Utils?.safeLocalStorageSet) return;
        const original = Utils.safeLocalStorageSet.bind(Utils);
        Utils.safeLocalStorageSet = (key, value) => {
            const result = original(key, value);
            if (this.isReady) this._debouncedSave();
            return result;
        };
    },

    // ===================== Sync helpers =====================

    _syncAllToDb() {
        if (!this.db) return;
        const stmt = this.db.prepare(
            'INSERT OR REPLACE INTO app_data (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))'
        );
        try {
            this.APP_KEYS.forEach(key => {
                const value = localStorage.getItem(key);
                if (value !== null) {
                    stmt.run([key, value]);
                } else {
                    this.db.run('DELETE FROM app_data WHERE key = ?', [key]);
                }
            });
        } finally {
            stmt.free();
        }
    },

    _restoreToLocalStorage() {
        if (!this.db) return;
        const results = this.db.exec('SELECT key, value FROM app_data');
        if (results.length === 0) return;
        const allowed = new Set(this.APP_KEYS);
        results[0].values.forEach(([key, value]) => {
            if (allowed.has(key) && value !== null && value !== undefined) {
                try {
                    localStorage.setItem(key, value);
                } catch (e) {
                    console.warn('DbManager: Could not restore key', key, '—', e.message);
                }
            }
        });
    },

    _hasData() {
        if (!this.db) return false;
        try {
            const r = this.db.exec('SELECT COUNT(*) FROM app_data WHERE key IN ("websites","groups")');
            return r.length > 0 && r[0].values[0][0] > 0;
        } catch {
            return false;
        }
    },

    // ===================== Save (IDB + optional file) =====================

    _debouncedSave() {
        // Resets the timer on every call, so scattered writes within the
        // window coalesce into a single save instead of firing once per write.
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            this._save();
        }, this.SAVE_DEBOUNCE_MS);
    },

    // Cancels any pending debounced save and runs the save immediately, once.
    // Called when the tab is hidden or being unloaded so the long debounce
    // window above never risks losing recent edits. _save() itself is async
    // (IndexedDB + optional file write); on pagehide/beforeunload there's no
    // hard guarantee the browser lets it finish, but this is best-effort and
    // is the standard pattern for flush-on-hide. visibilitychange->hidden
    // (fired before pagehide/unload in normal tab-close/tab-switch flows)
    // gives the async work real time to complete since the page isn't being
    // torn down yet.
    _flushSave() {
        if (!this.isReady) return;
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        this._save();
    },

    async _save() {
        if (!this.isReady) return;
        if (this._isSaving) {
            this._pendingSave = true;
            return;
        }
        this._isSaving = true;
        try {
            this._syncAllToDb();
            const data = this.db.export();

            // Always save to IndexedDB (works on all browsers/protocols)
            await this._saveToIdb(data);

            // Also save to file if connected
            if (this.fileHandle) {
                let writable = null;
                try {
                    writable = await this.fileHandle.createWritable();
                    await writable.write(data);
                    await writable.close();
                    writable = null;
                    this._updateUI('saved');
                } catch (err) {
                    if (writable) {
                        try { await writable.abort(); } catch { /* ignore */ }
                    }
                    console.warn('DbManager: File save failed —', err.message);
                    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
                        this.fileHandle = null;
                        await this._clearStoredHandle();
                        this._updateUI();
                    }
                }
            }
        } catch (err) {
            console.warn('DbManager: Save failed —', err.message);
        } finally {
            this._isSaving = false;
            if (this._pendingSave) {
                this._pendingSave = false;
                // Re-run immediately (not via _debouncedSave()) — a pending save
                // here means _save() was called again while an export was
                // already in flight (e.g. _flushSave() colliding with an
                // in-progress save). Rescheduling through the debounce would
                // wait another full SAVE_DEBOUNCE_MS (30s), which would defeat
                // the flush-on-hide guarantee that a save happens right away.
                this._save();
            }
        }
    },

    // ===================== Public actions =====================

    async connectFile() {
        if (!this.isReady) {
            UI.showToast('Database engine not ready yet.');
            return;
        }
        if (!window.showSaveFilePicker) {
            UI.showToast('File auto-save requires Chrome or Edge. Data is still backed up to IndexedDB automatically.');
            return;
        }
        try {
            this.fileHandle = await window.showSaveFilePicker({
                suggestedName: 'anderson-homepage.db',
                types: [{
                    description: 'SQLite Database',
                    accept: { 'application/x-sqlite3': ['.db'] }
                }]
            });
            this._needsPermissionGesture = false;
            await this._storeHandle(this.fileHandle);
            await this._save();
            this._updateUI();
            UI.showToast('Database connected! Data will auto-save to this file.');
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('DbManager connect:', err);
                UI.showToast('Failed to connect database file.');
            }
        }
    },

    async reconnectFile() {
        if (!this.fileHandle) return;
        try {
            const perm = await this.fileHandle.requestPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                this._needsPermissionGesture = false;
                await this._save();
                this._updateUI();
                UI.showToast('Database reconnected!');
            } else {
                UI.showToast('Permission denied. Try Set Save Location to pick the file again.');
            }
        } catch {
            UI.showToast('Could not reconnect. Try Set Save Location to pick the file again.');
        }
    },

    async disconnectFile() {
        this.fileHandle = null;
        this._needsPermissionGesture = false;
        await this._clearStoredHandle();
        this._updateUI();
        UI.showToast('File disconnected. IndexedDB backup still active.');
    },

    async restoreFromFile() {
        if (!this.SQL) {
            UI.showToast('Database engine not ready.');
            return;
        }

        let file = null;
        let handle = null;

        if (window.showOpenFilePicker) {
            try {
                [handle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'SQLite Database',
                        accept: { 'application/x-sqlite3': ['.db', '.sqlite', '.sqlite3'] }
                    }]
                });
                file = await handle.getFile();
            } catch (err) {
                if (err.name === 'AbortError') return;
                handle = null;
            }
        }

        if (!file) {
            file = await this._pickFileInput();
            if (!file) return;
        }

        try {
            const buffer = await file.arrayBuffer();
            const tempDb = new this.SQL.Database(new Uint8Array(buffer));

            // Verify schema
            const tables = tempDb.exec(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='app_data'"
            );
            if (tables.length === 0) {
                tempDb.close();
                UI.showToast('Not a valid Anderson Homepage database file.');
                return;
            }

            const count = tempDb.exec('SELECT COUNT(*) FROM app_data');
            if (count.length === 0 || count[0].values[0][0] === 0) {
                tempDb.close();
                UI.showToast('Database file is empty.');
                return;
            }

            // Use this database
            if (this.db) this.db.close();
            this.db = tempDb;

            // Also connect this file for auto-save
            if (handle) {
                try {
                    const perm = await handle.requestPermission({ mode: 'readwrite' });
                    if (perm === 'granted') {
                        this.fileHandle = handle;
                        await this._storeHandle(handle);
                    }
                } catch { /* read-only fine */ }
            }

            // Disable saves before restoring, then reload
            this.isReady = false;
            this._restoreToLocalStorage();

            // Also update IndexedDB backup with restored data
            try { await this._saveToIdb(this.db.export()); } catch { /* ignore */ }

            UI.showToast('Data restored! Refreshing...');
            setTimeout(() => location.reload(), 1200);
        } catch (err) {
            console.error('DbManager restore:', err);
            UI.showToast('Failed to read database file.');
        }
    },

    downloadBackup() {
        if (!this.isReady || !this.db) {
            UI.showToast('Database not available.');
            return;
        }
        this._syncAllToDb();
        const data = this.db.export();
        const blob = new Blob([data], { type: 'application/x-sqlite3' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `anderson-homepage-${new Date().toISOString().slice(0, 10)}.db`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        UI.showToast('Database backup downloaded.');
    },

    _pickFileInput() {
        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.db,.sqlite,.sqlite3';
            input.onchange = () => resolve(input.files[0] || null);
            input.addEventListener('cancel', () => resolve(null));
            input.click();
        });
    },

    // ===================== IndexedDB storage =====================

    _idbOpen() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('AndersonHomepageDb', 2);
            req.onupgradeneeded = e => {
                const idb = e.target.result;
                if (!idb.objectStoreNames.contains('handles')) idb.createObjectStore('handles');
                if (!idb.objectStoreNames.contains('dbBackup')) idb.createObjectStore('dbBackup');
            };
            req.onsuccess = e => resolve(e.target.result);
            req.onerror = () => reject(req.error);
        });
    },

    async _saveToIdb(data) {
        try {
            const idb = await this._idbOpen();
            const tx = idb.transaction('dbBackup', 'readwrite');
            tx.objectStore('dbBackup').put(data, 'latestBackup');
            await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
            idb.close();
        } catch (err) {
            console.warn('DbManager: IDB backup failed —', err.message);
        }
    },

    async _loadFromIdb() {
        try {
            const idb = await this._idbOpen();
            const tx = idb.transaction('dbBackup', 'readonly');
            const req = tx.objectStore('dbBackup').get('latestBackup');
            const data = await new Promise((res, rej) => {
                req.onsuccess = () => res(req.result || null);
                req.onerror = () => rej(req.error);
            });
            idb.close();

            if (!data || data.byteLength === 0) return false;

            this.db = new this.SQL.Database(new Uint8Array(data));
            const tables = this.db.exec(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='app_data'"
            );
            if (tables.length === 0) this._createSchema();
            return true;
        } catch {
            return false;
        }
    },

    async _storeHandle(handle) {
        try {
            const idb = await this._idbOpen();
            const tx = idb.transaction('handles', 'readwrite');
            tx.objectStore('handles').put(handle, 'dbFileHandle');
            await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
            idb.close();
        } catch (err) {
            console.warn('DbManager: Could not store handle —', err.message);
        }
    },

    async _getStoredHandle() {
        try {
            const idb = await this._idbOpen();
            const tx = idb.transaction('handles', 'readonly');
            const req = tx.objectStore('handles').get('dbFileHandle');
            const result = await new Promise((res, rej) => {
                req.onsuccess = () => res(req.result || null);
                req.onerror = () => rej(req.error);
            });
            idb.close();
            return result;
        } catch {
            return null;
        }
    },

    async _clearStoredHandle() {
        try {
            const idb = await this._idbOpen();
            const tx = idb.transaction('handles', 'readwrite');
            tx.objectStore('handles').delete('dbFileHandle');
            await new Promise(res => { tx.oncomplete = res; });
            idb.close();
        } catch { /* ignore */ }
    },

    async _loadFromHandle() {
        try {
            const state = await this.fileHandle.queryPermission({ mode: 'readwrite' });
            if (state === 'prompt') {
                this._needsPermissionGesture = true;
                return false;
            }
            if (state !== 'granted') {
                this.fileHandle = null;
                await this._clearStoredHandle();
                return false;
            }

            const file = await this.fileHandle.getFile();
            const buffer = await file.arrayBuffer();

            if (buffer.byteLength === 0) {
                this.db = new this.SQL.Database();
                this._createSchema();
                return true;
            }

            this.db = new this.SQL.Database(new Uint8Array(buffer));
            const tables = this.db.exec(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='app_data'"
            );
            if (tables.length === 0) this._createSchema();
            return true;
        } catch (err) {
            console.warn('DbManager: Load from handle failed —', err.message);
            this.fileHandle = null;
            return false;
        }
    },

    // ===================== UI =====================

    _addRestoreHint() {
        const emptyState = document.getElementById('emptyState');
        if (!emptyState) return;
        const p = document.createElement('p');
        p.style.marginTop = '1rem';
        p.innerHTML = '<button id="emptyRestoreBtn" style="padding:0.5rem 1.2rem;cursor:pointer;">Restore from Database Backup</button>';
        emptyState.appendChild(p);
        document.getElementById('emptyRestoreBtn')?.addEventListener('click', () => this.restoreFromFile());
    },

    _updateUI(event) {
        const dot = document.getElementById('dbStatusDot');
        const text = document.getElementById('dbStatusText');
        const connectBtn = document.getElementById('dbConnectBtn');
        const disconnectBtn = document.getElementById('dbDisconnectBtn');
        const reconnectBtn = document.getElementById('dbReconnectBtn');
        const downloadBtn = document.getElementById('dbDownloadBtn');

        if (!dot || !text) return;

        if (!this.isReady) {
            dot.className = 'db-status-dot error';
            text.textContent = 'SQLite engine unavailable';
            if (connectBtn) connectBtn.disabled = true;
            if (downloadBtn) downloadBtn.disabled = true;
            return;
        }

        if (downloadBtn) downloadBtn.disabled = false;

        if (this._needsPermissionGesture) {
            dot.className = 'db-status-dot';
            text.textContent = 'File needs re-authorization (IndexedDB active)';
            if (connectBtn) connectBtn.style.display = 'none';
            if (disconnectBtn) disconnectBtn.style.display = '';
            if (reconnectBtn) reconnectBtn.style.display = '';
        } else if (this.fileHandle) {
            dot.className = 'db-status-dot connected';
            text.textContent = event === 'saved'
                ? `Auto-saving — last saved ${new Date().toLocaleTimeString()}`
                : 'Auto-saving to file & IndexedDB';
            if (connectBtn) connectBtn.style.display = 'none';
            if (disconnectBtn) disconnectBtn.style.display = '';
            if (reconnectBtn) reconnectBtn.style.display = 'none';
        } else {
            dot.className = 'db-status-dot connected';
            text.textContent = 'Auto-saving to IndexedDB';
            if (connectBtn) { connectBtn.style.display = ''; connectBtn.disabled = false; }
            if (disconnectBtn) disconnectBtn.style.display = 'none';
            if (reconnectBtn) reconnectBtn.style.display = 'none';
        }
    }
};

window.DbManager = DbManager;

function bootstrapDbManager() {
    // init() is lazy: it decodes the WASM binary and opens the DB. This function
    // itself is only called after App.loadDbModule() fires at idle time, so the
    // heavy work never runs on the critical path.
    DbManager.init();

    document.getElementById('dbConnectBtn')?.addEventListener('click', () => DbManager.connectFile());
    document.getElementById('dbDisconnectBtn')?.addEventListener('click', () => DbManager.disconnectFile());
    document.getElementById('dbReconnectBtn')?.addEventListener('click', () => DbManager.reconnectFile());
    document.getElementById('dbRestoreBtn')?.addEventListener('click', () => DbManager.restoreFromFile());
    document.getElementById('dbDownloadBtn')?.addEventListener('click', () => DbManager.downloadBackup());
}

// This module is lazy-loaded after first paint, so DOMContentLoaded has usually
// already fired by the time it runs — bootstrap immediately in that case.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapDbManager);
} else {
    bootstrapDbManager();
}

// Flush any pending debounced SQLite export immediately when the user tabs
// away or closes/reloads the page, so the 30s debounce window in
// _debouncedSave() never risks losing recent edits. visibilitychange->hidden
// fires first in normal tab-switch/close flows and gives the async save real
// time to complete; pagehide/beforeunload are best-effort backstops for the
// less common cases where visibilitychange doesn't fire first. These listeners
// are registered unconditionally (cheap) — _flushSave() itself no-ops until
// DbManager.isReady is true.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') DbManager._flushSave();
});
window.addEventListener('pagehide', () => DbManager._flushSave());
window.addEventListener('beforeunload', () => DbManager._flushSave());
