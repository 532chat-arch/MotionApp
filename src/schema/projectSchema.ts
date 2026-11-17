import { z } from 'zod';

export const CURRENT_SCHEMA_VERSION = 1;

export const RationalFpsSchema = z.object({
  numerator: z.number().int().positive(),
  denominator: z.number().int().positive(),
});

export type RationalFps = z.infer<typeof RationalFpsSchema>;

export function fpsToNumber(fps: RationalFps): number {
  return fps.numerator / fps.denominator;
}

export const BlendModeSchema = z.enum([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'add',
  'darken',
  'lighten',
]);
export type BlendMode = z.infer<typeof BlendModeSchema>;

export const InterpolationSchema = z.enum([
  'linear',
  'hold',
  'easeInOut',
  'easeIn',
  'easeOut',
]);
export type InterpolationType = z.infer<typeof InterpolationSchema>;

export const KeyframeSchema = z.object({
  id: z.string(),
  frame: z.number().int().min(0),
  value: z.number(),
  interpolation: InterpolationSchema.default('easeInOut'),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

export const Transform2DSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  rotation: z.number().default(0), // radians internally; UI displays degrees
  scaleX: z.number().default(1),
  scaleY: z.number().default(1),
  pivotX: z.number().default(0),
  pivotY: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
});
export type Transform2D = z.infer<typeof Transform2DSchema>;

export const FrameRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});
export type FrameRect = z.infer<typeof FrameRectSchema>;

export const MotionModifierDirectionSchema = z.enum(['forward', 'reverse', 'alternate']);
export type MotionModifierDirection = z.infer<typeof MotionModifierDirectionSchema>;

export const MotionModifierBlendSchema = z.enum(['add', 'multiply']);
export type MotionModifierBlend = z.infer<typeof MotionModifierBlendSchema>;

export const PivotAnchorPresetSchema = z.enum([
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'custom',
]);
export type PivotAnchorPreset = z.infer<typeof PivotAnchorPresetSchema>;

export const MotionModifierSchema = z.object({
  id: z.string(),
  presetId: z.string(),
  basePresetId: z.string().min(1).optional(),
  label: z.string().optional(),
  enabled: z.boolean().default(true),
  startFrame: z.number().int().min(0).default(0),
  durationFrames: z.number().int().min(1).default(60),
  delayFrames: z.number().int().min(0).default(0),
  loop: z.boolean().default(true),
  direction: MotionModifierDirectionSchema.default('forward'),
  blendMode: MotionModifierBlendSchema.default('add'),
  intensity: z.number().min(0).max(5).default(1),
  speed: z.number().min(0.1).max(8).default(1),
  phaseOffset: z.number().default(0),
  pivotAnchor: PivotAnchorPresetSchema.default('center'),
  params: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
});
export type MotionModifierInstance = z.infer<typeof MotionModifierSchema>;

export const LyricsWordSchema = z.object({
  text: z.string(),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(1),
});
export type LyricsWord = z.infer<typeof LyricsWordSchema>;

export const LyricsCueSchema = z.object({
  id: z.string(),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(1),
  text: z.string(),
  words: z.array(LyricsWordSchema).default([]),
});
export type LyricsCue = z.infer<typeof LyricsCueSchema>;

export const LyricsStyleSchema = z.enum([
  'none',
  'fade',
  'slideUp',
  'scaleReveal',
  'typewriter',
  'wordReveal',
  'charReveal',
  'karaoke',
  'stagger',
  'beatPulse',
]);
export type LyricsStyle = z.infer<typeof LyricsStyleSchema>;

export const LyricsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  style: LyricsStyleSchema.default('karaoke'),
  highlightColor: z.string().default('#F59E0B'),
  glowColor: z.string().default('#38BDF8'),
  glowBlur: z.number().min(0).max(40).default(12),
  shadowColor: z.string().default('rgba(0,0,0,0.65)'),
  shadowBlur: z.number().min(0).max(30).default(6),
  staggerFrames: z.number().int().min(1).max(24).default(3),
  beatBpm: z.number().min(40).max(240).default(120),
  beatSyncIntensity: z.number().min(0).max(1).default(0.15),
  cues: z.array(LyricsCueSchema).default([]),
});
export type LyricsConfig = z.infer<typeof LyricsConfigSchema>;

