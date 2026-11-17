import { uid } from '../commands/projectCommands.ts';
import type {
  AssetRecord,
  CharacterDefinition,
  CompositionRecord,
  MotionProject,
} from '../schema/projectSchema.ts';
import { CURRENT_SCHEMA_VERSION } from '../schema/projectSchema.ts';
import { encodeMonoWavDataUrl } from './mediaImport.ts';

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function createMountainRidgeSvg(color: string, peakColor: string): string {
  return svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 420" width="1400" height="420">
      <path d="M0 420 L0 260 L140 160 L290 250 L470 95 L650 220 L820 110 L1020 245 L1190 130 L1400 240 L1400 420 Z" fill="${color}"/>
      <path d="M470 95 L535 160 L495 148 L470 165 L445 146 L410 158 Z" fill="${peakColor}" opacity="0.65"/>
      <path d="M820 110 L875 165 L840 152 L818 168 L792 154 L765 164 Z" fill="${peakColor}" opacity="0.6"/>
      <path d="M1190 130 L1245 178 L1212 168 L1190 180 L1164 166 L1140 176 Z" fill="${peakColor}" opacity="0.55"/>
    </svg>
  `);
}

function createForestSilhouetteSvg(color: string): string {
  const trees: string[] = [];
  for (let i = 0; i < 16; i++) {
    const x = i * 95 + (i % 2 === 0 ? 10 : -10);
    const h = 150 + ((i * 37) % 110);
    const y = 340 - h;
    trees.push(
      `<polygon points="${x + 42},${y} ${x},${y + h * 0.55} ${x + 84},${y + h * 0.55}" fill="${color}"/>`,
      `<polygon points="${x + 42},${y + h * 0.25} ${x - 10},${y + h} ${x + 94},${y + h}" fill="${color}"/>`
    );
  }
  return svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 360" width="1440" height="360">
      <rect x="0" y="310" width="1440" height="60" fill="${color}"/>
      ${trees.join('')}
    </svg>
  `);
}

function createStoneArchwaySvg(): string {
  return svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 420" width="420" height="420">
      <rect x="55" y="160" width="68" height="245" rx="6" fill="#334155"/>
      <rect x="297" y="160" width="68" height="245" rx="6" fill="#334155"/>
      <path d="M55 180 C55 45, 365 45, 365 180 L297 180 C297 105, 123 105, 123 180 Z" fill="#475569"/>
      <circle cx="210" cy="148" r="24" fill="#38BDF8" opacity="0.28"/>
      <circle cx="210" cy="148" r="11" fill="#7DD3FC" opacity="0.85"/>
      <rect x="35" y="388" width="350" height="24" rx="4" fill="#1E293B"/>
    </svg>
  `);
}

function createTravelerSpriteSheetSvg(): string {
  // 4 columns x 2 rows of 128x128 = 512x256 crisp vector sprite sheet
  // Row 0: Idle (4 subtle bob & cloak sway frames)
  // Row 1: Walk (4 stride & lantern swing frames)
  const frames: string[] = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const ox = col * 128;
      const oy = row * 128;
      const bob = row === 0 ? Math.sin((col / 4) * Math.PI * 2) * 2.5 : Math.abs(Math.sin((col / 4) * Math.PI * 2)) * -4;
      const legOffset = row === 1 ? Math.sin((col / 4) * Math.PI * 2) * 11 : 0;
      const cloakFlare = row === 1 ? (col % 2 === 0 ? 5 : -2) : col % 2 === 0 ? 2 : 0;

      frames.push(`
        <g transform="translate(${ox}, ${oy + bob})">
          <!-- Shadow -->
          <ellipse cx="64" cy="${114 - bob}" rx="22" ry="5" fill="rgba(0,0,0,0.35)"/>
          <!-- Legs -->
          <rect x="${53 - legOffset}" y="88" width="7" height="22" rx="3" fill="#1E293B"/>
          <rect x="${67 + legOffset}" y="88" width="7" height="22" rx="3" fill="#0F172A"/>
          <!-- Cloak -->
          <path d="M44 50 L82 50 L${90 + cloakFlare} 94 L${38 - cloakFlare} 94 Z" fill="#2563EB"/>
          <path d="M50 52 L76 52 L80 94 L48 94 Z" fill="#3B82F6"/>
          <!-- Hood / Head -->
          <circle cx="64" cy="40" r="16" fill="#1D4ED8"/>
          <circle cx="66" cy="42" r="10" fill="#0F172A"/>
          <!-- Glowing visor eyes -->
          <circle cx="69" cy="41" r="2.2" fill="#FDE047"/>
          <circle cx="75" cy="41" r="1.8" fill="#FDE047"/>
          <!-- Lantern staff -->
          <line x1="86" y1="32" x2="86" y2="108" stroke="#94A3B8" stroke-width="3" stroke-linecap="round"/>
          <circle cx="86" cy="30" r="6" fill="#F59E0B"/>
          <circle cx="86" cy="30" r="11" fill="#FDE047" opacity="0.28"/>
        </g>
      `);
    }
  }

  return svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 256" width="512" height="256">
      ${frames.join('')}
    </svg>
  `);
}

