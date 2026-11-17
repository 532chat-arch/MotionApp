import React, { useEffect, useRef } from 'react';
import { Eye, Play, Sparkles, X } from 'lucide-react';
import {
  applyLayerModifiers,
  evaluateCameraAtFrame,
  evaluateLyricsAtFrame,
} from '../engine/evaluator.ts';
import type {
  EvaluatedCamera,
  EvaluatedLyricsState,
  EvaluatedMeshDeform,
  EvaluatedTransform,
} from '../engine/evaluator.ts';
import { computeEnvironmentParticles } from '../renderer/PixiEnvironmentEffects.ts';
import type { ParticleSample } from '../renderer/PixiEnvironmentEffects.ts';
import {
  CompositionRecordSchema,
  EnvironmentDocumentSchema,
} from '../schema/projectSchema.ts';
import type {
  CompositionRecord,
  EnvironmentDocument,
  MotionModifierInstance,
} from '../schema/projectSchema.ts';
import { animationPresetRegistry } from '../services/AnimationPresetRegistry.ts';
import type {
  MotionPresetDefinition,
  PresetCategory,
} from '../services/AnimationPresetRegistry.ts';

export type PresetPreviewFrameState =
  | {
      kind: 'layer';
      presetId: string;
      category: PresetCategory;
      transform: EvaluatedTransform;
      meshDeform?: EvaluatedMeshDeform;
      progress: number;
    }
  | {
      kind: 'camera';
      presetId: string;
      camera: EvaluatedCamera;
      targetPoint: { x: number; y: number };
      progress: number;
    }
  | {
      kind: 'environment';
      presetId: string;
      environment: EnvironmentDocument;
      particles: ParticleSample[];
      frame: number;
      progress: number;
    }
  | {
      kind: 'lyrics';
      presetId: string;
      lyricsState: EvaluatedLyricsState;
      progress: number;
    };

const PREVIEW_WIDTH = 248;
const PREVIEW_HEIGHT = 76;
const PREVIEW_FPS = 24;

let cachedPreviewBaseComp: CompositionRecord | null = null;
function getPreviewBaseComposition(): CompositionRecord {
  if (cachedPreviewBaseComp) return cachedPreviewBaseComp;
  const comp = CompositionRecordSchema.parse({
    id: 'preview-comp',
    name: 'Preview',
    settings: {
      width: 1920,
      height: 1080,
      durationFrames: 240,
      workAreaStart: 0,
      workAreaEnd: 239,
    },
    camera: {
      x: 0,
      y: 0,
      zoom: 1,
      rotation: 0,
      parallaxStrength: 0.85,
    },
  });
  cachedPreviewBaseComp = comp;
  return comp;
}

const PREVIEW_LYRIC_CUE = {
  id: 'preview-cue-1',
  text: 'Shine bright tonight',
  startFrame: 4,
  endFrame: 68,
  words: [
    { text: 'Shine', startFrame: 4, endFrame: 24 },
    { text: 'bright', startFrame: 24, endFrame: 44 },
    { text: 'tonight', startFrame: 44, endFrame: 68 },
  ],
};

/**
 * Pure, deterministic single-frame evaluator for the MotionPresetsPanel hover preview.
 * Uses the same animation math (`applyLayerModifiers`, `evaluateCameraAtFrame`,
 * `evaluateLyricsAtFrame`, and `computeEnvironmentParticles`) as the main stage.
 */
