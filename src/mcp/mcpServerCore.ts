import { ProjectCommands, uid } from '../commands/projectCommands.ts';
import type { ProjectCommand } from '../commands/commandManager.ts';
import { evaluateCompositionAtFrame } from '../engine/evaluator.ts';
import { parseLrc, parsePlainLyrics, parseSrt } from '../engine/lyricsParser.ts';
import {
  animationPresetRegistry,
  createModifierFromPreset,
  getAvailablePresets,
  getPresetById,
  PresetCategorySchema,
  PresetTargetTypeSchema,
} from '../services/AnimationPresetRegistry.ts';
import type { PresetCategory, PresetTargetType } from '../services/AnimationPresetRegistry.ts';
import type {
  CompositionRecord,
  EnvironmentDocument,
  InterpolationType,
  LayerAnimatableProp,
  LayerDocument,
  LayerRole,
  LyricsConfig,
  LyricsCue,
  LyricsStyle,
  MotionModifierDirection,
  MotionModifierInstance,
  MotionProject,
  PivotAnchorPreset,
  WeatherType,
} from '../schema/projectSchema.ts';
import {
  fpsToNumber,
  InterpolationSchema,
  LyricsStyleSchema,
  MotionModifierDirectionSchema,
  PivotAnchorPresetSchema,
  validateProject,
} from '../schema/projectSchema.ts';
import { createBlankComposition, createStarterProject } from '../utils/starterProject.ts';
import { MCP_PROTOCOL_VERSION, SUPPORTED_MCP_VERSIONS } from './mcpTypes.ts';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpActivityEntry,
  McpCallToolResult,
  McpPromptDefinition,
  McpPromptMessage,
  McpResourceContent,
  McpResourceDefinition,
  McpServerInfo,
  McpToolDefinition,
} from './mcpTypes.ts';

export interface McpProjectUpdateEvent {
  type: 'project:updated';
  project: MotionProject;
  activeCompositionId: string;
  revision: number;
  source: 'mcp' | 'studio';
  label: string;
}

export interface McpLogEvent {
  type: 'mcp:log';
  entry: McpActivityEntry;
}

export type McpServerEvent = McpProjectUpdateEvent | McpLogEvent;

const MOTION_STUDIO_SERVER_INFO: McpServerInfo = {
  name: 'motion-studio-mcp',
  version: '1.0.0',
};

const ENVIRONMENT_PRESETS: Record<string, Partial<EnvironmentDocument>> = {
  twilight: {
    presetId: 'twilight',
    skyTopColor: '#0B1120',
    skyBottomColor: '#1E3A5F',
    hazeColor: '#60A5FA',
    hazeIntensity: 0.24,
    weatherType: 'fireflies',
    weatherDensity: 0.45,
    tintOpacity: 0,
  },
  dawn: {
    presetId: 'dawn',
    skyTopColor: '#31102F',
    skyBottomColor: '#EA580C',
    hazeColor: '#FDBA74',
    hazeIntensity: 0.32,
    weatherType: 'dust',
    weatherDensity: 0.35,
    timeOfDayTint: '#F59E0B',
    tintOpacity: 0.08,
  },
  aurora: {
    presetId: 'aurora',
    skyTopColor: '#061523',
    skyBottomColor: '#134E4A',
    hazeColor: '#2DD4BF',
    hazeIntensity: 0.28,
    weatherType: 'snow',
    weatherDensity: 0.4,
    timeOfDayTint: '#042F2E',
    tintOpacity: 0.08,
  },
  storm: {
    presetId: 'storm',
    skyTopColor: '#090D16',
    skyBottomColor: '#1E293B',
    hazeColor: '#64748B',
    hazeIntensity: 0.36,
    weatherType: 'rain',
    weatherDensity: 0.65,
    timeOfDayTint: '#0F172A',
    tintOpacity: 0.14,
  },
  daylight: {
    presetId: 'daylight',
    skyTopColor: '#1D4ED8',
    skyBottomColor: '#93C5FD',
    hazeColor: '#E0F2FE',
    hazeIntensity: 0.18,
    weatherType: 'none',
    weatherDensity: 0,
    tintOpacity: 0,
  },
};

