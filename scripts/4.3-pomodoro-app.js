// ==========================================
// 4.3-POMODORO-APP.JS - Pomodoro Timer Module (app + bootstrap family)
// Anderson Homepage
//
// Split out of 4-pomodoro.js; loads last so bootstrap sees every object.
// Contents:
// - PomodoroApp (main controller)
// - bootstrap (auto-init + window.* exports)
// ==========================================

// ========================================
// POMODORO APP CONTROLLER
// ========================================

const PomodoroApp = {
    init() {
        // Guard against double-init: both this file's auto-init and 3-app-init.js
        // call PomodoroApp.init(). Without this, every UI listener gets bound twice,
        // and the (non-idempotent) card toggle would fire twice per click — showing
        // then immediately hiding the card, so nothing appears.
        if (this._initialized) return;
        this._initialized = true;

        // Initialize all sub-modules
        PomodoroTimer.init();
        PomodoroAudio.init();
        PomodoroHistory.init();
        
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.createUI();
                PomodoroUI.init();
            });
        } else {
            this.createUI();
            PomodoroUI.init();
        }
        
    },
    
    createUI() {
        // This will be created by the HTML/CSS files
        // But we'll add the structure here for reference
        
        // Check if toolbar exists, if not create it
        if (!document.getElementById('pomodoroToolbar')) {
            const toolbar = document.createElement('div');
            toolbar.id = 'pomodoroToolbar';
            toolbar.className = 'pomodoro-toolbar';
            toolbar.innerHTML = `
                <button id="pomodoroTimerBtn" class="pomodoro-toolbar-btn" title="Toggle Pomodoro Timer" aria-label="Toggle Pomodoro Timer">
                    <img src="Pomodoro.png" alt="" class="pomodoro-btn-icon" draggable="false">
                </button>
            `;
            document.body.appendChild(toolbar);
        }
        
        // Check if Pomodoro screen exists (created by HTML file if absent)
        
        // Set initial preset highlight based on default time
        setTimeout(() => {
            const defaultMinutes = Math.floor(PomodoroState.targetTime / 60);
            if (PomodoroState.settings.presets.includes(defaultMinutes)) {
                PomodoroUI.highlightPreset(defaultMinutes);
            }
        }, 100);
    }
};

// ========================================
// INITIALIZATION
// ========================================

// Initialize when imported or when DOM is ready
if (typeof window !== 'undefined') {
    // Auto-initialize
    PomodoroApp.init();
    
    // Expose to global scope for debugging
    window.PomodoroApp = PomodoroApp;
    window.PomodoroTimer = PomodoroTimer;
    window.PomodoroState = PomodoroState;
    window.PomodoroHistory = PomodoroHistory;
    window.PomodoroUI = PomodoroUI;
    window.PomodoroAudio = PomodoroAudio;
}