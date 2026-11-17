import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { EnvironmentDocument, WeatherType } from '../schema/projectSchema';
import type { ViewportTransform } from './IRendererAdapter';

export type ActiveWeatherType = Exclude<WeatherType, 'none'>;

export interface ParticleSample {
  id: number;
  kind: ActiveWeatherType;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
  tint: number;
  blendMode: 'normal' | 'add';
}

export interface SpritePoolStats {
  activeCount: number;
  idleCount: number;
  totalAllocated: number;
  maxCapacity: number;
}

/**
 * Generic pre-allocated pool for PixiJS Sprite instances (or compatible renderables).
 * Eliminates per-frame GC allocation/destruction when particle density changes.
 */
export class SpritePool<T extends { visible: boolean }> {
  private idle: T[] = [];
  private active: T[] = [];
  private readonly factory: () => T;
  private readonly resetFn?: (item: T) => void;
  private readonly maxCapacity: number;

  constructor(options: {
    initialSize?: number;
    maxCapacity?: number;
    factory: () => T;
    reset?: (item: T) => void;
  }) {
    this.factory = options.factory;
    this.resetFn = options.reset;
    this.maxCapacity = Math.max(1, options.maxCapacity ?? 320);

    const warmup = Math.min(this.maxCapacity, Math.max(0, options.initialSize ?? 0));
    for (let i = 0; i < warmup; i++) {
      const item = this.factory();
      item.visible = false;
      this.idle.push(item);
    }
  }

  public acquire(): T | null {
    let item = this.idle.pop();
    if (!item) {
      if (this.active.length + this.idle.length >= this.maxCapacity) {
        return null;
      }
      item = this.factory();
    }
    this.resetFn?.(item);
    item.visible = true;
    this.active.push(item);
    return item;
  }

  public release(item: T): boolean {
    const idx = this.active.indexOf(item);
    if (idx < 0) return false;
    this.active.splice(idx, 1);
    item.visible = false;
    this.idle.push(item);
    return true;
  }

  public releaseAll(): void {
    while (this.active.length > 0) {
      const item = this.active.pop()!;
      item.visible = false;
      this.idle.push(item);
    }
  }

  public getActiveItems(): readonly T[] {
    return this.active;
  }

  public getStats(): SpritePoolStats {
    return {
      activeCount: this.active.length,
      idleCount: this.idle.length,
      totalAllocated: this.active.length + this.idle.length,
      maxCapacity: this.maxCapacity,
    };
  }

  public clear(onDestroy?: (item: T) => void): void {
    for (const item of this.active) {
      item.visible = false;
      onDestroy?.(item);
    }
    for (const item of this.idle) {
      item.visible = false;
      onDestroy?.(item);
    }
    this.active = [];
    this.idle = [];
  }
}

function seededRand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Computes deterministic, loop-capable particle transforms for Rain, Snow,
 * Floating Dust, Fireflies, and Falling Leaves at any timeline frame.
 */