export const MOTION_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'get_project_summary',
    title: 'Get Project Summary',
    description:
      'Returns active Motion Studio project metadata, compositions, layer counts, assets, and revision.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    sampleArgs: {},
  },
  {
    name: 'list_compositions',
    title: 'List Compositions',
    description:
      'Lists all compositions in the active project with canvas dimensions, frame rate, duration, and layers.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    sampleArgs: {},
  },
  {
    name: 'create_composition',
    title: 'Create Composition',
    description:
      'Creates a new composition in the active project with optional resolution, duration, and environment preset.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Composition name' },
        width: { type: 'number', description: 'Canvas width in pixels (default 1280)' },
        height: { type: 'number', description: 'Canvas height in pixels (default 720)' },
        durationFrames: { type: 'number', description: 'Duration in frames (default 240)' },
        environmentPreset: {
          type: 'string',
          enum: ['twilight', 'dawn', 'aurora', 'storm', 'daylight'],
          description: 'Optional atmosphere preset',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    sampleArgs: {
      name: 'MCP Hero Scene',
      width: 1280,
      height: 720,
      durationFrames: 180,
      environmentPreset: 'aurora',
    },
  },
  {
    name: 'add_layer',
    title: 'Add Shape or Text Layer',
    description:
      'Adds a shape (rect, ellipse, polygon, star) or text layer to a composition and returns the new layer ID.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: {
          type: 'string',
          description: 'Target composition ID (defaults to active composition)',
        },
        name: { type: 'string', description: 'Layer name' },
        kind: { type: 'string', enum: ['shape', 'text'], description: 'Layer object kind' },
        role: {
          type: 'string',
          enum: ['foreground', 'character', 'midground', 'prop', 'background', 'effect', 'control'],
        },
        depth: { type: 'number', description: 'Parallax depth from -2 to 2 (default 0)' },
        x: { type: 'number', description: 'Initial X coordinate (default comp center)' },
        y: { type: 'number', description: 'Initial Y coordinate (default comp center)' },
        shapeType: { type: 'string', enum: ['rect', 'ellipse', 'polygon', 'star'] },
        width: { type: 'number' },
        height: { type: 'number' },
        fill: { type: 'string' },
        stroke: { type: 'string' },
        strokeWidth: { type: 'number' },
        cornerRadius: { type: 'number' },
        text: { type: 'string' },
        fontSize: { type: 'number' },
        color: { type: 'string' },
      },
      required: ['name', 'kind'],
      additionalProperties: false,
    },
    sampleArgs: {
      name: 'Orbit Badge',
      kind: 'shape',
      shapeType: 'star',
      x: 320,
      y: 360,
      width: 140,
      height: 140,
      fill: '#38BDF8',
      stroke: '#E0F2FE',
      strokeWidth: 3,
      depth: 0.15,
    },
  },
  {
    name: 'update_layer_transform',
    title: 'Update Layer Transform',
    description:
      'Updates transform properties (x, y, rotationDeg, scaleX, scaleY, opacity) on a layer at a frame.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        layerId: { type: 'string' },
        frame: { type: 'number', description: 'Frame index for auto-keyframing (default 0)' },
        x: { type: 'number' },
        y: { type: 'number' },
        rotationDeg: { type: 'number' },
        scaleX: { type: 'number' },
        scaleY: { type: 'number' },
        opacity: { type: 'number' },
      },
      required: ['layerId'],
      additionalProperties: false,
    },
    sampleArgs: {
      layerId: 'layer_title',
      frame: 0,
      y: 165,
      opacity: 1,
    },
  },
  {
    name: 'set_layer_keyframe',
    title: 'Set Layer Keyframe',
    description:
      'Sets an animation keyframe on a layer property (x, y, rotation, scaleX, scaleY, opacity) with an easing curve.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        layerId: { type: 'string' },
        property: {
          type: 'string',
          enum: ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'],
        },
        frame: { type: 'number' },
        value: {
          type: 'number',
          description: 'Value in pixels, scale factor, 0..1 opacity, or degrees for rotation',
        },
        valueIsDegrees: {
          type: 'boolean',
          description: 'When property is rotation, convert degrees to radians (default true)',
        },
        interpolation: {
          type: 'string',
          enum: ['linear', 'hold', 'easeIn', 'easeOut', 'easeInOut'],
        },
      },
      required: ['layerId', 'property', 'frame', 'value'],
      additionalProperties: false,
    },
    sampleArgs: {
      layerId: 'layer_traveler',
      property: 'y',
      frame: 96,
      value: 440,
      interpolation: 'easeInOut',
    },
  },
  {
    name: 'animate_motion_arc',
    title: 'Animate Motion Arc',
    description:
      'Creates spatial X/Y keyframes across multiple waypoints on a layer with independent easing curves to form curved motion paths.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        layerId: { type: 'string' },
        waypoints: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              frame: { type: 'number' },
              x: { type: 'number' },
              y: { type: 'number' },
              xEasing: { type: 'string', enum: ['linear', 'hold', 'easeIn', 'easeOut', 'easeInOut'] },
              yEasing: { type: 'string', enum: ['linear', 'hold', 'easeIn', 'easeOut', 'easeInOut'] },
            },
            required: ['frame', 'x', 'y'],
          },
        },
        clearExisting: { type: 'boolean', description: 'Clear existing X/Y keyframes first (default true)' },
      },
      required: ['layerId', 'waypoints'],
      additionalProperties: false,
    },
    sampleArgs: {
      layerId: 'layer_traveler',
      clearExisting: true,
      waypoints: [
        { frame: 0, x: 240, y: 520, xEasing: 'easeIn', yEasing: 'easeOut' },
        { frame: 72, x: 640, y: 340, xEasing: 'easeOut', yEasing: 'easeIn' },
        { frame: 144, x: 1020, y: 500, xEasing: 'linear', yEasing: 'linear' },
      ],
    },
  },
  {
    name: 'delete_layer',
    title: 'Delete Layer',
    description: 'Removes a layer from a composition.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        layerId: { type: 'string' },
      },
      required: ['layerId'],
      additionalProperties: false,
    },
    sampleArgs: {
      layerId: 'layer_id_here',
    },
  },
  {
    name: 'update_camera',
    title: 'Update Camera',
    description: 'Updates composition camera coordinates, zoom, rotationDeg, or parallaxStrength.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        zoom: { type: 'number' },
        rotationDeg: { type: 'number' },
        parallaxStrength: { type: 'number' },
      },
      additionalProperties: false,
    },
    sampleArgs: {
      x: 40,
      y: -15,
      zoom: 1.08,
      parallaxStrength: 1.2,
    },
  },
  {
    name: 'update_environment',
    title: 'Update Environment',
    description:
      'Applies an atmosphere preset or custom sky gradient, haze, and weather particles (rain, snow, fireflies, dust).',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        presetId: {
          type: 'string',
          enum: ['twilight', 'dawn', 'aurora', 'storm', 'daylight'],
        },
        skyTopColor: { type: 'string' },
        skyBottomColor: { type: 'string' },
        hazeColor: { type: 'string' },
        hazeIntensity: { type: 'number' },
        weatherType: { type: 'string', enum: ['none', 'rain', 'snow', 'fireflies', 'dust', 'leaves'] },
        weatherDensity: { type: 'number' },
      },
      additionalProperties: false,
    },
    sampleArgs: {
      presetId: 'aurora',
      weatherType: 'fireflies',
      weatherDensity: 0.65,
    },
  },
  {
    name: 'evaluate_frame',
    title: 'Evaluate Composition Frame',
    description:
      'Evaluates world transforms, effective opacity, parallax offsets, and visibility for all layers at a frame.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        frame: { type: 'number' },
      },
      required: ['frame'],
      additionalProperties: false,
    },
    sampleArgs: {
      frame: 48,
    },
  },
  {
    name: 'import_project_json',
    title: 'Import MotionProject JSON',
    description:
      'Validates a complete MotionProject JSON payload with Zod and replaces the active project in Motion Studio.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'object',
          description: 'Valid MotionProject JSON document',
        },
      },
      required: ['project'],
      additionalProperties: false,
    },
    sampleArgs: {
      project: {},
    },
  },
  {
    name: 'get_available_presets',
    title: 'Get Available Motion Presets',
    description:
      'Lists reusable animation presets filtered by category and/or targetType (character, hair, clothing, environment, camera, lyrics, effects).',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['character', 'hair', 'clothing', 'environment', 'camera', 'lyrics', 'effects'],
        },
        targetType: {
          type: 'string',
          enum: [
            'image',
            'sprite',
            'character-part',
            'character',
            'shape',
            'text',
            'layer',
            'camera',
            'environment',
          ],
        },
      },
      additionalProperties: false,
    },
    sampleArgs: { category: 'hair', targetType: 'character-part' },
  },
  {
    name: 'apply_motion_preset',
    title: 'Apply Motion Preset Modifier',
    description:
      'Attaches a non-destructive motion preset modifier to a layer or composition camera.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        targetType: { type: 'string', enum: ['layer', 'camera'] },
        layerId: { type: 'string' },
        presetId: { type: 'string' },
        intensity: { type: 'number' },
        speed: { type: 'number' },
        durationFrames: { type: 'number' },
        delayFrames: { type: 'number' },
        loop: { type: 'boolean' },
        direction: { type: 'string', enum: ['forward', 'reverse', 'alternate'] },
        pivotAnchor: { type: 'string', enum: ['center', 'top', 'bottom', 'left', 'right', 'custom'] },
        params: { type: 'object' },
      },
      required: ['presetId'],
      additionalProperties: false,
    },
    sampleArgs: {
      targetType: 'layer',
      layerId: 'layer_traveler',
      presetId: 'fx.float-hover',
      intensity: 1,
      speed: 1,
    },
  },
  {
    name: 'create_character_idle_animation',
    title: 'Create Character Idle Animation',
    description:
      'Stacks one or more character idle presets (breathing, eye-blinking, head-tilt, body-sway, shoulder-movement) onto a layer without overwriting properties.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        layerId: { type: 'string' },
        presets: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Preset IDs or short names: breathing, eye-blinking, head-tilt, body-sway, shoulder-movement',
        },
        intensity: { type: 'number' },
        speed: { type: 'number' },
      },
      required: ['layerId'],
      additionalProperties: false,
    },
    sampleArgs: {
      layerId: 'layer_traveler',
      presets: ['breathing', 'eye-blinking', 'head-tilt'],
      intensity: 1,
    },
  },
  {
    name: 'create_hair_animation',
    title: 'Create Hair Animation',
    description:
      'Applies a hair motion preset (gentle-wind, strong-wind, floating, bounce, side-sway) with pivot anchor and wind direction.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        layerId: { type: 'string' },
        style: {
          type: 'string',
          enum: ['gentle-wind', 'strong-wind', 'floating', 'bounce', 'side-sway'],
        },
        windDirection: { type: 'string', enum: ['left', 'right'] },
        pivotAnchor: { type: 'string', enum: ['top', 'center', 'bottom', 'left', 'right'] },
        intensity: { type: 'number' },
        speed: { type: 'number' },
        meshDeform: { type: 'number' },
      },
      required: ['layerId'],
      additionalProperties: false,
    },
    sampleArgs: {
      layerId: 'layer_traveler',
      style: 'gentle-wind',
      windDirection: 'right',
      intensity: 1,
    },
  },
  {
    name: 'create_cloth_animation',
    title: 'Create Cloth Animation',
    description:
      'Applies a clothing motion preset (gentle-sway, scarf-flutter, dress-movement, sleeve-movement, wind-driven) with optional lightweight strip deformation.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        layerId: { type: 'string' },
        style: {
          type: 'string',
          enum: ['gentle-sway', 'scarf-flutter', 'dress-movement', 'sleeve-movement', 'wind-driven'],
        },
        windDirection: { type: 'string', enum: ['left', 'right'] },
        pivotAnchor: { type: 'string', enum: ['top', 'left', 'right', 'bottom', 'center'] },
        intensity: { type: 'number' },
        speed: { type: 'number' },
        meshDeform: { type: 'number' },
      },
      required: ['layerId'],
      additionalProperties: false,
    },
    sampleArgs: {
      layerId: 'layer_traveler',
      style: 'scarf-flutter',
      windDirection: 'right',
      intensity: 1,
    },
  },
  {
    name: 'create_environment_effect',
    title: 'Create Environment Effect',
    description:
      'Configures lightweight procedural weather particles (rain, snow, dust, fireflies, leaves), fog overlays, moving clouds, and wind-blown grass.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        weatherType: { type: 'string', enum: ['none', 'rain', 'snow', 'fireflies', 'dust', 'leaves'] },
        weatherDensity: { type: 'number' },
        weatherSpeed: { type: 'number' },
        weatherDirectionDeg: { type: 'number' },
        weatherSize: { type: 'number' },
        weatherOpacity: { type: 'number' },
        weatherLoopFrames: { type: 'number' },
        fogOpacity: { type: 'number' },
        fogColor: { type: 'string' },
        fogSpeed: { type: 'number' },
        cloudDensity: { type: 'number' },
        cloudSpeed: { type: 'number' },
        grassDensity: { type: 'number' },
        grassWindSpeed: { type: 'number' },
        windDirection: { type: 'string', enum: ['left', 'right'] },
        windStrength: { type: 'number' },
      },
      additionalProperties: false,
    },
    sampleArgs: {
      weatherType: 'leaves',
      weatherDensity: 0.55,
      fogOpacity: 0.35,
      cloudDensity: 0.5,
      grassDensity: 0.6,
    },
  },
  {
    name: 'create_lyrics_animation',
    title: 'Create Lyrics Animation',
    description:
      'Parses LRC, SRT, or plain lyrics and configures timed word/character reveal, karaoke highlight, glow, and beat pulse on a text layer (creates one if omitted).',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        layerId: { type: 'string' },
        name: { type: 'string' },
        lrcText: { type: 'string' },
        srtText: { type: 'string' },
        plainText: { type: 'string' },
        style: {
          type: 'string',
          enum: [
            'karaoke',
            'fade',
            'slideUp',
            'scaleReveal',
            'typewriter',
            'wordReveal',
            'charReveal',
            'stagger',
            'beatPulse',
            'none',
          ],
        },
        highlightColor: { type: 'string' },
        glowColor: { type: 'string' },
        glowBlur: { type: 'number' },
        beatBpm: { type: 'number' },
        beatSyncIntensity: { type: 'number' },
        x: { type: 'number' },
        y: { type: 'number' },
        fontSize: { type: 'number' },
      },
      additionalProperties: false,
    },
    sampleArgs: {
      name: 'Main Lyrics',
      style: 'karaoke',
      lrcText: '[00:00.50]Moonlight drifting across the sky\n[00:03.20]Hold the rhythm into the night',
      highlightColor: '#F59E0B',
      beatBpm: 120,
    },
  },
  {
    name: 'create_camera_animation',
    title: 'Create Camera Animation',
    description:
      'Applies a cinematic camera preset (slow-zoom-in, slow-zoom-out, horizontal-pan, vertical-pan, shake, follow-object, parallax-drift) to the composition camera.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        preset: {
          type: 'string',
          enum: [
            'slow-zoom-in',
            'slow-zoom-out',
            'horizontal-pan',
            'vertical-pan',
            'shake',
            'follow-object',
            'parallax-drift',
          ],
        },
        followLayerId: { type: 'string' },
        intensity: { type: 'number' },
        speed: { type: 'number' },
        durationFrames: { type: 'number' },
        loop: { type: 'boolean' },
        params: { type: 'object' },
      },
      required: ['preset'],
      additionalProperties: false,
    },
    sampleArgs: {
      preset: 'slow-zoom-in',
      intensity: 1,
      durationFrames: 180,
    },
  },
  {
    name: 'update_animation_parameters',
    title: 'Update Animation Modifier Parameters',
    description:
      'Updates parameters (intensity, speed, durationFrames, delayFrames, loop, direction, pivotAnchor, params) on an existing layer or camera modifier.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        targetType: { type: 'string', enum: ['layer', 'camera'] },
        layerId: { type: 'string' },
        modifierId: { type: 'string' },
        enabled: { type: 'boolean' },
        intensity: { type: 'number' },
        speed: { type: 'number' },
        durationFrames: { type: 'number' },
        delayFrames: { type: 'number' },
        loop: { type: 'boolean' },
        direction: { type: 'string', enum: ['forward', 'reverse', 'alternate'] },
        pivotAnchor: { type: 'string', enum: ['center', 'top', 'bottom', 'left', 'right', 'custom'] },
        params: { type: 'object' },
      },
      required: ['modifierId'],
      additionalProperties: false,
    },
    sampleArgs: {
      targetType: 'layer',
      layerId: 'layer_id',
      modifierId: 'mod_id',
      intensity: 1.5,
      speed: 1.2,
    },
  },
  {
    name: 'preview_composition',
    title: 'Preview Composition Evaluation',
    description:
      'Samples deterministic composition state across a frame range (camera, layer transforms, active modifiers, and active lyrics cues) via the shared animation evaluator.',
    inputSchema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string' },
        startFrame: { type: 'number' },
        endFrame: { type: 'number' },
        stepFrames: { type: 'number' },
      },
      additionalProperties: false,
    },
    sampleArgs: {
      startFrame: 0,
      endFrame: 96,
      stepFrames: 24,
    },
  },
];

