import React, { useMemo, useRef, useState } from 'react';
import {
  FileText,
  Music,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ProjectCommands } from '../commands/projectCommands';
import {
  parseLrc,
  parsePlainLyrics,
  parseSrt,
  splitWordsWithTiming,
} from '../engine/lyricsParser';
import type { LyricsConfig, LyricsCue, LyricsStyle } from '../schema/projectSchema';
import { formatTimecode, getActiveCompFps, useStudioStore } from '../store/useStudioStore';

interface LyricsStudioModalProps {
  open: boolean;
  onClose: () => void;
  compositionId: string;
  layerId: string;
  objectId: string;
  initialText: string;
  initialLyrics?: LyricsConfig;
}

const LYRICS_STYLE_OPTIONS: Array<{ value: LyricsStyle; label: string; desc: string }> = [
  { value: 'karaoke', label: 'Karaoke Word Highlight', desc: 'Sweeps highlight color across words' },
  { value: 'fade', label: 'Fade In / Out', desc: 'Smooth opacity dissolve per line' },
  { value: 'slideUp', label: 'Slide Up Reveal', desc: 'Lines glide smoothly upward' },
  { value: 'scaleReveal', label: 'Scale Reveal', desc: 'Subtle punch-in scale entrance' },
  { value: 'typewriter', label: 'Typewriter Reveal', desc: 'Cursor typing character reveal' },
  { value: 'wordReveal', label: 'Word-by-Word Reveal', desc: 'Progressive word emergence' },
  { value: 'charReveal', label: 'Character Reveal', desc: 'Clean sequential character reveal' },
  { value: 'stagger', label: 'Staggered Words', desc: 'Each word rises sequentially' },
  { value: 'beatPulse', label: 'Beat-Synchronized Text', desc: 'Pulses to BPM tempo' },
  { value: 'none', label: 'Static Timed Captions', desc: 'Instant cut at cue frames' },
];

