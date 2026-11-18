import type {
  CompositionRecord,
  InterpolationType,
  Keyframe,
  LayerAnimatableProp,
  LayerDocument,
  LyricsConfig,
  LyricsStyle,
  MotionModifierInstance,
  MotionProject,
  PivotAnchorPreset,
  SceneObjectDocument,
  Transform2D,
} from '../schema/projectSchema.ts';
import { fpsToNumber } from '../schema/projectSchema.ts';

export interface EvaluatedTransform {
  x: number;
  y: number;
  rotation: number; // radians
  scaleX: number;
  scaleY: number;
  pivotX: number;
  pivotY: number;
  opacity: number;
}

export interface EvaluatedCamera {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  parallaxStrength: number;
}

export interface EvaluatedMeshDeform {
  amplitude: number; // px max wave offset along primary axis
  amplitudeY?: number; // px max wave offset along secondary axis for 2D/angled wind
  frequency: number; // cycles along object length
  phase: number; // radians
  anchorEdge: 'top' | 'bottom' | 'left' | 'right';
  axis: 'x' | 'y';
}

export interface EvaluatedLyricsWord {
  text: string;
  startFrame: number;
  endFrame: number;
  progress: number;
  isActive: boolean;
  isPassed: boolean;
}

export interface EvaluatedLyricsState {
  style: LyricsStyle;
  cueId: string | null;
  text: string;
  progress: number;
  opacityMultiplier: number;
  offsetY: number;
  scaleMultiplier: number;
  beatScale: number;
  visibleCharCount: number;
  visibleWordCount: number;
  words: EvaluatedLyricsWord[];
  highlightColor: string;
  glowColor: string;
  glowBlur: number;
  shadowColor: string;
  shadowBlur: number;
  staggerFrames: number;
  localCueFrame: number;
}

export interface EvaluatedObject {
  object: SceneObjectDocument;
  worldTransform: EvaluatedTransform;
  characterFrameIndex?: number;
  nestedFrame?: number;
  nestedComposition?: EvaluatedCompositionState;
  meshDeform?: EvaluatedMeshDeform;
  evaluatedLyrics?: EvaluatedLyricsState;
}

export interface EvaluatedLayer {
  layer: LayerDocument;
  visibleAtFrame: boolean;
  effectiveOpacity: number;
  worldTransform: EvaluatedTransform;
  parallaxOffsetX: number;
  parallaxOffsetY: number;
  objects: EvaluatedObject[];
}

export interface EvaluatedCompositionState {
  composition: CompositionRecord;
  frame: number;
  fps: number;
  camera: EvaluatedCamera;
  layers: EvaluatedLayer[];
}

export type EasingFunction = (t: number) => number;

export const EASING_FUNCTIONS: Record<InterpolationType, EasingFunction> = {
  hold: () => 0,
  linear: (t: number) => t,
  easeIn: (t: number) => t * t * t,
  easeOut: (t: number) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
};

export function applyInterpolation(t: number, mode: InterpolationType): number {
  const clamped = Math.max(0, Math.min(1, t));
  const fn = EASING_FUNCTIONS[mode] ?? EASING_FUNCTIONS.linear;
  return fn(clamped);
}

export function evaluateKeyframes(
  keyframes: Keyframe[] | undefined,
  frame: number,
  defaultValue: number
): number {
  if (!keyframes || keyframes.length === 0) return defaultValue;

  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);

  if (frame <= sorted[0].frame) return sorted[0].value;
  if (frame >= sorted[sorted.length - 1].frame) {
    return sorted[sorted.length - 1].value;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const k0 = sorted[i];
    const k1 = sorted[i + 1];
    if (frame >= k0.frame && frame <= k1.frame) {
      if (k0.frame === k1.frame || frame === k1.frame) return k1.value;
      if (frame === k0.frame || k0.interpolation === 'hold') return k0.value;
      const rawT = (frame - k0.frame) / (k1.frame - k0.frame);
      const easedT = applyInterpolation(rawT, k0.interpolation);
      return k0.value + (k1.value - k0.value) * easedT;
    }
  }

  return defaultValue;
}

function composeTransforms(parent: EvaluatedTransform, child: EvaluatedTransform): EvaluatedTransform {
  const cos = Math.cos(parent.rotation);
  const sin = Math.sin(parent.rotation);
  const sx = child.x * parent.scaleX;
  const sy = child.y * parent.scaleY;

  return {
    x: parent.x + sx * cos - sy * sin,
    y: parent.y + sx * sin + sy * cos,
    rotation: parent.rotation + child.rotation,
    scaleX: parent.scaleX * child.scaleX,
    scaleY: parent.scaleY * child.scaleY,
    pivotX: child.pivotX,
    pivotY: child.pivotY,
    opacity: parent.opacity * child.opacity,
  };
}

function getBaseTransform(t: Transform2D): EvaluatedTransform {
  return {
    x: t.x,
    y: t.y,
    rotation: t.rotation,
    scaleX: t.scaleX,
    scaleY: t.scaleY,
    pivotX: t.pivotX,
    pivotY: t.pivotY,
    opacity: t.opacity,
  };
}

function resolveNormalizedProgress(mod: MotionModifierInstance, frame: number): {
  active: boolean;
  u: number;
  phase: number;
} {
  if (!mod.enabled || mod.intensity <= 0) {
    return { active: false, u: 0, phase: 0 };
  }
  const elapsed = (frame - mod.startFrame - mod.delayFrames) * mod.speed;
  if (elapsed < 0) {
    return { active: false, u: 0, phase: 0 };
  }
  const dur = Math.max(1, mod.durationFrames);
  let u: number;
  if (mod.loop) {
    const cycle = Math.floor(elapsed / dur);
    u = (((elapsed % dur) + dur) % dur) / dur;
    if (mod.direction === 'reverse') u = 1 - u;
    else if (mod.direction === 'alternate' && cycle % 2 === 1) u = 1 - u;
  } else {
    u = Math.min(1, Math.max(0, elapsed / dur));
    if (mod.direction === 'reverse') u = 1 - u;
  }
  const shiftedU = (((u + mod.phaseOffset) % 1) + 1) % 1;
  return {
    active: true,
    u: shiftedU,
    phase: shiftedU * Math.PI * 2,
  };
}

