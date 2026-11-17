import React, { useMemo, useRef, useState } from 'react';
import {
  Archive,
  Camera,
  CheckCircle2,
  Download,
  Film,
  FolderOpen,
  Info,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  buildAudioExportPlan,
  renderMixedAudioBuffer,
  selectWebMMimeType,
} from '../audio/audioExportMixer';
import { ProjectCommands } from '../commands/projectCommands';
import {
  evaluateCompositionAtFrame,
  evaluateProjectTimelineAtFrame,
  getProjectMovieDurationFrames,
} from '../engine/evaluator';
import { Canvas2DRenderer } from '../renderer/Canvas2DRenderer';
import { fpsToNumber } from '../schema/projectSchema';
import {
  deleteProjectFromIndexedDb,
  parseMotionXArchive,
  serializeMotionXArchive,
} from '../storage/IndexedDbStorage';
import { useStudioStore } from '../store/useStudioStore';

export const ExportWorkspace: React.FC = () => {
  const {
    project,
    savedProjects,
    activeCompositionId,
    currentFrame,
    loadProjectById,
    importLoadedProject,
    refreshProjectList,
    dispatchCommand,
    showFeedback,
  } = useStudioStore();

  const [exportTarget, setExportTarget] = useState<'composition' | 'movie'>('movie');
  const [exporting, setExporting] = useState(false);
  const [exportPhase, setExportPhase] = useState<string>('Rendering WebM Video...');
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string>('movie.webm');
  const cancelRef = useRef(false);
  const archiveInputRef = useRef<HTMLInputElement>(null);

  const activeComp =
    project.compositions.find((c) => c.id === activeCompositionId) ?? project.compositions[0];
  const includeAudio = project.exportSettings?.includeAudio ?? true;

  const audioPlan = useMemo(
    () => buildAudioExportPlan(project, exportTarget, activeComp?.id),
    [project, exportTarget, activeComp?.id]
  );

  const handleExportMotionX = () => {
    const json = serializeMotionXArchive(project);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^a-z0-9-_]+/gi, '_')}.motionx`;
    a.click();
    URL.revokeObjectURL(url);
    showFeedback('info', 'Exported portable .motionx project archive');
  };

  const handleImportMotionX = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseMotionXArchive(text);
    if (!parsed.success) {
      showFeedback('error', `Invalid .motionx file: ${parsed.error}`);
      e.target.value = '';
      return;
    }
    await importLoadedProject(parsed.project);
    e.target.value = '';
  };

  const handleExportPngSnapshot = () => {
    const renderer = new Canvas2DRenderer();
    const state = evaluateCompositionAtFrame(project, activeComp.id, currentFrame);
    if (!state) return;
    const canvas = renderer.renderCompositionToImageData(
      project,
      state,
      activeComp.settings.width,
      activeComp.settings.height
    );
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeComp.name.replace(/[^a-z0-9-_]+/gi, '_')}_f${currentFrame}.png`;
      a.click();
      URL.revokeObjectURL(url);
      renderer.dispose();
    }, 'image/png');
  };

  const handleExportWebM = async () => {
    if (typeof MediaRecorder === 'undefined') {
      showFeedback(
        'error',
        'MediaRecorder is not supported in this browser. Try PNG Snapshot or .motionx export.'
      );
      return;
    }

    setExporting(true);
    setProgress(0);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }
    cancelRef.current = false;

    const fps = fpsToNumber(project.settings.fps);
    const width =
      exportTarget === 'composition'
        ? activeComp.settings.width
        : project.settings.defaultWidth;
    const height =
      exportTarget === 'composition'
        ? activeComp.settings.height
        : project.settings.defaultHeight;
    const totalFrames =
      exportTarget === 'composition'
        ? activeComp.settings.durationFrames
        : getProjectMovieDurationFrames(project);

    let audioCtx: AudioContext | null = null;
    let audioSource: AudioBufferSourceNode | null = null;
    const renderer = new Canvas2DRenderer();

    try {
      let mixedAudioBuffer: AudioBuffer | null = null;
      let hasAudio = false;
      let mixedClipCount = 0;

      if (includeAudio && audioPlan.clips.length > 0) {
        setExportPhase('Mixing audio tracks...');
        const audioResult = await renderMixedAudioBuffer(project, exportTarget, activeComp.id);
        if (cancelRef.current) {
          showFeedback('info', 'Export cancelled');
          return;
        }
        mixedAudioBuffer = audioResult.buffer;
        hasAudio = audioResult.hasAudio;
        mixedClipCount = audioResult.clipCount;
      }

      const mimeType = selectWebMMimeType(hasAudio);
      if (!mimeType) {
        showFeedback('error', 'WebM video encoding is unavailable on this device.');
        return;
      }

      setExportPhase(
        hasAudio
          ? `Rendering WebM Video + Audio (${mixedClipCount} clip${mixedClipCount === 1 ? '' : 's'})...`
          : 'Rendering WebM Video...'
      );

      const outCanvas = document.createElement('canvas');
      outCanvas.width = width;
      outCanvas.height = height;
      const ctx = outCanvas.getContext('2d')!;

      const stream = outCanvas.captureStream(fps);

      if (mixedAudioBuffer) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new AudioCtx({ sampleRate: mixedAudioBuffer.sampleRate });
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        const dest = audioCtx.createMediaStreamDestination();
        audioSource = audioCtx.createBufferSource();
        audioSource.buffer = mixedAudioBuffer;
        audioSource.connect(dest);
        for (const track of dest.stream.getAudioTracks()) {
          stream.addTrack(track);
        }
      }

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 4_000_000,
        ...(hasAudio ? { audioBitsPerSecond: 128_000 } : {}),
      });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };

      const donePromise = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });

      recorder.start();
      if (audioSource) {
        audioSource.start();
      }

      const renderStartMs = performance.now();
      for (let f = 0; f < totalFrames; f++) {
        if (cancelRef.current) break;

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);

        if (exportTarget === 'composition') {
          const st = evaluateCompositionAtFrame(project, activeComp.id, f);
          if (st) {
            const rendered = renderer.renderCompositionToImageData(project, st, width, height);
            ctx.drawImage(rendered, 0, 0);
          }
        } else {
          const mv = evaluateProjectTimelineAtFrame(project, f);
          if (mv.outgoing && mv.transitionType === 'crossDissolve' && mv.transitionProgress < 1) {
            const rOut = renderer.renderCompositionToImageData(project, mv.outgoing, width, height);
            ctx.save();
            ctx.globalAlpha = 1 - mv.transitionProgress;
            ctx.drawImage(rOut, 0, 0);
            ctx.restore();
          }
          if (mv.primary) {
            const rPrim = renderer.renderCompositionToImageData(project, mv.primary, width, height);
            ctx.save();
            if (mv.transitionType !== 'cut' && mv.transitionProgress < 1) {
              ctx.globalAlpha = mv.transitionProgress;
            }
            ctx.drawImage(rPrim, 0, 0);
            ctx.restore();
          }
        }

        setProgress(Math.round(((f + 1) / totalFrames) * 100));

        // Drift-compensated frame pacing so video duration matches Web Audio clock
        const targetElapsedMs = ((f + 1) * 1000) / fps;
        const waitMs = renderStartMs + targetElapsedMs - performance.now();
        await new Promise((r) => setTimeout(r, waitMs > 1 ? waitMs : 0));
      }

      if (audioSource) {
        try {
          audioSource.stop();
        } catch {
          // already stopped
        }
      }
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      const blob = await donePromise;

      if (cancelRef.current) {
        showFeedback('info', 'Export cancelled');
        return;
      }

      const url = URL.createObjectURL(blob);
      const filename = `${(exportTarget === 'composition' ? activeComp.name : project.name).replace(
        /[^a-z0-9-_]+/gi,
        '_'
      )}.webm`;
      setDownloadUrl(url);
      setDownloadName(filename);
      showFeedback(
        'info',
        hasAudio
          ? `Video + audio render complete (${totalFrames} frames, ${mixedClipCount} audio clip${mixedClipCount === 1 ? '' : 's'})`
          : `Video render complete (${totalFrames} frames)`
      );
    } finally {
      if (audioSource) {
        try {
          audioSource.disconnect();
        } catch {
          // ignore
        }
      }
      if (audioCtx) {
        void audioCtx.close().catch(() => undefined);
      }
      renderer.dispose();
      setExporting(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#111317] p-4 sm:p-6">
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Video & Frame Export */}
        <section className="rounded-2xl bg-[#181B20] border border-white/8 p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Video & Frame Output</h2>
              <p className="text-xs text-slate-400">
                Deterministic frame-by-frame rendering from Composition or Movie Timeline.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#111317] border border-white/8">
            <button
              type="button"
              onClick={() => setExportTarget('movie')}
              className={`min-h-[40px] rounded-lg text-xs font-medium transition-colors ${
                exportTarget === 'movie'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Full Movie ({getProjectMovieDurationFrames(project)}f)
            </button>
            <button
              type="button"
              onClick={() => setExportTarget('composition')}
              className={`min-h-[40px] rounded-lg text-xs font-medium transition-colors ${
                exportTarget === 'composition'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Active Comp ({activeComp.settings.durationFrames}f)
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-[#111317] border border-white/8">
            <div className="flex items-center gap-2 min-w-0">
              {includeAudio ? (
                <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-500 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-100">Include Audio Tracks</div>
                <div className="text-[11px] text-slate-400 truncate">
                  {audioPlan.clips.length > 0
                    ? `${audioPlan.clips.length} active audio clip${audioPlan.clips.length === 1 ? '' : 's'} scheduled for mix`
                    : 'No active audio clips in this target'}
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={exporting}
              onClick={() =>
                dispatchCommand(
                  ProjectCommands.updateExportSettings({ includeAudio: !includeAudio })
                )
              }
              className={`min-h-[34px] px-3 rounded-lg border text-xs font-medium transition-colors shrink-0 disabled:opacity-50 ${
                includeAudio
                  ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-200'
                  : 'bg-[#181B20] border-white/10 text-slate-400'
              }`}
            >
              {includeAudio ? 'Enabled' : 'Muted'}
            </button>
          </div>

          {exporting ? (
            <div className="p-4 rounded-xl bg-[#111317] border border-white/10 space-y-3">
              <div className="flex items-center justify-between text-xs gap-2">
                <span className="text-slate-200 font-medium truncate">{exportPhase}</span>
                <span className="font-mono tabular-nums text-blue-400 shrink-0">{progress}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  style={{ width: `${progress}%` }}
                  className="h-full bg-blue-500 transition-all duration-150"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="min-h-[38px] px-4 rounded-lg bg-red-500/15 text-red-300 text-xs font-medium"
              >
                Cancel Render
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => void handleExportWebM()}
                className="flex-1 min-h-[44px] px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                Render WebM Video
              </button>
              <button
                type="button"
                onClick={handleExportPngSnapshot}
                className="min-h-[44px] px-4 rounded-xl bg-[#20242B] hover:bg-[#2A2F38] border border-white/10 text-slate-100 text-xs font-medium flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Camera className="w-4 h-4" />
                PNG Frame (F{currentFrame})
              </button>
            </div>
          )}

          {downloadUrl && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="truncate font-medium">{downloadName} ready</span>
              </div>
              <a
                href={downloadUrl}
                download={downloadName}
                className="min-h-[36px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" /> Save File
              </a>
            </div>
          )}
        </section>

        {/* Portable .motionx Archive & IndexedDB Backup */}
        <section className="rounded-2xl bg-[#181B20] border border-white/8 p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
              <Archive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Portable Archive (.motionx)</h2>
              <p className="text-xs text-slate-400">
                Back up or transfer your complete Project, Compositions, Assets & Characters.
              </p>
            </div>
          </div>

          <input
            ref={archiveInputRef}
            type="file"
            accept=".motionx,.json,application/json"
            onChange={handleImportMotionX}
            className="hidden"
          />

          <div className="p-3 rounded-xl bg-[#111317] border border-white/8 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                How to Create &amp; Share a .motionx File
              </span>
              <span className="text-[10px] font-mono tabular-nums text-slate-400">
                {project.compositions.length} comp · {project.assets.length} assets · {project.characters.length} chars
              </span>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400 leading-relaxed">
              <li>
                Finish editing compositions, keyframes, modifiers, lyrics, rigs, and audio tracks in the studio.
              </li>
              <li>
                Click <strong className="font-medium text-slate-200">Export .motionx</strong> below to bundle the full project into a portable <code className="text-amber-300">.motionx</code> archive file.
              </li>
              <li>
                Transfer or back up the file anywhere, then use <strong className="font-medium text-slate-200">Import .motionx</strong> (here or on the Home screen) to restore it cleanly.
              </li>
            </ol>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={handleExportMotionX}
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#20242B] hover:bg-[#2A2F38] border border-white/10 text-slate-100 text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Download className="w-4 h-4 text-amber-400" />
              Export .motionx
            </button>
            <button
              type="button"
              onClick={() => archiveInputRef.current?.click()}
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#20242B] hover:bg-[#2A2F38] border border-white/10 text-slate-100 text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Upload className="w-4 h-4 text-blue-400" />
              Import .motionx
            </button>
          </div>

          <div className="pt-3 border-t border-white/8 space-y-2">
            <div className="text-xs font-semibold text-slate-300">
              Browser Storage Projects ({savedProjects.length})
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1.5">
              {savedProjects.map((sp) => (
                <div
                  key={sp.id}
                  className="min-h-[44px] px-3 py-2 rounded-xl bg-[#111317] border border-white/8 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-100 truncate">{sp.name}</div>
                    <div className="text-[11px] text-slate-400 tabular-nums">
                      {sp.compositionCount} compositions
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {sp.id !== project.id && (
                      <>
                        <button
                          type="button"
                          onClick={() => void loadProjectById(sp.id)}
                          className="min-h-[34px] px-2.5 rounded-lg bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 flex items-center gap-1"
                        >
                          <FolderOpen className="w-3.5 h-3.5" /> Open
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteProjectFromIndexedDb(sp.id);
                            await refreshProjectList();
                          }}
                          aria-label={`Delete ${sp.name}`}
                          className="min-h-[34px] min-w-[34px] rounded-lg text-slate-400 hover:text-red-400 flex items-center justify-center"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    {sp.id === project.id && (
                      <span className="text-[11px] text-emerald-400 font-medium px-2">Active</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
