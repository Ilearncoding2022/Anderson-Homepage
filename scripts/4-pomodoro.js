// ==========================================
// 4-POMODORO.JS - Pomodoro Timer Module
// Anderson Homepage v3.0
//
// Contents:
// - PomodoroState (state management)
// - PomodoroTimer (core timer logic)
// - PomodoroAudio (sound management)
// - PomodoroHistory (session tracking)
// - PomodoroUI (UI updates & interactions)
// - PomodoroApp (main controller)
// ==========================================

// ========================================
// POMODORO STATE MANAGEMENT
// ========================================

const PomodoroState = {
    // Current timer state
    isRunning: false,
    isPaused: false,
    currentTime: 0, // in seconds
    targetTime: 25 * 60, // default 25 minutes
    startTime: null,
    pausedTime: 0,
    
    // Session tracking
    currentSession: {
        number: 1,
        targetTime: 25 * 60,
        elapsedTime: 0,
        startedAt: null,
        completedAt: null,
        wasSkipped: false
    },
    
    // Settings
    settings: {
        volume: 70,
        soundIndex: 0,
        soundRepeat: 0, // how many times the alarm plays: 0 = once (no repeat), else N times
        notify: 'on',   // 'on'/'off' — show a system notification when the timer ends
                        // (only 'off' suppresses it; needs browser permission granted)
        sounds: [
            { name: 'Bell', file: 'bell.mp3', url: 'data:audio/mpeg;base64,SUQzAwAAAAAA...' },
            { name: 'Chime', file: 'chime.mp3', url: 'data:audio/mpeg;base64,SUQzAwAAAAAA...' },
            { name: 'Ding', file: 'ding.mp3', url: 'data:audio/mpeg;base64,SUQzAwAAAAAA...' },
            { name: 'Gong', file: 'gong.mp3', url: 'data:audio/mpeg;base64,SUQzAwAAAAAA...' },
            { name: 'Simple', file: 'simple.mp3', url: 'data:audio/mpeg;base64,SUQzAwAAAAAA...' }
        ],
        presets: [1, 3, 5, 10, 15, 30, 45, 60] // in minutes
    },
    
    // UI state
    isVisible: false,
    animationFrame: null
};

// ========================================
// POMODORO TIMER CORE
// ========================================

