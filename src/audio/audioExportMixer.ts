import { getProjectMovieDurationFrames } from '../engine/evaluator.ts';
import {
  AssetRecord,
  AudioTrackDocument,
  CompositionRecord,
  MotionProject,
  fpsToNumber,
} from '../schema/projectSchema.ts';

export interface ScheduledExportAudioClip {
  assetId: string;
  startSec: number;
  durationSec: number;
  offsetSec: number;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
  loop: boolean;
}

export interface AudioExportPlan {
  totalFrames: number;
  fps: number;
  totalDurationSec: number;
  clips: ScheduledExportAudioClip[];
}

function getCompFps(project: MotionProject, comp: CompositionRecord): number {
  return comp.settings.inheritProjectFps
    ? fpsToNumber(project.settings.fps)
    : fpsToNumber(comp.settings.fps);
}

function scheduleCompTracksInWindow(
  tracks: AudioTrackDocument[],
  assets: AssetRecord[],
  compFps: number,
  windowStartInCompFrames: number,
  windowDurationFrames: number,
  outputStartFrame: number,
  outputFps: number,
  out: ScheduledExportAudioClip[]
): void {
  const anySolo = tracks.some((t) => t.solo);
  const windowEndInCompFrames = windowStartInCompFrames + windowDurationFrames;

  for (const track of tracks) {
    if (track.muted) continue;
    if (anySolo && !track.solo) continue;

    for (const clip of track.clips) {
      const asset = assets.find((a) => a.id === clip.assetId);
      if (!asset) continue;

      const clipStart = clip.startFrame;
      const clipEnd = clip.startFrame + clip.durationFrames;

      const overlapStart = Math.max(clipStart, windowStartInCompFrames);
      const overlapEnd = Math.min(clipEnd, windowEndInCompFrames);
      if (overlapEnd <= overlapStart) continue;

      const overlapFrames = overlapEnd - overlapStart;
      const outFrameOffset = overlapStart - windowStartInCompFrames;
      const startSec = (outputStartFrame + outFrameOffset) / outputFps;
      const durationSec = overlapFrames / outputFps;
      const trimmedInFrames = overlapStart - clipStart;
      const offsetSec = (clip.inFrame + trimmedInFrames) / compFps;

      const volume = Math.max(0, Math.min(2, track.volume * clip.volume));
      if (volume <= 0) continue;

      const fadeInSec =
        overlapStart === clipStart ? Math.min(durationSec, clip.fadeInFrames / compFps) : 0;
      const fadeOutSec =
        overlapEnd === clipEnd ? Math.min(durationSec, clip.fadeOutFrames / compFps) : 0;

      out.push({
        assetId: clip.assetId,
        startSec,
        durationSec,
        offsetSec,
        volume,
        fadeInSec,
        fadeOutSec,
        loop: clip.loop,
      });
    }
  }
}

/**
 * Computes a deterministic audio scheduling plan for either a single composition
 * or the full Movie Timeline (supporting trimmed in-offsets and wrapping comps).
 */
export function buildAudioExportPlan(
  project: MotionProject,
  target: 'composition' | 'movie',
  compositionId?: string
): AudioExportPlan {
  const activeComp =
    project.compositions.find((c) => c.id === compositionId) ?? project.compositions[0];

  if (!activeComp) {
    return { totalFrames: 1, fps: 24, totalDurationSec: 1 / 24, clips: [] };
  }

  const clips: ScheduledExportAudioClip[] = [];

  if (target === 'composition' || project.projectTimeline.clips.length === 0) {
    const fps = getCompFps(project, activeComp);
    const totalFrames = activeComp.settings.durationFrames;
    scheduleCompTracksInWindow(
      activeComp.audioTracks,
      project.assets,
      fps,
      0,
      totalFrames,
      0,
      fps,
      clips
    );
    return {
      totalFrames,
      fps,
      totalDurationSec: totalFrames / fps,
      clips,
    };
  }

  const movieFps = fpsToNumber(project.settings.fps);
  const totalFrames = getProjectMovieDurationFrames(project);

  for (const tlClip of project.projectTimeline.clips) {
    const comp = project.compositions.find((c) => c.id === tlClip.compositionId);
    if (!comp) continue;

    const compFps = getCompFps(project, comp);
    const compDur = Math.max(1, comp.settings.durationFrames);

    // Mirror evaluateProjectTimelineAtFrame modulo wrapping if a movie clip spans past comp duration
    let remaining = tlClip.durationFrames;
    let cursorOutFrame = tlClip.startFrame;
    let cursorCompFrame = ((tlClip.inOffsetFrames % compDur) + compDur) % compDur;

    while (remaining > 0) {
      const chunkFrames = Math.min(remaining, compDur - cursorCompFrame);
      scheduleCompTracksInWindow(
        comp.audioTracks,
        project.assets,
        compFps,
        cursorCompFrame,
        chunkFrames,
        cursorOutFrame,
        movieFps,
        clips
      );
      remaining -= chunkFrames;
      cursorOutFrame += chunkFrames;
      cursorCompFrame = 0;
    }
  }

  return {
    totalFrames,
    fps: movieFps,
    totalDurationSec: totalFrames / movieFps,
    clips,
  };
}

