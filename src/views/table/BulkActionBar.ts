import { Menu } from 'obsidian';
import type { TaskStatus, TaskPriority } from '../../types';
import { formatBadgeText } from '../../utils';
import type { TableContext } from './TableRenderer';
import { updateSelectAllCheckbox } from './TableRow';

export type BulkAction =
  | { type: 'set-status'; status: TaskStatus }
  | { type: 'set-priority'; priority: TaskPriority }
  | { type: 'delete' };

export interface BulkActionBarOpts {
  ctx: TableContext;
  onAction: (action: BulkAction) => void;
}

/**
 * Render or update the bulk action bar.
 * Shows when selectedTaskIds.size > 0, hidden otherwise.
 */
export function renderBulkActionBar(opts: BulkActionBarOpts): void {
  const { ctx, onAction } = opts;
  const existing = ctx.container.querySelector('.pm-bulk-bar') as HTMLElement | null;

  if (ctx.state.selectedTaskIds.size === 0) {
    existing?.remove();
    return;
  }

  // Reuse existing bar or create a new one
  const bar = existing ?? createBar(ctx.container);
  updateBarContent(bar, ctx, onAction);
}

function createBar(container: HTMLElement): HTMLElement {
  const bar = createDiv({ cls: 'pm-bulk-bar' });
  // Insert after quick-add bar (first child) or at the top
  const quickAdd = container.querySelector('.pm-quick-add');
  if (quickAdd?.nextSibling) {
    container.insertBefore(bar, quickAdd.nextSibling);
  } else if (quickAdd) {
    container.appendChild(bar);
  } else {
    container.prepend(bar);
  }
  return bar;
}

function updateBarContent(bar: HTMLElement, ctx: TableContext, onAction: (a: BulkAction) => void): void {
  bar.empty();
  const count = ctx.state.selectedTaskIds.size;

  // Left section: count + actions
  const left = bar.createDiv('pm-bulk-bar-left');
  left.createEl('span', { text: `${count} selected`, cls: 'pm-bulk-bar-count' });

  // Status button
  const statusBtn = left.createEl('button', { text: 'Set Status', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
  statusBtn.addEventListener('click', (e) => {
    const menu = new Menu();
    for (const s of ctx.plugin.settings.statuses) {
      menu.addItem(item => item
        .setTitle(formatBadgeText(s.icon, s.label))
        .onClick(() => onAction({ type: 'set-status', status: s.id as TaskStatus })));
    }
    menu.showAtMouseEvent(e as MouseEvent);
  });

  // Priority button
  const priorityBtn = left.createEl('button', { text: 'Set Priority', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
  priorityBtn.addEventListener('click', (e) => {
    const menu = new Menu();
    for (const p of ctx.plugin.settings.priorities) {
      menu.addItem(item => item
        .setTitle(formatBadgeText(p.icon, p.label))
        .onClick(() => onAction({ type: 'set-priority', priority: p.id as TaskPriority })));
    }
    menu.showAtMouseEvent(e as MouseEvent);
  });

  // Delete button
  const deleteBtn = left.createEl('button', { text: 'Delete', cls: 'pm-btn pm-btn-danger pm-btn-sm' });
  deleteBtn.addEventListener('click', () => {
    onAction({ type: 'delete' });
  });

  // Right section: clear selection
  const right = bar.createDiv('pm-bulk-bar-right');
  const clearBtn = right.createEl('button', { cls: 'pm-btn pm-btn-ghost pm-btn-icon pm-btn-sm', attr: { 'aria-label': 'Clear selection' } });
  clearBtn.setText('\u00d7');
  clearBtn.addEventListener('click', () => {
    ctx.state.selectedTaskIds.clear();
    // Update row checkboxes
    if (ctx.state.tableBody) {
      const cbs = ctx.state.tableBody.querySelectorAll('.pm-select-checkbox') as NodeListOf<HTMLInputElement>;
      cbs.forEach(cb => cb.checked = false);
    }
    updateSelectAllCheckbox(ctx.state);
    renderBulkActionBar({ ctx, onAction });
  });
}