export function computeEnvironmentParticles(
  env: EnvironmentDocument,
  compW: number,
  compH: number,
  frame: number,
  quality: 'full' | 'reduced' = 'full'
): ParticleSample[] {
  const type = env.weatherType;
  const density = Math.max(0, Math.min(1, env.weatherDensity ?? 0));
  if (type === 'none' || density <= 0.001 || compW <= 0 || compH <= 0) {
    return [];
  }

  const loopFrames = Math.max(24, env.weatherLoopFrames ?? 240);
  const effFrame = ((frame % loopFrames) + loopFrames) % loopFrames;
  const maxParticles = quality === 'reduced' ? 75 : 165;
  const count = Math.max(1, Math.round(density * maxParticles));
  const speedMult = env.weatherSpeed ?? 1;
  const sizeMult = env.weatherSize ?? 1;
  const opacityMult = Math.max(0, Math.min(1, env.weatherOpacity ?? 0.85));
  const dirRad = ((env.weatherDirectionDeg ?? 15) * Math.PI) / 180;
  const dirX = Math.sin(dirRad);
  const loopPhase = (effFrame / loopFrames) * Math.PI * 2;

  const samples: ParticleSample[] = [];
  for (let i = 0; i < count; i++) {
    const baseX = seededRand(i * 1.7 + 3) * compW;
    const baseY = seededRand(i * 2.3 + 9) * compH;
    const depthFactor = 0.55 + seededRand(i * 3.9 + 1) * 0.75;
    const speed = (0.65 + seededRand(i * 4.1) * 1.05) * speedMult;

    if (type === 'rain') {
      const px = (((baseX + effFrame * 14 * dirX * speed) % compW) + compW) % compW;
      const py = (baseY + effFrame * 19 * speed) % compH;
      const stretch = sizeMult * depthFactor;
      samples.push({
        id: i,
        kind: 'rain',
        x: px,
        y: py,
        scaleX: 0.75 * stretch,
        scaleY: 1.05 * stretch,
        rotation: -dirRad,
        alpha: (0.36 + seededRand(i * 5.3) * 0.34) * opacityMult,
        tint: 0xbae6fd,
        blendMode: 'normal',
      });
    } else if (type === 'snow') {
      const sway = Math.sin(loopPhase * 2 + i * 1.1) * 20 * depthFactor;
      const px = (((baseX + sway + effFrame * 2.1 * dirX * speed) % compW) + compW) % compW;
      const py = (baseY + effFrame * 3.1 * speed * depthFactor) % compH;
      const radiusScale = (0.45 + seededRand(i * 5.7) * 0.75) * sizeMult * depthFactor;
      samples.push({
        id: i,
        kind: 'snow',
        x: px,
        y: py,
        scaleX: radiusScale,
        scaleY: radiusScale,
        rotation: 0,
        alpha: (0.48 + seededRand(i * 7.1) * 0.4) * opacityMult,
        tint: 0xf8fafc,
        blendMode: 'normal',
      });
    } else if (type === 'dust') {
      const windDrift = effFrame * 1.15 * speed * (dirX >= 0 ? 1 : -1) * depthFactor;
      const floatX = Math.cos(loopPhase + i * 1.4) * 14 * depthFactor;
      const floatY = Math.sin(loopPhase + i * 0.9) * 16 * depthFactor;
      const px = (((baseX + windDrift + floatX) % compW) + compW) % compW;
      const py = (((baseY + floatY - effFrame * 0.35 * speed) % compH) + compH) % compH;
      const shimmer = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(loopPhase * 2 + i * 2.3));
      const dustScale = (0.35 + seededRand(i * 6.1) * 0.55) * sizeMult;
      samples.push({
        id: i,
        kind: 'dust',
        x: px,
        y: py,
        scaleX: dustScale,
        scaleY: dustScale,
        rotation: 0,
        alpha: (0.18 + shimmer * 0.32) * opacityMult,
        tint: i % 4 === 0 ? 0xfef3c7 : 0xf8fafc,
        blendMode: 'normal',
      });
    } else if (type === 'fireflies') {
      const px = (((baseX + Math.sin(loopPhase * 2 + i) * 34 * speedMult) % compW) + compW) % compW;
      const py = (((baseY + Math.cos(loopPhase * 2 + i * 2) * 24 * speedMult) % compH) + compH) % compH;
      const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(loopPhase * 3 + i * 1.9));
      const glowScale = (0.5 + pulse * 0.55) * sizeMult;
      samples.push({
        id: i,
        kind: 'fireflies',
        x: px,
        y: py,
        scaleX: glowScale,
        scaleY: glowScale,
        rotation: 0,
        alpha: pulse * 0.9 * opacityMult,
        tint: 0xfde047,
        blendMode: 'add',
      });
    } else if (type === 'leaves') {
      const px =
        (((baseX + effFrame * (2.6 * dirX + 1.1) * speed + Math.sin(loopPhase * 2 + i) * 22) %
          compW) +
          compW) %
        compW;
      const py = (baseY + effFrame * 2.8 * speed) % compH;
      const leafScale = (0.65 + seededRand(i * 6.3) * 0.55) * sizeMult;
      const tint = i % 3 === 0 ? 0xf59e0b : i % 3 === 1 ? 0xea580c : 0xfbbf24;
      samples.push({
        id: i,
        kind: 'leaves',
        x: px,
        y: py,
        scaleX: leafScale,
        scaleY: leafScale,
        rotation: effFrame * 0.08 * speed + i,
        alpha: 0.84 * opacityMult,
        tint,
        blendMode: 'normal',
      });
    }
  }
  return samples;
}

function createProceduralParticleTextures(): Record<ActiveWeatherType, Texture> {
  const makeCanvasTexture = (
    w: number,
    h: number,
    draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  ): Texture => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      draw(ctx, w, h);
    }
    return Texture.from(canvas);
  };

  // Rain: soft vertical streak
  const rain = makeCanvasTexture(8, 36, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w / 2, 2);
    ctx.lineTo(w / 2, h - 2);
    ctx.stroke();
  });

  // Snow: soft radial flake
  const snow = makeCanvasTexture(20, 20, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, cx - 1);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, cx - 1, 0, Math.PI * 2);
    ctx.fill();
  });

  // Floating Dust: delicate bokeh mote
  const dust = makeCanvasTexture(16, 16, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0.5, cx, cy, cx - 1);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, cx - 1, 0, Math.PI * 2);
    ctx.fill();
  });

  // Fireflies: radiant orb
  const fireflies = makeCanvasTexture(28, 28, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, cx - 1);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, cx - 1, 0, Math.PI * 2);
    ctx.fill();
  });

  // Leaves / Petals: organic curved ellipse
  const leaves = makeCanvasTexture(20, 14, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2 - 2, h / 2 - 2, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  return { rain, snow, dust, fireflies, leaves };
}

