// ==========================================
// Group Modal Module v0.7
// Handles group creation and editing UI
// ==========================================

const GroupModal = {
    modalId: 'groupModal',
    _initialState: null,

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
                        <h2 id="groupModalTitle">Add Group</h2>
                        <button class="close-modal" id="closeGroupModal">&times;</button>
                    </div>
                    <form id="groupForm">
                        <div class="form-group">
                            <label for="groupName">Group Name</label>
                            <input type="text" id="groupName" required placeholder="Work, Personal, Development...">
                        </div>
                        <input type="hidden" id="groupPosition">
                        <div class="form-group">
                            <label>Background Color</label>
                            <div class="color-picker-grid" id="colorPicker"></div>
                        </div>
                        <button type="submit">Save Group</button>
                    </form>
                </div>
            </div>
        `;

        container.insertAdjacentHTML('beforeend', modalHTML);
    },

    attachEventListeners() {
        document.getElementById('closeGroupModal')?.addEventListener('click', () => this.tryClose());

        const modal = document.getElementById(this.modalId);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.tryClose();
            });
        }

        document.getElementById('groupForm')?.addEventListener('submit', (e) => this.handleSubmit(e));
    },

    // ===================== State tracking =====================

    _captureState() {
        const selected = document.querySelector('.color-option.selected');
        return {
            name: document.getElementById('groupName').value,
            position: document.getElementById('groupPosition').value,
            color: selected?.dataset?.color || '',
        };
    },

    _isDirty() {
        if (!this._initialState) return false;
        const cur = this._captureState();
        return cur.name !== this._initialState.name ||
               cur.position !== this._initialState.position ||
               cur.color !== this._initialState.color;
    },

    // ===================== Open / Close =====================

    openAdd() {
        AppState.editingGroupId = null;
        const form = document.getElementById('groupForm');
        if (form) form.reset();

        document.getElementById('groupModalTitle').textContent = 'Add Group';

        this.populatePositionDropdown();
        this.renderColorPicker();

        this._initialState = this._captureState();
        this.show();
    },

    openEdit(id) {
        AppState.editingGroupId = id;
        const group = GroupManager.getById(id);

        if (!group) return;

        document.getElementById('groupModalTitle').textContent = 'Edit Group';
        document.getElementById('groupName').value = group.name;

        this.populatePositionDropdown(group.position);
        this.renderColorPicker(group.color);

        this._initialState = this._captureState();
        this.show();
    },

    populatePositionDropdown(currentPosition = null) {
        const positionInput = document.getElementById('groupPosition');
        if (!positionInput) return;

        if (currentPosition != null) {
            positionInput.value = currentPosition;
        } else {
            const usedPositions = AppState.groups
                .filter(g => g.id !== 'ungrouped')
                .map(g => g.position || 0);
            positionInput.value = usedPositions.length > 0 ? Math.max(...usedPositions) + 1 : 1;
        }
    },

    renderColorPicker(selectedColor = null) {
        const picker = document.getElementById('colorPicker');
        if (!picker) return;

        picker.innerHTML = COLOR_PALETTE.map(color => `
            <div class="color-option ${color.value === selectedColor ? 'selected' : ''}"
                 style="background: ${color.value};"
                 data-color="${color.value}"
                 title="${color.name}">
            </div>
        `).join('');

        picker.querySelectorAll('.color-option').forEach(option => {
            option.addEventListener('click', () => this.selectColor(option));
        });

        if (!selectedColor) {
            const firstOption = picker.querySelector('.color-option');
            if (firstOption) {
                firstOption.classList.add('selected');
            }
        }
    },

    selectColor(element) {
        if (!element) return;
        document.querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
        element.classList.add('selected');
    },

    handleSubmit(e) {
        e.preventDefault();

        const name = document.getElementById('groupName').value;
        const positionInput = document.getElementById('groupPosition');
        const position = positionInput ? parseInt(positionInput.value) : 1;
        const selectedColor = document.querySelector('.color-option.selected');
        const color = selectedColor ? selectedColor.dataset.color || selectedColor.style.backgroundColor : COLOR_PALETTE[0].value;

        const group = {
            id: AppState.editingGroupId || crypto.randomUUID(),
            name,
            color,
            position: position
        };

        if (AppState.editingGroupId) {
            GroupManager.update(AppState.editingGroupId, group);
        } else {
            GroupManager.add(group);
        }

        AppState.editingGroupId = null;
        this.close();
    },

    tryClose() {
        if (!this._isDirty()) {
            this.close();
            return;
        }
        UI.showUnsavedChangesDialog({
            onSaveAndClose: () => document.getElementById('groupForm')?.requestSubmit(),
            onCloseWithout: () => this.close(),
            onGoBack: () => {},
        });
    },

    show() {
        const modal = document.getElementById(this.modalId);
        if (modal) {
            modal.classList.add('show');
            setTimeout(() => {
                document.getElementById('groupName')?.focus();
            }, 100);
        }
    },

    close() {
        const modal = document.getElementById(this.modalId);
        if (modal) {
            modal.classList.remove('show');
            this._initialState = null;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    GroupModal.initialize();
});

window.GroupModal = GroupModal;
