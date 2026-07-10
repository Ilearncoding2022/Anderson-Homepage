// ==========================================
// App Modal Module v0.8
// Handles website/app creation and editing UI
// ==========================================

const AppModal = {
    modalId: 'websiteModal',
    _initialState: null,
    _iconChanged: false,

    initialize() {
        this.createModal();
        this.attachEventListeners();
    },

    createModal() {
        const container = document.getElementById('modalContainer');
        if (!container) return;

        const modalHTML = `
            <div class="modal" id="${this.modalId}">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2 id="modalTitle">Add Website</h2>
                        <button class="close-modal" id="closeModal">&times;</button>
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
                            <label for="websiteIcon">Icon</label>
                            <div class="file-input-wrapper">
                                <input type="file" id="websiteIcon" accept=".png,.jpg,.jpeg,.ico,.svg">
                                <label for="websiteIcon" class="file-input-label">
                                    Upload icon
                                </label>
                            </div>
                            <img class="icon-preview" id="iconPreview" alt="Icon preview">
                        </div>
                        <button type="submit">Save Website</button>
                    </form>
                </div>
            </div>
        `;

        container.insertAdjacentHTML('beforeend', modalHTML);
    },

    attachEventListeners() {
        document.getElementById('closeModal')?.addEventListener('click', () => this.tryClose());

        const modal = document.getElementById(this.modalId);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.tryClose();
            });
        }

        document.getElementById('websiteForm')?.addEventListener('submit', (e) => this.handleSubmit(e));

        document.getElementById('websiteIcon')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                const preview = document.getElementById('iconPreview');
                const base64 = await Utils.fileToBase64(file);
                preview.src = base64;
                preview.classList.add('show');
                this._iconChanged = true;
            }
        });

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
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                fileInput.files = files;
                fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    },

    // ===================== State tracking =====================

    _captureState() {
        return {
            name: document.getElementById('websiteName').value,
            url: document.getElementById('websiteUrl').value,
            group: document.getElementById('websiteGroup').value,
            version: document.getElementById('websiteVersion').value,
            versionDate: document.getElementById('websiteVersionDate').value,
        };
    },

    _isDirty() {
        if (!this._initialState) return false;
        if (this._iconChanged) return true;
        const cur = this._captureState();
        return cur.name !== this._initialState.name ||
               cur.url !== this._initialState.url ||
               cur.group !== this._initialState.group ||
               cur.version !== this._initialState.version ||
               cur.versionDate !== this._initialState.versionDate;
    },

    // ===================== Open / Close =====================

    openAdd() {
        AppState.editingId = null;
        document.getElementById('modalTitle').textContent = 'Add Website';

        const form = document.getElementById('websiteForm');
        if (form) form.reset();

        document.getElementById('iconPreview').classList.remove('show');
        document.getElementById('iconPreview').src = '';

        document.getElementById('websiteVersionDate').value = new Date().toISOString().split('T')[0];

        this.populateGroupDropdown();

        this._iconChanged = false;
        this._initialIconSrc = '';
        this._initialState = this._captureState();

        this.show();
    },

    openEdit(id) {
        AppState.editingId = id;
        const website = WebsiteManager.getById(id);

        if (!website) {
            UI.showToast('Error: Website not found!');
            return;
        }

        document.getElementById('modalTitle').textContent = 'Edit Website';
        document.getElementById('websiteName').value = website.name || '';
        document.getElementById('websiteUrl').value = website.url || '';
        document.getElementById('websiteVersion').value = website.version || '';
        document.getElementById('websiteVersionDate').value = website.versionDate || '';

        const preview = document.getElementById('iconPreview');
        preview.classList.remove('show');
        preview.src = '';
        document.getElementById('websiteIcon').value = '';

        if (website.icon) {
            preview.src = website.icon;
            preview.classList.add('show');
        }

        this.populateGroupDropdown(website.groupId);

        this._iconChanged = false;
        this._initialIconSrc = website.icon || '';
        this._initialState = this._captureState();

        this.show();
    },

    populateGroupDropdown(selectedGroupId = 'ungrouped') {
        const groupSelect = document.getElementById('websiteGroup');
        if (!groupSelect) return;

        groupSelect.innerHTML = AppState.groups.map(g =>
            `<option value="${Utils.sanitizeHTML(g.id)}" ${g.id === selectedGroupId ? 'selected' : ''}>${Utils.sanitizeHTML(g.name)}</option>`
        ).join('');
    },

    async handleSubmit(e) {
        e.preventDefault();

        const name = document.getElementById('websiteName').value.trim();
        const url = document.getElementById('websiteUrl').value.trim();
        const groupId = document.getElementById('websiteGroup').value;
        const version = document.getElementById('websiteVersion').value.trim();
        const versionDate = document.getElementById('websiteVersionDate').value;
        const iconFile = document.getElementById('websiteIcon').files[0];

        if (url && !Utils.isSafeUrl(url)) {
            UI.showToast("That URL isn't allowed (only http, https, file, mailto, tel).");
            return;
        }

        let iconData = null;

        if (iconFile) {
            iconData = await Utils.fileToBase64(iconFile);
        } else if (AppState.editingId) {
            const existingWebsite = WebsiteManager.getById(AppState.editingId);
            if (existingWebsite?.icon) {
                iconData = existingWebsite.icon;
            }
        }

        const website = {
            id: AppState.editingId || crypto.randomUUID(),
            name,
            url,
            groupId,
            version: version || null,
            versionDate: versionDate || null,
            icon: iconData
        };

        if (AppState.editingId) {
            WebsiteManager.update(AppState.editingId, website);
        } else {
            WebsiteManager.add(website);
        }

        this.close();
    },

    tryClose() {
        if (!this._isDirty()) {
            this.close();
            return;
        }
        UI.showUnsavedChangesDialog({
            onSaveAndClose: () => document.getElementById('websiteForm')?.requestSubmit(),
            onCloseWithout: () => this.close(),
            onGoBack: () => {},
        });
    },

    show() {
        const modal = document.getElementById(this.modalId);
        if (modal) {
            modal.classList.add('show');
            setTimeout(() => {
                document.getElementById('websiteName')?.focus();
            }, 100);
        }
    },

    close() {
        const modal = document.getElementById(this.modalId);
        if (modal) {
            modal.classList.remove('show');
            AppState.editingId = null;
            this._initialState = null;
            this._iconChanged = false;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    AppModal.initialize();
});

window.AppModal = AppModal;
