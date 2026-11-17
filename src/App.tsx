import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Layers,
  PanelLeftClose,
  PanelRightClose,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { WebAudioEngine } from './audio/WebAudioEngine';
import { AssetLibraryWorkspace } from './components/AssetLibraryWorkspace';
import { CharacterStudioWorkspace } from './components/CharacterStudioWorkspace';
import { CompositionStage } from './components/CompositionStage';
import { CompositionTimeline } from './components/CompositionTimeline';
import { ExportWorkspace } from './components/ExportWorkspace';
import { HomeWorkspace } from './components/HomeWorkspace';
import { InspectorPanel } from './components/InspectorPanel';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { LayersPanel } from './components/LayersPanel';
import { McpWorkspace } from './components/McpWorkspace';
import { ProjectTimelineWorkspace } from './components/ProjectTimelineWorkspace';
import { TopBar } from './components/TopBar';
import { getProjectMovieDurationFrames } from './engine/evaluator';
import type { MotionProject } from './schema/projectSchema';
import { getActiveCompFps, useStudioStore, WorkspaceTab } from './store/useStudioStore';

export default function App() {
  const {
    project,
    workspace,
    activeCompositionId,
    isPlaying,
    loopPlayback,
    masterMuted,
    feedbackMessage,
    initPersistence,
    setCurrentFrame,
    setIsPlaying,
    stepFrame,
    undo,
    redo,
    clearFeedback,
    setMcpBridgeStatus,
    setMcpLogs,
    appendMcpLog,
    applyRemoteMcpProject,
  } = useStudioStore();

  const audioEngine = useMemo(() => new WebAudioEngine(), []);

  // Desktop / Tablet Landscape side-panel open state
  const [desktopLeftOpen, setDesktopLeftOpen] = useState(true);
  const [desktopRightOpen, setDesktopRightOpen] = useState(true);

  // Mobile / Tablet Portrait slide-over drawer state
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'layers' | 'inspector'>('none');

  // Initialize IndexedDB persistence on mount
  useEffect(() => {
    void initPersistence();
    return () => {
      audioEngine.dispose();
    };
  }, [initPersistence, audioEngine]);

  const lastSyncedProjectRef = useRef<MotionProject | null>(null);
  const remoteReceivedProjectRef = useRef<MotionProject | null>(null);

  // Connect real-time SSE bridge to Express MCP Server
  useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;
    let retryTimer: number | null = null;

    const connectBridge = () => {
      if (closed) return;
      setMcpBridgeStatus('connecting');
      es = new EventSource('/api/mcp/events');

      es.addEventListener('open', () => {
        setMcpBridgeStatus('connected');
      });

      es.addEventListener('init', (ev: MessageEvent) => {
        setMcpBridgeStatus('connected');
        try {
          const data = JSON.parse(ev.data);
          if (Array.isArray(data.logs)) {
            setMcpLogs(data.logs);
          }
        } catch {
          // Ignore malformed init payload
        }
      });

      es.addEventListener('project_updated', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.source === 'mcp' && data.project) {
            remoteReceivedProjectRef.current = data.project as MotionProject;
            applyRemoteMcpProject(
              data.project,
              data.label || 'MCP Update',
              typeof data.revision === 'number' ? data.revision : Date.now(),
              data.activeCompositionId
            );
          }
        } catch {
          // Ignore malformed update payload
        }
      });

      es.addEventListener('mcp_log', (ev: MessageEvent) => {
        try {
          const entry = JSON.parse(ev.data);
          if (entry && entry.id) {
            appendMcpLog(entry);
          }
        } catch {
          // Ignore malformed log payload
        }
      });

      es.onerror = () => {
        setMcpBridgeStatus('disconnected');
        es?.close();
        if (!closed) {
          retryTimer = window.setTimeout(connectBridge, 3000);
        }
      };
    };

    connectBridge();
    return () => {
      closed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      es?.close();
    };
  }, [setMcpBridgeStatus, setMcpLogs, appendMcpLog, applyRemoteMcpProject]);

  // Push local studio project snapshots to MCP server (debounced, skipping remote-echo updates)
  useEffect(() => {
    if (remoteReceivedProjectRef.current === project) {
      lastSyncedProjectRef.current = project;
      return;
    }
    if (lastSyncedProjectRef.current === project) return;
    lastSyncedProjectRef.current = project;
    const timer = window.setTimeout(() => {
      void fetch('/api/mcp/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, activeCompositionId }),
      }).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [project, activeCompositionId]);

  const activeComp =
    project.compositions.find((c) => c.id === activeCompositionId) ?? project.compositions[0];
  const compFps = getActiveCompFps(project, activeComp.id);

  // Composition playback loop + synchronized Web Audio playback
  useEffect(() => {
    if (workspace !== 'composition') {
      audioEngine.stopAll();
      return;
    }

    if (!isPlaying) {
      audioEngine.stopAll();
      return;
    }

    const startFrame = useStudioStore.getState().currentFrame;
    void audioEngine.startPlayback(
      activeComp.audioTracks,
      project.assets,
      startFrame,
      compFps,
      masterMuted
    );

    let rafId = 0;
    let last = performance.now();
    let acc = 0;
    const frameMs = 1000 / compFps;
    const maxFrames = activeComp.settings.durationFrames;

    const tick = (now: number) => {
      acc += now - last;
      last = now;
      if (acc >= frameMs) {
        const steps = Math.floor(acc / frameMs);
        acc -= steps * frameMs;
        const next = useStudioStore.getState().currentFrame + steps;
        if (next >= maxFrames) {
          if (loopPlayback) {
            setCurrentFrame(0);
            void audioEngine.startPlayback(
              activeComp.audioTracks,
              project.assets,
              0,
              compFps,
              masterMuted
            );
          } else {
            setCurrentFrame(maxFrames - 1);
            setIsPlaying(false);
            return;
          }
        } else {
          setCurrentFrame(next);
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      audioEngine.stopAll();
    };
  }, [
    isPlaying,
    workspace,
    compFps,
    activeComp.id,
    activeComp.settings.durationFrames,
    activeComp.audioTracks,
    project.assets,
    loopPlayback,
    masterMuted,
    audioEngine,
    setCurrentFrame,
    setIsPlaying,
  ]);

  // Global keyboard shortcuts (respecting focused inputs)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      const store = useStudioStore.getState();

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (isInput) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        if (isInput) return;
        e.preventDefault();
        redo();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void store.saveNow();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        if (isInput) return;
        const selection = window.getSelection()?.toString();
        if (!selection && store.workspace === 'composition' && store.selectedLayerId) {
          e.preventDefault();
          store.copyKeyframesAtCurrentFrame();
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        if (isInput) return;
        if (store.workspace === 'composition' && store.copiedKeyframes && store.selectedLayerId) {
          e.preventDefault();
          store.pasteKeyframesAtCurrentFrame();
        }
        return;
      }

      if (isInput || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        store.setShortcutsModalOpen(!store.shortcutsModalOpen);
        return;
      }

      if (store.shortcutsModalOpen) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(!store.isPlaying);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepFrame(e.shiftKey ? -10 : -1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepFrame(e.shiftKey ? 10 : 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        if (store.workspace === 'movie') store.setMovieFrame(0);
        else setCurrentFrame(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        if (store.workspace === 'movie') {
          store.setMovieFrame(Math.max(0, getProjectMovieDurationFrames(store.project) - 1));
        } else {
          const comp =
            store.project.compositions.find((c) => c.id === store.activeCompositionId) ??
            store.project.compositions[0];
          setCurrentFrame(Math.max(0, comp.settings.durationFrames - 1));
        }
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        store.toggleLoop();
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        store.toggleMute();
      } else if (e.key.toLowerCase() === 'v') {
        e.preventDefault();
        store.setActiveTool('select');
      } else if (e.key.toLowerCase() === 'h') {
        e.preventDefault();
        store.setActiveTool('pan');
      } else if (e.key.toLowerCase() === 'g') {
        e.preventDefault();
        store.toggleGuides();
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        store.toggleMotionPath();
      } else if (['1', '2', '3', '4', '5', '6', '7'].includes(e.key)) {
        const tabs: WorkspaceTab[] = ['home', 'composition', 'movie', 'assets', 'characters', 'export', 'mcp'];
        const targetTab = tabs[Number(e.key) - 1];
        if (targetTab) {
          e.preventDefault();
          store.setWorkspace(targetTab);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, setIsPlaying, stepFrame, setCurrentFrame]);

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-[#111317] text-[#F1F3F6] overflow-hidden">
      <TopBar />

      {/* Transient Feedback / Validation Banner */}
      {feedbackMessage && (
        <div
          role="status"
          className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl border shadow-2xl flex items-center gap-2.5 text-xs font-medium max-w-[92vw] ${
            feedbackMessage.type === 'error'
              ? 'bg-red-950/95 border-red-500/50 text-red-100'
              : 'bg-[#1E2229]/95 border-blue-500/40 text-slate-100'
          }`}
        >
          {feedbackMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
          )}
          <span className="truncate">{feedbackMessage.text}</span>
          <button
            type="button"
            onClick={clearFeedback}
            aria-label="Dismiss message"
            className="p-1 text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Active Workspace View */}
      {workspace === 'composition' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 flex relative overflow-hidden">
            {/* Desktop/Landscape Left Panel: Layers & Compositions */}
            {desktopLeftOpen && (
              <aside className="hidden lg:flex w-60 shrink-0 border-r border-white/10 flex-col overflow-hidden">
                <div className="h-8 px-2.5 bg-[#14171C] border-b border-white/8 flex items-center justify-between shrink-0">
                  <span className="text-[11px] font-semibold text-slate-400">
                    Composition & Layers
                  </span>
                  <button
                    type="button"
                    onClick={() => setDesktopLeftOpen(false)}
                    title="Collapse Layers Panel"
                    className="p-1 rounded hover:bg-white/8 text-slate-400 hover:text-white"
                  >
                    <PanelLeftClose className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <LayersPanel />
                </div>
              </aside>
            )}

            {/* Central Stage */}
            <main className="flex-1 min-w-0 min-h-0 flex flex-col relative">
              {/* Top-left toggle only when panel is hidden or on tablet portrait */}
              {!desktopLeftOpen && (
                <button
                  type="button"
                  onClick={() => setDesktopLeftOpen(true)}
                  className="hidden lg:flex absolute top-2.5 left-14 z-20 min-h-[36px] px-2.5 rounded-xl bg-[#181B20]/90 backdrop-blur-md border border-white/10 text-xs font-medium text-slate-200 items-center gap-1.5 shadow-lg hover:bg-[#22262E]"
                >
                  <Layers className="w-3.5 h-3.5 text-blue-400" />
                  Layers
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  setMobileDrawer((d) => (d === 'layers' ? 'none' : 'layers'))
                }
                className="lg:hidden absolute top-2.5 left-14 z-20 min-h-[38px] px-2.5 rounded-xl bg-[#181B20]/90 backdrop-blur-md border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5 shadow-lg"
              >
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                Layers
              </button>

              {/* Top-right Inspector toggle (completely unobstructed since zoom moved to bottom-right) */}
              {!desktopRightOpen && (
                <button
                  type="button"
                  onClick={() => setDesktopRightOpen(true)}
                  className="hidden lg:flex absolute top-2.5 right-2.5 z-20 min-h-[36px] px-2.5 rounded-xl bg-[#181B20]/90 backdrop-blur-md border border-white/10 text-xs font-medium text-slate-200 items-center gap-1.5 shadow-lg hover:bg-[#22262E]"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                  Inspector
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  setMobileDrawer((d) => (d === 'inspector' ? 'none' : 'inspector'))
                }
                className="lg:hidden absolute top-2.5 right-2.5 z-20 min-h-[38px] px-2.5 rounded-xl bg-[#181B20]/90 backdrop-blur-md border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5 shadow-lg"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                Inspect
              </button>

              <CompositionStage />
            </main>

            {/* Desktop/Landscape Right Panel: Contextual Inspector */}
            {desktopRightOpen && (
              <aside className="hidden lg:flex w-64 shrink-0 border-l border-white/10 flex-col overflow-hidden">
                <div className="h-8 px-2.5 bg-[#14171C] border-b border-white/8 flex items-center justify-between shrink-0">
                  <span className="text-[11px] font-semibold text-slate-400">Inspector</span>
                  <button
                    type="button"
                    onClick={() => setDesktopRightOpen(false)}
                    title="Collapse Inspector"
                    className="p-1 rounded hover:bg-white/8 text-slate-400 hover:text-white"
                  >
                    <PanelRightClose className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <InspectorPanel />
                </div>
              </aside>
            )}

            {/* Tablet Portrait / Compact Slide-Over Drawers */}
            {mobileDrawer !== 'none' && (
              <div className="lg:hidden fixed inset-0 z-50 flex">
                {mobileDrawer === 'layers' && (
                  <>
                    <div className="w-80 max-w-[86vw] h-full bg-[#181B20] border-r border-white/12 shadow-2xl flex flex-col">
                      <div className="h-12 px-3 border-b border-white/10 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-200">
                          Compositions & Layers
                        </span>
                        <button
                          type="button"
                          onClick={() => setMobileDrawer('none')}
                          aria-label="Close Layers Drawer"
                          className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-slate-300"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden">
                        <LayersPanel />
                      </div>
                    </div>
                    <div
                      className="flex-1 bg-black/50 backdrop-blur-[2px]"
                      onClick={() => setMobileDrawer('none')}
                    />
                  </>
                )}

                {mobileDrawer === 'inspector' && (
                  <>
                    <div
                      className="flex-1 bg-black/50 backdrop-blur-[2px]"
                      onClick={() => setMobileDrawer('none')}
                    />
                    <div className="w-80 max-w-[88vw] h-full bg-[#181B20] border-l border-white/12 shadow-2xl flex flex-col">
                      <div className="h-12 px-3 border-b border-white/10 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-200">Inspector</span>
                        <button
                          type="button"
                          onClick={() => setMobileDrawer('none')}
                          aria-label="Close Inspector Drawer"
                          className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-slate-300"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden">
                        <InspectorPanel />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Collapsible & Resizable Bottom Composition Timeline */}
          <CompositionTimeline audioEngine={audioEngine} />
        </div>
      )}

      {workspace === 'home' && <HomeWorkspace />}
      {workspace === 'movie' && <ProjectTimelineWorkspace />}
      {workspace === 'assets' && <AssetLibraryWorkspace />}
      {workspace === 'characters' && <CharacterStudioWorkspace />}
      {workspace === 'export' && <ExportWorkspace />}
      {workspace === 'mcp' && <McpWorkspace />}
      <KeyboardShortcutsModal />
    </div>
  );
}
