import { Notice } from 'obsidian';
import type PMPlugin from '../../main';
import type { Project, FilterState } from '../../types';
import { makeDefaultFilter } from '../../types';
import { deleteTaskFromTree } from '../../store/TaskTreeOps';
import type { SubView } from '../SubView';
import { renderQuickAddBar, focusQuickAdd } from './QuickAddBar';
import { renderSavedViewsBar } from './SavedViewsBar';
import { renderFilterBar } from './FilterBar';
import { renderTable, refreshTableBody, handleTableKeyDown } from './TableRenderer';
import type { SortKey, SortDir, TableState } from './TableRenderer';
import { renderBulkActionBar } from './BulkActionBar';
import type { BulkAction } from './BulkActionBar';

export interface TableViewState {
  filter: FilterState;
  sortKey: SortKey;
  sortDir: SortDir;
  activeSavedViewId: string | null;
}

export class TableView implements SubView {
  private state: TableState;
  private activeSavedViewId: string | null;

  constructor(
    private container: HTMLElement,
    private project: Project,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    initialState?: TableViewState,
  ) {
    this.state = {
      sortKey: initialState?.sortKey ?? ('status' as SortKey),
      sortDir: initialState?.sortDir ?? ('asc' as SortDir),
      filter: initialState?.filter ?? makeDefaultFilter(),
      selectedTaskId: null,
      selectedTaskIds: new Set(),
      tableBody: null,
    };
    this.activeSavedViewId = initialState?.activeSavedViewId ?? null;
  }

  getViewState(): TableViewState {
    return {
      filter: this.state.filter,
      sortKey: this.state.sortKey,
      sortDir: this.state.sortDir,
      activeSavedViewId: this.activeSavedViewId,
    };
  }

  render(): void {
    this.container.empty();
    this.container.addClass('pm-table-view');

    renderQuickAddBar(this.container, this.project, this.plugin, this.onRefresh);

    renderSavedViewsBar(this.container, {
      project: this.project,
      plugin: this.plugin,
      filter: this.state.filter,
      sortKey: this.state.sortKey,
      sortDir: this.state.sortDir,
      activeSavedViewId: this.activeSavedViewId,
      setActiveSavedViewId: (id) => { this.activeSavedViewId = id; },
      setFilter: (f) => { this.state.filter = f; },
      setSort: (key, dir) => { this.state.sortKey = key as SortKey; this.state.sortDir = dir as SortDir; },
      rerender: () => this.render(),
    });

    renderFilterBar(this.container, {
      project: this.project,
      plugin: this.plugin,
      filter: this.state.filter,
      setFilter: (f) => { this.state.filter = f; },
      activeSavedViewId: this.activeSavedViewId,
      setActiveSavedViewId: (id) => { this.activeSavedViewId = id; },
      refreshTable: () => this.doRefreshTable(),
      rerender: () => this.render(),
    });

    const ctx = this.makeTableContext();
    renderTable(ctx);
  }

  focusQuickAdd(): void {
    focusQuickAdd(this.container);
  }

  handleKeyDown(e: KeyboardEvent): void {
    handleTableKeyDown(e, this.makeTableContext());
  }

  private doRefreshTable(): void {
    if (this.state.tableBody) {
      refreshTableBody(this.makeTableContext());
    } else {
      this.render();
    }
  }

  private async handleBulkAction(action: BulkAction): Promise<void> {
    const ids = [...this.state.selectedTaskIds];
    if (!ids.length) return;

    try {
      switch (action.type) {
        case 'set-status':
          for (const id of ids) {
            await this.plugin.store.updateTask(this.project, id, { status: action.status });
          }
          break;
        case 'set-priority':
          for (const id of ids) {
            await this.plugin.store.updateTask(this.project, id, { priority: action.priority });
          }
          break;
        case 'delete':
          for (const id of ids) {
            deleteTaskFromTree(this.project.tasks, id);
          }
          await this.plugin.store.saveProject(this.project);
          break;
      }
      this.state.selectedTaskIds.clear();
      await this.onRefresh();
    } catch (err) {
      console.error('Bulk action failed', err);
      new Notice('Bulk action failed. Please try again.');
      await this.onRefresh();
    }
  }

  private updateBulkBar(): void {
    const ctx = this.makeTableContext();
    renderBulkActionBar({ ctx, onAction: (a) => this.handleBulkAction(a) });
  }

  private makeTableContext() {
    return {
      container: this.container,
      project: this.project,
      plugin: this.plugin,
      state: this.state,
      onRefresh: this.onRefresh,
      onSelectionChange: () => this.updateBulkBar(),
    };
  }
}
