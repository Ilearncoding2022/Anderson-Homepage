// ==========================================
// Group Modal Module v0.5
// Handles group creation and editing UI
// ==========================================

const GroupModal = {
    modalId: 'groupModal',
    
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
                        <button class="close-modal" id="closeGroupModal">×</button>
                    </div>
                    <form id="groupForm">
                        <div class="form-group">
                            <label for="groupName">Group Name</label>
                            <input type="text" id="groupName" required placeholder="Work, Personal, Development...">
                        </div>
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
        const closeBtn = document.getElementById('closeGroupModal');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        const form = document.getElementById('groupForm');
        if (form) {
            form.addEventListener('submit', (e) => this.handleSubmit(e));
        }
    },

    openAdd() {
        AppState.editingGroupId = null;
        const form = document.getElementById('groupForm');
        if (form) form.reset();
        
        document.getElementById('groupModalTitle').textContent = 'Add Group';
        this.renderColorPicker();
        this.show();
    },

    openEdit(id) {
        AppState.editingGroupId = id;
        const group = GroupManager.getById(id);
        
        if (!group) return;
        
        document.getElementById('groupModalTitle').textContent = 'Edit Group';
        document.getElementById('groupName').value = group.name;
        this.renderColorPicker(group.color);
        this.show();
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
        
        // Attach click handlers to color options
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
        const selectedColor = document.querySelector('.color-option.selected');
        const color = selectedColor ? selectedColor.dataset.color || selectedColor.style.backgroundColor : COLOR_PALETTE[0].value;
        
        const group = {
            id: AppState.editingGroupId || Date.now().toString(),
            name,
            color
        };
        
        if (AppState.editingGroupId) {
            GroupManager.update(AppState.editingGroupId, group);
        } else {
            GroupManager.add(group);
        }
        
        AppState.editingGroupId = null;
        this.close();
    },

    show() {
        const modal = document.getElementById(this.modalId);
        if (modal) {
            modal.classList.add('show');
        }
    },

    close() {
        const modal = document.getElementById(this.modalId);
        if (modal) {
            modal.classList.remove('show');
        }
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    GroupModal.initialize();
});

// Expose to global scope
window.GroupModal = GroupModal;