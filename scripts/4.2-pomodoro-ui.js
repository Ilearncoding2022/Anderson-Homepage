// ==========================================
// 4.2-POMODORO-UI.JS - Pomodoro Timer Module (history + UI family)
// Anderson Homepage
//
// Split out of 4-pomodoro.js; loads after 4.1-pomodoro-audio.js.
// Contents:
// - PomodoroHistory (session tracking)
// - PomodoroUI (UI updates & interactions)
// ==========================================

// ========================================
// POMODORO HISTORY TRACKING
// ========================================

const PomodoroHistory = {
    maxSessions: 10,
    
    init() {
        this.loadHistory();
    },
    
    getHistory() {
        const history = localStorage.getItem('pomodoroHistory');
        if (history) {
            return Utils.safeJSONParse(history) ?? [];
        }
        return [];
    },
    
    loadHistory() {
        return this.getHistory();
    },
    
    addSession(session) {
        
        let history = this.getHistory();
        
        // Add new session to beginning
        history.unshift({
            ...session,
            completionRate: Math.round((session.elapsedTime / session.targetTime) * 100)
        });
        
        // Keep only last N sessions
        if (history.length > this.maxSessions) {
            history = history.slice(0, this.maxSessions);
        }
        
        // Save to localStorage
        Utils.safeLocalStorageSet('pomodoroHistory', JSON.stringify(history));
        
        // Update UI
        PomodoroUI.updateHistory();
    },
    
    getNextSessionNumber() {
        const history = this.getHistory();
        if (history.length === 0) {
            return 1;
        }
        return history[0].number + 1;
    },
    
    clearHistory() {
        localStorage.removeItem('pomodoroHistory');
        PomodoroUI.updateHistory();
    },
    
    formatSession(session) {
        const targetMin = Math.floor(session.targetTime / 60);
        const targetSec = session.targetTime % 60;
        const elapsedMin = Math.floor(session.elapsedTime / 60);
        const elapsedSec = session.elapsedTime % 60;
        
        const targetStr = `${targetMin}:${targetSec.toString().padStart(2, '0')}`;
        const elapsedStr = `${elapsedMin}:${elapsedSec.toString().padStart(2, '0')}`;
        
        const status = session.wasSkipped
            ? '<svg class="ico ico-sm" aria-hidden="true"><use href="#ico-skip"></use></svg>'
            : '<svg class="ico ico-sm" aria-hidden="true"><use href="#ico-check"></use></svg>';

        // number/completionRate are coerced rather than interpolated raw: this
        // string goes to an innerHTML sink, and an imported history record can
        // carry any value at all — getHistory() does no per-record normalising.
        return `Session #${Number(session.number) || 0}: ${targetStr} → ${elapsedStr} (${Number(session.completionRate) || 0}%) ${status}`;
    }
};

// ========================================
// POMODORO UI CONTROLLER
// ========================================

