// ==========================================
// 4.1-POMODORO-AUDIO.JS - Pomodoro Timer Module (audio family)
// Anderson Homepage
//
// Split out of 4-pomodoro.js; loads after 4-pomodoro.js.
// Contents:
// - PomodoroAudio (sound management)
// ==========================================

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
            // optgroup.label is plain text in a native <select> — it can't host
            // an <svg>, so the icon is just dropped rather than replaced.
            fileGroup.label = `Custom Sounds (${fileSounds.length})`;
            
            fileSounds.forEach(({ sound, index }) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = sound.name;
                
                if (!sound.loaded) {
                    // option.textContent is plain text too — no icon possible here.
                    option.textContent += ' (loading)';
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
        synthGroup.label = 'Built-in Sounds';
        
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
    // The title keeps its emoji: OS Notification titles are plain text rendered
    // outside our DOM, so a sprite <svg> icon isn't reachable here.
    showBrowserNotification(minutes) {
        if (PomodoroState.settings.notify === 'off') return;
        const m = (typeof minutes === 'number' && minutes > 0)
            ? minutes
            : Math.max(1, Math.round(PomodoroState.targetTime / 60));
        const body = `Your ${m} minute${m === 1 ? '' : 's'} of Pomodoro has just run out.`;
        this._showNotification('⏰ Pomodoro finished', body);
    }
};
