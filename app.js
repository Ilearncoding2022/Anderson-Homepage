// ==========================================
// WebApp Launcher - Core Module v0.7
// Handles state, storage, and core managers
// NOW SUPPORTS: Pin groups + Website position tracking
// ==========================================

// Predefined color palette for groups
const COLOR_PALETTE = [
    { name: 'Ocean Blue', value: 'rgba(30, 136, 229, 0.25)' },
    { name: 'Forest Green', value: 'rgba(76, 175, 80, 0.25)' },
    { name: 'Sunset Orange', value: 'rgba(255, 152, 0, 0.25)' },
    { name: 'Royal Purple', value: 'rgba(156, 39, 176, 0.25)' },
    { name: 'Rose Pink', value: 'rgba(233, 30, 99, 0.25)' },
    { name: 'Teal', value: 'rgba(0, 150, 136, 0.25)' },
    { name: 'Deep Orange', value: 'rgba(255, 87, 34, 0.25)' },
    { name: 'Indigo', value: 'rgba(63, 81, 181, 0.25)' },
    { name: 'Lime', value: 'rgba(205, 220, 57, 0.25)' },
    { name: 'Cyan', value: 'rgba(0, 188, 212, 0.25)' },
    { name: 'Amber', value: 'rgba(255, 193, 7, 0.25)' },
    { name: 'Brown', value: 'rgba(121, 85, 72, 0.25)' }
];

// ========== State Management ==========
const AppState = {
    websites: [],
    groups: [],
    currentView: 'grid',
    editingId: null,
    editingGroupId: null,
    iconSize: 80,
    draggedElement: null,
    draggedId: null,
    draggedType: null,
    draggedGroupIndex: null
};