function getPivotOffsetForPreset(
  preset: PivotAnchorPreset,
  objW: number,
  objH: number
): { ax: number; ay: number } {
  switch (preset) {
    case 'top':
      return { ax: 0, ay: -objH / 2 };
    case 'bottom':
      return { ax: 0, ay: objH / 2 };
    case 'left':
      return { ax: -objW / 2, ay: 0 };
    case 'right':
      return { ax: objW / 2, ay: 0 };
    case 'center':
    case 'custom':
    default:
      return { ax: 0, ay: 0 };
  }
}

export function getPrimaryObjectBounds(layer: LayerDocument): { w: number; h: number } {
  const obj = layer.objects[0];
  if (!obj) return { w: 160, h: 160 };
  if (obj.kind === 'text') {
    return { w: Math.max(120, obj.text.length * obj.fontSize * 0.55), h: obj.fontSize * 1.4 };
  }
  if (obj.kind === 'nestedComposition') {
    return { w: 320, h: 180 };
  }
  return { w: obj.width, h: obj.height };
}

export interface ModifierEvalResult {
  transform: EvaluatedTransform;
  meshDeform?: EvaluatedMeshDeform;
}

const BUILTIN_LAYER_KERNELS = new Set([
  'hair.gentle-wind',
  'hair.strong-wind',
  'hair.floating',
  'hair.bounce',
  'hair.side-sway',
  'cloth.gentle-sway',
  'cloth.scarf-flutter',
  'cloth.dress-movement',
  'cloth.sleeve-movement',
  'cloth.wind-driven',
  'character.breathing',
  'character.eye-blinking',
  'character.head-tilt',
  'character.body-sway',
  'character.shoulder-movement',
  'fx.glow-pulse',
  'fx.float-hover',
  'fx.glitch-jitter',
]);

function resolveLayerKernelId(
  mod: MotionModifierInstance,
  params: Record<string, string | number | boolean>
): string {
  if (BUILTIN_LAYER_KERNELS.has(mod.presetId)) return mod.presetId;
  if (mod.basePresetId && BUILTIN_LAYER_KERNELS.has(mod.basePresetId)) return mod.basePresetId;
  if (typeof params.basePresetId === 'string' && BUILTIN_LAYER_KERNELS.has(params.basePresetId)) {
    return params.basePresetId;
  }
  const idLower = mod.presetId.toLowerCase();
  if (idLower.includes('hair')) return 'hair.gentle-wind';
  if (idLower.includes('cloth') || idLower.includes('scarf') || idLower.includes('cape')) {
    return 'cloth.gentle-sway';
  }
  if (idLower.includes('blink')) return 'character.eye-blinking';
  if (idLower.includes('breath')) return 'character.breathing';
  if (idLower.includes('character') || idLower.includes('head') || idLower.includes('body')) {
    return 'character.body-sway';
  }
  if (idLower.includes('glitch')) return 'fx.glitch-jitter';
  if (idLower.includes('pulse') || idLower.includes('glow')) return 'fx.glow-pulse';
  if (idLower.includes('fx') || idLower.includes('hover') || idLower.includes('float')) {
    return 'fx.float-hover';
  }
  if (typeof params.meshDeform === 'number') return 'hair.gentle-wind';
  if (typeof params.opacityPulse === 'number') return 'fx.glow-pulse';
  if (typeof params.blinkClosedScale === 'number') return 'character.eye-blinking';
  return 'character.body-sway';
}

