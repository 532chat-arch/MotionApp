import { create } from 'zustand';
import { CommandManager, ProjectCommand } from '../commands/commandManager';
import { ProjectCommands, uid } from '../commands/projectCommands';
import { getProjectMovieDurationFrames } from '../engine/evaluator';
import { connectMcpServer } from '../mcp/mcpClient';
import type { ExternalMcpServer, McpActivityEntry } from '../mcp/mcpTypes';
import type {
  InterpolationType,
  LayerAnimatableProp,
  LayerDocument,
  LyricsConfig,
  MotionModifierInstance,
  MotionProject,
} from '../schema/projectSchema';
import { fpsToNumber } from '../schema/projectSchema';
import { animationPresetRegistry } from '../services/AnimationPresetRegistry';
import {
  deleteProjectFromIndexedDb,
  getLastOpenedProjectId,
  listSavedProjects,
  loadProjectFromIndexedDb,
  SavedProjectSummary,
  saveProjectToIndexedDb,
} from '../storage/IndexedDbStorage';
import { createDemoProject, type DemoTemplateId } from '../utils/demoProjects';
import { createBlankProject, createStarterProject } from '../utils/starterProject';

export type WorkspaceTab = 'home' | 'composition' | 'movie' | 'assets' | 'characters' | 'export' | 'mcp';
export type CanvasTool = 'select' | 'pan';
export type InspectorTarget = 'layer' | 'camera' | 'environment' | 'presets';

export interface CopiedKeyframeItem {
  prop: LayerAnimatableProp;
  value: number;
  interpolation: InterpolationType;
}

export interface SelectedKeyframeRef {
  scope: 'layer' | 'camera';
  targetId: string;
  prop: string;
  kfId: string;
}

export interface ApplyMotionPresetOptions {
  compositionId?: string;
  layerId?: string;
  targetScope?: 'auto' | 'layer' | 'camera';
  overrides?: Partial<MotionModifierInstance>;
  preserveInspectorTarget?: boolean;
}

export interface ApplyMotionPresetResult {
  ok: boolean;
  modifierId?: string;
  targetScope?: 'layer' | 'camera' | 'environment' | 'lyrics';
  error?: string;
}

interface StudioState {
  project: MotionProject;
  savedProjects: SavedProjectSummary[];
  isProjectsLoading: boolean;
  saveStatus: 'saved' | 'saving' | 'unsaved';
  workspace: WorkspaceTab;
  activeCompositionId: string;
  selectedLayerId: string | null;
  selectedKeyframe: SelectedKeyframeRef | null;
  selectedModifierId: string | null;
  inspectorTarget: InspectorTarget;
  currentFrame: number;
  movieFrame: number;
  isPlaying: boolean;
  loopPlayback: boolean;
  masterMuted: boolean;
  activeTool: CanvasTool;
  showGuides: boolean;
  showMotionPath: boolean;
  previewQuality: 'full' | 'reduced';
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  feedbackMessage: { type: 'info' | 'error'; text: string } | null;
  copiedKeyframes: CopiedKeyframeItem[] | null;

  mcpBridgeStatus: 'connecting' | 'connected' | 'disconnected';
  mcpLogs: McpActivityEntry[];
  externalMcpServers: ExternalMcpServer[];
  lastRemoteMcpRevision: number | null;
  shortcutsModalOpen: boolean;

  initPersistence: () => Promise<void>;
  dispatchCommand: (command: ProjectCommand) => boolean;
  undo: () => void;
  redo: () => void;
  saveNow: () => Promise<void>;
  loadProjectById: (id: string) => Promise<void>;
  createNewProject: (
    name: string,
    options?: { width?: number; height?: number; fps?: number }
  ) => Promise<void>;
  openDemoProject: (demoId: DemoTemplateId) => Promise<void>;
  deleteSavedProject: (id: string) => Promise<void>;
  importLoadedProject: (project: MotionProject) => Promise<void>;

