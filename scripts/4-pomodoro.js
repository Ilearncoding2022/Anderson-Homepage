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

// ========================================
// POMODORO AUDIO MANAGEMENT
// ========================================

// ========================================
// AUDIO SYSTEM - WITH AUTO-SCAN
// ========================================

const PomodoroAudio = {
    audioCache: {},
    currentAudio: null,
    soundsFolder: 'sounds/', // Path to sounds folder relative to HTML file
    
    // Default synthetic sounds (always available)
    defaultSounds: [
        { name: 'Synth Bell', type: 'synth', freq: 800, duration: 300 },
        { name: 'Synth Chime', type: 'synth', freq: 1200, duration: 200 },
        { name: 'Synth Ding', type: 'synth', freq: 1500, duration: 150 },
        { name: 'Synth Gong', type: 'synth', freq: 200, duration: 500 },
        { name: 'Synth Alert', type: 'synth', freq: 440, duration: 250 }
    ],
    
    // This will be populated by scanning
    customSounds: [],
    
    // Common audio file extensions to look for
    audioExtensions: ['mp3', 'wav', 'ogg', 'm4a', 'webm', 'aac', 'flac'],
    
    async init() {
        // First, set up default sounds
        this.customSounds = [...this.defaultSounds];

        // Then scan for bundled sound files in the /sounds/ folder, and only once
        // those have settled load the user-imported sounds. Keeping imported sounds
        // strictly after the folder sounds means their indices don't drift between
        // sessions, so a saved selection keeps pointing at the same sound.
        await this.scanSoundsFolder();
        await this.loadImportedSounds();
    },
    
    async scanSoundsFolder() {
        // Load known sound files from the sounds/ folder.
        // Add entries here when adding new sound files.
        const knownSounds = [
            { name: 'Bell', filename: 'bell.mp3' },
            { name: 'Chime', filename: 'chime.mp3' },
            { name: 'Notification', filename: 'notification.mp3' }
        ];

        await Promise.all(
            knownSounds.map(s => this.tryLoadSound(s.filename, s.name))
        );

        this.updateSoundDropdown();
    },
    
    async tryLoadSound(filename, displayName) {
        const path = this.soundsFolder + filename;
        
        return new Promise((resolve) => {
            const audio = new Audio();
            
            // Set up event handlers before setting src
            audio.addEventListener('loadedmetadata', () => {
                
                // Format the display name nicely
                const niceName = displayName || filename
                    .replace(/\.[^/.]+$/, '') // Remove extension
                    .replace(/[-_]/g, ' ') // Replace dashes/underscores with spaces
                    .replace(/\b\w/g, l => l.toUpperCase()); // Capitalize words
                
                // Add to sounds array
                const soundIndex = this.customSounds.length;
                this.customSounds.push({
                    name: niceName,
                    type: 'file',
                    path: path,
                    filename: filename,
                    loaded: true
                });
                
                // Cache the audio element
                this.audioCache[soundIndex] = audio;
                
                // Update dropdown
                this.updateSoundDropdown();
                resolve(true);
            });
            
            audio.addEventListener('error', () => {
                // Silently fail - file doesn't exist
                resolve(false);
            });
            
            // Set source and attempt to load
            audio.src = path;
            audio.preload = 'auto';
        });
    },
    
    loadSoundsFromManifest(files) {
        // Load sounds from a manifest file
        files.forEach(file => {
            const filename = typeof file === 'string' ? file : file.filename;
            const displayName = typeof file === 'string' ? null : file.name;
            
            const path = this.soundsFolder + filename;
            const audio = new Audio();
            audio.src = path;
            audio.preload = 'auto';
            
            const niceName = displayName || filename
                .replace(/\.[^/.]+$/, '')
                .replace(/[-_]/g, ' ')
                .replace(/\b\w/g, l => l.toUpperCase());
            
            const soundIndex = this.customSounds.length;
            this.customSounds.push({
                name: niceName,
                type: 'file',
                path: path,
                filename: filename,
                loaded: false
            });
            
            this.audioCache[soundIndex] = audio;
            
            audio.addEventListener('loadeddata', () => {
                this.customSounds[soundIndex].loaded = true;
                this.updateSoundDropdown();
            });

            audio.addEventListener('error', () => {
                this.customSounds[soundIndex].error = true;
                this.updateSoundDropdown();
            });
        });
        
        this.updateSoundDropdown();
    },

    // ===================== User-imported sounds =====================
    // Imported sounds live in IndexedDB (via ImageStore) as { id, name, dataUrl,
    // addedAt } records, so they survive reloads and never touch localStorage.

    // Resolve the ImageStore blob store. This module auto-inits at parse time —
    // before 3-app-init.js assigns window.ImageStore — so prefer the bare const
    // (already initialised by 2-ui-controllers.js) and fall back to window.
    _store() {
        if (typeof ImageStore !== 'undefined' && ImageStore) return ImageStore;
        return window.ImageStore || null;
    },

    async loadImportedSounds() {
        const store = this._store();
        if (!store?.getAllSounds) return;
        let records = [];
        try {
            records = await store.getAllSounds();
        } catch {
            return;
        }
        // Oldest first so indices stay stable across sessions (new imports append).
        records.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
        records.forEach(rec => this._addImportedSoundToList(rec));
        this.updateSoundDropdown();
    },

    // Add one imported-sound record to the in-memory list + audio cache.
    // Returns the index it was stored at.
    _addImportedSoundToList(rec) {
        const soundIndex = this.customSounds.length;
        const audio = new Audio();
        audio.src = rec.dataUrl;
        audio.preload = 'auto';

        this.customSounds.push({
            id: rec.id,
            name: rec.name,
            type: 'file',
            path: rec.dataUrl,
            imported: true,
            loaded: false
        });
        this.audioCache[soundIndex] = audio;

        audio.addEventListener('loadeddata', () => {
            if (this.customSounds[soundIndex]) this.customSounds[soundIndex].loaded = true;
            this.updateSoundDropdown();
        });
        audio.addEventListener('error', () => {
            if (this.customSounds[soundIndex]) this.customSounds[soundIndex].error = true;
            this.updateSoundDropdown();
        });

        return soundIndex;
    },

    _makeSoundId() {
        return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },

    // Import an audio File picked by the user: persist it, add it to the list,
    // and select it so it's ready to use immediately.
    async importSoundFile(file) {
        if (!file) return;
        if (!file.type.startsWith('audio/')) {
            UI.showToast('Please choose an audio file (MP3, WAV, OGG…).');
            return;
        }
        const maxSize = 10 * 1024 * 1024; // 10 MB — a short alarm clip is far smaller
        if (file.size > maxSize) {
            UI.showToast('That audio file is too large (max 10 MB).');
            return;
        }

        let dataUrl;
        try {
            dataUrl = await Utils.fileToBase64(file);
        } catch {
            UI.showToast('Could not read that audio file.');
            return;
        }

        const name = file.name
            .replace(/\.[^/.]+$/, '')      // drop extension
            .replace(/[-_]/g, ' ')          // dashes/underscores → spaces
            .trim() || 'Custom sound';
        const rec = { id: this._makeSoundId(), name, dataUrl, addedAt: Date.now() };

        const store = this._store();
        if (store?.setSound) {
            try {
                await store.setSound(rec.id, rec);
            } catch {
                UI.showToast('Could not save the sound.');
                return;
            }
        }

        // Select the freshly added sound, then render so the dropdown's restore
        // logic (which keys off settings.soundIndex) lands on the new option.
        const index = this._addImportedSoundToList(rec);
        PomodoroState.settings.soundIndex = index;
        this.updateSoundDropdown();
        PomodoroTimer.saveState();

        UI.showToast(`Added "${name}"`);
    },

    // Remove an imported sound (only imported ones can be deleted). Rebuilds the
    // list afterwards so indices stay contiguous.
    async removeImportedSound(soundIndex) {
        const sound = this.customSounds[soundIndex];
        if (!sound || !sound.imported) {
            UI.showToast('Select one of your added sounds to remove it.');
            return;
        }
        const store = this._store();
        if (store?.deleteSound && sound.id) {
            try { await store.deleteSound(sound.id); } catch { /* ignore */ }
        }
        const removedName = sound.name;
        await this._rebuildSounds();
        UI.showToast(`Removed "${removedName}"`);
    },

    updateSoundDropdown() {
        const soundSelect = document.getElementById('pomodoroSound');
        if (!soundSelect) return;
        
        // Save current selection
        const currentValue = soundSelect.value;
        
        // Clear options
        soundSelect.innerHTML = '';
        
        // Separate sounds by type
        const fileSounds = [];
        const synthSounds = [];
        
        this.customSounds.forEach((sound, index) => {
            if (sound.type === 'synth') {
                synthSounds.push({ sound, index });
            } else if (!sound.error) {
                fileSounds.push({ sound, index });
            }
        });
        
        // Add file sounds if any were found
        if (fileSounds.length > 0) {
            const fileGroup = document.createElement('optgroup');
            fileGroup.label = `🎵 Custom Sounds (${fileSounds.length})`;
            
            fileSounds.forEach(({ sound, index }) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = sound.name;
                
                if (!sound.loaded) {
                    option.textContent += ' ⏳';
                }
                
                fileGroup.appendChild(option);
            });
            
            soundSelect.appendChild(fileGroup);
        } else {
            // Add helpful message if no custom sounds found
            const noSoundsOption = document.createElement('option');
            noSoundsOption.textContent = '-- No custom sounds found in /sounds/ --';
            noSoundsOption.disabled = true;
            soundSelect.appendChild(noSoundsOption);
        }
        
        // Always add synthetic sounds as fallback
        const synthGroup = document.createElement('optgroup');
        synthGroup.label = '🎹 Built-in Sounds';
        
        synthSounds.forEach(({ sound, index }) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = sound.name;
            synthGroup.appendChild(option);
        });
        
        soundSelect.appendChild(synthGroup);
        
        // Restore selection. Prefer the saved/selected soundIndex (the source of
        // truth, restored from localStorage on load) over the dropdown's previous
        // DOM value — on a fresh page load that DOM value is just the static HTML
        // default ("0"), which would otherwise clobber the user's saved choice.
        const savedIndex = PomodoroState.settings.soundIndex;
        const wanted = (savedIndex !== undefined && savedIndex !== null) ? String(savedIndex) : currentValue;
        if (wanted !== '' && soundSelect.querySelector(`option[value="${wanted}"]`)) {
            soundSelect.value = wanted;
        } else if (currentValue && soundSelect.querySelector(`option[value="${currentValue}"]`)) {
            soundSelect.value = currentValue;
        } else {
            soundSelect.value = fileSounds.length > 0 ? fileSounds[0].index : synthSounds[0].index;
        }

        // Keep the in-memory selection in sync with what the dropdown now shows.
        PomodoroState.settings.soundIndex = parseInt(soundSelect.value);
    },
    
    // The completion alarm: play the selected sound once, or N times if the
    // "Repeat" setting is 3/5 (0 = no repeat = once). Repeats are spaced by the
    // sound's own length so they play back-to-back rather than overlapping.
    playNotification() {
        const repeat = parseInt(PomodoroState.settings.soundRepeat) || 0;
        const times = repeat > 0 ? repeat : 1;
        this._playTimes(times);
    },

    _playTimes(times) {
        if (times <= 0) return;
        this._playCurrentSound();
        if (times > 1) {
            const gap = this._currentSoundDurationMs() + 200;
            setTimeout(() => this._playTimes(times - 1), gap);
        }
    },

    // Play the currently-selected sound exactly once (no repeat).
    _playCurrentSound() {
        const soundIndex = PomodoroState.settings.soundIndex || 0;
        const sound = this.customSounds[soundIndex];

        if (!sound) {
            this.playSynthSound(this.defaultSounds[0]);
            return;
        }

        if (sound.type === 'file') {
            this.playFileSound(soundIndex);
        } else if (sound.type === 'synth') {
            this.playSynthSound(sound);
        }
    },

    // Best-effort duration (ms) of the current sound, used to space repeats.
    _currentSoundDurationMs() {
        const soundIndex = PomodoroState.settings.soundIndex || 0;
        const sound = this.customSounds[soundIndex];
        if (sound && sound.type === 'synth') return sound.duration || 300;
        const audio = this.audioCache[soundIndex];
        if (audio && isFinite(audio.duration) && audio.duration > 0) {
            return Math.round(audio.duration * 1000);
        }
        return 800;
    },
    
    playFileSound(soundIndex) {
        const audio = this.audioCache[soundIndex];

        if (!audio) {
            this.playSynthSound(this.defaultSounds[0]);
            return;
        }
        
        // Stop currently playing sound
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
        }
        
        // Clone for overlapping plays
        const audioClone = audio.cloneNode();
        audioClone.volume = PomodoroState.settings.volume / 100;
        
        audioClone.play().then(() => {
            this.currentAudio = audioClone;
        }).catch(() => {
            this.playSynthSound(this.defaultSounds[0]);
        });
    },
    
    _audioCtx: null,

    _getAudioContext() {
        if (!this._audioCtx || this._audioCtx.state === 'closed') {
            this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this._audioCtx.state === 'suspended') {
            this._audioCtx.resume();
        }
        return this._audioCtx;
    },

    playSynthSound(sound) {
        try {
            const audioContext = this._getAudioContext();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = sound.freq || 440;
            oscillator.type = 'sine';

            const volume = (PomodoroState.settings.volume / 100) * 0.3;
            const now = audioContext.currentTime;
            const duration = (sound.duration || 300) / 1000;

            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);

            oscillator.start(now);
            oscillator.stop(now + duration);
        } catch (e) {
            // Synth playback unavailable
        }
    },
    
    testSound(soundIndex) {
        // Preview plays once regardless of the Repeat setting.
        if (soundIndex === -1) {
            this._playCurrentSound();
        } else if (soundIndex >= 0 && soundIndex < this.customSounds.length) {
            const oldIndex = PomodoroState.settings.soundIndex;
            PomodoroState.settings.soundIndex = soundIndex;
            this._playCurrentSound();
            PomodoroState.settings.soundIndex = oldIndex;
        }
    },
    
    setVolume(volume) {
        PomodoroState.settings.volume = volume;
        PomodoroTimer.saveState();
    },
    
    setSound(soundIndex) {
        PomodoroState.settings.soundIndex = soundIndex;
        PomodoroTimer.saveState();
    },
    
    // Rebuild the full sound list from scratch: defaults → folder files →
    // imported files. Used on manual refresh and after removing an imported sound.
    async _rebuildSounds() {
        this.customSounds = [...this.defaultSounds];
        this.audioCache = {};
        await this.scanSoundsFolder();
        await this.loadImportedSounds();
    },

    // Refresh sounds (rescan folder + reload imported)
    async refreshSounds() {
        await this._rebuildSounds();
        UI.showToast('Sounds refreshed!');
    },

    // ----- System (browser) notifications -----

    notificationsSupported() {
        return typeof window !== 'undefined' && 'Notification' in window;
    },

    // Ask the browser for notification permission (must run from a user gesture).
    // Returns the resulting permission string.
    async requestNotificationPermission() {
        if (!this.notificationsSupported()) return 'unsupported';
        try {
            return await Notification.requestPermission();
        } catch {
            // Older browsers use the callback form
            return await new Promise(res => {
                try { Notification.requestPermission(res); } catch { res(Notification.permission); }
            });
        }
    },

    // Low-level: construct a notification now if permission allows. Returns true
    // if one was created. Fires regardless of whether the app tab is focused —
    // a timer alarm is worth showing even while you're looking at the app.
    // `requireInteraction` keeps it on screen until you dismiss it.
    _showNotification(title, body) {
        if (!this.notificationsSupported() || Notification.permission !== 'granted') return false;
        try {
            const n = new Notification(title, {
                body,
                icon: 'Pomodoro.png',
                tag: 'pomodoro',
                renotify: true,
                requireInteraction: true
            });
            n.onclick = () => { try { window.focus(); } catch {} n.close(); };
            return true;
        } catch {
            // Construction can throw on some configurations (e.g. file://) — ignore.
            return false;
        }
    },

    // Completion notification. Shown whenever the browser permission is granted,
    // unless the user explicitly switched it off (settings.notify === 'off').
    showBrowserNotification(minutes) {
        if (PomodoroState.settings.notify === 'off') return;
        const m = (typeof minutes === 'number' && minutes > 0)
            ? minutes
            : Math.max(1, Math.round(PomodoroState.targetTime / 60));
        const body = `Your ${m} minute${m === 1 ? '' : 's'} of Pomodoro has just run out.`;
        this._showNotification('⏰ Pomodoro finished', body);
    }
};

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
        
        const status = session.wasSkipped ? '⏭' : '✓';
        
        return `Session #${session.number}: ${targetStr} → ${elapsedStr} (${session.completionRate}%) ${status}`;
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
        if (this.elements.volumeSlider) this.elements.volumeSlider.value = s.volume;
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
            main.prepend(card);
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
                
                if (!PomodoroState.isRunning) {
                    this.elements.startBtn.textContent = '▶ Start';
                    this.elements.startBtn.classList.remove('pause');
                } else if (PomodoroState.isPaused) {
                    this.elements.startBtn.textContent = '▶ Resume';
                    this.elements.startBtn.classList.remove('pause');
                } else {
                    this.elements.startBtn.textContent = '⏸ Pause';
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