export function evaluatePresetPreviewState(
  preset: MotionPresetDefinition,
  elapsedSeconds: number,
  width = PREVIEW_WIDTH,
  height = PREVIEW_HEIGHT,
  fps = PREVIEW_FPS
): PresetPreviewFrameState {
  const safeTime = Math.max(0, elapsedSeconds);
  const loopSeconds =
    preset.category === 'camera' && !preset.loop
      ? Math.min(Math.max(preset.duration, 1.4), 2.8)
      : preset.category === 'lyrics'
        ? 3.2
        : preset.category === 'environment'
          ? 4.0
          : Math.min(Math.max(preset.duration, 1.0), 3.6);

  const cycleTime = safeTime % loopSeconds;
  const progress = Math.max(0, Math.min(1, cycleTime / loopSeconds));
  const loopFrames = Math.max(12, Math.round(loopSeconds * fps));
  const frame = Math.floor(progress * loopFrames);

  if (preset.category === 'environment') {
    const baseEnv = EnvironmentDocumentSchema.parse({
      presetId: 'twilight',
      skyTopColor: '#0B1221',
      skyBottomColor: '#1E3A5F',
      hazeColor: '#60A5FA',
      hazeIntensity: 0.2,
      weatherType: 'none',
      weatherDensity: 0,
      weatherLoopFrames: loopFrames,
    });
    const mergedEnv = EnvironmentDocumentSchema.parse({
      ...baseEnv,
      ...(preset.environmentPatch ?? {}),
      weatherLoopFrames: loopFrames,
    });
    const particles = computeEnvironmentParticles(mergedEnv, width, height, frame, 'reduced');
    return {
      kind: 'environment',
      presetId: preset.id,
      environment: mergedEnv,
      particles,
      frame,
      progress,
    };
  }

  if (preset.category === 'lyrics') {
    const lyricFrame = Math.round(progress * 74);
    const lyricsState =
      evaluateLyricsAtFrame(
        {
          enabled: true,
          style: preset.lyricsStyle ?? 'karaoke',
          highlightColor: '#F59E0B',
          glowColor: '#38BDF8',
          glowBlur: 8,
          shadowColor: 'rgba(0,0,0,0.65)',
          shadowBlur: 4,
          staggerFrames: 3,
          beatBpm: 120,
          beatSyncIntensity: 0.25,
          cues: [PREVIEW_LYRIC_CUE],
        },
        'Shine bright tonight',
        lyricFrame,
        fps
      ) ?? {
        style: preset.lyricsStyle ?? 'karaoke',
        cueId: PREVIEW_LYRIC_CUE.id,
        text: 'Shine bright tonight',
        progress,
        opacityMultiplier: 1,
        offsetY: 0,
        scaleMultiplier: 1,
        beatScale: 1,
        visibleCharCount: 20,
        visibleWordCount: 3,
        words: [],
        highlightColor: '#F59E0B',
        glowColor: '#38BDF8',
        glowBlur: 8,
        shadowColor: 'rgba(0,0,0,0.65)',
        shadowBlur: 4,
        staggerFrames: 3,
        localCueFrame: lyricFrame,
      };
    return {
      kind: 'lyrics',
      presetId: preset.id,
      lyricsState,
      progress,
    };
  }

  if (preset.category === 'camera') {
    const baseComp = getPreviewBaseComposition();
    const effectiveId = preset.basePresetId ?? preset.id;
    const camMod: MotionModifierInstance = animationPresetRegistry.createModifier(
      preset.id,
      fps,
      'preview-cam',
      {
        basePresetId: preset.basePresetId,
        durationFrames: loopFrames,
        loop: true,
        direction: preset.loop ? preset.playbackDirection : 'alternate',
        intensity: preset.defaultIntensity ?? 1,
      }
    ) ?? {
      id: 'preview-cam',
      presetId: preset.id,
      basePresetId: preset.basePresetId,
      label: preset.name,
      enabled: true,
      startFrame: 0,
      durationFrames: loopFrames,
      delayFrames: 0,
      loop: true,
      direction: 'alternate',
      blendMode: preset.blendMode,
      intensity: preset.defaultIntensity ?? 1,
      speed: Number(preset.parameters.speed ?? 1),
      phaseOffset: 0,
      pivotAnchor: 'center',
      params: { ...preset.parameters },
    };

    const previewComp: CompositionRecord = {
      ...baseComp,
      camera: {
        ...baseComp.camera,
        modifiers: [camMod],
      },
    };
    const targetX =
      baseComp.settings.width / 2 + Math.sin(progress * Math.PI * 2) * 140;
    const targetY =
      baseComp.settings.height / 2 + Math.cos(progress * Math.PI * 2) * 38;
    const camera = evaluateCameraAtFrame(previewComp, frame, { x: targetX, y: targetY });

    return {
      kind: 'camera',
      presetId: effectiveId,
      camera,
      targetPoint: {
        x: Math.sin(progress * Math.PI * 2) * 34,
        y: Math.cos(progress * Math.PI * 2) * 8,
      },
      progress,
    };
  }

  // Layer presets: character, hair, clothing, effects
  const effectiveId = preset.basePresetId ?? preset.id;
  const layerMod: MotionModifierInstance = animationPresetRegistry.createModifier(
    preset.id,
    fps,
    'preview-layer',
    {
      basePresetId: preset.basePresetId,
      durationFrames: loopFrames,
      loop: true,
      intensity: preset.defaultIntensity ?? 1,
    }
  ) ?? {
    id: 'preview-layer',
    presetId: preset.id,
    basePresetId: preset.basePresetId,
    label: preset.name,
    enabled: true,
    startFrame: 0,
    durationFrames: loopFrames,
    delayFrames: 0,
    loop: true,
    direction: preset.playbackDirection,
    blendMode: preset.blendMode,
    intensity: preset.defaultIntensity ?? 1,
    speed: Number(preset.parameters.speed ?? 1),
    phaseOffset: 0,
    pivotAnchor: preset.defaultPivot,
    params: { ...preset.parameters },
  };

  const evalRes = applyLayerModifiers(
    {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      pivotX: 0,
      pivotY: 0,
      opacity: 1,
    },
    [layerMod],
    frame,
    46,
    52
  );

  return {
    kind: 'layer',
    presetId: effectiveId,
    category: preset.category,
    transform: evalRes.transform,
    meshDeform: evalRes.meshDeform,
    progress,
  };
}

function drawPreviewScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  state: PresetPreviewFrameState
): void {
  ctx.clearRect(0, 0, w, h);

  // Dark editorial stage grid backdrop
  ctx.fillStyle = '#0B0D12';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  for (let gx = 20; gx < w; gx += 20) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }
  for (let gy = 18; gy < h; gy += 18) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

  if (state.kind === 'environment') {
    const env = state.environment;
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, env.skyTopColor === 'transparent' ? '#0B1221' : env.skyTopColor);
    skyGrad.addColorStop(1, env.skyBottomColor === 'transparent' ? '#1E3A5F' : env.skyBottomColor);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    // Moving clouds
    if ((env.cloudDensity ?? 0) > 0.01) {
      const cloudCount = Math.max(2, Math.round(env.cloudDensity * 5));
      const drift = state.frame * 0.9 * (env.cloudSpeed ?? 1);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.24)';
      for (let i = 0; i < cloudCount; i++) {
        const cx = ((i * 68 + drift) % (w + 60)) - 30;
        const cy = 15 + (i % 3) * 11;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 22, 7, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 12, cy + 2, 16, 5.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Distant silhouette hill
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h - 18);
    ctx.quadraticCurveTo(w * 0.35, h - 30, w * 0.68, h - 17);
    ctx.quadraticCurveTo(w * 0.85, h - 11, w, h - 22);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // Weather particles computed by PixiEnvironmentEffects helper
    for (const p of state.particles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = Math.max(0.15, Math.min(1, p.alpha));
      const r = (p.tint >> 16) & 255;
      const g = (p.tint >> 8) & 255;
      const b = p.tint & 255;
      ctx.fillStyle = `rgb(${r},${g},${b})`;

      if (p.kind === 'rain') {
        ctx.fillRect(-0.6, -5 * p.scaleY, 1.2, 10 * p.scaleY);
      } else if (p.kind === 'leaves') {
        ctx.beginPath();
        ctx.ellipse(0, 0, 3.2 * p.scaleX, 1.6 * p.scaleY, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const radius = Math.max(1.2, 2.2 * p.scaleX);
        if (p.kind === 'fireflies') {
          ctx.shadowColor = `rgb(${r},${g},${b})`;
          ctx.shadowBlur = 6;
        }
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Fog overlay bands
    if ((env.fogOpacity ?? 0) > 0.01) {
      const fogDrift = state.progress * w;
      for (let band = 0; band < 2; band++) {
        const bx = ((fogDrift + band * 110) % (w + 100)) - 50;
        const grad = ctx.createRadialGradient(bx, h - 14 - band * 12, 6, bx, h - 14 - band * 12, 70);
        grad.addColorStop(0, `rgba(226, 232, 240, ${Math.min(0.55, env.fogOpacity * 0.85)})`);
        grad.addColorStop(1, 'rgba(226, 232, 240, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, h - 42, w, 42);
      }
    }

    // Wind-blown grass blades
    if ((env.grassDensity ?? 0) > 0.01) {
      const bladeCount = Math.round(14 + env.grassDensity * 24);
      const speed = env.grassWindSpeed ?? 1;
      ctx.strokeStyle = '#34D399';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < bladeCount; i++) {
        const gx = (i / (bladeCount - 1)) * w;
        const bladeH = 11 + (i % 3) * 4;
        const sway =
          Math.sin(state.progress * Math.PI * 2 * speed + i * 0.45) * 5.5 + 2.5;
        ctx.beginPath();
        ctx.moveTo(gx, h);
        ctx.quadraticCurveTo(gx + sway * 0.4, h - bladeH * 0.55, gx + sway, h - bladeH);
        ctx.stroke();
      }
    }
    return;
  }

  if (state.kind === 'camera') {
    const cam = state.camera;
    const scaleNorm = cam.zoom;
    const panX = -cam.x * 0.14;
    const panY = -cam.y * 0.14;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(cam.rotation);
    ctx.scale(scaleNorm, scaleNorm);

    // Sky horizon
    const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    grad.addColorStop(0, '#0F172A');
    grad.addColorStop(1, '#1E293B');
    ctx.fillStyle = grad;
    ctx.fillRect(-w, -h, w * 2, h * 2);

    // Far ridge (low parallax)
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(-w, h);
    ctx.lineTo(-w, 4 + panY * 0.25);
    ctx.lineTo(-45 + panX * 0.25, -14 + panY * 0.25);
    ctx.lineTo(25 + panX * 0.25, 2 + panY * 0.25);
    ctx.lineTo(90 + panX * 0.25, -18 + panY * 0.25);
    ctx.lineTo(w, 6 + panY * 0.25);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // Midground hills (medium parallax)
    ctx.fillStyle = '#1E3A5F';
    ctx.beginPath();
    ctx.moveTo(-w, h);
    ctx.quadraticCurveTo(-30 + panX * 0.55, 8 + panY * 0.55, 40 + panX * 0.55, 18 + panY * 0.55);
    ctx.quadraticCurveTo(95 + panX * 0.55, 25 + panY * 0.55, w, 12 + panY * 0.55);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // Foreground subject marker (full parallax)
    const subjX =
      state.presetId === 'camera.follow-object'
        ? state.targetPoint.x + panX
        : panX;
    const subjY =
      state.presetId === 'camera.follow-object'
        ? state.targetPoint.y + 4 + panY
        : 4 + panY;

    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.arc(subjX, subjY - 8, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.roundRect(subjX - 8, subjY, 16, 15, 4);
    ctx.fill();
    ctx.restore();

    // Viewfinder brackets
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.55)';
    ctx.lineWidth = 1.4;
    const pad = 8;
    const arm = 9;
    const corners: Array<[number, number, number, number]> = [
      [pad, pad, 1, 1],
      [w - pad, pad, -1, 1],
      [pad, h - pad, 1, -1],
      [w - pad, h - pad, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * arm);
      ctx.stroke();
    }
    return;
  }

  if (state.kind === 'lyrics') {
    const ls = state.lyricsState;
    ctx.save();
    ctx.translate(w / 2, h / 2 + ls.offsetY * 0.45);
    const s = ls.scaleMultiplier * ls.beatScale;
    ctx.scale(s, s);
    ctx.globalAlpha = ls.opacityMultiplier;

    if (ls.style === 'beatPulse') {
      const ringAlpha = Math.max(0.08, (ls.beatScale - 1) * 2.2);
      ctx.strokeStyle = `rgba(245, 158, 11, ${ringAlpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-84, -15, 168, 30, 8);
      ctx.stroke();
    }

    ctx.font = '600 13px Inter, ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    if (ls.style === 'typewriter') {
      const full = ls.text || 'Shine bright tonight';
      const shown = full.slice(0, ls.visibleCharCount);
      const display = `${shown}${Math.floor(state.progress * 10) % 2 === 0 ? '|' : ''}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#F8FAFC';
      ctx.fillText(display, 0, 0);
    } else if (ls.words.length > 0) {
      const words = ls.words;
      const widths = words.map((wd) => ctx.measureText(wd.text).width);
      const spaceW = ctx.measureText(' ').width;
      const totalW = widths.reduce((a, b) => a + b, 0) + spaceW * Math.max(0, words.length - 1);
      let cursorX = -totalW / 2;
      ctx.textAlign = 'left';

      words.forEach((word, idx) => {
        if (ls.style === 'wordReveal' && idx >= ls.visibleWordCount) {
          cursorX += widths[idx] + spaceW;
          return;
        }
        let wordY = 0;
        let wordAlpha = 1;
        if (ls.style === 'stagger') {
          const staggerDelay = idx * 0.14;
          const wt = Math.max(0, Math.min(1, (ls.progress - staggerDelay) / 0.32));
          wordY = (1 - wt) * 10;
          wordAlpha = wt;
        }
        if (ls.style === 'charReveal') {
          const charCutoff = ls.visibleCharCount;
          const prevChars = words.slice(0, idx).reduce((sum, item) => sum + item.text.length + 1, 0);
          const localChars = Math.max(0, Math.min(word.text.length, charCutoff - prevChars));
          const slice = word.text.slice(0, localChars);
          ctx.fillStyle = '#E2E8F0';
          ctx.fillText(slice, cursorX, 0);
          cursorX += widths[idx] + spaceW;
          return;
        }

        ctx.save();
        ctx.globalAlpha *= wordAlpha;
        if (ls.style === 'karaoke') {
          if (word.isActive) {
            ctx.fillStyle = ls.highlightColor;
            ctx.shadowColor = ls.glowColor;
            ctx.shadowBlur = 8;
          } else if (word.isPassed) {
            ctx.fillStyle = '#FDE68A';
          } else {
            ctx.fillStyle = '#94A3B8';
          }
        } else {
          ctx.fillStyle = '#F8FAFC';
        }
        ctx.fillText(word.text, cursorX, wordY);
        ctx.restore();
        cursorX += widths[idx] + spaceW;
      });
    } else {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#F8FAFC';
      ctx.fillText(ls.text, 0, 0);
    }

    ctx.restore();
    return;
  }

  // Layer presets (hair, clothing, character, effects)
  const { transform, meshDeform, category, presetId } = state;
  ctx.save();
  ctx.translate(w / 2 + transform.x * 0.9, h / 2 + transform.y * 0.9);
  ctx.rotate(transform.rotation);
  ctx.scale(transform.scaleX, transform.scaleY);
  ctx.globalAlpha = transform.opacity;

  if (category === 'hair') {
    const wave = meshDeform ? meshDeform.amplitude * 1.15 : 0;
    // Crown anchor dot
    ctx.fillStyle = '#60A5FA';
    ctx.beginPath();
    ctx.arc(0, -24, 3, 0, Math.PI * 2);
    ctx.fill();

    const strandOffsets = [-12, 0, 12];
    strandOffsets.forEach((sx, idx) => {
      ctx.fillStyle = idx === 1 ? '#38BDF8' : '#2563EB';
      ctx.beginPath();
      ctx.moveTo(sx - 5, -24);
      ctx.bezierCurveTo(
        sx - 6 + wave * 0.4,
        -6,
        sx - 4 + wave * 0.95,
        12,
        sx + wave * 1.15,
        26
      );
      ctx.bezierCurveTo(
        sx + 6 + wave * 0.85,
        12,
        sx + 6 + wave * 0.35,
        -6,
        sx + 5,
        -24
      );
      ctx.closePath();
      ctx.fill();
    });
  } else if (category === 'clothing') {
    const wave = meshDeform ? meshDeform.amplitude * 1.2 : 0;
    const isHorizontal = meshDeform?.anchorEdge === 'left' || meshDeform?.anchorEdge === 'right';
    if (isHorizontal) {
      // Scarf flutter ribbon anchored on left
      ctx.fillStyle = '#EC4899';
      ctx.beginPath();
      ctx.moveTo(-34, -8);
      ctx.bezierCurveTo(-10, -10 + wave * 0.4, 14, -6 - wave * 0.6, 36, -4 + wave * 0.9);
      ctx.lineTo(36, 9 + wave * 0.9);
      ctx.bezierCurveTo(14, 7 - wave * 0.6, -10, 4 + wave * 0.4, -34, 6);
      ctx.closePath();
      ctx.fill();
    } else {
      // Skirt / cloak drape anchored at top
      ctx.fillStyle = '#A855F7';
      ctx.beginPath();
      ctx.moveTo(-16, -24);
      ctx.lineTo(16, -24);
      ctx.quadraticCurveTo(22 + wave * 0.55, 0, 26 + wave, 24);
      ctx.quadraticCurveTo(wave * 0.6, 28, -26 + wave, 24);
      ctx.quadraticCurveTo(-22 + wave * 0.55, 0, -16, -24);
      ctx.closePath();
      ctx.fill();
    }
  } else if (category === 'character') {
    if (presetId === 'character.eye-blinking') {
      // Expressive blinking eye pair
      [-24, 24].forEach((ex) => {
        ctx.fillStyle = '#F8FAFC';
        ctx.beginPath();
        ctx.ellipse(ex, 0, 14, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2563EB';
        ctx.beginPath();
        ctx.arc(ex, 0, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0F172A';
        ctx.beginPath();
        ctx.arc(ex, 0, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(ex - 2, -2.5, 1.6, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      // Character silhouette bust (head + shoulders + torso)
      ctx.fillStyle = '#3B82F6';
      ctx.beginPath();
      ctx.roundRect(-22, 2, 44, 24, 9);
      ctx.fill();

      ctx.fillStyle = '#93C5FD';
      ctx.beginPath();
      ctx.arc(0, -13, 12, 0, Math.PI * 2);
      ctx.fill();

      // Centerline & shoulder cue
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-14, 7);
      ctx.lineTo(14, 7);
      ctx.stroke();
    }
  } else {
    // Effects presets
    if (presetId === 'fx.glitch-jitter') {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.55)';
      ctx.fillRect(-20 + transform.x * 0.35, -13, 36, 26);
      ctx.fillStyle = 'rgba(34, 211, 238, 0.55)';
      ctx.fillRect(-16 - transform.x * 0.35, -11, 36, 26);
    }
    const glow = ctx.createRadialGradient(0, 0, 3, 0, 0, 24);
    glow.addColorStop(0, 'rgba(251, 191, 36, 0.95)');
    glow.addColorStop(0.5, 'rgba(56, 189, 248, 0.45)');
    glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FDE68A';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

interface PresetHoverPreviewProps {
  preset: MotionPresetDefinition | null;
  isPinned?: boolean;
  onClearPin?: () => void;
  onApplyPreset?: (preset: MotionPresetDefinition) => void;
}

export const PresetHoverPreview: React.FC<PresetHoverPreviewProps> = ({
  preset,
  isPinned = false,
  onClearPin,
  onApplyPreset,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !preset) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    canvas.width = PREVIEW_WIDTH * dpr;
    canvas.height = PREVIEW_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let rafId = 0;
    const startMs = performance.now();

    const tick = (nowMs: number) => {
      const elapsedSec = (nowMs - startMs) / 1000;
      const frameState = evaluatePresetPreviewState(
        preset,
        elapsedSec,
        PREVIEW_WIDTH,
        PREVIEW_HEIGHT,
        PREVIEW_FPS
      );
      drawPreviewScene(ctx, PREVIEW_WIDTH, PREVIEW_HEIGHT, frameState);
      if (progressBarRef.current) {
        progressBarRef.current.style.width = `${Math.round(frameState.progress * 100)}%`;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [preset]);

  return (
    <div
      data-testid="preset-hover-preview"
      className="h-[112px] rounded-xl bg-[#0D1016] border border-white/10 overflow-hidden flex flex-col justify-between shrink-0"
    >
      {preset ? (
        <>
          <div className="h-[26px] px-2.5 bg-[#131720] border-b border-white/8 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Play className="w-3 h-3 text-blue-400 shrink-0 fill-blue-400/30" />
              <span className="text-[11px] font-medium text-slate-100 truncate">
                {preset.name}
              </span>
              <span className="text-[10px] font-mono tabular-nums text-slate-400 capitalize shrink-0">
                {preset.category}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {isPinned && onApplyPreset && (
                <button
                  type="button"
                  onClick={() => onApplyPreset(preset)}
                  className="px-1.5 py-0.5 rounded bg-blue-600/25 hover:bg-blue-600 text-[10px] font-medium text-blue-200 hover:text-white transition-colors"
                >
                  Apply
                </button>
              )}
              {isPinned && onClearPin && (
                <button
                  type="button"
                  onClick={onClearPin}
                  aria-label="Close pinned preset preview"
                  className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-white/10"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          <div className="relative flex-1 flex items-center justify-center bg-[#0B0D12]">
            <canvas
              ref={canvasRef}
              aria-label={`Live miniature playback loop for ${preset.name}`}
              className="w-[248px] h-[76px] block"
            />
            <div className="absolute bottom-0 inset-x-0 h-[2px] bg-white/5">
              <div
                ref={progressBarRef}
                className="h-full bg-blue-400/80 transition-none w-0"
              />
            </div>
          </div>
        </>
      ) : (
        <div className="h-full px-3 flex flex-col items-center justify-center text-center gap-1.5">
          <div className="w-7 h-7 rounded-lg bg-[#151922] border border-white/10 flex items-center justify-center text-slate-400">
            <Eye className="w-3.5 h-3.5" />
          </div>
          <div className="space-y-0.5">
            <div className="text-[11px] font-medium text-slate-300 flex items-center justify-center gap-1">
              <Sparkles className="w-3 h-3 text-blue-400" />
              <span>Hover Preview Stage</span>
            </div>
            <p className="text-[10px] text-slate-500">
              Hover or focus any preset below to preview its motion loop
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
