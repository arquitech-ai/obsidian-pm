import { App, TFile, TFolder, normalizePath, parseYaml } from 'obsidian';
import {
  Project,
  Task,
  CustomFieldDef,
  SavedView,
  makeProject,
  makeTask,
  updateTaskInTree,
  deleteTaskFromTree,
  addTaskToTree,
} from './types';
import { sanitizeFileName } from './utils';

const FRONTMATTER_KEY = 'pm-project';

/**
 * Handles all read/write operations against the Obsidian vault.
 * Each project lives in a single .md file. The YAML frontmatter
 * contains the full structured data; the markdown body is used for
 * free-form project notes.
 */
export class ProjectStore {
  constructor(private app: App) {}

  // ─── Folder helpers ────────────────────────────────────────────────────────

  async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    if (!(this.app.vault.getAbstractFileByPath(normalized) instanceof TFolder)) {
      await this.app.vault.createFolder(normalized);
    }
  }

  // ─── Load ──────────────────────────────────────────────────────────────────

  async loadAllProjects(folder: string): Promise<Project[]> {
    await this.ensureFolder(folder);
    const projects: Project[] = [];
    const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + '/'));
    for (const file of files) {
      const project = await this.loadProject(file);
      if (project) projects.push(project);
    }
    return projects.sort((a, b) => a.title.localeCompare(b.title));
  }

  async loadProject(file: TFile): Promise<Project | null> {
    try {
      const content = await this.app.vault.read(file);
      const { frontmatter, body } = this.parseFrontmatter(content);
      if (!frontmatter || frontmatter[FRONTMATTER_KEY] !== true) return null;

      const project: Project = {
        id: (frontmatter.id as string) ?? file.basename,
        title: (frontmatter.title as string) ?? file.basename,
        description: (frontmatter.description as string) ?? body.trim(),
        color: (frontmatter.color as string) ?? '#6366f1',
        icon: (frontmatter.icon as string) ?? '📋',
        tasks: this.hydrateTasks((frontmatter.tasks as unknown[]) ?? []),
        customFields: (frontmatter.customFields as CustomFieldDef[]) ?? [],
        teamMembers: (frontmatter.teamMembers as string[]) ?? [],
        createdAt: (frontmatter.createdAt as string) ?? new Date().toISOString(),
        updatedAt: (frontmatter.updatedAt as string) ?? new Date().toISOString(),
        filePath: file.path,
        savedViews: this.hydrateSavedViews((frontmatter.savedViews as unknown[]) ?? []),
      };
      return project;
    } catch {
      return null;
    }
  }

  private hydrateSavedViews(raw: unknown[]): SavedView[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(r => r && typeof r === 'object').map(r => {
      const v = r as Record<string, unknown>;
      const filter = (v.filter ?? {}) as Record<string, unknown>;
      return {
        id: (v.id as string) ?? '',
        name: (v.name as string) ?? 'Untitled',
        filter: {
          text: (filter.text as string) ?? '',
          statuses: Array.isArray(filter.statuses) ? filter.statuses : [],
          priorities: Array.isArray(filter.priorities) ? filter.priorities : [],
          assignees: Array.isArray(filter.assignees) ? filter.assignees : [],
          tags: Array.isArray(filter.tags) ? filter.tags : [],
          dueDateFilter: (filter.dueDateFilter as string as SavedView['filter']['dueDateFilter']) ?? 'any',
        },
        sortKey: (v.sortKey as string) ?? 'status',
        sortDir: (v.sortDir as 'asc' | 'desc') ?? 'asc',
      };
    });
  }

  private hydrateTasks(raw: unknown[]): Task[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(r => this.hydrateTask(r as Record<string, unknown>));
  }

  private hydrateTask(r: Record<string, unknown>): Task {
    return makeTask({
      id: r.id as string,
      title: r.title as string ?? 'Untitled',
      description: r.description as string ?? '',
      type: (r.type as string) === 'milestone' ? 'milestone' : 'task',
      status: r.status as Task['status'] ?? 'todo',
      priority: r.priority as Task['priority'] ?? 'medium',
      start: r.start as string ?? '',
      due: r.due as string ?? '',
      progress: typeof r.progress === 'number' ? r.progress : 0,
      assignees: Array.isArray(r.assignees) ? r.assignees : [],
      tags: Array.isArray(r.tags) ? r.tags : [],
      subtasks: Array.isArray(r.subtasks) ? this.hydrateTasks(r.subtasks as unknown[]) : [],
      dependencies: Array.isArray(r.dependencies) ? r.dependencies : [],
      recurrence: r.recurrence && typeof r.recurrence === 'object'
        ? r.recurrence as Task['recurrence']
        : undefined,
      timeEstimate: typeof r.timeEstimate === 'number' ? r.timeEstimate : undefined,
      timeLogs: Array.isArray(r.timeLogs)
        ? (r.timeLogs as { date: string; hours: number; note: string }[])
        : undefined,
      customFields: typeof r.customFields === 'object' && r.customFields !== null
        ? r.customFields as Record<string, unknown>
        : {},
      collapsed: r.collapsed === true,
      createdAt: r.createdAt as string ?? new Date().toISOString(),
      updatedAt: r.updatedAt as string ?? new Date().toISOString(),
    });
  }

  // ─── Save ──────────────────────────────────────────────────────────────────

  async saveProject(project: Project): Promise<void> {
    project.updatedAt = new Date().toISOString();
    const file = this.app.vault.getAbstractFileByPath(project.filePath);
    const content = this.serializeProject(project);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      await this.app.vault.create(project.filePath, content);
    }
  }

  private serializeProject(project: Project): string {
    // Serialize tasks recursively to plain objects
    const tasks = this.serializeTasks(project.tasks);

    const fm: Record<string, unknown> = {
      [FRONTMATTER_KEY]: true,
      id: project.id,
      title: project.title,
      description: project.description,
      color: project.color,
      icon: project.icon,
      tasks,
      customFields: project.customFields,
      teamMembers: project.teamMembers,
      savedViews: project.savedViews.length ? project.savedViews : [],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };

    const yamlLines: string[] = ['---'];
    this.appendYaml(yamlLines, fm, 0);
    yamlLines.push('---');
    yamlLines.push('');
    yamlLines.push(`# ${project.icon} ${project.title}`);
    yamlLines.push('');
    if (project.description) {
      yamlLines.push(project.description);
      yamlLines.push('');
    }
    // Human-readable task list in the body
    yamlLines.push('<!-- task list rendered by Project Manager plugin -->');
    this.appendMarkdownTasks(yamlLines, project.tasks, 0);

    return yamlLines.join('\n');
  }

  private serializeTasks(tasks: Task[]): Record<string, unknown>[] {
    return tasks.map(t => {
      const obj: Record<string, unknown> = {
        id: t.id,
        title: t.title,
        description: t.description,
        type: t.type,
        status: t.status,
        priority: t.priority,
        start: t.start,
        due: t.due,
        progress: t.progress,
        assignees: t.assignees,
        tags: t.tags,
        subtasks: this.serializeTasks(t.subtasks),
        dependencies: t.dependencies,
        customFields: t.customFields,
        collapsed: t.collapsed,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
      if (t.recurrence) obj.recurrence = t.recurrence;
      if (t.timeEstimate !== undefined) obj.timeEstimate = t.timeEstimate;
      if (t.timeLogs?.length) obj.timeLogs = t.timeLogs;
      return obj;
    });
  }

  private appendMarkdownTasks(lines: string[], tasks: Task[], depth: number): void {
    const indent = '  '.repeat(depth);
    for (const t of tasks) {
      const check = t.status === 'done' ? 'x' : t.status === 'cancelled' ? '-' : ' ';
      const milestone = t.type === 'milestone' ? ' 💎' : '';
      const recur = t.recurrence ? ' 🔁' : '';
      const due = t.due ? ` 📅 ${t.due}` : '';
      const assignees = t.assignees.length ? ` 👤 ${t.assignees.join(', ')}` : '';
      lines.push(`${indent}- [${check}] ${t.title}${milestone}${recur}${due}${assignees}`);
      if (t.subtasks.length) this.appendMarkdownTasks(lines, t.subtasks, depth + 1);
    }
  }

  /** Minimal YAML serializer (handles strings, numbers, booleans, arrays, objects) */
  private appendYaml(lines: string[], obj: Record<string, unknown>, indent: number): void {
    const pad = '  '.repeat(indent);
    for (const [key, val] of Object.entries(obj)) {
      if (val === null || val === undefined) {
        lines.push(`${pad}${key}:`);
      } else if (typeof val === 'boolean') {
        lines.push(`${pad}${key}: ${val}`);
      } else if (typeof val === 'number') {
        lines.push(`${pad}${key}: ${val}`);
      } else if (typeof val === 'string') {
        const escaped = val.replace(/"/g, '\\"');
        lines.push(`${pad}${key}: "${escaped}"`);
      } else if (Array.isArray(val)) {
        if (val.length === 0) {
          lines.push(`${pad}${key}: []`);
        } else if (typeof val[0] === 'object') {
          lines.push(`${pad}${key}:`);
          for (const item of val) {
            const entries = Object.entries(item as Record<string, unknown>);
            if (entries.length === 0) continue;
            const [firstKey, firstVal] = entries[0];
            lines.push(`${pad}  - ${firstKey}: ${JSON.stringify(firstVal)}`);
            for (const [k, v] of entries.slice(1)) {
              lines.push(`${pad}    ${k}: ${JSON.stringify(v)}`);
            }
          }
        } else {
          const items = val.map(v => JSON.stringify(v)).join(', ');
          lines.push(`${pad}${key}: [${items}]`);
        }
      } else if (typeof val === 'object') {
        const keys = Object.keys(val as object);
        if (keys.length === 0) {
          lines.push(`${pad}${key}: {}`);
        } else {
          lines.push(`${pad}${key}:`);
          this.appendYaml(lines, val as Record<string, unknown>, indent + 1);
        }
      }
    }
  }

  // ─── CRUD shortcuts ────────────────────────────────────────────────────────

  async createProject(title: string, folder: string): Promise<Project> {
    const safeName = title.replace(/[\\/:*?"<>|]/g, '-');
    const filePath = normalizePath(`${folder}/${safeName}.md`);
    const project = makeProject(title, filePath);
    await this.saveProject(project);
    return project;
  }

  async addTask(project: Project, parentId: string | null = null): Promise<Task> {
    const task = makeTask();
    addTaskToTree(project.tasks, task, parentId);
    await this.saveProject(project);
    return task;
  }

  async updateTask(project: Project, taskId: string, patch: Partial<Task>): Promise<void> {
    updateTaskInTree(project.tasks, taskId, patch);
    await this.saveProject(project);
  }

  async deleteTask(project: Project, taskId: string): Promise<void> {
    deleteTaskFromTree(project.tasks, taskId);
    await this.saveProject(project);
  }

  async deleteProject(project: Project): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(project.filePath);
    if (file instanceof TFile) await this.app.vault.trash(file, true);
  }

  // ─── Frontmatter parser ────────────────────────────────────────────────────

  private parseFrontmatter(content: string): {
    frontmatter: Record<string, unknown> | null;
    body: string;
  } {
    if (!content.startsWith('---')) return { frontmatter: null, body: content };
    const end = content.indexOf('\n---', 4);
    if (end === -1) return { frontmatter: null, body: content };
    const raw = content.slice(4, end);
    const body = content.slice(end + 4).trim();
    try {
      // Use Obsidian's built-in YAML parser via parseYaml from obsidian
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { parseYaml } = require('obsidian');
      return { frontmatter: parseYaml(raw) as Record<string, unknown>, body };
    } catch {
      return { frontmatter: null, body: content };
    }
  }
}
