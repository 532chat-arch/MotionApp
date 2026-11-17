import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Grid,
  Pause,
  Play,
  Plus,
  Save,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-react';
import { ProjectCommands, uid } from '../commands/projectCommands';
import { CharacterClip, CharacterDefinition, FrameRect } from '../schema/projectSchema';
import { useStudioStore } from '../store/useStudioStore';
import {
  computeStringHash,
  probeImageDimensions,
  readFileAsDataUrl,
} from '../utils/mediaImport';

function buildGridFrames(
  rows: number,
  cols: number,
  cellW: number,
  cellH: number,
  marginX: number,
  marginY: number,
  spacingX: number,
  spacingY: number
): FrameRect[] {
  const rects: FrameRect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rects.push({
        x: marginX + c * (cellW + spacingX),
        y: marginY + r * (cellH + spacingY),
        w: cellW,
        h: cellH,
      });
    }
  }
  return rects;
}

export const CharacterStudioWorkspace: React.FC = () => {
  const {
    project,
    activeCompositionId,
    dispatchCommand,
    selectLayer,
    setWorkspace,
    showFeedback,
  } = useStudioStore();

  const [selectedCharId, setSelectedCharId] = useState<string>(
    project.characters[0]?.id ?? ''
  );

  const sourceChar =
    project.characters.find((c) => c.id === selectedCharId) ?? project.characters[0];

  const [draft, setDraft] = useState<CharacterDefinition | null>(
    sourceChar ? structuredClone(sourceChar) : null
  );
  const [activeClipId, setActiveClipId] = useState<string>(
    sourceChar?.clips[0]?.id ?? ''
  );
  const [previewPlaying, setPreviewPlaying] = useState(true);
  const [previewStep, setPreviewStep] = useState(0);

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const sheetInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const found = project.characters.find((c) => c.id === selectedCharId);
    if (found) {
      setDraft(structuredClone(found));
      setActiveClipId(found.clips[0]?.id ?? '');
    }
  }, [selectedCharId, project.characters]);

  const sheetAsset = useMemo(
    () => project.assets.find((a) => a.id === draft?.assetId) ?? null,
    [project.assets, draft?.assetId]
  );

  const activeClip = useMemo(
    () => draft?.clips.find((cl) => cl.id === activeClipId) ?? draft?.clips[0] ?? null,
    [draft, activeClipId]
  );

  // Live animated preview loop
  useEffect(() => {
    if (!previewPlaying || !activeClip || activeClip.frameIndices.length === 0) return;
    const interval = window.setInterval(() => {
      setPreviewStep((s) => (s + 1) % activeClip.frameIndices.length);
    }, Math.max(40, Math.round(1000 / Math.max(1, activeClip.fps))));
    return () => window.clearInterval(interval);
  }, [previewPlaying, activeClip]);

  // Draw current frame onto preview canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !draft || !sheetAsset) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const idx =
        activeClip && activeClip.frameIndices.length > 0
          ? activeClip.frameIndices[previewStep % activeClip.frameIndices.length]
          : 0;
      const rect = draft.frames[idx] ?? draft.frames[0];
      if (!rect) return;
      const scale = Math.min(
        (canvas.width - 24) / rect.w,
        (canvas.height - 24) / rect.h
      );
      const dw = rect.w * scale;
      const dh = rect.h * scale;
      ctx.drawImage(
        img,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        (canvas.width - dw) / 2,
        (canvas.height - dh) / 2,
        dw,
        dh
      );
    };
    img.src = sheetAsset.dataUrl;
  }, [draft, sheetAsset, activeClip, previewStep]);

  const updateGrid = (patch: Partial<CharacterDefinition['grid']>) => {
    if (!draft) return;
    const nextGrid = { ...draft.grid, ...patch };
    const nextFrames = buildGridFrames(
      nextGrid.rows,
      nextGrid.cols,
      nextGrid.cellWidth,
      nextGrid.cellHeight,
      nextGrid.marginX,
      nextGrid.marginY,
      nextGrid.spacingX,
      nextGrid.spacingY
    );
    setDraft({
      ...draft,
      grid: nextGrid,
      frames: nextFrames,
    });
  };

  const handleImportSpriteSheet = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const dims = await probeImageDimensions(dataUrl);
    const hash = await computeStringHash(dataUrl);
    const now = new Date().toISOString();
    const assetId = uid('asset');

    dispatchCommand(
      ProjectCommands.addAsset({
        id: assetId,
        name: file.name.replace(/\.[^.]+$/, ''),
        category: 'characters',
        type: 'spritesheet',
        mimeType: file.type || 'image/png',
        dataUrl,
        width: dims.width,
        height: dims.height,
        hash,
        tags: ['spritesheet', 'character'],
        folder: 'Characters',
        createdAt: now,
        updatedAt: now,
        metadata: {},
      })
    );

    // Heuristic grid auto-detection
    const cols = dims.width >= 512 ? 4 : 2;
    const rows = dims.height >= 256 ? 2 : 1;
    const cellW = Math.max(16, Math.floor(dims.width / cols));
    const cellH = Math.max(16, Math.floor(dims.height / rows));
    const frames = buildGridFrames(rows, cols, cellW, cellH, 0, 0, 0, 0);

    const newChar: CharacterDefinition = {
      id: uid('char'),
      name: file.name.replace(/\.[^.]+$/, ''),
      assetId,
      mode: 'spritesheet',
      grid: {
        rows,
        cols,
        cellWidth: cellW,
        cellHeight: cellH,
        marginX: 0,
        marginY: 0,
        spacingX: 0,
        spacingY: 0,
      },
      frames,
      sequenceAssetIds: [],
      clips: [
        {
          id: uid('clip'),
          name: 'Idle',
          frameIndices: frames.slice(0, Math.min(4, frames.length)).map((_, i) => i),
          fps: 8,
          loop: true,
        },
      ],
    };

    dispatchCommand(ProjectCommands.upsertCharacter(newChar));
    setSelectedCharId(newChar.id);
    setDraft(structuredClone(newChar));
    setActiveClipId(newChar.clips[0].id);
    showFeedback('info', `Imported sprite sheet for "${newChar.name}"`);
    e.target.value = '';
  };

  const handleSaveCharacter = () => {
    if (!draft) return;
    dispatchCommand(ProjectCommands.upsertCharacter(draft));
    showFeedback('info', `Saved character "${draft.name}"`);
  };

  const handlePlaceInstance = () => {
    if (!draft) return;
    dispatchCommand(ProjectCommands.upsertCharacter(draft));
    const comp =
      project.compositions.find((c) => c.id === activeCompositionId) ?? project.compositions[0];
    const layerId = uid('layer');
    dispatchCommand(
      ProjectCommands.addLayer(
        comp.id,
        {
          id: layerId,
          name: draft.name,
          role: 'character',
          visible: true,
          locked: false,
          solo: false,
          opacity: 1,
          blendMode: 'normal',
          depth: 0,
          inFrame: 0,
          outFrame: comp.settings.durationFrames,
          objects: [
            {
              id: uid('obj'),
              name: draft.name,
              kind: 'character',
              characterId: draft.id,
              activeClipId: activeClip?.id ?? draft.clips[0]?.id ?? '',
              clipOffsetFrames: 0,
              playbackSpeed: 1,
              width: Math.min(240, Math.max(96, draft.grid.cellWidth * 1.3)),
              height: Math.min(240, Math.max(96, draft.grid.cellHeight * 1.3)),
              flipX: false,
              transform: {
                x: comp.settings.width / 2,
                y: comp.settings.height / 2,
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
        },
        0
      )
    );
    selectLayer(layerId, 'layer');
    setWorkspace('composition');
    showFeedback('info', `Placed "${draft.name}" instance into ${comp.name}`);
  };

  const toggleFrameInClip = (frameIdx: number) => {
    if (!draft || !activeClip) return;
    const exists = activeClip.frameIndices.includes(frameIdx);
    const nextIndices = exists
      ? activeClip.frameIndices.filter((i) => i !== frameIdx)
      : [...activeClip.frameIndices, frameIdx];

    if (nextIndices.length === 0) return; // keep at least 1 frame

    setDraft({
      ...draft,
      clips: draft.clips.map((c) =>
        c.id === activeClip.id ? { ...c, frameIndices: nextIndices } : c
      ),
    });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row bg-[#111317] overflow-hidden">
      {/* Left Sidebar: Characters & Clips */}
      <aside className="w-full lg:w-72 bg-[#181B20] border-b lg:border-b-0 lg:border-r border-white/10 p-3 flex flex-col gap-3 shrink-0 overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-300">Character Library</span>
          <input
            ref={sheetInputRef}
            type="file"
            accept="image/*"
            onChange={handleImportSpriteSheet}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => sheetInputRef.current?.click()}
            className="min-h-[36px] px-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1 whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            Import Sheet
          </button>
        </div>

        <div className="space-y-1">
          {project.characters.map((ch) => (
            <button
              key={ch.id}
              type="button"
              onClick={() => setSelectedCharId(ch.id)}
              className={`w-full min-h-[42px] px-3 rounded-xl text-left text-xs font-medium flex items-center justify-between border transition-colors ${
                draft?.id === ch.id
                  ? 'bg-blue-600/20 border-blue-500/50 text-white'
                  : 'bg-[#111317] border-white/8 text-slate-300 hover:bg-white/5'
              }`}
            >
              <span className="truncate">{ch.name}</span>
              <span className="text-[10px] text-slate-400 font-mono">
                {ch.clips.length} clips
              </span>
            </button>
          ))}
        </div>

        {draft && (
          <>
            <div className="pt-2 border-t border-white/8 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Animation Clips</span>
                <button
                  type="button"
                  onClick={() => {
                    const newClip: CharacterClip = {
                      id: uid('clip'),
                      name: `Clip ${draft.clips.length + 1}`,
                      frameIndices: [0],
                      fps: 8,
                      loop: true,
                    };
                    setDraft({ ...draft, clips: [...draft.clips, newClip] });
                    setActiveClipId(newClip.id);
                  }}
                  className="min-h-[32px] px-2 rounded-lg bg-[#20242B] text-xs text-blue-400 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Clip
                </button>
              </div>

              <div className="space-y-1">
                {draft.clips.map((cl) => (
                  <div
                    key={cl.id}
                    onClick={() => setActiveClipId(cl.id)}
                    className={`min-h-[40px] px-2.5 py-1.5 rounded-xl flex items-center justify-between gap-2 cursor-pointer border text-xs ${
                      activeClip?.id === cl.id
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                        : 'bg-[#111317] border-white/8 text-slate-300'
                    }`}
                  >
                    <span className="truncate font-medium">{cl.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] font-mono text-slate-400">
                        {cl.frameIndices.length}f · {cl.fps}fps
                      </span>
                      {draft.clips.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const remaining = draft.clips.filter((c) => c.id !== cl.id);
                            setDraft({ ...draft, clips: remaining });
                            if (activeClip?.id === cl.id) setActiveClipId(remaining[0].id);
                          }}
                          className="text-slate-400 hover:text-red-400 p-1"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {activeClip && (
              <div className="pt-2 border-t border-white/8 space-y-2 text-xs">
                <label className="block space-y-1">
                  <span className="text-[11px] text-slate-400">Clip Name</span>
                  <input
                    type="text"
                    value={activeClip.name}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        clips: draft.clips.map((c) =>
                          c.id === activeClip.id ? { ...c, name: e.target.value } : c
                        ),
                      })
                    }
                    className="w-full min-h-[36px] px-2.5 rounded-lg bg-[#111317] border border-white/10 text-slate-100"
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">Clip FPS</span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={activeClip.fps}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          clips: draft.clips.map((c) =>
                            c.id === activeClip.id
                              ? { ...c, fps: Math.max(1, Number(e.target.value) || 8) }
                              : c
                          ),
                        })
                      }
                      className="w-full min-h-[36px] px-2.5 rounded-lg bg-[#111317] border border-white/10 font-mono text-slate-100"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">Looping</span>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          clips: draft.clips.map((c) =>
                            c.id === activeClip.id ? { ...c, loop: !c.loop } : c
                          ),
                        })
                      }
                      className={`w-full min-h-[36px] rounded-lg border font-medium ${
                        activeClip.loop
                          ? 'bg-blue-600/20 border-blue-500/40 text-blue-200'
                          : 'bg-[#111317] border-white/10 text-slate-400'
                      }`}
                    >
                      {activeClip.loop ? 'Loop On' : 'Play Once'}
                    </button>
                  </label>
                </div>
              </div>
            )}
          </>
        )}
      </aside>

      {/* Main Sprite Sheet Slicer & Live Preview */}
      {!draft ? (
        <div className="flex-1 flex items-center justify-center p-8 text-sm text-slate-400">
          Import a sprite sheet image to slice animation frames and build a reusable Character.
        </div>
      ) : (
        <div className="flex-1 min-w-0 flex flex-col overflow-y-auto p-4 sm:p-6 gap-5">
          {/* Header Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="min-h-[40px] px-3 rounded-xl bg-[#181B20] border border-white/10 text-sm font-semibold text-white"
              />
              <span className="text-xs text-slate-400 font-mono tabular-nums">
                {draft.frames.length} sliced frames
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveCharacter}
                className="min-h-[42px] px-4 rounded-xl bg-[#20242B] hover:bg-[#2A2F38] border border-white/10 text-xs font-semibold text-slate-100 flex items-center gap-1.5"
              >
                <Save className="w-4 h-4 text-emerald-400" />
                Save Character
              </button>
              <button
                type="button"
                onClick={handlePlaceInstance}
                className="min-h-[42px] px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white flex items-center gap-1.5"
              >
                <UserPlus className="w-4 h-4" />
                Place in Scene
              </button>
            </div>
          </div>

          {/* Preview + Grid Controls Row */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Animated Preview Card */}
            <div className="rounded-2xl bg-[#181B20] border border-white/8 p-4 flex flex-col items-center justify-center gap-3">
              <div className="w-full flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">
                  Clip Preview: {activeClip?.name ?? 'None'}
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewPlaying((p) => !p)}
                  className="min-h-[34px] px-3 rounded-lg bg-[#111317] border border-white/10 text-slate-200 flex items-center gap-1.5"
                >
                  {previewPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  {previewPlaying ? 'Pause' : 'Play'}
                </button>
              </div>
              <canvas
                ref={previewCanvasRef}
                width={260}
                height={220}
                className="rounded-xl bg-[#111317] border border-white/8"
              />
            </div>

            {/* Grid Slicing Parameters */}
            <div className="rounded-2xl bg-[#181B20] border border-white/8 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Grid className="w-4 h-4 text-blue-400" />
                Sprite-Sheet Grid Slicing
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Rows</span>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={draft.grid.rows}
                    onChange={(e) => updateGrid({ rows: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 font-mono text-slate-100"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Columns</span>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={draft.grid.cols}
                    onChange={(e) => updateGrid({ cols: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 font-mono text-slate-100"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Cell Width</span>
                  <input
                    type="number"
                    min={8}
                    max={1024}
                    value={draft.grid.cellWidth}
                    onChange={(e) =>
                      updateGrid({ cellWidth: Math.max(8, Number(e.target.value) || 64) })
                    }
                    className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 font-mono text-slate-100"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Cell Height</span>
                  <input
                    type="number"
                    min={8}
                    max={1024}
                    value={draft.grid.cellHeight}
                    onChange={(e) =>
                      updateGrid({ cellHeight: Math.max(8, Number(e.target.value) || 64) })
                    }
                    className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 font-mono text-slate-100"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Margin X</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.grid.marginX}
                    onChange={(e) => updateGrid({ marginX: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 font-mono text-slate-100"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Margin Y</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.grid.marginY}
                    onChange={(e) => updateGrid({ marginY: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 font-mono text-slate-100"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Spacing X</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.grid.spacingX}
                    onChange={(e) => updateGrid({ spacingX: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 font-mono text-slate-100"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Spacing Y</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.grid.spacingY}
                    onChange={(e) => updateGrid({ spacingY: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 font-mono text-slate-100"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Interactive Frame Selector Grid */}
          <div className="rounded-2xl bg-[#181B20] border border-white/8 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">
                Extracted Frames — Tap frames to include/exclude in "{activeClip?.name}"
              </span>
              <span className="font-mono text-amber-400">
                Sequence: [{activeClip?.frameIndices.join(', ')}]
              </span>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2.5">
              {draft.frames.map((rect, idx) => {
                const included = activeClip?.frameIndices.includes(idx) ?? false;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleFrameInClip(idx)}
                    className={`p-2 rounded-xl border flex flex-col items-center gap-1.5 transition-colors ${
                      included
                        ? 'bg-blue-600/20 border-blue-500 text-white'
                        : 'bg-[#111317] border-white/8 text-slate-400 hover:border-white/20'
                    }`}
                  >
                    <div className="w-16 h-16 overflow-hidden flex items-center justify-center relative bg-[#0B0D10] rounded-lg">
                      {sheetAsset && (
                        <div
                          style={{
                            width: rect.w,
                            height: rect.h,
                            backgroundImage: `url("${sheetAsset.dataUrl}")`,
                            backgroundPosition: `-${rect.x}px -${rect.y}px`,
                            backgroundRepeat: 'no-repeat',
                            transform: `scale(${Math.min(56 / rect.w, 56 / rect.h)})`,
                            transformOrigin: 'center',
                          }}
                        />
                      )}
                    </div>
                    <span className="text-[10px] font-mono tabular-nums">F{idx}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