export function applyLayerModifiers(
  base: EvaluatedTransform,
  modifiers: MotionModifierInstance[] | undefined,
  frame: number,
  objW = 160,
  objH = 160
): ModifierEvalResult {
  if (!modifiers || modifiers.length === 0) {
    return { transform: base };
  }

  let x = base.x;
  let y = base.y;
  let rotation = base.rotation;
  let scaleX = base.scaleX;
  let scaleY = base.scaleY;
  let opacity = base.opacity;
  let meshDeform: EvaluatedMeshDeform | undefined;

  for (const mod of modifiers) {
    const prog = resolveNormalizedProgress(mod, frame);
    if (!prog.active) continue;

    const { u, phase } = prog;
    const amp = mod.intensity;
    const params = mod.params ?? {};
    const numParam = (key: string, fallback: number) =>
      typeof params[key] === 'number' ? (params[key] as number) : fallback;
    const windDirectionRaw = typeof params.windDirection === 'string' ? params.windDirection : 'right';
    let windAngleDeg = 0;
    if (windDirectionRaw === 'custom' && typeof params.windAngle === 'number') {
      windAngleDeg = params.windAngle;
    } else if (windDirectionRaw === 'left') {
      windAngleDeg = 180;
    } else if (windDirectionRaw === 'up') {
      windAngleDeg = -90;
    } else if (windDirectionRaw === 'down') {
      windAngleDeg = 90;
    } else if (typeof params.windAngle === 'number' && params.windAngle !== 0 && windDirectionRaw === 'right') {
      // Allow custom windAngle override if explicitly tweaked
      windAngleDeg = params.windAngle;
    }
    const windRad = (windAngleDeg * Math.PI) / 180;
    const windDirX = Math.abs(Math.cos(windRad)) < 1e-6 ? 0 : Math.cos(windRad);
    const windDirY = Math.abs(Math.sin(windRad)) < 1e-6 ? 0 : Math.sin(windRad);
    const windSign = windDirX < 0 || windDirectionRaw === 'left' ? -1 : 1;
    const rotSign = windDirX !== 0 ? Math.sign(windDirX) : windDirY < 0 ? -1 : 1;
    const resolveAnchorEdge = (
      fallback: 'top' | 'bottom' | 'left' | 'right'
    ): 'top' | 'bottom' | 'left' | 'right' => {
      const v = params.anchorEdge;
      if (v === 'top' || v === 'bottom' || v === 'left' || v === 'right') return v;
      return fallback;
    };

    let dx = 0;
    let dy = 0;
    let dRot = 0;
    let dScaleX = 0;
    let dScaleY = 0;
    let multScaleX = 1;
    let multScaleY = 1;
    let multOpacity = 1;

    const kernelId = resolveLayerKernelId(mod, params);
    switch (kernelId) {
      case 'hair.gentle-wind': {
        const rotRad = (numParam('rotationStrength', 4) * amp * Math.PI) / 180;
        const move = numParam('movementStrength', 5) * amp;
        const meshAmp = numParam('meshDeform', 4) * amp;
        const waveEnvelope = 0.55 + 0.45 * Math.sin(phase);
        dRot = rotSign * (rotRad * 0.3 + Math.sin(phase) * rotRad);
        dx = windDirX * Math.sin(phase) * move;
        dy = windDirY * Math.sin(phase) * move;
        if (meshAmp > 0.05) {
          const anchor = resolveAnchorEdge('top');
          const primaryAxis: 'x' | 'y' =
            anchor === 'left' || anchor === 'right'
              ? Math.abs(windDirX) > Math.abs(windDirY)
                ? 'x'
                : 'y'
              : 'x';
          meshDeform = {
            amplitude: meshAmp * windDirX * waveEnvelope,
            amplitudeY: windDirY !== 0 ? meshAmp * windDirY * waveEnvelope : undefined,
            frequency: 1.5,
            phase,
            anchorEdge: anchor,
            axis: primaryAxis,
          };
        }
        break;
      }

      case 'hair.strong-wind': {
        const rotRad = (numParam('rotationStrength', 11) * amp * Math.PI) / 180;
        const move = numParam('movementStrength', 14) * amp;
        const meshAmp = numParam('meshDeform', 10) * amp;
        const gust = Math.sin(phase) * 0.65 + Math.sin(phase * 2.3) * 0.35;
        const waveEnvelope = 0.5 + 0.5 * gust;
        dRot = rotSign * (rotRad * 0.55 + gust * rotRad);
        dx = windDirX * (0.45 + 0.55 * gust) * move;
        dy = Math.sin(phase * 2) * move * 0.18 + windDirY * (0.45 + 0.55 * gust) * move;
        if (meshAmp > 0.05) {
          const anchor = resolveAnchorEdge('top');
          meshDeform = {
            amplitude: meshAmp * windDirX * waveEnvelope,
            amplitudeY: windDirY !== 0 ? meshAmp * windDirY * waveEnvelope : undefined,
            frequency: 2.2,
            phase,
            anchorEdge: anchor,
            axis: 'x',
          };
        }
        break;
      }

      case 'hair.floating': {
        const rotRad = (numParam('rotationStrength', 5) * amp * Math.PI) / 180;
        const move = numParam('movementStrength', 9) * amp;
        const meshAmp = numParam('meshDeform', 7) * amp;
        const wave = Math.sin(phase);
        dRot = rotSign * wave * rotRad;
        dy = (wave * 0.5 - Math.abs(Math.cos(phase * 0.5)) * 0.4) * move + windDirY * wave * move * 0.35;
        dx = Math.cos(phase) * move * 0.25 * (windDirX !== 0 ? windDirX : 1);
        if (meshAmp > 0.05) {
          meshDeform = {
            amplitude: meshAmp * (windDirX !== 0 ? windDirX : 0.4) * wave,
            amplitudeY: windDirY !== 0 ? meshAmp * windDirY * wave : undefined,
            frequency: 1.6,
            phase,
            anchorEdge: resolveAnchorEdge('top'),
            axis: 'x',
          };
        }
        break;
      }

      case 'hair.bounce': {
        const move = numParam('movementStrength', 8) * amp;
        const sc = numParam('scaleStrength', 0.035) * amp;
        const rotRad = (numParam('rotationStrength', 2) * amp * Math.PI) / 180;
        const b = Math.abs(Math.sin(phase));
        const bounceDirY = windDirectionRaw === 'down' ? 1 : windDirectionRaw === 'up' ? -1 : -1;
        dy = bounceDirY * b * move + windDirY * b * move * 0.35;
        dx = windDirX !== 1 ? windDirX * b * move * 0.35 : 0;
        dScaleY = b * sc;
        dScaleX = -b * sc * 0.5;
        dRot = rotSign * Math.sin(phase) * rotRad;
        break;
      }

      case 'hair.side-sway': {
        const rotRad = (numParam('rotationStrength', 3.5) * amp * Math.PI) / 180;
        const move = numParam('movementStrength', 3) * amp;
        const meshAmp = numParam('meshDeform', 0) * amp;
        const sway = Math.sin(phase);
        dRot = rotSign * sway * rotRad;
        dx = windDirX * sway * move;
        dy = windDirY * sway * move;
        if (meshAmp > 0.05) {
          meshDeform = {
            amplitude: meshAmp * windDirX * sway,
            amplitudeY: windDirY !== 0 ? meshAmp * windDirY * sway : undefined,
            frequency: 1.3,
            phase,
            anchorEdge: resolveAnchorEdge('top'),
            axis: 'x',
          };
        }
        break;
      }

      case 'cloth.gentle-sway': {
        const rotRad = (numParam('rotationStrength', 3) * amp * Math.PI) / 180;
        const move = numParam('movementStrength', 4) * amp;
        const meshAmp = numParam('meshDeform', 4) * amp;
        const sway = Math.sin(phase);
        dRot = rotSign * sway * rotRad;
        dx = windDirX * sway * move;
        dy = windDirY * sway * move;
        if (meshAmp > 0.05) {
          meshDeform = {
            amplitude: meshAmp * windDirX * sway,
            amplitudeY: windDirY !== 0 ? meshAmp * windDirY * sway : undefined,
            frequency: 1.4,
            phase,
            anchorEdge: resolveAnchorEdge('top'),
            axis: 'x',
          };
        }
        break;
      }

      case 'cloth.scarf-flutter': {
        const rotRad = (numParam('rotationStrength', 6) * amp * Math.PI) / 180;
        const move = numParam('movementStrength', 8) * amp;
        const meshAmp = numParam('meshDeform', 11) * amp;
        const flutter = Math.sin(phase) * 0.7 + Math.cos(phase * 2.1) * 0.3;
        dRot = rotSign * flutter * rotRad;
        dy = Math.sin(phase * 2) * move * 0.45 + windDirY * Math.sin(phase) * move * 0.4;
        dx = windDirX * Math.cos(phase) * move * 0.3;
        if (meshAmp > 0.05) {
          const defaultEdge = windSign > 0 ? 'left' : 'right';
          const anchor = resolveAnchorEdge(defaultEdge);
          meshDeform = {
            amplitude: anchor === 'left' || anchor === 'right' ? meshAmp : meshAmp * windDirX,
            amplitudeY:
              anchor === 'left' || anchor === 'right'
                ? windDirY !== 0
                  ? meshAmp * (0.6 + 0.4 * windDirY)
                  : undefined
                : windDirY !== 0
                  ? meshAmp * windDirY
                  : undefined,
            frequency: 2.5,
            phase,
            anchorEdge: anchor,
            axis: anchor === 'left' || anchor === 'right' ? 'y' : 'x',
          };
        }
        break;
      }

      case 'cloth.dress-movement': {
        const rotRad = (numParam('rotationStrength', 4.5) * amp * Math.PI) / 180;
        const move = numParam('movementStrength', 6) * amp;
        const sc = numParam('scaleStrength', 0.03) * amp;
        const meshAmp = numParam('meshDeform', 6) * amp;
        const waveEnvelope = 0.4 + 0.6 * Math.sin(phase);
        dRot = rotSign * Math.sin(phase) * rotRad;
        dx = windDirX * Math.sin(phase) * move * 0.5;
        dy = windDirY * Math.sin(phase) * move * 0.5;
        dScaleX = Math.sin(phase * 2) * sc;
        if (meshAmp > 0.05) {
          meshDeform = {
            amplitude: meshAmp * windDirX * waveEnvelope,
            amplitudeY: windDirY !== 0 ? meshAmp * windDirY * waveEnvelope : undefined,
            frequency: 1.8,
            phase,
            anchorEdge: resolveAnchorEdge('top'),
            axis: 'x',
          };
        }
        break;
      }

      case 'cloth.sleeve-movement': {
        const rotRad = (numParam('rotationStrength', 5) * amp * Math.PI) / 180;
        const move = numParam('movementStrength', 4) * amp;
        const meshAmp = numParam('meshDeform', 5) * amp;
        dRot = rotSign * Math.sin(phase) * rotRad;
        dy = Math.cos(phase) * move + windDirY * Math.sin(phase) * move * 0.4;
        dx = windDirX !== 1 ? windDirX * Math.sin(phase) * move * 0.4 : 0;
        if (meshAmp > 0.05) {
          meshDeform = {
            amplitude: meshAmp * windDirX * Math.sin(phase),
            amplitudeY: windDirY !== 0 ? meshAmp * windDirY * Math.sin(phase) : undefined,
            frequency: 1.5,
            phase,
            anchorEdge: resolveAnchorEdge('top'),
            axis: 'x',
          };
        }
        break;
      }

      case 'cloth.wind-driven': {
        const rotRad = (numParam('rotationStrength', 9) * amp * Math.PI) / 180;
        const move = numParam('movementStrength', 10) * amp;
        const meshAmp = numParam('meshDeform', 9) * amp;
        const gust = 0.55 + 0.45 * Math.sin(phase) + 0.2 * Math.sin(phase * 3);
        dRot = rotSign * gust * rotRad;
        dx = windDirX * gust * move * 0.7;
        dy = windDirY * gust * move * 0.7;
        if (meshAmp > 0.05) {
          meshDeform = {
            amplitude: meshAmp * windDirX * gust,
            amplitudeY: windDirY !== 0 ? meshAmp * windDirY * gust : undefined,
            frequency: 2.3,
            phase,
            anchorEdge: resolveAnchorEdge('top'),
            axis: 'x',
          };
        }
        break;
      }

      case 'character.breathing': {
        const move = numParam('movementStrength', 3.5) * amp;
        const sc = numParam('scaleStrength', 0.025) * amp;
        const breath = 0.5 - 0.5 * Math.cos(phase);
        dy = -breath * move;
        dScaleY = breath * sc;
        dScaleX = -breath * sc * 0.35;
        break;
      }

      case 'character.eye-blinking': {
        const closedScale = Math.max(0.02, Math.min(0.8, numParam('blinkClosedScale', 0.08)));
        const win = Math.max(0.03, Math.min(0.3, numParam('blinkWidthRatio', 0.09)));
        const doubleBlink = Boolean(params.doubleBlink);
        let blinkAmt = 0;
        if (u < win) {
          blinkAmt = Math.sin((u / win) * Math.PI);
        } else if (doubleBlink && u >= win * 1.4 && u < win * 2.4) {
          blinkAmt = Math.sin(((u - win * 1.4) / win) * Math.PI);
        }
        multScaleY = 1 - blinkAmt * (1 - closedScale) * Math.min(1, amp);
        break;
      }

      case 'character.head-tilt': {
        const rotRad = (numParam('rotationStrength', 4.5) * amp * Math.PI) / 180;
        const move = numParam('movementStrength', 2) * amp;
        dRot = Math.sin(phase) * rotRad;
        dx = Math.sin(phase) * move;
        break;
      }

      case 'character.body-sway': {
        const move = numParam('movementStrength', 6) * amp;
        const rotRad = (numParam('rotationStrength', 1.8) * amp * Math.PI) / 180;
        dx = Math.sin(phase) * move;
        dRot = Math.sin(phase) * rotRad;
        break;
      }

      case 'character.shoulder-movement': {
        const move = numParam('movementStrength', 4) * amp;
        const rotRad = (numParam('rotationStrength', 1.5) * amp * Math.PI) / 180;
        const lift = 0.5 - 0.5 * Math.cos(phase);
        dy = -lift * move;
        dRot = Math.sin(phase) * rotRad;
        break;
      }

      case 'fx.glow-pulse': {
        const sc = numParam('scaleStrength', 0.06) * amp;
        const opDip = Math.min(0.9, numParam('opacityPulse', 0.25) * amp);
        const pulse = 0.5 + 0.5 * Math.sin(phase);
        dScaleX = pulse * sc;
        dScaleY = pulse * sc;
        multOpacity = 1 - pulse * opDip;
        break;
      }

      case 'fx.float-hover': {
        const move = numParam('movementStrength', 12) * amp;
        const rotRad = (numParam('rotationStrength', 2) * amp * Math.PI) / 180;
        dy = Math.sin(phase) * move;
        dRot = Math.sin(phase * 0.5) * rotRad;
        break;
      }

      case 'fx.glitch-jitter': {
        const move = numParam('movementStrength', 6) * amp;
        const rotRad = (numParam('rotationStrength', 1.5) * amp * Math.PI) / 180;
        const stepF = Math.floor(frame * mod.speed);
        const jx = Math.sin(stepF * 19.31 + mod.phaseOffset * 11);
        const jy = Math.cos(stepF * 31.7 + mod.phaseOffset * 7);
        const burst = Math.abs(Math.sin(stepF * 0.45)) > 0.72 ? 1 : 0.15;
        dx = jx * move * burst;
        dy = jy * move * 0.6 * burst;
        dRot = jx * rotRad * burst;
        break;
      }

      default:
        break;
    }

    // Apply pivot anchor offset so rotation/scale happens cleanly around top/bottom/left/right edge
    const { ax, ay } = getPivotOffsetForPreset(mod.pivotAnchor, objW, objH);
    const localSX = multScaleX * (1 + dScaleX);
    const localSY = multScaleY * (1 + dScaleY);
    if ((ax !== 0 || ay !== 0) && (dRot !== 0 || localSX !== 1 || localSY !== 1)) {
      const cosR = Math.cos(dRot);
      const sinR = Math.sin(dRot);
      dx += ax - (ax * localSX * cosR - ay * localSY * sinR);
      dy += ay - (ax * localSX * sinR + ay * localSY * cosR);
    }

    x += dx;
    y += dy;
    rotation += dRot;
    if (mod.blendMode === 'multiply') {
      scaleX *= Math.max(0.01, multScaleX * (1 + dScaleX));
      scaleY *= Math.max(0.01, multScaleY * (1 + dScaleY));
    } else {
      scaleX = Math.max(0.01, scaleX * multScaleX + dScaleX);
      scaleY = Math.max(0.01, scaleY * multScaleY + dScaleY);
    }
    opacity = Math.max(0, Math.min(1, opacity * multOpacity));
  }

  return {
    transform: {
      ...base,
      x,
      y,
      rotation,
      scaleX,
      scaleY,
      opacity,
    },
    meshDeform,
  };
}