export function selectWebMMimeType(withAudio: boolean): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = withAudio
    ? [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=opus',
        'video/webm',
      ]
    : ['video/webm;codecs=vp9', 'video/webm'];

  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

export interface MixedAudioRenderResult {
  buffer: AudioBuffer | null;
  hasAudio: boolean;
  clipCount: number;
}

/**
 * Offline-renders all scheduled audio tracks into a single stereo AudioBuffer
 * so MediaRecorder can mux clean, stall-free audio alongside canvas frames.
 */
export async function renderMixedAudioBuffer(
  project: MotionProject,
  target: 'composition' | 'movie',
  compositionId?: string
): Promise<MixedAudioRenderResult> {
  const plan = buildAudioExportPlan(project, target, compositionId);
  if (plan.clips.length === 0) {
    return { buffer: null, hasAudio: false, clipCount: 0 };
  }

  const OfflineCtx =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;

  if (!OfflineCtx) {
    return { buffer: null, hasAudio: false, clipCount: 0 };
  }

  const sampleRate = 48000;
  const totalSamples = Math.max(1, Math.ceil(plan.totalDurationSec * sampleRate));
  const offlineCtx = new OfflineCtx(2, totalSamples, sampleRate);

  const uniqueAssetIds = [...new Set(plan.clips.map((c) => c.assetId))];
  const decodedCache = new Map<string, AudioBuffer>();

  await Promise.all(
    uniqueAssetIds.map(async (assetId) => {
      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) return;
      try {
        const res = await fetch(asset.dataUrl);
        const raw = await res.arrayBuffer();
        const decoded = await offlineCtx.decodeAudioData(raw);
        decodedCache.set(assetId, decoded);
      } catch {
        // Skip undecodable assets gracefully
      }
    })
  );

  let scheduledCount = 0;
  for (const clip of plan.clips) {
    const buffer = decodedCache.get(clip.assetId);
    if (!buffer) continue;

    const src = offlineCtx.createBufferSource();
    src.buffer = buffer;
    src.loop = clip.loop;

    const gain = offlineCtx.createGain();
    const vol = Math.max(0, Math.min(2, clip.volume));
    gain.gain.setValueAtTime(vol, clip.startSec);

    if (clip.fadeInSec > 0) {
      gain.gain.setValueAtTime(0.001, clip.startSec);
      gain.gain.linearRampToValueAtTime(vol, clip.startSec + clip.fadeInSec);
    }
    if (clip.fadeOutSec > 0 && clip.durationSec > clip.fadeOutSec) {
      const fadeStart = clip.startSec + clip.durationSec - clip.fadeOutSec;
      gain.gain.setValueAtTime(vol, fadeStart);
      gain.gain.linearRampToValueAtTime(0.001, clip.startSec + clip.durationSec);
    }

    src.connect(gain);
    gain.connect(offlineCtx.destination);

    const safeOffset = clip.offsetSec % Math.max(0.01, buffer.duration);
    try {
      src.start(clip.startSec, safeOffset, clip.durationSec);
      scheduledCount += 1;
    } catch {
      // Ignore invalid buffer offsets
    }
  }

  if (scheduledCount === 0) {
    return { buffer: null, hasAudio: false, clipCount: 0 };
  }

  const rendered = await offlineCtx.startRendering();
  return { buffer: rendered, hasAudio: true, clipCount: scheduledCount };
}
