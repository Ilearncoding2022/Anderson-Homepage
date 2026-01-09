// ==========================================
// 3-APP-INIT.JS - Application Bootstrap
// Anderson Homepage v2.1
//
// Contents:
// - App (main controller & initialization)
// - Global exports (window.*)
// - DOMContentLoaded listener
// ==========================================

// ========================================
// MAIN APPLICATION CONTROLLER
// ========================================

const App = {
    init() {
        console.log('[App] ===== INITIALIZATION START =====');
        
        Storage.load();
        Theme.load();
        Background.load();
        
        WebsiteManager.ensurePositions();
        
        if (window.UIRenderer) {
            UIRenderer.render();
        }
        
        this.attachEventListeners();
        this.initClock();
        
        // Focus on search field after everything is loaded
        this.focusSearchField();
        
        if (AppState.currentView === 'list') {
            ViewManager.setListView();
        }
        
        // Initialize the icon size slider and label
        this.initIconSizeSlider();
        
        console.log('[App] ===== INITIALIZATION COMPLETE =====');
    },
    
    focusSearchField() {
        // Give the browser a moment to fully render the page
        setTimeout(() => {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.focus();
                console.log('[App] ✓ Search field focused');
            } else {
                console.warn('[App] ✗ Search input not found for autofocus');
            }
        }, 100);
    },
    
    initIconSizeSlider() {
        console.log('[App] Initializing icon size slider...');
        
        const sizeSlider = document.getElementById('sizeSlider');
        const sizeLabel = document.getElementById('sizeLabel');
        
        console.log('[App] sizeSlider element:', sizeSlider);
        console.log('[App] sizeLabel element:', sizeLabel);
        
        if (sizeSlider) {
            sizeSlider.value = AppState.iconSize;
            console.log('[App] ✓ Icon size slider set to:', AppState.iconSize);
        } else {
            console.error('[App] ✗ sizeSlider element NOT FOUND!');
        }
        
        if (sizeLabel) {
            sizeLabel.textContent = `${AppState.iconSize}px`;
            console.log('[App] ✓ Icon size label set to:', `${AppState.iconSize}px`);
        } else {
            console.error('[App] ✗ sizeLabel element NOT FOUND!');
            
            // Try again after a delay
            console.log('[App] Retrying in 500ms...');
            setTimeout(() => {
                const retryLabel = document.getElementById('sizeLabel');
                if (retryLabel) {
                    retryLabel.textContent = `${AppState.iconSize}px`;
                    console.log('[App] ✓ Label found on retry and set to:', `${AppState.iconSize}px`);
                } else {
                    console.error('[App] ✗ Label still not found after retry');
                }
            }, 500);
        }
    },

    initClock() {
        this.updateClock();
        setInterval(() => this.updateClock(), 1000);
    },

    updateClock() {
        const timezone1 = localStorage.getItem('timezone1') || 'local';
        const timezone2 = localStorage.getItem('timezone2') || 'UTC';
        
        this.updateClockDisplay('clock', timezone1);
        this.updateClockDisplay('clock2', timezone2);
    },

    updateClockDisplay(elementId, timezone) {
        const clockElement = document.getElementById(elementId);
        if (!clockElement) return;

        const now = new Date();
        
        let options = {};
        let timezoneName = timezone;
        
        if (timezone === 'local') {
            options = { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
            timezoneName = 'Local Time';
        } else {
            options = { timeZone: timezone };
            timezoneName = timezone.split('/').pop().replace(/_/g, ' ');
        }
        
        const dateOptions = { 
            ...options, 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        };
        const dateStr = now.toLocaleDateString('en-US', dateOptions);
        
        const timeOptions = { 
            ...options, 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        };
        const timeStr = now.toLocaleTimeString('en-US', timeOptions);
        
        clockElement.innerHTML = `
            <div class="clock-date">${dateStr}</div>
            <div class="clock-time">${timeStr}</div>
            <div class="clock-timezone">${timezoneName}</div>
        `;
    },

    attachEventListeners() {
        document.getElementById('themeToggle')?.addEventListener('click', Theme.toggle);
        
        const searchForm = document.getElementById('searchForm');
        if (searchForm) {
            searchForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const searchInput = document.getElementById('searchInput');
                const query = searchInput?.value.trim();
                
                if (query) {
                    const encodedQuery = encodeURIComponent(query);
                    window.location.href = `https://www.google.com/search?q=${encodedQuery}`;
                }
            });
        }
        
        const hamburgerBtn = document.getElementById('hamburgerBtn');
        if (hamburgerBtn) {
            hamburgerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMenu();
            });
        }
        
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('dropdownMenu');
            const hamburger = document.getElementById('hamburgerBtn');
            if (menu && hamburger && !menu.contains(e.target) && !hamburger.contains(e.target)) {
                menu.classList.remove('show');
            }
        });
        
        document.getElementById('addWebsiteBtn')?.addEventListener('click', () => {
            if (window.AppModal) AppModal.openAdd();
            this.closeMenu();
        });
        document.getElementById('addGroupBtn')?.addEventListener('click', () => {
            if (window.GroupModal) GroupModal.openAdd();
            this.closeMenu();
        });
        document.getElementById('settingsBtn')?.addEventListener('click', () => {
            this.openSettings();
            this.closeMenu();
        });
        document.getElementById('closeSettings')?.addEventListener('click', () => this.closeSettings());
        
        document.getElementById('gridView')?.addEventListener('click', ViewManager.setGridView);
        document.getElementById('listView')?.addEventListener('click', ViewManager.setListView);
        
        // Icon size slider with real-time label update
        const sizeSlider = document.getElementById('sizeSlider');
        if (sizeSlider) {
            sizeSlider.addEventListener('input', (e) => {
                const size = e.target.value;
                // Update label immediately
                const sizeLabel = document.getElementById('sizeLabel');
                if (sizeLabel) {
                    sizeLabel.textContent = `${size}px`;
                }
                // Update icons
                ViewManager.updateIconSize(size);
            });
        }
        
        document.getElementById('bgImage')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) await Background.setImage(file);
        });
        document.getElementById('bgPosition')?.addEventListener('change', (e) => Background.applyPosition(e.target.value));
        document.getElementById('bgBlur')?.addEventListener('change', (e) => Background.applyBlur(e.target.value));
        document.getElementById('clearBgImage')?.addEventListener('click', Background.clear);
        
        document.getElementById('timezone1')?.addEventListener('change', (e) => {
            localStorage.setItem('timezone1', e.target.value);
            this.updateClock();
        });
        document.getElementById('timezone2')?.addEventListener('change', (e) => {
            localStorage.setItem('timezone2', e.target.value);
            this.updateClock();
        });
        
        document.getElementById('exportData')?.addEventListener('click', Storage.export);
        document.getElementById('importData')?.addEventListener('click', () => {
            document.getElementById('importFile')?.click();
        });
        document.getElementById('importFile')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) await Storage.import(file);
        });
    },

    toggleMenu() {
        const menu = document.getElementById('dropdownMenu');
        if (menu) {
            const isVisible = menu.classList.contains('show');
            console.log('[App] Toggle menu - currently visible:', isVisible);
            menu.classList.toggle('show');
            console.log('[App] Menu now:', menu.classList.contains('show') ? 'visible' : 'hidden');
        } else {
            console.error('[App] Dropdown menu element not found');
        }
    },

    closeMenu() {
        const menu = document.getElementById('dropdownMenu');
        if (menu) {
            menu.classList.remove('show');
        }
    },

    openSettings() {
        const modal = document.getElementById('settingsModal');
        if (modal) {
            const timezone1 = localStorage.getItem('timezone1') || 'local';
            const timezone2 = localStorage.getItem('timezone2') || 'UTC';
            
            const tz1Select = document.getElementById('timezone1');
            const tz2Select = document.getElementById('timezone2');
            
            if (tz1Select) tz1Select.value = timezone1;
            if (tz2Select) tz2Select.value = timezone2;
            
            modal.classList.add('show');
        }
    },

    closeSettings() {
        const modal = document.getElementById('settingsModal');
        if (modal) modal.classList.remove('show');
    },

    editWebsite(event, id) {
        event.preventDefault();
        event.stopPropagation();
        if (window.AppModal) AppModal.openEdit(id);
    },

    deleteWebsite(event, id) {
        event.preventDefault();
        event.stopPropagation();
        WebsiteManager.delete(id);
    },

    editGroup(id) {
        if (window.GroupModal) GroupModal.openEdit(id);
    },

    deleteGroup(id) {
        GroupManager.delete(id);
    },

    toggleGroupWidth(id) {
        GroupManager.toggleWidth(id);
    },

    toggleGroupPin(id) {
        GroupManager.togglePin(id);
    }
};

// ========================================
// GLOBAL EXPORTS
// ========================================

window.AppState = AppState;
window.Storage = Storage;
window.Theme = Theme;
window.Background = Background;
window.GroupManager = GroupManager;
window.WebsiteManager = WebsiteManager;
window.ViewManager = ViewManager;
window.UI = UI;
window.Utils = Utils;
window.App = App;
window.COLOR_PALETTE = COLOR_PALETTE;

// ========================================
// INITIALIZATION
// ========================================

document.addEventListener('DOMContentLoaded', () => App.init());
