// ==========================================
// 1-CORE-MANAGERS.JS - Data & State Management
// Anderson Homepage v2.0
//
// Contents:
// - COLOR_PALETTE (configuration)
// - AppState (state management)
// - Storage (localStorage operations)
// - GroupManager (group CRUD)
// - WebsiteManager (website CRUD)
// ==========================================

// ========================================
// CONFIGURATION & CONSTANTS
// ========================================

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

// ========================================
// STATE MANAGEMENT
// ========================================

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

// ========================================
// STORAGE MANAGER
// ========================================

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
                position: 999999,
                pinned: false
            }];
            this.save();
        }
        
        // Migrate: Ensure all groups have required properties
        AppState.groups.forEach((group, index) => {
            if (!group.width) group.width = 'full';
            if (group.pinned === undefined) group.pinned = false;
            
            if (group.position === undefined) {
                if (group.id === 'ungrouped') {
                    group.position = 999999;
                } else if (group.order !== undefined) {
                    group.position = group.order + 1;
                } else {
                    group.position = index + 1;
                }
            }
        });
        
        this.sortGroups();
        
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

    sortGroups() {
        AppState.groups.sort((a, b) => {
            if (a.id === 'ungrouped') return 1;
            if (b.id === 'ungrouped') return -1;
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return (a.position || 0) - (b.position || 0);
        });
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
        
        AppState.groups.forEach((group, index) => {
            if (!group.width) group.width = 'full';
            if (group.pinned === undefined) group.pinned = false;
            if (group.position === undefined) {
                group.position = group.id === 'ungrouped' ? 999999 : index + 1;
            }
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

// ========================================
// GROUP MANAGER
// ========================================

const GroupManager = {
    add(groupData) {
        if (!groupData.position) {
            const regularGroups = AppState.groups.filter(g => g.id !== 'ungrouped');
            const maxPosition = regularGroups.length > 0 
                ? Math.max(...regularGroups.map(g => g.position || 0))
                : 0;
            groupData.position = maxPosition + 1;
        }
        
        if (!groupData.width) groupData.width = 'full';
        if (groupData.pinned === undefined) groupData.pinned = false;
        
        AppState.groups.push(groupData);
        Storage.sortGroups();
        Storage.save();
        if (window.UIRenderer) UIRenderer.render();
        UI.showToast('Group added successfully!');
    },

    update(id, groupData) {
        const index = AppState.groups.findIndex(g => g.id === id);
        if (index !== -1) {
            if (groupData.position === undefined) {
                groupData.position = AppState.groups[index].position;
            }
            if (!groupData.width) {
                groupData.width = AppState.groups[index].width || 'full';
            }
            if (groupData.pinned === undefined) {
                groupData.pinned = AppState.groups[index].pinned || false;
            }
            
            AppState.groups[index] = groupData;
            Storage.sortGroups();
            Storage.save();
            if (window.UIRenderer) UIRenderer.render();
            UI.showToast('Group updated successfully!');
        }
    },

    toggleWidth(id) {
        const group = this.getById(id);
        
        if (group) {
            // Cycle through: full → half → third → full
            if (group.width === 'full') {
                group.width = 'half';
            } else if (group.width === 'half') {
                group.width = 'third';
            } else {
                group.width = 'full';
            }
            
            Storage.save();
            
            if (window.UIRenderer) {
                UIRenderer.render();
            }
            
            const widthText = {
                'full': '100%',
                'half': '50%',
                'third': '33%'
            }[group.width] || '100%';
            
            UI.showToast(`Width set to ${widthText}`);
        }
    },

    togglePin(id) {
        if (id === 'ungrouped') {
            UI.showToast('The default "My Apps" group is always at the bottom');
            return;
        }
        
        const group = this.getById(id);
        
        if (group) {
            group.pinned = !group.pinned;
            Storage.sortGroups();
            Storage.save();
            if (window.UIRenderer) UIRenderer.render();
            UI.showToast(group.pinned ? 'Group pinned to top!' : 'Group unpinned!');
        }
    },

    delete(id) {
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
            AppState.websites.forEach(w => {
                if (w.groupId === id) {
                    w.groupId = 'ungrouped';
                }
            });
            
            AppState.groups = AppState.groups.filter(g => g.id !== id);
            
            Storage.save();
            if (window.UIRenderer) UIRenderer.render();
            UI.showToast('Group deleted! Websites moved to "My Apps"');
        }
    },

    getById(id) {
        return AppState.groups.find(g => g.id === id);
    }
};

// ========================================
// WEBSITE MANAGER
// ========================================

const WebsiteManager = {
    add(websiteData) {
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
        
        const draggedGroup = draggedWebsite.groupId || 'ungrouped';
        const targetGroup = targetWebsite.groupId || 'ungrouped';
        
        if (draggedGroup !== targetGroup) {
            console.log('[WebsiteManager] Different groups, moving instead of swapping');
            this.moveToGroup(draggedId, targetGroup);
            return;
        }
        
        const groupWebsites = AppState.websites
            .filter(w => (w.groupId || 'ungrouped') === draggedGroup)
            .sort((a, b) => (a.position || 0) - (b.position || 0));
        
        console.log('[WebsiteManager] Before swap:', groupWebsites.map(w => `${w.position}:${w.name}`));
        
        const draggedGroupIndex = groupWebsites.findIndex(w => w.id === draggedId);
        const targetGroupIndex = groupWebsites.findIndex(w => w.id === targetId);
        
        if (draggedGroupIndex === -1 || targetGroupIndex === -1) {
            console.error('[WebsiteManager] Could not find indices in group');
            return;
        }
        
        console.log('[WebsiteManager] Swapping indices:', draggedGroupIndex, '↔', targetGroupIndex);
        
        [groupWebsites[draggedGroupIndex], groupWebsites[targetGroupIndex]] = 
        [groupWebsites[targetGroupIndex], groupWebsites[draggedGroupIndex]];
        
        groupWebsites.forEach((website, index) => {
            console.log(`[WebsiteManager] Setting ${website.name} position to ${index}`);
            website.position = index;
        });
        
        console.log('[WebsiteManager] After swap:', groupWebsites.map(w => `${w.position}:${w.name}`));
        console.log('[WebsiteManager] Swapped:', draggedWebsite.name, '↔', targetWebsite.name);
        
        Storage.save();
        console.log('[WebsiteManager] Save complete');
    },
    
    reassignPositions() {
        AppState.websites.forEach((website, index) => {
            website.position = index;
        });
    },
    
    ensurePositions() {
        let needsSave = false;
        
        const groups = [...new Set(AppState.websites.map(w => w.groupId || 'ungrouped'))];
        
        groups.forEach(groupId => {
            const groupWebsites = AppState.websites
                .filter(w => (w.groupId || 'ungrouped') === groupId);
            
            const needsPositions = groupWebsites.some(w => w.position === undefined);
            
            if (needsPositions) {
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