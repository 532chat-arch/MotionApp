import { z } from 'zod';
import {
  EnvironmentDocumentSchema,
  LyricsStyleSchema,
  MotionModifierBlendSchema,
  MotionModifierDirectionSchema,
  PivotAnchorPresetSchema,
} from '../schema/projectSchema.ts';
import type {
  EnvironmentDocument,
  LyricsStyle,
  MotionModifierBlend,
  MotionModifierDirection,
  MotionModifierInstance,
  PivotAnchorPreset,
} from '../schema/projectSchema.ts';

export const PresetCategorySchema = z.enum([
  'character',
  'hair',
  'clothing',
  'environment',
  'camera',
  'lyrics',
  'effects',
]);
export type PresetCategory = z.infer<typeof PresetCategorySchema>;

export const PresetTargetTypeSchema = z.enum([
  'image',
  'sprite',
  'character-part',
  'character',
  'shape',
  'text',
  'layer',
  'camera',
  'environment',
]);
export type PresetTargetType = z.infer<typeof PresetTargetTypeSchema>;

export const PresetParameterValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const PresetParameterControlSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['number', 'select', 'boolean', 'color']),
  defaultValue: PresetParameterValueSchema,
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  options: z
    .array(
      z.object({
        value: z.string(),
        label: z.string(),
      })
    )
    .optional(),
});
export type PresetParameterSchema = z.infer<typeof PresetParameterControlSchema>;

export const AnimationPresetSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1).default('1.0.0'),
  name: z.string().min(1),
  category: PresetCategorySchema,
  description: z.string().default(''),
  targetType: z.array(PresetTargetTypeSchema).min(1),
  duration: z.number().positive().default(2.5), // seconds
  loop: z.boolean().default(true),
  playbackDirection: MotionModifierDirectionSchema.default('forward'),
  blendMode: MotionModifierBlendSchema.default('add'),
  defaultPivot: PivotAnchorPresetSchema.default('center'),
  parameters: z.record(z.string(), PresetParameterValueSchema).default({}),
  parameterControls: z.array(PresetParameterControlSchema).default([]),
  basePresetId: z.string().min(1).optional(),
  defaultIntensity: z.number().min(0).max(5).optional(),
  environmentPatch: EnvironmentDocumentSchema.partial().optional(),
  lyricsStyle: LyricsStyleSchema.optional(),
});

export type MotionPresetDefinition = {
  id: string;
  version: string;
  name: string;
  category: PresetCategory;
  description: string;
  targetType: PresetTargetType[];
  duration: number;
  loop: boolean;
  playbackDirection: MotionModifierDirection;
  blendMode: MotionModifierBlend;
  defaultPivot: PivotAnchorPreset;
  parameters: Record<string, string | number | boolean>;
  parameterControls: PresetParameterSchema[];
  basePresetId?: string;
  defaultIntensity?: number;
  environmentPatch?: Partial<EnvironmentDocument>;
  lyricsStyle?: LyricsStyle;
};

export const ANIMATION_PRESET_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'MotionStudioAnimationPreset',
  type: 'object',
  required: ['id', 'version', 'name', 'category', 'targetType', 'duration', 'loop', 'parameters'],
  properties: {
    id: { type: 'string', minLength: 1, examples: ['hair.gentle-wind'] },
    version: { type: 'string', minLength: 1, default: '1.0.0' },
    name: { type: 'string', minLength: 1 },
    category: {
      type: 'string',
      enum: PresetCategorySchema.options,
    },
    description: { type: 'string' },
    targetType: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'string',
        enum: PresetTargetTypeSchema.options,
      },
    },
    duration: { type: 'number', exclusiveMinimum: 0 },
    loop: { type: 'boolean' },
    playbackDirection: {
      type: 'string',
      enum: ['forward', 'reverse', 'alternate'],
      default: 'forward',
    },
    blendMode: {
      type: 'string',
      enum: ['add', 'multiply'],
      default: 'add',
    },
    defaultPivot: {
      type: 'string',
      enum: ['center', 'top', 'bottom', 'left', 'right', 'custom'],
      default: 'center',
    },
    parameters: {
      type: 'object',
      additionalProperties: {
        type: ['string', 'number', 'boolean'],
      },
    },
    parameterControls: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'label', 'type', 'defaultValue'],
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          type: { type: 'string', enum: ['number', 'select', 'boolean', 'color'] },
          defaultValue: { type: ['string', 'number', 'boolean'] },
          min: { type: 'number' },
          max: { type: 'number' },
          step: { type: 'number' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              required: ['value', 'label'],
              properties: {
                value: { type: 'string' },
                label: { type: 'string' },
              },
            },
          },
        },
      },
    },
    basePresetId: { type: 'string', minLength: 1 },
    defaultIntensity: { type: 'number', minimum: 0, maximum: 5 },
    environmentPatch: { type: 'object' },
    lyricsStyle: { type: 'string', enum: LyricsStyleSchema.options },
  },
  additionalProperties: false,
};