function evaluateLayerLocalTransform(
  layer: LayerDocument,
  frame: number
): { transform: EvaluatedTransform; meshDeform?: EvaluatedMeshDeform } {
  const baseObj = layer.objects[0]?.transform ?? {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    pivotX: 0,
    pivotY: 0,
    opacity: 1,
  };

  const evalProp = (prop: LayerAnimatableProp, fallback: number) =>
    evaluateKeyframes(layer.keyframes[prop], frame, fallback);

  const keyframed: EvaluatedTransform = {
    x: evalProp('x', baseObj.x),
    y: evalProp('y', baseObj.y),
    rotation: evalProp('rotation', baseObj.rotation),
    scaleX: evalProp('scaleX', baseObj.scaleX),
    scaleY: evalProp('scaleY', baseObj.scaleY),
    pivotX: baseObj.pivotX,
    pivotY: baseObj.pivotY,
    opacity: evalProp('opacity', layer.opacity),
  };

  const { w, h } = getPrimaryObjectBounds(layer);
  return applyLayerModifiers(keyframed, layer.modifiers, frame, w, h);
}

export function evaluateLyricsAtFrame(
  lyrics: LyricsConfig | undefined,
  fallbackText: string,
  frame: number,
  fps: number
): EvaluatedLyricsState | undefined {
  if (!lyrics || !lyrics.enabled) return undefined;

  const beatPeriodFrames = Math.max(1, (60 / Math.max(40, lyrics.beatBpm)) * Math.max(1, fps));
  const beatPhase = (((frame % beatPeriodFrames) + beatPeriodFrames) % beatPeriodFrames) / beatPeriodFrames;
  // Crisp attack, smooth exponential release on every beat
  const beatPulseEnv = Math.exp(-beatPhase * 4.5);
  const beatScale =
    lyrics.style === 'beatPulse' || lyrics.beatSyncIntensity > 0
      ? 1 + beatPulseEnv * (lyrics.style === 'beatPulse' ? Math.max(0.12, lyrics.beatSyncIntensity) : lyrics.beatSyncIntensity * 0.4)
      : 1;

  // Find active cue at current frame, or fall back to static display if no cues exist
  const activeCue = lyrics.cues.find((c) => frame >= c.startFrame && frame <= c.endFrame);
  if (lyrics.cues.length > 0 && !activeCue) {
    // Outside any cue window -> empty transparent text
    return {
      style: lyrics.style,
      cueId: null,
      text: '',
      progress: 0,
      opacityMultiplier: 0,
      offsetY: 0,
      scaleMultiplier: 1,
      beatScale: 1,
      visibleCharCount: 0,
      visibleWordCount: 0,
      words: [],
      highlightColor: lyrics.highlightColor,
      glowColor: lyrics.glowColor,
      glowBlur: lyrics.glowBlur,
      shadowColor: lyrics.shadowColor,
      shadowBlur: lyrics.shadowBlur,
      staggerFrames: lyrics.staggerFrames,
      localCueFrame: 0,
    };
  }

  const text = activeCue ? activeCue.text : fallbackText;
  const startF = activeCue ? activeCue.startFrame : 0;
  const endF = activeCue ? activeCue.endFrame : Math.max(24, Math.round(fps * 2));
  const span = Math.max(1, endF - startF);
  const localFrame = Math.max(0, frame - startF);
  const progress = Math.max(0, Math.min(1, localFrame / span));

  const wordsRaw =
    activeCue && activeCue.words.length > 0
      ? activeCue.words
      : text
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((w, idx, arr) => {
            const wSpan = span / Math.max(1, arr.length);
            const ws = Math.round(startF + idx * wSpan);
            const we = Math.max(ws + 1, Math.round(startF + (idx + 1) * wSpan));
            return { text: w, startFrame: ws, endFrame: we };
          });

  const evaluatedWords: EvaluatedLyricsWord[] = wordsRaw.map((w) => {
    const wSpan = Math.max(1, w.endFrame - w.startFrame);
    const wProg = Math.max(0, Math.min(1, (frame - w.startFrame) / wSpan));
    return {
      text: w.text,
      startFrame: w.startFrame,
      endFrame: w.endFrame,
      progress: wProg,
      isActive: frame >= w.startFrame && frame <= w.endFrame,
      isPassed: frame > w.endFrame,
    };
  });

  const fadeInT = Math.min(1, localFrame / Math.max(2, Math.min(10, span * 0.2)));
  const fadeOutT = Math.min(1, (endF - frame) / Math.max(2, Math.min(10, span * 0.2)));
  const edgeFade = Math.min(fadeInT, fadeOutT);

  let opacityMultiplier = 1;
  let offsetY = 0;
  let scaleMultiplier = 1;
  let visibleCharCount = text.length;
  let visibleWordCount = evaluatedWords.length;

  switch (lyrics.style) {
    case 'fade':
      opacityMultiplier = applyInterpolation(edgeFade, 'easeInOut');
      break;
    case 'slideUp': {
      const enter = applyInterpolation(fadeInT, 'easeOut');
      opacityMultiplier = applyInterpolation(edgeFade, 'easeInOut');
      offsetY = (1 - enter) * 24;
      break;
    }
    case 'scaleReveal': {
      const enter = applyInterpolation(fadeInT, 'easeOut');
      opacityMultiplier = applyInterpolation(edgeFade, 'easeInOut');
      scaleMultiplier = 0.72 + 0.28 * enter;
      break;
    }
    case 'typewriter':
    case 'charReveal': {
      const revealSpan = Math.min(1, progress / 0.82);
      visibleCharCount = Math.max(0, Math.min(text.length, Math.ceil(revealSpan * text.length)));
      opacityMultiplier = fadeOutT;
      break;
    }
    case 'wordReveal': {
      const passedOrActive = evaluatedWords.filter((w) => frame >= w.startFrame).length;
      visibleWordCount = Math.max(1, passedOrActive);
      opacityMultiplier = fadeOutT;
      break;
    }
    case 'karaoke':
    case 'stagger':
    case 'beatPulse':
    case 'none':
    default:
      opacityMultiplier = activeCue ? Math.min(1, fadeInT * 1.4, fadeOutT * 1.4) : 1;
      break;
  }

  return {
    style: lyrics.style,
    cueId: activeCue?.id ?? null,
    text,
    progress,
    opacityMultiplier: Math.max(0, Math.min(1, opacityMultiplier)),
    offsetY,
    scaleMultiplier,
    beatScale,
    visibleCharCount,
    visibleWordCount,
    words: evaluatedWords,
    highlightColor: lyrics.highlightColor,
    glowColor: lyrics.glowColor,
    glowBlur: lyrics.glowBlur,
    shadowColor: lyrics.shadowColor,
    shadowBlur: lyrics.shadowBlur,
    staggerFrames: lyrics.staggerFrames,
    localCueFrame: localFrame,
  };
}