const PomodoroUI = {
    elements: {},
    isProcessing: false,  // Flag to prevent double clicks
    
    init() {
        this.relocateUI();
        this.cacheElements();
        this.applySettingsToUI();
        this.attachEventListeners();
        this.updateDisplay();
        this.updateHistory();
    },

    // Sync the saved settings into the controls (volume + repeat). The sound
    // dropdown is restored separately by PomodoroAudio.updateSoundDropdown once
    // the sound list is built.
    applySettingsToUI() {
        const s = PomodoroState.settings;
        if (this.elements.volumeSlider) {
            this.elements.volumeSlider.value = s.volume;
            window.paintRangeFill?.(this.elements.volumeSlider);
        }
        if (this.elements.volumeLabel) this.elements.volumeLabel.textContent = `${s.volume}%`;
        if (this.elements.soundRepeat) this.elements.soundRepeat.value = String(s.soundRepeat || 0);

        // Notification toggle: ON whenever the browser permission is granted,
        // unless the user explicitly turned it off here. (Granting the browser
        // permission — however you did it — is enough; no second opt-in needed.)
        if (this.elements.notifyToggle) {
            const supported = PomodoroAudio.notificationsSupported();
            const granted = supported && Notification.permission === 'granted';
            this.elements.notifyToggle.checked = granted && s.notify !== 'off';
            this.elements.notifyToggle.disabled = !supported;
            if (!supported && this.elements.notifyHint) {
                this.elements.notifyHint.textContent =
                    'Browser notifications aren’t available here (try opening the app via a local server, e.g. http://localhost).';
            }
        }
    },

    // The pomodoro markup lives in one place in the HTML; move it to its final homes:
    // the timer card into the homepage content flow (full-width, above the cards) and
    // the sound/history panel into the Settings modal's Pomodoro tab.
    relocateUI() {
        const card = document.getElementById('pomodoroScreen');
        const main = document.querySelector('main.container');
        if (card && main && card.parentElement !== main) {
            // Keep the status row directly below the header: insert after
            // #projectsRow when it exists, otherwise fall back to prepend.
            const row = document.getElementById('projectsRow');
            if (row) row.after(card);
            else main.prepend(card);
        }
        const panel = document.getElementById('pomodoroSettingsPanel');
        const tab = document.getElementById('settingsTabPomodoro');
        if (panel && tab && panel.parentElement !== tab) {
            tab.appendChild(panel);
        }
    },

    cacheElements() {
        // Cache DOM elements for performance - with safe fallbacks
        this.elements = {
            // Toolbar
            toolbar: document.getElementById('pomodoroToolbar'),
            timerBtn: document.getElementById('pomodoroTimerBtn'),
            miniTime: document.getElementById('pomodoroMiniTime'),
            
            // Main screen
            screen: document.getElementById('pomodoroScreen'),
            timeDisplay: document.getElementById('pomodoroTime'),
            progressRing: document.getElementById('pomodoroProgress'),
            label: document.getElementById('pomodoroLabel'),
            
            // Controls
            startBtn: document.getElementById('pomodoroStart'),
            resetBtn: document.getElementById('pomodoroReset'),
            skipBtn: document.getElementById('pomodoroSkip'),
            
            // Presets - use querySelectorAll safely
            presetButtons: document.querySelectorAll('.pomodoro-preset') || [],
            customInput: document.getElementById('pomodoroCustomTime'),
            customSlider: document.getElementById('pomodoroTimeSlider'),
            
            // Settings
            volumeSlider: document.getElementById('pomodoroVolume'),
            volumeLabel: document.getElementById('pomodoroVolumeLabel'),
            soundSelect: document.getElementById('pomodoroSound'),
            soundRepeat: document.getElementById('pomodoroSoundRepeat'),
            notifyToggle: document.getElementById('pomodoroNotify'),
            notifyHint: document.getElementById('pomodoroNotifyHint'),
            
            // History
            historyList: document.getElementById('pomodoroHistory'),
            clearHistoryBtn: document.getElementById('pomodoroClearHistory')
        };
        
    },
    
    attachEventListeners() {
        // Timer icon toggles the pomodoro card (the separate home button was removed)
        if (this.elements.timerBtn) {
            this.elements.timerBtn.addEventListener('click', () => this.toggleCard());
        }
        
        // Control buttons
        if (this.elements.startBtn) {
            this.elements.startBtn.addEventListener('click', () => this.handleStartPause());
        }
        
        if (this.elements.resetBtn) {
            this.elements.resetBtn.addEventListener('click', () => PomodoroTimer.reset());
        }
        
        if (this.elements.skipBtn) {
            this.elements.skipBtn.addEventListener('click', () => PomodoroTimer.skip());
        }
        
        // Preset buttons - check if NodeList exists and has items
        if (this.elements.presetButtons && this.elements.presetButtons.length > 0) {
            this.elements.presetButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const minutes = parseInt(e.target.dataset.minutes);
                    if (!isNaN(minutes)) {
                        // Set target time and indicate it's from a preset
                        PomodoroTimer.setTargetTime(minutes, true);
                    }
                });
            });
        }
        
        // Custom time input
        if (this.elements.customInput) {
            this.elements.customInput.addEventListener('input', (e) => {
                const minutes = parseInt(e.target.value) || 25;
                // Set target time and indicate it's from custom input
                PomodoroTimer.setTargetTime(minutes, false);
            });
            
            this.elements.customInput.addEventListener('change', (e) => {
                const minutes = parseInt(e.target.value) || 25;
                // Set target time and indicate it's from custom input
                PomodoroTimer.setTargetTime(minutes, false);
            });
        }
        
        if (this.elements.customSlider) {
            this.elements.customSlider.addEventListener('input', (e) => {
                const minutes = parseInt(e.target.value);
                // Set target time and indicate it's from custom input
                PomodoroTimer.setTargetTime(minutes, false);
            });
        }
        
        // Volume control
        if (this.elements.volumeSlider) {
            this.elements.volumeSlider.addEventListener('input', (e) => {
                const volume = parseInt(e.target.value);
                PomodoroAudio.setVolume(volume);
                if (this.elements.volumeLabel) {
                    this.elements.volumeLabel.textContent = `${volume}%`;
                }
            });
        }
        
        // Sound selection
        if (this.elements.soundSelect) {
            this.elements.soundSelect.addEventListener('change', (e) => {
                const soundIndex = parseInt(e.target.value);
                PomodoroAudio.setSound(soundIndex);
            });
        }

        // Repeat count for the completion alarm
        if (this.elements.soundRepeat) {
            this.elements.soundRepeat.addEventListener('change', (e) => {
                PomodoroState.settings.soundRepeat = parseInt(e.target.value) || 0;
                PomodoroTimer.saveState();
            });
        }

        // Browser-notification toggle. Turning it on requests permission (this
        // runs inside the user's click, which browsers require for the prompt).
        if (this.elements.notifyToggle) {
            this.elements.notifyToggle.addEventListener('change', async (e) => {
                if (!e.target.checked) {
                    PomodoroState.settings.notify = 'off';
                    PomodoroTimer.saveState();
                    return;
                }
                if (!PomodoroAudio.notificationsSupported()) {
                    e.target.checked = false;
                    UI.showToast('Browser notifications aren’t available here.');
                    return;
                }
                const perm = await PomodoroAudio.requestNotificationPermission();
                if (perm === 'granted') {
                    PomodoroState.settings.notify = 'on';
                    PomodoroTimer.saveState();
                    // Fire a sample notification right away so you can see it works.
                    const shown = PomodoroAudio._showNotification(
                        '⏰ Pomodoro finished', 'Your 1 minute of Pomodoro has just run out.');
                    UI.showToast(shown
                        ? 'Notifications on — you should see a sample now.'
                        : 'Enabled, but the notification was blocked. Check Windows notification settings for your browser (and that Focus Assist / Do Not Disturb is off).');
                } else {
                    e.target.checked = false;
                    PomodoroState.settings.notify = 'off';
                    PomodoroTimer.saveState();
                    UI.showToast(perm === 'denied'
                        ? 'Notifications are blocked. Allow them in your browser’s site settings.'
                        : 'Notification permission was not granted.');
                }
            });
        }
        
        // Test sound buttons - safely query
        const testSoundButtons = document.querySelectorAll('.pomodoro-test-sound');
        if (testSoundButtons && testSoundButtons.length > 0) {
            testSoundButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const soundIndex = parseInt(e.target.dataset.sound);
                    if (soundIndex === -1) {
                        // Test current selected sound
                        PomodoroAudio.testSound(PomodoroState.settings.soundIndex);
                    } else {
                        PomodoroAudio.testSound(soundIndex);
                    }
                });
            });
        }

        // Add / remove imported sounds. Bound via delegation on document (once)
        // so it works regardless of when the settings panel is relocated into the
        // modal or re-rendered — the buttons never need to exist at bind time.
        if (!PomodoroUI._soundImportBound) {
            PomodoroUI._soundImportBound = true;

            document.addEventListener('click', (e) => {
                if (e.target.closest('#pomodoroAddSound')) {
                    document.getElementById('pomodoroSoundFile')?.click();
                } else if (e.target.closest('#pomodoroRemoveSound')) {
                    PomodoroAudio.removeImportedSound(PomodoroState.settings.soundIndex);
                }
            });

            document.addEventListener('change', async (e) => {
                if (e.target.id !== 'pomodoroSoundFile') return;
                const file = e.target.files && e.target.files[0];
                await PomodoroAudio.importSoundFile(file);
                // Reset so picking the same file again still fires 'change'
                e.target.value = '';
            });
        }

        // History clear
        if (this.elements.clearHistoryBtn) {
            this.elements.clearHistoryBtn.addEventListener('click', () => {
                if (confirm('Clear all session history?')) {
                    PomodoroHistory.clearHistory();
                }
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (!PomodoroState.isVisible) return;
            if (e.target.matches('input, textarea, [contenteditable]')) return;
            // Don't hijack keys (incl. Escape) while a modal is open — let it handle them.
            if (document.querySelector('.modal.show')) return;

            switch(e.code) {
                case 'Space':
                    e.preventDefault();
                    this.handleStartPause();
                    break;
                case 'KeyR':
                    if (!e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        PomodoroTimer.reset();
                    }
                    break;
                case 'KeyS':
                    if (!e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        PomodoroTimer.skip();
                    }
                    break;
                case 'Escape':
                    this.showHomepage();
                    break;
            }
        });
    },
    
    handleStartPause() {
        // Debounce to prevent double clicks
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;

        // Add delay to prevent state race conditions
        setTimeout(() => {
            if (!PomodoroState.isRunning) {
                PomodoroTimer.start();
            } else if (PomodoroState.isPaused) {
                PomodoroTimer.resume();
            } else {
                PomodoroTimer.pause();
            }
            
            // Clear processing flag after a delay
            setTimeout(() => {
                this.isProcessing = false;
            }, 300);
        }, 50);
    },
    
    // Toggle the pomodoro card's visibility. If the timer is running it keeps
    // running in the background while hidden (we never stop the timer here).
    toggleCard() {
        if (PomodoroState.isVisible) {
            this.showHomepage();
        } else {
            this.showPomodoro();
        }
    },

    showPomodoro() {
        PomodoroState.isVisible = true;

        // Show the pomodoro card inline (homepage + header stay visible)
        if (this.elements.screen) {
            this.elements.screen.style.display = 'flex';
        }
        if (this.elements.timerBtn) {
            this.elements.timerBtn.classList.add('active');
            this.elements.timerBtn.setAttribute('aria-expanded', 'true');
        }

        // Update display
        this.updateDisplay();
        this.startAnimation();
    },

    showHomepage() {
        PomodoroState.isVisible = false;

        // Hide the pomodoro card. A running timer is NOT stopped — it keeps counting.
        if (this.elements.screen) {
            this.elements.screen.style.display = 'none';
        }
        if (this.elements.timerBtn) {
            this.elements.timerBtn.classList.remove('active');
            this.elements.timerBtn.setAttribute('aria-expanded', 'false');
        }

        this.stopAnimation();
        // Reflect the running countdown next to the icon immediately on hide
        this.updateDisplay();
    },
    
    updateDisplay() {
        const minutes = Math.floor(PomodoroState.currentTime / 60);
        const seconds = PomodoroState.currentTime % 60;
        const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        // Update time display
        if (this.elements.timeDisplay) {
            this.elements.timeDisplay.textContent = timeStr;
        }

        // Mini countdown beside the toolbar icon — only while the timer is running
        // AND the card is hidden (when the card is open it already shows the time).
        if (this.elements.miniTime) {
            const showMini = PomodoroState.isRunning && !PomodoroState.isVisible;
            if (showMini) this.elements.miniTime.textContent = timeStr;
            this.elements.miniTime.style.display = showMini ? 'inline-block' : 'none';
        }
        
        // Update progress ring - with error handling
        if (this.elements.progressRing) {
            try {
                const progress = PomodoroState.targetTime > 0 
                    ? (PomodoroState.targetTime - PomodoroState.currentTime) / PomodoroState.targetTime
                    : 0;
                const circumference = 2 * Math.PI * 160; // radius = 160
                const offset = circumference * (1 - progress);
                
                // Set as string to ensure proper formatting
                this.elements.progressRing.style.strokeDashoffset = `${offset}`;
                
                // Change color in last 10%
                if (progress > 0.9 && PomodoroState.isRunning) {
                    this.elements.progressRing.style.stroke = '#ff6b6b';
                } else {
                    this.elements.progressRing.style.stroke = '#ffffff';
                }
            } catch (error) {
                // Progress ring update failed silently
            }
        }
        
        // Update button states
        if (this.elements.startBtn) {
            // Disable button briefly during state changes
            if (this.isProcessing) {
                this.elements.startBtn.disabled = true;
            } else {
                this.elements.startBtn.disabled = false;
                
                // Static label text — no user input reaches this innerHTML.
                // The aria-label is rewritten alongside the label on every
                // state change: the button ships with a static "Start Timer"
                // in the HTML, so without this a screen reader announces
                // "Start Timer" even while the button visibly reads "Pause".
                const playIco = '<svg class="ico" aria-hidden="true"><use href="#ico-play"></use></svg>';
                const pauseIco = '<svg class="ico" aria-hidden="true"><use href="#ico-pause"></use></svg>';
                if (!PomodoroState.isRunning) {
                    this.elements.startBtn.innerHTML = `${playIco} Start`;
                    this.elements.startBtn.setAttribute('aria-label', 'Start Timer');
                    this.elements.startBtn.classList.remove('pause');
                } else if (PomodoroState.isPaused) {
                    this.elements.startBtn.innerHTML = `${playIco} Resume`;
                    this.elements.startBtn.setAttribute('aria-label', 'Resume Timer');
                    this.elements.startBtn.classList.remove('pause');
                } else {
                    this.elements.startBtn.innerHTML = `${pauseIco} Pause`;
                    this.elements.startBtn.setAttribute('aria-label', 'Pause Timer');
                    this.elements.startBtn.classList.add('pause');
                }
            }
        }
        
        // Update label
        if (this.elements.label) {
            if (PomodoroState.isRunning && !PomodoroState.isPaused) {
                this.elements.label.textContent = 'FOCUSING...';
            } else if (PomodoroState.isPaused) {
                this.elements.label.textContent = 'PAUSED';
            } else {
                this.elements.label.textContent = 'POMODORO';
            }
        }
    },
    
    updateHistory() {
        if (!this.elements.historyList) return;
        
        const history = PomodoroHistory.loadHistory();
        
        if (history.length === 0) {
            this.elements.historyList.innerHTML = '<div class="pomodoro-history-empty">No sessions yet</div>';
            return;
        }
        
        const historyHTML = history.map(session => {
            return `<div class="pomodoro-history-item">
                ${PomodoroHistory.formatSession(session)}
            </div>`;
        }).join('');
        
        this.elements.historyList.innerHTML = historyHTML;
    },
    
    highlightPreset(minutes) {
        if (this.elements.presetButtons && this.elements.presetButtons.length > 0) {
            this.elements.presetButtons.forEach(btn => {
                if (parseInt(btn.dataset.minutes) === minutes) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }
    },
    
    clearPresetHighlight() {
        if (this.elements.presetButtons && this.elements.presetButtons.length > 0) {
            this.elements.presetButtons.forEach(btn => {
                btn.classList.remove('active');
            });
        }
    },
    
    showCompletion(wasSkipped) {
        // Visual feedback for completion
        const message = wasSkipped ? 'Session Skipped!' : 'Session Complete!';
        
        // Create toast notification
        const toast = document.createElement('div');
        toast.className = 'pomodoro-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // Pulse effect on timer
        if (this.elements.progressRing) {
            this.elements.progressRing.classList.add('pulse');
            setTimeout(() => {
                this.elements.progressRing.classList.remove('pulse');
            }, 1000);
        }
        
        // Remove toast after 3 seconds
        setTimeout(() => {
            toast.remove();
        }, 3000);
        
        // Update history display
        this.updateHistory();
    },
    
    startAnimation() {
        if (PomodoroState.animationFrame) {
            cancelAnimationFrame(PomodoroState.animationFrame);
            PomodoroState.animationFrame = null;
        }

        // The 60fps loop exists only to smooth the progress ring between the
        // 100ms ticks while the timer is actively counting down. When idle
        // or paused nothing is changing, so don't spin a perpetual rAF loop —
        // callers are expected to have already rendered the current state
        // via updateDisplay() (e.g. showPomodoro() does this before calling
        // startAnimation()).
        if (!PomodoroState.isRunning || PomodoroState.isPaused) {
            return;
        }

        const animate = () => {
            // Self-terminate if the card was hidden or the timer stopped/paused
            // since the last frame, so nothing can leave this loop spinning.
            if (!PomodoroState.isVisible || !PomodoroState.isRunning || PomodoroState.isPaused) {
                PomodoroState.animationFrame = null;
                return;
            }

            // Update display smoothly
            this.updateDisplay();

            PomodoroState.animationFrame = requestAnimationFrame(animate);
        };

        animate();
    },
    
    stopAnimation() {
        if (PomodoroState.animationFrame) {
            cancelAnimationFrame(PomodoroState.animationFrame);
            PomodoroState.animationFrame = null;
        }
    }
};
