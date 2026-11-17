import { uid } from '../commands/projectCommands.ts';
import type {
  AssetRecord,
  CompositionRecord,
  MotionProject,
} from '../schema/projectSchema.ts';
import { CURRENT_SCHEMA_VERSION } from '../schema/projectSchema.ts';
import { createModifierFromPreset } from '../services/AnimationPresetRegistry.ts';
import { encodeMonoWavDataUrl } from './mediaImport.ts';
import { createStarterProject } from './starterProject.ts';

export type DemoTemplateId = 'lost-kingdom' | 'sakura-portrait' | 'lyric-beat-stage';

export interface DemoTemplateInfo {
  id: DemoTemplateId;
  title: string;
  subtitle: string;
  resolution: string;
  fps: number;
  compositionCount: number;
  durationSec: number;
  highlights: string;
  accentFrom: string;
  accentTo: string;
}

export const DEMO_TEMPLATES: DemoTemplateInfo[] = [
  {
    id: 'lost-kingdom',
    title: 'The Lost Kingdom',
    subtitle: 'Two-act parallax adventure with sprite character animation, fireflies, and chimes.',
    resolution: '1280×720',
    fps: 24,
    compositionCount: 2,
    durationSec: 15,
    highlights: 'Parallax layers · Character walk cycle · Cross-dissolve',
    accentFrom: '#0B1120',
    accentTo: '#1E3A5F',
  },
  {
    id: 'sakura-portrait',
    title: 'Sakura Wind & Cloth',
    subtitle: 'Non-destructive hair, scarf, breathing, and slow push-in camera modifiers.',
    resolution: '1280×720',
    fps: 24,
    compositionCount: 1,
    durationSec: 8,
    highlights: 'Hair & cloth mesh deform · Idle breathing · Petals weather',
    accentFrom: '#1E1B2E',
    accentTo: '#4C1D3D',
  },
  {
    id: 'lyric-beat-stage',
    title: 'Midnight Lyric Stage',
    subtitle: 'Timed karaoke & glow lyrics synced with ambient synth chimes and subtle camera drift.',
    resolution: '1280×720',
    fps: 24,
    compositionCount: 1,
    durationSec: 8,
    highlights: 'Karaoke lyric cues · Beat pulse · Handheld drift',
    accentFrom: '#090D16',
    accentTo: '#1E293B',
  },
];

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function createSynthPadDataUrl(): string {
  const sampleRate = 22050;
  const durationSec = 4;
  const samples = new Float32Array(sampleRate * durationSec);
  const chord = [220.0, 277.18, 329.63, 440.0];
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    let sum = 0;
    chord.forEach((freq, idx) => {
      const onset = idx * 0.45;
      if (t >= onset) {
        const dt = t - onset;
        const env = Math.exp(-dt * 1.1) * Math.min(1, dt * 20);
        sum += Math.sin(2 * Math.PI * freq * dt) * env * 0.14;
      }
    });
    sum += Math.sin(2 * Math.PI * 110 * t) * 0.06;
    samples[i] = sum;
  }
  return encodeMonoWavDataUrl(samples, sampleRate);
}

function createPortraitSilhouetteSvg(): string {
  return svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 440" width="360" height="440">
      <ellipse cx="180" cy="405" rx="74" ry="14" fill="rgba(0,0,0,0.35)"/>
      <path d="M122 210 C112 290, 108 355, 118 395 L242 395 C252 355, 248 290, 238 210 Z" fill="#1E293B"/>
      <path d="M138 212 L222 212 L230 340 L130 340 Z" fill="#334155"/>
      <circle cx="180" cy="138" r="42" fill="#FDE68A" opacity="0.92"/>
      <path d="M132 132 C132 82, 228 82, 228 132 C228 158, 212 184, 180 184 C148 184, 132 158, 132 132 Z" fill="#0F172A" opacity="0.12"/>
      <path d="M134 128 C142 74, 218 74, 226 128 C210 105, 150 105, 134 128 Z" fill="#1E1B4B"/>
      <rect x="148" y="198" width="64" height="22" rx="10" fill="#E11D48"/>
    </svg>
  `);
}

function createFlowingHairSvg(): string {
  return svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 300" width="260" height="300">
      <path d="M90 36 C165 26, 218 84, 212 162 C208 215, 236 254, 246 286 C192 268, 162 230, 152 182 C138 228, 108 262, 64 282 C88 224, 96 154, 70 96 C62 72, 70 42, 90 36 Z" fill="#1E1B4B"/>
      <path d="M110 50 C162 56, 192 106, 184 176 C178 210, 196 244, 210 268 C174 244, 156 206, 150 156 Z" fill="#312E81" opacity="0.65"/>
    </svg>
  `);
}

