import { safeAsync } from '../utils';
import type PMPlugin from '../main';
import type { Project, Task, GanttGranularity, GanttStatusColor } from '../types';
import { flattenTasks, filterArchived } from '../store/TaskTreeOps';
import { resolveProjectDates } from '../utils';
import { svgEl } from '../utils';
import type { SubView } from './SubView';
import {
  buildTimelineConfig, dateToX,
  HEADER_HEIGHT, ROW_HEIGHT, LABEL_WIDTH,
  BAR_BORDER_RADIUS,
} from './gantt/TimelineConfig';
import type { TimelineCfg } from './gantt/TimelineConfig';
import { makeDragState } from './gantt/GanttDragHandler';
import type { DragState } from './gantt/GanttDragHandler';
import { makeLinkState, cancelLink } from './gantt/GanttLinkHandler';
import type { LinkState } from './gantt/GanttLinkHandler';
import {
  renderTimelineHeader,
  renderGridLines,
  renderTodayLine,
  renderTaskBar,
  renderMilestoneLabels,
} from './gantt/GanttRenderer';
import type { RendererContext } from './gantt/GanttRenderer';
import { renderTaskLabel } from './gantt/TaskLabelRenderer';
import type { LabelContext } from './gantt/TaskLabelRenderer';
import { openProjectModal } from '../ui/ModalFactory';
import { showGanttTooltip, hideGanttTooltip } from './gantt/GanttTaskBarRenderer';
import { computeProjectChangelog, appendChangelogEntries } from '../store/YamlSerializer';

// ─── Constants ─────────────────────────────────────────────────────────────

const PROJECT_BAR_PADDING = 5;

// Gantt status color → hex
const GANTT_STATUS_HEX: Record<GanttStatusColor, string> = {
  green:  '#79b58d',
  orange: '#b8a06b',
  red:    '#c47070',
  grey:   '#8a94a0',
};

const GANTT_STATUS_LABELS: Record<GanttStatusColor, string> = {
  green:  '🟢 On track',
  orange: '🟡 At risk',
  red:    '🔴 Delayed',
  grey:   '⚪ Not started',
};

// ─── Quick ganttColor picker popup ─────────────────────────────────────────

function showGanttColorPicker(
  x: number,
  y: number,
  project: Project,
  plugin: PMPlugin,
  onSave: () => Promise<void>,
): void {
  document.querySelector('.pm-gantt-color-picker')?.remove();

  const picker = document.createElement('div');
  picker.className = 'pm-gantt-color-picker';

  const title = document.createElement('div');
  title.className = 'pm-gantt-color-picker-title';
  title.textContent = 'Project status';
  picker.appendChild(title);

  const colors: GanttStatusColor[] = ['green', 'orange', 'red', 'grey'];
  for (const c of colors) {
    const btn = document.createElement('button');
    btn.className = 'pm-gantt-color-picker-btn';
    btn.style.setProperty('--gc-color', GANTT_STATUS_HEX[c]);
    btn.innerHTML = `<span class="pm-gantt-color-picker-swatch"></span>${GANTT_STATUS_LABELS[c]}`;
    if (project.ganttColor === c) btn.classList.add('pm-gantt-color-picker-btn--active');
    btn.addEventListener('click', safeAsync(async () => {
      picker.remove();
      const oldProject = JSON.parse(JSON.stringify(project)) as Project;
      project.ganttColor = c;
      // Append changelog entry
      const entries = computeProjectChangelog(oldProject, project);
      if (entries.length) project.description = appendChangelogEntries(project.description, entries);
      await plugin.store.saveProject(project);
      await onSave();
    }));
    picker.appendChild(btn);
  }

  // Reset option
  if (project.ganttColor) {
    const resetBtn = document.createElement('button');
    resetBtn.className = 'pm-gantt-color-picker-btn pm-gantt-color-picker-btn--reset';
    resetBtn.textContent = '✕ Clear status';
    resetBtn.addEventListener('click', safeAsync(async () => {
      picker.remove();
      const oldProject = JSON.parse(JSON.stringify(project)) as Project;
      project.ganttColor = undefined;
      const entries = computeProjectChangelog(oldProject, project);
      if (entries.length) project.description = appendChangelogEntries(project.description, entries);
      await plugin.store.saveProject(project);
      await onSave();
    }));
    picker.appendChild(resetBtn);
  }

  document.body.appendChild(picker);

  // Position
  picker.style.left = '0px'; picker.style.top = '0px';
  const rect = picker.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  picker.style.left = `${Math.min(x, vw - rect.width - 8)}px`;
  picker.style.top  = `${Math.min(y, vh - rect.height - 8)}px`;

  const close = (e: MouseEvent) => {
    if (!picker.contains(e.target as Node)) {
      picker.remove();
      document.removeEventListener('click', close, true);
    }
  };
  setTimeout(() => document.addEventListener('click', close, true), 10);
}