  setWorkspace: (tab: WorkspaceTab) => void;
  setActiveComposition: (compId: string) => void;
  selectLayer: (layerId: string | null, target?: InspectorTarget) => void;
  setSelectedKeyframe: (ref: SelectedKeyframeRef | null) => void;
  setSelectedModifierId: (modifierId: string | null) => void;
  setInspectorTarget: (target: InspectorTarget) => void;
  setCurrentFrame: (frame: number) => void;
  stepFrame: (delta: number) => void;
  setMovieFrame: (frame: number) => void;
  setIsPlaying: (playing: boolean) => void;
  toggleLoop: () => void;
  toggleMute: () => void;
  setActiveTool: (tool: CanvasTool) => void;
  toggleGuides: () => void;
  toggleMotionPath: () => void;
  togglePreviewQuality: () => void;
  showFeedback: (type: 'info' | 'error', text: string) => void;
  clearFeedback: () => void;
  copyKeyframesAtCurrentFrame: () => void;
  pasteKeyframesAtCurrentFrame: () => void;
  apply_motion_preset: (
    presetId: string,
    options?: ApplyMotionPresetOptions
  ) => ApplyMotionPresetResult;
  applyMotionPreset: (
    presetId: string,
    options?: ApplyMotionPresetOptions
  ) => ApplyMotionPresetResult;
  updateMotionModifier: (
    modifierId: string,
    patch: Partial<MotionModifierInstance>,
    options?: { compositionId?: string; layerId?: string; targetScope?: 'layer' | 'camera' }
  ) => boolean;
  removeMotionModifier: (
    modifierId: string,
    options?: { compositionId?: string; layerId?: string; targetScope?: 'layer' | 'camera' }
  ) => boolean;
  refreshProjectList: () => Promise<void>;

  setMcpBridgeStatus: (status: 'connecting' | 'connected' | 'disconnected') => void;
  setMcpLogs: (logs: McpActivityEntry[]) => void;
  appendMcpLog: (entry: McpActivityEntry) => void;
  clearMcpLogs: () => void;
  applyRemoteMcpProject: (
    project: MotionProject,
    label: string,
    revision: number,
    activeCompositionId?: string
  ) => void;
  addExternalMcpServer: (name: string, url: string, bearerToken?: string) => Promise<void>;
  connectExternalMcpServer: (id: string) => Promise<void>;
  removeExternalMcpServer: (id: string) => void;
  setShortcutsModalOpen: (open: boolean) => void;
}

const commandManager = new CommandManager();
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutosave(project: MotionProject, set: (partial: Partial<StudioState>) => void) {
  set({ saveStatus: 'unsaved' });
  if (autosaveTimer !== null) {
    globalThis.clearTimeout(autosaveTimer);
  }
  autosaveTimer = globalThis.setTimeout(async () => {
    set({ saveStatus: 'saving' });
    try {
      await saveProjectToIndexedDb(project);
      const list = await listSavedProjects();
      set({ saveStatus: 'saved', savedProjects: list });
    } catch {
      set({ saveStatus: 'unsaved' });
    }
  }, 600);
}

const MCP_SERVERS_STORAGE_KEY = 'motion_studio_external_mcp_servers_v1';

function loadStoredMcpServers(): ExternalMcpServer[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(MCP_SERVERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      id: String(item.id ?? uid('mcp')),
      name: String(item.name ?? 'External MCP'),
      url: String(item.url ?? ''),
      bearerToken: typeof item.bearerToken === 'string' ? item.bearerToken : undefined,
      status: 'disconnected' as const,
      tools: Array.isArray(item.tools) ? item.tools : [],
      resources: Array.isArray(item.resources) ? item.resources : [],
      prompts: Array.isArray(item.prompts) ? item.prompts : [],
    }));
  } catch {
    return [];
  }
}