// ========== Storage Manager ==========
const Storage = {
    save() {
        localStorage.setItem('websites', JSON.stringify(AppState.websites));
        localStorage.setItem('groups', JSON.stringify(AppState.groups));
    },

    load() {
        const savedWebsites = localStorage.getItem('websites');
        if (savedWebsites) {
            AppState.websites = JSON.parse(savedWebsites);
        }
        
        const savedGroups = localStorage.getItem('groups');
        if (savedGroups) {
            AppState.groups = JSON.parse(savedGroups);
        } else {
            AppState.groups = [{
                id: 'ungrouped',
                name: 'My Apps',
                color: COLOR_PALETTE[0].value,
                width: 'full',
                order: 0,
                pinned: false
            }];
            this.save();
        }
        
        // Ensure all groups have width, order, and pinned properties
        AppState.groups.forEach((group, index) => {
            if (!group.width) group.width = 'full';
            if (group.order === undefined) group.order = index;
            if (group.pinned === undefined) group.pinned = false;
        });
        
        // Sort groups: pinned first (by order), regular (by order), then ungrouped last
        AppState.groups.sort((a, b) => {
            // Ungrouped always last
            if (a.id === 'ungrouped') return 1;
            if (b.id === 'ungrouped') return -1;
            
            // Pinned groups first
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            
            // Within same section, sort by order
            return a.order - b.order;
        });
        
        AppState.websites.forEach(website => {
            if (!website.groupId) {
                website.groupId = 'ungrouped';
            }
        });
        
        const savedView = localStorage.getItem('view');
        if (savedView) {
            AppState.currentView = savedView;
        }
        
        const savedSize = localStorage.getItem('iconSize');
        if (savedSize) {
            AppState.iconSize = parseInt(savedSize);
        }
    },

    export() {
        const exportWebsites = AppState.websites.map(website => {
            const exported = { ...website };
            
            if (exported.icon && Utils.isBase64Image(exported.icon)) {
                exported.icon = null;
                exported._iconNote = 'Base64 image removed - please use file path instead';
            }
            
            return exported;
        });

        const data = {
            websites: exportWebsites,
            groups: AppState.groups,
            theme: localStorage.getItem('theme'),
            view: localStorage.getItem('view'),
            iconSize: localStorage.getItem('iconSize'),
            backgroundPosition: localStorage.getItem('backgroundPosition'),
            backgroundBlur: localStorage.getItem('backgroundBlur'),
            _exportNote: 'Image data (base64) excluded from export. Use file:// paths for icons and backgrounds.'
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'webapp-launcher-backup.json';
        a.click();
        URL.revokeObjectURL(url);
        UI.showToast('Data exported (images excluded - use file paths)');
    },

    async import(file) {
        const text = await file.text();
        const data = JSON.parse(text);
        
        AppState.websites = data.websites || [];
        AppState.groups = data.groups || AppState.groups;
        
        AppState.websites.forEach(website => {
            if (!website.groupId) {
                website.groupId = 'ungrouped';
            }
            delete website._iconNote;
        });
        
        // Ensure all groups have width, order, and pinned
        AppState.groups.forEach((group, index) => {
            if (!group.width) group.width = 'full';
            if (group.order === undefined) group.order = index;
            if (group.pinned === undefined) group.pinned = false;
        });
        
        localStorage.setItem('websites', JSON.stringify(AppState.websites));
        localStorage.setItem('groups', JSON.stringify(AppState.groups));
        
        if (data.theme) localStorage.setItem('theme', data.theme);
        if (data.view) localStorage.setItem('view', data.view);
        if (data.iconSize) localStorage.setItem('iconSize', data.iconSize);
        if (data.backgroundPosition) localStorage.setItem('backgroundPosition', data.backgroundPosition);
        if (data.backgroundBlur) localStorage.setItem('backgroundBlur', data.backgroundBlur);
        
        UI.showToast('Data imported successfully! Refreshing...');
        setTimeout(() => location.reload(), 1500);
    }
};

// ========== Theme Manager ==========
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

// ========== Background Manager ==========
const Background = {
    async setImage(file) {
        const base64 = await Utils.fileToBase64(file);
        localStorage.setItem('backgroundImage', base64);
        document.body.style.backgroundImage = `url(${base64})`;
        const position = document.getElementById('bgPosition').value;
        this.applyPosition(position);
    },

    applyPosition(position) {
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
        }
        
        localStorage.setItem('backgroundPosition', position);
    },

    applyBlur(blurLevel) {
        const overlay = document.querySelector('.overlay');
        overlay.className = 'overlay';
        
        if (blurLevel !== 'medium-blur') {
            overlay.classList.add(blurLevel);
        }
        
        localStorage.setItem('backgroundBlur', blurLevel);
    },

    clear() {
        localStorage.removeItem('backgroundImage');
        localStorage.removeItem('backgroundPosition');
        document.body.style.backgroundImage = 'none';
        UI.showToast('Background image cleared!');
    },

    load() {
        const bgImage = localStorage.getItem('backgroundImage');
        const bgPosition = localStorage.getItem('backgroundPosition') || 'cover';
        const bgBlur = localStorage.getItem('backgroundBlur') || 'medium-blur';
        
        if (bgImage) {
            document.body.style.backgroundImage = `url(${bgImage})`;
            this.applyPosition(bgPosition);
        }
        
        document.getElementById('bgPosition').value = bgPosition;
        document.getElementById('bgBlur').value = bgBlur;
        this.applyBlur(bgBlur);
    }
};

