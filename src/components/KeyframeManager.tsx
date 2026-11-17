import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Diamond, Plus, Trash2 } from 'lucide-react';
import { evaluateKeyframes } from '../engine/evaluator';
import { InterpolationType, Keyframe } from '../schema/projectSchema';

export interface KeyframeChannel {
  key: string;
  label: string;
  shortLabel: string;
  unit?: string;
  step: number;
  min?: number;
  max?: number;
  keyframes: Keyframe[];
  currentValue: number;
  toDisplay?: (internalValue: number) => number;
  fromDisplay?: (displayValue: number) => number;
}

interface KeyframeManagerProps {
  title?: string;
  channels: KeyframeChannel[];
  currentFrame: number;
  durationFrames: number;
  selectedChannelKey?: string;
  selectedKeyframeId?: string | null;
  onSelectChannelKey?: (key: string) => void;
  onSelectKeyframe?: (channelKey: string, kfId: string, frame: number) => void;
  onJumpToFrame: (frame: number) => void;
  onSetKeyframe: (
    channelKey: string,
    frame: number,
    value: number,
    interpolation: InterpolationType
  ) => void;
  onUpdateKeyframe: (
    channelKey: string,
    keyframeId: string,
    patch: { frame?: number; value?: number; interpolation?: InterpolationType }
  ) => void;
  onDeleteKeyframe: (channelKey: string, keyframeId: string) => void;
  onClearChannel?: (channelKey: string) => void;
}

const INTERPOLATION_OPTIONS: {
  value: InterpolationType;
  label: string;
  shortLabel: string;
}[] = [
  { value: 'linear', label: 'Linear', shortLabel: 'Linear' },
  { value: 'easeIn', label: 'Ease-In', shortLabel: 'Ease-In' },
  { value: 'easeOut', label: 'Ease-Out', shortLabel: 'Ease-Out' },
  { value: 'easeInOut', label: 'Ease-In-Out', shortLabel: 'In-Out' },
  { value: 'hold', label: 'Hold (Step)', shortLabel: 'Hold' },
];

