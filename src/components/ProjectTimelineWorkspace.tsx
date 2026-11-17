import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Edit3,
  Film,
  Pause,
  Play,
  Plus,
  SkipBack,
  Trash2,
} from 'lucide-react';
import { ProjectCommands, uid } from '../commands/projectCommands';
import {
  evaluateProjectTimelineAtFrame,
  getProjectMovieDurationFrames,
} from '../engine/evaluator';
import { Canvas2DRenderer } from '../renderer/Canvas2DRenderer';
import { fpsToNumber, ProjectTimelineClip } from '../schema/projectSchema';
import { formatTimecode, useStudioStore } from '../store/useStudioStore';

export const ProjectTimelineWorkspace: React.FC = () => {
  const {
    project,
    movieFrame,
    isPlaying,
    loopPlayback,
    setMovieFrame,
    setIsPlaying,
    setActiveComposition,
    setWorkspace,
    dispatchCommand,
  } = useStudioStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [decodeTick, setDecodeTick] = useState(0);
  const renderer = useMemo(
    () => new Canvas2DRenderer(() => setDecodeTick((t) => t + 1)),
    []
  );

  const movieFps = fpsToNumber(project.settings.fps);
  const totalMovieFrames = getProjectMovieDurationFrames(project);
  const sortedClips = useMemo(
    () => [...project.projectTimeline.clips].sort((a, b) => a.startFrame - b.startFrame),
    [project.projectTimeline.clips]
  );

  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    sortedClips[0]?.id ?? null
  );
  const [hoverMoviePreview, setHoverMoviePreview] = useState<{
    frame: number;
    viewportX: number;
    anchorTop: number;
  } | null>(null);
  const moviePreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const isMovieScrubbingRef = useRef(false);

  // Playback loop for Movie Timeline
  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    let last = performance.now();
    let acc = 0;
    const frameMs = 1000 / movieFps;

    const tick = (now: number) => {
      acc += now - last;
      last = now;
      if (acc >= frameMs) {
        const steps = Math.floor(acc / frameMs);
        acc -= steps * frameMs;
        const next = useStudioStore.getState().movieFrame + steps;
        if (next >= totalMovieFrames) {
          if (loopPlayback) {
            setMovieFrame(0);
          } else {
            setMovieFrame(totalMovieFrames - 1);
            setIsPlaying(false);
            return;
          }
        } else {
          setMovieFrame(next);
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, movieFps, totalMovieFrames, loopPlayback, setMovieFrame, setIsPlaying]);

  // Render movie frame with transitions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = project.settings.defaultWidth;
    const h = project.settings.defaultHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const evalMovie = evaluateProjectTimelineAtFrame(project, movieFrame);
    ctx.fillStyle = '#090B0E';
    ctx.fillRect(0, 0, w, h);

    if (evalMovie.outgoing && evalMovie.transitionType === 'crossDissolve' && evalMovie.transitionProgress < 1) {
      const outCanvas = renderer.renderCompositionToImageData(project, evalMovie.outgoing, w, h);
      ctx.save();
      ctx.globalAlpha = 1 - evalMovie.transitionProgress;
      ctx.drawImage(outCanvas, 0, 0);
      ctx.restore();
    }

    if (evalMovie.primary) {
      const primCanvas = renderer.renderCompositionToImageData(project, evalMovie.primary, w, h);
      ctx.save();
      if (evalMovie.transitionType === 'crossDissolve' && evalMovie.transitionProgress < 1) {
        ctx.globalAlpha = evalMovie.transitionProgress;
      } else if (evalMovie.transitionType === 'fadeBlack' && evalMovie.transitionProgress < 1) {
        ctx.globalAlpha = evalMovie.transitionProgress;
      }
      ctx.drawImage(primCanvas, 0, 0);
      ctx.restore();
    }
  }, [project, movieFrame, renderer, decodeTick]);

  // Render hover thumbnail preview for the Movie Timeline scrubber
  useEffect(() => {
    if (!hoverMoviePreview || !moviePreviewCanvasRef.current) return;
    const canvas = moviePreviewCanvasRef.current;
    const thumbW = 320;
    const ratio = project.settings.defaultHeight / Math.max(1, project.settings.defaultWidth);
    const thumbH = Math.max(144, Math.min(240, Math.round(thumbW * ratio)));
    if (canvas.width !== thumbW || canvas.height !== thumbH) {
      canvas.width = thumbW;
      canvas.height = thumbH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const evalMovie = evaluateProjectTimelineAtFrame(project, hoverMoviePreview.frame);
    ctx.fillStyle = '#090B0E';
    ctx.fillRect(0, 0, thumbW, thumbH);

    if (evalMovie.outgoing && evalMovie.transitionType === 'crossDissolve' && evalMovie.transitionProgress < 1) {
      const outCanvas = renderer.renderCompositionToImageData(project, evalMovie.outgoing, thumbW, thumbH);
      ctx.save();
      ctx.globalAlpha = 1 - evalMovie.transitionProgress;
      ctx.drawImage(outCanvas, 0, 0);
      ctx.restore();
    }

    if (evalMovie.primary) {
      const primCanvas = renderer.renderCompositionToImageData(project, evalMovie.primary, thumbW, thumbH);
      ctx.save();
      if (evalMovie.transitionType === 'crossDissolve' && evalMovie.transitionProgress < 1) {
        ctx.globalAlpha = evalMovie.transitionProgress;
      } else if (evalMovie.transitionType === 'fadeBlack' && evalMovie.transitionProgress < 1) {
        ctx.globalAlpha = evalMovie.transitionProgress;
      }
      ctx.drawImage(primCanvas, 0, 0);
      ctx.restore();
    }
  }, [hoverMoviePreview?.frame, project, renderer, decodeTick]);

  const computeMovieHover = (clientX: number, el: HTMLInputElement) => {
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const maxF = Math.max(1, totalMovieFrames - 1);
    return {
      frame: Math.round(ratio * maxF),
      viewportX: Math.max(rect.left, Math.min(rect.right, clientX)),
      anchorTop: rect.top,
    };
  };

  const commitClips = (next: ProjectTimelineClip[]) => {
    dispatchCommand(ProjectCommands.setProjectTimelineClips(next));
  };

  const handleAppendComp = (compId: string) => {
    const comp = project.compositions.find((c) => c.id === compId);
    if (!comp) return;
    const lastEnd = sortedClips.reduce(
      (max, cl) => Math.max(max, cl.startFrame + cl.durationFrames),
      0
    );
    const newClip: ProjectTimelineClip = {
      id: uid('ptc'),
      compositionId: comp.id,
      startFrame: lastEnd,
      durationFrames: comp.settings.durationFrames,
      inOffsetFrames: 0,
      transitionIn: 'crossDissolve',
      transitionDurationFrames: 12,
    };
    commitClips([...project.projectTimeline.clips, newClip]);
    setSelectedClipId(newClip.id);
  };

  const handlePackSequentially = (ordered: ProjectTimelineClip[]) => {
    let cursor = 0;
    const packed = ordered.map((clip, i) => {
      const overlap =
        i > 0 && clip.transitionIn === 'crossDissolve'
          ? Math.min(clip.transitionDurationFrames, Math.floor(clip.durationFrames / 2))
          : 0;
      const startFrame = Math.max(0, cursor - overlap);
      cursor = startFrame + clip.durationFrames;
      return { ...clip, startFrame };
    });
    commitClips(packed);
  };

  const selectedClip = sortedClips.find((c) => c.id === selectedClipId) ?? null;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#111317] overflow-hidden">
      {/* Top Movie Preview Stage + Clip Inspector */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row border-b border-white/10">
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 bg-[#0B0D10] relative">
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-full rounded-xl border border-white/10 shadow-2xl bg-black aspect-video object-contain"
          />

          {/* Movie Transport */}
          <div className="mt-3 flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-[#181B20] border border-white/10">
            <button
              type="button"
              onClick={() => setMovieFrame(0)}
              aria-label="Jump to movie start"
              className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-slate-300 hover:bg-white/8"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              className="min-h-[40px] px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isPlaying ? 'Pause Movie' : 'Play Movie'}
            </button>
            <div className="px-2 font-mono text-xs tabular-nums text-amber-400">
              {formatTimecode(movieFrame, movieFps)}{' '}
              <span className="text-slate-400">
                / {formatTimecode(totalMovieFrames, movieFps)}
              </span>
            </div>
          </div>
        </div>

        {/* Right Clip Inspector */}
        <aside className="w-full lg:w-80 bg-[#181B20] border-t lg:border-t-0 lg:border-l border-white/10 p-4 overflow-y-auto shrink-0 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Movie Sequencer</h2>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {sortedClips.length} clips
            </span>
          </div>

          {selectedClip ? (
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-[#111317] border border-white/8 space-y-2">
                <div className="font-semibold text-slate-100">
                  {project.compositions.find((c) => c.id === selectedClip.compositionId)?.name ??
                    'Composition'}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveComposition(selectedClip.compositionId);
                    setWorkspace('composition');
                  }}
                  className="w-full min-h-[38px] px-3 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/35 text-blue-200 font-medium flex items-center justify-center gap-1.5"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Open in Composition Editor
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Start Frame</span>
                  <input
                    type="number"
                    min={0}
                    value={selectedClip.startFrame}
                    onChange={(e) =>
                      commitClips(
                        sortedClips.map((c) =>
                          c.id === selectedClip.id
                            ? { ...c, startFrame: Math.max(0, Number(e.target.value) || 0) }
                            : c
                        )
                      )
                    }
                    className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 font-mono text-slate-100"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Duration (frames)</span>
                  <input
                    type="number"
                    min={12}
                    value={selectedClip.durationFrames}
                    onChange={(e) =>
                      commitClips(
                        sortedClips.map((c) =>
                          c.id === selectedClip.id
                            ? { ...c, durationFrames: Math.max(12, Number(e.target.value) || 48) }
                            : c
                        )
                      )
                    }
                    className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 font-mono text-slate-100"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Transition In</span>
                  <select
                    value={selectedClip.transitionIn}
                    onChange={(e) =>
                      commitClips(
                        sortedClips.map((c) =>
                          c.id === selectedClip.id
                            ? {
                                ...c,
                                transitionIn: e.target.value as
                                  | 'cut'
                                  | 'crossDissolve'
                                  | 'fadeBlack',
                              }
                            : c
                        )
                      )
                    }
                    className="w-full min-h-[38px] px-2 rounded-lg bg-[#111317] border border-white/10 text-slate-100"
                  >
                    <option value="cut">Cut</option>
                    <option value="crossDissolve">Cross Dissolve</option>
                    <option value="fadeBlack">Fade from Black</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Trans. Frames</span>
                  <input
                    type="number"
                    min={0}
                    max={96}
                    value={selectedClip.transitionDurationFrames}
                    onChange={(e) =>
                      commitClips(
                        sortedClips.map((c) =>
                          c.id === selectedClip.id
                            ? {
                                ...c,
                                transitionDurationFrames: Math.max(0, Number(e.target.value) || 0),
                              }
                            : c
                        )
                      )
                    }
                    className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 font-mono text-slate-100"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => {
                  commitClips(sortedClips.filter((c) => c.id !== selectedClip.id));
                  setSelectedClipId(null);
                }}
                className="w-full min-h-[38px] rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 font-medium flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove Clip from Movie
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              Tap a Composition clip below to adjust its timing and transition.
            </p>
          )}

          {/* Add Composition to Movie */}
          <div className="pt-3 border-t border-white/8 space-y-2">
            <div className="text-xs font-semibold text-slate-300">Append Composition</div>
            <div className="space-y-1.5">
              {project.compositions.map((comp) => (
                <button
                  key={comp.id}
                  type="button"
                  onClick={() => handleAppendComp(comp.id)}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-[#111317] hover:bg-[#20242B] border border-white/8 flex items-center justify-between text-xs text-slate-200"
                >
                  <span className="truncate font-medium">{comp.name}</span>
                  <span className="flex items-center gap-1 text-blue-400 shrink-0">
                    <Plus className="w-3.5 h-3.5" /> Add
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* Bottom Project Timeline Sequencer Track */}
      <div className="h-52 bg-[#16191E] flex flex-col shrink-0">
        <div className="h-10 px-4 border-b border-white/8 flex items-center justify-between bg-[#181B20]">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <Film className="w-4 h-4 text-blue-400" />
            <span>Project Movie Timeline</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              aria-label="Scrub movie frame"
              min={0}
              max={Math.max(1, totalMovieFrames - 1)}
              value={movieFrame}
              onChange={(e) => setMovieFrame(Number(e.target.value))}
              onPointerDown={(e) => {
                isMovieScrubbingRef.current = true;
                setHoverMoviePreview(computeMovieHover(e.clientX, e.currentTarget));
              }}
              onPointerMove={(e) => {
                setHoverMoviePreview(computeMovieHover(e.clientX, e.currentTarget));
              }}
              onPointerUp={() => {
                isMovieScrubbingRef.current = false;
              }}
              onPointerLeave={() => {
                if (!isMovieScrubbingRef.current) {
                  setHoverMoviePreview(null);
                }
              }}
              onPointerCancel={() => {
                isMovieScrubbingRef.current = false;
                setHoverMoviePreview(null);
              }}
              className="w-40 sm:w-64 accent-amber-400 cursor-pointer"
            />
          </div>
        </div>

        <div className="flex-1 overflow-x-auto p-3 flex items-center gap-2.5">
          {sortedClips.map((clip, index) => {
            const comp = project.compositions.find((c) => c.id === clip.compositionId);
            const isSel = clip.id === selectedClipId;
            return (
              <div
                key={clip.id}
                onClick={() => {
                  setSelectedClipId(clip.id);
                  setMovieFrame(clip.startFrame);
                }}
                style={{ minWidth: Math.max(180, clip.durationFrames * 1.1) }}
                className={`h-28 rounded-xl p-3 flex flex-col justify-between border cursor-pointer transition-colors shrink-0 ${
                  isSel
                    ? 'bg-blue-600/20 border-blue-500 text-white'
                    : 'bg-[#1D2128] border-white/10 hover:border-white/25 text-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">
                      {comp?.name ?? 'Missing Comp'}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
                      F{clip.startFrame}–{clip.startFrame + clip.durationFrames} ·{' '}
                      {(clip.durationFrames / movieFps).toFixed(1)}s
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = [...sortedClips];
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        handlePackSequentially(next);
                      }}
                      aria-label="Move clip earlier"
                      className="min-h-[32px] min-w-[30px] rounded flex items-center justify-center hover:bg-white/10 disabled:opacity-25"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={index === sortedClips.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = [...sortedClips];
                        [next[index], next[index + 1]] = [next[index + 1], next[index]];
                        handlePackSequentially(next);
                      }}
                      aria-label="Move clip later"
                      className="min-h-[32px] min-w-[30px] rounded flex items-center justify-center hover:bg-white/10 disabled:opacity-25"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="capitalize">
                    {clip.transitionIn === 'crossDissolve'
                      ? `Dissolve (${clip.transitionDurationFrames}f)`
                      : clip.transitionIn === 'fadeBlack'
                      ? `Fade Black (${clip.transitionDurationFrames}f)`
                      : 'Cut'}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveComposition(clip.compositionId);
                      setWorkspace('composition');
                    }}
                    className="text-blue-400 hover:text-blue-300 font-medium"
                  >
                    Edit Scene
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating Movie Scrubber Thumbnail Preview */}
      {hoverMoviePreview && (() => {
        const displayW = 160;
        const ratio = project.settings.defaultHeight / Math.max(1, project.settings.defaultWidth);
        const displayH = Math.max(72, Math.min(120, Math.round(displayW * ratio)));
        const cardW = displayW + 8;
        const cardH = displayH + 28;
        const maxLeft = typeof window !== 'undefined' ? window.innerWidth - cardW - 8 : 9999;
        const clampedLeft = Math.max(8, Math.min(maxLeft, hoverMoviePreview.viewportX - cardW / 2));
        const top = Math.max(8, hoverMoviePreview.anchorTop - cardH - 10);
        const caretLeft = Math.max(12, Math.min(cardW - 12, hoverMoviePreview.viewportX - clampedLeft));

        return (
          <div
            role="tooltip"
            aria-label={`Movie frame ${hoverMoviePreview.frame} preview`}
            style={{ left: clampedLeft, top, width: cardW }}
            className="fixed z-50 pointer-events-none rounded-xl bg-[#181B20]/96 backdrop-blur-md border border-white/15 shadow-2xl p-1"
          >
            <div className="rounded-lg overflow-hidden bg-[#090B0E] border border-white/8">
              <canvas
                ref={moviePreviewCanvasRef}
                style={{ width: displayW, height: displayH }}
                className="block"
              />
            </div>
            <div className="h-5 px-1.5 flex items-center justify-between text-[10px] font-mono tabular-nums">
              <span className="text-amber-400 font-semibold">F{hoverMoviePreview.frame}</span>
              <span className="text-slate-300">
                {formatTimecode(hoverMoviePreview.frame, movieFps)}
              </span>
            </div>
            <div
              style={{ left: caretLeft - 4 }}
              className="absolute -bottom-1.5 w-2.5 h-2.5 bg-[#181B20] border-r border-b border-white/15 rotate-45"
            />
          </div>
        );
      })()}
    </div>
  );
};