function saveStoredMcpServers(servers: ExternalMcpServer[]) {
  if (typeof window === 'undefined') return;
  try {
    const serializable = servers.map(({ id, name, url, bearerToken, tools, resources, prompts }) => ({
      id,
      name,
      url,
      bearerToken,
      tools,
      resources,
      prompts,
    }));
    window.localStorage.setItem(MCP_SERVERS_STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // Ignore storage quota errors
  }
}

const initialProject = createStarterProject();

export const useStudioStore = create<StudioState>((set, get) => ({
  project: initialProject,
  savedProjects: [],
  isProjectsLoading: true,
  saveStatus: 'saved',
  workspace: 'home',
  activeCompositionId: initialProject.compositions[0].id,
  selectedLayerId: initialProject.compositions[0].layers[2]?.id ?? initialProject.compositions[0].layers[0]?.id ?? null,
  selectedKeyframe: null,
  selectedModifierId: null,
  inspectorTarget: 'layer',
  currentFrame: 0,
  movieFrame: 0,
  isPlaying: false,
  loopPlayback: true,
  masterMuted: false,
  activeTool: 'select',
  showGuides: true,
  showMotionPath: true,
  previewQuality: 'full',
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  feedbackMessage: null,
  copiedKeyframes: null,

  mcpBridgeStatus: 'connecting',
  mcpLogs: [],
  externalMcpServers: loadStoredMcpServers(),
  lastRemoteMcpRevision: null,
  shortcutsModalOpen: false,

  initPersistence: async () => {
    try {
      const lastId = await getLastOpenedProjectId();
      if (lastId) {
        const loaded = await loadProjectFromIndexedDb(lastId);
        if (loaded) {
          commandManager.clear();
          const firstComp = loaded.compositions[0];
          set({
            project: loaded,
            activeCompositionId: firstComp.id,
            selectedLayerId: firstComp.layers[0]?.id ?? null,
            currentFrame: 0,
            movieFrame: 0,
            saveStatus: 'saved',
            canUndo: false,
            canRedo: false,
          });
        }
      } else {
        await saveProjectToIndexedDb(get().project);
      }
      const list = await listSavedProjects();
      set({ savedProjects: list, isProjectsLoading: false });
    } catch {
      // IndexedDB unavailable in restricted environments — keep in-memory project functional
      set({ isProjectsLoading: false });
    }
  },

  refreshProjectList: async () => {
    set({ isProjectsLoading: true });
    try {
      const list = await listSavedProjects();
      set({ savedProjects: list, isProjectsLoading: false });
    } catch {
      set({ isProjectsLoading: false });
    }
  },

  dispatchCommand: (command: ProjectCommand) => {
    const state = get();
    const res = commandManager.dispatch(state.project, command);
    if (!res.ok) {
      state.showFeedback('error', res.error);
      return false;
    }

    let nextActiveComp = state.activeCompositionId;
    if (!res.project.compositions.some((c) => c.id === nextActiveComp)) {
      nextActiveComp = res.project.compositions[0].id;
    }

    const activeComp = res.project.compositions.find((c) => c.id === nextActiveComp)!;
    let nextSelectedLayer = state.selectedLayerId;
    if (nextSelectedLayer && !activeComp.layers.some((l) => l.id === nextSelectedLayer)) {
      nextSelectedLayer = activeComp.layers[0]?.id ?? null;
    }

    set({
      project: res.project,
      activeCompositionId: nextActiveComp,
      selectedLayerId: nextSelectedLayer,
      canUndo: commandManager.canUndo(),
      canRedo: commandManager.canRedo(),
      undoLabel: commandManager.getUndoLabel(),
      redoLabel: commandManager.getRedoLabel(),
    });

    scheduleAutosave(res.project, set);
    return true;
  },

  undo: () => {
    const state = get();
    const res = commandManager.undo(state.project);
    if (!res) return;
    set({
      project: res.project,
      canUndo: commandManager.canUndo(),
      canRedo: commandManager.canRedo(),
      undoLabel: commandManager.getUndoLabel(),
      redoLabel: commandManager.getRedoLabel(),
    });
    state.showFeedback('info', `Undid: ${res.label}`);
    scheduleAutosave(res.project, set);
  },

  redo: () => {
    const state = get();
    const res = commandManager.redo();
    if (!res) return;
    set({
      project: res.project,
      canUndo: commandManager.canUndo(),
      canRedo: commandManager.canRedo(),
      undoLabel: commandManager.getUndoLabel(),
      redoLabel: commandManager.getRedoLabel(),
    });
    state.showFeedback('info', `Redid: ${res.label}`);
    scheduleAutosave(res.project, set);
  },

  saveNow: async () => {
    const state = get();
    set({ saveStatus: 'saving' });
    try {
      await saveProjectToIndexedDb(state.project);
      const list = await listSavedProjects();
      set({ saveStatus: 'saved', savedProjects: list });
      state.showFeedback('info', 'Project saved locally');
    } catch {
      set({ saveStatus: 'unsaved' });
      state.showFeedback('error', 'Failed to save to browser storage');
    }
  },

  loadProjectById: async (id: string) => {
    const loaded = await loadProjectFromIndexedDb(id);
    if (!loaded) {
      get().showFeedback('error', 'Could not load selected project');
      return;
    }
    commandManager.clear();
    const firstComp = loaded.compositions[0];
    set({
      project: loaded,
      activeCompositionId: firstComp.id,
      selectedLayerId: firstComp.layers[0]?.id ?? null,
      selectedKeyframe: null,
      selectedModifierId: null,
      currentFrame: 0,
      movieFrame: 0,
      isPlaying: false,
      canUndo: false,
      canRedo: false,
      saveStatus: 'saved',
      workspace: 'composition',
    });
    try {
      await saveProjectToIndexedDb(loaded);
      const list = await listSavedProjects();
      set({ savedProjects: list });
    } catch {
      // Ignore storage failure
    }
    get().showFeedback('info', `Opened "${loaded.name}"`);
  },

  createNewProject: async (
    name: string,
    options?: { width?: number; height?: number; fps?: number }
  ) => {
    const next = createBlankProject(name.trim() || 'Untitled Movie', options);
    commandManager.clear();
    let list = get().savedProjects;
    try {
      await saveProjectToIndexedDb(next);
      list = await listSavedProjects();
    } catch {
      // IndexedDB unavailable in restricted/node environments
    }
    set({
      project: next,
      savedProjects: list,
      activeCompositionId: next.compositions[0].id,
      selectedLayerId: null,
      selectedKeyframe: null,
      selectedModifierId: null,
      currentFrame: 0,
      movieFrame: 0,
      isPlaying: false,
      canUndo: false,
      canRedo: false,
      saveStatus: 'saved',
      workspace: 'composition',
    });
    get().showFeedback('info', `Created "${next.name}"`);
  },

  openDemoProject: async (demoId: DemoTemplateId) => {
    const demo = createDemoProject(demoId);
    commandManager.clear();
    let list = get().savedProjects;
    try {
      await saveProjectToIndexedDb(demo);
      list = await listSavedProjects();
    } catch {
      // IndexedDB unavailable in restricted/node environments
    }
    const firstComp = demo.compositions[0];
    set({
      project: demo,
      savedProjects: list,
      activeCompositionId: firstComp.id,
      selectedLayerId: firstComp.layers[0]?.id ?? null,
      selectedKeyframe: null,
      selectedModifierId: null,
      currentFrame: 0,
      movieFrame: 0,
      isPlaying: false,
      canUndo: false,
      canRedo: false,
      saveStatus: 'saved',
      workspace: 'composition',
    });
    get().showFeedback('info', `Opened demo "${demo.name}"`);
  },

  deleteSavedProject: async (id: string) => {
    try {
      await deleteProjectFromIndexedDb(id);
      const list = await listSavedProjects();
      set({ savedProjects: list });
      get().showFeedback('info', 'Removed project from local browser storage');
    } catch {
      get().showFeedback('error', 'Failed to delete saved project');
    }
  },

  importLoadedProject: async (project: MotionProject) => {
    commandManager.clear();
    await saveProjectToIndexedDb(project);
    const list = await listSavedProjects();
    set({
      project,
      savedProjects: list,
      activeCompositionId: project.compositions[0].id,
      selectedLayerId: project.compositions[0].layers[0]?.id ?? null,
      currentFrame: 0,
      movieFrame: 0,
      isPlaying: false,
      canUndo: false,
      canRedo: false,
      saveStatus: 'saved',
      workspace: 'composition',
    });
    get().showFeedback('info', `Imported "${project.name}"`);
  },

  setWorkspace: (tab) => set({ workspace: tab, isPlaying: false }),

  setActiveComposition: (compId) => {
    const comp = get().project.compositions.find((c) => c.id === compId);
    if (!comp) return;
    set({
      activeCompositionId: compId,
      selectedLayerId: comp.layers[0]?.id ?? null,
      selectedKeyframe: null,
      currentFrame: 0,
      isPlaying: false,
      inspectorTarget: 'layer',
    });
  },

  selectLayer: (layerId, target) =>
    set((s) => ({
      selectedLayerId: layerId,
      selectedKeyframe:
        s.selectedKeyframe?.scope === 'layer' && s.selectedKeyframe.targetId === layerId
          ? s.selectedKeyframe
          : null,
      selectedModifierId: s.selectedLayerId === layerId ? s.selectedModifierId : null,
      inspectorTarget:
        target ??
        (s.inspectorTarget === 'presets'
          ? 'presets'
          : layerId
            ? 'layer'
            : s.inspectorTarget),
    })),

  setSelectedKeyframe: (ref) => set({ selectedKeyframe: ref }),

  setSelectedModifierId: (modifierId) => set({ selectedModifierId: modifierId }),

  setInspectorTarget: (target) => set({ inspectorTarget: target }),

  setCurrentFrame: (frame) => {
    const comp = get().project.compositions.find((c) => c.id === get().activeCompositionId);
    const maxF = Math.max(0, (comp?.settings.durationFrames ?? 240) - 1);
    const clamped = Math.max(0, Math.min(maxF, Math.round(frame)));
    set({ currentFrame: clamped });
  },

  stepFrame: (delta) => {
    const state = get();
    if (state.workspace === 'movie') {
      const maxMovie = Math.max(0, getProjectMovieDurationFrames(state.project) - 1);
      set({ movieFrame: Math.max(0, Math.min(maxMovie, state.movieFrame + delta)) });
    } else {
      state.setCurrentFrame(state.currentFrame + delta);
    }
  },

  setMovieFrame: (frame) => {
    const maxMovie = Math.max(0, getProjectMovieDurationFrames(get().project) - 1);
    set({ movieFrame: Math.max(0, Math.min(maxMovie, Math.round(frame))) });
  },

  setIsPlaying: (playing) => set({ isPlaying: playing }),
  toggleLoop: () => set((s) => ({ loopPlayback: !s.loopPlayback })),
  toggleMute: () => set((s) => ({ masterMuted: !s.masterMuted })),
  setActiveTool: (tool) => set({ activeTool: tool }),
  toggleGuides: () => set((s) => ({ showGuides: !s.showGuides })),
  toggleMotionPath: () => set((s) => ({ showMotionPath: !s.showMotionPath })),
  togglePreviewQuality: () =>
    set((s) => ({ previewQuality: s.previewQuality === 'full' ? 'reduced' : 'full' })),

  showFeedback: (type, text) => {
    set({ feedbackMessage: { type, text } });
    if (feedbackTimer !== null) globalThis.clearTimeout(feedbackTimer);
    feedbackTimer = globalThis.setTimeout(() => {
      set({ feedbackMessage: null });
    }, 3500);
  },

  clearFeedback: () => set({ feedbackMessage: null }),

  copyKeyframesAtCurrentFrame: () => {
    const state = get();
    const comp = state.project.compositions.find((c) => c.id === state.activeCompositionId);
    const layer = comp?.layers.find((l) => l.id === state.selectedLayerId);
    if (!layer) return;

    const props: LayerAnimatableProp[] = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'];
    const items: CopiedKeyframeItem[] = [];
    for (const p of props) {
      const kf = layer.keyframes[p]?.find((k) => k.frame === state.currentFrame);
      if (kf) {
        items.push({ prop: p, value: kf.value, interpolation: kf.interpolation });
      }
    }
    if (items.length === 0) {
      state.showFeedback('info', 'No keyframes on this layer at the current frame');
      return;
    }
    set({ copiedKeyframes: items });
    state.showFeedback('info', `Copied ${items.length} keyframe(s) from frame ${state.currentFrame}`);
  },

  pasteKeyframesAtCurrentFrame: () => {
    const state = get();
    if (!state.copiedKeyframes || !state.selectedLayerId) return;
    const comp = state.project.compositions.find((c) => c.id === state.activeCompositionId);
    const layer = comp?.layers.find((l) => l.id === state.selectedLayerId);
    if (!comp || !layer) return;

    // Apply all copied keyframes as a single undoable command
    const copied = state.copiedKeyframes;
    const targetFrame = state.currentFrame;
    const cmd: ProjectCommand = {
      id: uid('cmd'),
      label: `Paste Keyframes at F${targetFrame}`,
      affectedIds: [comp.id, layer.id],
      execute: (proj) => ({
        ...proj,
        compositions: proj.compositions.map((c) =>
          c.id !== comp.id
            ? c
            : {
                ...c,
                layers: c.layers.map((l) => {
                  if (l.id !== layer.id) return l;
                  const nextKfs = { ...l.keyframes };
                  for (const item of copied) {
                    const list = nextKfs[item.prop] ?? [];
                    const idx = list.findIndex((k) => k.frame === targetFrame);
                    nextKfs[item.prop] =
                      idx >= 0
                        ? list.map((k, i) =>
                            i === idx
                              ? { ...k, value: item.value, interpolation: item.interpolation }
                              : k
                          )
                        : [
                            ...list,
                            {
                              id: uid('kf'),
                              frame: targetFrame,
                              value: item.value,
                              interpolation: item.interpolation,
                            },
                          ].sort((a, b) => a.frame - b.frame);
                  }
                  return { ...l, keyframes: nextKfs };
                }),
              }
        ),
      }),
    };
    if (state.dispatchCommand(cmd)) {
      state.showFeedback('info', `Pasted ${copied.length} keyframe(s) at frame ${targetFrame}`);
    }
  },

  apply_motion_preset: (presetId, options = {}) => {
    const state = get();
    const compId = options.compositionId ?? state.activeCompositionId;
    const comp =
      state.project.compositions.find((c) => c.id === compId) ?? state.project.compositions[0];
    if (!comp) {
      state.showFeedback('error', 'No active composition found.');
      return { ok: false, error: 'No active composition found.' };
    }

    const preset = animationPresetRegistry.getById(presetId);
    if (!preset) {
      const err = `Unknown motion preset "${presetId}"`;
      state.showFeedback('error', err);
      return { ok: false, error: err };
    }

    const fps = getActiveCompFps(state.project, comp.id);

    // 1. Environment preset -> non-destructive environment patch
    if (preset.category === 'environment' && preset.environmentPatch) {
      const ok = state.dispatchCommand(
        ProjectCommands.updateEnvironment(comp.id, preset.environmentPatch)
      );
      if (ok) {
        state.showFeedback('info', `Applied environment preset "${preset.name}"`);
      }
      return { ok, targetScope: 'environment' };
    }

    // 2. Lyrics preset -> apply typography animation to target or active text layer
    if (preset.category === 'lyrics' && preset.lyricsStyle) {
      const explicitLayer = options.layerId
        ? comp.layers.find((l) => l.id === options.layerId)
        : null;
      const activeLayer = state.selectedLayerId
        ? comp.layers.find((l) => l.id === state.selectedLayerId)
        : null;
      const textTarget =
        (explicitLayer?.objects[0]?.kind === 'text' ? explicitLayer : null) ??
        (activeLayer?.objects[0]?.kind === 'text' ? activeLayer : null) ??
        comp.layers.find((l) => l.objects[0]?.kind === 'text') ??
        null;

      const nextTarget = options.preserveInspectorTarget
        ? state.inspectorTarget
        : state.inspectorTarget === 'presets'
          ? 'presets'
          : 'layer';

      if (textTarget && textTarget.objects[0]?.kind === 'text') {
        const obj = textTarget.objects[0];
        const prev = obj.lyrics;
        const nextLyrics: LyricsConfig = {
          enabled: true,
          style: preset.lyricsStyle,
          highlightColor: prev?.highlightColor ?? '#F59E0B',
          glowColor: prev?.glowColor ?? '#38BDF8',
          glowBlur: prev?.glowBlur ?? 12,
          shadowColor: prev?.shadowColor ?? 'rgba(0,0,0,0.65)',
          shadowBlur: prev?.shadowBlur ?? 6,
          staggerFrames: prev?.staggerFrames ?? 3,
          beatBpm: prev?.beatBpm ?? 120,
          beatSyncIntensity: prev?.beatSyncIntensity ?? 0.15,
          cues: prev?.cues ?? [],
        };
        const ok = state.dispatchCommand(
          ProjectCommands.setTextLyrics(comp.id, textTarget.id, obj.id, nextLyrics)
        );
        if (ok) {
          state.selectLayer(textTarget.id, nextTarget);
          state.showFeedback('info', `Applied "${preset.name}" to "${textTarget.name}"`);
        }
        return { ok, targetScope: 'lyrics' };
      }

      const newLayerId = uid('layer');
      const newLayer: LayerDocument = {
        id: newLayerId,
        name: 'Lyrics Layer',
        role: 'foreground',
        visible: true,
        locked: false,
        solo: false,
        opacity: 1,
        blendMode: 'normal',
        depth: 0.4,
        inFrame: 0,
        outFrame: comp.settings.durationFrames,
        objects: [
          {
            id: uid('obj'),
            name: 'Lyrics Text',
            kind: 'text',
            text: 'Your Lyrics Here',
            fontSize: 46,
            fontFamily: 'Plus Jakarta Sans',
            color: '#F8FAFC',
            align: 'center',
            lyrics: {
              enabled: true,
              style: preset.lyricsStyle,
              highlightColor: '#F59E0B',
              glowColor: '#38BDF8',
              glowBlur: 12,
              shadowColor: 'rgba(0,0,0,0.65)',
              shadowBlur: 6,
              staggerFrames: 3,
              beatBpm: 120,
              beatSyncIntensity: 0.15,
              cues: [],
            },
            transform: {
              x: comp.settings.width / 2,
              y: Math.round(comp.settings.height * 0.8),
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              pivotX: 0,
              pivotY: 0,
              opacity: 1,
            },
          },
        ],
        keyframes: { x: [], y: [], rotation: [], scaleX: [], scaleY: [], opacity: [] },
        modifiers: [],
      };
      const ok = state.dispatchCommand(ProjectCommands.addLayer(comp.id, newLayer, 0));
      if (ok) {
        state.selectLayer(newLayerId, nextTarget);
        state.showFeedback('info', `Created lyrics layer with "${preset.name}"`);
      }
      return { ok, targetScope: 'lyrics' };
    }

    // 3. Camera or Layer non-destructive modifier preset
    const mod = animationPresetRegistry.createModifier(preset.id, fps, uid('mod'), {
      startFrame: 0,
      ...(options.overrides ?? {}),
    });
    if (!mod) {
      return { ok: false, error: `Could not instantiate preset "${preset.id}"` };
    }

    const isCameraTarget =
      options.targetScope === 'camera' ||
      (options.targetScope !== 'layer' && preset.category === 'camera');

    if (isCameraTarget) {
      const ok = state.dispatchCommand(ProjectCommands.addCameraModifier(comp.id, mod));
      if (ok) {
        set({ selectedModifierId: mod.id });
        state.showFeedback('info', `Applied camera preset "${preset.name}"`);
      }
      return { ok, modifierId: ok ? mod.id : undefined, targetScope: 'camera' };
    }

    const targetLayerId = options.layerId ?? state.selectedLayerId ?? undefined;
    const targetLayer = targetLayerId
      ? comp.layers.find((l) => l.id === targetLayerId) ?? null
      : null;

    if (!targetLayer) {
      const err = 'Select a layer first to apply this motion preset.';
      state.showFeedback('error', err);
      return { ok: false, error: err };
    }

    const ok = state.dispatchCommand(
      ProjectCommands.addLayerModifier(comp.id, targetLayer.id, mod)
    );
    if (ok) {
      set({ selectedModifierId: mod.id });
      state.showFeedback(
        'info',
        `Applied "${mod.label ?? preset.id}" to "${targetLayer.name}"`
      );
    }
    return { ok, modifierId: ok ? mod.id : undefined, targetScope: 'layer' };
  },

  applyMotionPreset: (presetId, options) => get().apply_motion_preset(presetId, options),

  updateMotionModifier: (modifierId, patch, options = {}) => {
    const state = get();
    const compId = options.compositionId ?? state.activeCompositionId;
    const targetScope =
      options.targetScope ?? (state.inspectorTarget === 'camera' ? 'camera' : 'layer');

    if (targetScope === 'camera') {
      return state.dispatchCommand(
        ProjectCommands.updateCameraModifier(compId, modifierId, patch)
      );
    }
    const targetLayerId = options.layerId ?? state.selectedLayerId;
    if (!targetLayerId) return false;
    return state.dispatchCommand(
      ProjectCommands.updateLayerModifier(compId, targetLayerId, modifierId, patch)
    );
  },

  removeMotionModifier: (modifierId, options = {}) => {
    const state = get();
    const compId = options.compositionId ?? state.activeCompositionId;
    const targetScope =
      options.targetScope ?? (state.inspectorTarget === 'camera' ? 'camera' : 'layer');

    let ok = false;
    if (targetScope === 'camera') {
      ok = state.dispatchCommand(ProjectCommands.removeCameraModifier(compId, modifierId));
    } else {
      const targetLayerId = options.layerId ?? state.selectedLayerId;
      if (!targetLayerId) return false;
      ok = state.dispatchCommand(
        ProjectCommands.removeLayerModifier(compId, targetLayerId, modifierId)
      );
    }

    if (ok && state.selectedModifierId === modifierId) {
      set({ selectedModifierId: null });
    }
    return ok;
  },

  setMcpBridgeStatus: (status) => set({ mcpBridgeStatus: status }),

  setMcpLogs: (logs) => set({ mcpLogs: logs.slice(0, 80) }),

  appendMcpLog: (entry) =>
    set((s) => ({
      mcpLogs: [entry, ...s.mcpLogs.filter((l) => l.id !== entry.id)].slice(0, 80),
    })),

  clearMcpLogs: () => set({ mcpLogs: [] }),

  applyRemoteMcpProject: (nextProject, label, revision, activeCompositionId) => {
    const state = get();
    const cmd: ProjectCommand = {
      id: uid('cmd'),
      label: label || 'MCP Update',
      affectedIds: [nextProject.id],
      execute: () => nextProject,
    };
    const res = commandManager.dispatch(state.project, cmd);
    if (!res.ok) {
      state.showFeedback('error', res.error);
      return;
    }

    const nextActiveComp =
      activeCompositionId && res.project.compositions.some((c) => c.id === activeCompositionId)
        ? activeCompositionId
        : res.project.compositions.some((c) => c.id === state.activeCompositionId)
          ? state.activeCompositionId
          : res.project.compositions[0].id;

    const compObj = res.project.compositions.find((c) => c.id === nextActiveComp)!;
    const nextSelectedLayer =
      state.selectedLayerId && compObj.layers.some((l) => l.id === state.selectedLayerId)
        ? state.selectedLayerId
        : compObj.layers[0]?.id ?? null;

    set({
      project: res.project,
      activeCompositionId: nextActiveComp,
      selectedLayerId: nextSelectedLayer,
      lastRemoteMcpRevision: revision,
      canUndo: commandManager.canUndo(),
      canRedo: commandManager.canRedo(),
      undoLabel: commandManager.getUndoLabel(),
      redoLabel: commandManager.getRedoLabel(),
    });
    state.showFeedback('info', `MCP applied: ${label}`);
    scheduleAutosave(res.project, set);
  },

  addExternalMcpServer: async (name, url, bearerToken) => {
    const cleanUrl = url.trim();
    if (!cleanUrl) return;
    const id = uid('mcp');
    const newServer: ExternalMcpServer = {
      id,
      name: name.trim() || cleanUrl,
      url: cleanUrl,
      bearerToken: bearerToken?.trim() || undefined,
      status: 'connecting',
      tools: [],
      resources: [],
      prompts: [],
    };
    const nextList = [...get().externalMcpServers, newServer];
    set({ externalMcpServers: nextList });
    saveStoredMcpServers(nextList);
    await get().connectExternalMcpServer(id);
  },

  connectExternalMcpServer: async (id) => {
    const server = get().externalMcpServers.find((s) => s.id === id);
    if (!server) return;

    set((s) => ({
      externalMcpServers: s.externalMcpServers.map((item) =>
        item.id === id ? { ...item, status: 'connecting', errorMessage: undefined } : item
      ),
    }));

    const start = performance.now();
    try {
      const handshake = await connectMcpServer(server.url, server.bearerToken);
      const updated = get().externalMcpServers.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'connected' as const,
              sessionId: handshake.sessionId,
              serverInfo: handshake.serverInfo,
              tools: handshake.tools,
              resources: handshake.resources,
              prompts: handshake.prompts,
              errorMessage: undefined,
              lastConnectedAt: new Date().toISOString(),
            }
          : item
      );
      set({ externalMcpServers: updated });
      saveStoredMcpServers(updated);
      get().appendMcpLog({
        id: uid('mcplog'),
        timestamp: new Date().toISOString(),
        direction: 'client',
        serverName: server.name,
        method: 'initialize',
        detail: `${handshake.tools.length} tools, ${handshake.resources.length} resources`,
        status: 'ok',
        durationMs: Math.round(performance.now() - start),
      });
      get().showFeedback('info', `Connected to MCP server "${server.name}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const updated = get().externalMcpServers.map((item) =>
        item.id === id ? { ...item, status: 'error' as const, errorMessage: msg } : item
      );
      set({ externalMcpServers: updated });
      saveStoredMcpServers(updated);
      get().appendMcpLog({
        id: uid('mcplog'),
        timestamp: new Date().toISOString(),
        direction: 'client',
        serverName: server.name,
        method: 'initialize',
        detail: msg,
        status: 'error',
        durationMs: Math.round(performance.now() - start),
      });
      get().showFeedback('error', `MCP connection failed: ${msg}`);
    }
  },

  removeExternalMcpServer: (id) => {
    const nextList = get().externalMcpServers.filter((s) => s.id !== id);
    set({ externalMcpServers: nextList });
    saveStoredMcpServers(nextList);
  },

  setShortcutsModalOpen: (open) => set({ shortcutsModalOpen: open }),
}));

export function formatTimecode(frame: number, fps = 24): string {
  const safeFps = Math.max(1, Math.round(fps));
  const totalSec = Math.floor(frame / safeFps);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const remFrames = frame % safeFps;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(remFrames).padStart(2, '0')}`;
}

export function getActiveCompFps(project: MotionProject, compId: string): number {
  const comp = project.compositions.find((c) => c.id === compId);
  if (!comp || comp.settings.inheritProjectFps) {
    return fpsToNumber(project.settings.fps);
  }
  return fpsToNumber(comp.settings.fps);
}

// Re-export ProjectCommands for convenient UI imports
export { ProjectCommands };