export const MOTION_MCP_PROMPTS: McpPromptDefinition[] = [
  {
    name: 'create_animated_scene',
    description: 'Blueprint prompt for creating a multi-layer parallax scene with animated shapes and atmosphere.',
    arguments: [
      { name: 'theme', description: 'Visual theme or story beat', required: true },
      { name: 'durationFrames', description: 'Scene duration in frames (default 180)', required: false },
    ],
  },
  {
    name: 'keyframe_motion_choreography',
    description: 'Choreograph curved spatial arcs and easing functions for an existing layer.',
    arguments: [
      { name: 'layerId', description: 'Target layer ID', required: true },
      { name: 'motionStyle', description: 'e.g. float, dash, orbit, bounce', required: false },
    ],
  },
];

export class MotionMcpServerCore {
  private project: MotionProject;
  private activeCompositionId: string;
  private revision = 1;
  private sessions = new Set<string>();
  private listeners = new Set<(event: McpServerEvent) => void>();
  private logs: McpActivityEntry[] = [];

  constructor(initialProject?: MotionProject) {
    this.project = initialProject ?? createStarterProject();
    this.activeCompositionId = this.project.compositions[0].id;
  }

  public getProject(): MotionProject {
    return this.project;
  }

  public getActiveCompositionId(): string {
    return this.activeCompositionId;
  }

  public getRevision(): number {
    return this.revision;
  }

  public getLogs(): McpActivityEntry[] {
    return [...this.logs];
  }

  public clearLogs(): void {
    this.logs = [];
  }

