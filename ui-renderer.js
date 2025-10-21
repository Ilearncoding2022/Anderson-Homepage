// ==========================================
// UI Renderer Module v1.0 - WITH DRAG AND DROP
// Handles rendering with click navigation + drag between groups
// Drag and drop for moving apps between groups only
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
        console.log('[UIRenderer] Websites array:', AppState.websites.map(w => `${w.id.slice(-4)}:${w.name}:pos${w.position}`));
        
        if (AppState.websites.length === 0 && AppState.groups.length <= 1) {
            emptyState.style.display = 'block';
            container.innerHTML = '';
            console.log('[UIRenderer] Showing empty state');
            return;
        }
        
        emptyState.style.display = 'none';
        
        // Sort groups: pinned first (by order), regular (by order), ungrouped last
        const sortedGroups = [...AppState.groups].sort((a, b) => {
            if (a.id === 'ungrouped') return 1;
            if (b.id === 'ungrouped') return -1;
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return (a.order || 0) - (b.order || 0);
        });
        
        console.log('[UIRenderer] Sorted groups:', sortedGroups.map(g => g.name));
        
        const groupsHTML = sortedGroups.map(group => {
            // Filter websites for this group and sort by position
            const groupWebsites = AppState.websites
                .filter(w => (w.groupId || 'ungrouped') === group.id)
                .sort((a, b) => {
                    const posA = a.position !== undefined ? a.position : 999999;
                    const posB = b.position !== undefined ? b.position : 999999;
                    console.log(`[UIRenderer] Comparing ${a.name}(${posA}) vs ${b.name}(${posB}) = ${posA - posB}`);
                    return posA - posB;
                });
            
            console.log(`[UIRenderer] Group "${group.name}" has websites:`, groupWebsites.map(w => `pos${w.position}:${w.name}`));
            console.log(`[UIRenderer] Rendering order:`, groupWebsites.map(w => w.name).join(' → '));
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
        const widthClass = group.width === 'half' ? 'half-width' : '';
        const widthLabel = group.width === 'half' ? '50%' : '100%';
        const pinnedClass = group.pinned ? 'pinned' : '';
        const defaultClass = group.id === 'ungrouped' ? 'default-group' : '';
        const pinIcon = group.pinned ? '📌' : '📍';
        const pinTitle = group.pinned ? 'Unpin from top' : 'Pin to top';
        
        const isDefault = group.id === 'ungrouped';
        const showPinButton = !isDefault;
        const showDeleteButton = !isDefault;
        
        // Don't sort - preserve the array order from AppState.websites
        const websitesHTML = websites && websites.length > 0
            ? websites.map(w => this.createWebsiteCard(w)).join('')
            : '<div class="group-drop-zone">Drag websites here</div>';
        
        return `
            <div class="app-group ${widthClass} ${pinnedClass} ${defaultClass}" 
                 data-group-id="${group.id}" 
                 data-order="${group.order}" 
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
                        <button class="width-toggle-btn" onclick="App.toggleGroupWidth('${group.id}')" title="Toggle width">${widthLabel}</button>
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
            
            // Click to navigate - only fires if no drag occurred
            card.addEventListener('click', (e) => {
                // Ignore if action buttons clicked
                if (e.target.closest('.card-actions') || e.target.closest('.new-tab-btn')) {
                    return;
                }
                
                // Ignore if we just finished dragging
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
            
            // New tab button
            const newTabBtn = card.querySelector('.new-tab-btn');
            if (newTabBtn) {
                newTabBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const url = card.getAttribute('data-url');
                    console.log('[CardHandlers] Opening in new tab:', url);
                    if (url) window.open(url, '_blank');
                });
            }
            
            // Middle click
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
        
        // Card drag handlers
        cards.forEach((card) => {
            // Make all child elements non-draggable to ensure card is the drag source
            card.querySelectorAll('*').forEach(child => {
                child.setAttribute('draggable', 'false');
            });
            
            // Drag Start - use mousedown to detect drag intent
            let dragStartTimer = null;
            let isDragIntended = false;
            
            card.addEventListener('mousedown', (e) => {
                // Prevent drag from action buttons
                if (e.target.closest('.card-actions') || e.target.closest('.new-tab-btn')) {
                    return;
                }
                
                // Allow immediate drag start
                isDragIntended = true;
            });
            
            card.addEventListener('dragstart', (e) => {
                // Prevent drag from action buttons
                if (e.target.closest('.card-actions') || e.target.closest('.new-tab-btn')) {
                    e.preventDefault();
                    return;
                }
                
                // If drag wasn't intended (shouldn't happen), prevent it
                if (!isDragIntended) {
                    e.preventDefault();
                    return;
                }
                
                const websiteId = card.getAttribute('data-id');
                const sourceGroupId = card.getAttribute('data-group-id');
                
                console.log('[DragDrop] === DRAG START ===', websiteId, 'from group', sourceGroupId);
                
                // Store drag state - mark as dragging immediately
                AppState.draggedElement = card;
                AppState.draggedId = websiteId;
                AppState.draggedSourceGroup = sourceGroupId;
                card.isDragging = true;
                
                // Visual feedback - make card semi-transparent
                card.classList.add('dragging');
                card.style.cursor = 'grabbing';
                
                // Highlight source group
                const sourceGroup = card.closest('.app-group');
                if (sourceGroup) {
                    sourceGroup.classList.add('drag-source-group');
                }
                
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', websiteId);
                
                // Create a drag image (the card itself)
                e.dataTransfer.setDragImage(card, e.offsetX, e.offsetY);
            });
            
            // Drag Over - for reordering within same group
            card.addEventListener('dragover', (e) => {
                // Don't highlight if it's the dragged card itself
                if (card === AppState.draggedElement) {
                    return;
                }
                
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            
            // Drag Enter - highlight card when hovering over it
            card.addEventListener('dragenter', (e) => {
                // Don't highlight if it's the dragged card itself
                if (card === AppState.draggedElement) {
                    return;
                }
                
                const targetGroupId = card.getAttribute('data-group-id');
                const sourceGroupId = AppState.draggedSourceGroup;
                
                // Highlight card for reordering
                console.log('[DragDrop] Drag enter card:', card.getAttribute('data-id'), 'source group:', sourceGroupId, 'target group:', targetGroupId);
                card.classList.add('drag-over-card');
            });
            
            // Drag Leave
            card.addEventListener('dragleave', (e) => {
                const rect = card.getBoundingClientRect();
                if (e.clientX < rect.left || e.clientX > rect.right || 
                    e.clientY < rect.top || e.clientY > rect.bottom) {
                    card.classList.remove('drag-over-card');
                }
            });
            
            // Drop on Card - for reordering
            card.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Prevent duplicate drop events
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
                
                // Don't do anything if dropping on itself
                if (draggedId === targetId) {
                    console.log('[DragDrop] Dropped on itself, ignoring');
                    return;
                }
                
                // Clear drag state immediately to prevent duplicate processing
                const savedDraggedId = draggedId;
                const savedSourceGroupId = sourceGroupId;
                AppState.draggedId = null;
                AppState.draggedSourceGroup = null;
                
                if (savedDraggedId && targetId) {
                    if (savedSourceGroupId === targetGroupId) {
                        // Reorder within same group
                        console.log('[DragDrop] Same group - calling swapPositions');
                        WebsiteManager.swapPositions(savedDraggedId, targetId);
                        
                        // Render after swap completes
                        setTimeout(() => {
                            if (window.UIRenderer) {
                                UIRenderer.render();
                                UIRenderer.updateIconSizes();
                            }
                        }, 100);
                        
                        UI.showToast('Position updated! ↕️');
                    } else {
                        // Move to different group
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
            
            // Drag End
            card.addEventListener('dragend', (e) => {
                console.log('[DragDrop] === DRAG END ===');
                
                isDragIntended = false;
                
                // Remove all drag classes
                card.classList.remove('dragging');
                card.style.cursor = 'grab';
                
                // Remove all highlights
                document.querySelectorAll('.website-card').forEach(c => {
                    c.classList.remove('drag-over-card');
                });
                
                document.querySelectorAll('.app-group').forEach(g => {
                    g.classList.remove('drag-source-group');
                    g.classList.remove('drag-over-group');
                    g.classList.remove('drop-success');
                });
                
                // Remove drop zone highlights
                document.querySelectorAll('[data-drop-zone="true"]').forEach(z => {
                    z.classList.remove('drag-over-drop-zone');
                });
                
                // Reset drag state after a delay to prevent immediate click
                setTimeout(() => { 
                    card.isDragging = false;
                    AppState.draggedElement = null;
                    AppState.draggedId = null;
                    AppState.draggedSourceGroup = null;
                }, 300);
            });
            
            // Reset drag intent on mouse up (if drag didn't start)
            card.addEventListener('mouseup', () => {
                isDragIntended = false;
            });
        });
        
        // Drop zone handlers (for moving to empty areas or different groups)
        dropZones.forEach((zone) => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            
            zone.addEventListener('dragenter', (e) => {
                e.preventDefault();
                
                const targetGroup = zone.closest('.app-group');
                const targetGroupId = targetGroup?.getAttribute('data-group-id');
                
                // Only highlight if it's a different group
                if (targetGroupId && targetGroupId !== AppState.draggedSourceGroup) {
                    console.log('[DragDrop] Drag enter target group:', targetGroupId);
                    zone.classList.add('drag-over-drop-zone');
                    targetGroup.classList.add('drag-over-group');
                }
            });
            
            zone.addEventListener('dragleave', (e) => {
                // Check if we're actually leaving the zone
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
                
                // Remove drop zone highlight
                zone.classList.remove('drag-over-drop-zone');
                targetGroup?.classList.remove('drag-over-group');
                
                // Only move if dropping in a different group
                if (websiteId && targetGroupId && targetGroupId !== sourceGroupId) {
                    console.log('[DragDrop] Moving website to new group');
                    
                    // Success animation
                    if (targetGroup) {
                        targetGroup.classList.add('drop-success');
                        setTimeout(() => {
                            targetGroup.classList.remove('drop-success');
                        }, 600);
                    }
                    
                    // Move the website
                    WebsiteManager.moveToGroup(websiteId, targetGroupId);
                    
                    // Show toast notification
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

// Initialize renderer when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    if (typeof AppState !== 'undefined' && UIRenderer) {
        UIRenderer.render();
        UIRenderer.updateIconSizes();
    }
});

// Expose to global scope
window.UIRenderer = UIRenderer;