function createAmbientChimeAudioDataUrl(): string {
  const sampleRate = 22050;
  const durationSec = 4;
  const samples = new Float32Array(sampleRate * durationSec);
  const notes = [261.63, 329.63, 392.0, 523.25]; // C4 E4 G4 C5 gentle chime
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    let sum = 0;
    notes.forEach((freq, idx) => {
      const noteStart = idx * 0.65;
      if (t >= noteStart) {
        const dt = t - noteStart;
        const env = Math.exp(-dt * 1.45) * Math.min(1, dt * 35);
        sum += Math.sin(2 * Math.PI * freq * dt) * env * 0.16;
      }
    });
    // subtle warm pad
    sum += Math.sin(2 * Math.PI * 130.81 * t) * 0.05 * Math.sin(Math.PI * (t / durationSec));
    samples[i] = sum;
  }
  return encodeMonoWavDataUrl(samples, sampleRate);
}

export function createStarterProject(): MotionProject {
  const now = new Date().toISOString();

  const farMountainsAsset: AssetRecord = {
    id: 'asset_mountains_far',
    name: 'Distant Peaks',
    category: 'backgrounds',
    type: 'image',
    mimeType: 'image/svg+xml',
    dataUrl: createMountainRidgeSvg('#1E293B', '#64748B'),
    width: 1400,
    height: 420,
    hash: 'starter_mtn_far',
    tags: ['landscape', 'mountains', 'background'],
    folder: 'Environments',
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  const midForestAsset: AssetRecord = {
    id: 'asset_forest_mid',
    name: 'Pine Ridge',
    category: 'environments',
    type: 'image',
    mimeType: 'image/svg+xml',
    dataUrl: createForestSilhouetteSvg('#0F172A'),
    width: 1440,
    height: 360,
    hash: 'starter_forest_mid',
    tags: ['forest', 'trees', 'midground'],
    folder: 'Environments',
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  const fgForestAsset: AssetRecord = {
    id: 'asset_forest_fg',
    name: 'Foreground Pines',
    category: 'foregrounds',
    type: 'image',
    mimeType: 'image/svg+xml',
    dataUrl: createForestSilhouetteSvg('#090D16'),
    width: 1440,
    height: 360,
    hash: 'starter_forest_fg',
    tags: ['foreground', 'silhouette'],
    folder: 'Environments',
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  const archwayAsset: AssetRecord = {
    id: 'asset_archway',
    name: 'Ancient Rune Gate',
    category: 'props',
    type: 'image',
    mimeType: 'image/svg+xml',
    dataUrl: createStoneArchwaySvg(),
    width: 420,
    height: 420,
    hash: 'starter_archway',
    tags: ['ruins', 'prop', 'gate'],
    folder: 'Props',
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  const travelerSheetAsset: AssetRecord = {
    id: 'asset_traveler_sheet',
    name: 'Lantern Traveler Sheet',
    category: 'characters',
    type: 'spritesheet',
    mimeType: 'image/svg+xml',
    dataUrl: createTravelerSpriteSheetSvg(),
    width: 512,
    height: 256,
    hash: 'starter_traveler_sheet',
    tags: ['character', 'spritesheet', 'hero'],
    folder: 'Characters',
    createdAt: now,
    updatedAt: now,
    metadata: { rows: 2, cols: 4 },
  };

  const ambientAudioAsset: AssetRecord = {
    id: 'asset_twilight_chime',
    name: 'Twilight Chimes',
    category: 'audio',
    type: 'audio',
    mimeType: 'audio/wav',
    dataUrl: createAmbientChimeAudioDataUrl(),
    durationSeconds: 4,
    hash: 'starter_chime_wav',
    tags: ['music', 'ambient'],
    folder: 'Audio',
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  const travelerCharacter: CharacterDefinition = {
    id: 'char_traveler',
    name: 'Lantern Traveler',
    assetId: travelerSheetAsset.id,
    mode: 'spritesheet',
    grid: {
      rows: 2,
      cols: 4,
      cellWidth: 128,
      cellHeight: 128,
      marginX: 0,
      marginY: 0,
      spacingX: 0,
      spacingY: 0,
    },
    frames: [
      { x: 0, y: 0, w: 128, h: 128 },
      { x: 128, y: 0, w: 128, h: 128 },
      { x: 256, y: 0, w: 128, h: 128 },
      { x: 384, y: 0, w: 128, h: 128 },
      { x: 0, y: 128, w: 128, h: 128 },
      { x: 128, y: 128, w: 128, h: 128 },
      { x: 256, y: 128, w: 128, h: 128 },
      { x: 384, y: 128, w: 128, h: 128 },
    ],
    sequenceAssetIds: [],
    clips: [
      {
        id: 'clip_idle',
        name: 'Idle',
        frameIndices: [0, 1, 2, 3],
        fps: 6,
        loop: true,
      },
      {
        id: 'clip_walk',
        name: 'Walk',
        frameIndices: [4, 5, 6, 7],
        fps: 9,
        loop: true,
      },
    ],
  };

  const comp1: CompositionRecord = {
    id: 'comp_opening',
    name: '01 - Opening Vista',
    description: 'Lantern Traveler crosses the misty ridge at twilight.',
    settings: {
      width: 1280,
      height: 720,
      durationFrames: 192, // 8 seconds at 24fps
      inheritProjectFps: true,
      fps: { numerator: 24, denominator: 1 },
      workAreaStart: 0,
      workAreaEnd: 192,
    },
    camera: {
      x: 0,
      y: 0,
      zoom: 1,
      rotation: 0,
      parallaxStrength: 1,
      keyframes: {
        x: [
          { id: 'ckf_1', frame: 0, value: -60, interpolation: 'easeInOut' },
          { id: 'ckf_2', frame: 191, value: 80, interpolation: 'easeInOut' },
        ],
        y: [],
        zoom: [
          { id: 'ckf_z1', frame: 0, value: 1.0, interpolation: 'easeInOut' },
          { id: 'ckf_z2', frame: 191, value: 1.08, interpolation: 'easeInOut' },
        ],
      },
      modifiers: [],
    },
    environment: {
      presetId: 'twilight',
      skyTopColor: '#0B1120',
      skyBottomColor: '#1E3A5F',
      hazeColor: '#60A5FA',
      hazeIntensity: 0.24,
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
      timeOfDayTint: '#0F172A',
      tintOpacity: 0,
    },
    layers: [
      {
        id: 'layer_title',
        name: 'Title Overlay',
        role: 'foreground',
        visible: true,
        locked: false,
        solo: false,
        opacity: 1,
        blendMode: 'normal',
        depth: 0.35,
        inFrame: 0,
        outFrame: 120,
        objects: [
          {
            id: 'obj_title',
            name: 'Title Text',
            kind: 'text',
            text: 'THE LOST KINGDOM',
            fontSize: 44,
            fontFamily: 'Plus Jakarta Sans',
            color: '#F8FAFC',
            align: 'center',
            transform: {
              x: 640,
              y: 160,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              pivotX: 0,
              pivotY: 0,
              opacity: 1,
            },
          },
        ],
        keyframes: {
          x: [],
          y: [
            { id: 'tkf_y1', frame: 0, value: 185, interpolation: 'easeOut' },
            { id: 'tkf_y2', frame: 36, value: 155, interpolation: 'easeOut' },
          ],
          rotation: [],
          scaleX: [],
          scaleY: [],
          opacity: [
            { id: 'tkf_o1', frame: 0, value: 0, interpolation: 'easeInOut' },
            { id: 'tkf_o2', frame: 24, value: 1, interpolation: 'easeInOut' },
            { id: 'tkf_o3', frame: 96, value: 1, interpolation: 'easeInOut' },
            { id: 'tkf_o4', frame: 120, value: 0, interpolation: 'easeInOut' },
          ],
        },
        modifiers: [],
      },
      {
        id: 'layer_fg_pines',
        name: 'Foreground Pines',
        role: 'foreground',
        visible: true,
        locked: false,
        solo: false,
        opacity: 1,
        blendMode: 'normal',
        depth: 0.75,
        inFrame: 0,
        outFrame: 192,
        objects: [
          {
            id: 'obj_fg_pines',
            name: 'Foreground Pines',
            kind: 'sprite',
            assetId: fgForestAsset.id,
            width: 1540,
            height: 290,
            transform: {
              x: 640,
              y: 660,
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
        id: 'layer_traveler',
        name: 'Lantern Traveler',
        role: 'character',
        visible: true,
        locked: false,
        solo: false,
        opacity: 1,
        blendMode: 'normal',
        depth: 0,
        inFrame: 0,
        outFrame: 192,
        objects: [
          {
            id: 'obj_traveler',
            name: 'Lantern Traveler',
            kind: 'character',
            characterId: travelerCharacter.id,
            activeClipId: 'clip_walk',
            clipOffsetFrames: 0,
            playbackSpeed: 1,
            width: 165,
            height: 165,
            flipX: false,
            transform: {
              x: 240,
              y: 495,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              pivotX: 0,
              pivotY: 0,
              opacity: 1,
            },
          },
        ],
        keyframes: {
          x: [
            { id: 'hkf_x1', frame: 0, value: 240, interpolation: 'linear' },
            { id: 'hkf_x2', frame: 191, value: 920, interpolation: 'linear' },
          ],
          y: [],
          rotation: [],
          scaleX: [],
          scaleY: [],
          opacity: [],
        },
        modifiers: [],
      },
      {
        id: 'layer_archway',
        name: 'Rune Gate Prop',
        role: 'prop',
        visible: true,
        locked: false,
        solo: false,
        opacity: 1,
        blendMode: 'normal',
        depth: -0.1,
        inFrame: 0,
        outFrame: 192,
        objects: [
          {
            id: 'obj_archway',
            name: 'Ancient Rune Gate',
            kind: 'sprite',
            assetId: archwayAsset.id,
            width: 310,
            height: 310,
            transform: {
              x: 980,
              y: 435,
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
        id: 'layer_mid_forest',
        name: 'Midground Ridge',
        role: 'midground',
        visible: true,
        locked: false,
        solo: false,
        opacity: 0.95,
        blendMode: 'normal',
        depth: -0.45,
        inFrame: 0,
        outFrame: 192,
        objects: [
          {
            id: 'obj_mid_forest',
            name: 'Pine Ridge',
            kind: 'sprite',
            assetId: midForestAsset.id,
            width: 1560,
            height: 380,
            transform: {
              x: 640,
              y: 530,
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
        id: 'layer_far_mountains',
        name: 'Distant Peaks',
        role: 'background',
        visible: true,
        locked: false,
        solo: false,
        opacity: 0.88,
        blendMode: 'normal',
        depth: -0.85,
        inFrame: 0,
        outFrame: 192,
        objects: [
          {
            id: 'obj_far_mountains',
            name: 'Distant Peaks',
            kind: 'sprite',
            assetId: farMountainsAsset.id,
            width: 1600,
            height: 460,
            transform: {
              x: 640,
              y: 410,
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
        id: 'layer_moon',
        name: 'Crescent Moon',
        role: 'background',
        visible: true,
        locked: false,
        solo: false,
        opacity: 0.92,
        blendMode: 'normal',
        depth: -0.95,
        inFrame: 0,
        outFrame: 192,
        objects: [
          {
            id: 'obj_moon',
            name: 'Moon',
            kind: 'shape',
            shapeType: 'ellipse',
            width: 96,
            height: 96,
            fill: '#FEF3C7',
            stroke: '#FDE68A',
            strokeWidth: 0,
            cornerRadius: 0,
            transform: {
              x: 280,
              y: 165,
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
    ],
    audioTracks: [
      {
        id: 'track_music_1',
        name: 'Music · Chimes',
        category: 'music',
        muted: false,
        solo: false,
        volume: 0.75,
        clips: [
          {
            id: 'aclip_1',
            assetId: ambientAudioAsset.id,
            name: 'Twilight Chimes',
            startFrame: 0,
            inFrame: 0,
            durationFrames: 96,
            volume: 1,
            fadeInFrames: 8,
            fadeOutFrames: 16,
            loop: false,
          },
        ],
      },
    ],
    markers: [
      { id: 'mk_1', frame: 0, label: 'Intro', color: '#3B82F6' },
      { id: 'mk_2', frame: 120, label: 'Gate Approach', color: '#F59E0B' },
    ],
  };

  const comp2: CompositionRecord = {
    id: 'comp_sanctuary',
    name: '02 - Ancient Gate',
    description: 'Close encounter at the glowing rune portal.',
    settings: {
      width: 1280,
      height: 720,
      durationFrames: 144,
      inheritProjectFps: true,
      fps: { numerator: 24, denominator: 1 },
      workAreaStart: 0,
      workAreaEnd: 144,
    },
    camera: {
      x: 0,
      y: 0,
      zoom: 1.15,
      rotation: 0,
      parallaxStrength: 1,
      keyframes: {
        x: [],
        y: [],
        zoom: [
          { id: 'c2_z1', frame: 0, value: 1.05, interpolation: 'easeInOut' },
          { id: 'c2_z2', frame: 143, value: 1.24, interpolation: 'easeInOut' },
        ],
      },
      modifiers: [],
    },
    environment: {
      presetId: 'aurora',
      skyTopColor: '#061523',
      skyBottomColor: '#134E4A',
      hazeColor: '#2DD4BF',
      hazeIntensity: 0.28,
      weatherType: 'snow',
      weatherDensity: 0.35,
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
      timeOfDayTint: '#042F2E',
      tintOpacity: 0.08,
    },
    layers: [
      {
        id: 'layer_c2_traveler',
        name: 'Lantern Traveler',
        role: 'character',
        visible: true,
        locked: false,
        solo: false,
        opacity: 1,
        blendMode: 'normal',
        depth: 0.1,
        inFrame: 0,
        outFrame: 144,
        objects: [
          {
            id: 'obj_c2_traveler',
            name: 'Lantern Traveler',
            kind: 'character',
            characterId: travelerCharacter.id,
            activeClipId: 'clip_idle',
            clipOffsetFrames: 0,
            playbackSpeed: 1,
            width: 190,
            height: 190,
            flipX: false,
            transform: {
              x: 470,
              y: 495,
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
        id: 'layer_c2_gate',
        name: 'Rune Gate Close',
        role: 'prop',
        visible: true,
        locked: false,
        solo: false,
        opacity: 1,
        blendMode: 'normal',
        depth: 0,
        inFrame: 0,
        outFrame: 144,
        objects: [
          {
            id: 'obj_c2_gate',
            name: 'Ancient Rune Gate',
            kind: 'sprite',
            assetId: archwayAsset.id,
            width: 440,
            height: 440,
            transform: {
              x: 780,
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
        modifiers: [],
      },
      {
        id: 'layer_c2_forest',
        name: 'Deep Pine Valley',
        role: 'background',
        visible: true,
        locked: false,
        solo: false,
        opacity: 0.9,
        blendMode: 'normal',
        depth: -0.6,
        inFrame: 0,
        outFrame: 144,
        objects: [
          {
            id: 'obj_c2_forest',
            name: 'Pine Ridge',
            kind: 'sprite',
            assetId: midForestAsset.id,
            width: 1600,
            height: 400,
            transform: {
              x: 640,
              y: 540,
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
    ],
    audioTracks: [],
    markers: [],
  };

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: 'proj_lost_kingdom',
    name: 'The Lost Kingdom',
    description: 'Animated short film created in Motion Studio',
    createdAt: now,
    updatedAt: now,
    settings: {
      fps: { numerator: 24, denominator: 1 },
      defaultWidth: 1280,
      defaultHeight: 720,
    },
    assets: [
      travelerSheetAsset,
      archwayAsset,
      farMountainsAsset,
      midForestAsset,
      fgForestAsset,
      ambientAudioAsset,
    ],
    characters: [travelerCharacter],
    compositions: [comp1, comp2],
    projectTimeline: {
      clips: [
        {
          id: 'ptc_1',
          compositionId: comp1.id,
          startFrame: 0,
          durationFrames: comp1.settings.durationFrames,
          inOffsetFrames: 0,
          transitionIn: 'cut',
          transitionDurationFrames: 0,
        },
        {
          id: 'ptc_2',
          compositionId: comp2.id,
          startFrame: 176,
          durationFrames: comp2.settings.durationFrames,
          inOffsetFrames: 0,
          transitionIn: 'crossDissolve',
          transitionDurationFrames: 16,
        },
      ],
      markers: [
        { id: 'pmk_1', frame: 0, label: 'Act I · Arrival', color: '#3B82F6' },
        { id: 'pmk_2', frame: 176, label: 'Act II · The Gate', color: '#10B981' },
      ],
    },
    exportSettings: {
      format: 'webm',
      quality: 0.92,
      includeAudio: true,
    },
  };
}

export function createBlankComposition(name: string, width = 1280, height = 720): CompositionRecord {
  return {
    id: uid('comp'),
    name,
    description: '',
    settings: {
      width,
      height,
      durationFrames: 144,
      inheritProjectFps: true,
      fps: { numerator: 24, denominator: 1 },
      workAreaStart: 0,
      workAreaEnd: 144,
    },
    camera: {
      x: 0,
      y: 0,
      zoom: 1,
      rotation: 0,
      parallaxStrength: 1,
      keyframes: { x: [], y: [], zoom: [] },
      modifiers: [],
    },
    environment: {
      presetId: 'twilight',
      skyTopColor: '#0F172A',
      skyBottomColor: '#1E293B',
      hazeColor: '#94A3B8',
      hazeIntensity: 0.12,
      weatherType: 'none',
      weatherDensity: 0.3,
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
    },
    layers: [],
    audioTracks: [],
    markers: [],
  };
}

export function createBlankProject(
  name: string,
  options?: { width?: number; height?: number; fps?: number }
): MotionProject {
  const now = new Date().toISOString();
  const width = options?.width ?? 1280;
  const height = options?.height ?? 720;
  const fps = options?.fps ?? 24;
  const comp = createBlankComposition('01 - Main Composition', width, height);
  comp.settings.fps = { numerator: fps, denominator: 1 };
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: uid('proj'),
    name,
    description: '',
    createdAt: now,
    updatedAt: now,
    settings: {
      fps: { numerator: fps, denominator: 1 },
      defaultWidth: width,
      defaultHeight: height,
    },
    assets: [],
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
      markers: [],
    },
    exportSettings: {
      format: 'webm',
      quality: 0.92,
      includeAudio: true,
    },
  };
}