const PomodoroTimer = {
    init() {
        this.loadState();
        this.setupTimerLoop();
        this.setupVisibilityHandler();

        // Resume timer if it was running when state was saved
        if (PomodoroState.isRunning && !PomodoroState.isPaused) {
            // Recalculate current time from wall clock
            const elapsed = Math.floor((Date.now() - PomodoroState.startTime) / 1000);
            PomodoroState.currentTime = Math.max(0, PomodoroState.targetTime - elapsed);

            if (PomodoroState.currentTime <= 0) {
                // Timer already completed while page was closed
                this.complete();
            } else {
                this.startTimer();
            }
        }
    },

    setupTimerLoop() {
        // Main timer update loop
        this.timerInterval = null;
    },

    setupVisibilityHandler() {
        // Recalculate timer from wall clock when tab becomes visible again
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && PomodoroState.isRunning && !PomodoroState.isPaused) {
                // Immediately recalculate from wall-clock time
                const elapsed = Math.floor((Date.now() - PomodoroState.startTime) / 1000);
                PomodoroState.currentTime = Math.max(0, PomodoroState.targetTime - elapsed);
                PomodoroState.currentSession.elapsedTime = elapsed;

                if (PomodoroState.currentTime <= 0) {
                    this.complete();
                } else {
                    PomodoroUI.updateDisplay();
                }
            }
        });
    },
    
    start() {
        if (PomodoroState.isRunning) {
            return;
        }

        // Ensure we have a valid target time
        if (!PomodoroState.targetTime || PomodoroState.targetTime <= 0) {
            PomodoroState.targetTime = 25 * 60;
        }
        
        PomodoroState.isRunning = true;
        PomodoroState.isPaused = false;
        PomodoroState.startTime = Date.now();
        PomodoroState.pausedTime = 0;
        PomodoroState.currentTime = PomodoroState.targetTime;
        
        // Initialize current session
        PomodoroState.currentSession = {
            number: PomodoroHistory.getNextSessionNumber(),
            targetTime: PomodoroState.targetTime,
            elapsedTime: 0,
            startedAt: new Date().toISOString(),
            completedAt: null,
            wasSkipped: false
        };

        this.startTimer();
        // Kick off the smooth 60fps ring animation now that the timer is
        // actually counting down (no-ops if the card is hidden).
        PomodoroUI.startAnimation();
        this.saveState();
        
        // Add running class to screen
        const screen = document.getElementById('pomodoroScreen');
        if (screen) {
            screen.classList.add('timer-running');
        }
        
        // Update display after a small delay to ensure DOM is ready
        setTimeout(() => {
            PomodoroUI.updateDisplay();
        }, 10);
    },
    
    pause() {
        if (!PomodoroState.isRunning) {
            return;
        }

        if (PomodoroState.isPaused) {
            return;
        }
        
        PomodoroState.isPaused = true;
        PomodoroState.pausedTime = Date.now();

        this.stopTimer();
        // Stop the rAF loop — nothing is changing while paused, so the
        // 100ms tick interval is unnecessary too, and both are now off.
        PomodoroUI.stopAnimation();
        this.saveState();
        
        // Remove running class when paused
        const screen = document.getElementById('pomodoroScreen');
        if (screen) {
            screen.classList.remove('timer-running');
        }
        
        // Delay UI update to prevent race condition
        setTimeout(() => {
            PomodoroUI.updateDisplay();
        }, 50);
    },
    
    resume() {
        if (!PomodoroState.isRunning) {
            return;
        }

        if (!PomodoroState.isPaused) {
            return;
        }
        
        const pauseDuration = Date.now() - PomodoroState.pausedTime;
        PomodoroState.startTime += pauseDuration;
        PomodoroState.isPaused = false;
        PomodoroState.pausedTime = 0;

        this.startTimer();
        // Resume the smooth 60fps ring animation now that we're counting
        // down again (no-ops if the card is hidden).
        PomodoroUI.startAnimation();
        this.saveState();

        // Add running class when resumed
        const screen = document.getElementById('pomodoroScreen');
        if (screen) {
            screen.classList.add('timer-running');
        }
        
        // Delay UI update to prevent race condition
        setTimeout(() => {
            PomodoroUI.updateDisplay();
        }, 50);
    },
    
    reset() {

        this.stopTimer();
        // Stop the rAF loop — the timer is no longer running, so there's
        // nothing left to animate smoothly between ticks.
        PomodoroUI.stopAnimation();

        PomodoroState.isRunning = false;
        PomodoroState.isPaused = false;
        PomodoroState.currentTime = PomodoroState.targetTime;
        PomodoroState.startTime = null;
        PomodoroState.pausedTime = 0;
        
        // Remove running class when reset
        const screen = document.getElementById('pomodoroScreen');
        if (screen) {
            screen.classList.remove('timer-running');
        }
        
        this.saveState();
        PomodoroUI.updateDisplay();
    },
    
    skip() {
        if (!PomodoroState.isRunning) {
            return;
        }
        
        // Calculate elapsed time
        const elapsed = PomodoroState.targetTime - PomodoroState.currentTime;
        
        // Mark session as completed (but skipped)
        PomodoroState.currentSession.elapsedTime = elapsed;
        PomodoroState.currentSession.completedAt = new Date().toISOString();
        PomodoroState.currentSession.wasSkipped = true;
        
        // Save to history
        PomodoroHistory.addSession(PomodoroState.currentSession);
        
        // Remove running class
        const screen = document.getElementById('pomodoroScreen');
        if (screen) {
            screen.classList.remove('timer-running');
        }
        
        // Reset timer
        this.reset();
        
        // Show completion animation
        PomodoroUI.showCompletion(true);
    },
    
    startTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }
        
        this.timerInterval = setInterval(() => {
            this.tick();
        }, 100); // Update every 100ms for smooth animation
    },
    
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    },
    
    tick() {
        if (!PomodoroState.isRunning || PomodoroState.isPaused) {
            return;
        }
        
        try {
            const elapsed = Math.floor((Date.now() - PomodoroState.startTime) / 1000);
            PomodoroState.currentTime = Math.max(0, PomodoroState.targetTime - elapsed);
            PomodoroState.currentSession.elapsedTime = elapsed;
            
            // Update UI
            PomodoroUI.updateDisplay();
            
            // Check if timer completed
            if (PomodoroState.currentTime <= 0) {
                this.complete();
            }
            
            // Save state every second (not every 100ms tick)
            if (Math.floor(elapsed) !== this._lastSavedSecond) {
                this._lastSavedSecond = Math.floor(elapsed);
                this.saveState();
            }
        } catch (error) {
            // Silently continue on tick error
        }
    },
    
    complete() {
        
        // Mark session as completed
        PomodoroState.currentSession.completedAt = new Date().toISOString();
        PomodoroState.currentSession.wasSkipped = false;
        
        // Save to history
        PomodoroHistory.addSession(PomodoroState.currentSession);
        
        // Play sound + (if enabled) a system notification
        const finishedMinutes = Math.max(1, Math.round(PomodoroState.targetTime / 60));
        PomodoroAudio.playNotification();
        PomodoroAudio.showBrowserNotification(finishedMinutes);
        
        // Remove running class
        const screen = document.getElementById('pomodoroScreen');
        if (screen) {
            screen.classList.remove('timer-running');
        }
        
        // Show completion animation
        PomodoroUI.showCompletion(false);
        
        // Reset timer
        this.reset();
    },
    
    setTargetTime(minutes, fromPreset = false) {
        // Only update if timer is not running, or if it's paused
        if (!PomodoroState.isRunning || PomodoroState.isPaused) {
            PomodoroState.targetTime = minutes * 60;
            PomodoroState.currentTime = PomodoroState.targetTime;
            
            // Reset if timer is not running
            if (!PomodoroState.isRunning) {
                this.reset();
            }
            
            // Update UI elements to stay in sync
            if (PomodoroUI.elements.customInput && PomodoroUI.elements.customInput.value != minutes) {
                PomodoroUI.elements.customInput.value = minutes;
            }
            if (PomodoroUI.elements.customSlider && PomodoroUI.elements.customSlider.value != minutes) {
                PomodoroUI.elements.customSlider.value = minutes;
                window.paintRangeFill?.(PomodoroUI.elements.customSlider);
            }
            
            // Update preset highlighting
            if (fromPreset) {
                PomodoroUI.highlightPreset(minutes);
            } else {
                // Clear preset highlighting when using custom time
                PomodoroUI.clearPresetHighlight();
                // Check if custom time matches a preset
                const matchingPreset = PomodoroState.settings.presets.includes(minutes);
                if (matchingPreset) {
                    PomodoroUI.highlightPreset(minutes);
                }
            }
            
            this.saveState();
            PomodoroUI.updateDisplay();
        }
    },
    
    saveState() {
        // Exclude audio base64 data from serialization to avoid bloating localStorage
        const { sounds, ...settingsWithoutSounds } = PomodoroState.settings;
        const stateToSave = {
            isRunning: PomodoroState.isRunning,
            isPaused: PomodoroState.isPaused,
            currentTime: PomodoroState.currentTime,
            targetTime: PomodoroState.targetTime,
            startTime: PomodoroState.startTime,
            pausedTime: PomodoroState.pausedTime,
            currentSession: PomodoroState.currentSession,
            settings: settingsWithoutSounds
        };

        Utils.safeLocalStorageSet('pomodoroState', JSON.stringify(stateToSave));
    },
    
    loadState() {
        const savedState = localStorage.getItem('pomodoroState');
        if (savedState) {
            const state = Utils.safeJSONParse(savedState);
            if (state) {
                // Don't auto-resume if timer was paused
                if (state.isPaused) {
                    state.isRunning = false;
                    state.isPaused = false;
                    state.currentTime = state.targetTime;
                }

                // Restore sounds from the default since they're excluded from serialization
                if (state.settings && !state.settings.sounds) {
                    state.settings.sounds = PomodoroState.settings.sounds;
                }

                Object.assign(PomodoroState, state);
            }
        }
    }
};
