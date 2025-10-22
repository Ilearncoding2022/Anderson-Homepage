// ==========================================
// UI Renderer Module v1.2 - WITH 33% WIDTH SUPPORT
// Handles rendering with position-based sorting
// Groups sorted by: pinned status + position number
// NOW SUPPORTS: 33% (third) width option
// ==========================================

const UIRenderer = {
    render() {
        console.log('[UIRenderer] ========== RENDER START ==========');
        const container = document.getElementById('mainContainer');
        const emptyState = document.getElementById('emptyState');
        
        if (!container || !emptyState) {
            console.error('[UIRenderer] Required DOM elements not found');
            return;
        }
        
        console.log('[UIRenderer] Websites count:', AppState.websites.length);
        console.log('[UIRenderer] Groups count:', AppState.groups.length);
        
        if (AppState.websites.length === 0 && AppState.groups.length <= 1) {
            emptyState.style.display = 'block';
            container.innerHTML = '';
            console.log('[UIRenderer] Showing empty state');
            return;
        }
        
        emptyState.style.display = 'none';
        
        // Sort groups: pinned first (by position), regular (by position), ungrouped last
        const sortedGroups = [...AppState.groups].sort((a, b) => {
            // Ungrouped always last
            if (a.id === 'ungrouped') return 1;
            if (b.id === 'ungrouped') return -1;
            
            // Pinned groups first
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            
            // Within same section (pinned or regular), sort by position number
            return (a.position || 0) - (b.position || 0);
        });
        
        console.log('[UIRenderer] Sorted groups:', sortedGroups.map(g => 
            `${g.name} (pos:${g.position}, pinned:${g.pinned})`
        ));
        
        const groupsHTML = sortedGroups.map(group => {
            // Filter websites for this group and sort by position
            const groupWebsites = AppState.websites
                .filter(w => (w.groupId || 'ungrouped') === group.id)
                .sort((a, b) => {
                    const posA = a.position !== undefined ? a.position : 999999;
                    const posB = b.position !== undefined ? b.position : 999999;
                    return posA - posB;
                });
            
            console.log(`[UIRenderer] Group "${group.name}" (pos:${group.position}) has websites:`, 
                groupWebsites.map(w => `pos${w.position}:${w.name}`));
            
            return this.createGroupSection(group, groupWebsites);
        }).join('');
        
        container.innerHTML = `<div class="groups-container">${groupsHTML}</div>`;
        console.log('[UIRenderer] HTML rendered, attaching handlers...');
        
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                console.log('[UIRenderer] Initializing handlers...');
                this.attachCardHandlers();
                this.attachDragHandlers();
                console.log('[UIRenderer] ========== RENDER COMPLETE ==========');
            });
        });
    },

    createGroupSection(group, websites) {
        if (!group) return '';
        
        const containerClass = AppState.currentView === 'grid' ? 'websites-grid' : 'websites-list';
        
        // Determine width class based on group.width
        let widthClass = '';
        let widthLabel = '100%';
        if (group.width === 'half') {
            widthClass = 'half-width';
            widthLabel = '50%';
        } else if (group.width === 'third') {
            widthClass = 'third-width';
            widthLabel = '33%';
        }
        
        const pinnedClass = group.pinned ? 'pinned' : '';
        const defaultClass = group.id === 'ungrouped' ? 'default-group' : '';
        const pinIcon = group.pinned ? '📌' : '📍';
        const pinTitle = group.pinned ? 'Unpin from top' : 'Pin to top';
        
        const isDefault = group.id === 'ungrouped';
        const showPinButton = !isDefault;
        const showDeleteButton = !isDefault;
        
        const websitesHTML = websites && websites.length > 0
            ? websites.map(w => this.createWebsiteCard(w)).join('')
            : '<div class="group-drop-zone">Drag websites here</div>';
        
        return `
            <div class="app-group ${widthClass} ${pinnedClass} ${defaultClass}" 
                 data-group-id="${group.id}" 
                 data-position="${group.position}" 
                 data-pinned="${group.pinned}" 
                 style="background: ${group.color || COLOR_PALETTE[0].value};">
                <div class="group-header">
                    <div class="group-title-container">
                        <div class="group-title">
                            ${group.pinned ? '<span class="pin-indicator">📌</span>' : ''}
                            ${isDefault ? '<span class="default-indicator">⚓</span>' : ''}
                            ${group.name}
                            <span class="group-count">(${websites ? websites.length : 0})</span>
                        </div>
                    </div>
                    <div class="group-actions">
                        ${showPinButton ? `<button class="group-action-btn pin-btn" onclick="App.toggleGroupPin('${group.id}')" title="${pinTitle}">${pinIcon}</button>` : ''}
                        <button class="width-toggle-btn" onclick="App.toggleGroupWidth('${group.id}')" title="Toggle width (cycles 100% → 50% → 33%)">${widthLabel}</button>
                        <button class="group-action-btn" onclick="App.editGroup('${group.id}')" title="Edit Group">✏️</button>
                        ${showDeleteButton ? `<button class="group-action-btn delete-group-btn" onclick="App.deleteGroup('${group.id}')" title="Delete Group">×</button>` : ''}
                    </div>
                </div>
                <div class="${containerClass}" data-drop-zone="true">
                    ${websitesHTML}
                </div>
            </div>
        `;
    },

    createWebsiteCard(website) {
        if (!website) return '';
        
        const isListView = AppState.currentView === 'list';
        const iconSize = isListView ? 50 : AppState.iconSize;
        const cardStyle = !isListView ? 
            `padding: ${AppState.iconSize * 0.25}px; min-height: ${parseInt(AppState.iconSize) + 60}px;` : '';
        
        const versionInfo = (website.version || website.versionDate) 
            ? `<div class="website-version">${website.version || ''} ${website.versionDate ? `(${website.versionDate})` : ''}</div>`
            : '';
        
        const icon = website.icon 
            ? `<img src="${website.icon}" alt="${website.name}" class="website-icon" style="width: ${iconSize}px; height: ${iconSize}px;">`
            : `<div class="website-icon" style="width: ${iconSize}px; height: ${iconSize}px; font-size: ${iconSize * 0.5}px;">🌐</div>`;
        
        return `
            <div class="website-card ${isListView ? 'list-view' : ''}" 
                 data-id="${website.id}" 
                 data-url="${website.url}" 
                 data-group-id="${website.groupId || 'ungrouped'}"
                 draggable="true" 
                 style="${cardStyle}">
                ${icon}
                <div class="website-info">
                    <div class="website-name">${website.name}</div>
                    ${versionInfo}
                </div>
                <div class="card-actions">
                    <button class="edit-btn" onclick="App.editWebsite(event, '${website.id}')" title="Edit">✏️</button>
                    <button class="delete-btn" onclick="App.deleteWebsite(event, '${website.id}')" title="Delete">×</button>
                </div>
                <button class="new-tab-btn" title="Open in new tab">⧉</button>
            </div>
        `;
    },

    updateIconSizes() {
        document.documentElement.style.setProperty('--icon-size', `${AppState.iconSize}px`);
        const cardSize = Math.max(150, parseInt(AppState.iconSize) + 70);
        document.documentElement.style.setProperty('--card-size', `${cardSize}px`);
    },

    attachCardHandlers() {
        const cards = document.querySelectorAll('.website-card');
        console.log('[CardHandlers] Attaching click handlers to', cards.length, 'cards');
        
        cards.forEach(card => {
            card.style.cursor = 'grab';
            
            card.addEventListener('click', (e) => {
                if (e.target.closest('.card-actions') || e.target.closest('.new-tab-btn')) {
                    return;
                }
                
                if (card.isDragging) {
                    console.log('[CardHandlers] Click cancelled - was dragging');
                    return;
                }
                
                const url = card.getAttribute('data-url');
                if (url) {
                    console.log('[CardHandlers] Navigating to:', url);
                    window.location.href = url;
                }
            });
            
            const newTabBtn = card.querySelector('.new-tab-btn');
            if (newTabBtn) {
                newTabBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const url = card.getAttribute('data-url');
                    console.log('[CardHandlers] Opening in new tab:', url);
                    if (url) window.open(url, '_blank');
                });
            }
            
            card.addEventListener('auxclick', (e) => {
                if (e.button === 1) {
                    e.preventDefault();
                    const url = card.getAttribute('data-url');
                    console.log('[CardHandlers] Middle click - opening in new tab:', url);
                    if (url) window.open(url, '_blank');
                }
            });
        });
        
        console.log('[CardHandlers] All click handlers attached');
    },

    attachDragHandlers() {
        const cards = document.querySelectorAll('.website-card');
        const dropZones = document.querySelectorAll('[data-drop-zone="true"]');
        
        console.log('[DragDrop] Attaching drag handlers to', cards.length, 'cards and', dropZones.length, 'drop zones');
        
        cards.forEach((card) => {
            card.querySelectorAll('*').forEach(child => {
                child.setAttribute('draggable', 'false');
            });
            
            let dragStartTimer = null;
            let isDragIntended = false;
            
            card.addEventListener('mousedown', (e) => {
                if (e.target.closest('.card-actions') || e.target.closest('.new-tab-btn')) {
                    return;
                }
                
                isDragIntended = true;
            });
            
            card.addEventListener('dragstart', (e) => {
                if (e.target.closest('.card-actions') || e.target.closest('.new-tab-btn')) {
                    e.preventDefault();
                    return;
                }
                
                if (!isDragIntended) {
                    e.preventDefault();
                    return;
                }
                
                const websiteId = card.getAttribute('data-id');
                const sourceGroupId = card.getAttribute('data-group-id');
                
                console.log('[DragDrop] === DRAG START ===', websiteId, 'from group', sourceGroupId);
                
                AppState.draggedElement = card;
                AppState.draggedId = websiteId;
                AppState.draggedSourceGroup = sourceGroupId;
                card.isDragging = true;
                
                card.classList.add('dragging');
                card.style.cursor = 'grabbing';
                
                const sourceGroup = card.closest('.app-group');
                if (sourceGroup) {
                    sourceGroup.classList.add('drag-source-group');
                }
                
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', websiteId);
                
                e.dataTransfer.setDragImage(card, e.offsetX, e.offsetY);
            });
            
            card.addEventListener('dragover', (e) => {
                if (card === AppState.draggedElement) {
                    return;
                }
                
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            
            card.addEventListener('dragenter', (e) => {
                if (card === AppState.draggedElement) {
                    return;
                }
                
                const targetGroupId = card.getAttribute('data-group-id');
                const sourceGroupId = AppState.draggedSourceGroup;
                
                console.log('[DragDrop] Drag enter card:', card.getAttribute('data-id'), 'source group:', sourceGroupId, 'target group:', targetGroupId);
                card.classList.add('drag-over-card');
            });
            
            card.addEventListener('dragleave', (e) => {
                const rect = card.getBoundingClientRect();
                if (e.clientX < rect.left || e.clientX > rect.right || 
                    e.clientY < rect.top || e.clientY > rect.bottom) {
                    card.classList.remove('drag-over-card');
                }
            });
            
            card.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (!AppState.draggedId) {
                    console.log('[DragDrop] No dragged ID, ignoring duplicate drop');
                    return;
                }
                
                const targetId = card.getAttribute('data-id');
                const targetGroupId = card.getAttribute('data-group-id');
                const draggedId = AppState.draggedId;
                const sourceGroupId = AppState.draggedSourceGroup;
                
                console.log('[DragDrop] === DROP ON CARD ===');
                console.log('[DragDrop] Dragged:', draggedId, 'from group:', sourceGroupId);
                console.log('[DragDrop] Target:', targetId, 'in group:', targetGroupId);
                
                card.classList.remove('drag-over-card');
                
                if (draggedId === targetId) {
                    console.log('[DragDrop] Dropped on itself, ignoring');
                    return;
                }
                
                const savedDraggedId = draggedId;
                const savedSourceGroupId = sourceGroupId;
                AppState.draggedId = null;
                AppState.draggedSourceGroup = null;
                
                if (savedDraggedId && targetId) {
                    if (savedSourceGroupId === targetGroupId) {
                        console.log('[DragDrop] Same group - calling swapPositions');
                        WebsiteManager.swapPositions(savedDraggedId, targetId);
                        
                        setTimeout(() => {
                            if (window.UIRenderer) {
                                UIRenderer.render();
                                UIRenderer.updateIconSizes();
                            }
                        }, 100);
                        
                        UI.showToast('Position updated! ↕️');
                    } else {
                        console.log('[DragDrop] Different group - calling moveToGroup');
                        WebsiteManager.moveToGroup(savedDraggedId, targetGroupId);
                        
                        const website = WebsiteManager.getById(savedDraggedId);
                        const targetGroupName = AppState.groups.find(g => g.id === targetGroupId)?.name;
                        if (website && targetGroupName) {
                            UI.showToast(`"${website.name}" moved to "${targetGroupName}"! ✓`);
                        }
                    }
                }
            });
            
            card.addEventListener('dragend', (e) => {
                console.log('[DragDrop] === DRAG END ===');
                
                isDragIntended = false;
                
                card.classList.remove('dragging');
                card.style.cursor = 'grab';
                
                document.querySelectorAll('.website-card').forEach(c => {
                    c.classList.remove('drag-over-card');
                });
                
                document.querySelectorAll('.app-group').forEach(g => {
                    g.classList.remove('drag-source-group');
                    g.classList.remove('drag-over-group');
                    g.classList.remove('drop-success');
                });
                
                document.querySelectorAll('[data-drop-zone="true"]').forEach(z => {
                    z.classList.remove('drag-over-drop-zone');
                });
                
                setTimeout(() => { 
                    card.isDragging = false;
                    AppState.draggedElement = null;
                    AppState.draggedId = null;
                    AppState.draggedSourceGroup = null;
                }, 300);
            });
            
            card.addEventListener('mouseup', () => {
                isDragIntended = false;
            });
        });
        
        dropZones.forEach((zone) => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            
            zone.addEventListener('dragenter', (e) => {
                e.preventDefault();
                
                const targetGroup = zone.closest('.app-group');
                const targetGroupId = targetGroup?.getAttribute('data-group-id');
                
                if (targetGroupId && targetGroupId !== AppState.draggedSourceGroup) {
                    console.log('[DragDrop] Drag enter target group:', targetGroupId);
                    zone.classList.add('drag-over-drop-zone');
                    targetGroup.classList.add('drag-over-group');
                }
            });
            
            zone.addEventListener('dragleave', (e) => {
                const rect = zone.getBoundingClientRect();
                if (e.clientX < rect.left || e.clientX > rect.right || 
                    e.clientY < rect.top || e.clientY > rect.bottom) {
                    
                    zone.classList.remove('drag-over-drop-zone');
                    const targetGroup = zone.closest('.app-group');
                    if (targetGroup) {
                        targetGroup.classList.remove('drag-over-group');
                    }
                }
            });
            
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const targetGroup = zone.closest('.app-group');
                const targetGroupId = targetGroup?.getAttribute('data-group-id');
                const websiteId = AppState.draggedId;
                const sourceGroupId = AppState.draggedSourceGroup;
                
                console.log('[DragDrop] === DROP ON GROUP ZONE ===', websiteId, 'to group', targetGroupId);
                
                zone.classList.remove('drag-over-drop-zone');
                targetGroup?.classList.remove('drag-over-group');
                
                if (websiteId && targetGroupId && targetGroupId !== sourceGroupId) {
                    console.log('[DragDrop] Moving website to new group');
                    
                    if (targetGroup) {
                        targetGroup.classList.add('drop-success');
                        setTimeout(() => {
                            targetGroup.classList.remove('drop-success');
                        }, 600);
                    }
                    
                    WebsiteManager.moveToGroup(websiteId, targetGroupId);
                    
                    const website = WebsiteManager.getById(websiteId);
                    const targetGroupName = AppState.groups.find(g => g.id === targetGroupId)?.name;
                    if (website && targetGroupName) {
                        UI.showToast(`"${website.name}" moved to "${targetGroupName}"! ✓`);
                    }
                } else if (websiteId && targetGroupId && targetGroupId === sourceGroupId) {
                    console.log('[DragDrop] Dropped in same group (no position change)');
                }
            });
        });
        
        console.log('[DragDrop] All drag handlers attached');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    if (typeof AppState !== 'undefined' && UIRenderer) {
        UIRenderer.render();
        UIRenderer.updateIconSizes();
    }
});

window.UIRenderer = UIRenderer;