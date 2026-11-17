import React, { useMemo, useState, useSyncExternalStore } from 'react';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  CloudSun,
  Diamond,
  ExternalLink,
  Gauge,
  Layers,
  Minus,
  Music,
  Plus,
  Sparkles,
} from 'lucide-react';
import { ProjectCommands } from '../commands/projectCommands';
import { evaluateCompositionAtFrame, evaluateKeyframes } from '../engine/evaluator';
import { animationPresetRegistry } from '../services/AnimationPresetRegistry';
import {
  BlendMode,
  EnvironmentDocument,
  InterpolationType,
  LayerAnimatableProp,
  LayerRole,
  WeatherType,
} from '../schema/projectSchema';
import { useStudioStore } from '../store/useStudioStore';
import { BakeModifiersUtility } from './BakeModifiersUtility';
import { KeyframeChannel, KeyframeManager } from './KeyframeManager';
import { LyricsStudioModal } from './LyricsStudioModal';
import { MotionModifierStack, MotionPresetsPanel } from './MotionPresetsPanel';

const ENVIRONMENT_PRESETS: {
  id: string;
  label: string;
  patch: Partial<EnvironmentDocument>;
}[] = [
  {
    id: 'twilight',
    label: 'Twilight Ridge',
    patch: {
      presetId: 'twilight',
      skyTopColor: '#0B1120',
      skyBottomColor: '#1E3A5F',
      hazeColor: '#60A5FA',
      hazeIntensity: 0.24,
      weatherType: 'fireflies',
      weatherDensity: 0.45,
      tintOpacity: 0,
    },
  },
  {
    id: 'dawn',
    label: 'Golden Dawn',
    patch: {
      presetId: 'dawn',
      skyTopColor: '#31102F',
      skyBottomColor: '#EA580C',
      hazeColor: '#FDBA74',
      hazeIntensity: 0.32,
      weatherType: 'dust',
      weatherDensity: 0.35,
      timeOfDayTint: '#F59E0B',
      tintOpacity: 0.08,
    },
  },
  {
    id: 'aurora',
    label: 'Aurora Night',
    patch: {
      presetId: 'aurora',
      skyTopColor: '#061523',
      skyBottomColor: '#134E4A',
      hazeColor: '#2DD4BF',
      hazeIntensity: 0.28,
      weatherType: 'snow',
      weatherDensity: 0.4,
      timeOfDayTint: '#042F2E',
      tintOpacity: 0.08,
    },
  },
  {
    id: 'storm',
    label: 'Stormy Dusk',
    patch: {
      presetId: 'storm',
      skyTopColor: '#090D16',
      skyBottomColor: '#1E293B',
      hazeColor: '#64748B',
      hazeIntensity: 0.36,
      weatherType: 'rain',
      weatherDensity: 0.65,
      timeOfDayTint: '#0F172A',
      tintOpacity: 0.14,
    },
  },
  {
    id: 'daylight',
    label: 'Clear Daylight',
    patch: {
      presetId: 'daylight',
      skyTopColor: '#1D4ED8',
      skyBottomColor: '#93C5FD',
      hazeColor: '#E0F2FE',
      hazeIntensity: 0.18,
      weatherType: 'none',
      weatherDensity: 0,
      tintOpacity: 0,
    },
  },
];

interface NumberScrubberProps {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  hasKeyframeAtFrame?: boolean;
  hasAnyKeyframes?: boolean;
  onChange: (val: number) => void;
  onToggleKeyframe?: () => void;
}

const NumberScrubber: React.FC<NumberScrubberProps> = ({
  label,
  value,
  step = 1,
  min,
  max,
  suffix = '',
  hasKeyframeAtFrame,
  hasAnyKeyframes,
  onChange,
  onToggleKeyframe,
}) => {
  const clamp = (v: number) => {
    let n = v;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return Number(n.toFixed(2));
  };

  return (
    <div className="flex items-center justify-between gap-1.5 py-0.5">
      <span className="text-[11px] text-slate-300 truncate">{label}</span>
      <div className="flex items-center gap-1 shrink-0">
        <div className="flex items-center rounded-lg bg-[#111317] border border-white/10 overflow-hidden">
          <button
            type="button"
            onClick={() => onChange(clamp(value - step))}
            aria-label={`Decrease ${label}`}
            className="h-7 w-6 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5"
          >
            <Minus className="w-3 h-3" />
          </button>
          <input
            type="number"
            value={Number(value.toFixed(2))}
            step={step}
            onChange={(e) => {
              const parsed = parseFloat(e.target.value);
              if (!Number.isNaN(parsed)) onChange(clamp(parsed));
            }}
            className="w-12 h-7 px-0.5 bg-transparent text-[11px] font-mono tabular-nums text-center text-slate-100 focus:outline-none"
          />
          {suffix && (
            <span className="pr-1 text-[10px] font-mono text-slate-400">{suffix}</span>
          )}
          <button
            type="button"
            onClick={() => onChange(clamp(value + step))}
            aria-label={`Increase ${label}`}
            className="h-7 w-6 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {onToggleKeyframe && (
          <button
            type="button"
            onClick={onToggleKeyframe}
            title={
              hasKeyframeAtFrame
                ? 'Remove keyframe at current frame'
                : 'Add keyframe at current frame'
            }
            aria-label={`Keyframe ${label}`}
            className={`h-7 w-7 rounded-lg flex items-center justify-center border transition-colors ${
              hasKeyframeAtFrame
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                : hasAnyKeyframes
                ? 'bg-[#111317] border-amber-500/25 text-amber-300/60 hover:text-amber-300'
                : 'bg-[#111317] border-white/8 text-slate-500 hover:text-slate-200'
            }`}
          >
            <Diamond className={`w-3 h-3 ${hasKeyframeAtFrame ? 'fill-amber-400' : ''}`} />
          </button>
        )}
      </div>
    </div>
  );
};