export const PRESET_REGISTRY: MotionPresetDefinition[] = [
  // =========================================================================
  // HAIR PRESETS (5)
  // =========================================================================
  {
    id: 'hair.gentle-wind',
    version: '1.0.0',
    name: 'Gentle Wind',
    category: 'hair',
    description: 'Soft cyclic breeze for front, side, or back hair layers with subtle strip wave.',
    targetType: ['image', 'sprite', 'character-part', 'layer'],
    duration: 2.5,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'top',
    parameters: {
      rotationStrength: 4,
      movementStrength: 5,
      speed: 1,
      windDirection: 'right',
      meshDeform: 4,
    },
    parameterControls: [
      { key: 'rotationStrength', label: 'Rotation (°)', type: 'number', defaultValue: 4, min: 0, max: 25, step: 0.5 },
      { key: 'movementStrength', label: 'Drift (px)', type: 'number', defaultValue: 5, min: 0, max: 40, step: 1 },
      { key: 'meshDeform', label: 'Wave Bend (px)', type: 'number', defaultValue: 4, min: 0, max: 30, step: 1 },
      {
        key: 'windDirection',
        label: 'Wind Direction',
        type: 'select',
        defaultValue: 'right',
        options: [
          { value: 'right', label: 'Blow Right' },
          { value: 'left', label: 'Blow Left' },
        ],
      },
    ],
  },
  {
    id: 'hair.strong-wind',
    version: '1.0.0',
    name: 'Strong Wind',
    category: 'hair',
    description: 'Energetic wind gusts lifting and whipping hair locks in one direction.',
    targetType: ['image', 'sprite', 'character-part', 'layer'],
    duration: 1.5,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'top',
    parameters: {
      rotationStrength: 11,
      movementStrength: 14,
      speed: 1.6,
      windDirection: 'right',
      meshDeform: 10,
    },
    parameterControls: [
      { key: 'rotationStrength', label: 'Rotation (°)', type: 'number', defaultValue: 11, min: 0, max: 35, step: 0.5 },
      { key: 'movementStrength', label: 'Drift (px)', type: 'number', defaultValue: 14, min: 0, max: 60, step: 1 },
      { key: 'meshDeform', label: 'Flutter Bend (px)', type: 'number', defaultValue: 10, min: 0, max: 35, step: 1 },
      {
        key: 'windDirection',
        label: 'Wind Direction',
        type: 'select',
        defaultValue: 'right',
        options: [
          { value: 'right', label: 'Blow Right' },
          { value: 'left', label: 'Blow Left' },
        ],
      },
    ],
  },
  {
    id: 'hair.floating',
    version: '1.0.0',
    name: 'Floating Hair',
    category: 'hair',
    description: 'Dreamy zero-gravity levitation wave ideal for emotional or magical scenes.',
    targetType: ['image', 'sprite', 'character-part', 'layer'],
    duration: 3.2,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'top',
    parameters: {
      rotationStrength: 5,
      movementStrength: 9,
      speed: 0.85,
      windDirection: 'right',
      meshDeform: 7,
    },
    parameterControls: [
      { key: 'rotationStrength', label: 'Tilt (°)', type: 'number', defaultValue: 5, min: 0, max: 25, step: 0.5 },
      { key: 'movementStrength', label: 'Float Lift (px)', type: 'number', defaultValue: 9, min: 0, max: 40, step: 1 },
      { key: 'meshDeform', label: 'Ribbon Wave (px)', type: 'number', defaultValue: 7, min: 0, max: 25, step: 1 },
    ],
  },
  {
    id: 'hair.bounce',
    version: '1.0.0',
    name: 'Hair Bounce',
    category: 'hair',
    description: 'Crisp rhythmic vertical bounce with subtle volume squash-and-stretch.',
    targetType: ['image', 'sprite', 'character-part', 'layer'],
    duration: 0.9,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'top',
    parameters: {
      movementStrength: 8,
      scaleStrength: 0.035,
      rotationStrength: 2,
      speed: 1,
    },
    parameterControls: [
      { key: 'movementStrength', label: 'Bounce (px)', type: 'number', defaultValue: 8, min: 0, max: 35, step: 1 },
      { key: 'scaleStrength', label: 'Squash Amount', type: 'number', defaultValue: 0.035, min: 0, max: 0.2, step: 0.005 },
      { key: 'rotationStrength', label: 'Tip Swing (°)', type: 'number', defaultValue: 2, min: 0, max: 15, step: 0.5 },
    ],
  },
  {
    id: 'hair.side-sway',
    version: '1.0.0',
    name: 'Subtle Side Sway',
    category: 'hair',
    description: 'Balanced pendulum sway around the hair root anchor.',
    targetType: ['image', 'sprite', 'character-part', 'layer'],
    duration: 2.8,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'top',
    parameters: {
      rotationStrength: 3.5,
      movementStrength: 3,
      speed: 1,
      windDirection: 'right',
    },
    parameterControls: [
      { key: 'rotationStrength', label: 'Swing (°)', type: 'number', defaultValue: 3.5, min: 0, max: 20, step: 0.5 },
      { key: 'movementStrength', label: 'Sway (px)', type: 'number', defaultValue: 3, min: 0, max: 25, step: 1 },
    ],
  },

  // =========================================================================
  // CLOTHING PRESETS (5)
  // =========================================================================
  {
    id: 'cloth.gentle-sway',
    version: '1.0.0',
    name: 'Gentle Cloth Sway',
    category: 'clothing',
    description: 'Calm hanging fabric sway around a top shoulder or waist pivot.',
    targetType: ['image', 'sprite', 'character-part', 'layer'],
    duration: 3.0,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'top',
    parameters: {
      rotationStrength: 3,
      movementStrength: 4,
      speed: 1,
      windDirection: 'right',
      meshDeform: 4,
    },
    parameterControls: [
      { key: 'rotationStrength', label: 'Swing (°)', type: 'number', defaultValue: 3, min: 0, max: 20, step: 0.5 },
      { key: 'movementStrength', label: 'Drift (px)', type: 'number', defaultValue: 4, min: 0, max: 30, step: 1 },
      { key: 'meshDeform', label: 'Fabric Wave (px)', type: 'number', defaultValue: 4, min: 0, max: 25, step: 1 },
    ],
  },
  {
    id: 'cloth.scarf-flutter',
    version: '1.0.0',
    name: 'Scarf Flutter',
    category: 'clothing',
    description: 'Trailing scarf wave anchored at the collar with brisk trailing edge ripple.',
    targetType: ['image', 'sprite', 'character-part', 'layer'],
    duration: 1.6,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'left',
    parameters: {
      rotationStrength: 6,
      movementStrength: 8,
      speed: 1.4,
      windDirection: 'right',
      meshDeform: 11,
    },
    parameterControls: [
      { key: 'rotationStrength', label: 'Lift (°)', type: 'number', defaultValue: 6, min: 0, max: 25, step: 0.5 },
      { key: 'movementStrength', label: 'Tail Wave (px)', type: 'number', defaultValue: 8, min: 0, max: 40, step: 1 },
      { key: 'meshDeform', label: 'Ripple Bend (px)', type: 'number', defaultValue: 11, min: 0, max: 32, step: 1 },
      {
        key: 'windDirection',
        label: 'Wind Direction',
        type: 'select',
        defaultValue: 'right',
        options: [
          { value: 'right', label: 'Blow Right' },
          { value: 'left', label: 'Blow Left' },
        ],
      },
    ],
  },
  {
    id: 'cloth.dress-movement',
    version: '1.0.0',
    name: 'Dress Movement',
    category: 'clothing',
    description: 'Flowing skirt/dress hem sway with subtle flare and rotation.',
    targetType: ['image', 'sprite', 'character-part', 'layer'],
    duration: 2.6,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'top',
    parameters: {
      rotationStrength: 4.5,
      movementStrength: 6,
      scaleStrength: 0.03,
      speed: 1,
      windDirection: 'right',
      meshDeform: 6,
    },
    parameterControls: [
      { key: 'rotationStrength', label: 'Hem Swing (°)', type: 'number', defaultValue: 4.5, min: 0, max: 22, step: 0.5 },
      { key: 'scaleStrength', label: 'Flare Amount', type: 'number', defaultValue: 0.03, min: 0, max: 0.15, step: 0.005 },
      { key: 'meshDeform', label: 'Pleat Wave (px)', type: 'number', defaultValue: 6, min: 0, max: 25, step: 1 },
    ],
  },
  {
    id: 'cloth.sleeve-movement',
    version: '1.0.0',
    name: 'Sleeve Movement',
    category: 'clothing',
    description: 'Soft cuff swing and vertical follow-through for wide sleeves.',
    targetType: ['image', 'sprite', 'character-part', 'layer'],
    duration: 2.2,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'top',
    parameters: {
      rotationStrength: 5,
      movementStrength: 4,
      speed: 1,
      windDirection: 'right',
      meshDeform: 5,
    },
    parameterControls: [
      { key: 'rotationStrength', label: 'Cuff Swing (°)', type: 'number', defaultValue: 5, min: 0, max: 25, step: 0.5 },
      { key: 'movementStrength', label: 'Vertical Bob (px)', type: 'number', defaultValue: 4, min: 0, max: 25, step: 1 },
      { key: 'meshDeform', label: 'Wave Bend (px)', type: 'number', defaultValue: 5, min: 0, max: 20, step: 1 },
    ],
  },
  {
    id: 'cloth.wind-driven',
    version: '1.0.0',
    name: 'Wind-Driven Cloth',
    category: 'clothing',
    description: 'Continuous directional lean with gusty high-frequency fabric ripple.',
    targetType: ['image', 'sprite', 'character-part', 'layer'],
    duration: 1.8,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'top',
    parameters: {
      rotationStrength: 9,
      movementStrength: 10,
      speed: 1.5,
      windDirection: 'right',
      meshDeform: 9,
    },
    parameterControls: [
      { key: 'rotationStrength', label: 'Gust Lean (°)', type: 'number', defaultValue: 9, min: 0, max: 30, step: 0.5 },
      { key: 'movementStrength', label: 'Offset (px)', type: 'number', defaultValue: 10, min: 0, max: 45, step: 1 },
      { key: 'meshDeform', label: 'Ripple (px)', type: 'number', defaultValue: 9, min: 0, max: 30, step: 1 },
      {
        key: 'windDirection',
        label: 'Wind Direction',
        type: 'select',
        defaultValue: 'right',
        options: [
          { value: 'right', label: 'Blow Right' },
          { value: 'left', label: 'Blow Left' },
        ],
      },
    ],
  },

  // =========================================================================
  // CHARACTER IDLE PRESETS (5 — stackable!)
  // =========================================================================
  {
    id: 'character.breathing',
    version: '1.0.0',
    name: 'Breathing',
    category: 'character',
    description: 'Subtle torso rise and chest expansion that blends cleanly with other idle motions.',
    targetType: ['character', 'character-part', 'sprite', 'image', 'layer'],
    duration: 3.0,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'bottom',
    parameters: {
      movementStrength: 3.5,
      scaleStrength: 0.025,
      speed: 1,
    },
    parameterControls: [
      { key: 'movementStrength', label: 'Chest Rise (px)', type: 'number', defaultValue: 3.5, min: 0, max: 20, step: 0.5 },
      { key: 'scaleStrength', label: 'Breath Scale', type: 'number', defaultValue: 0.025, min: 0, max: 0.15, step: 0.005 },
    ],
  },
  {
    id: 'character.eye-blinking',
    version: '1.0.0',
    name: 'Eye Blinking',
    category: 'character',
    description: 'Periodic crisp blink pulse on vertical scale around eye-layer center.',
    targetType: ['character-part', 'sprite', 'image', 'shape', 'layer'],
    duration: 3.5,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'multiply',
    defaultPivot: 'center',
    parameters: {
      blinkClosedScale: 0.08,
      blinkWidthRatio: 0.09,
      doubleBlink: false,
    },
    parameterControls: [
      { key: 'blinkClosedScale', label: 'Closed Scale Y', type: 'number', defaultValue: 0.08, min: 0.02, max: 0.5, step: 0.02 },
      { key: 'blinkWidthRatio', label: 'Blink Window', type: 'number', defaultValue: 0.09, min: 0.04, max: 0.25, step: 0.01 },
      { key: 'doubleBlink', label: 'Double Blink', type: 'boolean', defaultValue: false },
    ],
  },
  {
    id: 'character.head-tilt',
    version: '1.0.0',
    name: 'Head Tilt',
    category: 'character',
    description: 'Expressive subtle head tilt around neck/bottom pivot.',
    targetType: ['character-part', 'sprite', 'image', 'layer'],
    duration: 4.0,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'bottom',
    parameters: {
      rotationStrength: 4.5,
      movementStrength: 2,
      speed: 1,
    },
    parameterControls: [
      { key: 'rotationStrength', label: 'Tilt Angle (°)', type: 'number', defaultValue: 4.5, min: 0, max: 20, step: 0.5 },
      { key: 'movementStrength', label: 'Shift (px)', type: 'number', defaultValue: 2, min: 0, max: 15, step: 0.5 },
    ],
  },
  {
    id: 'character.body-sway',
    version: '1.0.0',
    name: 'Body Sway',
    category: 'character',
    description: 'Natural weight shift side-to-side anchored at character feet.',
    targetType: ['character', 'character-part', 'sprite', 'image', 'layer'],
    duration: 3.6,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'bottom',
    parameters: {
      movementStrength: 6,
      rotationStrength: 1.8,
      speed: 1,
    },
    parameterControls: [
      { key: 'movementStrength', label: 'Side Shift (px)', type: 'number', defaultValue: 6, min: 0, max: 30, step: 0.5 },
      { key: 'rotationStrength', label: 'Body Lean (°)', type: 'number', defaultValue: 1.8, min: 0, max: 12, step: 0.2 },
    ],
  },
  {
    id: 'character.shoulder-movement',
    version: '1.0.0',
    name: 'Shoulder Movement',
    category: 'character',
    description: 'Soft vertical shoulder lift synced with relaxed breathing cadence.',
    targetType: ['character-part', 'sprite', 'image', 'layer'],
    duration: 3.0,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {
      movementStrength: 4,
      rotationStrength: 1.5,
      speed: 1,
    },
    parameterControls: [
      { key: 'movementStrength', label: 'Lift (px)', type: 'number', defaultValue: 4, min: 0, max: 20, step: 0.5 },
      { key: 'rotationStrength', label: 'Roll (°)', type: 'number', defaultValue: 1.5, min: 0, max: 10, step: 0.5 },
    ],
  },

  // =========================================================================
  // CAMERA PRESETS (7)
  // =========================================================================
  {
    id: 'camera.slow-zoom-in',
    version: '1.0.0',
    name: 'Slow Zoom In',
    category: 'camera',
    description: 'Gradual cinematic push-in across the composition duration.',
    targetType: ['camera'],
    duration: 6.0,
    loop: false,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {
      zoomDelta: 0.22,
    },
    parameterControls: [
      { key: 'zoomDelta', label: 'Zoom Gain', type: 'number', defaultValue: 0.22, min: 0.02, max: 1.5, step: 0.02 },
    ],
  },
  {
    id: 'camera.slow-zoom-out',
    version: '1.0.0',
    name: 'Slow Zoom Out',
    category: 'camera',
    description: 'Smooth pull-back reveal widening the framing.',
    targetType: ['camera'],
    duration: 6.0,
    loop: false,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {
      zoomDelta: -0.18,
    },
    parameterControls: [
      { key: 'zoomDelta', label: 'Zoom Delta', type: 'number', defaultValue: -0.18, min: -0.75, max: 0, step: 0.02 },
    ],
  },
  {
    id: 'camera.horizontal-pan',
    version: '1.0.0',
    name: 'Horizontal Pan',
    category: 'camera',
    description: 'Smooth lateral camera pan revealing multi-depth parallax layers.',
    targetType: ['camera'],
    duration: 6.0,
    loop: false,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {
      panDistanceX: 160,
    },
    parameterControls: [
      { key: 'panDistanceX', label: 'Pan X (px)', type: 'number', defaultValue: 160, min: -800, max: 800, step: 10 },
    ],
  },
  {
    id: 'camera.vertical-pan',
    version: '1.0.0',
    name: 'Vertical Pan',
    category: 'camera',
    description: 'Smooth vertical crane pan from sky to ground or character.',
    targetType: ['camera'],
    duration: 6.0,
    loop: false,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {
      panDistanceY: 110,
    },
    parameterControls: [
      { key: 'panDistanceY', label: 'Pan Y (px)', type: 'number', defaultValue: 110, min: -600, max: 600, step: 10 },
    ],
  },
  {
    id: 'camera.shake',
    version: '1.0.0',
    name: 'Camera Shake',
    category: 'camera',
    description: 'Deterministic multi-harmonic handheld or bass-drop shake.',
    targetType: ['camera'],
    duration: 2.0,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {
      shakeX: 10,
      shakeY: 7,
      shakeRotDeg: 0.8,
      frequency: 6,
    },
    parameterControls: [
      { key: 'shakeX', label: 'Shake X (px)', type: 'number', defaultValue: 10, min: 0, max: 60, step: 1 },
      { key: 'shakeY', label: 'Shake Y (px)', type: 'number', defaultValue: 7, min: 0, max: 60, step: 1 },
      { key: 'shakeRotDeg', label: 'Roll (°)', type: 'number', defaultValue: 0.8, min: 0, max: 8, step: 0.2 },
      { key: 'frequency', label: 'Frequency', type: 'number', defaultValue: 6, min: 1, max: 24, step: 0.5 },
    ],
  },
  {
    id: 'camera.follow-object',
    version: '1.0.0',
    name: 'Follow Object',
    category: 'camera',
    description: 'Centers camera framing on the selected Follow Layer across frames.',
    targetType: ['camera'],
    duration: 8.0,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {
      followStrength: 1,
      offsetX: 0,
      offsetY: 0,
    },
    parameterControls: [
      { key: 'followStrength', label: 'Tracking Mix', type: 'number', defaultValue: 1, min: 0, max: 1, step: 0.05 },
      { key: 'offsetX', label: 'Offset X (px)', type: 'number', defaultValue: 0, min: -400, max: 400, step: 10 },
      { key: 'offsetY', label: 'Offset Y (px)', type: 'number', defaultValue: 0, min: -400, max: 400, step: 10 },
    ],
  },
  {
    id: 'camera.parallax-drift',
    version: '1.0.0',
    name: 'Parallax Drift',
    category: 'camera',
    description: 'Slow floating figure-8 motion highlighting foreground & background depth.',
    targetType: ['camera'],
    duration: 5.0,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {
      driftX: 38,
      driftY: 16,
      zoomPulse: 0.03,
    },
    parameterControls: [
      { key: 'driftX', label: 'Drift X (px)', type: 'number', defaultValue: 38, min: 0, max: 200, step: 2 },
      { key: 'driftY', label: 'Drift Y (px)', type: 'number', defaultValue: 16, min: 0, max: 120, step: 2 },
      { key: 'zoomPulse', label: 'Breathing Zoom', type: 'number', defaultValue: 0.03, min: 0, max: 0.25, step: 0.01 },
    ],
  },

  // =========================================================================
  // ENVIRONMENT PRESETS (8)
  // =========================================================================
  {
    id: 'env.rain',
    version: '1.0.0',
    name: 'Rain',
    category: 'environment',
    description: 'Directional rain streaks with storm haze.',
    targetType: ['environment'],
    duration: 10,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: { weatherDensity: 0.68, weatherSpeed: 1.3, weatherDirectionDeg: 18, weatherSize: 1 },
    parameterControls: [],
    environmentPatch: {
      weatherType: 'rain',
      weatherDensity: 0.68,
      weatherSpeed: 1.3,
      weatherDirectionDeg: 18,
      weatherSize: 1,
      weatherOpacity: 0.8,
      hazeIntensity: 0.34,
    },
  },
  {
    id: 'env.snow',
    version: '1.0.0',
    name: 'Snow',
    category: 'environment',
    description: 'Soft layered drifting snowflakes.',
    targetType: ['environment'],
    duration: 10,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: { weatherDensity: 0.55, weatherSpeed: 0.9, weatherSize: 1.1 },
    parameterControls: [],
    environmentPatch: {
      weatherType: 'snow',
      weatherDensity: 0.55,
      weatherSpeed: 0.9,
      weatherDirectionDeg: 8,
      weatherSize: 1.1,
      weatherOpacity: 0.88,
    },
  },
  {
    id: 'env.floating-dust',
    version: '1.0.0',
    name: 'Floating Dust',
    category: 'environment',
    description: 'Warm sunlit drifting dust motes.',
    targetType: ['environment'],
    duration: 10,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: { weatherDensity: 0.5, weatherSpeed: 0.7 },
    parameterControls: [],
    environmentPatch: {
      weatherType: 'dust',
      weatherDensity: 0.5,
      weatherSpeed: 0.7,
      weatherSize: 1.2,
      weatherOpacity: 0.7,
    },
  },
  {
    id: 'env.fireflies',
    version: '1.0.0',
    name: 'Fireflies',
    category: 'environment',
    description: 'Pulsing golden fireflies floating across twilight scenes.',
    targetType: ['environment'],
    duration: 10,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: { weatherDensity: 0.55, weatherSpeed: 1 },
    parameterControls: [],
    environmentPatch: {
      weatherType: 'fireflies',
      weatherDensity: 0.55,
      weatherSpeed: 1,
      weatherSize: 1.1,
      weatherOpacity: 0.92,
    },
  },
  {
    id: 'env.falling-leaves',
    version: '1.0.0',
    name: 'Falling Leaves',
    category: 'environment',
    description: 'Fluttering tumbling leaves carried across the frame.',
    targetType: ['environment'],
    duration: 10,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: { weatherDensity: 0.45, weatherSpeed: 1, weatherSize: 1.2 },
    parameterControls: [],
    environmentPatch: {
      weatherType: 'leaves',
      weatherDensity: 0.45,
      weatherSpeed: 1,
      weatherDirectionDeg: 28,
      weatherSize: 1.2,
      weatherOpacity: 0.9,
    },
  },
  {
    id: 'env.fog-overlay',
    version: '1.0.0',
    name: 'Fog Overlays',
    category: 'environment',
    description: 'Layered drifting ground and midground mist.',
    targetType: ['environment'],
    duration: 10,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: { fogOpacity: 0.45, fogSpeed: 1 },
    parameterControls: [],
    environmentPatch: {
      fogOpacity: 0.45,
      fogSpeed: 1,
      fogColor: '#CBD5E1',
    },
  },
  {
    id: 'env.moving-clouds',
    version: '1.0.0',
    name: 'Moving Clouds',
    category: 'environment',
    description: 'Soft multi-altitude drifting sky cloud silhouettes.',
    targetType: ['environment'],
    duration: 10,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: { cloudDensity: 0.6, cloudSpeed: 1 },
    parameterControls: [],
    environmentPatch: {
      cloudDensity: 0.6,
      cloudSpeed: 1,
    },
  },
  {
    id: 'env.wind-grass',
    version: '1.0.0',
    name: 'Wind-Blown Grass',
    category: 'environment',
    description: 'Foreground grass blades swaying rhythmically with scene wind.',
    targetType: ['environment'],
    duration: 10,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: { grassDensity: 0.65, grassWindSpeed: 1.2 },
    parameterControls: [],
    environmentPatch: {
      grassDensity: 0.65,
      grassWindSpeed: 1.2,
    },
  },

  // =========================================================================
  // LYRICS & TYPOGRAPHY PRESETS (9)
  // =========================================================================
  {
    id: 'lyrics.karaoke',
    version: '1.0.0',
    name: 'Karaoke Highlight',
    category: 'lyrics',
    description: 'Word-by-word highlight sweep with warm amber accent & soft glow.',
    targetType: ['text'],
    duration: 4,
    loop: false,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {},
    parameterControls: [],
    lyricsStyle: 'karaoke',
  },
  {
    id: 'lyrics.fade',
    version: '1.0.0',
    name: 'Fade In/Out',
    category: 'lyrics',
    description: 'Smooth cinematic fade-in and fade-out on each lyric cue.',
    targetType: ['text'],
    duration: 4,
    loop: false,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {},
    parameterControls: [],
    lyricsStyle: 'fade',
  },
  {
    id: 'lyrics.slide-up',
    version: '1.0.0',
    name: 'Slide Up',
    category: 'lyrics',
    description: 'Lines glide upward into framing with eased opacity reveal.',
    targetType: ['text'],
    duration: 4,
    loop: false,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {},
    parameterControls: [],
    lyricsStyle: 'slideUp',
  },
  {
    id: 'lyrics.scale-reveal',
    version: '1.0.0',
    name: 'Scale Reveal',
    category: 'lyrics',
    description: 'Subtle pop-in scale entrance for chorus and hook lines.',
    targetType: ['text'],
    duration: 4,
    loop: false,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {},
    parameterControls: [],
    lyricsStyle: 'scaleReveal',
  },
  {
    id: 'lyrics.typewriter',
    version: '1.0.0',
    name: 'Typewriter Reveal',
    category: 'lyrics',
    description: 'Sequential cursor-style character reveal.',
    targetType: ['text'],
    duration: 4,
    loop: false,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {},
    parameterControls: [],
    lyricsStyle: 'typewriter',
  },
  {
    id: 'lyrics.word-reveal',
    version: '1.0.0',
    name: 'Word-by-Word Reveal',
    category: 'lyrics',
    description: 'Words appear progressively across the cue timing.',
    targetType: ['text'],
    duration: 4,
    loop: false,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {},
    parameterControls: [],
    lyricsStyle: 'wordReveal',
  },
  {
    id: 'lyrics.char-reveal',
    version: '1.0.0',
    name: 'Character Reveal',
    category: 'lyrics',
    description: 'Characters cascade in with smooth per-glyph fade & lift.',
    targetType: ['text'],
    duration: 4,
    loop: false,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {},
    parameterControls: [],
    lyricsStyle: 'charReveal',
  },
  {
    id: 'lyrics.stagger',
    version: '1.0.0',
    name: 'Staggered Words',
    category: 'lyrics',
    description: 'Each word rises and fades in sequentially with staggered timing.',
    targetType: ['text'],
    duration: 4,
    loop: false,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {},
    parameterControls: [],
    lyricsStyle: 'stagger',
  },
  {
    id: 'lyrics.beat-pulse',
    version: '1.0.0',
    name: 'Beat-Synchronized Text',
    category: 'lyrics',
    description: 'Rhythmic BPM pulse and glow synced to music tempo.',
    targetType: ['text'],
    duration: 4,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {},
    parameterControls: [],
    lyricsStyle: 'beatPulse',
  },

  // =========================================================================
  // EFFECTS PRESETS (3)
  // =========================================================================
  {
    id: 'fx.glow-pulse',
    version: '1.0.0',
    name: 'Beat Shimmer Pulse',
    category: 'effects',
    description: 'Rhythmic opacity and scale pulse synchronized with music tempo.',
    targetType: ['sprite', 'shape', 'text', 'image', 'layer'],
    duration: 1.0,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {
      scaleStrength: 0.06,
      opacityPulse: 0.25,
      speed: 1,
    },
    parameterControls: [
      { key: 'scaleStrength', label: 'Scale Pulse', type: 'number', defaultValue: 0.06, min: 0, max: 0.35, step: 0.01 },
      { key: 'opacityPulse', label: 'Opacity Dip', type: 'number', defaultValue: 0.25, min: 0, max: 0.9, step: 0.05 },
    ],
  },
  {
    id: 'fx.float-hover',
    version: '1.0.0',
    name: 'Ethereal Hover',
    category: 'effects',
    description: 'Smooth vertical levitation for lanterns, orbs, titles, and magical props.',
    targetType: ['sprite', 'shape', 'text', 'image', 'layer'],
    duration: 3.0,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {
      movementStrength: 12,
      rotationStrength: 2,
      speed: 1,
    },
    parameterControls: [
      { key: 'movementStrength', label: 'Float Height (px)', type: 'number', defaultValue: 12, min: 0, max: 60, step: 1 },
      { key: 'rotationStrength', label: 'Tilt (°)', type: 'number', defaultValue: 2, min: 0, max: 20, step: 0.5 },
    ],
  },
  {
    id: 'fx.glitch-jitter',
    version: '1.0.0',
    name: 'Electronic Jitter',
    category: 'effects',
    description: 'Deterministic micro-jitter burst for cyber or energetic music cuts.',
    targetType: ['sprite', 'shape', 'text', 'image', 'layer'],
    duration: 1.2,
    loop: true,
    playbackDirection: 'forward',
    blendMode: 'add',
    defaultPivot: 'center',
    parameters: {
      movementStrength: 6,
      rotationStrength: 1.5,
      speed: 2,
    },
    parameterControls: [
      { key: 'movementStrength', label: 'Jitter (px)', type: 'number', defaultValue: 6, min: 0, max: 40, step: 1 },
      { key: 'rotationStrength', label: 'Snap (°)', type: 'number', defaultValue: 1.5, min: 0, max: 15, step: 0.5 },
    ],
  },
];

