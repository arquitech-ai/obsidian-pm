import { App, Modal, TFile } from 'obsidian';

interface FileItem {
  file: TFile;
  folder: string;
  selected: boolean;
}

export class ImportModal extends Modal {
  private files: FileItem[] = [];
  private filteredFiles: FileItem[] = [];
  private selectedCount = 0;
  private searchInput: HTMLInputElement | null = null;
  private selectAllCheckbox: HTMLInputElement | null = null;
  private nextButton: HTMLButtonElement | null = null;
  private fileListContainer: HTMLDivElement | null = null;
  private counterLabel: HTMLDivElement | null = null;
  private onConfirm: ((selectedFiles: TFile[]) => void) | null = null;

  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('import-modal');
    this.modalEl.addClass('import-modal-container');

    // Load all markdown files from vault
    this.loadVaultFiles();

    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private loadVaultFiles(): void {
    const allFiles = this.app.vault.getFiles();
    const markdownFiles = allFiles.filter(f => f.extension === 'md');

    this.files = markdownFiles.map(file => {
      const folder = file.parent?.path || '/';
      return {
        file,
        folder: folder === '/' ? '/' : folder,
        selected: false,
      };
    });

    this.filteredFiles = [...this.files];
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    // ── Header ──────────────────────────────────────────────────────────────
    const header = contentEl.createDiv('import-modal-header');
    header.style.padding = '1rem';
    header.style.borderBottom = `1px solid var(--background-modifier-border, #e0e0e0)`;
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.gap = '1rem';

    const title = header.createEl('h2', { text: 'Select notes to import' });
    title.style.margin = '0';
    title.style.fontSize = '1.125rem';
    title.style.color = 'var(--text-normal, #2b3438)';

    this.counterLabel = header.createDiv('import-counter');
    this.counterLabel.style.color = 'var(--text-muted, #666)';
    this.counterLabel.style.fontSize = '0.875rem';
    this.updateCounter();

    // ── Search input ────────────────────────────────────────────────────────
    const searchContainer = contentEl.createDiv('import-search-container');
    searchContainer.style.padding = '1rem';
    searchContainer.style.borderBottom = `1px solid var(--background-modifier-border, #e0e0e0)`;

    this.searchInput = searchContainer.createEl('input', {
      type: 'text',
      cls: 'prompt-input',
      placeholder: 'Search files...',
    });
    this.searchInput.style.width = '100%';
    this.searchInput.style.padding = '0.5rem';
    this.searchInput.style.border = `1px solid var(--background-modifier-border, #e0e0e0)`;
    this.searchInput.style.borderRadius = '0.25rem';
    this.searchInput.style.backgroundColor = 'var(--background-primary, #fff)';
    this.searchInput.style.color = 'var(--text-normal, #2b3438)';
    this.searchInput.addEventListener('input', () => this.handleSearch());

    // ── File list ───────────────────────────────────────────────────────────
    const listContainer = contentEl.createDiv('import-list-wrapper');
    listContainer.style.flex = '1';
    listContainer.style.overflowY = 'auto';
    listContainer.style.overflowX = 'hidden';
    listContainer.style.maxHeight = '300px';
    listContainer.style.display = 'flex';
    listContainer.style.flexDirection = 'column';

    this.fileListContainer = listContainer;

    // Select All row
    const selectAllRow = listContainer.createDiv('import-select-all-row');
    selectAllRow.style.padding = '0.75rem 1rem';
    selectAllRow.style.display = 'flex';
    selectAllRow.style.alignItems = 'center';
    selectAllRow.style.gap = '0.75rem';
    selectAllRow.style.borderBottom = `1px solid var(--background-modifier-border, #e0e0e0)`;
    selectAllRow.style.backgroundColor = 'var(--background-secondary, #f5f5f5)';
    selectAllRow.style.position = 'sticky';
    selectAllRow.style.top = '0';
    selectAllRow.style.zIndex = '1';

    this.selectAllCheckbox = selectAllRow.createEl('input', {
      type: 'checkbox',
    });
    this.selectAllCheckbox.style.cursor = 'pointer';
    this.selectAllCheckbox.style.accentColor = 'var(--interactive-accent, #0066cc)';
    this.selectAllCheckbox.addEventListener('change', () => this.handleSelectAll());

    const selectAllLabel = selectAllRow.createEl('label', { text: 'Select All' });
    selectAllLabel.style.cursor = 'pointer';
    selectAllLabel.style.flex = '1';
    selectAllLabel.style.color = 'var(--text-normal, #2b3438)';
    selectAllLabel.style.marginBottom = '0';
    selectAllLabel.addEventListener('click', () => {
      if (this.selectAllCheckbox) {
        this.selectAllCheckbox.checked = !this.selectAllCheckbox.checked;
        this.handleSelectAll();
      }
    });

    // File list items
    this.renderFileList();

    // ── Footer with Next button ────────────────────────────────────────────
    const footer = contentEl.createDiv('import-modal-footer');
    footer.style.padding = '1rem';
    footer.style.borderTop = `1px solid var(--background-modifier-border, #e0e0e0)`;
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '0.75rem';

    const cancelButton = footer.createEl('button', { text: 'Cancel' });
    cancelButton.style.padding = '0.5rem 1rem';
    cancelButton.style.borderRadius = '0.25rem';
    cancelButton.style.border = `1px solid var(--background-modifier-border, #e0e0e0)`;
    cancelButton.style.backgroundColor = 'var(--background-primary, #fff)';
    cancelButton.style.color = 'var(--text-normal, #2b3438)';
    cancelButton.style.cursor = 'pointer';
    cancelButton.addEventListener('click', () => this.close());

    this.nextButton = footer.createEl('button', { text: 'Next →', cls: 'mod-cta' });
    this.nextButton.style.padding = '0.5rem 1rem';
    this.nextButton.style.borderRadius = '0.25rem';
    this.nextButton.style.cursor = this.selectedCount > 0 ? 'pointer' : 'not-allowed';
    this.nextButton.disabled = this.selectedCount === 0;
    this.nextButton.addEventListener('click', () => this.handleNext());
  }

