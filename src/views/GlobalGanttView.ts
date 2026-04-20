import type PMPlugin from '../main';
import type { Project, Task, GanttGranularity } from '../types';
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

// Height of the project summary bar inside a row (slightly taller than task bars)
const PROJECT_BAR_PADDING = 5;

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
      // inject synthetic tasks for project start/end so the timeline spans them
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

    // Granularity buttons
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

    // Global expand / collapse buttons
    const expandBtn = bar.createEl('button', { text: 'Expand all', cls: 'pm-btn pm-btn-ghost pm-gantt-expand-btn' });
    expandBtn.addEventListener('click', () => {
      this.collapsedProjects.clear();
      this.setAllTasksCollapsed(false);
      this.render();
    });

    const collapseBtn = bar.createEl('button', { text: 'Collapse all', cls: 'pm-btn pm-btn-ghost pm-gantt-expand-btn' });
    collapseBtn.addEventListener('click', () => {
      for (const p of this.projects) this.collapsedProjects.add(p.id);
      this.render();
    });
  }

  // ─── Main Gantt ────────────────────────────────────────────────────────────

  private renderGantt(): void {
    // Pre-compute visible rows per project
    interface Section {
      project: Project;
      tasks: Task[];
      taskRows: number;   // number of visible task rows when expanded
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
      totalRows += 1 + taskRows; // 1 = project row
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

    // Base renderer context
    const allFlatTasks = sections.flatMap(s =>
      flattenTasks(s.tasks).filter(f => f.visible || f.depth === 0),
    );
    const baseCtx: RendererContext = {
      svgEl: this.svgEl, cfg: this.cfg, plugin: this.plugin,
      project: this.projects[0] ?? ({} as Project),
      flatTasks: allFlatTasks, drag: this.drag, link: this.link,
      onRefresh: this.onRefreshAll, cleanupFns: this.cleanupFns,
    };

    renderTimelineHeader(baseCtx);
    renderGridLines(baseCtx, totalRows);
    renderTodayLine(baseCtx, svgHeight);

    const barsGroup = svgEl('g', { class: 'pm-gantt-bars' });
    this.svgEl.appendChild(barsGroup);

    let rowIndex = 0;

    for (const { project, tasks, collapsed } of sections) {
      const projRowY = HEADER_HEIGHT + rowIndex * ROW_HEIGHT;

      // ── Project row — left panel ────────────────────────────────────────────
      const projRow = leftBody.createDiv('pm-gantt-project-row');
      projRow.style.height = `${ROW_HEIGHT}px`;
      projRow.dataset.projectId = project.id;

      const chevron = projRow.createEl('span', {
        cls: 'pm-gantt-project-chevron',
        text: collapsed ? '▶' : '▼',
      });
      chevron.title = collapsed ? 'Expand tasks' : 'Collapse tasks';

      const accent = projRow.createDiv('pm-gantt-project-section-accent');
      accent.style.background = project.color;
      projRow.createEl('span', { text: project.icon, cls: 'pm-gantt-project-section-icon' });
      projRow.createEl('span', {
        text: project.title,
        cls: 'pm-gantt-project-section-title',
        attr: { title: project.title },
      });

      const taskCount = flattenTasks(tasks).filter(f => f.depth === 0).length;
      projRow.createEl('span', {
        text: `${taskCount}`,
        cls: 'pm-gantt-project-task-badge',
      });

      // Toggle on chevron click OR anywhere in the project row header
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

      // ── Project bar ──────────────────────────────────────────────────────────
      const { start, end } = resolveProjectDates(project);
      if (start && end) {
        const startDate = new Date(start);
        const endDate   = new Date(end);
        endDate.setDate(endDate.getDate() + 1); // inclusive end
        const x = Math.max(0, dateToX(this.cfg, startDate));
        const x2 = dateToX(this.cfg, endDate);
        const barWidth = Math.max(4, x2 - x);
        const barY = projRowY + PROJECT_BAR_PADDING;
        const barH = ROW_HEIGHT - PROJECT_BAR_PADDING * 2;

        // Shadow/background rect
        barsGroup.appendChild(svgEl('rect', {
          x, y: barY, width: barWidth, height: barH,
          rx: BAR_BORDER_RADIUS, ry: BAR_BORDER_RADIUS,
          class: 'pm-gantt-project-bar-shadow',
        }));

        // Main bar
        const projBar = svgEl('rect', {
          x, y: barY, width: barWidth, height: barH,
          rx: BAR_BORDER_RADIUS, ry: BAR_BORDER_RADIUS,
          class: 'pm-gantt-project-bar',
          fill: project.color,
        });
        barsGroup.appendChild(projBar);

        // Label inside bar (if it fits)
        const labelText = project.title;
        const textX = x + 8;
        const textY = projRowY + ROW_HEIGHT / 2 + 1;
        const textEl = svgEl('text', {
          x: textX, y: textY,
          class: 'pm-gantt-project-bar-label',
          'clip-path': `url(#clip-proj-${project.id})`,
        });
        textEl.textContent = labelText;
        // Clip path so text doesn't overflow the bar
        const defs = this.svgEl.querySelector('defs') ?? (() => {
          const d = svgEl('defs', {}); this.svgEl.prepend(d); return d;
        })();
        const clipRect = svgEl('clipPath', { id: `clip-proj-${project.id}` });
        clipRect.appendChild(svgEl('rect', { x: x + 2, y: barY, width: Math.max(0, barWidth - 4), height: barH }));
        defs.appendChild(clipRect);
        barsGroup.appendChild(textEl);

        // Tooltip
        const title = svgEl('title', {});
        title.textContent = `${project.title}: ${start} → ${end}`;
        projBar.appendChild(title);
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