export const SceneObjectSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    name: z.string(),
    kind: z.literal('sprite'),
    assetId: z.string(),
    width: z.number().positive().default(240),
    height: z.number().positive().default(240),
    cropRect: FrameRectSchema.optional(),
    transform: Transform2DSchema,
  }),
  z.object({
    id: z.string(),
    name: z.string(),
    kind: z.literal('character'),
    characterId: z.string(),
    activeClipId: z.string(),
    clipOffsetFrames: z.number().int().default(0),
    playbackSpeed: z.number().default(1),
    width: z.number().positive().default(180),
    height: z.number().positive().default(180),
    flipX: z.boolean().default(false),
    transform: Transform2DSchema,
  }),
  z.object({
    id: z.string(),
    name: z.string(),
    kind: z.literal('shape'),
    shapeType: z.enum(['rect', 'ellipse', 'polygon', 'star']),
    width: z.number().positive().default(200),
    height: z.number().positive().default(200),
    fill: z.string().default('#3B82F6'),
    stroke: z.string().default('transparent'),
    strokeWidth: z.number().min(0).default(0),
    cornerRadius: z.number().min(0).default(12),
    transform: Transform2DSchema,
  }),
  z.object({
    id: z.string(),
    name: z.string(),
    kind: z.literal('text'),
    text: z.string().default('Title'),
    fontSize: z.number().positive().default(48),
    fontFamily: z.string().default('Plus Jakarta Sans'),
    color: z.string().default('#F8FAFC'),
    align: z.enum(['left', 'center', 'right']).default('center'),
    lyrics: LyricsConfigSchema.optional(),
    transform: Transform2DSchema,
  }),
  z.object({
    id: z.string(),
    name: z.string(),
    kind: z.literal('nestedComposition'),
    compositionId: z.string(),
    timeOffsetFrames: z.number().int().default(0),
    playbackSpeed: z.number().default(1),
    loop: z.boolean().default(true),
    transform: Transform2DSchema,
  }),
]);
export type SceneObjectDocument = z.infer<typeof SceneObjectSchema>;

export const LayerRoleSchema = z.enum([
  'foreground',
  'character',
  'midground',
  'prop',
  'background',
  'effect',
  'control',
]);
export type LayerRole = z.infer<typeof LayerRoleSchema>;

export const LayerKeyframesSchema = z.object({
  x: z.array(KeyframeSchema).default([]),
  y: z.array(KeyframeSchema).default([]),
  rotation: z.array(KeyframeSchema).default([]),
  scaleX: z.array(KeyframeSchema).default([]),
  scaleY: z.array(KeyframeSchema).default([]),
  opacity: z.array(KeyframeSchema).default([]),
});
export type LayerKeyframes = z.infer<typeof LayerKeyframesSchema>;
export type LayerAnimatableProp = keyof LayerKeyframes;

export const LayerDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: LayerRoleSchema.default('midground'),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  solo: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
  blendMode: BlendModeSchema.default('normal'),
  depth: z.number().min(-2).max(2).default(0), // 0 = focal plane, <0 background/far, >0 foreground/near
  parentId: z.string().optional(),
  inFrame: z.number().int().min(0).default(0),
  outFrame: z.number().int().min(1).default(240),
  objects: z.array(SceneObjectSchema).default([]),
  keyframes: LayerKeyframesSchema.default({
    x: [],
    y: [],
    rotation: [],
    scaleX: [],
    scaleY: [],
    opacity: [],
  }),
  modifiers: z.array(MotionModifierSchema).default([]),
});
export type LayerDocument = z.infer<typeof LayerDocumentSchema>;

export const AudioClipSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  name: z.string(),
  startFrame: z.number().int().min(0).default(0),
  inFrame: z.number().int().min(0).default(0),
  durationFrames: z.number().int().min(1).default(120),
  volume: z.number().min(0).max(2).default(1),
  fadeInFrames: z.number().int().min(0).default(0),
  fadeOutFrames: z.number().int().min(0).default(0),
  loop: z.boolean().default(false),
});
export type AudioClipDocument = z.infer<typeof AudioClipSchema>;

export const AudioTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(['dialogue', 'music', 'ambience', 'sfx']).default('sfx'),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  volume: z.number().min(0).max(2).default(1),
  clips: z.array(AudioClipSchema).default([]),
});
export type AudioTrackDocument = z.infer<typeof AudioTrackSchema>;