const BUILTIN_CAMERA_KERNELS = new Set([
  'camera.slow-zoom-in',
  'camera.slow-zoom-out',
  'camera.horizontal-pan',
  'camera.vertical-pan',
  'camera.shake',
  'camera.parallax-drift',
  'camera.follow-object',
]);

function resolveCameraKernelId(
  mod: MotionModifierInstance,
  params: Record<string, string | number | boolean>
): string {
  if (BUILTIN_CAMERA_KERNELS.has(mod.presetId)) return mod.presetId;
  if (mod.basePresetId && BUILTIN_CAMERA_KERNELS.has(mod.basePresetId)) return mod.basePresetId;
  if (typeof params.basePresetId === 'string' && BUILTIN_CAMERA_KERNELS.has(params.basePresetId)) {
    return params.basePresetId;
  }
  if (typeof params.shakeX === 'number' || typeof params.shakeY === 'number') return 'camera.shake';
  if (typeof params.panDistanceX === 'number') return 'camera.horizontal-pan';
  if (typeof params.panDistanceY === 'number') return 'camera.vertical-pan';
  if (typeof params.zoomDelta === 'number') {
    return params.zoomDelta < 0 ? 'camera.slow-zoom-out' : 'camera.slow-zoom-in';
  }
  if (typeof params.followStrength === 'number') return 'camera.follow-object';
  return 'camera.parallax-drift';
}

