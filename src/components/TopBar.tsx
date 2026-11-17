import React, { useState } from 'react';
import {
  Check,
  Clapperboard,
  Download,
  Film,
  FolderOpen,
  HelpCircle,
  Home,
  Layers,
  Loader2,
  Plug,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Undo2,
  Users,
  Volume2,
  VolumeX,
  Image as ImageIcon,
} from 'lucide-react';
import { ProjectCommands } from '../commands/projectCommands';
import { useStudioStore, WorkspaceTab } from '../store/useStudioStore';

const WORKSPACE_TABS: { id: WorkspaceTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'composition', label: 'Composition', icon: Layers },
  { id: 'movie', label: 'Movie Timeline', icon: Film },
  { id: 'assets', label: 'Assets', icon: ImageIcon },
  { id: 'characters', label: 'Characters', icon: Users },
  { id: 'export', label: 'Export', icon: Download },
  { id: 'mcp', label: 'MCP', icon: Plug },
];

export const TopBar: React.FC = () => {
  const {
    project,
    savedProjects,
    saveStatus,
    workspace,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    masterMuted,
    setWorkspace,
    undo,
    redo,
    saveNow,
    toggleMute,
    loadProjectById,
    createNewProject,
    dispatchCommand,
    setShortcutsModalOpen,
  } = useStudioStore();

  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(project.name);

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (renameDraft.trim()) {
      dispatchCommand(ProjectCommands.renameProject(renameDraft));
    }
    setRenaming(false);
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    await createNewProject(newProjectName || 'Untitled Movie');
    setNewProjectName('');
    setProjectMenuOpen(false);
  };

  return (
    <header className="relative z-40 flex items-center justify-between gap-2 px-3 h-12 bg-[#181B20] border-b border-white/8 shrink-0">
      {/* Zone 1: Brand & Project Selector */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        <button
          type="button"
          onClick={() => setWorkspace('home')}
          className="flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg py-0.5 pr-1 hover:opacity-90 transition-opacity"
          title="Go to Home"
        >
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white">
            <Clapperboard className="w-3.5 h-3.5" />
          </div>
          <span className="hidden md:inline font-display font-semibold text-xs tracking-tight text-slate-100">
            Motion Studio
          </span>
        </button>

        <span className="hidden md:inline text-white/20 text-xs">/</span>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setRenameDraft(project.name);
              setProjectMenuOpen((v) => !v);
            }}
            className="min-h-[36px] px-2.5 py-1 rounded-lg bg-[#20242B] hover:bg-[#272C35] border border-white/8 flex items-center gap-1.5 text-xs font-medium text-slate-100 transition-colors max-w-[140px] sm:max-w-[200px]"
            title="Switch or manage Projects"
          >
            <FolderOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{project.name}</span>
          </button>

          {projectMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setProjectMenuOpen(false)}
              />
              <div className="absolute left-0 mt-2 w-80 rounded-xl bg-[#1E2229] border border-white/12 shadow-2xl p-3 z-50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">Current Project</span>
                  <button
                    type="button"
                    onClick={() => {
                      setRenameDraft(project.name);
                      setRenaming((r) => !r);
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1"
                  >
                    {renaming ? 'Cancel' : 'Rename'}
                  </button>
                </div>

                {renaming ? (
                  <form onSubmit={handleRenameSubmit} className="flex gap-2">
                    <input
                      type="text"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      className="flex-1 min-w-0 px-2.5 py-2 text-xs rounded-lg bg-[#111317] border border-white/12 text-slate-100 focus:outline-none focus:border-blue-500"
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium whitespace-nowrap"
                    >
                      Save
                    </button>
                  </form>
                ) : (
                  <div className="text-sm font-semibold text-slate-100 truncate">
                    {project.name}
                  </div>
                )}

                <div className="border-t border-white/8 pt-2">
                  <div className="text-xs font-medium text-slate-400 mb-2">
                    Saved Projects ({savedProjects.length})
                  </div>
                  <div className="max-h-44 overflow-y-auto space-y-1">
                    {savedProjects.map((sp) => (
                      <button
                        key={sp.id}
                        type="button"
                        onClick={async () => {
                          await loadProjectById(sp.id);
                          setProjectMenuOpen(false);
                        }}
                        className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 text-xs transition-colors min-h-[40px] ${
                          sp.id === project.id
                            ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                            : 'hover:bg-white/5 text-slate-300'
                        }`}
                      >
                        <span className="truncate font-medium">{sp.name}</span>
                        <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                          {sp.compositionCount} comps
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleCreateProject} className="border-t border-white/8 pt-2.5 flex gap-2">
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="New movie project..."
                    className="flex-1 min-w-0 px-2.5 py-2 text-xs rounded-lg bg-[#111317] border border-white/12 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Zone 2: Workspace Switcher (horizontally scrollable on narrow viewports) */}
      <nav
        aria-label="Workspaces"
        className="flex items-center gap-0.5 p-0.5 rounded-xl bg-[#111317] border border-white/8 overflow-x-auto no-scrollbar max-w-full"
      >
        {WORKSPACE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = workspace === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setWorkspace(tab.id)}
              className={`min-h-[32px] px-2 sm:px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-white/5'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Undo, Redo, Audio & Save */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          title={undoLabel ? `Undo: ${undoLabel}` : 'Nothing to undo'}
          aria-label="Undo"
          className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/8 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <Undo2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          title={redoLabel ? `Redo: ${redoLabel}` : 'Nothing to redo'}
          aria-label="Redo"
          className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/8 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <Redo2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={toggleMute}
          title={masterMuted ? 'Unmute audio' : 'Mute audio'}
          aria-label={masterMuted ? 'Unmute audio' : 'Mute audio'}
          className={`h-9 w-9 rounded-lg flex items-center justify-center transition-colors ${
            masterMuted
              ? 'text-amber-400 bg-amber-500/10'
              : 'text-slate-300 hover:bg-white/8'
          }`}
        >
          {masterMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={() => setShortcutsModalOpen(true)}
          title="Keyboard Shortcuts (?)"
          aria-label="Keyboard Shortcuts"
          className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/8 transition-colors"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => void saveNow()}
          title="Save project locally to IndexedDB (Ctrl/Cmd+S)"
          className="h-9 px-2.5 rounded-lg bg-[#20242B] hover:bg-[#2A2F38] border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
        >
          {saveStatus === 'saving' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
          ) : saveStatus === 'saved' ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Save className="w-3.5 h-3.5 text-amber-400" />
          )}
          <span className="hidden lg:inline">
            {saveStatus === 'saving' ? 'Saving' : saveStatus === 'saved' ? 'Saved' : 'Save'}
          </span>
        </button>
      </div>
    </header>
  );
};

// Keep unused icon import warning away if needed
void Sparkles;