const CurveGlyph: React.FC<{ mode: InterpolationType; className?: string }> = ({
  mode,
  className = 'w-4 h-3',
}) => {
  let d = 'M 2 10 L 14 2';
  if (mode === 'easeInOut') d = 'M 2 10 C 7 10, 9 2, 14 2';
  else if (mode === 'easeIn') d = 'M 2 10 C 8 10, 12 7, 14 2';
  else if (mode === 'easeOut') d = 'M 2 10 C 4 5, 8 2, 14 2';
  else if (mode === 'hold') d = 'M 2 10 L 9 10 L 9 2 L 14 2';

  return (
    <svg viewBox="0 0 16 12" fill="none" className={className} aria-hidden="true">
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const KeyframeManager: React.FC<KeyframeManagerProps> = ({
  title = 'Keyframes & Interpolation',
  channels,
  currentFrame,
  durationFrames,
  selectedChannelKey,
  selectedKeyframeId,
  onSelectChannelKey,
  onSelectKeyframe,
  onJumpToFrame,
  onSetKeyframe,
  onUpdateKeyframe,
  onDeleteKeyframe,
  onClearChannel,
}) => {
  const [internalChannel, setInternalChannel] = useState<string>(channels[0]?.key ?? 'all');
  const [defaultInterp, setDefaultInterp] = useState<InterpolationType>('easeInOut');

  const activeFilter = selectedChannelKey ?? internalChannel;
  const setFilter = (next: string) => {
    setInternalChannel(next);
    onSelectChannelKey?.(next);
  };

  // Resolve explicit selected keyframe across channels if present
  const explicitSelection = useMemo(() => {
    if (!selectedKeyframeId) return null;
    for (const ch of channels) {
      const sorted = [...ch.keyframes].sort((a, b) => a.frame - b.frame);
      const idx = sorted.findIndex((k) => k.id === selectedKeyframeId);
      if (idx >= 0) {
        return {
          channel: ch,
          kf: sorted[idx],
          nextKf: sorted[idx + 1] ?? null,
        };
      }
    }
    return null;
  }, [channels, selectedKeyframeId]);

  // Single channel used for adding points & drawing the visual curve
  const activeChannel =
    explicitSelection?.channel ??
    channels.find((c) => c.key === activeFilter) ??
    channels.find((c) => c.keyframes.length > 0) ??
    channels[0];

  // Resolve the active transition keyframe (explicit selection -> currentFrame -> enclosing segment start -> first keyframe)
  const activeTransition = useMemo(() => {
    if (explicitSelection) return explicitSelection;
    if (!activeChannel || activeChannel.keyframes.length === 0) return null;
    const sorted = [...activeChannel.keyframes].sort((a, b) => a.frame - b.frame);
    const exactIdx = sorted.findIndex((k) => k.frame === currentFrame);
    if (exactIdx >= 0) {
      return {
        channel: activeChannel,
        kf: sorted[exactIdx],
        nextKf: sorted[exactIdx + 1] ?? null,
      };
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      if (currentFrame >= sorted[i].frame && currentFrame <= sorted[i + 1].frame) {
        return {
          channel: activeChannel,
          kf: sorted[i],
          nextKf: sorted[i + 1],
        };
      }
    }
    return {
      channel: activeChannel,
      kf: sorted[0],
      nextKf: sorted[1] ?? null,
    };
  }, [explicitSelection, activeChannel, currentFrame]);

  const allSortedFrames = useMemo(() => {
    const frames = new Set<number>();
    const targetChannels =
      activeFilter === 'all' ? channels : channels.filter((c) => c.key === activeFilter);
    for (const ch of targetChannels) {
      for (const kf of ch.keyframes) {
        frames.add(kf.frame);
      }
    }
    return [...frames].sort((a, b) => a - b);
  }, [channels, activeFilter]);

  const prevKeyframeFrame = useMemo(() => {
    for (let i = allSortedFrames.length - 1; i >= 0; i--) {
      if (allSortedFrames[i] < currentFrame) return allSortedFrames[i];
    }
    return null;
  }, [allSortedFrames, currentFrame]);

  const nextKeyframeFrame = useMemo(() => {
    for (let i = 0; i < allSortedFrames.length; i++) {
      if (allSortedFrames[i] > currentFrame) return allSortedFrames[i];
    }
    return null;
  }, [allSortedFrames, currentFrame]);

  const visibleKeyframes = useMemo(() => {
    const list: { channel: KeyframeChannel; kf: Keyframe }[] = [];
    const targetChannels =
      activeFilter === 'all' ? channels : channels.filter((c) => c.key === activeFilter);
    for (const ch of targetChannels) {
      for (const kf of ch.keyframes) {
        list.push({ channel: ch, kf });
      }
    }
    return list.sort((a, b) => a.kf.frame - b.kf.frame);
  }, [channels, activeFilter]);

  // Mini SVG curve preview for activeChannel across [0, maxFrame]
  const curveData = useMemo(() => {
    if (!activeChannel) return null;
    const maxF = Math.max(1, durationFrames - 1);
    const kfs = [...activeChannel.keyframes].sort((a, b) => a.frame - b.frame);
    const toDisp = activeChannel.toDisplay ?? ((v: number) => v);

    const sampleCount = 56;
    const samples: { frame: number; val: number }[] = [];
    for (let i = 0; i <= sampleCount; i++) {
      const f = (i / sampleCount) * maxF;
      const raw = evaluateKeyframes(kfs, f, activeChannel.currentValue);
      samples.push({ frame: f, val: toDisp(raw) });
    }

    const vals = samples.map((s) => s.val).concat(kfs.map((k) => toDisp(k.value)));
    let minV = Math.min(...vals);
    let maxV = Math.max(...vals);
    if (Math.abs(maxV - minV) < 1e-4) {
      minV -= 1;
      maxV += 1;
    }
    const padV = (maxV - minV) * 0.14;
    minV -= padV;
    maxV += padV;

    const svgW = 220;
    const svgH = 50;
    const toX = (f: number) => 6 + (Math.min(maxF, Math.max(0, f)) / maxF) * (svgW - 12);
    const toY = (v: number) => svgH - 6 - ((v - minV) / (maxV - minV)) * (svgH - 12);

    const pathD = samples
      .map((s, idx) => `${idx === 0 ? 'M' : 'L'} ${toX(s.frame).toFixed(1)} ${toY(s.val).toFixed(1)}`)
      .join(' ');

    // Highlight active transition segment [k0 -> k1]
    let segmentPathD: string | null = null;
    if (
      activeTransition &&
      activeTransition.channel.key === activeChannel.key &&
      activeTransition.nextKf
    ) {
      const f0 = activeTransition.kf.frame;
      const f1 = activeTransition.nextKf.frame;
      if (f1 > f0) {
        const segSteps = 20;
        const pts: string[] = [];
        for (let i = 0; i <= segSteps; i++) {
          const sf = f0 + ((f1 - f0) * i) / segSteps;
          const raw = evaluateKeyframes(kfs, sf, activeChannel.currentValue);
          pts.push(`${i === 0 ? 'M' : 'L'} ${toX(sf).toFixed(1)} ${toY(toDisp(raw)).toFixed(1)}`);
        }
        segmentPathD = pts.join(' ');
      }
    }

    const nodes = kfs.map((kf) => ({
      kf,
      x: toX(kf.frame),
      y: toY(toDisp(kf.value)),
      isCurrent: kf.frame === currentFrame,
      isSelected: activeTransition?.kf.id === kf.id,
    }));

    return {
      svgW,
      svgH,
      pathD,
      segmentPathD,
      nodes,
      playheadX: toX(currentFrame),
    };
  }, [activeChannel, activeTransition, durationFrames, currentFrame]);

  if (!activeChannel) return null;

  const existingAtCurrent = activeChannel.keyframes.find((k) => k.frame === currentFrame);

  return (
    <div className="space-y-2 pb-2.5 border-b border-white/8">
      {/* Header + Prev/Next Keyframe Jump */}
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-semibold text-slate-300 truncate">{title}</span>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            disabled={prevKeyframeFrame === null}
            onClick={() => prevKeyframeFrame !== null && onJumpToFrame(prevKeyframeFrame)}
            title="Jump to previous keyframe"
            aria-label="Previous keyframe"
            className="h-6 w-6 rounded flex items-center justify-center text-slate-300 hover:bg-white/8 disabled:opacity-25"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-mono tabular-nums text-slate-400 px-1">
            {visibleKeyframes.length}
          </span>
          <button
            type="button"
            disabled={nextKeyframeFrame === null}
            onClick={() => nextKeyframeFrame !== null && onJumpToFrame(nextKeyframeFrame)}
            title="Jump to next keyframe"
            aria-label="Next keyframe"
            className="h-6 w-6 rounded flex items-center justify-center text-slate-300 hover:bg-white/8 disabled:opacity-25"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Property Filter Tabs */}
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`h-6 px-2 rounded-md text-[10px] font-medium transition-colors ${
            activeFilter === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-[#111317] text-slate-400 hover:text-slate-200 border border-white/8'
          }`}
        >
          All
        </button>
        {channels.map((ch) => {
          const isActive = activeFilter === ch.key;
          const hasKfs = ch.keyframes.length > 0;
          return (
            <button
              key={ch.key}
              type="button"
              onClick={() => setFilter(ch.key)}
              className={`h-6 px-1.5 rounded-md text-[10px] font-medium flex items-center gap-1 transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#111317] text-slate-400 hover:text-slate-200 border border-white/8'
              }`}
            >
              <span>{ch.shortLabel}</span>
              {hasKfs && (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isActive ? 'bg-amber-300' : 'bg-amber-400'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Mini Curve Visualizer across Composition Timeline */}
      {curveData && (
        <div className="rounded-lg bg-[#111317] border border-white/8 p-1.5">
          <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1 px-0.5">
            <span className="truncate font-medium text-slate-300">
              {activeChannel.label} Curve
            </span>
            {activeChannel.keyframes.length > 0 && onClearChannel && (
              <button
                type="button"
                onClick={() => onClearChannel(activeChannel.key)}
                className="text-[10px] text-slate-500 hover:text-red-400"
              >
                Clear
              </button>
            )}
          </div>
          <svg
            viewBox={`0 0 ${curveData.svgW} ${curveData.svgH}`}
            className="w-full h-12 block overflow-visible"
          >
            {/* Playhead guide */}
            <line
              x1={curveData.playheadX}
              y1={2}
              x2={curveData.playheadX}
              y2={curveData.svgH - 2}
              stroke="rgba(251, 191, 36, 0.5)"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
            {/* Full evaluated interpolation curve */}
            <path
              d={curveData.pathD}
              fill="none"
              stroke={activeChannel.keyframes.length > 0 ? '#60A5FA' : 'rgba(148,163,184,0.28)'}
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            {/* Selected transition segment highlight */}
            {curveData.segmentPathD && (
              <path
                d={curveData.segmentPathD}
                fill="none"
                stroke="#F59E0B"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            )}
            {/* Keyframe diamonds */}
            {curveData.nodes.map((node) => (
              <g
                key={node.kf.id}
                onClick={() => {
                  onSelectKeyframe?.(activeChannel.key, node.kf.id, node.kf.frame);
                  onJumpToFrame(node.kf.frame);
                }}
                className="cursor-pointer"
              >
                <title>{`${activeChannel.label} @ F${node.kf.frame} (${node.kf.interpolation})`}</title>
                {node.isSelected && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={6.5}
                    fill="none"
                    stroke="rgba(245, 158, 11, 0.65)"
                    strokeWidth="1.2"
                  />
                )}
                <rect
                  x={node.x - 3.5}
                  y={node.y - 3.5}
                  width={7}
                  height={7}
                  rx={1}
                  transform={`rotate(45 ${node.x} ${node.y})`}
                  fill={node.isCurrent || node.isSelected ? '#FFFFFF' : '#F59E0B'}
                  stroke={node.isCurrent || node.isSelected ? '#F59E0B' : '#111317'}
                  strokeWidth="1.2"
                />
              </g>
            ))}
          </svg>
        </div>
      )}

      {/* Selected Keyframe Transition Easing Function Selector */}
      {activeTransition && (
        <div
          aria-label="Selected keyframe transition easing"
          className="rounded-lg bg-[#111317] border border-white/10 p-1.5 space-y-1.5"
        >
          <div className="flex items-center justify-between gap-1 text-[10px]">
            <span className="font-medium text-slate-300 truncate">
              Transition Easing
            </span>
            <span className="font-mono tabular-nums text-amber-400 shrink-0">
              {activeTransition.nextKf
                ? `F${activeTransition.kf.frame} → F${activeTransition.nextKf.frame}`
                : `F${activeTransition.kf.frame} (End)`}
            </span>
          </div>

          <div className="grid grid-cols-5 gap-1">
            {INTERPOLATION_OPTIONS.map((opt) => {
              const selected = activeTransition.kf.interpolation === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    onUpdateKeyframe(activeTransition.channel.key, activeTransition.kf.id, {
                      interpolation: opt.value,
                    })
                  }
                  title={`Apply ${opt.label} curve to transition`}
                  aria-pressed={selected}
                  className={`py-1 px-0.5 rounded-md border flex flex-col items-center justify-center gap-0.5 transition-colors ${
                    selected
                      ? 'bg-amber-500/20 border-amber-400/60 text-amber-300'
                      : 'bg-[#181B20] border-white/8 text-slate-400 hover:text-slate-200 hover:border-white/20'
                  }`}
                >
                  <CurveGlyph mode={opt.value} className="w-3.5 h-2.5" />
                  <span className="text-[9px] leading-none font-medium truncate max-w-full">
                    {opt.shortLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Set / Update Keyframe Point at Current Frame */}
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1 flex-1 min-w-0 h-7 px-1.5 rounded-lg bg-[#111317] border border-white/10">
          <CurveGlyph
            mode={existingAtCurrent?.interpolation ?? defaultInterp}
            className="w-3.5 h-3 text-blue-400 shrink-0"
          />
          <select
            aria-label="Easing preset for new keyframe"
            value={existingAtCurrent?.interpolation ?? defaultInterp}
            onChange={(e) => {
              const mode = e.target.value as InterpolationType;
              setDefaultInterp(mode);
              if (existingAtCurrent) {
                onUpdateKeyframe(activeChannel.key, existingAtCurrent.id, { interpolation: mode });
              }
            }}
            className="flex-1 min-w-0 bg-transparent text-[11px] text-slate-200 focus:outline-none"
          >
            {INTERPOLATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-[#181B20]">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() =>
            onSetKeyframe(
              activeChannel.key,
              currentFrame,
              activeChannel.currentValue,
              existingAtCurrent?.interpolation ?? defaultInterp
            )
          }
          className="h-7 px-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0"
        >
          {existingAtCurrent ? (
            <Diamond className="w-3 h-3 fill-amber-400" />
          ) : (
            <Plus className="w-3 h-3" />
          )}
          <span>{existingAtCurrent ? `Update F${currentFrame}` : `Key ${activeChannel.shortLabel}`}</span>
        </button>
      </div>

      {/* Keyframe Points List */}
      {visibleKeyframes.length === 0 ? (
        <div className="py-2 text-center text-[11px] text-slate-500">
          No interpolation points on {activeFilter === 'all' ? 'this target' : activeChannel.label}.
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto space-y-1 pr-0.5">
          {visibleKeyframes.map(({ channel, kf }) => {
            const toDisp = channel.toDisplay ?? ((v: number) => v);
            const fromDisp = channel.fromDisplay ?? ((v: number) => v);
            const displayVal = Number(toDisp(kf.value).toFixed(2));
            const isAtCurrent = kf.frame === currentFrame;
            const isSelectedRow = activeTransition?.kf.id === kf.id;

            return (
              <div
                key={`${channel.key}-${kf.id}`}
                onClick={() => onSelectKeyframe?.(channel.key, kf.id, kf.frame)}
                className={`p-1.5 rounded-lg border space-y-1 transition-colors cursor-pointer ${
                  isSelectedRow
                    ? 'bg-amber-500/12 border-amber-400/50'
                    : isAtCurrent
                    ? 'bg-amber-500/8 border-amber-500/30'
                    : 'bg-[#111317] border-white/8 hover:border-white/15'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectKeyframe?.(channel.key, kf.id, kf.frame);
                        onJumpToFrame(kf.frame);
                      }}
                      title={`Jump playhead to Frame ${kf.frame}`}
                      className={`h-5 px-1.5 rounded text-[10px] font-mono tabular-nums flex items-center gap-1 shrink-0 ${
                        isAtCurrent || isSelectedRow
                          ? 'bg-amber-500 text-slate-950 font-bold'
                          : 'bg-[#1C2027] text-amber-300 hover:bg-white/10'
                      }`}
                    >
                      <Diamond className="w-2.5 h-2.5 fill-current" />
                      F{kf.frame}
                    </button>
                    {activeFilter === 'all' && (
                      <span className="text-[10px] font-medium text-slate-300 truncate">
                        {channel.shortLabel}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center rounded bg-[#181B20] border border-white/10 px-1">
                      <input
                        type="number"
                        aria-label={`${channel.label} value at frame ${kf.frame}`}
                        value={displayVal}
                        step={channel.step}
                        min={channel.min !== undefined ? toDisp(channel.min) : undefined}
                        max={channel.max !== undefined ? toDisp(channel.max) : undefined}
                        onChange={(e) => {
                          const parsed = parseFloat(e.target.value);
                          if (!Number.isNaN(parsed)) {
                            let internal = fromDisp(parsed);
                            if (channel.min !== undefined) internal = Math.max(channel.min, internal);
                            if (channel.max !== undefined) internal = Math.min(channel.max, internal);
                            onUpdateKeyframe(channel.key, kf.id, { value: internal });
                          }
                        }}
                        className="w-12 h-5 bg-transparent text-[10px] font-mono tabular-nums text-right text-slate-100 focus:outline-none"
                      />
                      {channel.unit && (
                        <span className="text-[9px] font-mono text-slate-400 ml-0.5">
                          {channel.unit}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onDeleteKeyframe(channel.key, kf.id)}
                      aria-label={`Delete ${channel.label} keyframe at frame ${kf.frame}`}
                      className="h-5 w-5 rounded flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Frame shift + Outgoing Interpolation Curve */}
                <div className="flex items-center justify-between gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <label className="flex items-center gap-1 text-[10px] text-slate-400">
                    <span>Fr</span>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, durationFrames - 1)}
                      value={kf.frame}
                      onChange={(e) => {
                        const f = parseInt(e.target.value, 10);
                        if (!Number.isNaN(f)) {
                          const clamped = Math.max(0, Math.min(durationFrames - 1, f));
                          onUpdateKeyframe(channel.key, kf.id, { frame: clamped });
                        }
                      }}
                      className="w-10 h-5 px-1 rounded bg-[#181B20] border border-white/10 text-[10px] font-mono tabular-nums text-slate-200 focus:outline-none"
                    />
                  </label>

                  <div className="flex items-center gap-1 flex-1 min-w-0 h-5 px-1 rounded bg-[#181B20] border border-white/10">
                    <CurveGlyph mode={kf.interpolation} className="w-3 h-2.5 text-blue-400 shrink-0" />
                    <select
                      aria-label={`Easing from frame ${kf.frame}`}
                      value={kf.interpolation}
                      onChange={(e) =>
                        onUpdateKeyframe(channel.key, kf.id, {
                          interpolation: e.target.value as InterpolationType,
                        })
                      }
                      className="flex-1 min-w-0 bg-transparent text-[10px] text-slate-200 focus:outline-none"
                    >
                      {INTERPOLATION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-[#181B20]">
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
