import type { MotionProject } from '../schema/projectSchema.ts';
import { validateProject } from '../schema/projectSchema.ts';

export interface ProjectCommand {
  id: string;
  label: string;
  affectedIds: string[];
  validate?: (project: MotionProject) => string | null; // null = valid, string = error message
  execute: (project: MotionProject) => MotionProject;
}

interface HistoryEntry {
  label: string;
  before: MotionProject;
  after: MotionProject;
}

export class CommandManager {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxHistory = 100;

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getUndoLabel(): string | null {
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].label : null;
  }

  getRedoLabel(): string | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1].label : null;
  }

  dispatch(
    current: MotionProject,
    command: ProjectCommand
  ): { ok: true; project: MotionProject } | { ok: false; error: string } {
    if (command.validate) {
      const err = command.validate(current);
      if (err) return { ok: false, error: err };
    }

    const nextRaw = command.execute(current);
    const stamped: MotionProject = {
      ...nextRaw,
      updatedAt: new Date().toISOString(),
    };

    const validation = validateProject(stamped);
    if (!validation.success) {
      return { ok: false, error: `Schema validation failed: ${validation.error}` };
    }

    this.undoStack.push({
      label: command.label,
      before: current,
      after: validation.data,
    });
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];

    return { ok: true, project: validation.data };
  }

  undo(current: MotionProject): { project: MotionProject; label: string } | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({
      label: entry.label,
      before: entry.before,
      after: current,
    });
    return { project: entry.before, label: entry.label };
  }

  redo(): { project: MotionProject; label: string } | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({
      label: entry.label,
      before: entry.before,
      after: entry.after,
    });
    return { project: entry.after, label: entry.label };
  }
}
