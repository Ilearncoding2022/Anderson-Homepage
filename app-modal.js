// ==========================================
// App Modal Module v0.6 - FIXED
// Handles website/app creation and editing UI
// Fixed: Edit functionality now working properly
// ==========================================

const AppModal = {
    modalId: 'websiteModal',
    
    initialize() {
        console.log('[AppModal] Initializing...');
        this.createModal();
        this.attachEventListeners();
        console.log('[AppModal] Initialized successfully');
    },

    createModal() {
        const container = document.getElementById('modalContainer');
        if (!container) {
            console.error('[AppModal] Modal container not found');
            return;
        }

        const modalHTML = `
            <div class="modal" id="${this.modalId}">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2 id="modalTitle">Add Website</h2>
                        <button class="close-modal" id="closeModal">×</button>
                    </div>
                    <form id="websiteForm">
                        <div class="form-group">
                            <label for="websiteName">Website Name</label>
                            <input type="text" id="websiteName" required placeholder="My Local Website">
                        </div>
                        <div class="form-group">
                            <label for="websiteUrl">Local Directory Path</label>
                            <input type="text" id="websiteUrl" required placeholder="file:///C:/path/to/website/index.html">
                        </div>
                        <div class="form-group">
                            <label for="websiteGroup">Group</label>
                            <select id="websiteGroup"></select>
                        </div>
                        <div class="form-group">
                            <label for="websiteVersion">Version Number (Optional)</label>
                            <input type="text" id="websiteVersion" placeholder="1.0.0 or v2.3-beta">
                        </div>
                        <div class="form-group">
                            <label for="websiteVersionDate">Version Date (Optional)</label>
                            <input type="date" id="websiteVersionDate">
                        </div>
                        <div class="form-group">
                            <label for="websiteIconPath">Icon (File Path or Upload)</label>
                            <div class="icon-input-group">
                                <input type="text" id="websiteIconPath" placeholder="file:///C:/path/to/icon.png">
                                <button type="button" id="browseIconBtn">📁 Browse</button>
                            </div>
                            <input type="file" id="websiteIconFilePicker" accept=".png,.jpg,.jpeg,.ico,.svg" style="display: none;">
                            <div style="margin-top: 0.5rem; text-align: center; color: var(--text-secondary); font-size: 0.85rem;">OR</div>
                            <div class="file-input-wrapper" style="margin-top: 0.5rem;">
                                <input type="file" id="websiteIcon" accept=".png,.jpg,.jpeg,.ico,.svg">
                                <label for="websiteIcon" class="file-input-label">
                                    Upload icon (stored as base64)
                                </label>
                            </div>
                            <img class="icon-preview" id="iconPreview" alt="Icon preview">
                            <div style="margin-top: 0.5rem; font-size: 0.8rem; color: var(--text-secondary);">
                                <strong>Tip:</strong> Use "Browse" to select a file path for smaller exports. "Upload" stores as base64 (larger).
                            </div>
                        </div>
                        <button type="submit">Save Website</button>
                    </form>
                </div>
            </div>
        `;

        container.insertAdjacentHTML('beforeend', modalHTML);
    },

    attachEventListeners() {
        // Close button
        const closeBtn = document.getElementById('closeModal');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                console.log('[AppModal] Close button clicked');
                this.close();
            });
        }

        // Close on overlay click
        const modal = document.getElementById(this.modalId);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    console.log('[AppModal] Overlay clicked');
                    this.close();
                }
            });
        }

        // Form submission
        const form = document.getElementById('websiteForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                console.log('[AppModal] Form submitted');
                this.handleSubmit(e);
            });
        }

        // Icon file upload
        const iconUpload = document.getElementById('websiteIcon');
        if (iconUpload) {
            iconUpload.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (file) {
                    console.log('[AppModal] Icon file selected:', file.name);
                    const preview = document.getElementById('iconPreview');
                    const base64 = await Utils.fileToBase64(file);
                    preview.src = base64;
                    preview.classList.add('show');
                    document.getElementById('websiteIconPath').value = '';
                }
            });
        }

        // Icon path input
        const iconPath = document.getElementById('websiteIconPath');
        if (iconPath) {
            iconPath.addEventListener('input', (e) => {
                const path = e.target.value.trim();
                const preview = document.getElementById('iconPreview');
                
                if (path && Utils.isFilePath(path)) {
                    preview.src = path;
                    preview.classList.add('show');
                    preview.onerror = () => {
                        preview.classList.remove('show');
                    };
                    // Clear file upload if path is entered
                    document.getElementById('websiteIcon').value = '';
                } else if (path) {
                    // If it's not a file path, try loading as regular URL
                    preview.src = path;
                    preview.classList.add('show');
                    preview.onerror = () => {
                        preview.classList.remove('show');
                    };
                    document.getElementById('websiteIcon').value = '';
                } else {
                    preview.classList.remove('show');
                }
            });
        }

        // Browse button
        const browseBtn = document.getElementById('browseIconBtn');
        if (browseBtn) {
            browseBtn.addEventListener('click', () => {
                document.getElementById('websiteIconFilePicker')?.click();
            });
        }

        // File picker for preview
        const filePicker = document.getElementById('websiteIconFilePicker');
        if (filePicker) {
            filePicker.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const preview = document.getElementById('iconPreview');
                    const tempUrl = URL.createObjectURL(file);
                    preview.src = tempUrl;
                    preview.classList.add('show');
                    
                    preview.onload = () => {
                        URL.revokeObjectURL(tempUrl);
                    };
                    
                    const pathInput = document.getElementById('websiteIconPath');
                    pathInput.placeholder = `Please enter full path for: ${file.name}`;
                    document.getElementById('websiteIcon').value = '';
                }
            });
        }

        // Drag and drop for icon upload
        this.setupDragDrop();
    },

    setupDragDrop() {
        const fileInputLabel = document.querySelector('.file-input-label');
        const fileInput = document.getElementById('websiteIcon');
        
        if (!fileInputLabel || !fileInput) return;
        
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            fileInputLabel.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });
        
        ['dragenter', 'dragover'].forEach(eventName => {
            fileInputLabel.addEventListener(eventName, () => {
                fileInputLabel.style.backgroundColor = 'var(--bg-primary)';
            });
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            fileInputLabel.addEventListener(eventName, () => {
                fileInputLabel.style.backgroundColor = '';
            });
        });
        
        fileInputLabel.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            
            if (files.length > 0) {
                fileInput.files = files;
                const event = new Event('change', { bubbles: true });
                fileInput.dispatchEvent(event);
            }
        });
    },

    openAdd() {
        console.log('[AppModal] Opening add modal');
        AppState.editingId = null;
        document.getElementById('modalTitle').textContent = 'Add Website';
        
        // Reset form
        const form = document.getElementById('websiteForm');
        if (form) form.reset();
        
        // Clear icon inputs
        document.getElementById('websiteIconPath').value = '';
        document.getElementById('iconPreview').classList.remove('show');
        document.getElementById('iconPreview').src = '';
        
        // Set default date to today
        document.getElementById('websiteVersionDate').value = new Date().toISOString().split('T')[0];
        
        this.populateGroupDropdown();
        this.show();
    },

    openEdit(id) {
        console.log('[AppModal] Opening edit modal for ID:', id);
        AppState.editingId = id;
        const website = WebsiteManager.getById(id);
        
        if (!website) {
            console.error('[AppModal] Website not found:', id);
            UI.showToast('Error: Website not found!');
            return;
        }
        
        console.log('[AppModal] Editing website:', website);
        
        document.getElementById('modalTitle').textContent = 'Edit Website';
        document.getElementById('websiteName').value = website.name || '';
        document.getElementById('websiteUrl').value = website.url || '';
        document.getElementById('websiteVersion').value = website.version || '';
        document.getElementById('websiteVersionDate').value = website.versionDate || '';
        
        // Clear previous icon display
        const preview = document.getElementById('iconPreview');
        preview.classList.remove('show');
        preview.src = '';
        document.getElementById('websiteIconPath').value = '';
        document.getElementById('websiteIcon').value = '';
        
        // Handle icon display
        if (website.icon) {
            console.log('[AppModal] Loading icon:', website.icon.substring(0, 50) + '...');
            if (Utils.isFilePath(website.icon) || !Utils.isBase64Image(website.icon)) {
                // It's a file path
                document.getElementById('websiteIconPath').value = website.icon;
                preview.src = website.icon;
                preview.classList.add('show');
            } else {
                // It's base64
                preview.src = website.icon;
                preview.classList.add('show');
            }
        }
        
        this.populateGroupDropdown(website.groupId);
        this.show();
    },

    populateGroupDropdown(selectedGroupId = 'ungrouped') {
        const groupSelect = document.getElementById('websiteGroup');
        if (!groupSelect) return;
        
        console.log('[AppModal] Populating groups, selected:', selectedGroupId);
        
        groupSelect.innerHTML = AppState.groups.map(g => 
            `<option value="${g.id}" ${g.id === selectedGroupId ? 'selected' : ''}>${g.name}</option>`
        ).join('');
    },

    async handleSubmit(e) {
        e.preventDefault();
        
        console.log('[AppModal] Processing form submission...');
        
        const name = document.getElementById('websiteName').value.trim();
        const url = document.getElementById('websiteUrl').value.trim();
        const groupId = document.getElementById('websiteGroup').value;
        const version = document.getElementById('websiteVersion').value.trim();
        const versionDate = document.getElementById('websiteVersionDate').value;
        const iconPath = document.getElementById('websiteIconPath').value.trim();
        const iconFile = document.getElementById('websiteIcon').files[0];
        
        console.log('[AppModal] Form data:', { name, url, groupId, version, versionDate, hasIconPath: !!iconPath, hasIconFile: !!iconFile });
        
        let iconData = null;
        
        // Priority: iconFile > iconPath > existing icon (for edit)
        if (iconFile) {
            console.log('[AppModal] Converting icon file to base64...');
            iconData = await Utils.fileToBase64(iconFile);
        } else if (iconPath) {
            console.log('[AppModal] Using icon path:', iconPath);
            iconData = iconPath;
        } else if (AppState.editingId) {
            const existingWebsite = WebsiteManager.getById(AppState.editingId);
            if (existingWebsite && existingWebsite.icon) {
                console.log('[AppModal] Keeping existing icon');
                iconData = existingWebsite.icon;
            }
        }
        
        const website = {
            id: AppState.editingId || Date.now().toString(),
            name,
            url,
            groupId,
            version: version || null,
            versionDate: versionDate || null,
            icon: iconData
        };
        
        console.log('[AppModal] Website object created:', { ...website, icon: website.icon ? website.icon.substring(0, 50) + '...' : null });
        
        if (AppState.editingId) {
            console.log('[AppModal] Updating existing website...');
            WebsiteManager.update(AppState.editingId, website);
        } else {
            console.log('[AppModal] Adding new website...');
            WebsiteManager.add(website);
        }
        
        this.close();
    },

    show() {
        const modal = document.getElementById(this.modalId);
        if (modal) {
            console.log('[AppModal] Showing modal');
            modal.classList.add('show');
            
            // Focus on first input
            setTimeout(() => {
                document.getElementById('websiteName')?.focus();
            }, 100);
        }
    },

    close() {
        const modal = document.getElementById(this.modalId);
        if (modal) {
            console.log('[AppModal] Closing modal');
            modal.classList.remove('show');
            AppState.editingId = null;
        }
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('[AppModal] DOM ready, initializing...');
    AppModal.initialize();
});

// Expose to global scope
window.AppModal = AppModal;
