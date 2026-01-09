// ==========================================
// 2-UI-CONTROLLERS.JS - UI & Visual Controls
// Anderson Homepage v2.1
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
        localStorage.setItem('theme', newTheme);
        document.getElementById('themeToggle').textContent = newTheme === 'dark' ? '☀️' : '🌙';
    },

    load() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        document.getElementById('themeToggle').textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    }
};

// ========================================
// BACKGROUND MANAGER
// ========================================

const Background = {
    async setImage(file) {
        console.log('[Background] setImage called with file:', file.name, file.type, file.size, 'bytes');
        
        try {
            if (!file.type.startsWith('image/')) {
                console.error('[Background] Invalid file type:', file.type);
                UI.showToast('❌ Please select a valid image file');
                return;
            }

            const maxSize = 2 * 1024 * 1024;
            if (file.size > maxSize) {
                console.warn('[Background] Large file warning:', file.size, 'bytes');
                UI.showToast('⚠️ Large image may cause issues. Converting...');
            } else {
                UI.showToast('⏳ Loading background image...');
            }

            console.log('[Background] Converting file to base64...');
            const base64 = await Utils.fileToBase64(file);
            console.log('[Background] Conversion successful, size:', base64.length, 'characters');
            
            console.log('[Background] Storing in localStorage...');
            try {
                localStorage.setItem('backgroundImage', base64);
                console.log('[Background] Successfully stored in localStorage');
            } catch (storageError) {
                console.error('[Background] localStorage error:', storageError);
                if (storageError.name === 'QuotaExceededError') {
                    UI.showToast('❌ Image too large for localStorage! Try a smaller image.');
                    return;
                }
                throw storageError;
            }
            
            console.log('[Background] Applying to document.body...');
            document.body.style.backgroundImage = `url(${base64})`;
            
            console.log('[Background] Getting position setting...');
            const positionSelect = document.getElementById('bgPosition');
            const position = positionSelect ? positionSelect.value : 'cover';
            console.log('[Background] Position:', position);
            
            this.applyPosition(position);
            
            console.log('[Background] ✅ Background image set successfully!');
            UI.showToast('✅ Background image set successfully!');
            
        } catch (error) {
            console.error('[Background] ❌ Error setting image:', error);
            console.error('[Background] Error stack:', error.stack);
            UI.showToast('❌ Failed to set background: ' + error.message);
        }
    },

    applyPosition(position) {
        console.log('[Background] Applying position:', position);
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
            console.log('[Background] Applied position config:', config);
        }
        
        localStorage.setItem('backgroundPosition', position);
    },

    applyBlur(blurLevel) {
        console.log('[Background] Applying blur:', blurLevel);
        const overlay = document.querySelector('.overlay');
        overlay.className = 'overlay';
        
        if (blurLevel !== 'medium-blur') {
            overlay.classList.add(blurLevel);
        }
        
        localStorage.setItem('backgroundBlur', blurLevel);
    },

    clear() {
        console.log('[Background] Clearing background image');
        localStorage.removeItem('backgroundImage');
        localStorage.removeItem('backgroundPosition');
        document.body.style.backgroundImage = 'none';
        UI.showToast('✅ Background image cleared!');
    },

    load() {
        console.log('[Background] Loading saved background settings...');
        const bgImage = localStorage.getItem('backgroundImage');
        const bgPosition = localStorage.getItem('backgroundPosition') || 'cover';
        const bgBlur = localStorage.getItem('backgroundBlur') || 'medium-blur';
        
        if (bgImage) {
            console.log('[Background] Found saved background, applying...');
            document.body.style.backgroundImage = `url(${bgImage})`;
            this.applyPosition(bgPosition);
        } else {
            console.log('[Background] No saved background found');
        }
        
        const bgPositionSelect = document.getElementById('bgPosition');
        const bgBlurSelect = document.getElementById('bgBlur');
        
        if (bgPositionSelect) bgPositionSelect.value = bgPosition;
        if (bgBlurSelect) bgBlurSelect.value = bgBlur;
        
        this.applyBlur(bgBlur);
        console.log('[Background] Settings loaded');
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
        localStorage.setItem('view', 'grid');
        if (window.UIRenderer) UIRenderer.render();
    },

    setListView() {
        AppState.currentView = 'list';
        document.getElementById('listView').classList.add('active');
        document.getElementById('gridView').classList.remove('active');
        localStorage.setItem('view', 'list');
        if (window.UIRenderer) UIRenderer.render();
    },

    updateIconSize(size) {
        AppState.iconSize = parseInt(size);
        localStorage.setItem('iconSize', size);
        
        // Update the size label
        const sizeLabel = document.getElementById('sizeLabel');
        if (sizeLabel) {
            sizeLabel.textContent = `${size}px`;
        }
        
        // Update icon sizes immediately
        if (window.UIRenderer) {
            UIRenderer.updateIconSizes();
            // Force re-render to show new sizes
            UIRenderer.render();
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
    }
};

// ========================================
// UTILITY FUNCTIONS
// ========================================

const Utils = {
    fileToBase64(file) {
        console.log('[Utils] Converting file to base64:', file.name);
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = () => {
                console.log('[Utils] FileReader onload - conversion successful');
                resolve(reader.result);
            };
            
            reader.onerror = (error) => {
                console.error('[Utils] FileReader error:', error);
                reject(new Error('Failed to read file: ' + (error.message || 'Unknown error')));
            };
            
            reader.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = (e.loaded / e.total * 100).toFixed(0);
                    console.log(`[Utils] Reading file: ${percent}%`);
                }
            };
            
            reader.readAsDataURL(file);
        });
    },

    isBase64Image(str) {
        if (!str) return false;
        return str.startsWith('data:image/');
    },

    isFilePath(str) {
        if (!str) return false;
        return str.startsWith('file:///') || 
               str.match(/^[a-zA-Z]:\\/) ||
               str.startsWith('/') ||
               str.startsWith('./') ||
               str.startsWith('../');
    }
};