// ─── GlobalGanttView ───────────────────────────────────────────────────────

export class GlobalGanttView implements SubView {
  private granularity: GanttGranularity;
  private scrollEl!: HTMLElement;
  private svgEl!: SVGSVGElement;
  private cfg!: TimelineCfg;
  private drag: DragState = makeDragState();
  private link: LinkState = makeLinkState();
  private labelWidth: number = LABEL_WIDTH;
  private cleanupFns: (() => void)[] = [];
  /** Project IDs whose task rows are currently collapsed */
  private collapsedProjects = new Set<string>();

  constructor(
    private container: HTMLElement,
    private projects: Project[],
    private plugin: PMPlugin,
    private onRefreshAll: () => Promise<void>,
  ) {
    this.granularity = plugin.settings.ganttGranularity;
  }

  destroy(): void {
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
  }

  render(): void {
    this.destroy();
    cancelLink(this.link);
    this.container.empty();
    this.container.addClass('pm-gantt-view');

    // Build timeline config: include both project dates and task dates
    const allTasksForConfig: Task[] = [];
    for (const p of this.projects) {
      allTasksForConfig.push(...filterArchived(p.tasks));
      const { start, end } = resolveProjectDates(p);
      if (start) allTasksForConfig.push({ start, due: '', id: '__proj__', title: '', description: '', type: 'task', status: 'todo', priority: 'medium', progress: 0, assignees: [], tags: [], subtasks: [], dependencies: [], customFields: {}, collapsed: false, createdAt: '', updatedAt: '' });
      if (end)   allTasksForConfig.push({ start: '', due: end, id: '__proj__', title: '', description: '', type: 'task', status: 'todo', priority: 'medium', progress: 0, assignees: [], tags: [], subtasks: [], dependencies: [], customFields: {}, collapsed: false, createdAt: '', updatedAt: '' });
    }
    this.cfg = buildTimelineConfig(allTasksForConfig, this.granularity);

    this.renderControls();
    this.renderGantt();
  }

  // ─── Controls bar ──────────────────────────────────────────────────────────

  private renderControls(): void {
    const bar = this.container.createDiv('pm-gantt-controls');

    const levels: GanttGranularity[] = ['day', 'week', 'month', 'quarter'];
    const labels: Record<GanttGranularity, string> = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter' };
    for (const level of levels) {
      const btn = bar.createEl('button', { text: labels[level], cls: 'pm-gantt-zoom-btn' });
      if (level === this.granularity) btn.addClass('pm-gantt-zoom-btn--active');
      btn.addEventListener('click', () => {
        this.granularity = level;
        this.plugin.settings.ganttGranularity = level;
        void this.plugin.saveSettings();
        this.render();
      });
    }

    bar.createEl('span', { cls: 'pm-gantt-sep' });
    bar.createEl('button', { text: 'Today', cls: 'pm-btn pm-btn-ghost pm-gantt-today-btn' })
      .addEventListener('click', () => this.scrollToToday());

    bar.createEl('span', { cls: 'pm-gantt-sep' });

    const allCollapsed = this.projects.length > 0 && this.projects.every(p => this.collapsedProjects.has(p.id));
    const allExpanded  = this.collapsedProjects.size === 0;

    const expandBtn = bar.createEl('button', { text: 'Expand all', cls: 'pm-gantt-zoom-btn' });
    if (allExpanded) expandBtn.addClass('pm-gantt-zoom-btn--active');
    expandBtn.addEventListener('click', () => {
      this.collapsedProjects.clear();
      this.setAllTasksCollapsed(false);
      this.render();
    });

    const collapseBtn = bar.createEl('button', { text: 'Collapse all', cls: 'pm-gantt-zoom-btn' });
    if (allCollapsed) collapseBtn.addClass('pm-gantt-zoom-btn--active');
    collapseBtn.addEventListener('click', () => {
      for (const p of this.projects) this.collapsedProjects.add(p.id);
      this.render();
    });
  }