export function evaluateCameraAtFrame(
  composition: CompositionRecord,
  frame: number,
  followTargetPos?: { x: number; y: number } | null
): EvaluatedCamera {
  const cam = composition.camera;
  let x = evaluateKeyframes(cam.keyframes.x, frame, cam.x);
  let y = evaluateKeyframes(cam.keyframes.y, frame, cam.y);
  let zoom = Math.max(0.1, evaluateKeyframes(cam.keyframes.zoom, frame, cam.zoom));
  let rotation = cam.rotation;

  for (const mod of cam.modifiers ?? []) {
    const prog = resolveNormalizedProgress(mod, frame);
    if (!prog.active) continue;

    const { u, phase } = prog;
    const amp = mod.intensity;
    const params = mod.params ?? {};
    const numParam = (key: string, fallback: number) =>
      typeof params[key] === 'number' ? (params[key] as number) : fallback;

    const kernelId = resolveCameraKernelId(mod, params);
    switch (kernelId) {
      case 'camera.slow-zoom-in':
      case 'camera.slow-zoom-out': {
        const delta = numParam(
          'zoomDelta',
          kernelId === 'camera.slow-zoom-in' ? 0.22 : -0.18
        );
        zoom = Math.max(0.15, zoom + applyInterpolation(u, 'easeInOut') * delta * amp);
        break;
      }
      case 'camera.horizontal-pan': {
        const panX = numParam('panDistanceX', 160);
        x += (applyInterpolation(u, 'easeInOut') - 0.5) * panX * amp;
        break;
      }
      case 'camera.vertical-pan': {
        const panY = numParam('panDistanceY', 110);
        y += (applyInterpolation(u, 'easeInOut') - 0.5) * panY * amp;
        break;
      }
      case 'camera.shake': {
        const sx = numParam('shakeX', 10) * amp;
        const sy = numParam('shakeY', 7) * amp;
        const sRot = (numParam('shakeRotDeg', 0.8) * amp * Math.PI) / 180;
        const freq = numParam('frequency', 6);
        const t = phase * freq;
        x += (Math.sin(t) * 0.65 + Math.sin(t * 2.13 + 1.2) * 0.35) * sx;
        y += (Math.cos(t * 1.37) * 0.65 + Math.cos(t * 2.71 + 0.5) * 0.35) * sy;
        rotation += Math.sin(t * 1.7 + 0.8) * sRot;
        break;
      }
      case 'camera.parallax-drift': {
        const dx = numParam('driftX', 38) * amp;
        const dy = numParam('driftY', 16) * amp;
        const zPulse = numParam('zoomPulse', 0.03) * amp;
        x += Math.sin(phase) * dx;
        y += Math.sin(phase * 2) * dy * 0.5;
        zoom = Math.max(0.15, zoom + (0.5 - 0.5 * Math.cos(phase)) * zPulse);
        break;
      }
      case 'camera.follow-object': {
        if (followTargetPos) {
          const strength = Math.max(0, Math.min(1, numParam('followStrength', 1) * amp));
          const offX = numParam('offsetX', 0);
          const offY = numParam('offsetY', 0);
          const desiredX = followTargetPos.x - composition.settings.width / 2 + offX;
          const desiredY = followTargetPos.y - composition.settings.height / 2 + offY;
          x = x + (desiredX - x) * strength;
          y = y + (desiredY - y) * strength;
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    x,
    y,
    zoom,
    rotation,
    parallaxStrength: cam.parallaxStrength,
  };
}

/**
 * Pure, deterministic frame evaluation for any Composition at integer frame `frame`.
 * Does not accumulate delta state across frames — calling with frame N always
 * produces the exact same visual state.
 */
export function evaluateCompositionAtFrame(
  project: MotionProject,
  compositionId: string,
  frame: number,
  visitedStack: Set<string> = new Set()
): EvaluatedCompositionState | null {
  const composition = project.compositions.find((c) => c.id === compositionId);
  if (!composition) return null;

  if (visitedStack.has(compositionId)) return null;
  const nextVisited = new Set(visitedStack);
  nextVisited.add(compositionId);

  const projectFps = fpsToNumber(project.settings.fps);
  const compFps = composition.settings.inheritProjectFps
    ? projectFps
    : fpsToNumber(composition.settings.fps);

  const anySolo = composition.layers.some((l) => l.solo);

  const layerMap = new Map<string, LayerDocument>();
  for (const l of composition.layers) {
    layerMap.set(l.id, l);
  }

  const resolvedLayerTransforms = new Map<string, EvaluatedTransform>();
  const resolvedLayerMeshDeform = new Map<string, EvaluatedMeshDeform | undefined>();

  const resolveLayerWorld = (layerId: string, seen = new Set<string>()): EvaluatedTransform => {
    const cached = resolvedLayerTransforms.get(layerId);
    if (cached) return cached;

    const layer = layerMap.get(layerId);
    if (!layer || seen.has(layerId)) {
      return {
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        pivotX: 0,
        pivotY: 0,
        opacity: 1,
      };
    }

    const { transform: local, meshDeform } = evaluateLayerLocalTransform(layer, frame);
    resolvedLayerMeshDeform.set(layerId, meshDeform);

    if (layer.parentId && layerMap.has(layer.parentId)) {
      const nextSeen = new Set(seen);
      nextSeen.add(layerId);
      const parentWorld = resolveLayerWorld(layer.parentId, nextSeen);
      const composed = composeTransforms(parentWorld, local);
      resolvedLayerTransforms.set(layerId, composed);
      return composed;
    }

    resolvedLayerTransforms.set(layerId, local);
    return local;
  };

  // Pre-resolve layer world transforms so camera.follow-object can target any layer deterministically
  for (const layer of composition.layers) {
    resolveLayerWorld(layer.id);
  }

  let followTargetPos: { x: number; y: number } | null = null;
  const followId =
    composition.camera.followLayerId ||
    (composition.camera.modifiers?.find((m) => m.presetId === 'camera.follow-object' && m.enabled)
      ?.params?.followLayerId as string | undefined);
  if (followId && resolvedLayerTransforms.has(followId)) {
    const targetT = resolvedLayerTransforms.get(followId)!;
    followTargetPos = { x: targetT.x, y: targetT.y };
  }

  const camera = evaluateCameraAtFrame(composition, frame, followTargetPos);

  const evaluatedLayers: EvaluatedLayer[] = composition.layers.map((layer) => {
    const withinRange = frame >= layer.inFrame && frame <= layer.outFrame;
    const isVisible = layer.visible && withinRange && (!anySolo || layer.solo);

    const layerWorld = resolveLayerWorld(layer.id);
    const layerMeshDeform = resolvedLayerMeshDeform.get(layer.id);

    const depthFactor = layer.depth * camera.parallaxStrength;
    const parallaxOffsetX = -camera.x * depthFactor * 0.45;
    const parallaxOffsetY = -camera.y * depthFactor * 0.35;

    const evaluatedObjects: EvaluatedObject[] = layer.objects.map((obj, index) => {
      const objTransform: EvaluatedTransform =
        index === 0
          ? {
              ...layerWorld,
              opacity: layerWorld.opacity * obj.transform.opacity,
            }
          : composeTransforms(layerWorld, getBaseTransform(obj.transform));

      let characterFrameIndex: number | undefined;
      let nestedFrame: number | undefined;
      let nestedComposition: EvaluatedCompositionState | undefined;
      let evaluatedLyrics: EvaluatedLyricsState | undefined;

      if (obj.kind === 'character') {
        const charDef = project.characters.find((c) => c.id === obj.characterId);
        const clip = charDef?.clips.find((cl) => cl.id === obj.activeClipId) ?? charDef?.clips[0];
        if (clip && clip.frameIndices.length > 0) {
          const localFrames = Math.max(0, (frame - layer.inFrame - obj.clipOffsetFrames) * obj.playbackSpeed);
          const seconds = localFrames / compFps;
          const rawClipStep = Math.floor(seconds * clip.fps);
          const idx = clip.loop
            ? ((rawClipStep % clip.frameIndices.length) + clip.frameIndices.length) % clip.frameIndices.length
            : Math.min(clip.frameIndices.length - 1, Math.max(0, rawClipStep));
          characterFrameIndex = clip.frameIndices[idx];
        }
      } else if (obj.kind === 'nestedComposition') {
        const childComp = project.compositions.find((c) => c.id === obj.compositionId);
        if (childComp) {
          const rawChildFrame = Math.floor(
            (frame - layer.inFrame - obj.timeOffsetFrames) * obj.playbackSpeed
          );
          const childDur = Math.max(1, childComp.settings.durationFrames);
          nestedFrame = obj.loop
            ? ((rawChildFrame % childDur) + childDur) % childDur
            : Math.max(0, Math.min(childDur - 1, rawChildFrame));
          nestedComposition =
            evaluateCompositionAtFrame(project, obj.compositionId, nestedFrame, nextVisited) ??
            undefined;
        }
      } else if (obj.kind === 'text' && obj.lyrics) {
        evaluatedLyrics = evaluateLyricsAtFrame(obj.lyrics, obj.text, frame, compFps);
      }

      return {
        object: obj,
        worldTransform: objTransform,
        characterFrameIndex,
        nestedFrame,
        nestedComposition,
        meshDeform: index === 0 ? layerMeshDeform : undefined,
        evaluatedLyrics,
      };
    });

    return {
      layer,
      visibleAtFrame: isVisible,
      effectiveOpacity: Math.max(0, Math.min(1, layerWorld.opacity)),
      worldTransform: layerWorld,
      parallaxOffsetX,
      parallaxOffsetY,
      objects: evaluatedObjects,
    };
  });

  return {
    composition,
    frame,
    fps: compFps,
    camera,
    layers: evaluatedLayers,
  };
}

/**
 * Computes total movie duration in frames from Project Timeline clips.
 */
export function getProjectMovieDurationFrames(project: MotionProject): number {
  if (project.projectTimeline.clips.length === 0) {
    return project.compositions[0]?.settings.durationFrames ?? 240;
  }
  return project.projectTimeline.clips.reduce(
    (maxEnd, clip) => Math.max(maxEnd, clip.startFrame + clip.durationFrames),
    1
  );
}

/**
 * Evaluates which Composition(s) and transition blend apply at a given movie frame
 * on the Project Timeline.
 */
export function evaluateProjectTimelineAtFrame(
  project: MotionProject,
  movieFrame: number
): {
  primary: EvaluatedCompositionState | null;
  outgoing: EvaluatedCompositionState | null;
  transitionType: 'cut' | 'crossDissolve' | 'fadeBlack';
  transitionProgress: number; // 0..1
} {
  const clips = [...project.projectTimeline.clips].sort((a, b) => a.startFrame - b.startFrame);
  const activeClips = clips.filter(
    (c) => movieFrame >= c.startFrame && movieFrame < c.startFrame + c.durationFrames
  );

  if (activeClips.length === 0) {
    return {
      primary: null,
      outgoing: null,
      transitionType: 'cut',
      transitionProgress: 1,
    };
  }

  const topClip = activeClips[activeClips.length - 1];
  const comp = project.compositions.find((c) => c.id === topClip.compositionId);
  const compDur = comp?.settings.durationFrames ?? 240;
  const localFrame =
    ((movieFrame - topClip.startFrame + topClip.inOffsetFrames) % compDur + compDur) % compDur;
  const primary = evaluateCompositionAtFrame(project, topClip.compositionId, localFrame);

  const framesIntoClip = movieFrame - topClip.startFrame;
  let transitionProgress = 1;
  if (
    topClip.transitionIn !== 'cut' &&
    topClip.transitionDurationFrames > 0 &&
    framesIntoClip < topClip.transitionDurationFrames
  ) {
    transitionProgress = framesIntoClip / topClip.transitionDurationFrames;
  }

  let outgoing: EvaluatedCompositionState | null = null;
  if (activeClips.length > 1) {
    const prevClip = activeClips[activeClips.length - 2];
    const prevComp = project.compositions.find((c) => c.id === prevClip.compositionId);
    const prevDur = prevComp?.settings.durationFrames ?? 240;
    const prevLocal =
      ((movieFrame - prevClip.startFrame + prevClip.inOffsetFrames) % prevDur + prevDur) % prevDur;
    outgoing = evaluateCompositionAtFrame(project, prevClip.compositionId, prevLocal);
  }

  return {
    primary,
    outgoing,
    transitionType: topClip.transitionIn,
    transitionProgress,
  };
}