// ========== Group Manager ==========
const GroupManager = {
    add(groupData) {
        // Set order to be last among regular groups (excluding ungrouped)
        const regularGroups = AppState.groups.filter(g => g.id !== 'ungrouped' && !g.pinned);
        groupData.order = regularGroups.length > 0 ? Math.max(...regularGroups.map(g => g.order)) + 1 : 0;
        if (!groupData.width) groupData.width = 'full';
        if (groupData.pinned === undefined) groupData.pinned = false;
        
        AppState.groups.push(groupData);
        Storage.save();
        if (window.UIRenderer) UIRenderer.render();
        UI.showToast('Group added successfully!');
    },

    update(id, groupData) {
        const index = AppState.groups.findIndex(g => g.id === id);
        if (index !== -1) {
            // Preserve order, width, and pinned if not specified
            if (groupData.order === undefined) {
                groupData.order = AppState.groups[index].order;
            }
            if (!groupData.width) {
                groupData.width = AppState.groups[index].width || 'full';
            }
            if (groupData.pinned === undefined) {
                groupData.pinned = AppState.groups[index].pinned || false;
            }
            
            AppState.groups[index] = groupData;
            Storage.save();
            if (window.UIRenderer) UIRenderer.render();
            UI.showToast('Group updated successfully!');
        }
    },

    toggleWidth(id) {
        const group = this.getById(id);
        
        if (group) {
            group.width = group.width === 'full' ? 'half' : 'full';
            Storage.save();
            
            if (window.UIRenderer) {
                UIRenderer.render();
            }
            
            UI.showToast(`Width set to ${group.width === 'half' ? '50%' : '100%'}`);
        }
    },

    togglePin(id) {
        // Don't allow pinning/unpinning the default group
        if (id === 'ungrouped') {
            UI.showToast('The default "My Apps" group is always at the bottom');
            return;
        }
        
        const group = this.getById(id);
        
        if (group) {
            group.pinned = !group.pinned;
            
            // Reorganize orders
            if (group.pinned) {
                // Moving to pinned: place at end of pinned groups
                const pinnedGroups = AppState.groups.filter(g => g.pinned && g.id !== id && g.id !== 'ungrouped');
                const maxPinnedOrder = pinnedGroups.length > 0 ? Math.max(...pinnedGroups.map(g => g.order)) : -1;
                group.order = maxPinnedOrder + 1;
            } else {
                // Moving to unpinned: place at start of unpinned groups
                const unpinnedGroups = AppState.groups.filter(g => !g.pinned && g.id !== id && g.id !== 'ungrouped');
                const minUnpinnedOrder = unpinnedGroups.length > 0 ? Math.min(...unpinnedGroups.map(g => g.order)) : 0;
                group.order = minUnpinnedOrder;
            }
            
            Storage.save();
            if (window.UIRenderer) UIRenderer.render();
            UI.showToast(group.pinned ? 'Group pinned to top!' : 'Group unpinned!');
        }
    },

    swapOrder(fromIndex, toIndex) {
        if (fromIndex < 0 || fromIndex >= AppState.groups.length ||
            toIndex < 0 || toIndex >= AppState.groups.length) {
            return;
        }
        
        const fromGroup = AppState.groups[fromIndex];
        const toGroup = AppState.groups[toIndex];
        
        // Don't allow moving the ungrouped group
        if (fromGroup.id === 'ungrouped' || toGroup.id === 'ungrouped') {
            UI.showToast('The default "My Apps" group cannot be moved');
            return;
        }
        
        // Don't allow swapping between pinned and unpinned sections
        if (fromGroup.pinned !== toGroup.pinned) {
            UI.showToast('Cannot reorder between pinned and regular groups');
            return;
        }
        
        // Swap the groups
        [AppState.groups[fromIndex], AppState.groups[toIndex]] = 
        [AppState.groups[toIndex], AppState.groups[fromIndex]];
        
        // Update order values
        AppState.groups.forEach((group, index) => {
            group.order = index;
        });
        
        Storage.save();
        if (window.UIRenderer) UIRenderer.render();
    },

    delete(id) {
        // Don't allow deleting the default group
        if (id === 'ungrouped') {
            UI.showToast('Cannot delete the default "My Apps" group!');
            return;
        }
        
        const websitesInGroup = AppState.websites.filter(w => w.groupId === id);
        
        let message = 'Are you sure you want to delete this group?';
        if (websitesInGroup.length > 0) {
            message = `This group contains ${websitesInGroup.length} website(s). They will be moved to "My Apps". Continue?`;
        }
        
        if (confirm(message)) {
            // Move websites to ungrouped
            AppState.websites.forEach(w => {
                if (w.groupId === id) {
                    w.groupId = 'ungrouped';
                }
            });
            
            AppState.groups = AppState.groups.filter(g => g.id !== id);
            
            // Reorder remaining groups
            AppState.groups.forEach((group, index) => {
                group.order = index;
            });
            
            Storage.save();
            if (window.UIRenderer) UIRenderer.render();
            UI.showToast('Group deleted! Websites moved to "My Apps"');
        }
    },

    getById(id) {
        return AppState.groups.find(g => g.id === id);
    }
};

