import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Clapperboard,
  FolderOpen,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { parseMotionXArchive } from '../storage/IndexedDbStorage';
import { useStudioStore } from '../store/useStudioStore';
import { DEMO_TEMPLATES, type DemoTemplateId, type DemoTemplateInfo } from '../utils/demoProjects';

interface CanvasPresetOption {
  id: string;
  label: string;
  detail: string;
  width: number;
  height: number;
  fps: number;
}

const CANVAS_PRESETS: CanvasPresetOption[] = [
  { id: 'hd-24', label: '16:9 HD Cinema', detail: '1280×720 · 24 fps', width: 1280, height: 720, fps: 24 },
  { id: 'fhd-24', label: '16:9 Full HD', detail: '1920×1080 · 24 fps', width: 1920, height: 1080, fps: 24 },
  { id: 'vertical-30', label: '9:16 Vertical', detail: '720×1280 · 30 fps', width: 720, height: 1280, fps: 30 },
  { id: 'square-24', label: '1:1 Square', detail: '1080×1080 · 24 fps', width: 1080, height: 1080, fps: 24 },
];

function formatProjectDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Saved locally';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const DemoThumbnail: React.FC<{ template: DemoTemplateInfo }> = ({ template }) => {
  return (
    <div
      className="relative w-full aspect-video overflow-hidden border-b border-white/8"
      style={{
        background: `linear-gradient(180deg, ${template.accentFrom} 0%, ${template.accentTo} 100%)`,
      }}
    >
      {template.id === 'lost-kingdom' && (
        <svg viewBox="0 0 320 180" className="w-full h-full" aria-hidden="true">
          <path
            d="M0 180 L0 118 L52 78 L108 114 L168 58 L230 108 L276 72 L320 104 L320 180 Z"
            fill="#1E293B"
            opacity="0.88"
          />
          <path
            d="M0 180 L0 140 L48 124 L94 146 L154 118 L216 144 L268 120 L320 138 L320 180 Z"
            fill="#0F172A"
          />
          <circle cx="242" cy="54" r="2.2" fill="#FDE047" opacity="0.85" />
          <circle cx="88" cy="48" r="1.8" fill="#7DD3FC" opacity="0.7" />
          <circle cx="192" cy="88" r="2" fill="#FDE047" opacity="0.8" />
          <rect x="118" y="106" width="12" height="32" rx="3" fill="#2563EB" />
          <circle cx="124" cy="98" r="7" fill="#1D4ED8" />
          <circle cx="136" cy="96" r="3.5" fill="#F59E0B" />
        </svg>
      )}

      {template.id === 'sakura-portrait' && (
        <svg viewBox="0 0 320 180" className="w-full h-full" aria-hidden="true">
          <path
            d="M174 52 C214 48, 240 82, 232 126 C228 148, 242 164, 250 176 L192 172 Z"
            fill="#1E1B4B"
            opacity="0.9"
          />
          <path
            d="M136 102 C128 134, 126 160, 132 180 L198 180 C204 160, 202 134, 194 102 Z"
            fill="#334155"
          />
          <circle cx="165" cy="70" r="18" fill="#FDE68A" opacity="0.9" />
          <path
            d="M178 96 C210 86, 244 108, 276 92 C258 112, 224 118, 180 108 Z"
            fill="#E11D48"
          />
          <ellipse cx="64" cy="52" rx="4" ry="2.2" transform="rotate(-24 64 52)" fill="#F9A8D4" />
          <ellipse cx="104" cy="84" rx="3.5" ry="2" transform="rotate(18 104 84)" fill="#FBCFE8" />
          <ellipse cx="268" cy="58" rx="4" ry="2.2" transform="rotate(28 268 58)" fill="#F9A8D4" />
        </svg>
      )}

      {template.id === 'lyric-beat-stage' && (
        <svg viewBox="0 0 320 180" className="w-full h-full" aria-hidden="true">
          <ellipse cx="160" cy="142" rx="126" ry="20" fill="#38BDF8" opacity="0.16" />
          <line x1="24" y1="142" x2="296" y2="142" stroke="#7DD3FC" strokeOpacity="0.4" strokeWidth="1.5" />
          <rect x="78" y="76" width="164" height="8" rx="4" fill="#38BDF8" opacity="0.85" />
          <rect x="102" y="94" width="116" height="6" rx="3" fill="#CBD5E1" opacity="0.45" />
          <g fill="#60A5FA" opacity="0.55">
            <rect x="116" y="122" width="4" height="14" rx="2" />
            <rect x="128" y="114" width="4" height="22" rx="2" />
            <rect x="140" y="118" width="4" height="18" rx="2" />
            <rect x="152" y="109" width="4" height="27" rx="2" />
            <rect x="164" y="116" width="4" height="20" rx="2" />
            <rect x="176" y="112" width="4" height="24" rx="2" />
            <rect x="188" y="120" width="4" height="16" rx="2" />
            <rect x="200" y="124" width="4" height="12" rx="2" />
          </g>
        </svg>
      )}
    </div>
  );
};