export const WeatherTypeSchema = z.enum([
  'none',
  'rain',
  'snow',
  'fireflies',
  'dust',
  'leaves',
]);
export type WeatherType = z.infer<typeof WeatherTypeSchema>;

export const EnvironmentDocumentSchema = z.object({
  presetId: z.string().default('twilight'),
  skyTopColor: z.string().default('#0F172A'),
  skyBottomColor: z.string().default('#1E3A5F'),
  hazeColor: z.string().default('#93C5FD'),
  hazeIntensity: z.number().min(0).max(1).default(0.18),
  weatherType: WeatherTypeSchema.default('fireflies'),
  weatherDensity: z.number().min(0).max(1).default(0.45),
  weatherSpeed: z.number().min(0.1).max(5).default(1),
  weatherDirectionDeg: z.number().min(-180).max(180).default(15),
  weatherSize: z.number().min(0.25).max(4).default(1),
  weatherOpacity: z.number().min(0).max(1).default(0.85),
  weatherLoopFrames: z.number().int().min(24).max(2400).default(240),
  fogOpacity: z.number().min(0).max(1).default(0),
  fogColor: z.string().default('#CBD5E1'),
  fogSpeed: z.number().min(0).max(5).default(1),
  cloudDensity: z.number().min(0).max(1).default(0),
  cloudSpeed: z.number().min(0).max(5).default(1),
  grassDensity: z.number().min(0).max(1).default(0),
  grassWindSpeed: z.number().min(0).max(5).default(1),
  windDirection: z.enum(['left', 'right']).default('right'),
  windStrength: z.number().min(0).max(3).default(1),
  timeOfDayTint: z.string().default('#000000'),
  tintOpacity: z.number().min(0).max(0.8).default(0),
});
export type EnvironmentDocument = z.infer<typeof EnvironmentDocumentSchema>;

export const CameraDocumentSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  zoom: z.number().min(0.1).max(8).default(1),
  rotation: z.number().default(0),
  parallaxStrength: z.number().min(0).max(2).default(1),
  followLayerId: z.string().optional(),
  keyframes: z.object({
    x: z.array(KeyframeSchema).default([]),
    y: z.array(KeyframeSchema).default([]),
    zoom: z.array(KeyframeSchema).default([]),
  }).default({ x: [], y: [], zoom: [] }),
  modifiers: z.array(MotionModifierSchema).default([]),
});
export type CameraDocument = z.infer<typeof CameraDocumentSchema>;

export const TimelineMarkerSchema = z.object({
  id: z.string(),
  frame: z.number().int().min(0),
  label: z.string(),
  color: z.string().default('#F59E0B'),
});
export type TimelineMarker = z.infer<typeof TimelineMarkerSchema>;

export const CompositionRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  settings: z.object({
    width: z.number().int().min(128).max(4096).default(1280),
    height: z.number().int().min(128).max(4096).default(720),
    durationFrames: z.number().int().min(1).default(240),
    inheritProjectFps: z.boolean().default(true),
    fps: RationalFpsSchema.default({ numerator: 24, denominator: 1 }),
    workAreaStart: z.number().int().min(0).default(0),
    workAreaEnd: z.number().int().min(1).default(240),
  }),
  camera: CameraDocumentSchema.default({
    x: 0,
    y: 0,
    zoom: 1,
    rotation: 0,
    parallaxStrength: 1,
    keyframes: { x: [], y: [], zoom: [] },
    modifiers: [],
  }),
  environment: EnvironmentDocumentSchema.default({
    presetId: 'twilight',
    skyTopColor: '#0F172A',
    skyBottomColor: '#1E3A5F',
    hazeColor: '#93C5FD',
    hazeIntensity: 0.18,
    weatherType: 'fireflies',
    weatherDensity: 0.45,
    weatherSpeed: 1,
    weatherDirectionDeg: 15,
    weatherSize: 1,
    weatherOpacity: 0.85,
    weatherLoopFrames: 240,
    fogOpacity: 0,
    fogColor: '#CBD5E1',
    fogSpeed: 1,
    cloudDensity: 0,
    cloudSpeed: 1,
    grassDensity: 0,
    grassWindSpeed: 1,
    windDirection: 'right',
    windStrength: 1,
    timeOfDayTint: '#000000',
    tintOpacity: 0,
  }),
  layers: z.array(LayerDocumentSchema).default([]),
  audioTracks: z.array(AudioTrackSchema).default([]),
  markers: z.array(TimelineMarkerSchema).default([]),
});
export type CompositionRecord = z.infer<typeof CompositionRecordSchema>;

