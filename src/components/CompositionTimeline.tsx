import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  Diamond,
  Film,
  Music,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  SkipForward,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { WebAudioEngine } from '../audio/WebAudioEngine';
import { ProjectCommands, uid } from '../commands/projectCommands';
import { evaluateCompositionAtFrame } from '../engine/evaluator';
import { Canvas2DRenderer } from '../renderer/Canvas2DRenderer';
import { InterpolationType, LayerAnimatableProp } from '../schema/projectSchema';
import { formatTimecode, getActiveCompFps, useStudioStore } from '../store/useStudioStore';
import { computeStringHash, probeAudioDuration, readFileAsDataUrl } from '../utils/mediaImport';

interface CompositionTimelineProps {
  audioEngine: WebAudioEngine;
}

const KEYFRAME_PROPS: LayerAnimatableProp[] = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'];

export const CompositionTimeline: React.FC<CompositionTimelineProps> = ({ audioEngine }) => {
  const {
    project,
    activeCompositionId,
    selectedLayerId,
    selectedKeyframe,
    currentFrame,
    isPlaying,
    loopPlayback,
    copiedKeyframes,
    selectLayer,
    setSelectedKeyframe,
    setCurrentFrame,
    stepFrame,
    setIsPlaying,
    toggleLoop,
    dispatchCommand,
    copyKeyframesAtCurrentFrame,
    pasteKeyframesAtCurrentFrame,
    showFeedback,
  } = useStudioStore();

  const composition =
    project.compositions.find((c) => c.id === activeCompositionId) ?? project.compositions[0];
  const fps = getActiveCompFps(project, composition.id);
  const totalFrames = composition.settings.durationFrames;

  const [collapsed, setCollapsed] = useState(false);
  const [heightPx, setHeightPx] = useState(184);
  const [timelineTab, setTimelineTab] = useState<'layers' | 'audio'>('layers');
  const [zoomPxPerFrame, setZoomPxPerFrame] = useState(5);
  const [peaksTick, setPeaksTick] = useState(0);
  const [previewDecodeTick, setPreviewDecodeTick] = useState(0);
  const [hoverPreview, setHoverPreview] = useState<{
    frame: number;
    viewportX: number;
    rulerTop: number;
  } | null>(null);

  const trackScrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const isScrubbingRef = useRef(false);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const previewRenderer = useMemo(
    () => new Canvas2DRenderer(() => setPreviewDecodeTick((t) => t + 1)),
    []
  );

  useEffect(() => {
    return () => {
      previewRenderer.dispose();
    };
  }, [previewRenderer]);

  // Decode audio assets so waveforms appear immediately
  useEffect(() => {
    let active = true;
    const decodeAll = async () => {
      for (const track of composition.audioTracks) {
        for (const clip of track.clips) {
          const asset = project.assets.find((a) => a.id === clip.assetId);
          if (asset) {
            await audioEngine.decodeAsset(asset);
            if (active) setPeaksTick((t) => t + 1);
          }
        }
      }
    };
    void decodeAll();
    return () => {
      active = false;
    };
  }, [composition.audioTracks, project.assets, audioEngine]);

  const timelineWidth = Math.max(600, totalFrames * zoomPxPerFrame);

  // Drag resizer for timeline height
  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = heightPx;
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(130, Math.min(400, startH + (startY - ev.clientY)));
      setHeightPx(next);
      if (collapsed) setCollapsed(false);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const previewSize = useMemo(() => {
    const w = 160;
    const ratio = composition.settings.height / Math.max(1, composition.settings.width);
    const h = Math.max(72, Math.min(120, Math.round(w * ratio)));
    return { w, h };
  }, [composition.settings.width, composition.settings.height]);

  // Render hovered scrubber frame thumbnail whenever hovered frame or project changes
  useEffect(() => {
    if (!hoverPreview || !previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    const renderW = previewSize.w * 2;
    const renderH = previewSize.h * 2;
    if (canvas.width !== renderW || canvas.height !== renderH) {
      canvas.width = renderW;
      canvas.height = renderH;
    }
    const state = evaluateCompositionAtFrame(project, composition.id, hoverPreview.frame);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, renderW, renderH);
    if (state) {
      const off = previewRenderer.renderCompositionToImageData(project, state, renderW, renderH);
      ctx.drawImage(off, 0, 0);
    }
  }, [hoverPreview?.frame, project, composition.id, previewSize, previewRenderer, previewDecodeTick]);

  const computeHoverFromPointer = (clientX: number, targetEl: HTMLElement) => {
    const rect = targetEl.getBoundingClientRect();
    const x = Math.max(0, clientX - rect.left);
    const frame = Math.max(0, Math.min(totalFrames - 1, Math.round(x / zoomPxPerFrame)));
    return {
      frame,
      viewportX: Math.max(rect.left, Math.min(rect.right, clientX)),
      rulerTop: rect.top,
    };
  };

  const handleRulerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isScrubbingRef.current) return;
    setHoverPreview(computeHoverFromPointer(e.clientX, e.currentTarget));
  };

  const handleRulerPointerLeave = () => {
    if (!isScrubbingRef.current) {
      setHoverPreview(null);
    }
  };

  // Ruler scrub
  const handleRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isScrubbingRef.current = true;
    const rulerEl = e.currentTarget;
    const updateFrame = (clientX: number) => {
      const next = computeHoverFromPointer(clientX, rulerEl);
      setCurrentFrame(next.frame);
      setHoverPreview(next);
    };
    updateFrame(e.clientX);

    const onMove = (ev: PointerEvent) => updateFrame(ev.clientX);
    const onUp = (ev: PointerEvent) => {
      isScrubbingRef.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const rect = rulerEl.getBoundingClientRect();
      const inside =
        ev.pointerType === 'mouse' &&
        ev.clientX >= rect.left &&
        ev.clientX <= rect.right &&
        ev.clientY >= rect.top &&
        ev.clientY <= rect.bottom;
      if (!inside) {
        setHoverPreview(null);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const activeLayerKf = useMemo(() => {
    if (!selectedKeyframe || selectedKeyframe.scope !== 'layer') return null;
    const layer = composition.layers.find((l) => l.id === selectedKeyframe.targetId);
    if (!layer) return null;
    const prop = selectedKeyframe.prop as LayerAnimatableProp;
    const kf = layer.keyframes[prop]?.find((k) => k.id === selectedKeyframe.kfId);
    if (!kf) return null;
    return { layerId: layer.id, prop, kf };
  }, [selectedKeyframe, composition.layers]);

  const handleKeyframePointerDown = (
    e: React.PointerEvent,
    layerId: string,
    prop: LayerAnimatableProp,
    kfId: string,
    origFrame: number
  ) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (selectedLayerId !== layerId) {
      selectLayer(layerId, 'layer');
    }
    setSelectedKeyframe({ scope: 'layer', targetId: layerId, prop, kfId });
    setCurrentFrame(origFrame);

    const startX = e.clientX;
    let moved = false;
    let latestFrame = origFrame;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      latestFrame = Math.max(0, Math.min(totalFrames - 1, origFrame + Math.round(dx / zoomPxPerFrame)));
      if (moved) {
        setCurrentFrame(latestFrame);
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved && latestFrame !== origFrame) {
        dispatchCommand(
          ProjectCommands.moveLayerKeyframe(composition.id, layerId, prop, kfId, latestFrame)
        );
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleAudioFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const durationSec = await probeAudioDuration(dataUrl);
    const hash = await computeStringHash(dataUrl);
    const now = new Date().toISOString();
    const assetId = uid('asset');

    dispatchCommand(
      ProjectCommands.addAsset({
        id: assetId,
        name: file.name.replace(/\.[^.]+$/, ''),
        category: 'audio',
        type: 'audio',
        mimeType: file.type || 'audio/wav',
        dataUrl,
        durationSeconds: durationSec,
        hash,
        tags: ['imported', 'audio'],
        folder: 'Audio',
        createdAt: now,
        updatedAt: now,
        metadata: {},
      })
    );

    let targetTrackId = composition.audioTracks[0]?.id;
    if (!targetTrackId) {
      targetTrackId = uid('atrack');
      dispatchCommand(
        ProjectCommands.addAudioTrack(composition.id, {
          id: targetTrackId,
          name: 'Audio Track 1',
          category: 'sfx',
          muted: false,
          solo: false,
          volume: 1,
          clips: [],
        })
      );
    }

    dispatchCommand(
      ProjectCommands.addAudioClip(composition.id, targetTrackId, {
        id: uid('aclip'),
        assetId,
        name: file.name.replace(/\.[^.]+$/, ''),
        startFrame: currentFrame,
        inFrame: 0,
        durationFrames: Math.max(12, Math.round(durationSec * fps)),
        volume: 1,
        fadeInFrames: 0,
        fadeOutFrames: 0,
        loop: false,
      })
    );

    showFeedback('info', `Imported "${file.name}" onto audio track`);
    e.target.value = '';
  };

  const rulerTicks = useMemo(() => {
    const step = zoomPxPerFrame >= 8 ? 12 : 24;
    const ticks: number[] = [];
    for (let f = 0; f <= totalFrames; f += step) {
      ticks.push(f);
    }
    return ticks;
  }, [totalFrames, zoomPxPerFrame]);

  void peaksTick;

  return (
    <section
      aria-label="Composition Timeline"
      style={{ height: collapsed ? 44 : heightPx }}
      className="relative flex flex-col bg-[#16191E] border-t border-white/10 shrink-0 select-none"
    >
      {/* Top Resize Handle */}
      {!collapsed && (
        <div
          onPointerDown={handleResizePointerDown}
          title="Drag to resize timeline height"
          className="h-1 w-full cursor-row-resize hover:bg-blue-500/40 transition-colors"
        />
      )}

      {/* Unified Timeline & Transport Header Bar */}
      <div className="h-11 px-2.5 flex items-center justify-between gap-2 border-b border-white/8 bg-[#181B20] shrink-0 overflow-x-auto no-scrollbar">
        {/* Left: Collapse + Keyframes/Audio toggle */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand timeline' : 'Collapse timeline'}
            className="min-h-[34px] min-w-[34px] rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/8"
          >
            {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#111317] border border-white/8">
            <button
              type="button"
              onClick={() => {
                setTimelineTab('layers');
                if (collapsed) setCollapsed(false);
              }}
              className={`min-h-[28px] px-2 rounded-md text-[11px] font-medium flex items-center gap-1 whitespace-nowrap ${
                timelineTab === 'layers'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Film className="w-3 h-3" />
              Tracks
            </button>
            <button
              type="button"
              onClick={() => {
                setTimelineTab('audio');
                if (collapsed) setCollapsed(false);
              }}
              className={`min-h-[28px] px-2 rounded-md text-[11px] font-medium flex items-center gap-1 whitespace-nowrap ${
                timelineTab === 'audio'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Music className="w-3 h-3" />
              Audio
            </button>
          </div>
        </div>

        {/* Center: Clean Playback Transport */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setCurrentFrame(0)}
            title="Start"
            aria-label="Jump to start"
            className="min-h-[34px] min-w-[32px] rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/8"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => stepFrame(-1)}
            title="Previous frame"
            aria-label="Previous frame"
            className="hidden sm:flex min-h-[34px] min-w-[30px] rounded-lg items-center justify-center text-[11px] font-mono text-slate-300 hover:bg-white/8"
          >
            -1
          </button>
          <button
            type="button"
            onClick={() => setIsPlaying(!isPlaying)}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="min-h-[34px] px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isPlaying ? 'Pause' : 'Play'}</span>
          </button>
          <button
            type="button"
            onClick={() => stepFrame(1)}
            title="Next frame"
            aria-label="Next frame"
            className="hidden sm:flex min-h-[34px] min-w-[30px] rounded-lg items-center justify-center text-[11px] font-mono text-slate-300 hover:bg-white/8"
          >
            +1
          </button>
          <button
            type="button"
            onClick={() => setCurrentFrame(composition.settings.durationFrames - 1)}
            title="End"
            aria-label="Jump to end"
            className="min-h-[34px] min-w-[32px] rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/8"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          <span className="px-1.5 text-xs font-mono tabular-nums text-amber-400 font-medium whitespace-nowrap">
            {formatTimecode(currentFrame, fps)}
            <span className="text-slate-500 text-[10px] ml-1">F{currentFrame}</span>
          </span>

          <button
            type="button"
            onClick={toggleLoop}
            title="Toggle loop"
            aria-label="Toggle loop"
            className={`min-h-[34px] min-w-[32px] rounded-lg flex items-center justify-center ${
              loopPlayback ? 'text-blue-400 bg-blue-500/12' : 'text-slate-400 hover:bg-white/8'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Keyframe / Audio tools */}
        {!collapsed && (
          <div className="flex items-center gap-1 shrink-0">
            {timelineTab === 'layers' ? (
              <>
                <button
                  type="button"
                  onClick={copyKeyframesAtCurrentFrame}
                  disabled={!selectedLayerId}
                  title="Copy keyframes at current frame"
                  className="min-h-[32px] px-2 rounded-lg bg-[#20242B] hover:bg-[#2A2F38] disabled:opacity-35 text-[11px] text-slate-200 flex items-center gap-1 whitespace-nowrap"
                >
                  <Copy className="w-3 h-3" />
                  <span className="hidden lg:inline">Copy KF</span>
                </button>
                <button
                  type="button"
                  onClick={pasteKeyframesAtCurrentFrame}
                  disabled={!copiedKeyframes || !selectedLayerId}
                  title="Paste copied keyframes"
                  className="min-h-[32px] px-2 rounded-lg bg-[#20242B] hover:bg-[#2A2F38] disabled:opacity-35 text-[11px] text-slate-200 flex items-center gap-1 whitespace-nowrap"
                >
                  <ClipboardPaste className="w-3 h-3" />
                  <span className="hidden lg:inline">Paste</span>
                </button>
                {activeLayerKf && (
                  <>
                    <select
                      aria-label="Selected keyframe easing"
                      value={activeLayerKf.kf.interpolation}
                      onChange={(e) =>
                        dispatchCommand(
                          ProjectCommands.updateLayerKeyframe(
                            composition.id,
                            activeLayerKf.layerId,
                            activeLayerKf.prop,
                            activeLayerKf.kf.id,
                            { interpolation: e.target.value as InterpolationType }
                          )
                        )
                      }
                      className="min-h-[32px] px-1.5 rounded-lg bg-[#20242B] border border-amber-500/35 text-[11px] text-amber-300 focus:outline-none"
                    >
                      <option value="linear">Linear</option>
                      <option value="easeIn">Ease-In</option>
                      <option value="easeOut">Ease-Out</option>
                      <option value="easeInOut">Ease-In-Out</option>
                      <option value="hold">Hold</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        dispatchCommand(
                          ProjectCommands.deleteLayerKeyframe(
                            composition.id,
                            activeLayerKf.layerId,
                            activeLayerKf.prop,
                            activeLayerKf.kf.id
                          )
                        );
                        setSelectedKeyframe(null);
                      }}
                      title="Delete selected keyframe"
                      className="min-h-[32px] px-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-[11px] text-red-300 flex items-center gap-1 whitespace-nowrap"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={handleAudioFileImport}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => audioInputRef.current?.click()}
                  className="min-h-[32px] px-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium flex items-center gap-1 whitespace-nowrap"
                >
                  <Upload className="w-3 h-3" />
                  Audio
                </button>
                <button
                  type="button"
                  onClick={() =>
                    dispatchCommand(
                      ProjectCommands.addAudioTrack(composition.id, {
                        id: uid('atrack'),
                        name: `Track ${composition.audioTracks.length + 1}`,
                        category: 'sfx',
                        muted: false,
                        solo: false,
                        volume: 1,
                        clips: [],
                      })
                    )
                  }
                  className="min-h-[32px] px-2 rounded-lg bg-[#20242B] hover:bg-[#2A2F38] text-[11px] text-slate-200 flex items-center gap-1 whitespace-nowrap"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </>
            )}

            <input
              type="range"
              aria-label="Timeline zoom"
              min={2}
              max={12}
              step={1}
              value={zoomPxPerFrame}
              onChange={(e) => setZoomPxPerFrame(Number(e.target.value))}
              className="hidden md:block w-14 accent-blue-500 ml-1"
            />
          </div>
        )}
      </div>

      {/* Scrollable Timeline Tracks + Ruler */}
      {!collapsed && (
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Left Sticky Track Headers */}
          <div className="w-36 sm:w-44 shrink-0 border-r border-white/8 bg-[#181B20] overflow-y-auto">
            <div className="h-6 px-2.5 border-b border-white/8 flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span>TRACKS</span>
              <span>{fps} FPS</span>
            </div>

            {timelineTab === 'layers' ? (
              <>
                <div className="h-8 px-2.5 border-b border-white/6 flex items-center justify-between text-xs text-cyan-300/90 bg-cyan-500/5">
                  <span className="truncate font-medium">Camera Rig</span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {composition.camera.keyframes.x.length +
                      composition.camera.keyframes.y.length +
                      composition.camera.keyframes.zoom.length}
                    {(composition.camera.modifiers?.length ?? 0) > 0 && (
                      <span className="text-amber-400 ml-1">
                        +{composition.camera.modifiers.length}p
                      </span>
                    )}
                  </span>
                </div>
                {composition.layers.map((layer) => {
                  const isSel = layer.id === selectedLayerId;
                  const modCount = layer.modifiers?.filter((m) => m.enabled).length ?? 0;
                  return (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => selectLayer(layer.id, 'layer')}
                      className={`w-full h-8 px-2.5 border-b border-white/6 flex items-center justify-between gap-1 text-left text-xs transition-colors ${
                        isSel ? 'bg-blue-600/18 text-white' : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      <span className="truncate font-medium">{layer.name}</span>
                      {modCount > 0 && (
                        <span className="text-[10px] font-mono text-amber-400 shrink-0">
                          +{modCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </>
            ) : (
              composition.audioTracks.map((track) => (
                <div
                  key={track.id}
                  className="h-12 px-2 border-b border-white/6 flex items-center justify-between gap-1"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-200 truncate">{track.name}</div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        dispatchCommand(
                          ProjectCommands.updateAudioTrack(composition.id, track.id, {
                            muted: !track.muted,
                          })
                        )
                      }
                      aria-label="Mute track"
                      className={`min-h-[28px] min-w-[26px] rounded flex items-center justify-center ${
                        track.muted ? 'text-amber-400 bg-amber-500/10' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {track.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        dispatchCommand(
                          ProjectCommands.updateAudioTrack(composition.id, track.id, {
                            solo: !track.solo,
                          })
                        )
                      }
                      aria-label="Solo track"
                      className={`min-h-[28px] min-w-[24px] rounded text-[10px] font-bold flex items-center justify-center ${
                        track.solo ? 'text-blue-300 bg-blue-600/30' : 'text-slate-500 hover:text-slate-200'
                      }`}
                    >
                      S
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Right Scrollable Frame Grid */}
          <div ref={trackScrollRef} className="flex-1 overflow-auto relative bg-[#111317]">
            <div style={{ width: timelineWidth }} className="relative min-h-full">
              {/* Frame Ruler */}
              <div
                ref={rulerRef}
                onPointerDown={handleRulerPointerDown}
                onPointerMove={handleRulerPointerMove}
                onPointerLeave={handleRulerPointerLeave}
                className="sticky top-0 z-20 h-6 bg-[#181B20] border-b border-white/10 cursor-ew-resize relative touch-none"
              >
                {rulerTicks.map((f) => (
                  <div
                    key={f}
                    style={{ left: f * zoomPxPerFrame }}
                    className="absolute top-0 bottom-0 border-l border-white/15 pl-1 flex items-center text-[10px] font-mono tabular-nums text-slate-400"
                  >
                    {f}f
                  </div>
                ))}
              </div>

              {/* Hover Scrubber Guide Line */}
              {hoverPreview && (
                <div
                  style={{ left: hoverPreview.frame * zoomPxPerFrame }}
                  className="absolute top-0 bottom-0 w-px bg-blue-400/60 z-20 pointer-events-none"
                />
              )}

              {/* Playhead Needle */}
              <div
                style={{ left: currentFrame * zoomPxPerFrame }}
                className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-30 pointer-events-none"
              >
                <div className="w-3 h-3 -ml-[5px] bg-amber-400 rotate-45 rounded-[2px]" />
              </div>

              {timelineTab === 'layers' ? (
                <>
                  {/* Camera Keyframes Row */}
                  <div className="h-8 border-b border-white/6 relative bg-cyan-500/[0.03]">
                    {(['x', 'y', 'zoom'] as const).flatMap((prop) =>
                      composition.camera.keyframes[prop].map((kf) => (
                        <div
                          key={kf.id}
                          style={{ left: kf.frame * zoomPxPerFrame - 5 }}
                          onClick={() => setCurrentFrame(kf.frame)}
                          title={`Camera ${prop} @ F${kf.frame}`}
                          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-cyan-400 rotate-45 rounded-[2px] cursor-pointer hover:scale-125 transition-transform"
                        />
                      ))
                    )}
                  </div>

                  {/* Layer Bars & Keyframes */}
                  {composition.layers.map((layer) => {
                    const isSel = layer.id === selectedLayerId;
                    const barLeft = layer.inFrame * zoomPxPerFrame;
                    const barWidth = Math.max(16, (layer.outFrame - layer.inFrame) * zoomPxPerFrame);

                    return (
                      <div
                        key={layer.id}
                        onClick={() => selectLayer(layer.id, 'layer')}
                        className={`h-8 border-b border-white/6 relative ${
                          isSel ? 'bg-blue-600/[0.08]' : ''
                        }`}
                      >
                        {/* Duration Span Bar */}
                        <div
                          style={{ left: barLeft, width: barWidth }}
                          className={`absolute top-1.5 bottom-1.5 rounded-md border ${
                            isSel
                              ? 'bg-blue-500/20 border-blue-400/45'
                              : 'bg-slate-700/25 border-white/10'
                          }`}
                        />

                        {/* Synced Lyric Cues Overlay */}
                        {layer.objects[0]?.kind === 'text' &&
                          layer.objects[0].lyrics?.enabled &&
                          layer.objects[0].lyrics.cues.map((cue) => {
                            const cueLeft = cue.startFrame * zoomPxPerFrame;
                            const cueWidth = Math.max(
                              6,
                              (cue.endFrame - cue.startFrame) * zoomPxPerFrame
                            );
                            return (
                              <button
                                key={cue.id}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectLayer(layer.id, 'layer');
                                  setCurrentFrame(cue.startFrame);
                                }}
                                title={`${cue.text} (F${cue.startFrame}–F${cue.endFrame})`}
                                style={{ left: cueLeft, width: cueWidth }}
                                className="absolute top-2 bottom-2 rounded bg-amber-400/30 hover:bg-amber-400/50 border border-amber-300/60 overflow-hidden px-1 text-[9px] text-amber-100 text-left truncate z-[5]"
                              >
                                {cueWidth > 26 ? cue.text : ''}
                              </button>
                            );
                          })}

                        {/* Keyframe Diamonds */}
                        {KEYFRAME_PROPS.flatMap((prop) =>
                          (layer.keyframes[prop] ?? []).map((kf) => {
                            const isKfSelected = activeLayerKf?.kf.id === kf.id;
                            return (
                              <button
                                key={kf.id}
                                type="button"
                                onPointerDown={(e) =>
                                  handleKeyframePointerDown(e, layer.id, prop, kf.id, kf.frame)
                                }
                                title={`${prop} @ F${kf.frame} (${kf.interpolation}) — Drag to retime`}
                                style={{ left: kf.frame * zoomPxPerFrame - 7 }}
                                className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 flex items-center justify-center z-10 touch-none"
                              >
                                <Diamond
                                  className={`w-3 h-3 ${
                                    isKfSelected
                                      ? 'text-white fill-amber-400 scale-125'
                                      : 'text-amber-400 fill-amber-500/80'
                                  }`}
                                />
                              </button>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </>
              ) : (
                /* Audio Tracks Grid */
                <>
                  {composition.audioTracks.length === 0 ? (
                    <div className="p-4 text-xs text-slate-400">
                      No audio tracks yet. Tap "Audio" or "+" to add dialogue, music, or SFX.
                    </div>
                  ) : (
                    composition.audioTracks.map((track) => (
                      <div key={track.id} className="h-12 border-b border-white/6 relative">
                        {track.clips.map((clip) => {
                          const peaks = audioEngine.getWaveformPeaks(clip.assetId);
                          const clipLeft = clip.startFrame * zoomPxPerFrame;
                          const clipWidth = Math.max(36, clip.durationFrames * zoomPxPerFrame);

                          return (
                            <div
                              key={clip.id}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                e.currentTarget.setPointerCapture(e.pointerId);
                                const startX = e.clientX;
                                const origStart = clip.startFrame;
                                let nextStart = origStart;
                                const onMove = (ev: PointerEvent) => {
                                  nextStart = Math.max(
                                    0,
                                    origStart + Math.round((ev.clientX - startX) / zoomPxPerFrame)
                                  );
                                };
                                const onUp = () => {
                                  window.removeEventListener('pointermove', onMove);
                                  window.removeEventListener('pointerup', onUp);
                                  if (nextStart !== origStart) {
                                    dispatchCommand(
                                      ProjectCommands.updateAudioClip(
                                        composition.id,
                                        track.id,
                                        clip.id,
                                        { startFrame: nextStart }
                                      )
                                    );
                                  }
                                };
                                window.addEventListener('pointermove', onMove);
                                window.addEventListener('pointerup', onUp);
                              }}
                              style={{ left: clipLeft, width: clipWidth }}
                              className="absolute top-1 bottom-1 rounded-lg bg-emerald-600/25 border border-emerald-400/45 px-2 py-0.5 flex flex-col justify-between overflow-hidden cursor-grab active:cursor-grabbing touch-none"
                            >
                              <div className="flex items-center justify-between gap-1 text-[10px] text-emerald-100 font-medium leading-none">
                                <span className="truncate">{clip.name}</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    dispatchCommand(
                                      ProjectCommands.deleteAudioClip(
                                        composition.id,
                                        track.id,
                                        clip.id
                                      )
                                    );
                                  }}
                                  className="text-emerald-200/70 hover:text-red-300"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                              {/* Real Waveform Peaks */}
                              <div className="flex items-end gap-[2px] h-4 opacity-80">
                                {(peaks.length > 0 ? peaks : Array.from({ length: 24 }, () => 0.3)).map(
                                  (pk, idx) => (
                                    <div
                                      key={idx}
                                      style={{ height: `${Math.max(15, Math.min(100, pk * 100))}%` }}
                                      className="flex-1 bg-emerald-300/75 rounded-t-sm"
                                    />
                                  )
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating Scrubber Thumbnail Preview */}
      {!collapsed && hoverPreview && (() => {
        const cardW = previewSize.w + 8;
        const cardH = previewSize.h + 28;
        const maxLeft = typeof window !== 'undefined' ? window.innerWidth - cardW - 8 : 9999;
        const clampedLeft = Math.max(8, Math.min(maxLeft, hoverPreview.viewportX - cardW / 2));
        const top = Math.max(8, hoverPreview.rulerTop - cardH - 8);
        const caretLeft = Math.max(12, Math.min(cardW - 12, hoverPreview.viewportX - clampedLeft));

        return (
          <div
            role="tooltip"
            aria-label={`Frame ${hoverPreview.frame} preview`}
            style={{ left: clampedLeft, top, width: cardW }}
            className="fixed z-50 pointer-events-none rounded-xl bg-[#181B20]/96 backdrop-blur-md border border-white/15 shadow-2xl p-1"
          >
            <div className="rounded-lg overflow-hidden bg-[#0D0F12] border border-white/8">
              <canvas
                ref={previewCanvasRef}
                style={{ width: previewSize.w, height: previewSize.h }}
                className="block"
              />
            </div>
            <div className="h-5 px-1.5 flex items-center justify-between text-[10px] font-mono tabular-nums">
              <span className="text-amber-400 font-semibold">F{hoverPreview.frame}</span>
              <span className="text-slate-300">{formatTimecode(hoverPreview.frame, fps)}</span>
            </div>
            <div
              style={{ left: caretLeft - 4 }}
              className="absolute -bottom-1.5 w-2.5 h-2.5 bg-[#181B20] border-r border-b border-white/15 rotate-45"
            />
          </div>
        );
      })()}
    </section>
  );
};
