import type { App } from 'obsidian';
import type PMPlugin from '../main';
import type { Project, Task } from '../types';
import { TaskModal } from '../modals/TaskModal';
import { ProjectModal } from '../modals/ProjectModal';
import { ProjectPickerModal, TaskPickerModal } from '../modals/PickerModals';

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