export const AssetCategorySchema = z.enum([
  'characters',
  'environments',
  'props',
  'backgrounds',
  'foregrounds',
  'audio',
  'effects',
]);
export type AssetCategory = z.infer<typeof AssetCategorySchema>;

export const AssetRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: AssetCategorySchema.default('props'),
  type: z.enum(['image', 'spritesheet', 'audio', 'other']),
  mimeType: z.string(),
  dataUrl: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationSeconds: z.number().optional(),
  hash: z.string().optional(),
  tags: z.array(z.string()).default([]),
  folder: z.string().default('Root'),
  createdAt: z.string(),
  updatedAt: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type AssetRecord = z.infer<typeof AssetRecordSchema>;

export const CharacterClipSchema = z.object({
  id: z.string(),
  name: z.string(),
  frameIndices: z.array(z.number().int().min(0)),
  fps: z.number().positive().default(8),
  loop: z.boolean().default(true),
});
export type CharacterClip = z.infer<typeof CharacterClipSchema>;

export const CharacterDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  assetId: z.string(),
  mode: z.enum(['spritesheet', 'sequence']).default('spritesheet'),
  grid: z.object({
    rows: z.number().int().min(1).default(2),
    cols: z.number().int().min(1).default(4),
    cellWidth: z.number().positive().default(128),
    cellHeight: z.number().positive().default(128),
    marginX: z.number().min(0).default(0),
    marginY: z.number().min(0).default(0),
    spacingX: z.number().min(0).default(0),
    spacingY: z.number().min(0).default(0),
  }),
  frames: z.array(FrameRectSchema).default([]),
  sequenceAssetIds: z.array(z.string()).default([]),
  clips: z.array(CharacterClipSchema).default([]),
});
export type CharacterDefinition = z.infer<typeof CharacterDefinitionSchema>;

export const ProjectTimelineClipSchema = z.object({
  id: z.string(),
  compositionId: z.string(),
  startFrame: z.number().int().min(0),
  durationFrames: z.number().int().min(1),
  inOffsetFrames: z.number().int().min(0).default(0),
  transitionIn: z.enum(['cut', 'crossDissolve', 'fadeBlack']).default('cut'),
  transitionDurationFrames: z.number().int().min(0).default(12),
});
export type ProjectTimelineClip = z.infer<typeof ProjectTimelineClipSchema>;

export const MotionProjectSchema = z.object({
  schemaVersion: z.number().int().positive(),
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: z.object({
    fps: RationalFpsSchema.default({ numerator: 24, denominator: 1 }),
    defaultWidth: z.number().int().min(128).max(4096).default(1280),
    defaultHeight: z.number().int().min(128).max(4096).default(720),
  }),
  assets: z.array(AssetRecordSchema).default([]),
  characters: z.array(CharacterDefinitionSchema).default([]),
  compositions: z.array(CompositionRecordSchema).min(1),
  projectTimeline: z.object({
    clips: z.array(ProjectTimelineClipSchema).default([]),
    markers: z.array(TimelineMarkerSchema).default([]),
  }),
  exportSettings: z.object({
    format: z.enum(['webm', 'png-sequence', 'motionx']).default('webm'),
    quality: z.number().min(0.1).max(1).default(0.92),
    includeAudio: z.boolean().default(true),
  }).default({
    format: 'webm',
    quality: 0.92,
    includeAudio: true,
  }),
});
export type MotionProject = z.infer<typeof MotionProjectSchema>;

export function validateProject(raw: unknown): { success: true; data: MotionProject } | { success: false; error: string } {
  const migrated = migrateProject(raw);
  const parsed = MotionProjectSchema.safeParse(migrated);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  return { success: true, data: parsed.data };
}

export function migrateProject(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.schemaVersion !== 'number') {
    return { ...obj, schemaVersion: CURRENT_SCHEMA_VERSION };
  }
  return obj;
}
