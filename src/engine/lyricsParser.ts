import type { LyricsCue, LyricsWord } from '../schema/projectSchema.ts';

function makeCueId(index: number, startFrame: number): string {
  return `cue_${index}_${startFrame}`;
}

export function splitWordsWithTiming(
  text: string,
  startFrame: number,
  endFrame: number
): LyricsWord[] {
  const clean = text.trim();
  if (!clean) return [];
  const rawWords = clean.split(/\s+/);
  const totalSpan = Math.max(rawWords.length, endFrame - startFrame);
  const totalChars = Math.max(
    1,
    rawWords.reduce((sum, w) => sum + w.length, 0)
  );

  const words: LyricsWord[] = [];
  let cursor = startFrame;
  for (let i = 0; i < rawWords.length; i++) {
    const w = rawWords[i];
    const ratio = w.length / totalChars;
    const isLast = i === rawWords.length - 1;
    const wDur = isLast
      ? Math.max(1, endFrame - cursor)
      : Math.max(1, Math.round(totalSpan * ratio));
    const wStart = Math.min(endFrame - 1, cursor);
    const wEnd = Math.max(wStart + 1, Math.min(endFrame, wStart + wDur));
    words.push({
      text: w,
      startFrame: wStart,
      endFrame: isLast ? Math.max(wStart + 1, endFrame) : wEnd,
    });
    cursor = wEnd;
  }
  return words;
}

function parseLrcTimestampToSec(minStr: string, secStr: string, fracStr?: string): number {
  const mins = parseInt(minStr, 10) || 0;
  const secs = parseInt(secStr, 10) || 0;
  let frac = 0;
  if (fracStr) {
    if (fracStr.length === 2) frac = parseInt(fracStr, 10) / 100;
    else if (fracStr.length === 3) frac = parseInt(fracStr, 10) / 1000;
    else frac = parseInt(fracStr, 10) / Math.pow(10, fracStr.length);
  }
  return mins * 60 + secs + frac;
}

export function parseLrc(lrcText: string, fps = 24, defaultTailSeconds = 3.5): LyricsCue[] {
  const safeFps = Math.max(1, fps);
  const lines = lrcText.split(/\r?\n/);
  const entries: Array<{
    startSec: number;
    text: string;
    inlineWords?: Array<{ startSec: number; text: string }>;
  }> = [];

  const lineRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const wordTagRegex = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const matches = [...line.matchAll(lineRegex)];
    if (matches.length === 0) continue;

    const contentAfterTags = line.replace(lineRegex, '').trim();
    if (!contentAfterTags) continue;

    // Parse optional enhanced karaoke tags `<mm:ss.xx>word`
    const wordMatches = [...contentAfterTags.matchAll(wordTagRegex)];
    let cleanText = contentAfterTags;
    let inlineWords: Array<{ startSec: number; text: string }> | undefined;

    if (wordMatches.length > 0) {
      inlineWords = [];
      const textParts: string[] = [];
      for (const wm of wordMatches) {
        const wSec = parseLrcTimestampToSec(wm[1], wm[2], wm[3]);
        const wText = wm[4].trim();
        if (wText) {
          for (const token of wText.split(/\s+/)) {
            inlineWords.push({ startSec: wSec, text: token });
            textParts.push(token);
          }
        }
      }
      cleanText = textParts.join(' ').trim();
    }

    if (!cleanText) continue;

    for (const m of matches) {
      const startSec = parseLrcTimestampToSec(m[1], m[2], m[3]);
      entries.push({ startSec, text: cleanText, inlineWords });
    }
  }

  entries.sort((a, b) => a.startSec - b.startSec);

  return entries.map((entry, idx) => {
    const startFrame = Math.max(0, Math.round(entry.startSec * safeFps));
    const nextEntry = entries[idx + 1];
    const rawEndSec = nextEntry
      ? Math.max(entry.startSec + 0.35, nextEntry.startSec)
      : entry.startSec + defaultTailSeconds;
    const endFrame = Math.max(startFrame + 2, Math.round(rawEndSec * safeFps));

    let words: LyricsWord[];
    if (entry.inlineWords && entry.inlineWords.length > 0) {
      words = entry.inlineWords.map((iw, wIdx) => {
        const wStart = Math.max(startFrame, Math.round(iw.startSec * safeFps));
        const nextIw = entry.inlineWords![wIdx + 1];
        const wEnd = nextIw
          ? Math.max(wStart + 1, Math.round(nextIw.startSec * safeFps))
          : Math.max(wStart + 1, endFrame);
        return { text: iw.text, startFrame: wStart, endFrame: wEnd };
      });
    } else {
      words = splitWordsWithTiming(entry.text, startFrame, endFrame);
    }

    return {
      id: makeCueId(idx, startFrame),
      startFrame,
      endFrame,
      text: entry.text,
      words,
    };
  });
}

function parseSrtTimestampToSec(h: string, m: string, s: string, ms: string): number {
  return (
    (parseInt(h, 10) || 0) * 3600 +
    (parseInt(m, 10) || 0) * 60 +
    (parseInt(s, 10) || 0) +
    (parseInt(ms, 10) || 0) / 1000
  );
}

export function parseSrt(srtText: string, fps = 24): LyricsCue[] {
  const safeFps = Math.max(1, fps);
  const blocks = srtText.trim().split(/\r?\n\s*\r?\n/);
  const cues: LyricsCue[] = [];
  const timeRegex =
    /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

  blocks.forEach((block, idx) => {
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) return;

    const timeLineIdx = lines.findIndex((l) => timeRegex.test(l));
    if (timeLineIdx < 0) return;

    const match = lines[timeLineIdx].match(timeRegex);
    if (!match) return;

    const startSec = parseSrtTimestampToSec(match[1], match[2], match[3], match[4].padEnd(3, '0'));
    const endSec = parseSrtTimestampToSec(match[5], match[6], match[7], match[8].padEnd(3, '0'));

    const text = lines
      .slice(timeLineIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!text) return;

    const startFrame = Math.max(0, Math.round(startSec * safeFps));
    const endFrame = Math.max(startFrame + 2, Math.round(endSec * safeFps));

    cues.push({
      id: makeCueId(idx, startFrame),
      startFrame,
      endFrame,
      text,
      words: splitWordsWithTiming(text, startFrame, endFrame),
    });
  });

  return cues.sort((a, b) => a.startFrame - b.startFrame);
}

export function parsePlainLyrics(
  plainText: string,
  fps = 24,
  startFrame = 0,
  lineDurationSeconds = 2.5
): LyricsCue[] {
  const safeFps = Math.max(1, fps);
  const perLineFrames = Math.max(6, Math.round(lineDurationSeconds * safeFps));
  const lines = plainText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((text, idx) => {
    const s = Math.max(0, Math.round(startFrame) + idx * perLineFrames);
    const e = s + perLineFrames;
    return {
      id: makeCueId(idx, s),
      startFrame: s,
      endFrame: e,
      text,
      words: splitWordsWithTiming(text, s, e),
    };
  });
}
