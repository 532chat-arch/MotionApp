import React, { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Archive,
  BookmarkPlus,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  HelpCircle,
  Layers,
  Music,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { ProjectCommands } from '../commands/projectCommands';
import {
  fpsToNumber,
  LayerDocument,
  MotionModifierDirection,
  MotionModifierInstance,
  PivotAnchorPreset,
} from '../schema/projectSchema';
import {
  AnimationPresetRegistry,
  animationPresetRegistry,
  MotionPresetDefinition,
  PresetCategory,
} from '../services/AnimationPresetRegistry';
import { serializeMotionXArchive } from '../storage/IndexedDbStorage';
import { useStudioStore } from '../store/useStudioStore';
import { LyricsStudioModal } from './LyricsStudioModal';
import { PresetHoverPreview } from './PresetHoverPreview';

function downloadJsonFile(filename: string, jsonText: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([jsonText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

interface MotionModifierStackProps {
  compositionId: string;
  targetScope: 'layer' | 'camera';
  layerId?: string;
  modifiers: MotionModifierInstance[];
  title?: string;
  emptyMessage?: string;
  showEmpty?: boolean;
  onOpenPresets?: () => void;
}

export const MotionModifierStack: React.FC<MotionModifierStackProps> = ({
  compositionId,
  targetScope,
  layerId,
  modifiers,
  title,
  emptyMessage,
  showEmpty = true,
  onOpenPresets,
}) => {
  const {
    project,
    selectedModifierId,
    setSelectedModifierId,
    isPlaying,
    setIsPlaying,
    updateMotionModifier,
    removeMotionModifier,
    dispatchCommand,
    showFeedback,
  } = useStudioStore();

  const [savingModifierId, setSavingModifierId] = useState<string | null>(null);
  const [customPresetName, setCustomPresetName] = useState('');

  useSyncExternalStore(
    (listener) => animationPresetRegistry.subscribe(listener),
    () => animationPresetRegistry.getRevision(),
    () => animationPresetRegistry.getRevision()
  );

  const compFps = useMemo(() => {
    const comp = project.compositions.find((c) => c.id === compositionId);
    if (!comp) return fpsToNumber(project.settings.fps);
    return comp.settings.inheritProjectFps
      ? fpsToNumber(project.settings.fps)
      : fpsToNumber(comp.settings.fps);
  }, [project, compositionId]);

  const hasEnabledModifiers = modifiers.some((m) => m.enabled);

  if (modifiers.length === 0 && !showEmpty) {
    return null;
  }

  const handleBake = () => {
    if (targetScope === 'camera') {
      dispatchCommand(ProjectCommands.bakeCameraModifiersToKeyframes(compositionId, 6));
      showFeedback('info', 'Baked camera motion presets to timeline keyframes');
    } else if (layerId) {
      dispatchCommand(ProjectCommands.bakeLayerModifiersToKeyframes(compositionId, layerId, 6));
      showFeedback('info', 'Baked layer motion presets to editable keyframes');
    }
  };

  const handleSaveAsCustomPreset = (mod: MotionModifierInstance) => {
    const res = animationPresetRegistry.createCustomPresetFromModifier(mod, {
      name: customPresetName,
      fps: compFps,
    });
    if (!res.success) {
      showFeedback('error', res.error);
      return;
    }
    showFeedback('info', `Saved custom preset "${res.preset.name}"`);
    setSavingModifierId(null);
    setCustomPresetName('');
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>
            {title ?? (targetScope === 'camera' ? 'Camera Modifiers' : 'Active Modifiers')} (
            {modifiers.length})
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onOpenPresets && (
            <button
              type="button"
              onClick={onOpenPresets}
              className="min-h-[30px] px-2 rounded-lg bg-[#111317] hover:bg-white/8 border border-white/10 text-[11px] font-medium text-amber-200"
            >
              + Add
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsPlaying(!isPlaying)}
            title={isPlaying ? 'Stop preview' : 'Preview animation'}
            className={`min-h-[34px] px-2.5 rounded-lg text-[11px] font-medium flex items-center gap-1 border ${
              isPlaying
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-[#111317] border-white/10 text-slate-300 hover:text-white'
            }`}
          >
            {isPlaying ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span>{isPlaying ? 'Stop' : 'Preview'}</span>
          </button>
          {hasEnabledModifiers && (
            <button
              type="button"
              onClick={handleBake}
              title="Convert stacked presets into editable timeline keyframes"
              className="min-h-[34px] px-2.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/35 text-[11px] font-medium text-blue-200 flex items-center gap-1"
            >
              <Wand2 className="w-3 h-3" />
              <span>Bake</span>
            </button>
          )}
        </div>
      </div>

      {modifiers.length === 0 ? (
        <div className="p-2.5 rounded-lg bg-[#111317] border border-white/8 text-[11px] text-slate-400 leading-relaxed">
          {emptyMessage ??
            `No ${targetScope === 'camera' ? 'camera' : 'motion'} modifiers applied yet. Apply a preset below, tune its sliders, then click the Bookmark (+) icon on the modifier to save a custom preset.`}
        </div>
      ) : (
        <div className="space-y-1.5">
          {modifiers.map((mod) => {
            const def = animationPresetRegistry.getById(mod.presetId);
            const isOpen =
              selectedModifierId === mod.id ||
              (selectedModifierId === null && modifiers.length === 1);
            return (
              <div
                key={mod.id}
                className="rounded-xl bg-[#111317] border border-white/10 overflow-hidden"
              >
                <div className="min-h-[42px] px-2 py-1 flex items-center justify-between gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      updateMotionModifier(
                        mod.id,
                        { enabled: !mod.enabled },
                        { compositionId, layerId, targetScope }
                      )
                    }
                    title={mod.enabled ? 'Disable modifier' : 'Enable modifier'}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center border shrink-0 ${
                      mod.enabled
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-[#181B20] border-white/10 text-slate-500'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedModifierId(isOpen ? null : mod.id)}
                    className="flex-1 min-w-0 text-left py-0.5"
                  >
                    <div className="text-xs font-medium text-slate-100 truncate">
                      {mod.label ?? def?.name ?? mod.presetId}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400">
                      {Math.round(mod.intensity * 100)}% · {mod.speed.toFixed(1)}× ·{' '}
                      {mod.loop ? 'Loop' : `${mod.durationFrames}f`}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (savingModifierId === mod.id) {
                        setSavingModifierId(null);
                      } else {
                        setSavingModifierId(mod.id);
                        setCustomPresetName(`${mod.label ?? def?.name ?? 'Custom Motion'} Copy`);
                      }
                    }}
                    title="Save modifier setup as a shareable custom preset"
                    aria-label={`Save ${mod.label ?? def?.name ?? mod.presetId} as custom preset`}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                      savingModifierId === mod.id
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'text-slate-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                    }`}
                  >
                    <BookmarkPlus className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      def &&
                      updateMotionModifier(
                        mod.id,
                        {
                          intensity: 1,
                          speed: Number(def.parameters.speed ?? 1),
                          delayFrames: 0,
                          phaseOffset: 0,
                          loop: def.loop,
                          direction: def.playbackDirection,
                          pivotAnchor: def.defaultPivot,
                          params: { ...def.parameters },
                        },
                        { compositionId, layerId, targetScope }
                      )
                    }
                    title="Reset modifier parameters to defaults"
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/8"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      removeMotionModifier(mod.id, { compositionId, layerId, targetScope })
                    }
                    title="Remove modifier"
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {savingModifierId === mod.id && (
                  <div className="px-2.5 py-2 border-t border-white/8 bg-[#12161E] space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={customPresetName}
                        onChange={(e) => setCustomPresetName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveAsCustomPreset(mod);
                          if (e.key === 'Escape') setSavingModifierId(null);
                        }}
                        placeholder="Custom preset name..."
                        aria-label="Custom preset name"
                        className="flex-1 min-w-0 min-h-[32px] px-2 rounded-lg bg-[#0B0D12] border border-white/15 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveAsCustomPreset(mod)}
                        className="min-h-[32px] px-2.5 rounded-lg bg-emerald-600/25 hover:bg-emerald-600 text-emerald-200 hover:text-white border border-emerald-500/40 text-[11px] font-medium shrink-0 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setSavingModifierId(null)}
                        className="min-h-[32px] px-2 rounded-lg bg-[#181B20] hover:bg-white/10 border border-white/10 text-[11px] text-slate-300 shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-snug">
                      Snapshots your current intensity, speed, cycle duration, pivot anchor, and parameter tweaks into the Preset Library for reuse or JSON export.
                    </p>
                  </div>
                )}

                {isOpen && (
                  <div className="p-2.5 pt-2 border-t border-white/8 bg-[#14171C] space-y-2.5">
                    {/* Intensity */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-300">Intensity</span>
                        <span className="font-mono text-blue-300">
                          {Math.round(mod.intensity * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={3}
                        step={0.05}
                        value={mod.intensity}
                        onChange={(e) =>
                          updateMotionModifier(
                            mod.id,
                            { intensity: parseFloat(e.target.value) },
                            { compositionId, layerId, targetScope }
                          )
                        }
                        className="w-full accent-blue-500 h-2 bg-[#0D0F12] rounded-lg"
                      />
                    </div>

                    {/* Speed */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-300">Speed</span>
                        <span className="font-mono text-blue-300">
                          {mod.speed.toFixed(2)}×
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={4}
                        step={0.05}
                        value={mod.speed}
                        onChange={(e) =>
                          updateMotionModifier(
                            mod.id,
                            { speed: parseFloat(e.target.value) },
                            { compositionId, layerId, targetScope }
                          )
                        }
                        className="w-full accent-blue-500 h-2 bg-[#0D0F12] rounded-lg"
                      />
                    </div>

                    {/* Duration & Delay */}
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-slate-400">Cycle (frames)</span>
                        <input
                          type="number"
                          min={4}
                          max={1200}
                          value={mod.durationFrames}
                          onChange={(e) =>
                            updateMotionModifier(
                              mod.id,
                              { durationFrames: Math.max(4, parseInt(e.target.value, 10) || 24) },
                              { compositionId, layerId, targetScope }
                            )
                          }
                          className="w-full min-h-[36px] px-2 rounded-lg bg-[#111317] border border-white/10 text-xs font-mono text-slate-100"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-slate-400">Delay (frames)</span>
                        <input
                          type="number"
                          min={0}
                          max={1200}
                          value={mod.delayFrames}
                          onChange={(e) =>
                            updateMotionModifier(
                              mod.id,
                              { delayFrames: Math.max(0, parseInt(e.target.value, 10) || 0) },
                              { compositionId, layerId, targetScope }
                            )
                          }
                          className="w-full min-h-[36px] px-2 rounded-lg bg-[#111317] border border-white/10 text-xs font-mono text-slate-100"
                        />
                      </label>
                    </div>

                    {/* Direction, Loop & Pivot */}
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-slate-400">Direction</span>
                        <select
                          value={mod.direction}
                          onChange={(e) =>
                            updateMotionModifier(
                              mod.id,
                              { direction: e.target.value as MotionModifierDirection },
                              { compositionId, layerId, targetScope }
                            )
                          }
                          className="w-full min-h-[36px] px-1.5 rounded-lg bg-[#111317] border border-white/10 text-[11px] text-slate-200"
                        >
                          <option value="forward">Forward</option>
                          <option value="reverse">Reverse</option>
                          <option value="alternate">Ping-Pong</option>
                        </select>
                      </label>

                      {targetScope === 'layer' ? (
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-slate-400">Pivot Anchor</span>
                          <select
                            value={mod.pivotAnchor}
                            onChange={(e) =>
                              updateMotionModifier(
                                mod.id,
                                { pivotAnchor: e.target.value as PivotAnchorPreset },
                                { compositionId, layerId, targetScope }
                              )
                            }
                            className="w-full min-h-[36px] px-1.5 rounded-lg bg-[#111317] border border-white/10 text-[11px] text-slate-200"
                          >
                            <option value="center">Center</option>
                            <option value="top">Top Root</option>
                            <option value="bottom">Bottom Base</option>
                            <option value="left">Left Edge</option>
                            <option value="right">Right Edge</option>
                          </select>
                        </label>
                      ) : (
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() =>
                              updateMotionModifier(
                                mod.id,
                                { loop: !mod.loop },
                                { compositionId, layerId, targetScope }
                              )
                            }
                            className={`w-full min-h-[36px] rounded-lg border text-[11px] font-medium ${
                              mod.loop
                                ? 'bg-blue-600/20 border-blue-500/40 text-blue-200'
                                : 'bg-[#111317] border-white/10 text-slate-400'
                            }`}
                          >
                            {mod.loop ? 'Looping: On' : 'Looping: Once'}
                          </button>
                        </div>
                      )}
                    </div>

                    {targetScope === 'layer' && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-slate-400">Playback</span>
                        <button
                          type="button"
                          onClick={() =>
                            updateMotionModifier(
                              mod.id,
                              { loop: !mod.loop },
                              { compositionId, layerId, targetScope }
                            )
                          }
                          className={`min-h-[32px] px-3 rounded-lg border text-[11px] font-medium ${
                            mod.loop
                              ? 'bg-blue-600/20 border-blue-500/40 text-blue-200'
                              : 'bg-[#111317] border-white/10 text-slate-400'
                          }`}
                        >
                          {mod.loop ? 'Looping: On' : 'Play Once'}
                        </button>
                      </div>
                    )}

                    {/* Preset-specific Parameter Controls */}
                    {def?.parameterControls.map((ctrl) => {
                      const rawVal = mod.params[ctrl.key] ?? ctrl.defaultValue;
                      if (ctrl.type === 'select') {
                        return (
                          <label key={ctrl.key} className="block space-y-0.5">
                            <span className="text-[10px] text-slate-400">{ctrl.label}</span>
                            <select
                              value={String(rawVal)}
                              onChange={(e) =>
                                updateMotionModifier(
                                  mod.id,
                                  { params: { [ctrl.key]: e.target.value } },
                                  { compositionId, layerId, targetScope }
                                )
                              }
                              className="w-full min-h-[36px] px-2 rounded-lg bg-[#111317] border border-white/10 text-[11px] text-slate-200"
                            >
                              {ctrl.options?.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        );
                      }
                      if (ctrl.type === 'boolean') {
                        const checked = Boolean(rawVal);
                        return (
                          <div key={ctrl.key} className="flex items-center justify-between pt-0.5">
                            <span className="text-[11px] text-slate-300">{ctrl.label}</span>
                            <button
                              type="button"
                              onClick={() =>
                                updateMotionModifier(
                                  mod.id,
                                  { params: { [ctrl.key]: !checked } },
                                  { compositionId, layerId, targetScope }
                                )
                              }
                              className={`min-h-[32px] px-3 rounded-lg text-[11px] border ${
                                checked
                                  ? 'bg-blue-600 border-blue-500 text-white'
                                  : 'bg-[#111317] border-white/10 text-slate-400'
                              }`}
                            >
                              {checked ? 'Enabled' : 'Off'}
                            </button>
                          </div>
                        );
                      }
                      const numVal =
                        typeof rawVal === 'number' ? rawVal : Number(ctrl.defaultValue);
                      return (
                        <div key={ctrl.key} className="space-y-0.5">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-slate-400">{ctrl.label}</span>
                            <span className="font-mono text-slate-200">
                              {Number(numVal.toFixed(3))}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={ctrl.min ?? 0}
                            max={ctrl.max ?? 100}
                            step={ctrl.step ?? 1}
                            value={numVal}
                            onChange={(e) =>
                              updateMotionModifier(
                                mod.id,
                                { params: { [ctrl.key]: parseFloat(e.target.value) } },
                                { compositionId, layerId, targetScope }
                              )
                            }
                            className="w-full accent-amber-400 h-2 bg-[#0D0F12] rounded-lg"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface MotionPresetsPanelProps {
  scope?: 'all' | 'layer' | 'camera';
  compositionId: string;
  layerId?: string;
  modifiers?: MotionModifierInstance[];
  registry?: AnimationPresetRegistry;
  initialCategory?: 'all' | PresetCategory;
}

const ALL_CATEGORIES: Array<{ id: 'all' | PresetCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'character', label: 'Character' },
  { id: 'hair', label: 'Hair' },
  { id: 'clothing', label: 'Clothing' },
  { id: 'environment', label: 'Environment' },
  { id: 'camera', label: 'Camera' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'effects', label: 'Effects' },
];

const LAYER_ONLY_CATEGORIES: Array<{ id: 'all' | PresetCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'character', label: 'Character' },
  { id: 'hair', label: 'Hair' },
  { id: 'clothing', label: 'Clothing' },
  { id: 'effects', label: 'Effects' },
];

const EXAMPLE_CUSTOM_PRESET_OBJ = {
  id: 'custom.hair.velvet-breeze',
  version: '1.0.0',
  name: 'Velvet Breeze',
  category: 'hair',
  description: 'Soft layered wind sway derived from Gentle Wind.',
  targetType: ['image', 'sprite', 'character-part', 'layer'],
  duration: 2.4,
  loop: true,
  playbackDirection: 'forward',
  blendMode: 'add',
  defaultPivot: 'top',
  basePresetId: 'hair.gentle-wind',
  defaultIntensity: 1.15,
  parameters: {
    rotationStrength: 6,
    movementStrength: 7,
    meshDeform: 5,
    speed: 1.1,
    windDirection: 'right',
  },
  parameterControls: [],
};

const EXAMPLE_CUSTOM_PRESET_JSON = JSON.stringify(EXAMPLE_CUSTOM_PRESET_OBJ, null, 2);

export const MotionPresetsPanel: React.FC<MotionPresetsPanelProps> = ({
  scope = 'all',
  compositionId,
  layerId,
  modifiers: explicitModifiers,
  registry = animationPresetRegistry,
  initialCategory,
}) => {
  const {
    project,
    currentFrame,
    selectLayer,
    apply_motion_preset,
    dispatchCommand,
    setWorkspace,
    showFeedback,
  } = useStudioStore();

  const registryRevision = useSyncExternalStore(
    (listener) => registry.subscribe(listener),
    () => registry.getRevision(),
    () => registry.getRevision()
  );

  const composition =
    project.compositions.find((c) => c.id === compositionId) ?? project.compositions[0];

  const [category, setCategory] = useState<'all' | PresetCategory>(
    initialCategory ?? (scope === 'camera' ? 'camera' : 'all')
  );
  const [search, setSearch] = useState('');
  const [lyricsModalOpen, setLyricsModalOpen] = useState(false);
  const [hoveredPresetId, setHoveredPresetId] = useState<string | null>(null);
  const [pinnedPresetId, setPinnedPresetId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [animationGuideOpen, setAnimationGuideOpen] = useState(scope === 'all');
  const [copiedExampleJson, setCopiedExampleJson] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const guideSectionRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const previewPreset = useMemo(() => {
    const targetId = hoveredPresetId ?? pinnedPresetId;
    return targetId ? registry.getById(targetId) ?? null : null;
  }, [hoveredPresetId, pinnedPresetId, registry, registryRevision]);

  const activeLayer: LayerDocument | null = useMemo(() => {
    if (!composition) return null;
    if (layerId) {
      return composition.layers.find((l) => l.id === layerId) ?? null;
    }
    return composition.layers[0] ?? null;
  }, [composition, layerId]);

  const activeModifierScope: 'camera' | 'layer' =
    scope === 'camera' || (scope === 'all' && category === 'camera')
      ? 'camera'
      : 'layer';

  const modifiers: MotionModifierInstance[] = useMemo(() => {
    if (explicitModifiers) return explicitModifiers;
    if (activeModifierScope === 'camera') {
      return composition?.camera.modifiers ?? [];
    }
    return activeLayer?.modifiers ?? [];
  }, [explicitModifiers, activeModifierScope, composition, activeLayer]);

  const categoriesToShow = scope === 'all' ? ALL_CATEGORIES : LAYER_ONLY_CATEGORIES;

  const handleCategoryTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      let nextIndex = currentIndex;
      if (e.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % categoriesToShow.length;
      } else if (e.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + categoriesToShow.length) % categoriesToShow.length;
      } else if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = categoriesToShow.length - 1;
      } else {
        return;
      }
      e.preventDefault();
      const nextCat = categoriesToShow[nextIndex];
      setCategory(nextCat.id);
      tabRefs.current[nextCat.id]?.focus();
    },
    [categoriesToShow]
  );

  const categoryCounts = useMemo(
    () => registry.getCategoryCounts(),
    [registry, registryRevision]
  );

  const totalPresetCount = useMemo(
    () => registry.getAll().length,
    [registry, registryRevision]
  );

  const customPresetCount = useMemo(
    () => registry.getCustomPresets().length,
    [registry, registryRevision]
  );

  const availablePresets = useMemo(() => {
    if (scope === 'camera') {
      return registry.query({ category: 'camera', search });
    }
    if (scope === 'layer') {
      return registry.query({
        categories:
          category !== 'all'
            ? [category]
            : ['character', 'hair', 'clothing', 'effects'],
        search,
      });
    }
    return registry.query({
      category: category !== 'all' ? category : undefined,
      search,
    });
  }, [registry, registryRevision, scope, category, search]);

  const textLayerTarget = useMemo(() => {
    if (activeLayer?.objects[0]?.kind === 'text') return activeLayer;
    return composition?.layers.find((l) => l.objects[0]?.kind === 'text') ?? null;
  }, [activeLayer, composition]);

  const handleApplyPreset = (preset: MotionPresetDefinition) => {
    const result = apply_motion_preset(preset.id, {
      compositionId,
      layerId: activeLayer?.id,
      targetScope: scope === 'camera' ? 'camera' : 'auto',
      preserveInspectorTarget: scope !== 'all',
    });
    if (result.ok && result.targetScope === 'camera' && scope === 'all' && category === 'all') {
      setCategory('camera');
    }
  };

  const handleResetEnvironmentEffects = () => {
    dispatchCommand(
      ProjectCommands.updateEnvironment(compositionId, {
        weatherType: 'none',
        weatherDensity: 0,
        fogOpacity: 0,
        cloudDensity: 0,
        grassDensity: 0,
      })
    );
    showFeedback('info', 'Reset active environment motion effects');
  };

  const handleExportPresets = () => {
    if (customPresetCount > 0) {
      const json = registry.exportPresetsToJson({ includeBuiltIn: false });
      downloadJsonFile('motion-studio-custom-presets.json', json);
      showFeedback('info', `Exported ${customPresetCount} custom preset(s) to JSON`);
      return;
    }
    if (availablePresets.length === 0) {
      showFeedback('error', 'No presets available to export.');
      return;
    }
    const json = registry.exportPresetsToJson({
      ids: availablePresets.map((p) => p.id),
      includeBuiltIn: true,
    });
    downloadJsonFile(`motion-studio-${category}-presets.json`, json);
    showFeedback('info', `Exported ${availablePresets.length} preset(s) to JSON`);
  };

  const handleExportSinglePreset = (preset: MotionPresetDefinition) => {
    const json = registry.exportPresetToJson(preset.id);
    if (!json) return;
    const safeName = preset.id.replace(/[^a-zA-Z0-9._-]+/g, '-');
    downloadJsonFile(`${safeName}.json`, json);
    showFeedback('info', `Exported "${preset.name}" to JSON`);
  };

  const handleDownloadPresetTemplate = () => {
    const starterBundle = {
      format: 'motion-studio.presets.v1',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      presetCount: 1,
      presets: [EXAMPLE_CUSTOM_PRESET_OBJ],
    };
    downloadJsonFile('custom-preset-template.json', JSON.stringify(starterBundle, null, 2));
    showFeedback('info', 'Downloaded custom preset JSON starter template');
  };

  const handleCopyExampleJson = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(EXAMPLE_CUSTOM_PRESET_JSON);
        setCopiedExampleJson(true);
        showFeedback('info', 'Copied preset JSON structure to clipboard');
        window.setTimeout(() => setCopiedExampleJson(false), 1800);
        return;
      }
      showFeedback('error', 'Clipboard copy is unavailable in this browser context');
    } catch {
      showFeedback('error', 'Unable to copy preset JSON to clipboard');
    }
  };

  const handleSaveMotionXArchive = () => {
    const json = serializeMotionXArchive(project);
    const safeName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fileName = `${safeName || 'motion-project'}.motionx`;
    downloadJsonFile(fileName, json);
    showFeedback('info', `Saved ${fileName} for internal sharing`);
  };

  const handleJumpToGuide = () => {
    setAnimationGuideOpen(true);
    requestAnimationFrame(() => {
      guideSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImportError(null);
    try {
      const text = await file.text();
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && parsed.format === 'motionx-project-archive') {
          const msg =
            'This is a .motionx project archive. Open it via Home -> Import .motionx or Export -> Import .motionx.';
          setImportError(msg);
          showFeedback('info', msg);
          return;
        }
      } catch {
        // Fall through to registry error handling below
      }

      const res = registry.importPresetsFromJson(text, { overwriteExisting: true });
      const totalAddedOrUpdated = res.imported.length + res.replaced.length;
      if (totalAddedOrUpdated > 0) {
        const firstPreset = res.imported[0] ?? res.replaced[0];
        if (firstPreset) {
          setPinnedPresetId(firstPreset.id);
          if (scope === 'all' && category !== 'all' && firstPreset.category !== category) {
            setCategory(firstPreset.category);
          }
        }
        const summaryParts: string[] = [];
        if (res.imported.length > 0) summaryParts.push(`${res.imported.length} imported`);
        if (res.replaced.length > 0) summaryParts.push(`${res.replaced.length} updated`);
        if (res.skipped.length > 0) summaryParts.push(`${res.skipped.length} skipped`);
        if (res.errors.length > 0) summaryParts.push(`${res.errors.length} failed`);
        showFeedback('info', `Preset JSON: ${summaryParts.join(', ')}`);
      } else if (res.errors.length > 0) {
        const errMsg = res.errors[0].error;
        setImportError(errMsg);
        showFeedback('error', errMsg);
      } else if (res.skipped.length > 0) {
        const skipMsg = res.skipped[0].reason;
        setImportError(skipMsg);
        showFeedback('info', skipMsg);
      } else {
        setImportError('No presets found in the selected JSON file.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to read preset JSON file.';
      setImportError(msg);
      showFeedback('error', msg);
    }
  };

  return (
    <div className="space-y-3">
      {/* Unified Target Selector when rendered as top-level Presets tab */}
      {scope === 'all' && composition && (
        <div className="p-2 rounded-xl bg-[#111317] border border-white/10 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>
              {category === 'camera'
                ? 'Target: Composition Camera'
                : category === 'environment'
                  ? 'Target: World Environment'
                  : 'Target Layer'}
            </span>
            <span className="font-mono text-slate-500">F{currentFrame}</span>
          </div>

          {category !== 'camera' && category !== 'environment' && (
            <select
              aria-label="Target layer for motion presets"
              value={activeLayer?.id ?? ''}
              onChange={(e) => selectLayer(e.target.value || null, 'presets')}
              className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#181B20] border border-white/10 text-xs font-medium text-slate-100"
            >
              {composition.layers.length === 0 ? (
                <option value="">No layers in composition</option>
              ) : (
                composition.layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.role})
                  </option>
                ))
              )}
            </select>
          )}
        </div>
      )}

      {/* Environment quick summary & reset when Environment category is active */}
      {scope === 'all' && category === 'environment' && composition && (
        <div className="p-2.5 rounded-xl bg-[#111317] border border-white/10 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">Active Environment</span>
            <button
              type="button"
              onClick={handleResetEnvironmentEffects}
              className="min-h-[32px] px-2.5 rounded-lg bg-[#181B20] hover:bg-white/10 border border-white/10 text-[11px] text-slate-300 flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          </div>
          <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1 font-mono">
            <span>Weather: {composition.environment.weatherType}</span>
            <span>Fog: {Math.round((composition.environment.fogOpacity ?? 0) * 100)}%</span>
            <span>Clouds: {Math.round((composition.environment.cloudDensity ?? 0) * 100)}%</span>
            <span>Grass: {Math.round((composition.environment.grassDensity ?? 0) * 100)}%</span>
          </div>
        </div>
      )}

      {/* Lyrics Studio quick action when Lyrics category is active */}
      {scope === 'all' && category === 'lyrics' && (
        textLayerTarget?.objects[0]?.kind === 'text' ? (
          <div className="p-2.5 rounded-xl bg-[#111317] border border-amber-400/25 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-amber-200 truncate">
                {textLayerTarget.name}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {textLayerTarget.objects[0].lyrics?.enabled
                  ? `${textLayerTarget.objects[0].lyrics.cues.length} cues · ${textLayerTarget.objects[0].lyrics.style}`
                  : 'No cues loaded'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLyricsModalOpen(true)}
              className="min-h-[36px] px-3 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-xs font-medium text-amber-200 flex items-center gap-1.5 shrink-0"
            >
              <Music className="w-3.5 h-3.5" />
              LRC / SRT Studio
            </button>
            <LyricsStudioModal
              open={lyricsModalOpen}
              onClose={() => setLyricsModalOpen(false)}
              compositionId={compositionId}
              layerId={textLayerTarget.id}
              objectId={textLayerTarget.objects[0].id}
              initialText={textLayerTarget.objects[0].text}
              initialLyrics={textLayerTarget.objects[0].lyrics}
            />
          </div>
        ) : (
          <div className="p-2.5 rounded-xl bg-[#111317] border border-white/10 text-[11px] text-slate-400">
            No text layer in this composition yet. Applying any preset below creates a foreground Lyrics Layer automatically.
          </div>
        )
      )}

      {/* Applied Non-Destructive Modifier Stack */}
      {!(scope === 'all' && (category === 'environment' || category === 'lyrics')) && (
        <MotionModifierStack
          compositionId={compositionId}
          targetScope={activeModifierScope}
          layerId={activeLayer?.id}
          modifiers={modifiers}
        />
      )}

      {/* Preset Library Picker */}
      <div className="pt-2 border-t border-white/8 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5 min-w-0">
            <Layers className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="truncate">Motion Preset Library</span>
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.motionx,application/json"
              aria-label="Import motion presets JSON file"
              onChange={handleImportJsonFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Import user-created presets from JSON"
              className="min-h-[28px] px-2 rounded-lg bg-[#111317] hover:bg-white/8 border border-white/10 text-[10px] font-medium text-slate-300 hover:text-white flex items-center gap-1 transition-colors"
            >
              <Upload className="w-3 h-3" />
              <span>Import</span>
            </button>
            <button
              type="button"
              onClick={handleExportPresets}
              title={
                customPresetCount > 0
                  ? `Export ${customPresetCount} custom preset(s) to JSON`
                  : `Export ${availablePresets.length} visible preset(s) to JSON`
              }
              className="min-h-[28px] px-2 rounded-lg bg-[#111317] hover:bg-white/8 border border-white/10 text-[10px] font-medium text-slate-300 hover:text-white flex items-center gap-1 transition-colors"
            >
              <Download className="w-3 h-3" />
              <span>Export{customPresetCount > 0 ? ` (${customPresetCount})` : ''}</span>
            </button>
            <button
              type="button"
              onClick={handleJumpToGuide}
              aria-label="Jump to Animation Guide"
              title="Jump to Animation Guide"
              className={`w-7 min-h-[28px] rounded-lg border flex items-center justify-center transition-colors ${
                animationGuideOpen
                  ? 'bg-blue-600/25 border-blue-400/60 text-blue-200'
                  : 'bg-[#111317] hover:bg-white/8 border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {importError && (
          <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-200 flex items-center justify-between gap-2">
            <span className="truncate">{importError}</span>
            <button
              type="button"
              onClick={() => setImportError(null)}
              className="text-[10px] text-red-300 hover:text-white shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {scope !== 'camera' && (
          <div
            role="tablist"
            aria-label="Motion preset categories"
            className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-white/10"
          >
            {categoriesToShow.map((cat, index) => {
              const isSelected = category === cat.id;
              const catCount =
                cat.id === 'all'
                  ? scope === 'layer'
                    ? categoryCounts.character +
                      categoryCounts.hair +
                      categoryCounts.clothing +
                      categoryCounts.effects
                    : totalPresetCount
                  : categoryCounts[cat.id];
              return (
                <button
                  key={cat.id}
                  ref={(el) => {
                    tabRefs.current[cat.id] = el;
                  }}
                  id={`preset-tab-${cat.id}`}
                  role="tab"
                  type="button"
                  aria-selected={isSelected}
                  aria-controls="motion-preset-tabpanel"
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => setCategory(cat.id)}
                  onKeyDown={(e) => handleCategoryTabKeyDown(e, index)}
                  className={`min-h-[34px] px-2.5 rounded-t-lg text-[11px] font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 border-b-2 ${
                    isSelected
                      ? 'border-blue-500 text-white bg-white/[0.06]'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                  }`}
                >
                  <span>{cat.label}</span>
                  <span
                    className={`font-mono tabular-nums text-[10px] px-1 rounded ${
                      isSelected ? 'bg-blue-500/25 text-blue-200' : 'bg-white/[0.05] text-slate-500'
                    }`}
                  >
                    {catCount}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <input
          type="text"
          placeholder="Search presets..."
          aria-label="Search motion presets"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
        />

        <PresetHoverPreview
          preset={previewPreset}
          isPinned={!hoveredPresetId && Boolean(pinnedPresetId)}
          onClearPin={() => setPinnedPresetId(null)}
          onApplyPreset={handleApplyPreset}
        />

        <div
          id="motion-preset-tabpanel"
          role="tabpanel"
          aria-labelledby={scope !== 'camera' ? `preset-tab-${category}` : undefined}
        >
          {availablePresets.length === 0 ? (
            <div className="p-4 rounded-xl bg-[#111317] border border-white/8 text-center space-y-2">
              <p className="text-xs text-slate-400">
                {search.trim()
                  ? `No motion presets match "${search.trim()}".`
                  : 'No motion presets registered in this category yet.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setCategory(scope === 'camera' ? 'camera' : 'all');
                }}
                className="min-h-[34px] px-3 rounded-lg bg-[#181B20] hover:bg-white/10 border border-white/10 text-[11px] font-medium text-slate-200"
              >
                Reset Filter
              </button>
            </div>
          ) : (
            <div
              className="space-y-1.5 max-h-[360px] overflow-y-auto pr-0.5"
              onMouseLeave={() => setHoveredPresetId(null)}
            >
              {availablePresets.map((preset) => {
                const appliedCount = modifiers.filter((m) => m.presetId === preset.id).length;
                const isPreviewing = previewPreset?.id === preset.id;
                const isPinned = pinnedPresetId === preset.id;
                const isCustom = registry.isCustomPreset(preset.id);
                return (
                  <div
                    key={preset.id}
                    onMouseEnter={() => setHoveredPresetId(preset.id)}
                    onMouseLeave={() =>
                      setHoveredPresetId((cur) => (cur === preset.id ? null : cur))
                    }
                    onFocusCapture={() => setHoveredPresetId(preset.id)}
                    onBlurCapture={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        setHoveredPresetId((cur) => (cur === preset.id ? null : cur));
                      }
                    }}
                    className={`p-2.5 rounded-xl border transition-colors flex items-center justify-between gap-2 ${
                      isPreviewing
                        ? 'bg-[#151A24] border-blue-500/45'
                        : 'bg-[#111317] border-white/8 hover:border-white/20'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-medium text-slate-100 truncate">
                          {preset.name}
                        </span>
                        {isCustom && (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 shrink-0">
                            Custom
                          </span>
                        )}
                        {appliedCount > 0 && (
                          <span className="text-[10px] font-mono tabular-nums text-amber-300 shrink-0">
                            · {appliedCount} active
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 line-clamp-1">{preset.description}</div>
                      <div className="text-[10px] font-mono tabular-nums text-slate-500 flex items-center gap-1.5 mt-0.5">
                        <span className="capitalize">{preset.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>{preset.duration.toFixed(1)}s</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setPinnedPresetId((cur) => (cur === preset.id ? null : preset.id))
                        }
                        title={isPinned ? 'Unpin preview' : 'Pin miniature preview'}
                        aria-label={`Preview ${preset.name}`}
                        aria-pressed={isPinned}
                        className={`w-7 min-h-[34px] rounded-lg border flex items-center justify-center transition-colors ${
                          isPinned
                            ? 'bg-blue-600/25 border-blue-400/60 text-blue-200'
                            : 'bg-[#181B20] border-white/10 text-slate-400 hover:text-slate-100 hover:border-white/25'
                        }`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportSinglePreset(preset)}
                        title={`Export ${preset.name} as JSON`}
                        aria-label={`Export ${preset.name} to JSON`}
                        className="w-7 min-h-[34px] rounded-lg bg-[#181B20] border border-white/10 text-slate-400 hover:text-slate-100 hover:border-white/25 flex items-center justify-center transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      {isCustom && (
                        <button
                          type="button"
                          onClick={() => {
                            if (pinnedPresetId === preset.id) setPinnedPresetId(null);
                            if (hoveredPresetId === preset.id) setHoveredPresetId(null);
                            registry.unregisterPreset(preset.id);
                            showFeedback('info', `Removed custom preset "${preset.name}"`);
                          }}
                          title={`Delete custom preset ${preset.name}`}
                          aria-label={`Delete custom preset ${preset.name}`}
                          className="w-7 min-h-[34px] rounded-lg bg-[#181B20] border border-white/10 text-slate-400 hover:text-red-300 hover:border-red-500/35 flex items-center justify-center transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleApplyPreset(preset)}
                        className="min-h-[34px] px-2.5 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-200 hover:text-white border border-blue-500/35 text-[11px] font-medium flex items-center gap-1 shrink-0 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{appliedCount > 0 ? 'Stack' : 'Apply'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Dedicated Animation Guide Section */}
      <section
        ref={guideSectionRef}
        aria-labelledby="animation-guide-heading"
        className="rounded-xl bg-[#111317] border border-white/10 overflow-hidden"
      >
        <button
          type="button"
          onClick={() => setAnimationGuideOpen((open) => !open)}
          aria-expanded={animationGuideOpen}
          className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] transition-colors"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
            <BookOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span id="animation-guide-heading">Animation Guide</span>
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-slate-400 shrink-0">
            <span>Custom JSON &amp; .motionx</span>
            {animationGuideOpen ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </span>
        </button>

        {animationGuideOpen && (
          <div className="px-3 pb-3 pt-1 border-t border-white/8 space-y-3 text-[11px] text-slate-300">
            {/* Step 1: Create a Custom Preset */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-100">
                1. Create a Custom Preset
              </div>
              <ol className="list-decimal list-inside space-y-1 text-[10px] text-slate-400 leading-relaxed">
                <li>
                  Select a target layer (or Camera tab) and click <span className="text-slate-200 font-medium">Apply</span> on any base motion in the library above.
                </li>
                <li>
                  Tune <span className="text-slate-200">Intensity</span>, <span className="text-slate-200">Speed</span>, <span className="text-slate-200">Cycle</span>, <span className="text-slate-200">Pivot Anchor</span>, and motion parameters in <span className="text-slate-200">Active Modifiers</span>.
                </li>
                <li>
                  Click the <span className="text-emerald-300 font-medium">Bookmark (+)</span> icon on the modifier header, enter a preset name, and click <span className="text-emerald-300 font-medium">Save</span> to register it locally and enable <span className="text-slate-200">.json</span> export.
                </li>
              </ol>
            </div>

            {/* Step 2: Define the Preset JSON Structure */}
            <div className="space-y-1.5 pt-2 border-t border-white/8">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-100">
                  2. Define Preset JSON Structure
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleCopyExampleJson}
                    className="px-2 py-1 rounded-md bg-[#181B20] hover:bg-white/10 border border-white/10 text-[10px] font-medium text-slate-200 flex items-center gap-1 transition-colors"
                  >
                    {copiedExampleJson ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedExampleJson ? 'Copied' : 'Copy JSON'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPresetTemplate}
                    className="px-2 py-1 rounded-md bg-blue-600/20 hover:bg-blue-600/35 border border-blue-500/35 text-[10px] font-medium text-blue-200 flex items-center gap-1 transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    <span>Starter .json</span>
                  </button>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 leading-relaxed">
                Required keys: <code className="text-slate-200">id</code>, <code className="text-slate-200">version</code>, <code className="text-slate-200">name</code>, <code className="text-slate-200">category</code> (<code className="text-blue-300">character | hair | clothing | environment | camera | lyrics | effects</code>), <code className="text-slate-200">targetType</code>, <code className="text-slate-200">duration</code>, <code className="text-slate-200">loop</code>, and <code className="text-slate-200">parameters</code>. Include <code className="text-blue-300">basePresetId</code> to inherit an engine motion kernel while overriding defaults. Import single preset JSON objects, arrays, or <code className="text-blue-300">motion-studio.presets.v1</code> bundles via <span className="text-slate-200">Import</span> above.
              </p>

              <pre className="p-2 rounded-lg bg-[#0B0D12] border border-white/10 text-[10px] font-mono text-slate-200 overflow-x-auto leading-relaxed">
                <code>{EXAMPLE_CUSTOM_PRESET_JSON}</code>
              </pre>
            </div>

            {/* Step 3: Save as .motionx for Internal Sharing */}
            <div className="space-y-2 pt-2 border-t border-white/8">
              <div className="text-[11px] font-semibold text-slate-100">
                3. Save as a .motionx File for Internal Sharing
              </div>
              <ol className="list-decimal list-inside space-y-1 text-[10px] text-slate-400 leading-relaxed">
                <li>
                  Apply your custom preset(s) to target layers or the composition camera so modifier stacks and tuned parameters are embedded in the project.
                </li>
                <li>
                  Save the full project package as a <code className="text-emerald-300">.motionx</code> archive (<code className="text-blue-300">format: &quot;motionx-project-archive&quot;</code>) using <span className="text-slate-200 font-medium">Save .motionx File</span> below or from the <span className="text-slate-200 font-medium">Export</span> workspace.
                </li>
                <li>
                  Share the <code className="text-emerald-300">.motionx</code> file internally with teammates—they can load the complete rigged scene, assets, and applied presets directly via <span className="text-slate-200">Home</span> or <span className="text-slate-200">Export &rarr; Import .motionx</span>.
                </li>
              </ol>

              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={handleSaveMotionXArchive}
                  className="min-h-[32px] px-2.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-[10px] font-medium text-emerald-200 flex items-center gap-1.5 transition-colors"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>Save .motionx File</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWorkspace('export')}
                  className="min-h-[32px] px-2.5 rounded-lg bg-[#181B20] hover:bg-white/10 border border-white/10 text-[10px] font-medium text-slate-200 transition-colors"
                >
                  Open Export Workspace
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
