import { App, Modal } from 'obsidian';
import type PMPlugin from '../main';
import type { GroupConfig, ClientConfig, Project } from '../types';
import { makeGroupConfig, makeClientConfig } from '../types';

// ─── Shared color palette ─────────────────────────────────────────────────────

const PALETTE = [
  '#8b72be', '#b07d9e', '#c47070', '#b8a06b',
  '#79b58d', '#6ba8a0', '#7a9ec4', '#767491', '#8aab6b',
];

type Tab = 'groups' | 'clients';

// ─── Modal ────────────────────────────────────────────────────────────────────

export class GroupClientModal extends Modal {
  private tab: Tab;
  private editingGroupId: string | null = null;
  private editingClientId: string | null = null;

  constructor(
    app: App,
    private plugin: PMPlugin,
    private projects: Project[],
    private onSave: () => void,
    initialTab: Tab = 'groups',
  ) {
    super(app);
    this.tab = initialTab;
  }

  onOpen(): void {
    this.modalEl.addClass('pm-modal', 'pm-modal--gcm');
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    el.addClass('pm-gcm');

    // ── Tab bar ───────────────────────────────────────────────────────────────
    const tabBar = el.createDiv('pm-gcm-tabs');
    for (const t of ['groups', 'clients'] as Tab[]) {
      const btn = tabBar.createEl('button', {
        text: t === 'groups' ? 'Groups' : 'Clients',
        cls: 'pm-gcm-tab',
      });
      if (this.tab === t) btn.addClass('pm-gcm-tab--active');
      btn.addEventListener('click', () => { this.tab = t; this.render(); });
    }

    if (this.tab === 'groups') {
      this.renderGroupsTab(el);
    } else {
      this.renderClientsTab(el);
    }
  }

  // ─── Groups tab ─────────────────────────────────────────────────────────────

  private renderGroupsTab(el: HTMLElement): void {
    const header = el.createDiv('pm-gcm-header');
    header.createEl('h3', { text: 'Groups', cls: 'pm-gcm-title' });
    const addBtn = header.createEl('button', { text: '+ new group', cls: 'pm-btn pm-btn-primary pm-btn-sm' });
    addBtn.addEventListener('click', () => {
      this.editingGroupId = '__new__';
      this.render();
    });

    const groups = this.plugin.settings.groups;
    const list = el.createDiv('pm-gcm-list');

    if (groups.length === 0 && this.editingGroupId !== '__new__') {
      list.createEl('p', { text: 'No groups yet. Create one to organize your projects.', cls: 'pm-gcm-empty' });
    }

    for (const group of groups) {
      const count = this.projects.filter(p => p.group === group.name).length;
      if (this.editingGroupId === group.id) {
        this.renderGroupForm(list, group, count);
      } else {
        this.renderGroupRow(list, group, count);
      }
    }

    // New group form
    if (this.editingGroupId === '__new__') {
      this.renderGroupForm(list, makeGroupConfig(), 0);
    }
  }

