// ==========================================
// 3.1-STORAGE-METER.JS
// Anderson Homepage
//
// Contents:
// - StorageMeter (localStorage usage widget, split from 3-app-init.js)
// ==========================================

// ========================================
// STORAGE CAPACITY METER
// Shows localStorage usage in the footer and warns as it approaches the
// browser's ~5 MB quota (past which writes silently fail).
// ========================================

const StorageMeter = {
    LIMIT_BYTES: 5 * 1024 * 1024,
    _timer: null,

    // Approximate bytes in localStorage. The engine stores UTF-16, but this
    // app's data is overwhelmingly ASCII (JSON + base64), so 1 char ≈ 1 byte
    // tracks the real quota closely and keeps the "/ 5 MB" reference honest.
    usedBytes() {
        let total = 0;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key == null) continue;
                total += key.length + (localStorage.getItem(key) || '').length;
            }
        } catch { /* localStorage unavailable */ }
        return total;
    },

    update() {
        const meter = document.getElementById('storageMeter');
        const fill = document.getElementById('storageMeterFill');
        const text = document.getElementById('storageMeterText');
        if (!meter || !fill || !text) return;

        const used = this.usedBytes();
        const pct = (used / this.LIMIT_BYTES) * 100;
        const usedMB = used / (1024 * 1024);
        const limitMB = this.LIMIT_BYTES / (1024 * 1024);

        fill.style.width = Math.min(100, pct).toFixed(1) + '%';

        let label = `Storage: ${usedMB.toFixed(2)} MB / ${limitMB.toFixed(0)} MB (${Math.round(pct)}%)`;
        meter.classList.remove('is-warn', 'is-danger');
        if (pct >= 90) {
            meter.classList.add('is-danger');
            label += pct >= 100 ? ' — FULL' : ' — nearly full';
        } else if (pct >= 75) {
            meter.classList.add('is-warn');
        }
        text.textContent = label;
    },

    start() {
        this.update();
        if (this._timer) clearInterval(this._timer);
        // Refresh periodically so the meter reflects ongoing edits.
        this._timer = setInterval(() => this.update(), 2000);
    }
};