  private renderFileList(): void {
    if (!this.fileListContainer) return;

    // Clear existing items (keep the select-all row)
    const items = this.fileListContainer.querySelectorAll('.import-file-item');
    items.forEach(item => item.remove());

    this.filteredFiles.forEach((item, index) => {
      const row = this.fileListContainer!.createDiv('import-file-item suggestion-item');
      row.style.padding = '0.75rem 1rem';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '0.75rem';
      row.style.borderBottom = `1px solid var(--background-modifier-border, #e0e0e0)`;
      row.style.cursor = 'pointer';
      row.style.transition = 'background-color 0.15s';
      row.style.backgroundColor = item.selected ? 'var(--background-modifier-active, #e0e0e0)' : 'transparent';

      row.addEventListener('mouseenter', () => {
        if (!item.selected) {
          row.style.backgroundColor = 'var(--background-secondary, #f5f5f5)';
        }
      });
      row.addEventListener('mouseleave', () => {
        row.style.backgroundColor = item.selected ? 'var(--background-modifier-active, #e0e0e0)' : 'transparent';
      });

      const checkbox = row.createEl('input', { type: 'checkbox' });
      checkbox.checked = item.selected;
      checkbox.style.cursor = 'pointer';
      checkbox.style.accentColor = 'var(--interactive-accent, #0066cc)';
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        item.selected = checkbox.checked;
        this.updateCounter();
        this.updateSelectAllCheckbox();
        this.updateNextButton();
        // Update row background
        row.style.backgroundColor = item.selected ? 'var(--background-modifier-active, #e0e0e0)' : 'transparent';
      });

      const nameEl = row.createEl('span', { text: item.file.basename });
      nameEl.style.flex = '1';
      nameEl.style.color = 'var(--text-normal, #2b3438)';
      nameEl.style.fontWeight = '500';

      const folderEl = row.createEl('span', { text: item.folder });
      folderEl.style.color = 'var(--text-muted, #666)';
      folderEl.style.fontSize = '0.875rem';

      row.addEventListener('click', () => {
        checkbox.checked = !checkbox.checked;
        item.selected = checkbox.checked;
        this.updateCounter();
        this.updateSelectAllCheckbox();
        this.updateNextButton();
        row.style.backgroundColor = item.selected ? 'var(--background-modifier-active, #e0e0e0)' : 'transparent';
      });
    });
  }

  private handleSearch(): void {
    const query = this.searchInput?.value.toLowerCase() || '';
    this.filteredFiles = this.files.filter(item =>
      item.file.basename.toLowerCase().includes(query) ||
      item.folder.toLowerCase().includes(query)
    );
    this.renderFileList();
  }

  private handleSelectAll(): void {
    const isChecked = this.selectAllCheckbox?.checked || false;
    this.filteredFiles.forEach(item => {
      item.selected = isChecked;
    });
    this.updateCounter();
    this.updateNextButton();
    this.renderFileList();
  }

  private updateCounter(): void {
    if (!this.counterLabel) return;
    const count = this.files.filter(f => f.selected).length;
    this.selectedCount = count;
    this.counterLabel.setText(`${count} selected`);
  }

  private updateSelectAllCheckbox(): void {
    if (!this.selectAllCheckbox) return;
    const allFiltered = this.filteredFiles.length > 0;
    const allSelected = allFiltered && this.filteredFiles.every(f => f.selected);
    this.selectAllCheckbox.checked = allSelected;
  }

  private updateNextButton(): void {
    if (!this.nextButton) return;
    this.nextButton.disabled = this.selectedCount === 0;
    this.nextButton.style.cursor = this.selectedCount > 0 ? 'pointer' : 'not-allowed';
    this.nextButton.style.opacity = this.selectedCount > 0 ? '1' : '0.5';
  }

  private handleNext(): void {
    if (this.selectedCount === 0) return;
    const selectedFiles = this.files.filter(f => f.selected).map(f => f.file);
    if (this.onConfirm) {
      this.onConfirm(selectedFiles);
    }
    this.close();
  }

  setOnConfirm(callback: (selectedFiles: TFile[]) => void): void {
    this.onConfirm = callback;
  }
}