export interface PixiEnvironmentUpdateParams {
  width: number;
  height: number;
  compW: number;
  compH: number;
  frame: number;
  env: EnvironmentDocument;
  viewport: ViewportTransform;
  quality: 'full' | 'reduced';
}

/**
 * PixiJS v8 environment particle stage controller using a pre-warmed SpritePool.
 * Renders Rain, Snow, Floating Dust, Fireflies, and Leaves over the composition viewport.
 */
export class PixiEnvironmentEffectsSystem {
  private app: Application | null = null;
  private worldContainer: Container | null = null;
  private maskGraphics: Graphics | null = null;
  private textures: Record<ActiveWeatherType, Texture> | null = null;
  private pool: SpritePool<Sprite> | null = null;
  private mountedHost: HTMLElement | null = null;
  private disposed = false;
  private ready = false;
  private lastCompW = 0;
  private lastCompH = 0;

  public isReady(): boolean {
    return this.ready && !this.disposed;
  }

  public getPoolStats(): SpritePoolStats | null {
    return this.pool?.getStats() ?? null;
  }

  public async mount(hostEl: HTMLElement): Promise<boolean> {
    if (this.disposed) return false;
    this.mountedHost = hostEl;

    try {
      const app = new Application();
      await app.init({
        width: Math.max(1, hostEl.clientWidth),
        height: Math.max(1, hostEl.clientHeight),
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
        preference: 'webgl',
        autoStart: false,
      });

      if (this.disposed) {
        app.destroy(true);
        return false;
      }

      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      app.canvas.style.display = 'block';
      app.canvas.style.pointerEvents = 'none';
      hostEl.appendChild(app.canvas);

      const textures = createProceduralParticleTextures();
      const worldContainer = new Container();
      const maskGraphics = new Graphics();
      worldContainer.addChild(maskGraphics);
      worldContainer.mask = maskGraphics;
      app.stage.addChild(worldContainer);

      const pool = new SpritePool<Sprite>({
        initialSize: 180,
        maxCapacity: 300,
        factory: () => {
          const sprite = new Sprite(textures.dust);
          sprite.anchor.set(0.5);
          sprite.visible = false;
          worldContainer.addChild(sprite);
          return sprite;
        },
        reset: (sprite) => {
          sprite.alpha = 1;
          sprite.rotation = 0;
          sprite.tint = 0xffffff;
          sprite.blendMode = 'normal';
        },
      });

      this.app = app;
      this.worldContainer = worldContainer;
      this.maskGraphics = maskGraphics;
      this.textures = textures;
      this.pool = pool;
      this.ready = true;
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  public update(params: PixiEnvironmentUpdateParams): void {
    if (!this.ready || !this.app || !this.worldContainer || !this.maskGraphics || !this.textures || !this.pool) {
      return;
    }

    const { width, height, compW, compH, frame, env, viewport, quality } = params;
    if (width <= 0 || height <= 0) return;

    if (this.app.renderer.width !== width || this.app.renderer.height !== height) {
      this.app.renderer.resize(width, height);
    }

    if (this.lastCompW !== compW || this.lastCompH !== compH) {
      this.maskGraphics.clear();
      this.maskGraphics.rect(0, 0, compW, compH).fill(0xffffff);
      this.lastCompW = compW;
      this.lastCompH = compH;
    }

    this.worldContainer.position.set(
      width / 2 + viewport.panX - (compW * viewport.zoom) / 2,
      height / 2 + viewport.panY - (compH * viewport.zoom) / 2
    );
    this.worldContainer.scale.set(viewport.zoom);

    this.pool.releaseAll();

    const samples = computeEnvironmentParticles(env, compW, compH, frame, quality);
    for (const sample of samples) {
      const sprite = this.pool.acquire();
      if (!sprite) break;
      sprite.texture = this.textures[sample.kind];
      sprite.position.set(sample.x, sample.y);
      sprite.scale.set(sample.scaleX, sample.scaleY);
      sprite.rotation = sample.rotation;
      sprite.alpha = sample.alpha;
      sprite.tint = sample.tint;
      sprite.blendMode = sample.blendMode;
    }

    this.app.renderer.render(this.app.stage);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;

    this.pool?.clear((sprite) => sprite.destroy());
    this.pool = null;

    if (this.textures) {
      Object.values(this.textures).forEach((tex) => tex.destroy(true));
      this.textures = null;
    }

    this.maskGraphics?.destroy();
    this.maskGraphics = null;
    this.worldContainer?.destroy({ children: false });
    this.worldContainer = null;

    if (this.app) {
      if (this.app.canvas.parentElement === this.mountedHost) {
        this.mountedHost?.removeChild(this.app.canvas);
      }
      this.app.destroy(true);
      this.app = null;
    }
    this.mountedHost = null;
  }
}