export const LyricsStudioModal: React.FC<LyricsStudioModalProps> = ({
  open,
  onClose,
  compositionId,
  layerId,
  objectId,
  initialText,
  initialLyrics,
}) => {
  const { project, currentFrame, setCurrentFrame, dispatchCommand, showFeedback } =
    useStudioStore();
  const fps = getActiveCompFps(project, compositionId);

  const [config, setConfig] = useState<LyricsConfig>(() => ({
    enabled: initialLyrics?.enabled ?? true,
    style: initialLyrics?.style ?? 'karaoke',
    highlightColor: initialLyrics?.highlightColor ?? '#F59E0B',
    glowColor: initialLyrics?.glowColor ?? '#38BDF8',
    glowBlur: initialLyrics?.glowBlur ?? 12,
    shadowColor: initialLyrics?.shadowColor ?? 'rgba(0,0,0,0.65)',
    shadowBlur: initialLyrics?.shadowBlur ?? 6,
    staggerFrames: initialLyrics?.staggerFrames ?? 3,
    beatBpm: initialLyrics?.beatBpm ?? 120,
    beatSyncIntensity: initialLyrics?.beatSyncIntensity ?? 0.15,
    cues: initialLyrics?.cues ?? [],
  }));

  const [rawImportText, setRawImportText] = useState('');
  const [importMode, setImportMode] = useState<'auto' | 'lrc' | 'srt' | 'plain'>('auto');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sortedCues = useMemo(
    () => [...config.cues].sort((a, b) => a.startFrame - b.startFrame),
    [config.cues]
  );

  if (!open) return null;

  const parseAndLoadLyrics = (raw: string, mode: 'auto' | 'lrc' | 'srt' | 'plain') => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    let detected = mode;
    if (mode === 'auto') {
      if (/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(trimmed)) detected = 'srt';
      else if (/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(trimmed)) detected = 'lrc';
      else detected = 'plain';
    }

    let parsedCues: LyricsCue[] = [];
    if (detected === 'lrc') parsedCues = parseLrc(trimmed, fps);
    else if (detected === 'srt') parsedCues = parseSrt(trimmed, fps);
    else parsedCues = parsePlainLyrics(trimmed, fps, 0, 2.5);

    if (parsedCues.length === 0) {
      showFeedback('error', 'No lyric cues detected in the provided input.');
      return;
    }

    setConfig((prev) => ({ ...prev, enabled: true, cues: parsedCues }));
    showFeedback(
      'info',
      `Parsed ${parsedCues.length} lyric cue(s) as ${detected.toUpperCase()}`
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawImportText(text);
    const ext = file.name.toLowerCase();
    const mode = ext.endsWith('.srt') ? 'srt' : ext.endsWith('.lrc') ? 'lrc' : 'auto';
    parseAndLoadLyrics(text, mode);
    e.target.value = '';
  };

  const updateCue = (cueId: string, updater: (c: LyricsCue) => LyricsCue) => {
    setConfig((prev) => ({
      ...prev,
      cues: prev.cues.map((c) => (c.id === cueId ? updater(c) : c)),
    }));
  };

  const handleAddCueAtPlayhead = () => {
    const startFrame = Math.max(0, currentFrame);
    const endFrame = startFrame + Math.max(12, Math.round(fps * 2.5));
    const lineText = initialText.trim() || `Lyric Line ${config.cues.length + 1}`;
    const newCue: LyricsCue = {
      id: `cue_manual_${Date.now().toString(36)}`,
      startFrame,
      endFrame,
      text: lineText,
      words: splitWordsWithTiming(lineText, startFrame, endFrame),
    };
    setConfig((prev) => ({
      ...prev,
      enabled: true,
      cues: [...prev.cues, newCue],
    }));
  };

  const handleSave = () => {
    const finalized: LyricsConfig = {
      ...config,
      cues: [...config.cues]
        .sort((a, b) => a.startFrame - b.startFrame)
        .map((c) => ({
          ...c,
          words:
            c.words.length > 0
              ? c.words
              : splitWordsWithTiming(c.text, c.startFrame, c.endFrame),
        })),
    };
    dispatchCommand(ProjectCommands.setTextLyrics(compositionId, layerId, objectId, finalized));
    showFeedback('info', `Saved ${finalized.cues.length} synced lyric cue(s)`);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Lyrics & Typography Animation Studio"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5"
    >
      <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl bg-[#181B20] border border-white/15 shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-[#14171C]">
          <div className="flex items-center gap-2">
            <Music className="w-4 h-4 text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold">Lyrics & Typography Studio</h2>
              <p className="text-[11px] text-slate-400">
                Import LRC / SRT files, pick karaoke & reveal presets, and fine-tune word timing
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Lyrics Studio"
            className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
          {/* Left: Style, Beat Sync & LRC/SRT Importer */}
          <div className="md:col-span-5 border-b md:border-b-0 md:border-r border-white/10 p-3.5 overflow-y-auto space-y-3.5 bg-[#16191E]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                Typography Animation
              </span>
              <button
                type="button"
                onClick={() => setConfig((c) => ({ ...c, enabled: !c.enabled }))}
                className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-medium border ${
                  config.enabled
                    ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                    : 'bg-[#111317] border-white/10 text-slate-400'
                }`}
              >
                {config.enabled ? 'Lyrics Active' : 'Disabled'}
              </button>
            </div>

            <label className="block space-y-1">
              <span className="text-[11px] text-slate-400">Reveal / Highlight Preset</span>
              <select
                value={config.style}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, style: e.target.value as LyricsStyle }))
                }
                className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-100"
              >
                {LYRICS_STYLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">Karaoke Highlight</span>
                <input
                  type="color"
                  value={config.highlightColor}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, highlightColor: e.target.value }))
                  }
                  className="w-full h-[36px] p-1 rounded-lg bg-[#111317] border border-white/10 cursor-pointer"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">Glow Accent</span>
                <input
                  type="color"
                  value={config.glowColor}
                  onChange={(e) => setConfig((c) => ({ ...c, glowColor: e.target.value }))}
                  className="w-full h-[36px] p-1 rounded-lg bg-[#111317] border border-white/10 cursor-pointer"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">Glow Blur ({config.glowBlur}px)</span>
                <input
                  type="range"
                  min={0}
                  max={36}
                  step={1}
                  value={config.glowBlur}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, glowBlur: parseInt(e.target.value, 10) }))
                  }
                  className="w-full accent-blue-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">Shadow ({config.shadowBlur}px)</span>
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={config.shadowBlur}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, shadowBlur: parseInt(e.target.value, 10) }))
                  }
                  className="w-full accent-blue-500"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/8">
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">Tempo (BPM)</span>
                <input
                  type="number"
                  min={40}
                  max={240}
                  value={config.beatBpm}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      beatBpm: Math.max(40, Math.min(240, Number(e.target.value) || 120)),
                    }))
                  }
                  className="w-full min-h-[34px] px-2 rounded-lg bg-[#111317] border border-white/10 text-xs font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">
                  Beat Pulse ({Math.round(config.beatSyncIntensity * 100)}%)
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.6}
                  step={0.02}
                  value={config.beatSyncIntensity}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      beatSyncIntensity: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-amber-400 mt-2"
                />
              </label>
            </div>

            {/* LRC / SRT / Plain Import */}
            <div className="pt-2 border-t border-white/10 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-emerald-400" />
                  Import LRC / SRT / Lyrics
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".lrc,.srt,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[32px] px-2.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/35 text-[11px] font-medium text-emerald-200 flex items-center gap-1"
                >
                  <Upload className="w-3 h-3" />
                  Load File
                </button>
              </div>

              <textarea
                rows={5}
                value={rawImportText}
                onChange={(e) => setRawImportText(e.target.value)}
                placeholder={`Paste LRC, SRT, or plain lyric lines:\n[00:01.00] Moonlight drifting on the sea\n[00:04.20] Stars awake above the trees`}
                className="w-full p-2 rounded-xl bg-[#111317] border border-white/10 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />

              <div className="flex items-center gap-2">
                <select
                  value={importMode}
                  onChange={(e) =>
                    setImportMode(e.target.value as 'auto' | 'lrc' | 'srt' | 'plain')
                  }
                  className="min-h-[36px] px-2 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-200"
                >
                  <option value="auto">Auto-detect</option>
                  <option value="lrc">LRC Timestamps</option>
                  <option value="srt">SRT Subtitles</option>
                  <option value="plain">Plain Lines (2.5s)</option>
                </select>
                <button
                  type="button"
                  onClick={() => parseAndLoadLyrics(rawImportText, importMode)}
                  disabled={!rawImportText.trim()}
                  className="flex-1 min-h-[36px] px-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-semibold text-white"
                >
                  Parse & Replace Cues
                </button>
              </div>
            </div>
          </div>

          {/* Right: Timed Cue Editor */}
          <div className="md:col-span-7 p-3.5 overflow-y-auto space-y-2.5 bg-[#12151A]">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-slate-200">
                  Timed Lyric Cues ({sortedCues.length})
                </div>
                <div className="text-[10px] text-slate-400">
                  Playhead at F{currentFrame} ({formatTimecode(currentFrame, fps)})
                </div>
              </div>
              <button
                type="button"
                onClick={handleAddCueAtPlayhead}
                className="min-h-[34px] px-2.5 rounded-lg bg-[#20242B] hover:bg-[#2A2F38] border border-white/10 text-xs font-medium text-slate-100 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5 text-amber-400" />
                Add Cue at Playhead
              </button>
            </div>

            {sortedCues.length === 0 ? (
              <div className="p-6 rounded-xl bg-[#181B20] border border-white/8 text-center space-y-2">
                <p className="text-xs text-slate-300">
                  No timed cues yet. Paste LRC/SRT text on the left or click "Add Cue at Playhead".
                </p>
                <p className="text-[11px] text-slate-500">
                  When cues are empty, typography animation still runs on the text box content itself.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {sortedCues.map((cue) => {
                  const isActive =
                    currentFrame >= cue.startFrame && currentFrame <= cue.endFrame;
                  return (
                    <div
                      key={cue.id}
                      className={`p-2.5 rounded-xl border space-y-2 ${
                        isActive
                          ? 'bg-amber-500/10 border-amber-400/45'
                          : 'bg-[#181B20] border-white/8'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setCurrentFrame(cue.startFrame)}
                          title="Jump playhead to cue start"
                          className="min-h-[30px] px-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/35 text-blue-200 text-[11px] font-mono flex items-center gap-1"
                        >
                          <Play className="w-3 h-3" />
                          {formatTimecode(cue.startFrame, fps)}
                        </button>

                        <div className="flex items-center gap-1 text-[11px] font-mono">
                          <span className="text-slate-400">In</span>
                          <input
                            type="number"
                            min={0}
                            value={cue.startFrame}
                            onChange={(e) => {
                              const nextStart = Math.max(0, parseInt(e.target.value, 10) || 0);
                              const nextEnd = Math.max(nextStart + 2, cue.endFrame);
                              updateCue(cue.id, (c) => ({
                                ...c,
                                startFrame: nextStart,
                                endFrame: nextEnd,
                                words: splitWordsWithTiming(c.text, nextStart, nextEnd),
                              }));
                            }}
                            className="w-14 h-[30px] px-1.5 rounded bg-[#111317] border border-white/10 text-center"
                          />
                          <span className="text-slate-400">Out</span>
                          <input
                            type="number"
                            min={1}
                            value={cue.endFrame}
                            onChange={(e) => {
                              const nextEnd = Math.max(
                                cue.startFrame + 2,
                                parseInt(e.target.value, 10) || cue.startFrame + 12
                              );
                              updateCue(cue.id, (c) => ({
                                ...c,
                                endFrame: nextEnd,
                                words: splitWordsWithTiming(c.text, c.startFrame, nextEnd),
                              }));
                            }}
                            className="w-14 h-[30px] px-1.5 rounded bg-[#111317] border border-white/10 text-center"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            updateCue(cue.id, (c) => {
                              const s = Math.max(0, c.startFrame - 6);
                              const e = Math.max(s + 2, c.endFrame - 6);
                              return {
                                ...c,
                                startFrame: s,
                                endFrame: e,
                                words: splitWordsWithTiming(c.text, s, e),
                              };
                            })
                          }
                          className="min-h-[28px] px-1.5 rounded bg-[#111317] border border-white/10 text-[10px] font-mono text-slate-300 hover:text-white"
                        >
                          -6f
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateCue(cue.id, (c) => {
                              const s = c.startFrame + 6;
                              const e = c.endFrame + 6;
                              return {
                                ...c,
                                startFrame: s,
                                endFrame: e,
                                words: splitWordsWithTiming(c.text, s, e),
                              };
                            })
                          }
                          className="min-h-[28px] px-1.5 rounded bg-[#111317] border border-white/10 text-[10px] font-mono text-slate-300 hover:text-white"
                        >
                          +6f
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setConfig((prev) => ({
                              ...prev,
                              cues: prev.cues.filter((c) => c.id !== cue.id),
                            }))
                          }
                          aria-label="Delete lyric cue"
                          className="ml-auto min-h-[28px] min-w-[28px] rounded flex items-center justify-center text-slate-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <input
                        type="text"
                        value={cue.text}
                        onChange={(e) => {
                          const nextText = e.target.value;
                          updateCue(cue.id, (c) => ({
                            ...c,
                            text: nextText,
                            words: splitWordsWithTiming(nextText, c.startFrame, c.endFrame),
                          }));
                        }}
                        className="w-full min-h-[34px] px-2.5 rounded-lg bg-[#111317] border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/10 bg-[#14171C] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] px-4 rounded-xl bg-[#20242B] hover:bg-[#2A2F38] text-xs font-medium text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="min-h-[38px] px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white"
          >
            Apply Lyrics to Layer
          </button>
        </div>
      </div>
    </div>
  );
};