export interface PresetQueryFilter {
  category?: PresetCategory;
  targetType?: PresetTargetType;
}

export function getPresetById(presetId: string): MotionPresetDefinition | undefined {
  return PRESET_REGISTRY.find((p) => p.id === presetId);
}

export function getAvailablePresets(
  categoryOrFilter?: PresetCategory | PresetQueryFilter,
  targetType?: PresetTargetType
): MotionPresetDefinition[] {
  let category: PresetCategory | undefined;
  let resolvedTarget: PresetTargetType | undefined = targetType;

  if (typeof categoryOrFilter === 'string') {
    category = categoryOrFilter;
  } else if (categoryOrFilter && typeof categoryOrFilter === 'object') {
    category = categoryOrFilter.category;
    resolvedTarget = categoryOrFilter.targetType ?? targetType;
  }

  return PRESET_REGISTRY.filter((p) => {
    if (category && p.category !== category) return false;
    if (resolvedTarget && !p.targetType.includes(resolvedTarget)) return false;
    return true;
  });
}

export function createModifierFromPreset(
  presetId: string,
  fps: number,
  modifierId: string,
  overrides?: Partial<MotionModifierInstance>
): MotionModifierInstance | null {
  const def = getPresetById(presetId);
  if (!def) return null;

  const durationFrames = Math.max(1, Math.round(def.duration * Math.max(1, fps)));
  return {
    id: modifierId,
    presetId: def.id,
    basePresetId: def.basePresetId,
    label: def.name,
    enabled: true,
    startFrame: overrides?.startFrame ?? 0,
    durationFrames: overrides?.durationFrames ?? durationFrames,
    delayFrames: overrides?.delayFrames ?? 0,
    loop: overrides?.loop ?? def.loop,
    direction: overrides?.direction ?? def.playbackDirection,
    blendMode: overrides?.blendMode ?? def.blendMode,
    intensity: overrides?.intensity ?? def.defaultIntensity ?? 1,
    speed: overrides?.speed ?? Number(def.parameters.speed ?? 1),
    phaseOffset: overrides?.phaseOffset ?? 0,
    pivotAnchor: overrides?.pivotAnchor ?? def.defaultPivot,
    params: {
      ...def.parameters,
      ...(overrides?.params ?? {}),
    },
  };
}