export const InspectorPanel: React.FC = () => {
  const {
    project,
    activeCompositionId,
    selectedLayerId,
    selectedKeyframe,
    inspectorTarget,
    currentFrame,
    previewQuality,
    setInspectorTarget,
    setActiveComposition,
    setCurrentFrame,
    setSelectedKeyframe,
    togglePreviewQuality,
    dispatchCommand,
  } = useStudioStore();

  const [selectedLayerKfChannel, setSelectedLayerKfChannel] = useState<string>('x');
  const [selectedCameraKfChannel, setSelectedCameraKfChannel] = useState<string>('x');
  const [layerSubTab, setLayerSubTab] = useState<'properties' | 'motion'>('properties');
  const [cameraSubTab, setCameraSubTab] = useState<'controls' | 'presets'>('controls');
  const [lyricsModalOpen, setLyricsModalOpen] = useState(false);

  const registryRevision = useSyncExternalStore(
    (listener) => animationPresetRegistry.subscribe(listener),
    () => animationPresetRegistry.getRevision(),
    () => animationPresetRegistry.getRevision()
  );

  const environmentMotionPresets = useMemo(
    () =>
      animationPresetRegistry
        .getByCategory('environment')
        .filter((p) => Boolean(p.environmentPatch)),
    [registryRevision]
  );

  const composition =
    project.compositions.find((c) => c.id === activeCompositionId) ?? project.compositions[0];

  const evaluated = evaluateCompositionAtFrame(project, composition.id, currentFrame);
  const selectedLayer = composition.layers.find((l) => l.id === selectedLayerId) ?? null;
  const evalLayer = evaluated?.layers.find((el) => el.layer.id === selectedLayerId) ?? null;
  const primaryObj = selectedLayer?.objects[0] ?? null;
  const evalTransform = evalLayer?.objects[0]?.worldTransform ?? primaryObj?.transform;

  const localLayerValues = useMemo(() => {
    if (!selectedLayer) return null;
    const base = primaryObj?.transform;
    return {
      x: evaluateKeyframes(selectedLayer.keyframes.x, currentFrame, base?.x ?? 0),
      y: evaluateKeyframes(selectedLayer.keyframes.y, currentFrame, base?.y ?? 0),
      rotation: evaluateKeyframes(selectedLayer.keyframes.rotation, currentFrame, base?.rotation ?? 0),
      scaleX: evaluateKeyframes(selectedLayer.keyframes.scaleX, currentFrame, base?.scaleX ?? 1),
      scaleY: evaluateKeyframes(selectedLayer.keyframes.scaleY, currentFrame, base?.scaleY ?? 1),
      opacity: evaluateKeyframes(selectedLayer.keyframes.opacity, currentFrame, selectedLayer.opacity),
    };
  }, [selectedLayer, primaryObj, currentFrame]);

  const layerKeyframeChannels: KeyframeChannel[] = useMemo(() => {
    if (!selectedLayer || !localLayerValues) return [];
    return [
      {
        key: 'x',
        label: 'Position X',
        shortLabel: 'Pos X',
        unit: 'px',
        step: 10,
        keyframes: selectedLayer.keyframes.x,
        currentValue: localLayerValues.x,
      },
      {
        key: 'y',
        label: 'Position Y',
        shortLabel: 'Pos Y',
        unit: 'px',
        step: 10,
        keyframes: selectedLayer.keyframes.y,
        currentValue: localLayerValues.y,
      },
      {
        key: 'rotation',
        label: 'Rotation',
        shortLabel: 'Rot',
        unit: '°',
        step: 5,
        keyframes: selectedLayer.keyframes.rotation,
        currentValue: localLayerValues.rotation,
        toDisplay: (rad) => (rad * 180) / Math.PI,
        fromDisplay: (deg) => (deg * Math.PI) / 180,
      },
      {
        key: 'scaleX',
        label: 'Scale X',
        shortLabel: 'Sc X',
        step: 0.1,
        min: 0.05,
        max: 8,
        keyframes: selectedLayer.keyframes.scaleX,
        currentValue: localLayerValues.scaleX,
      },
      {
        key: 'scaleY',
        label: 'Scale Y',
        shortLabel: 'Sc Y',
        step: 0.1,
        min: 0.05,
        max: 8,
        keyframes: selectedLayer.keyframes.scaleY,
        currentValue: localLayerValues.scaleY,
      },
      {
        key: 'opacity',
        label: 'Opacity',
        shortLabel: 'Opacity',
        unit: '%',
        step: 5,
        min: 0,
        max: 1,
        keyframes: selectedLayer.keyframes.opacity,
        currentValue: localLayerValues.opacity,
        toDisplay: (alpha) => Math.round(alpha * 100),
        fromDisplay: (pct) => Math.max(0, Math.min(1, pct / 100)),
      },
    ];
  }, [selectedLayer, localLayerValues]);

  const cameraKeyframeChannels: KeyframeChannel[] = useMemo(() => {
    if (!evaluated) return [];
    return [
      {
        key: 'x',
        label: 'Camera X',
        shortLabel: 'Cam X',
        unit: 'px',
        step: 20,
        keyframes: composition.camera.keyframes.x,
        currentValue: evaluated.camera.x,
      },
      {
        key: 'y',
        label: 'Camera Y',
        shortLabel: 'Cam Y',
        unit: 'px',
        step: 20,
        keyframes: composition.camera.keyframes.y,
        currentValue: evaluated.camera.y,
      },
      {
        key: 'zoom',
        label: 'Camera Zoom',
        shortLabel: 'Zoom',
        unit: '×',
        step: 0.05,
        min: 0.25,
        max: 4,
        keyframes: composition.camera.keyframes.zoom,
        currentValue: evaluated.camera.zoom,
      },
    ];
  }, [composition.camera.keyframes, evaluated]);

  const layerKeyframeFrames = useMemo(() => {
    if (!selectedLayer) return [];
    const set = new Set<number>();
    (['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'] as LayerAnimatableProp[]).forEach((p) => {
      selectedLayer.keyframes[p]?.forEach((k) => set.add(k.frame));
    });
    return [...set].sort((a, b) => a - b);
  }, [selectedLayer]);

  const prevLayerKfFrame = useMemo(() => {
    for (let i = layerKeyframeFrames.length - 1; i >= 0; i--) {
      if (layerKeyframeFrames[i] < currentFrame) return layerKeyframeFrames[i];
    }
    return null;
  }, [layerKeyframeFrames, currentFrame]);

  const nextLayerKfFrame = useMemo(() => {
    for (let i = 0; i < layerKeyframeFrames.length; i++) {
      if (layerKeyframeFrames[i] > currentFrame) return layerKeyframeFrames[i];
    }
    return null;
  }, [layerKeyframeFrames, currentFrame]);

  const toggleLayerKeyframe = (prop: LayerAnimatableProp, currentValue: number) => {
    if (!selectedLayer) return;
    setSelectedLayerKfChannel(prop);
    const existing = selectedLayer.keyframes[prop]?.find((k) => k.frame === currentFrame);
    if (existing) {
      dispatchCommand(
        ProjectCommands.deleteLayerKeyframe(composition.id, selectedLayer.id, prop, existing.id)
      );
    } else {
      dispatchCommand(
        ProjectCommands.setLayerKeyframe(composition.id, selectedLayer.id, prop, currentFrame, currentValue)
      );
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#181B20] text-slate-100 select-none">
      {/* Inspector Target Tabs */}
      <div className="p-1.5 border-b border-white/8">
        <div className="grid grid-cols-4 gap-0.5 p-0.5 rounded-xl bg-[#111317] border border-white/8">
          <button
            type="button"
            onClick={() => setInspectorTarget('layer')}
            className={`min-h-[36px] px-1 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
              inspectorTarget === 'layer'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <Layers className="w-3 h-3" />
            Layer
          </button>
          <button
            type="button"
            onClick={() => setInspectorTarget('presets')}
            className={`min-h-[36px] px-1 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
              inspectorTarget === 'presets'
                ? 'bg-amber-500/25 border border-amber-500/45 text-amber-200'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            Presets
          </button>
          <button
            type="button"
            onClick={() => setInspectorTarget('camera')}
            className={`min-h-[36px] px-1 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
              inspectorTarget === 'camera'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <Camera className="w-3 h-3" />
            Cam
          </button>
          <button
            type="button"
            onClick={() => setInspectorTarget('environment')}
            className={`min-h-[36px] px-1 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
              inspectorTarget === 'environment'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <CloudSun className="w-3 h-3" />
            World
          </button>
        </div>
      </div>

      {/* Inspector Body */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
        {inspectorTarget === 'presets' && (
          <MotionPresetsPanel
            scope="all"
            compositionId={composition.id}
            layerId={selectedLayer?.id}
          />
        )}

        {inspectorTarget === 'layer' && (
          <>
            {!selectedLayer || !evalTransform ? (
              <div className="py-10 text-center text-xs text-slate-400">
                Select a layer on the canvas or in the Layer Stack to inspect its properties, motion presets, and keyframes.
              </div>
            ) : (
              <>
                {/* Layer Inspector Sub-Tabs */}
                <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-[#111317] border border-white/8">
                  <button
                    type="button"
                    onClick={() => setLayerSubTab('properties')}
                    className={`min-h-[30px] px-2 rounded-md text-[11px] font-medium transition-colors ${
                      layerSubTab === 'properties'
                        ? 'bg-[#252A34] text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Properties
                  </button>
                  <button
                    type="button"
                    onClick={() => setLayerSubTab('motion')}
                    className={`min-h-[30px] px-2 rounded-md text-[11px] font-medium flex items-center justify-center gap-1 transition-colors ${
                      layerSubTab === 'motion'
                        ? 'bg-amber-500/20 text-amber-200 border border-amber-500/35'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Motion ({selectedLayer.modifiers?.length ?? 0})</span>
                  </button>
                </div>

                {layerSubTab === 'motion' ? (
                  <MotionPresetsPanel
                    scope="layer"
                    compositionId={composition.id}
                    layerId={selectedLayer.id}
                    modifiers={selectedLayer.modifiers ?? []}
                  />
                ) : (
                  <>
                {/* Identity & Role */}
                <div className="space-y-2 pb-2.5 border-b border-white/8">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={selectedLayer.name}
                      onChange={(e) =>
                        dispatchCommand(
                          ProjectCommands.updateLayerProps(composition.id, selectedLayer.id, {
                            name: e.target.value,
                          })
                        )
                      }
                      className="flex-1 min-w-0 min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 text-xs font-semibold text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-400">Role</span>
                      <select
                        value={selectedLayer.role}
                        onChange={(e) =>
                          dispatchCommand(
                            ProjectCommands.updateLayerProps(composition.id, selectedLayer.id, {
                              role: e.target.value as LayerRole,
                            })
                          )
                        }
                        className="w-full min-h-[36px] px-2 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-200"
                      >
                        <option value="foreground">Foreground</option>
                        <option value="character">Character</option>
                        <option value="midground">Midground</option>
                        <option value="prop">Prop</option>
                        <option value="background">Background</option>
                        <option value="effect">Effect</option>
                      </select>
                    </label>

                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-400">Blend Mode</span>
                      <select
                        value={selectedLayer.blendMode}
                        onChange={(e) =>
                          dispatchCommand(
                            ProjectCommands.updateLayerProps(composition.id, selectedLayer.id, {
                              blendMode: e.target.value as BlendMode,
                            })
                          )
                        }
                        className="w-full min-h-[36px] px-2 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-200"
                      >
                        <option value="normal">Normal</option>
                        <option value="multiply">Multiply</option>
                        <option value="screen">Screen</option>
                        <option value="overlay">Overlay</option>
                        <option value="add">Add</option>
                        <option value="darken">Darken</option>
                        <option value="lighten">Lighten</option>
                      </select>
                    </label>
                  </div>

                  {/* Parenting (with cycle validation!) */}
                  <label className="block space-y-1">
                    <span className="text-[11px] text-slate-400">Parent Layer</span>
                    <select
                      value={selectedLayer.parentId ?? ''}
                      onChange={(e) =>
                        dispatchCommand(
                          ProjectCommands.setLayerParent(
                            composition.id,
                            selectedLayer.id,
                            e.target.value || undefined
                          )
                        )
                      }
                      className="w-full min-h-[36px] px-2 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-200"
                    >
                      <option value="">None (World Space)</option>
                      {composition.layers
                        .filter((l) => l.id !== selectedLayer.id)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>

                {/* Transform & Keyframes */}
                <div className="space-y-1 pb-2.5 border-b border-white/8">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-slate-300">
                      Transform (Frame {currentFrame})
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        disabled={prevLayerKfFrame === null}
                        onClick={() => prevLayerKfFrame !== null && setCurrentFrame(prevLayerKfFrame)}
                        title="Jump to previous layer keyframe"
                        aria-label="Jump to previous keyframe"
                        className="h-5 w-5 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/8 disabled:opacity-25"
                      >
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                      <span className="text-[10px] text-amber-400/90 font-mono flex items-center gap-0.5 px-0.5">
                        <Diamond className="w-2.5 h-2.5" />
                      </span>
                      <button
                        type="button"
                        disabled={nextLayerKfFrame === null}
                        onClick={() => nextLayerKfFrame !== null && setCurrentFrame(nextLayerKfFrame)}
                        title="Jump to next layer keyframe"
                        aria-label="Jump to next keyframe"
                        className="h-5 w-5 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/8 disabled:opacity-25"
                      >
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <NumberScrubber
                    label="Position X"
                    value={evalTransform.x}
                    step={10}
                    hasKeyframeAtFrame={selectedLayer.keyframes.x.some((k) => k.frame === currentFrame)}
                    hasAnyKeyframes={selectedLayer.keyframes.x.length > 0}
                    onChange={(val) =>
                      dispatchCommand(
                        ProjectCommands.setLayerTransformProperty(
                          composition.id,
                          selectedLayer.id,
                          'x',
                          val,
                          currentFrame
                        )
                      )
                    }
                    onToggleKeyframe={() => toggleLayerKeyframe('x', evalTransform.x)}
                  />

                  <NumberScrubber
                    label="Position Y"
                    value={evalTransform.y}
                    step={10}
                    hasKeyframeAtFrame={selectedLayer.keyframes.y.some((k) => k.frame === currentFrame)}
                    hasAnyKeyframes={selectedLayer.keyframes.y.length > 0}
                    onChange={(val) =>
                      dispatchCommand(
                        ProjectCommands.setLayerTransformProperty(
                          composition.id,
                          selectedLayer.id,
                          'y',
                          val,
                          currentFrame
                        )
                      )
                    }
                    onToggleKeyframe={() => toggleLayerKeyframe('y', evalTransform.y)}
                  />

                  <NumberScrubber
                    label="Rotation"
                    value={(evalTransform.rotation * 180) / Math.PI}
                    step={5}
                    suffix="°"
                    hasKeyframeAtFrame={selectedLayer.keyframes.rotation.some(
                      (k) => k.frame === currentFrame
                    )}
                    hasAnyKeyframes={selectedLayer.keyframes.rotation.length > 0}
                    onChange={(deg) =>
                      dispatchCommand(
                        ProjectCommands.setLayerTransformProperty(
                          composition.id,
                          selectedLayer.id,
                          'rotation',
                          (deg * Math.PI) / 180,
                          currentFrame
                        )
                      )
                    }
                    onToggleKeyframe={() =>
                      toggleLayerKeyframe('rotation', evalTransform.rotation)
                    }
                  />

                  <NumberScrubber
                    label="Scale X"
                    value={evalTransform.scaleX}
                    step={0.1}
                    min={0.05}
                    max={8}
                    hasKeyframeAtFrame={selectedLayer.keyframes.scaleX.some(
                      (k) => k.frame === currentFrame
                    )}
                    hasAnyKeyframes={selectedLayer.keyframes.scaleX.length > 0}
                    onChange={(val) =>
                      dispatchCommand(
                        ProjectCommands.setLayerTransformProperty(
                          composition.id,
                          selectedLayer.id,
                          'scaleX',
                          val,
                          currentFrame
                        )
                      )
                    }
                    onToggleKeyframe={() => toggleLayerKeyframe('scaleX', evalTransform.scaleX)}
                  />

                  <NumberScrubber
                    label="Scale Y"
                    value={evalTransform.scaleY}
                    step={0.1}
                    min={0.05}
                    max={8}
                    hasKeyframeAtFrame={selectedLayer.keyframes.scaleY.some(
                      (k) => k.frame === currentFrame
                    )}
                    hasAnyKeyframes={selectedLayer.keyframes.scaleY.length > 0}
                    onChange={(val) =>
                      dispatchCommand(
                        ProjectCommands.setLayerTransformProperty(
                          composition.id,
                          selectedLayer.id,
                          'scaleY',
                          val,
                          currentFrame
                        )
                      )
                    }
                    onToggleKeyframe={() => toggleLayerKeyframe('scaleY', evalTransform.scaleY)}
                  />

                  <NumberScrubber
                    label="Opacity"
                    value={Math.round((evalLayer?.effectiveOpacity ?? selectedLayer.opacity) * 100)}
                    step={5}
                    min={0}
                    max={100}
                    suffix="%"
                    hasKeyframeAtFrame={selectedLayer.keyframes.opacity.some(
                      (k) => k.frame === currentFrame
                    )}
                    hasAnyKeyframes={selectedLayer.keyframes.opacity.length > 0}
                    onChange={(pct) =>
                      dispatchCommand(
                        ProjectCommands.setLayerTransformProperty(
                          composition.id,
                          selectedLayer.id,
                          'opacity',
                          pct / 100,
                          currentFrame
                        )
                      )
                    }
                    onToggleKeyframe={() =>
                      toggleLayerKeyframe(
                        'opacity',
                        localLayerValues?.opacity ?? evalLayer?.effectiveOpacity ?? selectedLayer.opacity
                      )
                    }
                  />
                </div>

                {/* Keyframe & Interpolation Management */}
                <KeyframeManager
                  title="Keyframes & Interpolation"
                  channels={layerKeyframeChannels}
                  currentFrame={currentFrame}
                  durationFrames={composition.settings.durationFrames}
                  selectedChannelKey={
                    selectedKeyframe?.scope === 'layer' &&
                    selectedKeyframe.targetId === selectedLayer.id
                      ? selectedKeyframe.prop
                      : selectedLayerKfChannel
                  }
                  selectedKeyframeId={
                    selectedKeyframe?.scope === 'layer' &&
                    selectedKeyframe.targetId === selectedLayer.id
                      ? selectedKeyframe.kfId
                      : null
                  }
                  onSelectChannelKey={(key) => {
                    setSelectedLayerKfChannel(key);
                    if (selectedKeyframe && selectedKeyframe.prop !== key) {
                      setSelectedKeyframe(null);
                    }
                  }}
                  onSelectKeyframe={(channelKey, kfId) => {
                    setSelectedLayerKfChannel(channelKey);
                    setSelectedKeyframe({
                      scope: 'layer',
                      targetId: selectedLayer.id,
                      prop: channelKey,
                      kfId,
                    });
                  }}
                  onJumpToFrame={setCurrentFrame}
                  onSetKeyframe={(channelKey, frame, value, interpolation) =>
                    dispatchCommand(
                      ProjectCommands.setLayerKeyframe(
                        composition.id,
                        selectedLayer.id,
                        channelKey as LayerAnimatableProp,
                        frame,
                        value,
                        interpolation
                      )
                    )
                  }
                  onUpdateKeyframe={(channelKey, keyframeId, patch) =>
                    dispatchCommand(
                      ProjectCommands.updateLayerKeyframe(
                        composition.id,
                        selectedLayer.id,
                        channelKey as LayerAnimatableProp,
                        keyframeId,
                        patch
                      )
                    )
                  }
                  onDeleteKeyframe={(channelKey, keyframeId) => {
                    if (selectedKeyframe?.kfId === keyframeId) {
                      setSelectedKeyframe(null);
                    }
                    dispatchCommand(
                      ProjectCommands.deleteLayerKeyframe(
                        composition.id,
                        selectedLayer.id,
                        channelKey as LayerAnimatableProp,
                        keyframeId
                      )
                    );
                  }}
                  onClearChannel={(channelKey) => {
                    if (
                      selectedKeyframe?.scope === 'layer' &&
                      selectedKeyframe.prop === channelKey
                    ) {
                      setSelectedKeyframe(null);
                    }
                    dispatchCommand(
                      ProjectCommands.clearLayerPropertyKeyframes(
                        composition.id,
                        selectedLayer.id,
                        channelKey as LayerAnimatableProp
                      )
                    );
                  }}
                />

                {/* Active Non-Destructive Motion Presets (real-time speed, intensity & preset parameters) */}
                <MotionModifierStack
                  compositionId={composition.id}
                  targetScope="layer"
                  layerId={selectedLayer.id}
                  modifiers={selectedLayer.modifiers ?? []}
                  title="Active Motion Presets"
                  showEmpty={false}
                  onOpenPresets={() => setLayerSubTab('motion')}
                />

                <BakeModifiersUtility
                  compositionId={composition.id}
                  targetScope="layer"
                  layerId={selectedLayer.id}
                  modifiers={selectedLayer.modifiers ?? []}
                  defaultStartFrame={selectedLayer.inFrame}
                  defaultEndFrame={Math.max(selectedLayer.inFrame, selectedLayer.outFrame - 1)}
                />

                {/* Parallax Depth */}
                <div className="space-y-2 pb-3 border-b border-white/8">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-300">Parallax Depth (Z)</span>
                    <span className="font-mono tabular-nums text-blue-400">
                      {selectedLayer.depth.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-1.5}
                    max={1.5}
                    step={0.05}
                    value={selectedLayer.depth}
                    onChange={(e) =>
                      dispatchCommand(
                        ProjectCommands.updateLayerProps(composition.id, selectedLayer.id, {
                          depth: parseFloat(e.target.value),
                        })
                      )
                    }
                    className="w-full accent-blue-500 h-2 bg-[#111317] rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>Far Sky (-1.5)</span>
                    <span>Focal (0.0)</span>
                    <span>Foreground (+1.5)</span>
                  </div>
                </div>

                {/* Object-Specific Controls */}
                {primaryObj?.kind === 'character' && (
                  <div className="space-y-2.5 pb-3 border-b border-white/8">
                    <div className="text-xs font-semibold text-slate-300">Character Instance</div>
                    {(() => {
                      const charDef = project.characters.find(
                        (c) => c.id === primaryObj.characterId
                      );
                      if (!charDef) return null;
                      return (
                        <>
                          <label className="block space-y-1">
                            <span className="text-[11px] text-slate-400">Animation Clip</span>
                            <select
                              value={primaryObj.activeClipId}
                              onChange={(e) =>
                                dispatchCommand(
                                  ProjectCommands.updateObject(
                                    composition.id,
                                    selectedLayer.id,
                                    primaryObj.id,
                                    (o) =>
                                      o.kind === 'character'
                                        ? { ...o, activeClipId: e.target.value }
                                        : o
                                  )
                                )
                              }
                              className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-100"
                            >
                              {charDef.clips.map((cl) => (
                                <option key={cl.id} value={cl.id}>
                                  {cl.name} ({cl.fps} fps)
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-300">Flip Horizontal</span>
                            <button
                              type="button"
                              onClick={() =>
                                dispatchCommand(
                                  ProjectCommands.updateObject(
                                    composition.id,
                                    selectedLayer.id,
                                    primaryObj.id,
                                    (o) =>
                                      o.kind === 'character' ? { ...o, flipX: !o.flipX } : o
                                  )
                                )
                              }
                              className={`min-h-[34px] px-3 rounded-lg text-xs font-medium border ${
                                primaryObj.flipX
                                  ? 'bg-blue-600 border-blue-500 text-white'
                                  : 'bg-[#111317] border-white/10 text-slate-300'
                              }`}
                            >
                              {primaryObj.flipX ? 'Flipped' : 'Normal'}
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {primaryObj?.kind === 'text' && (
                  <div className="space-y-2.5 pb-3 border-b border-white/8">
                    <div className="text-xs font-semibold text-slate-300">Text Content</div>
                    <textarea
                      rows={2}
                      value={primaryObj.text}
                      onChange={(e) =>
                        dispatchCommand(
                          ProjectCommands.updateObject(
                            composition.id,
                            selectedLayer.id,
                            primaryObj.id,
                            (o) => (o.kind === 'text' ? { ...o, text: e.target.value } : o)
                          )
                        )
                      }
                      className="w-full p-2 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-100"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="text-[11px] text-slate-400">Size (px)</span>
                        <input
                          type="number"
                          min={12}
                          max={240}
                          value={primaryObj.fontSize}
                          onChange={(e) =>
                            dispatchCommand(
                              ProjectCommands.updateObject(
                                composition.id,
                                selectedLayer.id,
                                primaryObj.id,
                                (o) =>
                                  o.kind === 'text'
                                    ? { ...o, fontSize: Math.max(12, Number(e.target.value) || 32) }
                                    : o
                              )
                            )
                          }
                          className="w-full min-h-[36px] px-2 rounded-lg bg-[#111317] border border-white/10 font-mono text-xs text-slate-100"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-slate-400">Color</span>
                        <input
                          type="color"
                          value={primaryObj.color}
                          onChange={(e) =>
                            dispatchCommand(
                              ProjectCommands.updateObject(
                                composition.id,
                                selectedLayer.id,
                                primaryObj.id,
                                (o) => (o.kind === 'text' ? { ...o, color: e.target.value } : o)
                              )
                            )
                          }
                          className="w-full h-[36px] p-1 rounded-lg bg-[#111317] border border-white/10 cursor-pointer"
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={() => setLyricsModalOpen(true)}
                      className="w-full min-h-[38px] px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/35 text-xs font-medium text-amber-200 flex items-center justify-between"
                    >
                      <span className="flex items-center gap-1.5">
                        <Music className="w-3.5 h-3.5" />
                        Lyrics & Typography Studio
                      </span>
                      <span className="text-[10px] font-mono text-amber-300/80">
                        {primaryObj.lyrics?.enabled
                          ? `${primaryObj.lyrics.cues.length} cues · ${primaryObj.lyrics.style}`
                          : 'Configure'}
                      </span>
                    </button>

                    <LyricsStudioModal
                      open={lyricsModalOpen}
                      onClose={() => setLyricsModalOpen(false)}
                      compositionId={composition.id}
                      layerId={selectedLayer.id}
                      objectId={primaryObj.id}
                      initialText={primaryObj.text}
                      initialLyrics={primaryObj.lyrics}
                    />
                  </div>
                )}

                {primaryObj?.kind === 'shape' && (
                  <div className="space-y-2.5 pb-3 border-b border-white/8">
                    <div className="text-xs font-semibold text-slate-300">Shape Style</div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="text-[11px] text-slate-400">Geometry</span>
                        <select
                          value={primaryObj.shapeType}
                          onChange={(e) =>
                            dispatchCommand(
                              ProjectCommands.updateObject(
                                composition.id,
                                selectedLayer.id,
                                primaryObj.id,
                                (o) =>
                                  o.kind === 'shape'
                                    ? {
                                        ...o,
                                        shapeType: e.target.value as
                                          | 'rect'
                                          | 'ellipse'
                                          | 'polygon'
                                          | 'star',
                                      }
                                    : o
                              )
                            )
                          }
                          className="w-full min-h-[36px] px-2 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-100"
                        >
                          <option value="rect">Rectangle</option>
                          <option value="ellipse">Ellipse</option>
                          <option value="polygon">Hexagon</option>
                          <option value="star">Star</option>
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-slate-400">Fill Color</span>
                        <input
                          type="color"
                          value={primaryObj.fill}
                          onChange={(e) =>
                            dispatchCommand(
                              ProjectCommands.updateObject(
                                composition.id,
                                selectedLayer.id,
                                primaryObj.id,
                                (o) => (o.kind === 'shape' ? { ...o, fill: e.target.value } : o)
                              )
                            )
                          }
                          className="w-full h-[36px] p-1 rounded-lg bg-[#111317] border border-white/10 cursor-pointer"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {primaryObj?.kind === 'nestedComposition' && (
                  <div className="space-y-2.5 pb-3 border-b border-white/8">
                    <div className="text-xs font-semibold text-cyan-300">Nested Composition</div>
                    <button
                      type="button"
                      onClick={() => setActiveComposition(primaryObj.compositionId)}
                      className="w-full min-h-[40px] px-3 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 text-xs font-medium text-cyan-200 flex items-center justify-center gap-2"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open Nested Composition
                    </button>
                    <NumberScrubber
                      label="Time Offset"
                      value={primaryObj.timeOffsetFrames}
                      step={6}
                      suffix="f"
                      onChange={(val) =>
                        dispatchCommand(
                          ProjectCommands.updateObject(
                            composition.id,
                            selectedLayer.id,
                            primaryObj.id,
                            (o) =>
                              o.kind === 'nestedComposition'
                                ? { ...o, timeOffsetFrames: Math.round(val) }
                                : o
                          )
                        )
                      }
                    />
                  </div>
                )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {inspectorTarget === 'camera' && evaluated && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-[#111317] border border-white/8">
              <button
                type="button"
                onClick={() => setCameraSubTab('controls')}
                className={`min-h-[30px] px-2 rounded-md text-[11px] font-medium transition-colors ${
                  cameraSubTab === 'controls'
                    ? 'bg-[#252A34] text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Camera & KF
              </button>
              <button
                type="button"
                onClick={() => setCameraSubTab('presets')}
                className={`min-h-[30px] px-2 rounded-md text-[11px] font-medium flex items-center justify-center gap-1 transition-colors ${
                  cameraSubTab === 'presets'
                    ? 'bg-amber-500/20 text-amber-200 border border-amber-500/35'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                <span>Presets ({composition.camera.modifiers?.length ?? 0})</span>
              </button>
            </div>

            {cameraSubTab === 'presets' ? (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] text-slate-400">Follow Target Layer</span>
                  <select
                    value={composition.camera.followLayerId ?? ''}
                    onChange={(e) =>
                      dispatchCommand(
                        ProjectCommands.updateCamera(composition.id, {
                          followLayerId: e.target.value || undefined,
                        })
                      )
                    }
                    className="w-full min-h-[36px] px-2 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-200"
                  >
                    <option value="">None (Free Camera)</option>
                    {composition.layers.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <MotionPresetsPanel
                  scope="camera"
                  compositionId={composition.id}
                  modifiers={composition.camera.modifiers ?? []}
                />
              </>
            ) : (
              <>
                <div className="text-xs font-semibold text-slate-300">
                  2D Camera & Parallax (Frame {currentFrame})
                </div>

            <NumberScrubber
              label="Camera X"
              value={evaluated.camera.x}
              step={20}
              hasKeyframeAtFrame={composition.camera.keyframes.x.some(
                (k) => k.frame === currentFrame
              )}
              hasAnyKeyframes={composition.camera.keyframes.x.length > 0}
              onChange={(val) =>
                dispatchCommand(
                  ProjectCommands.setCameraKeyframe(composition.id, 'x', currentFrame, val)
                )
              }
              onToggleKeyframe={() => {
                const exists = composition.camera.keyframes.x.some(
                  (k) => k.frame === currentFrame
                );
                if (exists) {
                  dispatchCommand(
                    ProjectCommands.removeCameraKeyframe(composition.id, 'x', currentFrame)
                  );
                } else {
                  dispatchCommand(
                    ProjectCommands.setCameraKeyframe(
                      composition.id,
                      'x',
                      currentFrame,
                      evaluated.camera.x
                    )
                  );
                }
              }}
            />

            <NumberScrubber
              label="Camera Y"
              value={evaluated.camera.y}
              step={20}
              hasKeyframeAtFrame={composition.camera.keyframes.y.some(
                (k) => k.frame === currentFrame
              )}
              hasAnyKeyframes={composition.camera.keyframes.y.length > 0}
              onChange={(val) =>
                dispatchCommand(
                  ProjectCommands.setCameraKeyframe(composition.id, 'y', currentFrame, val)
                )
              }
              onToggleKeyframe={() => {
                const exists = composition.camera.keyframes.y.some(
                  (k) => k.frame === currentFrame
                );
                if (exists) {
                  dispatchCommand(
                    ProjectCommands.removeCameraKeyframe(composition.id, 'y', currentFrame)
                  );
                } else {
                  dispatchCommand(
                    ProjectCommands.setCameraKeyframe(
                      composition.id,
                      'y',
                      currentFrame,
                      evaluated.camera.y
                    )
                  );
                }
              }}
            />

            <NumberScrubber
              label="Camera Zoom"
              value={evaluated.camera.zoom}
              step={0.05}
              min={0.25}
              max={4}
              hasKeyframeAtFrame={composition.camera.keyframes.zoom.some(
                (k) => k.frame === currentFrame
              )}
              hasAnyKeyframes={composition.camera.keyframes.zoom.length > 0}
              onChange={(val) =>
                dispatchCommand(
                  ProjectCommands.setCameraKeyframe(composition.id, 'zoom', currentFrame, val)
                )
              }
              onToggleKeyframe={() => {
                const exists = composition.camera.keyframes.zoom.some(
                  (k) => k.frame === currentFrame
                );
                if (exists) {
                  dispatchCommand(
                    ProjectCommands.removeCameraKeyframe(composition.id, 'zoom', currentFrame)
                  );
                } else {
                  dispatchCommand(
                    ProjectCommands.setCameraKeyframe(
                      composition.id,
                      'zoom',
                      currentFrame,
                      evaluated.camera.zoom
                    )
                  );
                }
              }}
            />

            <div className="pt-2 space-y-1.5 border-t border-white/8">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300">Parallax Strength</span>
                <span className="font-mono tabular-nums text-blue-400">
                  {composition.camera.parallaxStrength.toFixed(2)}×
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={composition.camera.parallaxStrength}
                onChange={(e) =>
                  dispatchCommand(
                    ProjectCommands.updateCamera(composition.id, {
                      parallaxStrength: parseFloat(e.target.value),
                    })
                  )
                }
                className="w-full accent-blue-500 h-2 bg-[#111317] rounded-lg"
              />
            </div>

            <MotionModifierStack
              compositionId={composition.id}
              targetScope="camera"
              modifiers={composition.camera.modifiers ?? []}
              title="Camera Motion Presets"
              showEmpty={false}
              onOpenPresets={() => setCameraSubTab('presets')}
            />

            <BakeModifiersUtility
              compositionId={composition.id}
              targetScope="camera"
              modifiers={composition.camera.modifiers ?? []}
              defaultStartFrame={0}
              defaultEndFrame={Math.max(0, composition.settings.durationFrames - 1)}
            />

            <KeyframeManager
              title="Camera Keyframes"
              channels={cameraKeyframeChannels}
              currentFrame={currentFrame}
              durationFrames={composition.settings.durationFrames}
              selectedChannelKey={
                selectedKeyframe?.scope === 'camera' &&
                selectedKeyframe.targetId === composition.id
                  ? selectedKeyframe.prop
                  : selectedCameraKfChannel
              }
              selectedKeyframeId={
                selectedKeyframe?.scope === 'camera' &&
                selectedKeyframe.targetId === composition.id
                  ? selectedKeyframe.kfId
                  : null
              }
              onSelectChannelKey={(key) => {
                setSelectedCameraKfChannel(key);
                if (selectedKeyframe && selectedKeyframe.prop !== key) {
                  setSelectedKeyframe(null);
                }
              }}
              onSelectKeyframe={(channelKey, kfId) => {
                setSelectedCameraKfChannel(channelKey);
                setSelectedKeyframe({
                  scope: 'camera',
                  targetId: composition.id,
                  prop: channelKey,
                  kfId,
                });
              }}
              onJumpToFrame={setCurrentFrame}
              onSetKeyframe={(channelKey, frame, value, interpolation) =>
                dispatchCommand(
                  ProjectCommands.setCameraKeyframe(
                    composition.id,
                    channelKey as 'x' | 'y' | 'zoom',
                    frame,
                    value,
                    interpolation
                  )
                )
              }
              onUpdateKeyframe={(channelKey, keyframeId, patch) =>
                dispatchCommand(
                  ProjectCommands.updateCameraKeyframe(
                    composition.id,
                    channelKey as 'x' | 'y' | 'zoom',
                    keyframeId,
                    patch
                  )
                )
              }
              onDeleteKeyframe={(channelKey, keyframeId) => {
                if (selectedKeyframe?.kfId === keyframeId) {
                  setSelectedKeyframe(null);
                }
                const kf = composition.camera.keyframes[channelKey as 'x' | 'y' | 'zoom']?.find(
                  (k) => k.id === keyframeId
                );
                if (kf) {
                  dispatchCommand(
                    ProjectCommands.removeCameraKeyframe(
                      composition.id,
                      channelKey as 'x' | 'y' | 'zoom',
                      kf.frame
                    )
                  );
                }
              }}
            />
              </>
            )}
          </div>
        )}

        {inspectorTarget === 'environment' && (
          <div className="space-y-3.5">
            {/* Performance Quality Mode */}
            <div className="p-2 rounded-xl bg-[#111317] border border-white/8 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs text-slate-200">
                <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                <span>Preview Quality</span>
              </div>
              <button
                type="button"
                onClick={togglePreviewQuality}
                className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-medium border ${
                  previewQuality === 'reduced'
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                    : 'bg-blue-600/20 border-blue-500/40 text-blue-200'
                }`}
              >
                {previewQuality === 'reduced' ? 'Reduced (Fast)' : 'Full Quality'}
              </button>
            </div>

            <div className="text-xs font-semibold text-slate-300">Sky Atmosphere Presets</div>
            <div className="grid grid-cols-2 gap-1.5">
              {ENVIRONMENT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    dispatchCommand(ProjectCommands.updateEnvironment(composition.id, preset.patch))
                  }
                  className={`min-h-[38px] px-2.5 py-1.5 rounded-lg text-xs font-medium border text-left transition-colors ${
                    composition.environment.presetId === preset.id
                      ? 'bg-blue-600/20 border-blue-500/50 text-blue-200'
                      : 'bg-[#111317] border-white/8 text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* 8 Environment Motion Presets */}
            <div className="space-y-1.5 pt-2 border-t border-white/8">
              <div className="text-xs font-semibold text-slate-300">
                Environment Motion Presets
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {environmentMotionPresets.map(
                  (envPreset) => (
                    <button
                      key={envPreset.id}
                      type="button"
                      onClick={() =>
                        envPreset.environmentPatch &&
                        dispatchCommand(
                          ProjectCommands.updateEnvironment(
                            composition.id,
                            envPreset.environmentPatch
                          )
                        )
                      }
                      className="min-h-[34px] px-2 py-1 rounded-lg bg-[#111317] hover:bg-white/8 border border-white/8 text-[11px] font-medium text-slate-200 text-left truncate"
                    >
                      {envPreset.name}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/8">
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">Sky Top</span>
                <input
                  type="color"
                  value={
                    composition.environment.skyTopColor === 'transparent'
                      ? '#0F172A'
                      : composition.environment.skyTopColor
                  }
                  onChange={(e) =>
                    dispatchCommand(
                      ProjectCommands.updateEnvironment(composition.id, {
                        skyTopColor: e.target.value,
                        presetId: 'custom',
                      })
                    )
                  }
                  className="w-full h-[38px] p-1 rounded-lg bg-[#111317] border border-white/10"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">Sky Horizon</span>
                <input
                  type="color"
                  value={
                    composition.environment.skyBottomColor === 'transparent'
                      ? '#1E3A5F'
                      : composition.environment.skyBottomColor
                  }
                  onChange={(e) =>
                    dispatchCommand(
                      ProjectCommands.updateEnvironment(composition.id, {
                        skyBottomColor: e.target.value,
                        presetId: 'custom',
                      })
                    )
                  }
                  className="w-full h-[38px] p-1 rounded-lg bg-[#111317] border border-white/10"
                />
              </label>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300">Atmosphere Haze</span>
                <span className="font-mono tabular-nums text-slate-400">
                  {Math.round(composition.environment.hazeIntensity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={composition.environment.hazeIntensity}
                onChange={(e) =>
                  dispatchCommand(
                    ProjectCommands.updateEnvironment(composition.id, {
                      hazeIntensity: parseFloat(e.target.value),
                    })
                  )
                }
                className="w-full accent-blue-500 h-2 bg-[#111317] rounded-lg"
              />
            </div>

            <div className="space-y-2 pt-2 border-t border-white/8">
              <label className="block space-y-1">
                <span className="text-[11px] text-slate-400">Weather Particles</span>
                <select
                  value={composition.environment.weatherType}
                  onChange={(e) =>
                    dispatchCommand(
                      ProjectCommands.updateEnvironment(composition.id, {
                        weatherType: e.target.value as WeatherType,
                      })
                    )
                  }
                  className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-100"
                >
                  <option value="none">None</option>
                  <option value="fireflies">Fireflies</option>
                  <option value="rain">Rain</option>
                  <option value="snow">Snow</option>
                  <option value="dust">Floating Dust</option>
                  <option value="leaves">Falling Leaves</option>
                </select>
              </label>

              {composition.environment.weatherType !== 'none' && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">Density</span>
                      <span className="font-mono tabular-nums text-slate-400">
                        {Math.round(composition.environment.weatherDensity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={composition.environment.weatherDensity}
                      onChange={(e) =>
                        dispatchCommand(
                          ProjectCommands.updateEnvironment(composition.id, {
                            weatherDensity: parseFloat(e.target.value),
                          })
                        )
                      }
                      className="w-full accent-blue-500 h-2 bg-[#111317] rounded-lg"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">Particle Speed</span>
                      <span className="font-mono tabular-nums text-slate-400">
                        {composition.environment.weatherSpeed.toFixed(1)}×
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.2}
                      max={4}
                      step={0.1}
                      value={composition.environment.weatherSpeed}
                      onChange={(e) =>
                        dispatchCommand(
                          ProjectCommands.updateEnvironment(composition.id, {
                            weatherSpeed: parseFloat(e.target.value),
                          })
                        )
                      }
                      className="w-full accent-blue-500 h-2 bg-[#111317] rounded-lg"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[10px] text-slate-400">
                        Size ({composition.environment.weatherSize.toFixed(1)}×)
                      </span>
                      <input
                        type="range"
                        min={0.4}
                        max={3}
                        step={0.1}
                        value={composition.environment.weatherSize}
                        onChange={(e) =>
                          dispatchCommand(
                            ProjectCommands.updateEnvironment(composition.id, {
                              weatherSize: parseFloat(e.target.value),
                            })
                          )
                        }
                        className="w-full accent-blue-500 h-1.5 bg-[#111317] rounded-lg"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] text-slate-400">
                        Opacity ({Math.round(composition.environment.weatherOpacity * 100)}%)
                      </span>
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={composition.environment.weatherOpacity}
                        onChange={(e) =>
                          dispatchCommand(
                            ProjectCommands.updateEnvironment(composition.id, {
                              weatherOpacity: parseFloat(e.target.value),
                            })
                          )
                        }
                        className="w-full accent-blue-500 h-1.5 bg-[#111317] rounded-lg"
                      />
                    </label>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">Direction Angle</span>
                      <span className="font-mono tabular-nums text-slate-400">
                        {Math.round(composition.environment.weatherDirectionDeg)}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-75}
                      max={75}
                      step={5}
                      value={composition.environment.weatherDirectionDeg}
                      onChange={(e) =>
                        dispatchCommand(
                          ProjectCommands.updateEnvironment(composition.id, {
                            weatherDirectionDeg: parseInt(e.target.value, 10),
                          })
                        )
                      }
                      className="w-full accent-blue-500 h-1.5 bg-[#111317] rounded-lg"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Atmospheric Layers: Fog, Clouds, Wind Grass */}
            <div className="space-y-2.5 pt-2 border-t border-white/8">
              <div className="text-xs font-semibold text-slate-300">
                Fog, Clouds & Wind Grass
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Fog Overlay</span>
                  <span className="font-mono text-slate-400">
                    {Math.round(composition.environment.fogOpacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={composition.environment.fogOpacity}
                  onChange={(e) =>
                    dispatchCommand(
                      ProjectCommands.updateEnvironment(composition.id, {
                        fogOpacity: parseFloat(e.target.value),
                      })
                    )
                  }
                  className="w-full accent-blue-500 h-1.5 bg-[#111317] rounded-lg"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Moving Clouds</span>
                  <span className="font-mono text-slate-400">
                    {Math.round(composition.environment.cloudDensity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={composition.environment.cloudDensity}
                  onChange={(e) =>
                    dispatchCommand(
                      ProjectCommands.updateEnvironment(composition.id, {
                        cloudDensity: parseFloat(e.target.value),
                      })
                    )
                  }
                  className="w-full accent-blue-500 h-1.5 bg-[#111317] rounded-lg"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Wind-Blown Grass</span>
                  <span className="font-mono text-slate-400">
                    {Math.round(composition.environment.grassDensity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={composition.environment.grassDensity}
                  onChange={(e) =>
                    dispatchCommand(
                      ProjectCommands.updateEnvironment(composition.id, {
                        grassDensity: parseFloat(e.target.value),
                      })
                    )
                  }
                  className="w-full accent-emerald-500 h-1.5 bg-[#111317] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] text-slate-400">Wind Direction</span>
                  <select
                    value={composition.environment.windDirection}
                    onChange={(e) =>
                      dispatchCommand(
                        ProjectCommands.updateEnvironment(composition.id, {
                          windDirection: e.target.value as 'left' | 'right',
                        })
                      )
                    }
                    className="w-full min-h-[34px] px-2 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-200"
                  >
                    <option value="right">Right</option>
                    <option value="left">Left</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] text-slate-400">
                    Wind Strength ({composition.environment.windStrength.toFixed(1)}×)
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={3}
                    step={0.1}
                    value={composition.environment.windStrength}
                    onChange={(e) =>
                      dispatchCommand(
                        ProjectCommands.updateEnvironment(composition.id, {
                          windStrength: parseFloat(e.target.value),
                        })
                      )
                    }
                    className="w-full accent-emerald-500 mt-2"
                  />
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Keep InterpolationType referenced cleanly if expanded later
export type { InterpolationType };