function createFlowingScarfSvg(): string {
  return svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 140" width="320" height="140">
      <path d="M22 46 C86 24, 158 76, 224 44 C264 26, 294 38, 308 58 C272 78, 232 96, 178 86 C122 76, 70 104, 24 88 Z" fill="#E11D48"/>
      <path d="M24 58 C92 42, 158 84, 226 56 C258 42, 284 48, 298 62 C264 76, 228 84, 178 76 C122 68, 74 90, 26 78 Z" fill="#FB7185" opacity="0.55"/>
    </svg>
  `);
}

function createStageHorizonSvg(): string {
  return svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 320" width="1280" height="320">
      <defs>
        <linearGradient id="stageGlow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="#090D16" stop-opacity="0.95"/>
        </linearGradient>
      </defs>
      <rect x="0" y="180" width="1280" height="140" fill="url(#stageGlow)"/>
      <ellipse cx="640" cy="186" rx="460" ry="38" fill="#38BDF8" opacity="0.16"/>
      <line x1="0" y1="186" x2="1280" y2="186" stroke="#7DD3FC" stroke-opacity="0.35" stroke-width="2"/>
    </svg>
  `);
}

function createSakuraPortraitDemo(): MotionProject {
  const now = new Date().toISOString();
  const fps = 24;

  const portraitAsset: AssetRecord = {
    id: 'asset_demo_portrait',
    name: 'Wind Portrait Figure',
    category: 'characters',
    type: 'image',
    mimeType: 'image/svg+xml',
    dataUrl: createPortraitSilhouetteSvg(),
    width: 360,
    height: 440,
    hash: 'demo_portrait_svg',
    tags: ['character', 'portrait', 'demo'],
    folder: 'Demo',
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  const hairAsset: AssetRecord = {
    id: 'asset_demo_hair',
    name: 'Flowing Hair Strand',
    category: 'characters',
    type: 'image',
    mimeType: 'image/svg+xml',
    dataUrl: createFlowingHairSvg(),
    width: 260,
    height: 300,
    hash: 'demo_hair_svg',
    tags: ['hair', 'wind', 'demo'],
    folder: 'Demo',
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  const scarfAsset: AssetRecord = {
    id: 'asset_demo_scarf',
    name: 'Crimson Scarf Tail',
    category: 'props',
    type: 'image',
    mimeType: 'image/svg+xml',
    dataUrl: createFlowingScarfSvg(),
    width: 320,
    height: 140,
    hash: 'demo_scarf_svg',
    tags: ['cloth', 'scarf', 'demo'],
    folder: 'Demo',
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  const breathMod = createModifierFromPreset('character.breathing', fps, uid('mod'))!;
  const hairWindMod = createModifierFromPreset('hair.gentle-wind', fps, uid('mod'))!;
  const scarfMod = createModifierFromPreset('cloth.scarf-flutter', fps, uid('mod'))!;
  const zoomMod = createModifierFromPreset('camera.slow-zoom-in', fps, uid('mod'))!;

  const comp: CompositionRecord = {
    id: 'comp_sakura_main',
    name: '01 - Sakura Breeze',
    description: 'Layered character portrait with non-destructive wind, cloth, and breathing modifiers.',
    settings: {
      width: 1280,
      height: 720,
      durationFrames: 192,
      inheritProjectFps: true,
      fps: { numerator: 24, denominator: 1 },
      workAreaStart: 0,
      workAreaEnd: 192,
    },
    camera: {
      x: 0,
      y: -10,
      zoom: 1,
      rotation: 0,
      parallaxStrength: 1.1,
      keyframes: { x: [], y: [], zoom: [] },
      modifiers: [zoomMod],
    },
    environment: {
      presetId: 'dusk-sakura',
      skyTopColor: '#1E1B2E',
      skyBottomColor: '#6D2856',
      hazeColor: '#F9A8D4',
      hazeIntensity: 0.28,
      weatherType: 'leaves',
      weatherDensity: 0.55,
      weatherSpeed: 1.0,
      weatherDirectionDeg: 28,
      weatherSize: 1.05,
      weatherOpacity: 0.88,
      weatherLoopFrames: 192,
      fogOpacity: 0.14,
      fogColor: '#FBCFE8',
      fogSpeed: 0.8,
      cloudDensity: 0.25,
      cloudSpeed: 0.6,
      grassDensity: 0.45,
      grassWindSpeed: 1.15,
      windDirection: 'right',
      windStrength: 1.2,
      timeOfDayTint: '#F472B6',
      tintOpacity: 0.08,
    },
    layers: [
      {
        id: 'layer_sakura_title',
        name: 'Scene Title',
        role: 'foreground',
        visible: true,
        locked: false,
        solo: false,
        opacity: 0.9,
        blendMode: 'normal',
        depth: 0.7,
        inFrame: 0,
        outFrame: 192,
        objects: [
          {
            id: uid('obj'),
            name: 'Title Text',
            kind: 'text',
            text: 'Sakura Wind Study',
            fontSize: 32,
            fontFamily: 'Plus Jakarta Sans',
            color: '#FDF2F8',
            align: 'left',
            transform: {
              x: 96,
              y: 108,
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
      },
      {
        id: 'layer_sakura_scarf',
        name: 'Flowing Scarf (Cloth Preset)',
        role: 'prop',
        visible: true,
        locked: false,
        solo: false,
        opacity: 1,
        blendMode: 'normal',
        depth: 0.25,
        inFrame: 0,
        outFrame: 192,
        objects: [
          {
            id: uid('obj'),
            name: 'Scarf Sprite',
            kind: 'sprite',
            assetId: scarfAsset.id,
            width: 300,
            height: 130,
            transform: {
              x: 755,
              y: 342,
              rotation: -0.05,
              scaleX: 1,
              scaleY: 1,
              pivotX: 0,
              pivotY: 0,
              opacity: 1,
            },
          },
        ],
        keyframes: { x: [], y: [], rotation: [], scaleX: [], scaleY: [], opacity: [] },
        modifiers: [scarfMod],
      },
      {
        id: 'layer_sakura_portrait',
        name: 'Character Portrait (Breathing)',
        role: 'character',
        visible: true,
        locked: false,
        solo: false,
        opacity: 1,
        blendMode: 'normal',
        depth: 0.15,
        inFrame: 0,
        outFrame: 192,
        objects: [
          {
            id: uid('obj'),
            name: 'Portrait Figure',
            kind: 'sprite',
            assetId: portraitAsset.id,
            width: 360,
            height: 440,
            transform: {
              x: 640,
              y: 390,
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
        modifiers: [breathMod],
      },
      {
        id: 'layer_sakura_hair',
        name: 'Hair Strand (Wind Preset)',
        role: 'character',
        visible: true,
        locked: false,
        solo: false,
        opacity: 1,
        blendMode: 'normal',
        depth: 0.1,
        inFrame: 0,
        outFrame: 192,
        objects: [
          {
            id: uid('obj'),
            name: 'Flowing Hair',
            kind: 'sprite',
            assetId: hairAsset.id,
            width: 240,
            height: 280,
            transform: {
              x: 724,
              y: 298,
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
        modifiers: [hairWindMod],
      },
    ],
    audioTracks: [],
    markers: [{ id: uid('mk'), frame: 0, label: 'Wind Swell', color: '#F472B6' }],
  };

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: uid('proj'),
    name: 'Sakura Wind & Cloth (Demo)',
    description: 'Non-destructive hair wind, scarf cloth flutter, and breathing idle modifiers.',
    createdAt: now,
    updatedAt: now,
    settings: {
      fps: { numerator: 24, denominator: 1 },
      defaultWidth: 1280,
      defaultHeight: 720,
    },
    assets: [portraitAsset, hairAsset, scarfAsset],
    characters: [],
    compositions: [comp],
    projectTimeline: {
      clips: [
        {
          id: uid('ptc'),
          compositionId: comp.id,
          startFrame: 0,
          durationFrames: comp.settings.durationFrames,
          inOffsetFrames: 0,
          transitionIn: 'cut',
          transitionDurationFrames: 0,
        },
      ],
      markers: [{ id: uid('pmk'), frame: 0, label: 'Sakura Breeze', color: '#F472B6' }],
    },
    exportSettings: {
      format: 'webm',
      quality: 0.92,
      includeAudio: true,
    },
  };
}

function createLyricBeatStageDemo(): MotionProject {
  const now = new Date().toISOString();
  const fps = 24;

  const horizonAsset: AssetRecord = {
    id: 'asset_demo_stage_horizon',
    name: 'Stage Horizon Glow',
    category: 'backgrounds',
    type: 'image',
    mimeType: 'image/svg+xml',
    dataUrl: createStageHorizonSvg(),
    width: 1280,
    height: 320,
    hash: 'demo_stage_horizon_svg',
    tags: ['stage', 'horizon', 'demo'],
    folder: 'Demo',
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  const synthAsset: AssetRecord = {
    id: 'asset_demo_synth_pad',
    name: 'Midnight Pad Chimes',
    category: 'audio',
    type: 'audio',
    mimeType: 'audio/wav',
    dataUrl: createSynthPadDataUrl(),
    durationSeconds: 4,
    hash: 'demo_synth_pad_wav',
    tags: ['audio', 'music', 'demo'],
    folder: 'Audio',
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  const driftMod = createModifierFromPreset('camera.parallax-drift', fps, uid('mod'))!;
  const pulseMod = createModifierFromPreset('fx.glow-pulse', fps, uid('mod'))!;

  const comp: CompositionRecord = {
    id: 'comp_lyric_stage',
    name: '01 - Midnight Lyrics',
    description: 'Timed karaoke lyrics synchronized with beat-reactive camera drift and ambient audio.',
    settings: {
      width: 1280,
      height: 720,
      durationFrames: 192,
      inheritProjectFps: true,
      fps: { numerator: 24, denominator: 1 },
      workAreaStart: 0,
      workAreaEnd: 192,
    },
    camera: {
      x: 0,
      y: 0,
      zoom: 1.02,
      rotation: 0,
      parallaxStrength: 1,
      keyframes: { x: [], y: [], zoom: [] },
      modifiers: [driftMod],
    },
    environment: {
      presetId: 'twilight',
      skyTopColor: '#090D16',
      skyBottomColor: '#1E293B',
      hazeColor: '#38BDF8',
      hazeIntensity: 0.25,
      weatherType: 'fireflies',
      weatherDensity: 0.5,
      weatherSpeed: 0.85,
      weatherDirectionDeg: 0,
      weatherSize: 1.15,
      weatherOpacity: 0.9,
      weatherLoopFrames: 192,
      fogOpacity: 0.16,
      fogColor: '#38BDF8',
      fogSpeed: 0.7,
      cloudDensity: 0.15,
      cloudSpeed: 0.5,
      grassDensity: 0,
      grassWindSpeed: 1,
      windDirection: 'right',
      windStrength: 0.8,
      timeOfDayTint: '#0F172A',
      tintOpacity: 0,
    },
    layers: [
      {
        id: 'layer_lyric_main',
        name: 'Lead Lyrics Track',
        role: 'foreground',
        visible: true,
        locked: false,
        solo: false,
        opacity: 1,
        blendMode: 'normal',
        depth: 0.5,
        inFrame: 0,
        outFrame: 192,
        objects: [
          {
            id: uid('obj'),
            name: 'Karaoke Lyrics',
            kind: 'text',
            text: 'City lights drift beneath the night sky',
            fontSize: 48,
            fontFamily: 'Plus Jakarta Sans',
            color: '#F8FAFC',
            align: 'center',
            lyrics: {
              enabled: true,
              style: 'karaoke',
              highlightColor: '#38BDF8',
              glowColor: '#60A5FA',
              glowBlur: 14,
              shadowColor: 'rgba(0,0,0,0.75)',
              shadowBlur: 8,
              staggerFrames: 3,
              beatBpm: 120,
              beatSyncIntensity: 0.18,
              cues: [
                {
                  id: 'cue_1',
                  text: 'City lights drift across the sky',
                  startFrame: 0,
                  endFrame: 96,
                  words: [
                    { text: 'City', startFrame: 0, endFrame: 16 },
                    { text: 'lights', startFrame: 16, endFrame: 32 },
                    { text: 'drift', startFrame: 32, endFrame: 48 },
                    { text: 'across', startFrame: 48, endFrame: 64 },
                    { text: 'the', startFrame: 64, endFrame: 78 },
                    { text: 'sky', startFrame: 78, endFrame: 96 },
                  ],
                },
                {
                  id: 'cue_2',
                  text: 'Echoes shimmer in twilight glow',
                  startFrame: 96,
                  endFrame: 192,
                  words: [
                    { text: 'Echoes', startFrame: 96, endFrame: 116 },
                    { text: 'shimmer', startFrame: 116, endFrame: 136 },
                    { text: 'in', startFrame: 136, endFrame: 150 },
                    { text: 'twilight', startFrame: 150, endFrame: 172 },
                    { text: 'glow', startFrame: 172, endFrame: 192 },
                  ],
                },
              ],
            },
            transform: {
              x: 640,
              y: 350,
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
        modifiers: [pulseMod],
      },
      {
        id: 'layer_stage_horizon',
        name: 'Stage Horizon',
        role: 'background',
        visible: true,
        locked: false,
        solo: false,
        opacity: 1,
        blendMode: 'screen',
        depth: -0.6,
        inFrame: 0,
        outFrame: 192,
        objects: [
          {
            id: uid('obj'),
            name: 'Horizon Light',
            kind: 'sprite',
            assetId: horizonAsset.id,
            width: 1280,
            height: 320,
            transform: {
              x: 640,
              y: 560,
              rotation: 0,
              scaleX: 1.08,
              scaleY: 1,
              pivotX: 0,
              pivotY: 0,
              opacity: 1,
            },
          },
        ],
        keyframes: { x: [], y: [], rotation: [], scaleX: [], scaleY: [], opacity: [] },
        modifiers: [],
      },
    ],
    audioTracks: [
      {
        id: uid('trk'),
        name: 'Midnight Synth',
        category: 'music',
        muted: false,
        solo: false,
        volume: 0.75,
        clips: [
          {
            id: uid('clip'),
            assetId: synthAsset.id,
            name: 'Midnight Pad Chimes',
            startFrame: 0,
            inFrame: 0,
            durationFrames: 96,
            volume: 1,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            loop: true,
          },
        ],
      },
    ],
    markers: [
      { id: uid('mk'), frame: 0, label: 'Verse 1', color: '#38BDF8' },
      { id: uid('mk'), frame: 96, label: 'Chorus Line', color: '#F59E0B' },
    ],
  };

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: uid('proj'),
    name: 'Midnight Lyric Stage (Demo)',
    description: 'Timed karaoke lyrics synced with beat pulse, ambient chimes, and twilight fireflies.',
    createdAt: now,
    updatedAt: now,
    settings: {
      fps: { numerator: 24, denominator: 1 },
      defaultWidth: 1280,
      defaultHeight: 720,
    },
    assets: [horizonAsset, synthAsset],
    characters: [],
    compositions: [comp],
    projectTimeline: {
      clips: [
        {
          id: uid('ptc'),
          compositionId: comp.id,
          startFrame: 0,
          durationFrames: comp.settings.durationFrames,
          inOffsetFrames: 0,
          transitionIn: 'cut',
          transitionDurationFrames: 0,
        },
      ],
      markers: [{ id: uid('pmk'), frame: 0, label: 'Lyric Stage', color: '#38BDF8' }],
    },
    exportSettings: {
      format: 'webm',
      quality: 0.92,
      includeAudio: true,
    },
  };
}

export function createDemoProject(demoId: DemoTemplateId): MotionProject {
  if (demoId === 'sakura-portrait') {
    return createSakuraPortraitDemo();
  }
  if (demoId === 'lyric-beat-stage') {
    return createLyricBeatStageDemo();
  }
  const starter = createStarterProject();
  const now = new Date().toISOString();
  return {
    ...starter,
    id: uid('proj'),
    name: 'The Lost Kingdom (Demo)',
    createdAt: now,
    updatedAt: now,
  };
}