export const HomeWorkspace: React.FC = () => {
  const {
    project,
    savedProjects,
    isProjectsLoading,
    createNewProject,
    loadProjectById,
    openDemoProject,
    deleteSavedProject,
    importLoadedProject,
    setWorkspace,
    showFeedback,
  } = useStudioStore();

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState<string>(CANVAS_PRESETS[0].id);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [openingDemoId, setOpeningDemoId] = useState<DemoTemplateId | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedPreset =
    CANVAS_PRESETS.find((p) => p.id === selectedPresetId) ?? CANVAS_PRESETS[0];

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return savedProjects;
    return savedProjects.filter((sp) => sp.name.toLowerCase().includes(q));
  }, [savedProjects, searchQuery]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    await createNewProject(newProjectName.trim() || 'Untitled Movie', {
      width: selectedPreset.width,
      height: selectedPreset.height,
      fps: selectedPreset.fps,
    });
    setNewProjectName('');
    setNewProjectOpen(false);
  };

  const handleOpenDemo = async (demoId: DemoTemplateId) => {
    setOpeningDemoId(demoId);
    try {
      await openDemoProject(demoId);
    } finally {
      setOpeningDemoId(null);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseMotionXArchive(text);
      if (!parsed.success) {
        showFeedback('error', parsed.error);
        return;
      }
      await importLoadedProject(parsed.project);
    } catch {
      showFeedback('error', 'Could not read project archive file');
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#111317] text-slate-100">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
        {/* Hero / Entry Header */}
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-5 pb-6 border-b border-white/10">
          <div className="space-y-1.5 max-w-2xl">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-50 text-balance">
              Motion Studio
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Start a blank composition, resume recent projects stored locally in IndexedDB, or open a pre-configured demo scene.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".motionx,.json,application/json"
              onChange={(e) => void handleImportFile(e)}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => setWorkspace('composition')}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-[#181B20] hover:bg-[#22262E] border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
            >
              <Clapperboard className="w-3.5 h-3.5 text-slate-400" />
              <span className="truncate max-w-[160px]">Resume: {project.name}</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-[#181B20] hover:bg-[#22262E] border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-slate-400" />
              <span>Import .motionx</span>
            </button>

            <button
              type="button"
              onClick={() => setNewProjectOpen((open) => !open)}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>New Project</span>
            </button>
          </div>
        </section>

        {/* Inline New Project Builder */}
        {newProjectOpen && (
          <section
            aria-label="New Project Configuration"
            className="p-5 rounded-xl bg-[#181B20] border border-white/10 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-100">
                  Create Blank Project
                </h2>
                <p className="text-xs text-slate-400">
                  Choose a title and target canvas format. All settings remain editable later.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNewProjectOpen(false)}
                className="min-h-[36px] px-3 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-100 hover:bg-white/5 whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateProject(e)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <label className="md:col-span-5 block space-y-1.5">
                  <span className="text-xs font-medium text-slate-300">Project Title</span>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="Untitled Movie"
                    autoFocus
                    className="w-full min-h-[40px] px-3 rounded-lg bg-[#111317] border border-white/12 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </label>

                <div className="md:col-span-5 space-y-1.5">
                  <span className="text-xs font-medium text-slate-300 block">Canvas Format</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {CANVAS_PRESETS.map((preset) => {
                      const active = preset.id === selectedPreset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setSelectedPresetId(preset.id)}
                          className={`min-h-[40px] px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
                            active
                              ? 'bg-blue-600/20 border-blue-500 text-slate-100'
                              : 'bg-[#111317] border-white/10 text-slate-300 hover:border-white/20'
                          }`}
                        >
                          <div className="text-[11px] font-medium truncate">{preset.label}</div>
                          <div className="text-[10px] font-mono tabular-nums text-slate-400 truncate">
                            {preset.width}×{preset.height}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <button
                    type="submit"
                    className="w-full min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create</span>
                  </button>
                </div>
              </div>
            </form>
          </section>
        )}

        {/* Demo Templates Section */}
        <section aria-labelledby="demo-section-heading" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
            <h2
              id="demo-section-heading"
              className="font-display text-base font-semibold text-slate-100"
            >
              Demo Templates
            </h2>
            <p className="text-xs text-slate-400">
              Pre-configured scenes with parallax layers, non-destructive modifiers, lyrics, and audio
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {DEMO_TEMPLATES.map((template) => {
              const isLoadingThis = openingDemoId === template.id;
              return (
                <article
                  key={template.id}
                  className="rounded-xl bg-[#181B20] border border-white/10 overflow-hidden flex flex-col justify-between"
                >
                  <div>
                    <DemoThumbnail template={template} />
                    <div className="p-4 space-y-2">
                      <h3 className="font-display text-sm font-semibold text-slate-100">
                        {template.title}
                      </h3>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {template.subtitle}
                      </p>
                      <div className="pt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono tabular-nums text-slate-400">
                        <span>{template.resolution}</span>
                        <span aria-hidden="true">·</span>
                        <span>{template.fps} fps</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {template.compositionCount}{' '}
                          {template.compositionCount === 1 ? 'comp' : 'comps'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{template.durationSec}s</span>
                      </div>
                      <p className="text-[11px] text-slate-500">{template.highlights}</p>
                    </div>
                  </div>

                  <div className="px-4 pb-4 pt-1">
                    <button
                      type="button"
                      disabled={openingDemoId !== null}
                      onClick={() => void handleOpenDemo(template.id)}
                      className="w-full min-h-[40px] px-4 py-2 rounded-lg bg-[#20242B] hover:bg-blue-600 text-slate-100 hover:text-white border border-white/10 hover:border-blue-500 text-xs font-medium flex items-center justify-center gap-2 whitespace-nowrap transition-colors disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{isLoadingThis ? 'Opening Demo...' : 'Open Demo'}</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Recent Projects (IndexedDB) Section */}
        <section aria-labelledby="recent-projects-heading" className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <h2
                id="recent-projects-heading"
                className="font-display text-base font-semibold text-slate-100"
              >
                Recent Projects
              </h2>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                {savedProjects.length} saved in browser
              </span>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search saved projects..."
                aria-label="Search saved projects"
                className="w-full min-h-[38px] pl-8 pr-3 rounded-lg bg-[#181B20] border border-white/10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="rounded-xl bg-[#181B20] border border-white/10 overflow-hidden">
            {isProjectsLoading ? (
              <div className="divide-y divide-white/8" aria-label="Loading saved projects">
                {[0, 1, 2].map((row) => (
                  <div
                    key={row}
                    className="px-4 py-3.5 flex items-center justify-between gap-4 animate-pulse"
                  >
                    <div className="space-y-2 flex-1">
                      <div className="h-3.5 w-44 rounded bg-white/10" />
                      <div className="h-2.5 w-32 rounded bg-white/5" />
                    </div>
                    <div className="h-9 w-20 rounded-lg bg-white/8" />
                  </div>
                ))}
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="px-6 py-10 text-center space-y-3">
                <p className="text-sm font-medium text-slate-200">
                  {savedProjects.length === 0
                    ? 'No saved projects in IndexedDB yet'
                    : 'No matching projects found'}
                </p>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  {savedProjects.length === 0
                    ? 'Create a blank project or open one of the demo templates above to save your work automatically in local browser storage.'
                    : `No saved projects match "${searchQuery.trim()}".`}
                </p>
                <div>
                  {savedProjects.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => setNewProjectOpen(true)}
                      className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Create First Project</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="min-h-[40px] px-4 py-2 rounded-lg bg-[#20242B] hover:bg-[#272C35] border border-white/10 text-slate-200 text-xs font-medium inline-flex items-center whitespace-nowrap transition-colors"
                    >
                      Clear Search
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-white/8">
                {filteredProjects.map((sp) => {
                  const isCurrent = sp.id === project.id;
                  const isConfirmingDelete = confirmDeleteId === sp.id;
                  return (
                    <li
                      key={sp.id}
                      className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-slate-100 truncate">
                            {sp.name}
                          </span>
                          {isCurrent && (
                            <span className="text-xs font-medium text-blue-400 shrink-0">
                              · Active
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-400 font-mono tabular-nums">
                          <span>
                            {sp.compositionCount}{' '}
                            {sp.compositionCount === 1 ? 'composition' : 'compositions'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>Updated {formatProjectDate(sp.updatedAt)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isConfirmingDelete ? (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                await deleteSavedProject(sp.id);
                                setConfirmDeleteId(null);
                              }}
                              className="min-h-[38px] px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
                            >
                              Confirm Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#20242B] hover:bg-[#2A2F38] border border-white/10 text-slate-300 text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => void loadProjectById(sp.id)}
                              className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#20242B] hover:bg-blue-600 border border-white/10 hover:border-blue-500 text-slate-100 hover:text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                              <span>Open</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(sp.id)}
                              aria-label={`Delete ${sp.name}`}
                              title="Delete saved project"
                              className="h-[38px] w-[38px] rounded-lg bg-[#20242B] hover:bg-red-500/15 border border-white/10 hover:border-red-500/40 text-slate-400 hover:text-red-300 flex items-center justify-center shrink-0 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="px-4 py-3 rounded-xl bg-[#181B20]/70 border border-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400">
            <span>
              Want to create a portable <code className="text-amber-300">.motionx</code> archive to back up or share a project? Open <strong className="font-medium text-slate-200">Export</strong> &rarr; <strong className="font-medium text-slate-200">Portable Archive (.motionx)</strong> &rarr; <strong className="font-medium text-slate-200">Export .motionx</strong>.
            </span>
            <button
              type="button"
              onClick={() => setWorkspace('export')}
              className="min-h-[34px] px-3 rounded-lg bg-[#20242B] hover:bg-[#2A2F38] border border-white/10 text-[11px] font-medium text-slate-200 whitespace-nowrap shrink-0 self-start sm:self-auto transition-colors"
            >
              Go to Export (.motionx)
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
