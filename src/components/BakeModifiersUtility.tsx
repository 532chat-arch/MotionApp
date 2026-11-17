import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Wand2 } from 'lucide-react';
import { ProjectCommands } from '../commands/projectCommands';
import type { MotionModifierInstance } from '../schema/projectSchema';
import { useStudioStore } from '../store/useStudioStore';

interface BakeModifiersUtilityProps {
  compositionId: string;
  targetScope: 'layer' | 'camera';
  layerId?: string;
  modifiers: MotionModifierInstance[];
  defaultStartFrame: number;
  defaultEndFrame: number;
}

const STEP_OPTIONS = [
  { value: 1, label: 'Every 1f (Exact)' },
  { value: 2, label: 'Every 2f (Dense)' },
  { value: 4, label: 'Every 4f (Smooth)' },
  { value: 6, label: 'Every 6f (Balanced)' },
  { value: 12, label: 'Every 12f (Sparse)' },
];

export const BakeModifiersUtility: React.FC<BakeModifiersUtilityProps> = ({
  compositionId,
  targetScope,
  layerId,
  modifiers,
  defaultStartFrame,
  defaultEndFrame,
}) => {
  const { dispatchCommand, showFeedback } = useStudioStore();
  const [expanded, setExpanded] = useState(false);
  const [stepFrames, setStepFrames] = useState(6);
  const [startFrame, setStartFrame] = useState(defaultStartFrame);
  const [endFrame, setEndFrame] = useState(defaultEndFrame);
  const [removeAfterBake, setRemoveAfterBake] = useState(false);

  useEffect(() => {
    setStartFrame(defaultStartFrame);
    setEndFrame(defaultEndFrame);
  }, [compositionId, layerId, defaultStartFrame, defaultEndFrame]);

  const activeModifiers = useMemo(() => modifiers.filter((m) => m.enabled), [modifiers]);

  const clampedStart = Math.max(0, Math.min(startFrame, endFrame));
  const clampedEnd = Math.max(clampedStart, endFrame);

  const estimatedKeyframes = useMemo(() => {
    const span = clampedEnd - clampedStart;
    const baseCount = Math.floor(span / Math.max(1, stepFrames)) + 1;
    return span % Math.max(1, stepFrames) === 0 ? baseCount : baseCount + 1;
  }, [clampedStart, clampedEnd, stepFrames]);

  if (modifiers.length === 0) {
    return null;
  }

  const handleBake = () => {
    if (activeModifiers.length === 0) {
      showFeedback('error', 'Enable at least one modifier to bake to keyframes');
      return;
    }

    const opts = {
      startFrame: clampedStart,
      endFrame: clampedEnd,
      removeModifiersAfterBake: removeAfterBake,
    };

    if (targetScope === 'camera') {
      const ok = dispatchCommand(
        ProjectCommands.bakeCameraModifiersToKeyframes(compositionId, stepFrames, opts)
      );
      if (ok) {
        showFeedback(
          'info',
          `Baked ${activeModifiers.length} camera modifier(s) into ${estimatedKeyframes} keyframes per channel`
        );
      }
      return;
    }

    if (!layerId) return;
    const ok = dispatchCommand(
      ProjectCommands.bakeLayerModifiersToKeyframes(compositionId, layerId, stepFrames, opts)
    );
    if (ok) {
      showFeedback(
        'info',
        `Baked ${activeModifiers.length} modifier(s) into ${estimatedKeyframes} keyframes per channel (F${clampedStart}–F${clampedEnd})`
      );
    }
  };

  return (
    <div className="rounded-xl bg-[#111317] border border-white/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full min-h-[38px] px-2.5 py-2 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
          <Wand2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="text-xs font-medium text-slate-200 truncate">
            Bake Modifiers to Keyframes
          </span>
        </div>
        <span className="text-[10px] font-mono tabular-nums text-slate-400 shrink-0">
          {activeModifiers.length} active
        </span>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 pt-2 border-t border-white/8 space-y-2.5">
          <p className="text-[11px] text-slate-400 leading-snug">
            Sample stacked modifiers into editable timeline keyframes for manual curve or position tuning.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-[10px] text-slate-400">Sample Cadence</span>
              <select
                aria-label="Bake sample cadence"
                value={stepFrames}
                onChange={(e) => setStepFrames(Number(e.target.value))}
                className="w-full min-h-[34px] px-2 rounded-lg bg-[#181B20] border border-white/10 text-xs text-slate-100"
              >
                {STEP_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-1">
              <span className="text-[10px] text-slate-400 block">Output Density</span>
              <div className="min-h-[34px] px-2 rounded-lg bg-[#181B20] border border-white/8 flex items-center text-[11px] font-mono tabular-nums text-blue-300">
                {estimatedKeyframes} kf / ch
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-[10px] text-slate-400">Start Frame</span>
              <input
                type="number"
                min={0}
                max={clampedEnd}
                value={startFrame}
                onChange={(e) => setStartFrame(Math.max(0, Number(e.target.value) || 0))}
                className="w-full min-h-[34px] px-2 rounded-lg bg-[#181B20] border border-white/10 text-xs font-mono tabular-nums text-slate-100"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] text-slate-400">End Frame</span>
              <input
                type="number"
                min={clampedStart}
                value={endFrame}
                onChange={(e) => setEndFrame(Math.max(clampedStart, Number(e.target.value) || 0))}
                className="w-full min-h-[34px] px-2 rounded-lg bg-[#181B20] border border-white/10 text-xs font-mono tabular-nums text-slate-100"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={removeAfterBake}
              onChange={(e) => setRemoveAfterBake(e.target.checked)}
              className="accent-blue-500 rounded"
            />
            <span>Remove modifiers after baking (otherwise disable)</span>
          </label>

          <button
            type="button"
            disabled={activeModifiers.length === 0}
            onClick={handleBake}
            className="w-full min-h-[38px] px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Bake Modifiers to Keyframes</span>
          </button>
        </div>
      )}
    </div>
  );
};