// ========== Website Manager ==========
const WebsiteManager = {
    add(websiteData) {
        // Assign position as the next available index within the group
        const groupId = websiteData.groupId || 'ungrouped';
        const websitesInGroup = AppState.websites.filter(w => 
            (w.groupId || 'ungrouped') === groupId
        );
        websiteData.position = websitesInGroup.length;
        
        AppState.websites.push(websiteData);
        Storage.save();
        if (window.UIRenderer) {
            UIRenderer.render();
            UIRenderer.updateIconSizes();
        }
        UI.showToast('Website added successfully!');
    },

    update(id, websiteData) {
        const index = AppState.websites.findIndex(w => w.id === id);
        if (index !== -1) {
            // Preserve position if not specified
            if (websiteData.position === undefined) {
                websiteData.position = AppState.websites[index].position;
            }
            
            AppState.websites[index] = websiteData;
            Storage.save();
            if (window.UIRenderer) {
                UIRenderer.render();
                UIRenderer.updateIconSizes();
            }
            UI.showToast('Website updated successfully!');
        }
    },

    delete(id) {
        if (confirm('Are you sure you want to delete this website?')) {
            const website = this.getById(id);
            const groupId = website ? (website.groupId || 'ungrouped') : null;
            
            AppState.websites = AppState.websites.filter(w => w.id !== id);
            
            // Reassign positions for the affected group only
            if (groupId) {
                const groupWebsites = AppState.websites
                    .filter(w => (w.groupId || 'ungrouped') === groupId)
                    .sort((a, b) => (a.position || 0) - (b.position || 0));
                
                groupWebsites.forEach((w, index) => {
                    w.position = index;
                });
            }
            
            Storage.save();
            if (window.UIRenderer) {
                UIRenderer.render();
                UIRenderer.updateIconSizes();
            }
            UI.showToast('Website deleted successfully!');
        }
    },

    getById(id) {
        return AppState.websites.find(w => w.id === id);
    },

    moveToGroup(websiteId, targetGroupId) {
        const website = this.getById(websiteId);
        if (website) {
            const oldGroupId = website.groupId;
            website.groupId = targetGroupId;
            
            // When moving to a new group, place at the end
            if (oldGroupId !== targetGroupId) {
                const websitesInTargetGroup = AppState.websites.filter(w => 
                    (w.groupId || 'ungrouped') === targetGroupId && w.id !== websiteId
                );
                website.position = websitesInTargetGroup.length > 0 
                    ? Math.max(...websitesInTargetGroup.map(w => w.position || 0)) + 1
                    : 0;
            }
            
            Storage.save();
            if (window.UIRenderer) {
                UIRenderer.render();
                UIRenderer.updateIconSizes();
            }
            UI.showToast('Moved to new group!');
        }
    },

    swapPositions(draggedId, targetId) {
        const draggedWebsite = this.getById(draggedId);
        const targetWebsite = this.getById(targetId);
        
        if (!draggedWebsite || !targetWebsite) {
            console.error('[WebsiteManager] Could not find websites for swap');
            return;
        }
        
        // Check if they're in the same group
        const draggedGroup = draggedWebsite.groupId || 'ungrouped';
        const targetGroup = targetWebsite.groupId || 'ungrouped';
        
        if (draggedGroup !== targetGroup) {
            console.log('[WebsiteManager] Different groups, moving instead of swapping');
            this.moveToGroup(draggedId, targetGroup);
            return;
        }
        
        // Get all websites in this group, sorted by position
        const groupWebsites = AppState.websites
            .filter(w => (w.groupId || 'ungrouped') === draggedGroup)
            .sort((a, b) => (a.position || 0) - (b.position || 0));
        
        console.log('[WebsiteManager] Before swap:', groupWebsites.map(w => `${w.position}:${w.name}`));
        
        // Find the indices in the sorted group array
        const draggedGroupIndex = groupWebsites.findIndex(w => w.id === draggedId);
        const targetGroupIndex = groupWebsites.findIndex(w => w.id === targetId);
        
        if (draggedGroupIndex === -1 || targetGroupIndex === -1) {
            console.error('[WebsiteManager] Could not find indices in group');
            return;
        }
        
        console.log('[WebsiteManager] Swapping indices:', draggedGroupIndex, '↔', targetGroupIndex);
        
        // Swap the two items in the group array
        [groupWebsites[draggedGroupIndex], groupWebsites[targetGroupIndex]] = 
        [groupWebsites[targetGroupIndex], groupWebsites[draggedGroupIndex]];
        
        // Reassign positions based on new order (0, 1, 2, 3...)
        groupWebsites.forEach((website, index) => {
            console.log(`[WebsiteManager] Setting ${website.name} position to ${index}`);
            website.position = index;
        });
        
        console.log('[WebsiteManager] After swap:', groupWebsites.map(w => `${w.position}:${w.name}`));
        console.log('[WebsiteManager] Swapped:', draggedWebsite.name, '↔', targetWebsite.name);
        
        // Save to localStorage synchronously
        Storage.save();
        console.log('[WebsiteManager] Save complete');
        
        // Don't render here - let the drag handler manage rendering
    },
    
    reassignPositions() {
        // Reassign positions based on current array order
        AppState.websites.forEach((website, index) => {
            website.position = index;
        });
    },
    
    ensurePositions() {
        // Ensure all websites have a position property
        // Positions are assigned per-group, starting from 0
        let needsSave = false;
        
        // Get all unique groups
        const groups = [...new Set(AppState.websites.map(w => w.groupId || 'ungrouped'))];
        
        groups.forEach(groupId => {
            const groupWebsites = AppState.websites
                .filter(w => (w.groupId || 'ungrouped') === groupId);
            
            // Check if any are missing positions
            const needsPositions = groupWebsites.some(w => w.position === undefined);
            
            if (needsPositions) {
                // Assign sequential positions within this group
                groupWebsites.forEach((website, index) => {
                    website.position = index;
                    needsSave = true;
                });
            }
        });
        
        if (needsSave) {
            console.log('[WebsiteManager] Added missing position properties per group');
            Storage.save();
        }
    }
};