  private renderGroupRow(container: HTMLElement, group: GroupConfig, count: number): void {
    const row = container.createDiv('pm-gcm-row');

    const dot = row.createEl('span', { cls: 'pm-gcm-dot' });
    dot.style.background = group.color;
    row.createEl('span', { text: group.icon, cls: 'pm-gcm-row-icon' });

    const info = row.createDiv('pm-gcm-row-info');
    info.createEl('span', { text: group.name, cls: 'pm-gcm-row-name' });
    if (group.description) {
      info.createEl('span', { text: group.description, cls: 'pm-gcm-row-desc' });
    }
    if (group.lead) {
      info.createEl('span', { text: `Lead: ${group.lead}`, cls: 'pm-gcm-row-meta' });
    }

    const right = row.createDiv('pm-gcm-row-right');
    right.createEl('span', {
      text: `${count} project${count !== 1 ? 's' : ''}`,
      cls: 'pm-gcm-count',
    });
    const editBtn = right.createEl('button', { text: 'Edit', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
    editBtn.addEventListener('click', () => { this.editingGroupId = group.id; this.render(); });
    const delBtn = right.createEl('button', { text: 'Delete', cls: 'pm-btn pm-btn-danger pm-btn-sm' });
    delBtn.addEventListener('click', () => {
      this.plugin.settings.groups = this.plugin.settings.groups.filter(g => g.id !== group.id);
      void this.plugin.saveSettings();
      this.onSave();
      this.render();
    });
  }

  private renderGroupForm(container: HTMLElement, initial: GroupConfig, _count: number): void {
    const isNew = !this.plugin.settings.groups.find(g => g.id === initial.id);
    const draft: GroupConfig = { ...initial };

    const form = container.createDiv('pm-gcm-form');

    // Color + icon + name row
    const topRow = form.createDiv('pm-gcm-form-top');

    // Color picker
    const colorWrap = topRow.createDiv('pm-gcm-form-color-wrap');
    const colorPreview = colorWrap.createEl('span', { cls: 'pm-gcm-dot pm-gcm-dot--lg' });
    colorPreview.style.background = draft.color;
    for (const hex of PALETTE) {
      const swatch = colorWrap.createEl('button', { cls: 'pm-gcm-swatch' });
      swatch.style.background = hex;
      if (hex === draft.color) swatch.addClass('pm-gcm-swatch--active');
      swatch.addEventListener('click', () => {
        draft.color = hex;
        colorPreview.style.background = hex;
        colorWrap.querySelectorAll('.pm-gcm-swatch').forEach(s => s.removeClass('pm-gcm-swatch--active'));
        swatch.addClass('pm-gcm-swatch--active');
      });
    }

    // Icon picker
    const iconWrap = topRow.createDiv('pm-gcm-form-icon-wrap');
    const iconPreview = iconWrap.createEl('span', { text: draft.icon, cls: 'pm-gcm-icon-preview' });
    const iconInput = iconWrap.createEl('input', {
      type: 'text', placeholder: 'Emoji…', cls: 'pm-gcm-icon-input',
    });
    iconInput.value = draft.icon;
    iconInput.addEventListener('input', () => {
      draft.icon = iconInput.value.trim() || '📁';
      iconPreview.textContent = draft.icon;
    });

    // Name + lead inputs
    const fieldsCol = topRow.createDiv('pm-gcm-form-fields');
    const nameInput = this.textField(fieldsCol, 'Name *', draft.name, 'e.g. Internal, Client work…', v => { draft.name = v; });
    const leadInput = this.textField(fieldsCol, 'Lead', draft.lead, 'Responsible person', v => { draft.lead = v; });
    leadInput.setAttribute('list', 'pm-gcm-members');
    const dl = fieldsCol.createEl('datalist', { attr: { id: 'pm-gcm-members' } });
    for (const m of this.plugin.settings.globalTeamMembers) {
      dl.createEl('option', { attr: { value: m } });
    }

    // Description
    const descInput = this.textField(form, 'Description', draft.description, 'What this group is for…', v => { draft.description = v; });
    descInput.addClass('pm-gcm-form-full');

    // Actions
    const actions = form.createDiv('pm-gcm-form-actions');
    const saveBtn = actions.createEl('button', { text: isNew ? 'Create group' : 'Save', cls: 'pm-btn pm-btn-primary pm-btn-sm' });
    saveBtn.addEventListener('click', () => {
      const trimmed = nameInput.value.trim();
      if (!trimmed) { nameInput.addClass('pm-input--error'); return; }
      draft.name = trimmed;
      draft.color = draft.color || PALETTE[0];
      draft.icon  = draft.icon  || '📁';
      if (isNew) {
        this.plugin.settings.groups.push(draft);
        // Keep groupColors in sync for backward compatibility
        this.plugin.settings.groupColors[draft.name] = draft.color;
      } else {
        const idx = this.plugin.settings.groups.findIndex(g => g.id === draft.id);
        if (idx >= 0) {
          this.plugin.settings.groups[idx] = draft;
          this.plugin.settings.groupColors[draft.name] = draft.color;
        }
      }
      void this.plugin.saveSettings();
      this.onSave();
      this.editingGroupId = null;
      this.render();
    });
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
    cancelBtn.addEventListener('click', () => { this.editingGroupId = null; this.render(); });
  }

  // ─── Clients tab ─────────────────────────────────────────────────────────────

  private renderClientsTab(el: HTMLElement): void {
    const header = el.createDiv('pm-gcm-header');
    header.createEl('h3', { text: 'Clients', cls: 'pm-gcm-title' });
    const addBtn = header.createEl('button', { text: '+ new client', cls: 'pm-btn pm-btn-primary pm-btn-sm' });
    addBtn.addEventListener('click', () => { this.editingClientId = '__new__'; this.render(); });

    const clients = this.plugin.settings.clients;
    const list = el.createDiv('pm-gcm-list');

    if (clients.length === 0 && this.editingClientId !== '__new__') {
      list.createEl('p', { text: 'No clients yet. Create one to track work by client.', cls: 'pm-gcm-empty' });
    }

    for (const client of clients) {
      const count = this.projects.filter(p => p.client === client.name).length;
      if (this.editingClientId === client.id) {
        this.renderClientForm(list, client, count);
      } else {
        this.renderClientRow(list, client, count);
      }
    }

    if (this.editingClientId === '__new__') {
      this.renderClientForm(list, makeClientConfig(), 0);
    }
  }

  private renderClientRow(container: HTMLElement, client: ClientConfig, count: number): void {
    const row = container.createDiv('pm-gcm-row');

    const dot = row.createEl('span', { cls: 'pm-gcm-dot' });
    dot.style.background = client.color;
    row.createEl('span', { text: client.icon, cls: 'pm-gcm-row-icon' });

    const info = row.createDiv('pm-gcm-row-info');
    info.createEl('span', { text: client.name, cls: 'pm-gcm-row-name' });
    if (client.contactName) {
      info.createEl('span', { text: client.contactName, cls: 'pm-gcm-row-desc' });
    }
    const metaParts: string[] = [];
    if (client.contactEmail) metaParts.push(client.contactEmail);
    if (client.website) metaParts.push(client.website);
    if (metaParts.length) {
      info.createEl('span', { text: metaParts.join(' · '), cls: 'pm-gcm-row-meta' });
    }

    const right = row.createDiv('pm-gcm-row-right');
    right.createEl('span', {
      text: `${count} project${count !== 1 ? 's' : ''}`,
      cls: 'pm-gcm-count',
    });
    const editBtn = right.createEl('button', { text: 'Edit', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
    editBtn.addEventListener('click', () => { this.editingClientId = client.id; this.render(); });
    const delBtn = right.createEl('button', { text: 'Delete', cls: 'pm-btn pm-btn-danger pm-btn-sm' });
    delBtn.addEventListener('click', () => {
      this.plugin.settings.clients = this.plugin.settings.clients.filter(c => c.id !== client.id);
      void this.plugin.saveSettings();
      this.onSave();
      this.render();
    });
  }

  private renderClientForm(container: HTMLElement, initial: ClientConfig, _count: number): void {
    const isNew = !this.plugin.settings.clients.find(c => c.id === initial.id);
    const draft: ClientConfig = { ...initial };

    const form = container.createDiv('pm-gcm-form');

    // Color + icon + name row
    const topRow = form.createDiv('pm-gcm-form-top');

    // Color picker
    const colorWrap = topRow.createDiv('pm-gcm-form-color-wrap');
    const colorPreview = colorWrap.createEl('span', { cls: 'pm-gcm-dot pm-gcm-dot--lg' });
    colorPreview.style.background = draft.color;
    for (const hex of PALETTE) {
      const swatch = colorWrap.createEl('button', { cls: 'pm-gcm-swatch' });
      swatch.style.background = hex;
      if (hex === draft.color) swatch.addClass('pm-gcm-swatch--active');
      swatch.addEventListener('click', () => {
        draft.color = hex;
        colorPreview.style.background = hex;
        colorWrap.querySelectorAll('.pm-gcm-swatch').forEach(s => s.removeClass('pm-gcm-swatch--active'));
        swatch.addClass('pm-gcm-swatch--active');
      });
    }

    // Icon picker
    const iconWrap = topRow.createDiv('pm-gcm-form-icon-wrap');
    const iconPreview = iconWrap.createEl('span', { text: draft.icon, cls: 'pm-gcm-icon-preview' });
    const iconInput = iconWrap.createEl('input', {
      type: 'text', placeholder: 'Emoji…', cls: 'pm-gcm-icon-input',
    });
    iconInput.value = draft.icon;
    iconInput.addEventListener('input', () => {
      draft.icon = iconInput.value.trim() || '🏢';
      iconPreview.textContent = draft.icon;
    });

    // Core fields
    const fieldsCol = topRow.createDiv('pm-gcm-form-fields');
    const nameInput = this.textField(fieldsCol, 'Name *', draft.name, 'e.g. Acme Corp', v => { draft.name = v; });
    this.textField(fieldsCol, 'Contact name', draft.contactName, 'Primary contact', v => { draft.contactName = v; });

    // Second row
    const row2 = form.createDiv('pm-gcm-form-row2');
    this.textField(row2, 'Email', draft.contactEmail, 'contact@example.com', v => { draft.contactEmail = v; });
    this.textField(row2, 'Website', draft.website, 'https://…', v => { draft.website = v; });

    // Notes
    const notesLabel = form.createEl('label', { text: 'Notes', cls: 'pm-gcm-label' });
    const notesInput = notesLabel.createEl('textarea', { cls: 'pm-gcm-textarea' });
    notesInput.value = draft.notes;
    notesInput.addEventListener('input', () => { draft.notes = notesInput.value; });

    // Actions
    const actions = form.createDiv('pm-gcm-form-actions');
    const saveBtn = actions.createEl('button', { text: isNew ? 'Create client' : 'Save', cls: 'pm-btn pm-btn-primary pm-btn-sm' });
    saveBtn.addEventListener('click', () => {
      const trimmed = nameInput.value.trim();
      if (!trimmed) { nameInput.addClass('pm-input--error'); return; }
      draft.name = trimmed;
      draft.color = draft.color || PALETTE[0];
      draft.icon  = draft.icon  || '🏢';
      if (isNew) {
        this.plugin.settings.clients.push(draft);
      } else {
        const idx = this.plugin.settings.clients.findIndex(c => c.id === draft.id);
        if (idx >= 0) this.plugin.settings.clients[idx] = draft;
      }
      void this.plugin.saveSettings();
      this.onSave();
      this.editingClientId = null;
      this.render();
    });
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
    cancelBtn.addEventListener('click', () => { this.editingClientId = null; this.render(); });
  }

  // ─── Shared helper ────────────────────────────────────────────────────────────

  private textField(
    parent: HTMLElement,
    label: string,
    value: string,
    placeholder: string,
    onChange: (v: string) => void,
  ): HTMLInputElement {
    const wrap = parent.createEl('label', { cls: 'pm-gcm-label' });
    wrap.createEl('span', { text: label, cls: 'pm-gcm-label-text' });
    const input = wrap.createEl('input', {
      type: 'text',
      placeholder,
      cls: 'pm-gcm-input',
    });
    input.value = value;
    input.addEventListener('input', () => onChange(input.value));
    return input;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function openGroupClientModal(
  plugin: PMPlugin,
  projects: Project[],
  tab: Tab,
  onSave: () => void,
): void {
  new GroupClientModal(plugin.app, plugin, projects, onSave, tab).open();
}
