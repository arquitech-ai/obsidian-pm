import { type App, Modal } from 'obsidian';
import type PMPlugin from '../main';
import type { Project, Task } from '../types';
import { TaskModal } from '../modals/TaskModal';
import { ProjectModal } from '../modals/ProjectModal';
import { ProjectPickerModal, TaskPickerModal } from '../modals/PickerModals';

/**
 * Opens an Obsidian-native confirmation dialog.
 * Returns a promise that resolves to true if confirmed, false if cancelled.
 */
export function confirmDialog(app: App, message: string, confirmLabel = 'Delete'): Promise<boolean> {
  return new Promise(resolve => {
    const modal = new ConfirmModal(app, message, confirmLabel, resolve);
    modal.open();
  });
}

/**
 * Opens an Obsidian-native text input prompt.
 * Returns the trimmed string, or null if cancelled/empty.
 */
export function promptText(app: App, label: string, placeholder = ''): Promise<string | null> {
  return new Promise(resolve => {
    const modal = new TextPromptModal(app, label, placeholder, resolve);
    modal.open();
  });
}

class TextPromptModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private label: string,
    private placeholder: string,
    private resolve: (value: string | null) => void,
  ) {
    super(app);
  }

  private finish(value: string | null): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass('pm-prompt-modal');

    contentEl.createEl('p', {
      text: this.label,
      attr: { style: 'margin: 0 0 0.75rem 0; color: var(--text-normal); font-size: var(--font-ui-medium);' },
    });

    const input = contentEl.createEl('input', {
      type: 'text',
      placeholder: this.placeholder,
      attr: { style: 'width: 100%; padding: 0.5rem; margin-bottom: 1rem; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-primary); color: var(--text-normal); font-size: var(--font-ui-medium);' },
    });

    const btnRow = contentEl.createDiv({ attr: { style: 'display: flex; justify-content: flex-end; gap: 0.5rem;' } });

    const cancelBtn = btnRow.createEl('button', { text: 'Cancel', cls: 'mod-muted' });
    cancelBtn.addEventListener('click', () => { this.finish(null); this.close(); });

    const okBtn = btnRow.createEl('button', { text: 'OK', cls: 'mod-cta' });
    okBtn.addEventListener('click', () => {
      const val = input.value.trim();
      this.finish(val || null);
      this.close();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); okBtn.click(); }
      if (e.key === 'Escape') { e.preventDefault(); this.finish(null); this.close(); }
    });

    setTimeout(() => input.focus(), 10);
  }

  onClose(): void {
    this.finish(null);
    this.contentEl.empty();
  }
}

class ConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private message: string,
    private confirmLabel: string,
    private resolve: (value: boolean) => void,
  ) {
    super(app);
  }

  private finish(value: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass('pm-confirm-modal');

    contentEl.createEl('p', {
      text: this.message,
      attr: { style: 'margin: 0 0 1rem 0; color: var(--text-normal); font-size: var(--font-ui-medium);' },
    });

    const btnRow = contentEl.createDiv({ attr: { style: 'display: flex; justify-content: flex-end; gap: 0.5rem;' } });

    const cancelBtn = btnRow.createEl('button', { text: 'Cancel', cls: 'mod-muted' });
    cancelBtn.addEventListener('click', () => { this.finish(false); this.close(); });

    const confirmBtn = btnRow.createEl('button', { text: this.confirmLabel, cls: 'mod-warning' });
    confirmBtn.style.background = 'var(--background-modifier-error)';
    confirmBtn.style.color = 'var(--text-on-accent)';
    confirmBtn.addEventListener('click', () => { this.finish(true); this.close(); });
  }

  onClose(): void {
    this.finish(false);
    this.contentEl.empty();
  }
}

/**
 * Centralized modal helpers. Instead of `new TaskModal(app, plugin, project, task, parentId, cb).open()`
 * everywhere (6 params, 14+ call sites), use `openTaskModal(plugin, project, { task, parentId, onSave })`.
 */

export interface OpenTaskModalOpts {
  task?: Task | null;
  parentId?: string | null;
  defaults?: Partial<Task>;
  onSave: (task: Task) => Promise<void>;
}

export function openTaskModal(
  plugin: PMPlugin,
  project: Project,
  opts: OpenTaskModalOpts,
): void {
  new TaskModal(
    plugin.app,
    plugin,
    project,
    opts.task ?? null,
    opts.parentId ?? null,
    opts.onSave,
    opts.defaults,
  ).open();
}

export interface OpenProjectModalOpts {
  project?: Project | null;
  onSave: (project: Project) => Promise<void>;
}

export function openProjectModal(
  plugin: PMPlugin,
  opts: OpenProjectModalOpts,
): void {
  new ProjectModal(
    plugin.app,
    plugin,
    opts.project ?? null,
    opts.onSave,
  ).open();
}

export function openProjectPicker(
  plugin: PMPlugin,
  projects: Project[],
  onChoose: (project: Project) => void,
): void {
  new ProjectPickerModal(plugin.app, projects, onChoose).open();
}

export function openTaskPicker(
  plugin: PMPlugin,
  tasks: Task[],
  onChoose: (task: Task) => void,
): void {
  new TaskPickerModal(plugin.app, tasks, onChoose).open();
}