  // ─── Main Gantt ────────────────────────────────────────────────────────────

  private renderGantt(): void {
    interface Section {
      project: Project;
      tasks: Task[];
      taskRows: number;
      collapsed: boolean;
    }
    const sections: Section[] = [];
    let totalRows = 0;

    for (const p of this.projects) {
      const tasks = filterArchived(p.tasks);
      const collapsed = this.collapsedProjects.has(p.id);
      const taskRows = collapsed ? 0 :
        flattenTasks(tasks).filter(f => f.visible || f.depth === 0).length;
      sections.push({ project: p, tasks, taskRows, collapsed });
      totalRows += 1 + taskRows;
    }

    const wrapper = this.container.createDiv('pm-gantt-wrapper');

    // ── Left panel ────────────────────────────────────────────────────────────
    const leftPanel = wrapper.createDiv('pm-gantt-left');
    leftPanel.style.width = `${this.labelWidth}px`;
    leftPanel.style.minWidth = `${this.labelWidth}px`;
    const leftHeader = leftPanel.createDiv('pm-gantt-left-header');
    leftHeader.style.height = `${HEADER_HEIGHT}px`;
    leftHeader.createEl('span', { text: 'Project / task', cls: 'pm-gantt-left-header-label' });
    const leftBody = leftPanel.createDiv('pm-gantt-left-body');

    // ── Resize handle ─────────────────────────────────────────────────────────
    const resizeHandle = wrapper.createDiv('pm-gantt-resize-handle');
    let resizing = false, startX = 0, startWidth = 0;
    resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault(); resizing = true; startX = e.clientX; startWidth = this.labelWidth;
      document.body.addClass('pm-resize-active');
    });
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing) return;
      this.labelWidth = Math.max(150, Math.min(600, startWidth + (e.clientX - startX)));
      leftPanel.style.width = leftPanel.style.minWidth = `${this.labelWidth}px`;
    };
    const onMouseUp = () => { if (!resizing) return; resizing = false; document.body.removeClass('pm-resize-active'); };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    this.cleanupFns.push(() => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); });

    // ── Right panel / SVG ─────────────────────────────────────────────────────
    const rightPanel = wrapper.createDiv('pm-gantt-right');
    this.scrollEl = rightPanel;
    const svgContainer = this.scrollEl.createDiv('pm-gantt-svg-container');
    svgContainer.style.width = `${this.cfg.totalWidth}px`;

    const svgHeight = HEADER_HEIGHT + (totalRows + 1) * ROW_HEIGHT;
    this.svgEl = svgEl('svg', { width: this.cfg.totalWidth, height: svgHeight, class: 'pm-gantt-svg' });
    svgContainer.appendChild(this.svgEl);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelLink(this.link);
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault(); void this.plugin.undoLastAction();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    this.cleanupFns.push(() => document.removeEventListener('keydown', onKeyDown));

    const allFlatTasks = sections.flatMap(s =>
      flattenTasks(s.tasks).filter(f => f.visible || f.depth === 0),
    );
    const baseCtx: RendererContext = {
      svgEl: this.svgEl, cfg: this.cfg, plugin: this.plugin,
      project: this.projects[0] ?? ({} as Project),
      flatTasks: allFlatTasks, drag: this.drag, link: this.link,
      onRefresh: this.onRefreshAll, cleanupFns: this.cleanupFns,
    };

    renderGridLines(baseCtx, totalRows);
    renderTodayLine(baseCtx, svgHeight);

    const barsGroup = svgEl('g', { class: 'pm-gantt-bars' });
    this.svgEl.appendChild(barsGroup);

    let rowIndex = 0;

    for (const { project, tasks, collapsed } of sections) {
      const projRowY = HEADER_HEIGHT + rowIndex * ROW_HEIGHT;

      // ── Project row — left panel label ──────────────────────────────────────
      const projRow = leftBody.createDiv('pm-gantt-project-row');
      projRow.style.height = `${ROW_HEIGHT}px`;
      projRow.dataset.projectId = project.id;

      const chevron = projRow.createEl('span', {
        cls: 'pm-gantt-project-chevron',
        text: collapsed ? '▶' : '▼',
      });
      chevron.title = collapsed ? 'Expand tasks' : 'Collapse tasks';

      // Accent dot shows ganttColor if set, else project color
      const accent = projRow.createDiv('pm-gantt-project-section-accent');
      accent.style.background = project.ganttColor
        ? GANTT_STATUS_HEX[project.ganttColor]
        : project.color;

      projRow.createEl('span', { text: project.icon, cls: 'pm-gantt-project-section-icon' });
      projRow.createEl('span', {
        text: project.title,
        cls: 'pm-gantt-project-section-title',
        attr: { title: project.title },
      });

      const taskCount = flattenTasks(tasks).filter(f => f.depth === 0).length;
      projRow.createEl('span', { text: `${taskCount}`, cls: 'pm-gantt-project-task-badge' });

      const toggleCollapse = () => {
        if (this.collapsedProjects.has(project.id)) {
          this.collapsedProjects.delete(project.id);
        } else {
          this.collapsedProjects.add(project.id);
        }
        this.render();
      };
      chevron.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapse(); });
      projRow.addEventListener('click', toggleCollapse);

      // ── Project row — SVG background stripe ─────────────────────────────────
      barsGroup.appendChild(svgEl('rect', {
        x: 0, y: projRowY,
        width: this.cfg.totalWidth, height: ROW_HEIGHT,
        class: 'pm-gantt-project-section-bg',
      }));

      // ── Project bars (planned + dynamic) ────────────────────────────────────
      const barY = projRowY + PROJECT_BAR_PADDING;
      const barH = ROW_HEIGHT - PROJECT_BAR_PADDING * 2;

      // Planned (fixed) dates — only from explicit startDate/endDate fields
      const plannedStart = project.startDate || null;
      const plannedEnd   = project.endDate   || null;

      // Dynamic dates — always auto-computed from task dates only (never uses startDate/endDate)
      const dynStart = project.tasks.length ? (() => {
        const allDates: string[] = [];
        const collect = (tasks: Task[]) => { for (const t of tasks) { if (t.start) allDates.push(t.start); collect(t.subtasks); } };
        collect(filterArchived(project.tasks));
        return allDates.length ? allDates.sort()[0] : null;
      })() : null;
      const dynEnd = project.tasks.length ? (() => {
        const allDates: string[] = [];
        const collect = (tasks: Task[]) => { for (const t of tasks) { if (t.due) allDates.push(t.due); collect(t.subtasks); } };
        collect(filterArchived(project.tasks));
        return allDates.length ? allDates.sort().at(-1)! : null;
      })() : null;

      // Shared tooltip data for both bars
      const makeProjectTask = () => ({
        title: project.title,
        status: project.status ?? '',
        priority: project.priority ?? 'medium',
        start: plannedStart ?? dynStart ?? '',
        due: plannedEnd ?? dynEnd ?? '',
        progress: 0,
        assignees: project.teamMembers ?? [],
        description: project.description ?? '',
        type: 'task' as const,
        tags: [],
      });
      const attachTooltip = (el: SVGElement) => {
        el.addEventListener('mouseenter', (e: MouseEvent) => {
          showGanttTooltip(e.clientX, e.clientY, makeProjectTask() as unknown as Parameters<typeof showGanttTooltip>[2], project.status ?? 'project');
        });
        el.addEventListener('mousemove', (e: MouseEvent) => positionTooltipNear(e.clientX, e.clientY));
        el.addEventListener('mouseleave', () => hideGanttTooltip());
      };

      const defs = this.svgEl.querySelector('defs') ?? (() => {
        const d = svgEl('defs', {}); this.svgEl.prepend(d); return d;
      })();
      const midY = projRowY + ROW_HEIGHT / 2 + 1;

      // ── Planned bar (navy blue — always rendered when startDate+endDate are set)
      if (plannedStart && plannedEnd) {
        const ps = new Date(plannedStart);
        const pe = new Date(plannedEnd);
        pe.setDate(pe.getDate() + 1);
        const px  = Math.max(0, dateToX(this.cfg, ps));
        const px2 = dateToX(this.cfg, pe);
        const pw  = Math.max(4, px2 - px);

        const plannedBar = svgEl('rect', {
          x: px, y: barY - 2,
          width: pw, height: barH + 4,
          rx: BAR_BORDER_RADIUS + 1, ry: BAR_BORDER_RADIUS + 1,
          class: 'pm-gantt-project-bar-planned',
        });
        barsGroup.appendChild(plannedBar);

        // Clip + label for planned bar
        const clipPlanned = svgEl('clipPath', { id: `clip-proj-planned-${project.id}` });
        clipPlanned.appendChild(svgEl('rect', { x: px + 4, y: barY - 2, width: Math.max(0, pw - 8), height: barH + 4 }));
        defs.appendChild(clipPlanned);

        const plannedLabel = svgEl('text', {
          x: px + 8, y: midY,
          class: 'pm-gantt-project-bar-label pm-gantt-project-bar-label--planned',
          'clip-path': `url(#clip-proj-planned-${project.id})`,
        });
        plannedLabel.textContent = `📅 ${project.title}`;
        barsGroup.appendChild(plannedLabel);

        attachTooltip(plannedBar);
        attachTooltip(plannedLabel);

        // Single click → open ProjectModal
        plannedBar.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          const oldProject = JSON.parse(JSON.stringify(project)) as Project;
          openProjectModal(this.plugin, {
            project,
            onSave: async (saved) => {
              const entries = computeProjectChangelog(oldProject, saved);
              if (entries.length) saved.description = appendChangelogEntries(saved.description, entries);
              await this.plugin.store.saveProject(saved);
              await this.onRefreshAll();
            },
          });
        });
        plannedBar.addEventListener('dblclick', (e: MouseEvent) => {
          e.stopPropagation();
          hideGanttTooltip();
          showGanttColorPicker(e.clientX, e.clientY, project, this.plugin, this.onRefreshAll);
        });
      }

      // ── Dynamic bar (colored by ganttColor or project.color) ────────────────
      if (dynStart && dynEnd) {
        const ds = new Date(dynStart);
        const de = new Date(dynEnd);
        de.setDate(de.getDate() + 1);
        const dx  = Math.max(0, dateToX(this.cfg, ds));
        const dx2 = dateToX(this.cfg, de);
        const dw  = Math.max(4, dx2 - dx);

        const fillColor  = project.ganttColor ? GANTT_STATUS_HEX[project.ganttColor] : project.color;
        const borderColor = project.color;

        // Border rect (project.color)
        barsGroup.appendChild(svgEl('rect', {
          x: dx, y: barY, width: dw, height: barH,
          rx: BAR_BORDER_RADIUS, ry: BAR_BORDER_RADIUS,
          fill: 'none',
          stroke: borderColor,
          'stroke-width': 2,
          class: 'pm-gantt-project-bar-border',
        }));

        // Fill rect (ganttColor or project.color)
        const projBar = svgEl('rect', {
          x: dx + 1, y: barY + 1, width: Math.max(2, dw - 2), height: barH - 2,
          rx: Math.max(0, BAR_BORDER_RADIUS - 1), ry: Math.max(0, BAR_BORDER_RADIUS - 1),
          class: 'pm-gantt-project-bar',
          fill: fillColor,
          opacity: 0.8,
        });
        barsGroup.appendChild(projBar);

        // Clip + label for dynamic bar
        const clipRect = svgEl('clipPath', { id: `clip-proj-${project.id}` });
        clipRect.appendChild(svgEl('rect', { x: dx + 2, y: barY, width: Math.max(0, dw - 4), height: barH }));
        defs.appendChild(clipRect);

        const textEl = svgEl('text', {
          x: dx + 8, y: midY,
          class: 'pm-gantt-project-bar-label',
          'clip-path': `url(#clip-proj-${project.id})`,
        });
        textEl.textContent = project.title;
        barsGroup.appendChild(textEl);

        attachTooltip(projBar);
        attachTooltip(textEl);

        // Single click → open ProjectModal
        projBar.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          const oldProject = JSON.parse(JSON.stringify(project)) as Project;
          openProjectModal(this.plugin, {
            project,
            onSave: async (saved) => {
              // Apply changelog for project-level field changes
              const entries = computeProjectChangelog(oldProject, saved);
              if (entries.length) saved.description = appendChangelogEntries(saved.description, entries);
              await this.plugin.store.saveProject(saved);
              await this.onRefreshAll();
            },
          });
        });

        // Double-click → ganttColor picker
        projBar.addEventListener('dblclick', (e: MouseEvent) => {
          e.stopPropagation();
          hideGanttTooltip();
          showGanttColorPicker(e.clientX, e.clientY, project, this.plugin, this.onRefreshAll);
        });
      }

      rowIndex++;

      // ── Task rows (when expanded) ────────────────────────────────────────────
      if (!collapsed) {
        const projectFlatTasks = flattenTasks(tasks).filter(f => f.visible || f.depth === 0);
        const projectCtx: RendererContext = {
          ...baseCtx, project, flatTasks: projectFlatTasks,
        };
        const labelCtx: LabelContext = {
          plugin: this.plugin, project, onRefresh: this.onRefreshAll,
        };

        const renderFlatList = (taskList: Task[], depth: number) => {
          for (const task of taskList) {
            renderTaskLabel(leftBody, task, depth + 1, rowIndex, labelCtx);
            renderTaskBar(barsGroup, task, rowIndex, depth + 1, projectCtx);
            rowIndex++;
            if (!task.collapsed && task.subtasks.length) {
              renderFlatList(task.subtasks, depth + 1);
            }
          }
        };
        renderFlatList(tasks, 0);

        renderMilestoneLabels({ ...projectCtx, flatTasks: allFlatTasks });
      }
    }

    // ── Sticky header (rendered last so it's on top) ──────────────────────────
    const headerG = renderTimelineHeader(baseCtx);
    const onScroll = () => {
      headerG.setAttribute('transform', `translate(0,${rightPanel.scrollTop})`);
    };
    rightPanel.addEventListener('scroll', onScroll);
    this.cleanupFns.push(() => rightPanel.removeEventListener('scroll', onScroll));

    // ── Scroll sync ───────────────────────────────────────────────────────────
    const onLeftWheel = (e: WheelEvent) => {
      rightPanel.scrollTop += e.deltaY;
      rightPanel.scrollLeft += e.deltaX;
      e.preventDefault();
    };
    leftPanel.addEventListener('wheel', onLeftWheel, { passive: false });
    this.cleanupFns.push(() => leftPanel.removeEventListener('wheel', onLeftWheel));

    const leftSpacer = leftBody.createDiv();
    leftSpacer.addClass('pm-no-shrink');
    const syncSpacer = () => {
      const hScrollbarH = rightPanel.offsetHeight - rightPanel.clientHeight;
      leftSpacer.style.height = `${hScrollbarH}px`;
    };
    rightPanel.addEventListener('scroll', () => {
      syncSpacer();
      leftBody.scrollTop = rightPanel.scrollTop;
    });

    requestAnimationFrame(() => {
      syncSpacer();
      this.scrollToToday();
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private scrollToToday(): void {
    if (!this.scrollEl) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const x = dateToX(this.cfg, today);
    this.scrollEl.scrollLeft = Math.max(0, x - this.scrollEl.clientWidth / 2);
  }

  private setAllTasksCollapsed(collapsed: boolean): void {
    for (const p of this.projects) {
      for (const { task } of flattenTasks(p.tasks)) {
        if (task.subtasks.length > 0) task.collapsed = collapsed;
      }
    }
  }
}

// ─── Tooltip position helper (module-level) ───────────────────────────────

function positionTooltipNear(x: number, y: number): void {
  const tt = document.querySelector('.pm-gantt-tooltip') as HTMLElement | null;
  if (!tt || tt.style.display === 'none') return;
  const rect = tt.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const left = x + 12 + rect.width > vw ? x - rect.width - 12 : x + 12;
  const top  = y + 12 + rect.height > vh ? y - rect.height - 12 : y + 12;
  tt.style.left = `${Math.max(4, left)}px`;
  tt.style.top  = `${Math.max(4, top)}px`;
}
