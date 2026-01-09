// ==========================================
// 4-POMODORO.JS - Pomodoro Timer Module
// Anderson Homepage v2.1
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
        console.log('[PomodoroTimer] Initializing...');
        this.loadState();
        this.setupTimerLoop();
        
        // Don't auto-resume - let user manually start/resume
        console.log('[PomodoroTimer] Timer ready. State:', {
            isRunning: PomodoroState.isRunning,
            isPaused: PomodoroState.isPaused,
            targetTime: PomodoroState.targetTime
        });
    },
    
    setupTimerLoop() {
        // Main timer update loop
        this.timerInterval = null;
    },
    
    start() {
        if (PomodoroState.isRunning) {
            console.log('[PomodoroTimer] Timer already running');
            return;
        }
        
        console.log('[PomodoroTimer] Starting timer for', PomodoroState.targetTime, 'seconds');
        
        // Ensure we have a valid target time
        if (!PomodoroState.targetTime || PomodoroState.targetTime <= 0) {
            console.warn('[PomodoroTimer] Invalid target time, setting to default 25 minutes');
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
            console.log('[PomodoroTimer] Cannot pause - timer not running');
            return;
        }
        
        if (PomodoroState.isPaused) {
            console.log('[PomodoroTimer] Already paused');
            return;
        }
        
        console.log('[PomodoroTimer] Pausing timer');
        
        PomodoroState.isPaused = true;
        PomodoroState.pausedTime = Date.now();
        
        this.stopTimer();
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
            console.log('[PomodoroTimer] Cannot resume - timer not running');
            return;
        }
        
        if (!PomodoroState.isPaused) {
            console.log('[PomodoroTimer] Cannot resume - timer not paused');
            return;
        }
        
        console.log('[PomodoroTimer] Resuming timer');
        
        const pauseDuration = Date.now() - PomodoroState.pausedTime;
        PomodoroState.startTime += pauseDuration;
        PomodoroState.isPaused = false;
        PomodoroState.pausedTime = 0;
        
        this.startTimer();
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
        console.log('[PomodoroTimer] Resetting timer');
        
        this.stopTimer();
        
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
            console.log('[PomodoroTimer] Cannot skip - timer not running');
            return;
        }
        
        console.log('[PomodoroTimer] Skipping timer (marking as complete)');
        
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
            
            // Save state every second
            if (elapsed % 1 === 0) {
                this.saveState();
            }
        } catch (error) {
            console.error('[PomodoroTimer] Error in tick:', error);
            // Don't auto-pause on error, just log it
        }
    },
    
    complete() {
        console.log('[PomodoroTimer] Timer completed!');
        
        // Mark session as completed
        PomodoroState.currentSession.completedAt = new Date().toISOString();
        PomodoroState.currentSession.wasSkipped = false;
        
        // Save to history
        PomodoroHistory.addSession(PomodoroState.currentSession);
        
        // Play sound
        PomodoroAudio.playNotification();
        
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
        console.log('[PomodoroTimer] Setting target time to', minutes, 'minutes', fromPreset ? '(from preset)' : '(from custom)');
        
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
        } else {
            console.log('[PomodoroTimer] Timer is running, not changing time');
        }
    },
    
    saveState() {
        const stateToSave = {
            isRunning: PomodoroState.isRunning,
            isPaused: PomodoroState.isPaused,
            currentTime: PomodoroState.currentTime,
            targetTime: PomodoroState.targetTime,
            startTime: PomodoroState.startTime,
            pausedTime: PomodoroState.pausedTime,
            currentSession: PomodoroState.currentSession,
            settings: PomodoroState.settings
        };
        
        localStorage.setItem('pomodoroState', JSON.stringify(stateToSave));
    },
    
    loadState() {
        const savedState = localStorage.getItem('pomodoroState');
        if (savedState) {
            try {
                const state = JSON.parse(savedState);
                
                // Don't auto-resume if timer was paused
                if (state.isPaused) {
                    state.isRunning = false;
                    state.isPaused = false;
                    state.currentTime = state.targetTime;
                }
                
                Object.assign(PomodoroState, state);
                console.log('[PomodoroTimer] State loaded from localStorage');
            } catch (e) {
                console.error('[PomodoroTimer] Failed to load state:', e);
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
    
    init() {
        console.log('[PomodoroAudio] Initializing audio system...');
        
        // First, set up default sounds
        this.customSounds = [...this.defaultSounds];
        
        // Then scan for custom sounds
        this.scanSoundsFolder();
    },
    
    async scanSoundsFolder() {
        console.log('[PomodoroAudio] Scanning sounds folder:', this.soundsFolder);
        
        // Method 1: Try to fetch a manifest file first (if you create one)
        try {
            const manifestResponse = await fetch(this.soundsFolder + 'manifest.json');
            if (manifestResponse.ok) {
                const manifest = await manifestResponse.json();
                console.log('[PomodoroAudio] Found manifest:', manifest);
                this.loadSoundsFromManifest(manifest.files || manifest);
                return;
            }
        } catch (e) {
            console.log('[PomodoroAudio] No manifest file, trying auto-detection...');
        }
        
        // Method 2: Try common sound file names
        const commonSoundNames = [
            'bell', 'chime', 'ding', 'gong', 'alert', 'notification',
            'alarm', 'beep', 'buzz', 'click', 'pop', 'whoosh',
            'success', 'error', 'warning', 'complete', 'start', 'stop',
            'ring', 'tone', 'sound1', 'sound2', 'sound3', 'sound4', 'sound5',
            'custom1', 'custom2', 'custom3', 'timer', 'finish'
        ];
        
        // Try to load each common name with each extension
        const soundPromises = [];
        for (const name of commonSoundNames) {
            for (const ext of this.audioExtensions) {
                soundPromises.push(this.tryLoadSound(`${name}.${ext}`, name));
            }
        }
        
        // Wait for all attempts to complete
        await Promise.all(soundPromises);
        
        // Method 3: Try numbered sounds (sound1.mp3, sound2.mp3, etc.)
        for (let i = 1; i <= 10; i++) {
            for (const ext of this.audioExtensions) {
                await this.tryLoadSound(`sound${i}.${ext}`, `Sound ${i}`);
            }
        }
        
        // Update the dropdown after scanning
        this.updateSoundDropdown();
        
        console.log('[PomodoroAudio] Scan complete. Found', this.customSounds.length - this.defaultSounds.length, 'custom sounds');
    },
    
    async tryLoadSound(filename, displayName) {
        const path = this.soundsFolder + filename;
        
        return new Promise((resolve) => {
            const audio = new Audio();
            
            // Set up event handlers before setting src
            audio.addEventListener('loadedmetadata', () => {
                console.log(`[PomodoroAudio] ✅ Found: ${filename}`);
                
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
                console.log(`[PomodoroAudio] ✅ Loaded from manifest: ${niceName}`);
                this.updateSoundDropdown();
            });
            
            audio.addEventListener('error', () => {
                this.customSounds[soundIndex].error = true;
                console.error(`[PomodoroAudio] ❌ Failed to load from manifest: ${filename}`);
                this.updateSoundDropdown();
            });
        });
        
        this.updateSoundDropdown();
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
        
        // Restore selection or default to first sound
        if (currentValue && soundSelect.querySelector(`option[value="${currentValue}"]`)) {
            soundSelect.value = currentValue;
        } else {
            soundSelect.value = fileSounds.length > 0 ? fileSounds[0].index : synthSounds[0].index;
        }
        
        // Save the selection
        PomodoroState.settings.soundIndex = parseInt(soundSelect.value);
    },
    
    playNotification() {
        const soundIndex = PomodoroState.settings.soundIndex || 0;
        const sound = this.customSounds[soundIndex];
        
        if (!sound) {
            console.warn('[PomodoroAudio] Invalid sound index:', soundIndex);
            this.playSynthSound(this.defaultSounds[0]);
            return;
        }
        
        console.log('[PomodoroAudio] Playing:', sound.name);
        
        if (sound.type === 'file') {
            this.playFileSound(soundIndex);
        } else if (sound.type === 'synth') {
            this.playSynthSound(sound);
        }
    },
    
    playFileSound(soundIndex) {
        const audio = this.audioCache[soundIndex];
        
        if (!audio) {
            console.warn('[PomodoroAudio] No cached audio for:', soundIndex);
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
            console.log('[PomodoroAudio] Playing file sound');
        }).catch(e => {
            console.error('[PomodoroAudio] Playback failed:', e);
            this.playSynthSound(this.defaultSounds[0]);
        });
    },
    
    playSynthSound(sound) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
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
            
            console.log('[PomodoroAudio] Playing synth sound');
        } catch (e) {
            console.error('[PomodoroAudio] Synth playback error:', e);
        }
    },
    
    testSound(soundIndex) {
        if (soundIndex === -1) {
            // Test current sound
            this.playNotification();
        } else if (soundIndex >= 0 && soundIndex < this.customSounds.length) {
            const oldIndex = PomodoroState.settings.soundIndex;
            PomodoroState.settings.soundIndex = soundIndex;
            this.playNotification();
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
    
    // Refresh sounds (rescan folder)
    async refreshSounds() {
        console.log('[PomodoroAudio] Refreshing sounds...');
        this.customSounds = [...this.defaultSounds];
        this.audioCache = {};
        await this.scanSoundsFolder();
        UI.showToast('Sounds refreshed!');
    }
};

// ========================================
// POMODORO HISTORY TRACKING
// ========================================

const PomodoroHistory = {
    maxSessions: 10,
    
    init() {
        console.log('[PomodoroHistory] Initializing history tracking...');
        this.loadHistory();
    },
    
    getHistory() {
        const history = localStorage.getItem('pomodoroHistory');
        if (history) {
            try {
                return JSON.parse(history);
            } catch (e) {
                console.error('[PomodoroHistory] Failed to parse history:', e);
                return [];
            }
        }
        return [];
    },
    
    loadHistory() {
        const history = this.getHistory();
        console.log('[PomodoroHistory] Loaded', history.length, 'sessions from history');
        return history;
    },
    
    addSession(session) {
        console.log('[PomodoroHistory] Adding session to history:', session);
        
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
        localStorage.setItem('pomodoroHistory', JSON.stringify(history));
        
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
        console.log('[PomodoroHistory] Clearing history');
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
        console.log('[PomodoroUI] Initializing UI...');
        this.cacheElements();
        this.attachEventListeners();
        this.updateDisplay();
        this.updateHistory();
    },
    
    cacheElements() {
        // Cache DOM elements for performance - with safe fallbacks
        this.elements = {
            // Toolbar
            toolbar: document.getElementById('pomodoroToolbar'),
            homeBtn: document.getElementById('pomodoroHomeBtn'),
            timerBtn: document.getElementById('pomodoroTimerBtn'),
            
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
            
            // History
            historyList: document.getElementById('pomodoroHistory'),
            clearHistoryBtn: document.getElementById('pomodoroClearHistory')
        };
        
        // Log which elements were found
        console.log('[PomodoroUI] Elements cached:', {
            toolbar: !!this.elements.toolbar,
            screen: !!this.elements.screen,
            timeDisplay: !!this.elements.timeDisplay,
            progressRing: !!this.elements.progressRing,
            startBtn: !!this.elements.startBtn,
            presetButtons: this.elements.presetButtons.length
        });
    },
    
    attachEventListeners() {
        // Toolbar buttons
        if (this.elements.homeBtn) {
            this.elements.homeBtn.addEventListener('click', () => this.showHomepage());
        }
        
        if (this.elements.timerBtn) {
            this.elements.timerBtn.addEventListener('click', () => this.showPomodoro());
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
            console.log('[PomodoroUI] Already processing, ignoring click');
            return;
        }
        
        this.isProcessing = true;
        
        // Add delay to prevent state race conditions
        setTimeout(() => {
            if (!PomodoroState.isRunning) {
                console.log('[PomodoroUI] Starting timer...');
                PomodoroTimer.start();
            } else if (PomodoroState.isPaused) {
                console.log('[PomodoroUI] Resuming timer...');
                PomodoroTimer.resume();
            } else {
                console.log('[PomodoroUI] Pausing timer...');
                PomodoroTimer.pause();
            }
            
            // Clear processing flag after a delay
            setTimeout(() => {
                this.isProcessing = false;
            }, 300);
        }, 50);
    },
    
    showPomodoro() {
        console.log('[PomodoroUI] Showing Pomodoro screen');
        PomodoroState.isVisible = true;
        
        // Hide main container
        const mainContainer = document.getElementById('mainContainer');
        if (mainContainer) mainContainer.style.display = 'none';
        
        // Hide header
        const header = document.querySelector('.header');
        if (header) header.style.display = 'none';
        
        // Show Pomodoro screen
        if (this.elements.screen) {
            this.elements.screen.style.display = 'flex';
        }
        
        // Update display
        this.updateDisplay();
        this.startAnimation();
    },
    
    showHomepage() {
        console.log('[PomodoroUI] Showing Homepage');
        PomodoroState.isVisible = false;
        
        // Show main container
        const mainContainer = document.getElementById('mainContainer');
        if (mainContainer) mainContainer.style.display = 'block';
        
        // Show header
        const header = document.querySelector('.header');
        if (header) header.style.display = 'flex';
        
        // Hide Pomodoro screen
        if (this.elements.screen) {
            this.elements.screen.style.display = 'none';
        }
        
        this.stopAnimation();
    },
    
    updateDisplay() {
        // Update time display
        if (this.elements.timeDisplay) {
            const minutes = Math.floor(PomodoroState.currentTime / 60);
            const seconds = PomodoroState.currentTime % 60;
            this.elements.timeDisplay.textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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
                console.warn('[PomodoroUI] Error updating progress ring:', error);
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
        }
        
        const animate = () => {
            if (!PomodoroState.isVisible) return;
            
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
        console.log('[PomodoroApp] ===== INITIALIZING POMODORO MODULE =====');
        
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
        
        console.log('[PomodoroApp] ===== POMODORO MODULE READY =====');
    },
    
    createUI() {
        console.log('[PomodoroApp] Creating Pomodoro UI elements...');
        
        // This will be created by the HTML/CSS files
        // But we'll add the structure here for reference
        
        // Check if toolbar exists, if not create it
        if (!document.getElementById('pomodoroToolbar')) {
            const toolbar = document.createElement('div');
            toolbar.id = 'pomodoroToolbar';
            toolbar.className = 'pomodoro-toolbar';
            toolbar.innerHTML = `
                <button id="pomodoroHomeBtn" class="pomodoro-toolbar-btn" title="Homepage">
                    🏠
                </button>
                <button id="pomodoroTimerBtn" class="pomodoro-toolbar-btn" title="Pomodoro Timer">
                    ⏰
                </button>
            `;
            document.body.appendChild(toolbar);
        }
        
        // Check if Pomodoro screen exists
        if (!document.getElementById('pomodoroScreen')) {
            console.log('[PomodoroApp] Pomodoro screen not found in HTML, will be created by HTML file');
        }
        
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
}