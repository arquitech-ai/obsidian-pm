import type { App } from 'obsidian';
import type PMPlugin from '../main';
import type { Project, Task } from '../types';
import { TaskModal } from '../modals/TaskModal';
import { ProjectModal } from '../modals/ProjectModal';

/**
 * Centralized modal helpers. Instead of `new TaskModal(app, plugin, project, task, parentId, cb).open()`
 * everywhere (6 params, 14+ call sites), use `openTaskModal(plugin, project, { task, parentId, onSave })`.
 */

export interface OpenTaskModalOpts {
  task?: Task | null;
  parentId?: string | null;
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
