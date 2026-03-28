# Obsidian-PM: 12 Improvements Implementation Plan

## Context
The obsidian-pm plugin is a production-ready Obsidian project management plugin. The user wants 12 improvements focused on usability, Gantt enhancements, and a major storage architecture change to make tasks first-class Obsidian pages. The changes are ordered so the storage migration (#10) happens early since it affects how most other features work.

---

## Phase 1: Quick Wins (no storage changes)

### 1.1 — #8: Start date defaults to today
**File:** `src/types.ts` line 152
- Change `start: ''` to `start: new Date().toISOString().slice(0, 10)` in `makeTask()`

### 1.2 — #9: Remove emojis from task parameters
**Files:** `src/modals/TaskModal.ts`, `src/views/TableView.ts`, `src/views/KanbanView.ts`, `src/views/GanttView.ts`, `src/store.ts`

**TaskModal.ts** — Replace all emoji property labels with plain text:
- `'◑ Status'` → `'Status'`
- `'▲ Priority'` → `'Priority'`
- `'💎 Type'` → `'Type'`; button text `'💎 Milestone'` → `'Milestone'`, `'☐ Task'` → `'Task'`
- `'◎ Progress'` → `'Progress'`
- `'▷ Start'` → `'Start'`
- `'⏰ Due'` / `'💎 Date'` → `'Due'` / `'Date'`
- `'🔁 Repeat'` → `'Repeat'`
- `'👤 Assignees'` → `'Assignees'`
- `'🏷 Tags'` → `'Tags'`
- `'⛓ Depends on'` → `'Depends on'`
- `'🗑 Delete'` → `'Delete'`
- `'✏️ Type a name…'` → `'Type a name…'`
- `'✓ Save Changes'` → `'Save Changes'`

**TableView.ts** — Replace `💎` milestone and `🔁` recurrence emojis with CSS-styled text badges ("M", "R").

**KanbanView.ts** — Replace `💎`, `🔁`, `⏱`, `📅`, `◫` with plain text equivalents.

**GanttView.ts** — Replace `🔁` (line 643), `💎` (lines 788, 830) with text. Replace `⊙ Today`, `⊞ Expand All`, `⊟ Collapse All` (lines 91-99) with plain text labels.

**store.ts** `appendMarkdownTasks()` — Replace `💎` → `[milestone]`, `🔁` → `[recurring]`, `📅` → `due:`, `👤` → `@`.

**Note:** Leave status/priority `icon` fields in settings config alone — those are user-configurable.

### 1.3 — #4: Shorten project name in tab
**Files:** `src/utils.ts`, `src/views/ProjectView.ts`

- Add `truncateTitle(title: string, maxLen = 20): string` to `utils.ts`
- In `ProjectView.ts` line 37 `getDisplayText()`: return `truncateTitle(this.project?.title ?? 'Project Manager', 20)`
- In `ProjectView.ts` line 194: use `truncateTitle(this.project.title, 20)` for tab header

### 1.4 — #7: Task parameters hidden under toggle
**Files:** `src/modals/TaskModal.ts`, `styles.css`

- Move the description textarea **above** the properties section (currently at line 402, move it after the header)
- Wrap the `pm-modal-props` div in a collapsible section with a "Properties ▶" toggle button
- Default state: collapsed (showing title + description prominently)
- Click toggle: expands to show all property rows with "Properties ▼"
- Add CSS for `.pm-props-toggle-btn` and `.pm-modal-props-container`

---

## Phase 2: Storage Architecture — Tasks as Obsidian Pages (#10)

### File structure
```
Projects/
  MyProject.md                    # Project metadata only
  MyProject/                      # Task folder per project
  task-title-abc123.md          # Each task = own page
  subtask-title-def456.md       # Subtasks too
```

### 2.1 — Data model changes
**File:** `src/types.ts`

Add to Task interface:
```typescript
filePath?: string;   // vault path to this task's .md file
```

### 2.2 — Store rewrite
**File:** `src/store.ts`

**Project .md frontmatter** changes from storing full `tasks:` array to storing `taskIds: string[]` (flat list of top-level task IDs).

**Task .md file format:**
```yaml
---
pm-task: true
projectId: "abc123"
parentId: null          # or parent task ID for subtasks
id: "id1"
title: "My Task"
type: "task"
status: "in-progress"
priority: "high"
start: "2026-03-28"
due: "2026-04-15"
progress: 50
assignees: ["Alice"]
tags: ["frontend"]
subtaskIds: ["id4", "id5"]
dependencies: ["id2"]
collapsed: false
createdAt: "..."
updatedAt: "..."
---
Description goes here as markdown body.
Supports [[wiki-links]] natively.
```

**New/changed store methods:**
- `loadProject(file)`: Read project .md, then read all task .md files from project subfolder, rebuild tree from `parentId`/`subtaskIds` references
- `saveProject(project)`: Save project metadata only (no tasks in YAML)
- `addTask(project, parentId)`: Create new .md file in project folder, update parent's `subtaskIds` or project's `taskIds`
- `updateTask(project, taskId, patch)`: Read+modify+write the task's .md file
- `deleteTask(project, taskId)`: Delete task .md + recursively delete subtask .md files, update parent
- `loadTaskFile(file)`: New — load single task from .md
- `saveTaskFile(task, projectFolder)`: New — save single task to .md

The in-memory `Project.tasks: Task[]` tree remains unchanged — store assembles it on load, views don't change.

### 2.3 — Migration
**New file:** `src/migration.ts`

- On plugin load, detect old-format projects (frontmatter has `tasks:` array of objects)
- For each: create subfolder, extract tasks into individual .md files, rewrite project .md
- Show Obsidian notice with progress
- Run automatically via `workspace.onLayoutReady()` in `main.ts`

### 2.4 — File-open handler for task files
**File:** `src/main.ts`

- In file-open handler, detect `pm-task: true` frontmatter
- When a task file is opened, open its parent project view and highlight/select that task

---

## Phase 3: Gantt Enhancements (#2, #3, #5, #6)

### 3.1 — #2: Click-to-create timeline in Gantt
**File:** `src/views/GanttView.ts`

- Add click handler on SVG background (filter out clicks on bars/handles/milestones)
- Compute date from X position via `xToDate()`
- Create new task with `start` = clicked date, `due` = start + 7 days
- Open TaskModal for the new task

### 3.2 — #3: Manual sort tasks in Gantt
**Files:** `src/views/GanttView.ts`, `src/types.ts`

- Make label rows in left panel draggable (HTML drag-and-drop)
- On drop: remove task from current position, insert before/after target
- Add `moveTaskInTree(tasks, taskId, targetId, 'before'|'after')` helper to `types.ts`
- Save reordered project and refresh

### 3.3 — #5: Add tasks/subtasks from Gantt sidebar
**File:** `src/views/GanttView.ts`

- On each task label row: add hover-visible "+" button → opens TaskModal with `parentId = task.id`
- At bottom of left panel: "+" button → opens TaskModal as top-level task

### 3.4 — #6: Timeline bar color
Already working via per-status colors in settings (line 537-538). No changes needed — user confirmed current behavior is desired.

---

## Phase 4: Subtask Type & Wiki Links (#1, #11)

### 4.1 — #1: Subtask type with visual distinction
**Files:** `src/types.ts`, `src/store.ts`, `src/modals/TaskModal.ts`, views, `styles.css`

- Add `'subtask'` to `TaskType`: `'task' | 'milestone' | 'subtask'`
- TaskModal: Replace binary task/milestone toggle with 3-way selector (Task / Subtask / Milestone)
- When type is 'subtask': show "Parent Task" dropdown to select parent from flattenTasks()
- Views: Show "Sub" CSS badge for subtask type (green-tinted, like milestone badge but distinct)
- Gantt: Subtask bars slightly thinner or with dashed top border for visual distinction

### 4.2 — #11: [[page]] links in task description
**Files:** `src/modals/TaskModal.ts`

After Phase 2, task descriptions are the markdown body of .md files, so Obsidian's native link resolution works when viewing the file directly.

In TaskModal: add a rendered preview below the description textarea using Obsidian's `MarkdownRenderer.render()` to render wiki-links as clickable. The preview updates on input.

---

## Phase 5: Project Baselines (#12)

### 5.1 — Data model
**File:** `src/types.ts`

```typescript
interface BaselineTaskSnapshot {
  taskId: string;
  title: string;
  start: string;
  due: string;
  progress: number;
  status: TaskStatus;
}

interface Baseline {
  id: string;
  name: string;
  createdAt: string;
  tasks: BaselineTaskSnapshot[];
}
```

Add `baselines: Baseline[]` to Project interface. Update `makeProject()`.

### 5.2 — Storage
**File:** `src/store.ts`

Store baselines in project .md frontmatter. Add to serialization/hydration.

### 5.3 — UI: Save baseline
**File:** `src/views/ProjectView.ts`

Add "Save Baseline" button in project toolbar (right section). Prompts for name, snapshots all tasks' dates/progress/status.

### 5.4 — UI: Gantt baseline overlay
**File:** `src/views/GanttView.ts`

- Add baseline selector dropdown in granularity controls bar
- When baseline is active: render semi-transparent "ghost bar" below each task bar showing baseline planned dates
- Tooltip shows deviation from baseline

---

## Verification Plan

After each phase:
1. Build: `npm run build` (esbuild)
2. Copy `main.js` + `manifest.json` + `styles.css` to test vault's `.obsidian/plugins/obsidian-project-manager/`
3. Reload Obsidian, open plugin

**Phase 1:** Create new task → verify start date is today, no emojis in modal/views, tab title truncated, properties collapsed by default
**Phase 2:** Open existing project → verify migration creates task .md files, tasks load correctly, graph view shows task nodes, search finds tasks
**Phase 3:** Click empty Gantt area → new task at that date; drag labels to reorder; hover "+" buttons work
**Phase 4:** Create subtask with parent dropdown; add [[link]] in description → preview renders clickable link
**Phase 5:** Save baseline → switch to Gantt → select baseline → see ghost bars under task bars

---

## Key Files Summary

| File | Phases |
|------|--------|
| `src/types.ts` | 1, 2, 3, 4, 5 |
| `src/store.ts` | 1, 2, 5 |
| `src/modals/TaskModal.ts` | 1, 4 |
| `src/views/GanttView.ts` | 1, 3, 5 |
| `src/views/ProjectView.ts` | 1, 5 |
| `src/views/TableView.ts` | 1, 4 |
| `src/views/KanbanView.ts` | 1, 4 |
| `src/main.ts` | 2 |
| `src/utils.ts` | 1 |
| `styles.css` | 1, 3, 4, 5 |
| `src/migration.ts` (new) | 2 |
