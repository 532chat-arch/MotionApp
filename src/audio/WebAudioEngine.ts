import { AudioTrackDocument, AssetRecord } from '../schema/projectSchema';

export class WebAudioEngine {
  private ctx: AudioContext | null = null;
  private bufferCache = new Map<string, AudioBuffer>();
  private peaksCache = new Map<string, number[]>();
  private activeSources: AudioBufferSourceNode[] = [];
  private masterGain: GainNode | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  async decodeAsset(asset: AssetRecord): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(asset.id)) {
      return this.bufferCache.get(asset.id)!;
    }
    try {
      const ctx = this.ensureContext();
      const response = await fetch(asset.dataUrl);
      const arrayBuf = await response.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuf);
      this.bufferCache.set(asset.id, decoded);
      this.peaksCache.set(asset.id, this.extractPeaks(decoded, 64));
      return decoded;
    } catch {
      return null;
    }
  }

  getWaveformPeaks(assetId: string): number[] {
    return this.peaksCache.get(assetId) ?? [];
  }

  private extractPeaks(buffer: AudioBuffer, bars: number): number[] {
    const channel = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(channel.length / bars));
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const start = i * step;
      const end = Math.min(channel.length, start + step);
      for (let j = start; j < end; j++) {
        const val = Math.abs(channel[j]);
        if (val > max) max = val;
      }
      peaks.push(max);
    }
    return peaks;
  }

  stopAll(): void {
    for (const src of this.activeSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // already stopped
      }
    }
    this.activeSources = [];
  }

  async startPlayback(
    tracks: AudioTrackDocument[],
    assets: AssetRecord[],
    startFrame: number,
    fps: number,
    masterMuted = false
  ): Promise<void> {
    this.stopAll();
    if (masterMuted) return;

    const ctx = this.ensureContext();
    if (!this.masterGain) return;

    const anySolo = tracks.some((t) => t.solo);
    const startSec = startFrame / fps;

    for (const track of tracks) {
      if (track.muted) continue;
      if (anySolo && !track.solo) continue;

      for (const clip of track.clips) {
        const asset = assets.find((a) => a.id === clip.assetId);
        if (!asset) continue;
        const buffer = await this.decodeAsset(asset);
        if (!buffer) continue;

        const clipStartSec = clip.startFrame / fps;
        const clipDurationSec = clip.durationFrames / fps;
        const clipEndSec = clipStartSec + clipDurationSec;

        if (clipEndSec <= startSec) continue;

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = clip.loop;

        const gain = ctx.createGain();
        const vol = Math.max(0, Math.min(2, track.volume * clip.volume));
        gain.gain.setValueAtTime(vol, ctx.currentTime);

        const fadeInSec = clip.fadeInFrames / fps;
        const fadeOutSec = clip.fadeOutFrames / fps;

        const delaySec = Math.max(0, clipStartSec - startSec);
        const offsetInBuffer =
          clip.inFrame / fps + Math.max(0, startSec - clipStartSec);
        const playDuration = Math.max(0.01, clipEndSec - Math.max(startSec, clipStartSec));

        const when = ctx.currentTime + delaySec;
        if (fadeInSec > 0 && startSec <= clipStartSec) {
          gain.gain.setValueAtTime(0.001, when);
          gain.gain.linearRampToValueAtTime(vol, when + fadeInSec);
        }
        if (fadeOutSec > 0 && playDuration > fadeOutSec) {
          gain.gain.setValueAtTime(vol, when + playDuration - fadeOutSec);
          gain.gain.linearRampToValueAtTime(0.001, when + playDuration);
        }

        src.connect(gain);
        gain.connect(this.masterGain);

        try {
          const safeOffset = offsetInBuffer % Math.max(0.01, buffer.duration);
          src.start(when, safeOffset, playDuration);
          this.activeSources.push(src);
        } catch {
          // ignore invalid start offsets
        }
      }
    }
  }

  dispose(): void {
    this.stopAll();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