  public subscribe(listener: (event: McpServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: McpServerEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore disconnected subscriber errors
      }
    }
  }

  private pushLog(
    method: string,
    detail: string,
    status: 'ok' | 'error',
    durationMs: number
  ) {
    const entry: McpActivityEntry = {
      id: uid('mcplog'),
      timestamp: new Date().toISOString(),
      direction: 'server',
      serverName: MOTION_STUDIO_SERVER_INFO.name,
      method,
      detail,
      status,
      durationMs,
    };
    this.logs = [entry, ...this.logs].slice(0, 60);
    this.emit({ type: 'mcp:log', entry });
  }

  /**
   * Syncs project state pushed from the browser studio into the server core.
   */
  public syncFromStudio(
    rawProject: unknown,
    activeCompositionId?: string
  ): { ok: true; revision: number } | { ok: false; error: string } {
    const validation = validateProject(rawProject);
    if (!validation.success) {
      return { ok: false, error: validation.error };
    }
    this.project = validation.data;
    const compExists =
      activeCompositionId &&
      this.project.compositions.some((c) => c.id === activeCompositionId);
    this.activeCompositionId = compExists
      ? activeCompositionId!
      : this.project.compositions[0].id;
    this.revision += 1;
    return { ok: true, revision: this.revision };
  }

  public createSession(): string {
    const id = uid('mcpsess');
    this.sessions.add(id);
    return id;
  }

  public hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  public closeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  public listResources(): McpResourceDefinition[] {
    const dynamicComps: McpResourceDefinition[] = this.project.compositions.map((c) => ({
      uri: `motion://composition/${c.id}`,
      name: `Composition: ${c.name}`,
      description: `${c.settings.width}x${c.settings.height}, ${c.settings.durationFrames} frames, ${c.layers.length} layers`,
      mimeType: 'application/json',
    }));
    return [
      {
        uri: 'motion://project/current',
        name: 'Current MotionProject JSON',
        description: `Full validated project state for "${this.project.name}"`,
        mimeType: 'application/json',
      },
      {
        uri: 'motion://project/schema',
        name: 'Motion Studio Composition & Keyframe Schema',
        description: 'Supported layer kinds, shape types, easing curves, and environment presets',
        mimeType: 'application/json',
      },
      {
        uri: 'motion://presets',
        name: 'Motion Studio Animation Preset Registry',
        description: 'All reusable JSON preset definitions across character, hair, clothing, camera, environment, lyrics, and effects',
        mimeType: 'application/json',
      },
      {
        uri: 'motion://presets/schema',
        name: 'Motion Studio Animation Preset JSON Schema',
        description: 'Formal JSON Schema defining animation preset structure, categories, target types, and parameter controls',
        mimeType: 'application/json',
      },
      ...dynamicComps,
    ];
  }

  public readResource(uri: string): McpResourceContent | null {
    if (uri === 'motion://project/current') {
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(this.project, null, 2),
      };
    }
    if (uri === 'motion://project/schema') {
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            schemaVersion: this.project.schemaVersion,
            layerKinds: ['shape', 'text', 'sprite', 'character', 'nestedComposition'],
            shapeTypes: ['rect', 'ellipse', 'polygon', 'star'],
            animatableProperties: ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'],
            interpolationCurves: ['linear', 'hold', 'easeIn', 'easeOut', 'easeInOut'],
            weatherTypes: ['none', 'rain', 'snow', 'fireflies', 'dust', 'leaves'],
            environmentPresets: Object.keys(ENVIRONMENT_PRESETS),
          },
          null,
          2
        ),
      };
    }
    if (uri === 'motion://presets') {
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(animationPresetRegistry.toJSON(), null, 2),
      };
    }
    if (uri === 'motion://presets/schema') {
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(animationPresetRegistry.getJsonSchema(), null, 2),
      };
    }
    if (uri.startsWith('motion://composition/')) {
      const compId = uri.replace('motion://composition/', '');
      const comp = this.project.compositions.find((c) => c.id === compId);
      if (!comp) return null;
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(comp, null, 2),
      };
    }
    return null;
  }

  public getPrompt(
    name: string,
    args: Record<string, string> = {}
  ): { description: string; messages: McpPromptMessage[] } | null {
    if (name === 'create_animated_scene') {
      const theme = args.theme || 'cinematic twilight landscape';
      const duration = args.durationFrames || '180';
      return {
        description: `Create an animated scene for "${theme}"`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Design a Motion Studio composition themed "${theme}" (${duration} frames). ` +
                `1) Call create_composition with an appropriate environmentPreset. ` +
                `2) Add background/midground/foreground shape & text layers with add_layer using varied parallax depth (-1 to +0.5). ` +
                `3) Use animate_motion_arc and set_layer_keyframe with easeIn/easeOut/easeInOut curves to choreograph motion.`,
            },
          },
        ],
      };
    }
    if (name === 'keyframe_motion_choreography') {
      const layerId = args.layerId || '<layerId>';
      const style = args.motionStyle || 'smooth floating arc';
      return {
        description: `Choreograph "${style}" motion on layer ${layerId}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Call get_project_summary to inspect layer "${layerId}", then call animate_motion_arc with paired X/Y easing ` +
                `(e.g. xEasing: "easeIn", yEasing: "easeOut") to craft a "${style}" motion path, plus set_layer_keyframe on rotation/opacity.`,
            },
          },
        ],
      };
    }
    return null;
  }

  private applyCommand(cmd: ProjectCommand, newActiveCompId?: string): { ok: true } | { ok: false; error: string } {
    if (cmd.validate) {
      const err = cmd.validate(this.project);
      if (err) return { ok: false, error: err };
    }
    const nextProject = cmd.execute(this.project);
    const validation = validateProject(nextProject);
    if (!validation.success) {
      return { ok: false, error: validation.error };
    }
    this.project = validation.data;
    if (newActiveCompId && this.project.compositions.some((c) => c.id === newActiveCompId)) {
      this.activeCompositionId = newActiveCompId;
    } else if (!this.project.compositions.some((c) => c.id === this.activeCompositionId)) {
      this.activeCompositionId = this.project.compositions[0].id;
    }
    this.revision += 1;
    this.emit({
      type: 'project:updated',
      project: this.project,
      activeCompositionId: this.activeCompositionId,
      revision: this.revision,
      source: 'mcp',
      label: cmd.label,
    });
    return { ok: true };
  }

  private resolveComp(compId?: unknown): CompositionRecord | null {
    const id = typeof compId === 'string' && compId.trim() ? compId : this.activeCompositionId;
    return this.project.compositions.find((c) => c.id === id) ?? null;
  }

  private toolOk(data: Record<string, unknown>, textSummary?: string): McpCallToolResult {
    return {
      content: [
        {
          type: 'text',
          text: textSummary ? `${textSummary}\n\n${JSON.stringify(data, null, 2)}` : JSON.stringify(data, null, 2),
        },
      ],
      structuredContent: data,
    };
  }

  private toolErr(message: string): McpCallToolResult {
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }

  public callTool(name: string, rawArgs: Record<string, unknown> = {}): McpCallToolResult {
    switch (name) {
      case 'get_project_summary': {
        const summary = {
          projectId: this.project.id,
          name: this.project.name,
          revision: this.revision,
          activeCompositionId: this.activeCompositionId,
          fps: fpsToNumber(this.project.settings.fps),
          assetCount: this.project.assets.length,
          characterCount: this.project.characters.length,
          compositions: this.project.compositions.map((c) => ({
            id: c.id,
            name: c.name,
            width: c.settings.width,
            height: c.settings.height,
            durationFrames: c.settings.durationFrames,
            environmentPreset: c.environment.presetId,
            layers: c.layers.map((l) => ({
              id: l.id,
              name: l.name,
              role: l.role,
              kind: l.objects[0]?.kind ?? 'empty',
              visible: l.visible,
              keyframeCounts: {
                x: l.keyframes.x.length,
                y: l.keyframes.y.length,
                rotation: l.keyframes.rotation.length,
                scaleX: l.keyframes.scaleX.length,
                scaleY: l.keyframes.scaleY.length,
                opacity: l.keyframes.opacity.length,
              },
            })),
          })),
        };
        return this.toolOk(summary, `Project "${this.project.name}" (rev ${this.revision})`);
      }

      case 'list_compositions': {
        const list = this.project.compositions.map((c) => ({
          id: c.id,
          name: c.name,
          isActive: c.id === this.activeCompositionId,
          settings: c.settings,
          camera: {
            x: c.camera.x,
            y: c.camera.y,
            zoom: c.camera.zoom,
            parallaxStrength: c.camera.parallaxStrength,
          },
          environment: c.environment,
          layerCount: c.layers.length,
          layers: c.layers.map((l) => ({ id: l.id, name: l.name, role: l.role, depth: l.depth })),
        }));
        return this.toolOk({ compositions: list });
      }

      case 'create_composition': {
        const compName = typeof rawArgs.name === 'string' && rawArgs.name.trim() ? rawArgs.name.trim() : 'MCP Composition';
        const blank = createBlankComposition(compName);
        const width = typeof rawArgs.width === 'number' ? Math.max(128, Math.min(4096, Math.round(rawArgs.width))) : blank.settings.width;
        const height = typeof rawArgs.height === 'number' ? Math.max(128, Math.min(4096, Math.round(rawArgs.height))) : blank.settings.height;
        const durationFrames = typeof rawArgs.durationFrames === 'number' ? Math.max(1, Math.round(rawArgs.durationFrames)) : blank.settings.durationFrames;
        const presetKey = typeof rawArgs.environmentPreset === 'string' ? rawArgs.environmentPreset : undefined;
        const presetPatch = presetKey && ENVIRONMENT_PRESETS[presetKey] ? ENVIRONMENT_PRESETS[presetKey] : {};

        const nextComp: CompositionRecord = {
          ...blank,
          settings: {
            ...blank.settings,
            width,
            height,
            durationFrames,
            workAreaEnd: durationFrames,
          },
          environment: {
            ...blank.environment,
            ...presetPatch,
          },
        };
        const res = this.applyCommand(ProjectCommands.createComposition(nextComp), nextComp.id);
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk(
          { compositionId: nextComp.id, name: nextComp.name, width, height, durationFrames },
          `Created composition "${nextComp.name}" (${nextComp.id})`
        );
      }

      case 'add_layer': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');

        const kind = rawArgs.kind === 'text' ? 'text' : 'shape';
        const layerName = typeof rawArgs.name === 'string' && rawArgs.name.trim() ? rawArgs.name.trim() : kind === 'text' ? 'MCP Text' : 'MCP Shape';
        const role: LayerRole =
          typeof rawArgs.role === 'string' &&
          ['foreground', 'character', 'midground', 'prop', 'background', 'effect', 'control'].includes(rawArgs.role)
            ? (rawArgs.role as LayerRole)
            : 'prop';
        const depth = typeof rawArgs.depth === 'number' ? Math.max(-2, Math.min(2, rawArgs.depth)) : 0;
        const x = typeof rawArgs.x === 'number' ? rawArgs.x : comp.settings.width / 2;
        const y = typeof rawArgs.y === 'number' ? rawArgs.y : comp.settings.height / 2;

        const baseTransform = {
          x,
          y,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          pivotX: 0,
          pivotY: 0,
          opacity: 1,
        };

        const obj =
          kind === 'text'
            ? {
                id: uid('obj'),
                name: layerName,
                kind: 'text' as const,
                text: typeof rawArgs.text === 'string' ? rawArgs.text : layerName,
                fontSize: typeof rawArgs.fontSize === 'number' ? Math.max(8, rawArgs.fontSize) : 48,
                fontFamily: 'Plus Jakarta Sans',
                color: typeof rawArgs.color === 'string' ? rawArgs.color : '#F8FAFC',
                align: 'center' as const,
                transform: baseTransform,
              }
            : {
                id: uid('obj'),
                name: layerName,
                kind: 'shape' as const,
                shapeType: (['rect', 'ellipse', 'polygon', 'star'].includes(String(rawArgs.shapeType))
                  ? rawArgs.shapeType
                  : 'rect') as 'rect' | 'ellipse' | 'polygon' | 'star',
                width: typeof rawArgs.width === 'number' ? Math.max(4, rawArgs.width) : 160,
                height: typeof rawArgs.height === 'number' ? Math.max(4, rawArgs.height) : 160,
                fill: typeof rawArgs.fill === 'string' ? rawArgs.fill : '#3B82F6',
                stroke: typeof rawArgs.stroke === 'string' ? rawArgs.stroke : '#93C5FD',
                strokeWidth: typeof rawArgs.strokeWidth === 'number' ? Math.max(0, rawArgs.strokeWidth) : 2,
                cornerRadius: typeof rawArgs.cornerRadius === 'number' ? Math.max(0, rawArgs.cornerRadius) : 16,
                transform: baseTransform,
              };

        const newLayer: LayerDocument = {
          id: uid('layer'),
          name: layerName,
          role,
          visible: true,
          locked: false,
          solo: false,
          opacity: 1,
          blendMode: 'normal',
          depth,
          inFrame: 0,
          outFrame: comp.settings.durationFrames,
          objects: [obj],
          keyframes: { x: [], y: [], rotation: [], scaleX: [], scaleY: [], opacity: [] },
          modifiers: [],
        };

        const res = this.applyCommand(ProjectCommands.addLayer(comp.id, newLayer, 0));
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk(
          { compositionId: comp.id, layerId: newLayer.id, name: newLayer.name, kind, x, y },
          `Added ${kind} layer "${newLayer.name}" (${newLayer.id})`
        );
      }

      case 'update_layer_transform': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const layerId = typeof rawArgs.layerId === 'string' ? rawArgs.layerId : '';
        const layer = comp.layers.find((l) => l.id === layerId);
        if (!layer) return this.toolErr(`Layer "${layerId}" not found in composition "${comp.id}"`);

        const frame = typeof rawArgs.frame === 'number' ? Math.max(0, Math.round(rawArgs.frame)) : 0;
        const updates: Array<[LayerAnimatableProp, number]> = [];
        if (typeof rawArgs.x === 'number') updates.push(['x', rawArgs.x]);
        if (typeof rawArgs.y === 'number') updates.push(['y', rawArgs.y]);
        if (typeof rawArgs.rotationDeg === 'number') updates.push(['rotation', (rawArgs.rotationDeg * Math.PI) / 180]);
        if (typeof rawArgs.scaleX === 'number') updates.push(['scaleX', rawArgs.scaleX]);
        if (typeof rawArgs.scaleY === 'number') updates.push(['scaleY', rawArgs.scaleY]);
        if (typeof rawArgs.opacity === 'number') updates.push(['opacity', Math.max(0, Math.min(1, rawArgs.opacity))]);

        if (updates.length === 0) {
          return this.toolErr('Provide at least one transform property (x, y, rotationDeg, scaleX, scaleY, opacity)');
        }

        const cmd: ProjectCommand = {
          id: uid('cmd'),
          label: `MCP Transform ${layer.name}`,
          affectedIds: [comp.id, layerId],
          execute: (p) => {
            let cur = p;
            for (const [prop, val] of updates) {
              cur = ProjectCommands.setLayerTransformProperty(comp.id, layerId, prop, val, frame).execute(cur);
            }
            return cur;
          },
        };
        const res = this.applyCommand(cmd);
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk(
          { compositionId: comp.id, layerId, updatedProps: updates.map(([p]) => p) },
          `Updated transform on "${layer.name}"`
        );
      }

      case 'set_layer_keyframe': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const layerId = typeof rawArgs.layerId === 'string' ? rawArgs.layerId : '';
        const layer = comp.layers.find((l) => l.id === layerId);
        if (!layer) return this.toolErr(`Layer "${layerId}" not found`);

        const prop = rawArgs.property as LayerAnimatableProp;
        if (!['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'].includes(prop)) {
          return this.toolErr(`Invalid property "${String(rawArgs.property)}"`);
        }
        const frame = typeof rawArgs.frame === 'number' ? Math.max(0, Math.round(rawArgs.frame)) : 0;
        if (typeof rawArgs.value !== 'number') return this.toolErr('Missing numeric "value"');

        const valueIsDegrees = rawArgs.valueIsDegrees !== false;
        const val = prop === 'rotation' && valueIsDegrees ? (rawArgs.value * Math.PI) / 180 : rawArgs.value;
        const interpParsed = InterpolationSchema.safeParse(rawArgs.interpolation ?? 'easeInOut');
        const interpolation: InterpolationType = interpParsed.success ? interpParsed.data : 'easeInOut';

        const res = this.applyCommand(
          ProjectCommands.setLayerKeyframe(comp.id, layerId, prop, frame, val, interpolation)
        );
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk(
          { compositionId: comp.id, layerId, property: prop, frame, value: val, interpolation },
          `Set ${prop} keyframe at F${frame} (${interpolation})`
        );
      }

      case 'animate_motion_arc': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const layerId = typeof rawArgs.layerId === 'string' ? rawArgs.layerId : '';
        const layer = comp.layers.find((l) => l.id === layerId);
        if (!layer) return this.toolErr(`Layer "${layerId}" not found`);
        if (!Array.isArray(rawArgs.waypoints) || rawArgs.waypoints.length < 2) {
          return this.toolErr('Provide at least 2 waypoints [{ frame, x, y, xEasing?, yEasing? }]');
        }

        const clearExisting = rawArgs.clearExisting !== false;
        const waypoints = rawArgs.waypoints
          .filter(
            (w): w is { frame: number; x: number; y: number; xEasing?: string; yEasing?: string } =>
              Boolean(w && typeof w === 'object' && typeof w.frame === 'number' && typeof w.x === 'number' && typeof w.y === 'number')
          )
          .sort((a, b) => a.frame - b.frame);

        if (waypoints.length < 2) {
          return this.toolErr('Waypoints must contain valid numeric frame, x, and y fields');
        }

        const cmd: ProjectCommand = {
          id: uid('cmd'),
          label: `MCP Motion Arc on ${layer.name}`,
          affectedIds: [comp.id, layerId],
          execute: (p) => {
            let cur = p;
            if (clearExisting) {
              cur = ProjectCommands.clearLayerPropertyKeyframes(comp.id, layerId, 'x').execute(cur);
              cur = ProjectCommands.clearLayerPropertyKeyframes(comp.id, layerId, 'y').execute(cur);
            }
            for (const wp of waypoints) {
              const xEase = InterpolationSchema.safeParse(wp.xEasing ?? 'easeInOut');
              const yEase = InterpolationSchema.safeParse(wp.yEasing ?? 'easeInOut');
              cur = ProjectCommands.setLayerKeyframe(
                comp.id,
                layerId,
                'x',
                wp.frame,
                wp.x,
                xEase.success ? xEase.data : 'easeInOut'
              ).execute(cur);
              cur = ProjectCommands.setLayerKeyframe(
                comp.id,
                layerId,
                'y',
                wp.frame,
                wp.y,
                yEase.success ? yEase.data : 'easeInOut'
              ).execute(cur);
            }
            return cur;
          },
        };
        const res = this.applyCommand(cmd);
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk(
          { compositionId: comp.id, layerId, waypointCount: waypoints.length },
          `Animated ${waypoints.length}-point motion arc on "${layer.name}"`
        );
      }

      case 'delete_layer': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const layerId = typeof rawArgs.layerId === 'string' ? rawArgs.layerId : '';
        if (!comp.layers.some((l) => l.id === layerId)) {
          return this.toolErr(`Layer "${layerId}" not found`);
        }
        const res = this.applyCommand(ProjectCommands.deleteLayer(comp.id, layerId));
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk({ compositionId: comp.id, deletedLayerId: layerId });
      }

      case 'update_camera': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const patch: Partial<CompositionRecord['camera']> = {};
        if (typeof rawArgs.x === 'number') patch.x = rawArgs.x;
        if (typeof rawArgs.y === 'number') patch.y = rawArgs.y;
        if (typeof rawArgs.zoom === 'number') patch.zoom = Math.max(0.1, Math.min(8, rawArgs.zoom));
        if (typeof rawArgs.rotationDeg === 'number') patch.rotation = (rawArgs.rotationDeg * Math.PI) / 180;
        if (typeof rawArgs.parallaxStrength === 'number') {
          patch.parallaxStrength = Math.max(0, Math.min(2, rawArgs.parallaxStrength));
        }
        const res = this.applyCommand(ProjectCommands.updateCamera(comp.id, patch));
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk({ compositionId: comp.id, camera: { ...comp.camera, ...patch } });
      }

      case 'update_environment': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        let patch: Partial<EnvironmentDocument> = {};
        if (typeof rawArgs.presetId === 'string' && ENVIRONMENT_PRESETS[rawArgs.presetId]) {
          patch = { ...ENVIRONMENT_PRESETS[rawArgs.presetId] };
        }
        if (typeof rawArgs.skyTopColor === 'string') patch.skyTopColor = rawArgs.skyTopColor;
        if (typeof rawArgs.skyBottomColor === 'string') patch.skyBottomColor = rawArgs.skyBottomColor;
        if (typeof rawArgs.hazeColor === 'string') patch.hazeColor = rawArgs.hazeColor;
        if (typeof rawArgs.hazeIntensity === 'number') {
          patch.hazeIntensity = Math.max(0, Math.min(1, rawArgs.hazeIntensity));
        }
        if (
          typeof rawArgs.weatherType === 'string' &&
          ['none', 'rain', 'snow', 'fireflies', 'dust', 'leaves'].includes(rawArgs.weatherType)
        ) {
          patch.weatherType = rawArgs.weatherType as WeatherType;
        }
        if (typeof rawArgs.weatherDensity === 'number') {
          patch.weatherDensity = Math.max(0, Math.min(1, rawArgs.weatherDensity));
        }
        const res = this.applyCommand(ProjectCommands.updateEnvironment(comp.id, patch));
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk({ compositionId: comp.id, environment: { ...comp.environment, ...patch } });
      }

      case 'evaluate_frame': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const frame = typeof rawArgs.frame === 'number' ? Math.max(0, Math.round(rawArgs.frame)) : 0;
        const evalState = evaluateCompositionAtFrame(this.project, comp.id, frame);
        if (!evalState) return this.toolErr('Unable to evaluate frame');
        const result = {
          compositionId: comp.id,
          frame,
          camera: evalState.camera,
          layers: evalState.layers.map((el) => ({
            id: el.layer.id,
            name: el.layer.name,
            visibleAtFrame: el.visibleAtFrame,
            effectiveOpacity: Number(el.effectiveOpacity.toFixed(3)),
            parallaxOffsetX: Number(el.parallaxOffsetX.toFixed(2)),
            parallaxOffsetY: Number(el.parallaxOffsetY.toFixed(2)),
            worldTransform: el.worldTransform,
            meshDeform: el.objects[0]?.meshDeform,
            evaluatedLyrics: el.objects[0]?.evaluatedLyrics
              ? {
                  style: el.objects[0].evaluatedLyrics.style,
                  cueId: el.objects[0].evaluatedLyrics.cueId,
                  text: el.objects[0].evaluatedLyrics.text,
                  visibleCharCount: el.objects[0].evaluatedLyrics.visibleCharCount,
                  visibleWordCount: el.objects[0].evaluatedLyrics.visibleWordCount,
                }
              : undefined,
          })),
        };
        return this.toolOk(result);
      }

      case 'import_project_json': {
        const validation = validateProject(rawArgs.project);
        if (!validation.success) {
          return this.toolErr(`Invalid MotionProject JSON: ${validation.error}`);
        }
        this.project = validation.data;
        this.activeCompositionId = this.project.compositions[0].id;
        this.revision += 1;
        this.emit({
          type: 'project:updated',
          project: this.project,
          activeCompositionId: this.activeCompositionId,
          revision: this.revision,
          source: 'mcp',
          label: `Import "${this.project.name}"`,
        });
        return this.toolOk(
          { projectId: this.project.id, name: this.project.name, revision: this.revision },
          `Imported MotionProject "${this.project.name}"`
        );
      }

      case 'get_available_presets': {
        const catParsed = PresetCategorySchema.safeParse(rawArgs.category);
        const targetParsed = PresetTargetTypeSchema.safeParse(rawArgs.targetType);
        const cat: PresetCategory | undefined = catParsed.success ? catParsed.data : undefined;
        const target: PresetTargetType | undefined = targetParsed.success
          ? targetParsed.data
          : undefined;
        const presets = getAvailablePresets({ category: cat, targetType: target }).map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          description: p.description,
          targetType: p.targetType,
          duration: p.duration,
          loop: p.loop,
          defaultPivot: p.defaultPivot,
          parameters: p.parameters,
          version: p.version,
        }));
        return this.toolOk({ count: presets.length, presets });
      }

      case 'apply_motion_preset': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const presetId = typeof rawArgs.presetId === 'string' ? rawArgs.presetId : '';
        const presetDef = getPresetById(presetId);
        if (!presetDef) return this.toolErr(`Unknown preset ID "${presetId}"`);

        const compFps = comp.settings.inheritProjectFps
          ? fpsToNumber(this.project.settings.fps)
          : fpsToNumber(comp.settings.fps);

        const targetType =
          rawArgs.targetType === 'camera' || presetDef.category === 'camera'
            ? 'camera'
            : 'layer';

        const dirParsed = MotionModifierDirectionSchema.safeParse(rawArgs.direction);
        const pivotParsed = PivotAnchorPresetSchema.safeParse(rawArgs.pivotAnchor);

        const modifier = createModifierFromPreset(presetId, compFps, uid('mod'), {
          intensity: typeof rawArgs.intensity === 'number' ? rawArgs.intensity : undefined,
          speed: typeof rawArgs.speed === 'number' ? rawArgs.speed : undefined,
          durationFrames:
            typeof rawArgs.durationFrames === 'number'
              ? Math.max(1, Math.round(rawArgs.durationFrames))
              : undefined,
          delayFrames:
            typeof rawArgs.delayFrames === 'number'
              ? Math.max(0, Math.round(rawArgs.delayFrames))
              : undefined,
          loop: typeof rawArgs.loop === 'boolean' ? rawArgs.loop : undefined,
          direction: dirParsed.success ? (dirParsed.data as MotionModifierDirection) : undefined,
          pivotAnchor: pivotParsed.success ? (pivotParsed.data as PivotAnchorPreset) : undefined,
          params:
            rawArgs.params && typeof rawArgs.params === 'object'
              ? (rawArgs.params as Record<string, string | number | boolean>)
              : undefined,
        });
        if (!modifier) return this.toolErr(`Could not create modifier for "${presetId}"`);

        if (targetType === 'camera') {
          const res = this.applyCommand(ProjectCommands.addCameraModifier(comp.id, modifier));
          if (!res.ok) return this.toolErr(res.error);
          return this.toolOk(
            { compositionId: comp.id, targetType: 'camera', modifierId: modifier.id, presetId },
            `Applied camera preset "${presetDef.name}"`
          );
        }

        const layerId = typeof rawArgs.layerId === 'string' ? rawArgs.layerId : '';
        const layer = comp.layers.find((l) => l.id === layerId);
        if (!layer) return this.toolErr(`Layer "${layerId}" not found`);

        const res = this.applyCommand(ProjectCommands.addLayerModifier(comp.id, layerId, modifier));
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk(
          { compositionId: comp.id, targetType: 'layer', layerId, modifierId: modifier.id, presetId },
          `Applied "${presetDef.name}" to layer "${layer.name}"`
        );
      }

      case 'create_character_idle_animation': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const layerId = typeof rawArgs.layerId === 'string' ? rawArgs.layerId : '';
        const layer = comp.layers.find((l) => l.id === layerId);
        if (!layer) return this.toolErr(`Layer "${layerId}" not found`);

        const compFps = comp.settings.inheritProjectFps
          ? fpsToNumber(this.project.settings.fps)
          : fpsToNumber(comp.settings.fps);

        const requested = Array.isArray(rawArgs.presets) && rawArgs.presets.length > 0
          ? rawArgs.presets.map((p) => String(p))
          : ['character.breathing', 'character.eye-blinking'];

        const createdIds: string[] = [];
        const modifiers: MotionModifierInstance[] = [];
        for (const item of requested) {
          const pid = item.startsWith('character.') ? item : `character.${item}`;
          const mod = createModifierFromPreset(pid, compFps, uid('mod'), {
            intensity: typeof rawArgs.intensity === 'number' ? rawArgs.intensity : undefined,
            speed: typeof rawArgs.speed === 'number' ? rawArgs.speed : undefined,
          });
          if (mod) {
            modifiers.push(mod);
            createdIds.push(mod.id);
          }
        }
        if (modifiers.length === 0) {
          return this.toolErr('No valid character idle presets matched');
        }

        const cmd: ProjectCommand = {
          id: uid('cmd'),
          label: `Character Idle Animation on ${layer.name}`,
          affectedIds: [comp.id, layerId, ...createdIds],
          execute: (p) => {
            let cur = p;
            for (const m of modifiers) {
              cur = ProjectCommands.addLayerModifier(comp.id, layerId, m).execute(cur);
            }
            return cur;
          },
        };
        const res = this.applyCommand(cmd);
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk(
          {
            compositionId: comp.id,
            layerId,
            modifierIds: createdIds,
            presets: modifiers.map((m) => m.presetId),
          },
          `Added ${modifiers.length} idle animation modifier(s) to "${layer.name}"`
        );
      }

      case 'create_hair_animation': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const layerId = typeof rawArgs.layerId === 'string' ? rawArgs.layerId : '';
        const layer = comp.layers.find((l) => l.id === layerId);
        if (!layer) return this.toolErr(`Layer "${layerId}" not found`);

        const style = typeof rawArgs.style === 'string' ? rawArgs.style : 'gentle-wind';
        const presetId = style.startsWith('hair.') ? style : `hair.${style}`;
        const compFps = comp.settings.inheritProjectFps
          ? fpsToNumber(this.project.settings.fps)
          : fpsToNumber(comp.settings.fps);

        const pivotParsed = PivotAnchorPresetSchema.safeParse(rawArgs.pivotAnchor);
        const mod = createModifierFromPreset(presetId, compFps, uid('mod'), {
          intensity: typeof rawArgs.intensity === 'number' ? rawArgs.intensity : undefined,
          speed: typeof rawArgs.speed === 'number' ? rawArgs.speed : undefined,
          pivotAnchor: pivotParsed.success ? pivotParsed.data : 'top',
          params: {
            ...(rawArgs.windDirection === 'left' || rawArgs.windDirection === 'right'
              ? { windDirection: rawArgs.windDirection }
              : {}),
            ...(typeof rawArgs.meshDeform === 'number' ? { meshDeform: rawArgs.meshDeform } : {}),
          },
        });
        if (!mod) return this.toolErr(`Unknown hair style "${style}"`);
        const res = this.applyCommand(ProjectCommands.addLayerModifier(comp.id, layerId, mod));
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk(
          { compositionId: comp.id, layerId, modifierId: mod.id, presetId },
          `Applied hair animation "${mod.label}" to "${layer.name}"`
        );
      }

      case 'create_cloth_animation': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const layerId = typeof rawArgs.layerId === 'string' ? rawArgs.layerId : '';
        const layer = comp.layers.find((l) => l.id === layerId);
        if (!layer) return this.toolErr(`Layer "${layerId}" not found`);

        const style = typeof rawArgs.style === 'string' ? rawArgs.style : 'gentle-sway';
        const presetId = style.startsWith('cloth.') ? style : `cloth.${style}`;
        const compFps = comp.settings.inheritProjectFps
          ? fpsToNumber(this.project.settings.fps)
          : fpsToNumber(comp.settings.fps);

        const pivotParsed = PivotAnchorPresetSchema.safeParse(rawArgs.pivotAnchor);
        const mod = createModifierFromPreset(presetId, compFps, uid('mod'), {
          intensity: typeof rawArgs.intensity === 'number' ? rawArgs.intensity : undefined,
          speed: typeof rawArgs.speed === 'number' ? rawArgs.speed : undefined,
          pivotAnchor: pivotParsed.success ? pivotParsed.data : undefined,
          params: {
            ...(rawArgs.windDirection === 'left' || rawArgs.windDirection === 'right'
              ? { windDirection: rawArgs.windDirection }
              : {}),
            ...(typeof rawArgs.meshDeform === 'number' ? { meshDeform: rawArgs.meshDeform } : {}),
          },
        });
        if (!mod) return this.toolErr(`Unknown cloth style "${style}"`);
        const res = this.applyCommand(ProjectCommands.addLayerModifier(comp.id, layerId, mod));
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk(
          { compositionId: comp.id, layerId, modifierId: mod.id, presetId },
          `Applied cloth animation "${mod.label}" to "${layer.name}"`
        );
      }

      case 'create_environment_effect': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const patch: Partial<EnvironmentDocument> = {};
        if (
          typeof rawArgs.weatherType === 'string' &&
          ['none', 'rain', 'snow', 'fireflies', 'dust', 'leaves'].includes(rawArgs.weatherType)
        ) {
          patch.weatherType = rawArgs.weatherType as WeatherType;
        }
        if (typeof rawArgs.weatherDensity === 'number') {
          patch.weatherDensity = Math.max(0, Math.min(1, rawArgs.weatherDensity));
        }
        if (typeof rawArgs.weatherSpeed === 'number') {
          patch.weatherSpeed = Math.max(0.1, Math.min(5, rawArgs.weatherSpeed));
        }
        if (typeof rawArgs.weatherDirectionDeg === 'number') {
          patch.weatherDirectionDeg = Math.max(-180, Math.min(180, rawArgs.weatherDirectionDeg));
        }
        if (typeof rawArgs.weatherSize === 'number') {
          patch.weatherSize = Math.max(0.25, Math.min(4, rawArgs.weatherSize));
        }
        if (typeof rawArgs.weatherOpacity === 'number') {
          patch.weatherOpacity = Math.max(0, Math.min(1, rawArgs.weatherOpacity));
        }
        if (typeof rawArgs.weatherLoopFrames === 'number') {
          patch.weatherLoopFrames = Math.max(24, Math.min(2400, Math.round(rawArgs.weatherLoopFrames)));
        }
        if (typeof rawArgs.fogOpacity === 'number') {
          patch.fogOpacity = Math.max(0, Math.min(1, rawArgs.fogOpacity));
        }
        if (typeof rawArgs.fogColor === 'string') patch.fogColor = rawArgs.fogColor;
        if (typeof rawArgs.fogSpeed === 'number') patch.fogSpeed = Math.max(0, Math.min(5, rawArgs.fogSpeed));
        if (typeof rawArgs.cloudDensity === 'number') {
          patch.cloudDensity = Math.max(0, Math.min(1, rawArgs.cloudDensity));
        }
        if (typeof rawArgs.cloudSpeed === 'number') {
          patch.cloudSpeed = Math.max(0, Math.min(5, rawArgs.cloudSpeed));
        }
        if (typeof rawArgs.grassDensity === 'number') {
          patch.grassDensity = Math.max(0, Math.min(1, rawArgs.grassDensity));
        }
        if (typeof rawArgs.grassWindSpeed === 'number') {
          patch.grassWindSpeed = Math.max(0, Math.min(5, rawArgs.grassWindSpeed));
        }
        if (rawArgs.windDirection === 'left' || rawArgs.windDirection === 'right') {
          patch.windDirection = rawArgs.windDirection;
        }
        if (typeof rawArgs.windStrength === 'number') {
          patch.windStrength = Math.max(0, Math.min(3, rawArgs.windStrength));
        }
        const res = this.applyCommand(ProjectCommands.updateEnvironment(comp.id, patch));
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk(
          { compositionId: comp.id, environment: { ...comp.environment, ...patch } },
          `Updated environment effects in "${comp.name}"`
        );
      }

      case 'create_lyrics_animation': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const compFps = comp.settings.inheritProjectFps
          ? fpsToNumber(this.project.settings.fps)
          : fpsToNumber(comp.settings.fps);

        let cues: LyricsCue[] = [];
        if (typeof rawArgs.lrcText === 'string' && rawArgs.lrcText.trim()) {
          cues = parseLrc(rawArgs.lrcText, compFps);
        } else if (typeof rawArgs.srtText === 'string' && rawArgs.srtText.trim()) {
          cues = parseSrt(rawArgs.srtText, compFps);
        } else if (typeof rawArgs.plainText === 'string' && rawArgs.plainText.trim()) {
          cues = parsePlainLyrics(rawArgs.plainText, compFps, 0, 2.5);
        }

        const styleParsed = LyricsStyleSchema.safeParse(rawArgs.style ?? 'karaoke');
        const style: LyricsStyle = styleParsed.success ? styleParsed.data : 'karaoke';

        const lyricsConfig: LyricsConfig = {
          enabled: true,
          style,
          highlightColor:
            typeof rawArgs.highlightColor === 'string' ? rawArgs.highlightColor : '#F59E0B',
          glowColor: typeof rawArgs.glowColor === 'string' ? rawArgs.glowColor : '#38BDF8',
          glowBlur: typeof rawArgs.glowBlur === 'number' ? rawArgs.glowBlur : 12,
          shadowColor: 'rgba(0,0,0,0.65)',
          shadowBlur: 6,
          staggerFrames: 3,
          beatBpm: typeof rawArgs.beatBpm === 'number' ? rawArgs.beatBpm : 120,
          beatSyncIntensity:
            typeof rawArgs.beatSyncIntensity === 'number' ? rawArgs.beatSyncIntensity : 0.15,
          cues,
        };

        const existingLayerId = typeof rawArgs.layerId === 'string' ? rawArgs.layerId : '';
        const existingLayer = existingLayerId
          ? comp.layers.find((l) => l.id === existingLayerId && l.objects[0]?.kind === 'text')
          : undefined;

        if (existingLayer) {
          const objId = existingLayer.objects[0].id;
          const res = this.applyCommand(
            ProjectCommands.setTextLyrics(comp.id, existingLayer.id, objId, lyricsConfig)
          );
          if (!res.ok) return this.toolErr(res.error);
          return this.toolOk(
            {
              compositionId: comp.id,
              layerId: existingLayer.id,
              style,
              cueCount: cues.length,
            },
            `Configured "${style}" lyrics animation (${cues.length} cues) on "${existingLayer.name}"`
          );
        }

        const layerName =
          typeof rawArgs.name === 'string' && rawArgs.name.trim()
            ? rawArgs.name.trim()
            : 'Lyrics Track';
        const newLayerId = uid('layer');
        const newLayer: LayerDocument = {
          id: newLayerId,
          name: layerName,
          role: 'foreground',
          visible: true,
          locked: false,
          solo: false,
          opacity: 1,
          blendMode: 'normal',
          depth: 0.4,
          inFrame: 0,
          outFrame: comp.settings.durationFrames,
          objects: [
            {
              id: uid('obj'),
              name: layerName,
              kind: 'text',
              text: cues[0]?.text ?? 'Lyrics Line',
              fontSize: typeof rawArgs.fontSize === 'number' ? rawArgs.fontSize : 46,
              fontFamily: 'Plus Jakarta Sans',
              color: '#F8FAFC',
              align: 'center',
              lyrics: lyricsConfig,
              transform: {
                x: typeof rawArgs.x === 'number' ? rawArgs.x : comp.settings.width / 2,
                y: typeof rawArgs.y === 'number' ? rawArgs.y : comp.settings.height * 0.82,
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
                pivotX: 0,
                pivotY: 0,
                opacity: 1,
              },
            },
          ],
          keyframes: { x: [], y: [], rotation: [], scaleX: [], scaleY: [], opacity: [] },
          modifiers: [],
        };
        const res = this.applyCommand(ProjectCommands.addLayer(comp.id, newLayer, 0));
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk(
          { compositionId: comp.id, layerId: newLayerId, style, cueCount: cues.length },
          `Created lyrics layer "${layerName}" (${cues.length} cues, ${style})`
        );
      }

      case 'create_camera_animation': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const presetRaw = typeof rawArgs.preset === 'string' ? rawArgs.preset : '';
        const presetId = presetRaw.startsWith('camera.') ? presetRaw : `camera.${presetRaw}`;
        const compFps = comp.settings.inheritProjectFps
          ? fpsToNumber(this.project.settings.fps)
          : fpsToNumber(comp.settings.fps);

        const mod = createModifierFromPreset(presetId, compFps, uid('mod'), {
          intensity: typeof rawArgs.intensity === 'number' ? rawArgs.intensity : undefined,
          speed: typeof rawArgs.speed === 'number' ? rawArgs.speed : undefined,
          durationFrames:
            typeof rawArgs.durationFrames === 'number'
              ? Math.max(1, Math.round(rawArgs.durationFrames))
              : undefined,
          loop: typeof rawArgs.loop === 'boolean' ? rawArgs.loop : undefined,
          params:
            rawArgs.params && typeof rawArgs.params === 'object'
              ? (rawArgs.params as Record<string, string | number | boolean>)
              : undefined,
        });
        if (!mod) return this.toolErr(`Unknown camera preset "${presetRaw}"`);

        const followLayerId =
          typeof rawArgs.followLayerId === 'string' ? rawArgs.followLayerId : undefined;
        const cmd: ProjectCommand = {
          id: uid('cmd'),
          label: `Camera Animation: ${mod.label}`,
          affectedIds: [comp.id, mod.id],
          execute: (p) => {
            let cur = ProjectCommands.addCameraModifier(comp.id, mod).execute(p);
            if (followLayerId) {
              cur = ProjectCommands.updateCamera(comp.id, { followLayerId }).execute(cur);
            }
            return cur;
          },
        };
        const res = this.applyCommand(cmd);
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk(
          { compositionId: comp.id, modifierId: mod.id, presetId, followLayerId },
          `Applied camera animation "${mod.label}"`
        );
      }

      case 'update_animation_parameters': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const modifierId = typeof rawArgs.modifierId === 'string' ? rawArgs.modifierId : '';
        if (!modifierId) return this.toolErr('Missing required modifierId');

        const patch: Partial<MotionModifierInstance> = {};
        if (typeof rawArgs.enabled === 'boolean') patch.enabled = rawArgs.enabled;
        if (typeof rawArgs.intensity === 'number') patch.intensity = rawArgs.intensity;
        if (typeof rawArgs.speed === 'number') patch.speed = rawArgs.speed;
        if (typeof rawArgs.durationFrames === 'number') {
          patch.durationFrames = Math.max(1, Math.round(rawArgs.durationFrames));
        }
        if (typeof rawArgs.delayFrames === 'number') {
          patch.delayFrames = Math.max(0, Math.round(rawArgs.delayFrames));
        }
        if (typeof rawArgs.loop === 'boolean') patch.loop = rawArgs.loop;
        const dirParsed = MotionModifierDirectionSchema.safeParse(rawArgs.direction);
        if (dirParsed.success) patch.direction = dirParsed.data;
        const pivotParsed = PivotAnchorPresetSchema.safeParse(rawArgs.pivotAnchor);
        if (pivotParsed.success) patch.pivotAnchor = pivotParsed.data;
        if (rawArgs.params && typeof rawArgs.params === 'object') {
          patch.params = rawArgs.params as Record<string, string | number | boolean>;
        }

        const isCamera =
          rawArgs.targetType === 'camera' ||
          (!rawArgs.layerId && comp.camera.modifiers?.some((m) => m.id === modifierId));

        if (isCamera) {
          if (!comp.camera.modifiers?.some((m) => m.id === modifierId)) {
            return this.toolErr(`Camera modifier "${modifierId}" not found`);
          }
          const res = this.applyCommand(
            ProjectCommands.updateCameraModifier(comp.id, modifierId, patch)
          );
          if (!res.ok) return this.toolErr(res.error);
          return this.toolOk(
            { compositionId: comp.id, targetType: 'camera', modifierId },
            `Updated camera modifier "${modifierId}"`
          );
        }

        const layerId = typeof rawArgs.layerId === 'string' ? rawArgs.layerId : '';
        const layer = comp.layers.find((l) => l.id === layerId);
        if (!layer || !layer.modifiers?.some((m) => m.id === modifierId)) {
          return this.toolErr(`Layer modifier "${modifierId}" not found`);
        }
        const res = this.applyCommand(
          ProjectCommands.updateLayerModifier(comp.id, layerId, modifierId, patch)
        );
        if (!res.ok) return this.toolErr(res.error);
        return this.toolOk(
          { compositionId: comp.id, targetType: 'layer', layerId, modifierId },
          `Updated animation modifier "${modifierId}" on "${layer.name}"`
        );
      }

      case 'preview_composition': {
        const comp = this.resolveComp(rawArgs.compositionId);
        if (!comp) return this.toolErr('Composition not found');
        const startF =
          typeof rawArgs.startFrame === 'number' ? Math.max(0, Math.round(rawArgs.startFrame)) : 0;
        const endF =
          typeof rawArgs.endFrame === 'number'
            ? Math.min(comp.settings.durationFrames - 1, Math.max(startF, Math.round(rawArgs.endFrame)))
            : Math.min(comp.settings.durationFrames - 1, startF + 48);
        const stepF =
          typeof rawArgs.stepFrames === 'number' ? Math.max(1, Math.round(rawArgs.stepFrames)) : 12;

        const frames: Array<Record<string, unknown>> = [];
        for (let f = startF; f <= endF && frames.length < 30; f += stepF) {
          const st = evaluateCompositionAtFrame(this.project, comp.id, f);
          if (!st) continue;
          frames.push({
            frame: f,
            camera: st.camera,
            activeLyrics: st.layers
              .map((l) => l.objects[0]?.evaluatedLyrics)
              .filter((ly): ly is NonNullable<typeof ly> => Boolean(ly && ly.text))
              .map((ly) => ({
                text: ly.text,
                style: ly.style,
                visibleCharCount: ly.visibleCharCount,
                activeWords: ly.words.filter((w) => w.isActive).map((w) => w.text),
              })),
            layers: st.layers.map((l) => ({
              id: l.layer.id,
              name: l.layer.name,
              x: Number(l.worldTransform.x.toFixed(2)),
              y: Number(l.worldTransform.y.toFixed(2)),
              rotation: Number(l.worldTransform.rotation.toFixed(4)),
              scaleX: Number(l.worldTransform.scaleX.toFixed(3)),
              scaleY: Number(l.worldTransform.scaleY.toFixed(3)),
              opacity: Number(l.effectiveOpacity.toFixed(3)),
            })),
          });
        }

        return this.toolOk(
          {
            compositionId: comp.id,
            name: comp.name,
            environment: comp.environment,
            sampleCount: frames.length,
            samples: frames,
          },
          `Evaluated ${frames.length} deterministic frame samples for "${comp.name}"`
        );
      }

      default:
        return this.toolErr(`Unknown MCP tool: "${name}"`);
    }
  }

  /**
   * Handles a single JSON-RPC 2.0 MCP message.
   * Returns null for notifications (requests without `id`).
   */
  public handleRpcMessage(raw: unknown): JsonRpcResponse | null {
    const start = Date.now();
    if (!raw || typeof raw !== 'object') {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request' },
      };
    }

    const req = raw as JsonRpcRequest;
    const isNotification = req.id === undefined;
    const id = req.id ?? null;

    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      if (isNotification) return null;
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
      };
    }

    const params = req.params ?? {};

    switch (req.method) {
      case 'initialize': {
        const requestedVersion =
          typeof params.protocolVersion === 'string' ? params.protocolVersion : MCP_PROTOCOL_VERSION;
        const negotiatedVersion = (SUPPORTED_MCP_VERSIONS as readonly string[]).includes(requestedVersion)
          ? requestedVersion
          : MCP_PROTOCOL_VERSION;
        this.pushLog('initialize', `Negotiated v${negotiatedVersion}`, 'ok', Date.now() - start);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: negotiatedVersion,
            capabilities: {
              tools: { listChanged: true },
              resources: { subscribe: true, listChanged: true },
              prompts: { listChanged: true },
            },
            serverInfo: MOTION_STUDIO_SERVER_INFO,
            instructions:
              'Motion Studio MCP server exposes tools to inspect compositions, add layers, choreograph easing/motion arcs, and update camera & weather environments live.',
          },
        };
      }

      case 'notifications/initialized':
      case 'notifications/cancelled':
        this.pushLog(req.method, 'Client notification acknowledged', 'ok', Date.now() - start);
        return null;

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      case 'tools/list': {
        this.pushLog('tools/list', `${MOTION_MCP_TOOLS.length} tools`, 'ok', Date.now() - start);
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: MOTION_MCP_TOOLS },
        };
      }

      case 'tools/call': {
        const toolName = typeof params.name === 'string' ? params.name : '';
        const toolArgs =
          params.arguments && typeof params.arguments === 'object'
            ? (params.arguments as Record<string, unknown>)
            : {};
        if (!toolName) {
          this.pushLog('tools/call', 'Missing tool name', 'error', Date.now() - start);
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing required parameter: name' },
          };
        }
        const toolResult = this.callTool(toolName, toolArgs);
        this.pushLog(
          `tools/call:${toolName}`,
          toolResult.isError ? toolResult.content[0]?.text ?? 'Error' : 'Success',
          toolResult.isError ? 'error' : 'ok',
          Date.now() - start
        );
        return {
          jsonrpc: '2.0',
          id,
          result: toolResult,
        };
      }

      case 'resources/list': {
        const resources = this.listResources();
        this.pushLog('resources/list', `${resources.length} resources`, 'ok', Date.now() - start);
        return {
          jsonrpc: '2.0',
          id,
          result: { resources },
        };
      }

      case 'resources/read': {
        const uri = typeof params.uri === 'string' ? params.uri : '';
        const content = uri ? this.readResource(uri) : null;
        if (!content) {
          this.pushLog('resources/read', `Not found: ${uri}`, 'error', Date.now() - start);
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32002, message: `Resource not found: ${uri}` },
          };
        }
        this.pushLog('resources/read', uri, 'ok', Date.now() - start);
        return {
          jsonrpc: '2.0',
          id,
          result: { contents: [content] },
        };
      }

      case 'prompts/list': {
        this.pushLog('prompts/list', `${MOTION_MCP_PROMPTS.length} prompts`, 'ok', Date.now() - start);
        return {
          jsonrpc: '2.0',
          id,
          result: { prompts: MOTION_MCP_PROMPTS },
        };
      }

      case 'prompts/get': {
        const promptName = typeof params.name === 'string' ? params.name : '';
        const promptArgs =
          params.arguments && typeof params.arguments === 'object'
            ? (params.arguments as Record<string, string>)
            : {};
        const prompt = promptName ? this.getPrompt(promptName, promptArgs) : null;
        if (!prompt) {
          this.pushLog('prompts/get', `Not found: ${promptName}`, 'error', Date.now() - start);
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Prompt not found: ${promptName}` },
          };
        }
        this.pushLog('prompts/get', promptName, 'ok', Date.now() - start);
        return {
          jsonrpc: '2.0',
          id,
          result: prompt,
        };
      }

      default:
        this.pushLog(req.method, 'Method not found', 'error', Date.now() - start);
        if (isNotification) return null;
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        };
    }
  }
}