// ========== View Manager ==========
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
        if (window.UIRenderer) UIRenderer.updateIconSizes();
    }
};

// ========== UI Utilities ==========
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

// ========== Utility Functions ==========
const Utils = {
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
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

// ========== Public API ==========
const App = {
    init() {
        Storage.load();
        Theme.load();
        Background.load();
        
        // Ensure all websites have position properties
        WebsiteManager.ensurePositions();
        
        // Wait for other modules to load
        if (window.UIRenderer) {
            UIRenderer.render();
        }
        
        this.attachEventListeners();
        
        if (AppState.currentView === 'list') {
            ViewManager.setListView();
        }
        
        const sizeSlider = document.getElementById('sizeSlider');
        if (sizeSlider) {
            sizeSlider.value = AppState.iconSize;
        }
    },

    attachEventListeners() {
        // Theme
        document.getElementById('themeToggle')?.addEventListener('click', Theme.toggle);
        
        // Modals
        document.getElementById('addWebsiteBtn')?.addEventListener('click', () => {
            if (window.AppModal) AppModal.openAdd();
        });
        document.getElementById('addGroupBtn')?.addEventListener('click', () => {
            if (window.GroupModal) GroupModal.openAdd();
        });
        document.getElementById('settingsBtn')?.addEventListener('click', () => this.openSettings());
        document.getElementById('closeSettings')?.addEventListener('click', () => this.closeSettings());
        
        // Views
        document.getElementById('gridView')?.addEventListener('click', ViewManager.setGridView);
        document.getElementById('listView')?.addEventListener('click', ViewManager.setListView);
        document.getElementById('sizeSlider')?.addEventListener('input', (e) => ViewManager.updateIconSize(e.target.value));
        
        // Background
        document.getElementById('bgImage')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) await Background.setImage(file);
        });
        document.getElementById('bgPosition')?.addEventListener('change', (e) => Background.applyPosition(e.target.value));
        document.getElementById('bgBlur')?.addEventListener('change', (e) => Background.applyBlur(e.target.value));
        document.getElementById('clearBgImage')?.addEventListener('click', Background.clear);
        
        // Import/Export
        document.getElementById('exportData')?.addEventListener('click', Storage.export);
        document.getElementById('importData')?.addEventListener('click', () => {
            document.getElementById('importFile')?.click();
        });
        document.getElementById('importFile')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) await Storage.import(file);
        });
    },

    openSettings() {
        const modal = document.getElementById('settingsModal');
        if (modal) modal.classList.add('show');
    },

    closeSettings() {
        const modal = document.getElementById('settingsModal');
        if (modal) modal.classList.remove('show');
    },

    // Global functions for onclick handlers
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

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());

// Expose to global scope
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