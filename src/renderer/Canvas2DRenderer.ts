import {
  EvaluatedCompositionState,
  EvaluatedLayer,
  EvaluatedObject,
} from '../engine/evaluator';
import { computeLayerMotionPath, MotionPathDragOverride } from '../engine/motionPath';
import { BlendMode, FrameRect, MotionProject } from '../schema/projectSchema';
import { IRendererAdapter, RendererCapabilities, RenderOptions } from './IRendererAdapter';

function mapBlendMode(mode: BlendMode): GlobalCompositeOperation {
  switch (mode) {
    case 'normal':
      return 'source-over';
    case 'multiply':
      return 'multiply';
    case 'screen':
      return 'screen';
    case 'overlay':
      return 'overlay';
    case 'add':
      return 'lighter';
    case 'darken':
      return 'darken';
    case 'lighten':
      return 'lighten';
  }
}

function seededRand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export class Canvas2DRenderer implements IRendererAdapter {
  private imageCache = new Map<string, HTMLImageElement>();
  private loadingImages = new Set<string>();
  private offscreenCompPool = new Map<string, HTMLCanvasElement>();
  private onAssetDecoded?: () => void;

  constructor(onAssetDecoded?: () => void) {
    this.onAssetDecoded = onAssetDecoded;
  }

  getCapabilities(): RendererCapabilities {
    return {
      name: 'Canvas2DRenderer',
      supportedBlendModes: ['normal', 'multiply', 'screen', 'overlay', 'add', 'darken', 'lighten'],
      supportsFilters: true,
      supportsOffscreenCapture: true,
    };
  }

  private getImage(dataUrl: string): HTMLImageElement | null {
    if (!dataUrl) return null;
    const cached = this.imageCache.get(dataUrl);
    if (cached && cached.complete && cached.naturalWidth > 0) {
      return cached;
    }
    if (!this.loadingImages.has(dataUrl)) {
      this.loadingImages.add(dataUrl);
      const img = new Image();
      img.onload = () => {
        this.imageCache.set(dataUrl, img);
        this.loadingImages.delete(dataUrl);
        this.onAssetDecoded?.();
      };
      img.onerror = () => {
        this.loadingImages.delete(dataUrl);
      };
      img.src = dataUrl;
    }
    return null;
  }

  renderComposition(
    target: HTMLCanvasElement,
    project: MotionProject,
    state: EvaluatedCompositionState,
    options: RenderOptions
  ): void {
    const ctx = target.getContext('2d');
    if (!ctx) return;

    const quality = options.quality ?? 'full';
    const dpr = quality === 'reduced' ? 1 : window.devicePixelRatio || 1;
    const displayW = target.clientWidth || target.width;
    const displayH = target.clientHeight || target.height;
    if (target.width !== Math.round(displayW * dpr) || target.height !== Math.round(displayH * dpr)) {
      target.width = Math.round(displayW * dpr);
      target.height = Math.round(displayH * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // Stage surround background
    ctx.fillStyle = '#0D0F12';
    ctx.fillRect(0, 0, displayW, displayH);

    const compW = state.composition.settings.width;
    const compH = state.composition.settings.height;
    const { panX, panY, zoom } = options.viewport;

    ctx.translate(displayW / 2 + panX, displayH / 2 + panY);
    ctx.scale(zoom, zoom);
    ctx.translate(-compW / 2, -compH / 2);

    // Composition clipping region
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, compW, compH);
    ctx.clip();

    this.drawCompositionInternals(
      ctx,
      project,
      state,
      options.isExport ? 'full' : quality,
      Boolean(options.skipWeatherParticles && !options.isExport)
    );

    ctx.restore();

    // Composition border & safe guides
    if (!options.isExport) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1.5 / zoom;
      ctx.strokeRect(0, 0, compW, compH);

      if (options.showGuides) {
        ctx.save();
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.28)';
        ctx.setLineDash([6 / zoom, 6 / zoom]);
        ctx.lineWidth = 1 / zoom;
        // Action-safe 90%
        ctx.strokeRect(compW * 0.05, compH * 0.05, compW * 0.9, compH * 0.9);
        // Center crosshair
        ctx.beginPath();
        ctx.moveTo(compW / 2, 0);
        ctx.lineTo(compW / 2, compH);
        ctx.moveTo(0, compH / 2);
        ctx.lineTo(compW, compH / 2);
        ctx.stroke();
        ctx.restore();
      }

      // Draw motion path & interactive selection gizmo for selected layer
      if (options.selectedLayerId) {
        if (options.showMotionPath !== false) {
          this.drawMotionPath(
            ctx,
            project,
            state,
            options.selectedLayerId,
            zoom,
            options.motionPathOverride
          );
        }
        const selLayer = state.layers.find((l) => l.layer.id === options.selectedLayerId);
        if (selLayer && selLayer.objects.length > 0) {
          this.drawSelectionGizmo(ctx, project, state, selLayer, zoom);
        }
      }
    }

    ctx.restore();
  }

  renderCompositionToImageData(
    project: MotionProject,
    state: EvaluatedCompositionState,
    width: number,
    height: number
  ): HTMLCanvasElement {
    let off = this.offscreenCompPool.get('__export__');
    if (!off) {
      off = document.createElement('canvas');
      this.offscreenCompPool.set('__export__', off);
    }
    if (off.width !== width || off.height !== height) {
      off.width = width;
      off.height = height;
    }
    const ctx = off.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.scale(width / state.composition.settings.width, height / state.composition.settings.height);
      this.drawCompositionInternals(ctx, project, state, 'full');
      ctx.restore();
    }
    return off;
  }

  drawCompositionInternals(
    ctx: CanvasRenderingContext2D,
    project: MotionProject,
    state: EvaluatedCompositionState,
    quality: 'full' | 'reduced' = 'full',
    skipWeatherParticles = false
  ): void {
    const compW = state.composition.settings.width;
    const compH = state.composition.settings.height;
    const env = state.composition.environment;

    // 1. Sky / Environment backdrop
    if (env.skyTopColor !== 'transparent') {
      const grad = ctx.createLinearGradient(0, 0, 0, compH);
      grad.addColorStop(0, env.skyTopColor);
      grad.addColorStop(1, env.skyBottomColor);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, compW, compH);
    }

    // 1b. Moving sky clouds overlay (behind scene layers)
    if ((env.cloudDensity ?? 0) > 0.01) {
      this.drawClouds(ctx, compW, compH, state.frame, env, quality);
    }

    // 2. Apply Camera transform around composition center
    ctx.save();
    ctx.translate(compW / 2, compH / 2);
    ctx.scale(state.camera.zoom, state.camera.zoom);
    ctx.rotate(state.camera.rotation);
    ctx.translate(-compW / 2 - state.camera.x, -compH / 2 - state.camera.y);

    // 3. Draw layers bottom-to-top
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const evalLayer = state.layers[i];
      if (!evalLayer.visibleAtFrame || evalLayer.effectiveOpacity <= 0.001) continue;

      ctx.save();
      ctx.globalAlpha = evalLayer.effectiveOpacity;
      ctx.globalCompositeOperation = mapBlendMode(evalLayer.layer.blendMode);
      ctx.translate(evalLayer.parallaxOffsetX, evalLayer.parallaxOffsetY);

      for (const evalObj of evalLayer.objects) {
        this.drawObject(ctx, project, state, evalObj, quality);
      }
      ctx.restore();
    }

    ctx.restore();

    // 4. Atmosphere haze
    if (env.hazeIntensity > 0) {
      const hazeGrad = ctx.createLinearGradient(0, compH * 0.35, 0, compH);
      hazeGrad.addColorStop(0, 'rgba(0,0,0,0)');
      hazeGrad.addColorStop(1, env.hazeColor);
      ctx.save();
      ctx.globalAlpha = env.hazeIntensity * 0.65;
      ctx.fillStyle = hazeGrad;
      ctx.fillRect(0, 0, compW, compH);
      ctx.restore();
    }

    // 4b. Rolling fog overlay
    if ((env.fogOpacity ?? 0) > 0.01) {
      this.drawFogOverlay(ctx, compW, compH, state.frame, env);
    }

    // 5. Wind-blown grass silhouette along bottom edge
    if ((env.grassDensity ?? 0) > 0.01) {
      this.drawWindGrass(ctx, compW, compH, state.frame, env, quality);
    }

    // 6. Deterministic weather particle overlay (skipped on live stage when PixiJS particle pool is active)
    if (!skipWeatherParticles && env.weatherType !== 'none' && env.weatherDensity > 0) {
      this.drawWeather(ctx, compW, compH, state.frame, env, quality);
    }

    // 7. Time-of-day color tint
    if (env.tintOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = env.tintOpacity;
      ctx.fillStyle = env.timeOfDayTint;
      ctx.fillRect(0, 0, compW, compH);
      ctx.restore();
    }
  }

  private drawClouds(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    frame: number,
    env: EvaluatedCompositionState['composition']['environment'],
    quality: 'full' | 'reduced'
  ) {
    const count = Math.max(2, Math.round((env.cloudDensity ?? 0) * (quality === 'reduced' ? 6 : 12)));
    const windSign = env.windDirection === 'left' ? -1 : 1;
    const speed = (env.cloudSpeed ?? 1) * windSign * 1.1;
    ctx.save();
    for (let i = 0; i < count; i++) {
      const cw = (160 + seededRand(i * 3.1) * 220);
      const ch = cw * 0.32;
      const baseX = seededRand(i * 7.3) * (w + cw * 2);
      const cy = h * (0.08 + seededRand(i * 5.9) * 0.34);
      const wrapW = w + cw * 2;
      const cx = (((baseX + frame * speed * (0.5 + seededRand(i * 2.1) * 0.7)) % wrapW) + wrapW) % wrapW - cw;

      ctx.fillStyle = 'rgba(226, 232, 240, 0.14)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw * 0.45, ch * 0.5, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - cw * 0.24, cy + ch * 0.1, cw * 0.3, ch * 0.38, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + cw * 0.26, cy + ch * 0.12, cw * 0.32, ch * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFogOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    frame: number,
    env: EvaluatedCompositionState['composition']['environment']
  ) {
    const opacity = env.fogOpacity ?? 0;
    const speed = (env.fogSpeed ?? 1) * (env.windDirection === 'left' ? -1 : 1);
    const color = env.fogColor ?? '#CBD5E1';
    ctx.save();
    for (let band = 0; band < 3; band++) {
      const bandY = h * (0.52 + band * 0.16);
      const bandH = h * (0.28 + band * 0.08);
      const shift = Math.sin(frame * 0.015 * speed + band * 2.1) * (w * 0.12);
      const grad = ctx.createLinearGradient(0, bandY - bandH * 0.5, 0, bandY + bandH * 0.5);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.5, color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = opacity * (0.22 + band * 0.08);
      ctx.fillStyle = grad;
      ctx.fillRect(-w * 0.15 + shift, bandY - bandH * 0.5, w * 1.3, bandH);
    }
    ctx.restore();
  }

  private drawWindGrass(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    frame: number,
    env: EvaluatedCompositionState['composition']['environment'],
    quality: 'full' | 'reduced'
  ) {
    const count = Math.round((env.grassDensity ?? 0) * (quality === 'reduced' ? 45 : 95));
    const windSign = env.windDirection === 'left' ? -1 : 1;
    const speed = env.grassWindSpeed ?? 1;
    const strength = env.windStrength ?? 1;
    ctx.save();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.82)';
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const gx = seededRand(i * 4.7 + 1) * w;
      const gh = 28 + seededRand(i * 2.9 + 5) * 44;
      const sway =
        Math.sin(frame * 0.085 * speed + i * 0.55) * 10 * strength +
        windSign * 10 * strength;
      ctx.lineWidth = 1.6 + seededRand(i * 1.3) * 1.8;
      ctx.beginPath();
      ctx.moveTo(gx, h + 2);
      ctx.quadraticCurveTo(gx + sway * 0.45, h - gh * 0.55, gx + sway, h - gh);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawWeather(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    frame: number,
    env: EvaluatedCompositionState['composition']['environment'],
    quality: 'full' | 'reduced'
  ) {
    const density = env.weatherDensity ?? 0.45;
    const type = env.weatherType;
    const loopFrames = Math.max(24, env.weatherLoopFrames ?? 240);
    const effFrame = frame % loopFrames;
    const count = Math.round(density * (quality === 'reduced' ? 45 : 95));
    const speedMult = env.weatherSpeed ?? 1;
    const sizeMult = env.weatherSize ?? 1;
    const opacityMult = env.weatherOpacity ?? 0.85;
    const dirRad = ((env.weatherDirectionDeg ?? 15) * Math.PI) / 180;
    const dirX = Math.sin(dirRad);

    ctx.save();
    ctx.globalAlpha *= opacityMult;

    for (let i = 0; i < count; i++) {
      const baseX = seededRand(i * 1.7 + 3) * w;
      const baseY = seededRand(i * 2.3 + 9) * h;
      const speed = (0.6 + seededRand(i * 4.1) * 1.1) * speedMult;

      if (type === 'rain') {
        const px = (((baseX + effFrame * 14 * dirX * speed) % w) + w) % w;
        const py = (baseY + effFrame * 18 * speed) % h;
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.52)';
        ctx.lineWidth = 1.3 * sizeMult;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + dirX * 14 * sizeMult, py + 18 * sizeMult);
        ctx.stroke();
      } else if (type === 'snow') {
        const px =
          (((baseX + Math.sin((effFrame / loopFrames) * Math.PI * 2 * 2 + i) * 18 + effFrame * 2.2 * dirX * speed) %
            w) +
            w) %
          w;
        const py = (baseY + effFrame * 3.2 * speed) % h;
        const r = (1.5 + seededRand(i * 5.7) * 2.6) * sizeMult;
        ctx.fillStyle = 'rgba(248, 250, 252, 0.78)';
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (type === 'fireflies') {
        const phase = (effFrame / loopFrames) * Math.PI * 2;
        const px = (((baseX + Math.sin(phase * 2 + i) * 34 * speedMult) % w) + w) % w;
        const py = (((baseY + Math.cos(phase * 2 + i * 2) * 24 * speedMult) % h) + h) % h;
        const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(phase * 3 + i * 1.9));
        ctx.fillStyle = `rgba(253, 224, 71, ${pulse * 0.85})`;
        ctx.beginPath();
        ctx.arc(px, py, (2.4 + pulse * 2.2) * sizeMult, 0, Math.PI * 2);
        ctx.fill();
      } else if (type === 'dust') {
        const px = (((baseX + effFrame * 1.2 * speed * (dirX >= 0 ? 1 : -1)) % w) + w) % w;
        const py = (((baseY + Math.sin(effFrame * 0.04 + i) * 12) % h) + h) % h;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.beginPath();
        ctx.arc(px, py, 1.6 * sizeMult, 0, Math.PI * 2);
        ctx.fill();
      } else if (type === 'leaves') {
        const px =
          (((baseX + effFrame * (2.6 * dirX + 1.1) * speed + Math.sin(effFrame * 0.07 + i) * 22) %
            w) +
            w) %
          w;
        const py = (baseY + effFrame * 2.8 * speed) % h;
        const rot = effFrame * 0.08 * speed + i;
        const lw = (5.5 + seededRand(i * 6.3) * 4) * sizeMult;
        const lh = lw * 0.55;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(rot);
        ctx.fillStyle = i % 3 === 0 ? 'rgba(245, 158, 11, 0.82)' : i % 3 === 1 ? 'rgba(234, 88, 12, 0.82)' : 'rgba(251, 191, 36, 0.78)';
        ctx.beginPath();
        ctx.ellipse(0, 0, lw, lh, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private drawImageWithMeshDeform(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    deform: EvaluatedObject['meshDeform'],
    quality: 'full' | 'reduced'
  ) {
    if (!deform || Math.abs(deform.amplitude) < 0.15) {
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      return;
    }

    const strips = quality === 'reduced' ? 8 : 14;
    const isHorizontalEdge = deform.anchorEdge === 'top' || deform.anchorEdge === 'bottom';

    for (let i = 0; i < strips; i++) {
      const frac0 = i / strips;
      const frac1 = (i + 1) / strips;
      // Distance from anchored edge (0 at anchor, 1 at free tip)
      let tipDist = frac0 + 0.5 / strips;
      if (deform.anchorEdge === 'bottom' || deform.anchorEdge === 'right') {
        tipDist = 1 - tipDist;
      }
      const weight = tipDist * tipDist;
      const wave = Math.sin(tipDist * deform.frequency * Math.PI * 2 - deform.phase);
      const offset = wave * deform.amplitude * weight;

      if (isHorizontalEdge) {
        const sStripY = sy + frac0 * sh;
        const sStripH = (frac1 - frac0) * sh;
        const dStripY = dy + frac0 * dh;
        const dStripH = (frac1 - frac0) * dh + 0.75; // 0.75px overlap prevents hairlines
        const ox = deform.axis === 'x' ? offset : 0;
        const oy = deform.axis === 'y' ? offset : 0;
        ctx.drawImage(img, sx, sStripY, sw, sStripH, dx + ox, dStripY + oy, dw, dStripH);
      } else {
        const sStripX = sx + frac0 * sw;
        const sStripW = (frac1 - frac0) * sw;
        const dStripX = dx + frac0 * dw;
        const dStripW = (frac1 - frac0) * dw + 0.75;
        const ox = deform.axis === 'x' ? offset : 0;
        const oy = deform.axis === 'y' ? offset : 0;
        ctx.drawImage(img, sStripX, sy, sStripW, sh, dStripX + ox, dy + oy, dStripW, dh);
      }
    }
  }

  private drawObject(
    ctx: CanvasRenderingContext2D,
    project: MotionProject,
    _state: EvaluatedCompositionState,
    evalObj: EvaluatedObject,
    quality: 'full' | 'reduced' = 'full'
  ): void {
    const { object, worldTransform } = evalObj;
    ctx.save();
    ctx.translate(worldTransform.x, worldTransform.y);
    ctx.rotate(worldTransform.rotation);
    ctx.scale(worldTransform.scaleX, worldTransform.scaleY);
    ctx.translate(-worldTransform.pivotX, -worldTransform.pivotY);

    if (object.kind === 'sprite') {
      const asset = project.assets.find((a) => a.id === object.assetId);
      const img = asset ? this.getImage(asset.dataUrl) : null;
      if (img) {
        const w = object.width;
        const h = object.height;
        const cr = object.cropRect;
        const sx = cr ? cr.x : 0;
        const sy = cr ? cr.y : 0;
        const sw = cr ? cr.w : img.naturalWidth || w;
        const sh = cr ? cr.h : img.naturalHeight || h;
        this.drawImageWithMeshDeform(
          ctx,
          img,
          sx,
          sy,
          sw,
          sh,
          -w / 2,
          -h / 2,
          w,
          h,
          evalObj.meshDeform,
          quality
        );
      } else {
        this.drawMissingAssetBox(ctx, object.width, object.height, asset ? 'Loading...' : 'Missing Asset');
      }
    } else if (object.kind === 'character') {
      const charDef = project.characters.find((c) => c.id === object.characterId);
      const frameIdx = evalObj.characterFrameIndex ?? 0;

      if (charDef) {
        if (object.flipX) ctx.scale(-1, 1);

        if (charDef.mode === 'sequence' && charDef.sequenceAssetIds.length > 0) {
          const seqAssetId = charDef.sequenceAssetIds[frameIdx] ?? charDef.sequenceAssetIds[0];
          const asset = project.assets.find((a) => a.id === seqAssetId);
          const img = asset ? this.getImage(asset.dataUrl) : null;
          if (img) {
            this.drawImageWithMeshDeform(
              ctx,
              img,
              0,
              0,
              img.naturalWidth || object.width,
              img.naturalHeight || object.height,
              -object.width / 2,
              -object.height / 2,
              object.width,
              object.height,
              evalObj.meshDeform,
              quality
            );
          } else {
            this.drawMissingAssetBox(ctx, object.width, object.height, charDef.name);
          }
        } else {
          const sheetAsset = project.assets.find((a) => a.id === charDef.assetId);
          const img = sheetAsset ? this.getImage(sheetAsset.dataUrl) : null;
          const rect: FrameRect | undefined = charDef.frames[frameIdx] ?? charDef.frames[0];
          if (img && rect) {
            this.drawImageWithMeshDeform(
              ctx,
              img,
              rect.x,
              rect.y,
              rect.w,
              rect.h,
              -object.width / 2,
              -object.height / 2,
              object.width,
              object.height,
              evalObj.meshDeform,
              quality
            );
          } else {
            this.drawMissingAssetBox(ctx, object.width, object.height, charDef.name);
          }
        }
      }
    } else if (object.kind === 'shape') {
      const w = object.width;
      const h = object.height;
      ctx.beginPath();
      if (object.shapeType === 'rect') {
        const r = Math.min(object.cornerRadius, w / 2, h / 2);
        ctx.roundRect(-w / 2, -h / 2, w, h, r);
      } else if (object.shapeType === 'ellipse') {
        ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      } else if (object.shapeType === 'polygon') {
        const sides = 6;
        for (let s = 0; s < sides; s++) {
          const a = (s / sides) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * (w / 2);
          const py = Math.sin(a) * (h / 2);
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      } else if (object.shapeType === 'star') {
        const spikes = 5;
        for (let s = 0; s < spikes * 2; s++) {
          const r = s % 2 === 0 ? w / 2 : w / 4.2;
          const a = (s / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * (r * (h / w));
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      }

      if (object.fill && object.fill !== 'transparent') {
        ctx.fillStyle = object.fill;
        ctx.fill();
      }
      if (object.strokeWidth > 0 && object.stroke !== 'transparent') {
        ctx.strokeStyle = object.stroke;
        ctx.lineWidth = object.strokeWidth;
        ctx.stroke();
      }
    } else if (object.kind === 'text') {
      const lyr = evalObj.evaluatedLyrics;
      if (lyr) {
        if (lyr.opacityMultiplier <= 0.005 || !lyr.text) {
          ctx.restore();
          return;
        }
        ctx.globalAlpha *= lyr.opacityMultiplier;
        ctx.translate(0, lyr.offsetY);
        const totalScale = lyr.scaleMultiplier * lyr.beatScale;
        ctx.scale(totalScale, totalScale);

        if (quality !== 'reduced') {
          if (lyr.glowBlur > 0) {
            ctx.shadowColor = lyr.glowColor;
            ctx.shadowBlur = lyr.glowBlur;
          } else if (lyr.shadowBlur > 0) {
            ctx.shadowColor = lyr.shadowColor;
            ctx.shadowBlur = lyr.shadowBlur;
            ctx.shadowOffsetY = 2;
          }
        }

        ctx.font = `600 ${object.fontSize}px "${object.fontFamily}", sans-serif`;
        ctx.textBaseline = 'middle';

        if (lyr.style === 'karaoke' || lyr.style === 'stagger' || lyr.style === 'wordReveal') {
          const wordsToRender =
            lyr.style === 'wordReveal'
              ? lyr.words.slice(0, lyr.visibleWordCount)
              : lyr.words;
          const spaceW = ctx.measureText(' ').width;
          const wordWidths = wordsToRender.map((w) => ctx.measureText(w.text).width);
          const totalW =
            wordWidths.reduce((s, v) => s + v, 0) +
            Math.max(0, wordsToRender.length - 1) * spaceW;

          let cursorX =
            object.align === 'center'
              ? -totalW / 2
              : object.align === 'right'
                ? -totalW
                : 0;
          ctx.textAlign = 'left';

          wordsToRender.forEach((word, idx) => {
            const ww = wordWidths[idx];
            ctx.save();
            if (lyr.style === 'stagger') {
              const wordLocal = Math.max(0, lyr.localCueFrame - idx * lyr.staggerFrames);
              const t = Math.min(1, wordLocal / Math.max(2, lyr.staggerFrames * 2));
              ctx.globalAlpha *= t;
              ctx.translate(0, (1 - t) * 16);
            }

            if (lyr.style === 'karaoke') {
              // Base dim/default text
              ctx.fillStyle = word.isPassed ? lyr.highlightColor : object.color;
              ctx.fillText(word.text, cursorX, 0);

              if (word.isActive) {
                // Progressive left-to-right sweep highlight for currently sung word
                ctx.save();
                ctx.beginPath();
                ctx.rect(
                  cursorX - 2,
                  -object.fontSize,
                  (ww + 4) * word.progress,
                  object.fontSize * 2
                );
                ctx.clip();
                ctx.fillStyle = lyr.highlightColor;
                ctx.fillText(word.text, cursorX, 0);
                ctx.restore();
              }
            } else {
              ctx.fillStyle = word.isActive ? lyr.highlightColor : object.color;
              ctx.fillText(word.text, cursorX, 0);
            }
            ctx.restore();
            cursorX += ww + spaceW;
          });
        } else {
          ctx.fillStyle = object.color;
          ctx.textAlign = object.align;
          const displayText =
            lyr.style === 'typewriter' || lyr.style === 'charReveal'
              ? lyr.text.slice(0, lyr.visibleCharCount) +
                (lyr.style === 'typewriter' && lyr.visibleCharCount < lyr.text.length ? '_' : '')
              : lyr.text;
          const lines = displayText.split('\n');
          const lineHeight = object.fontSize * 1.2;
          const startY = -((lines.length - 1) * lineHeight) / 2;
          lines.forEach((line, idx) => {
            ctx.fillText(line, 0, startY + idx * lineHeight);
          });
        }
      } else {
        ctx.fillStyle = object.color;
        ctx.font = `600 ${object.fontSize}px "${object.fontFamily}", sans-serif`;
        ctx.textAlign = object.align;
        ctx.textBaseline = 'middle';
        const lines = object.text.split('\n');
        const lineHeight = object.fontSize * 1.2;
        const startY = -((lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, idx) => {
          ctx.fillText(line, 0, startY + idx * lineHeight);
        });
      }
    } else if (object.kind === 'nestedComposition' && evalObj.nestedComposition) {
      const childState = evalObj.nestedComposition;
      const cw = childState.composition.settings.width;
      const ch = childState.composition.settings.height;
      let buf = this.offscreenCompPool.get(childState.composition.id);
      if (!buf) {
        buf = document.createElement('canvas');
        this.offscreenCompPool.set(childState.composition.id, buf);
      }
      if (buf.width !== cw || buf.height !== ch) {
        buf.width = cw;
        buf.height = ch;
      }
      const bctx = buf.getContext('2d');
      if (bctx) {
        bctx.clearRect(0, 0, cw, ch);
        this.drawCompositionInternals(bctx, project, childState, quality);
        ctx.drawImage(buf, -cw / 2, -ch / 2, cw, ch);
      }
    }

    ctx.restore();
  }

  private drawMissingAssetBox(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    label: string
  ) {
    ctx.save();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
    ctx.lineWidth = 2;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = '#FCA5A5';
    ctx.font = '600 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  public getObjectDimensions(
    project: MotionProject,
    evalObj: EvaluatedObject
  ): { w: number; h: number } {
    const obj = evalObj.object;
    if (obj.kind === 'text') {
      const lines = obj.text.split('\n');
      const maxChars = Math.max(...lines.map((l) => l.length), 4);
      return {
        w: Math.max(80, maxChars * obj.fontSize * 0.58),
        h: Math.max(40, lines.length * obj.fontSize * 1.25),
      };
    }
    if (obj.kind === 'nestedComposition') {
      const child = project.compositions.find((c) => c.id === obj.compositionId);
      return {
        w: child?.settings.width ?? 1280,
        h: child?.settings.height ?? 720,
      };
    }
    return { w: obj.width, h: obj.height };
  }

  private drawSelectionGizmo(
    ctx: CanvasRenderingContext2D,
    project: MotionProject,
    state: EvaluatedCompositionState,
    evalLayer: EvaluatedLayer,
    zoom: number
  ) {
    const evalObj = evalLayer.objects[0];
    if (!evalObj) return;

    const { w, h } = this.getObjectDimensions(project, evalObj);
    const t = evalObj.worldTransform;
    const compW = state.composition.settings.width;
    const compH = state.composition.settings.height;

    ctx.save();
    ctx.translate(compW / 2, compH / 2);
    ctx.scale(state.camera.zoom, state.camera.zoom);
    ctx.rotate(state.camera.rotation);
    ctx.translate(-compW / 2 - state.camera.x, -compH / 2 - state.camera.y);
    ctx.translate(evalLayer.parallaxOffsetX, evalLayer.parallaxOffsetY);

    ctx.translate(t.x, t.y);
    ctx.rotate(t.rotation);
    ctx.scale(t.scaleX, t.scaleY);
    ctx.translate(-t.pivotX, -t.pivotY);

    const invScaleX = 1 / Math.max(0.05, Math.abs(t.scaleX) * zoom * state.camera.zoom);
    const invScaleY = 1 / Math.max(0.05, Math.abs(t.scaleY) * zoom * state.camera.zoom);

    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 2 * Math.max(invScaleX, invScaleY);
    ctx.strokeRect(-w / 2, -h / 2, w, h);

    // 4 Corner scale handles (sized generously for touch)
    const handleW = 12 * invScaleX;
    const handleH = 12 * invScaleY;
    const corners = [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ];
    ctx.fillStyle = '#FFFFFF';
    for (const [cx, cy] of corners) {
      ctx.fillRect(cx - handleW / 2, cy - handleH / 2, handleW, handleH);
      ctx.strokeRect(cx - handleW / 2, cy - handleH / 2, handleW, handleH);
    }

    // Rotation stem handle at top center
    const stemLen = 28 * invScaleY;
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(0, -h / 2 - stemLen);
    ctx.stroke();

    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.ellipse(0, -h / 2 - stemLen, 7 * invScaleX, 7 * invScaleY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  private drawMotionPath(
    ctx: CanvasRenderingContext2D,
    project: MotionProject,
    state: EvaluatedCompositionState,
    layerId: string,
    zoom: number,
    override?: MotionPathDragOverride | null
  ) {
    const path = computeLayerMotionPath(project, state.composition.id, layerId, override);
    if (!path || path.points.length < 2) return;

    const compW = state.composition.settings.width;
    const compH = state.composition.settings.height;
    const scale = Math.max(0.1, zoom * state.camera.zoom);
    const invScale = 1 / scale;

    ctx.save();
    ctx.translate(compW / 2, compH / 2);
    ctx.scale(state.camera.zoom, state.camera.zoom);
    ctx.rotate(state.camera.rotation);
    ctx.translate(-compW / 2 - state.camera.x, -compH / 2 - state.camera.y);

    // 1. Dark contrast backing stroke
    ctx.beginPath();
    path.points.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 3.6 * invScale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 2. Dashed sky-cyan motion arc
    ctx.save();
    ctx.setLineDash([6 * invScale, 4 * invScale]);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.92)';
    ctx.lineWidth = 1.8 * invScale;
    ctx.stroke();
    ctx.restore();

    // 3. Velocity timing dots (shows easing acceleration/deceleration along arc)
    ctx.fillStyle = 'rgba(186, 230, 253, 0.85)';
    for (const dot of path.velocityDots) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 2 * invScale, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Direction chevron near path midpoint
    const midIdx = Math.min(path.points.length - 2, Math.floor(path.points.length / 2));
    const p0 = path.points[midIdx];
    const p1 = path.points[midIdx + 1];
    const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (segLen > 1) {
      const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const arrowSize = 6 * invScale;
      ctx.save();
      ctx.translate(p0.x, p0.y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(arrowSize, 0);
      ctx.lineTo(-arrowSize * 0.65, -arrowSize * 0.65);
      ctx.lineTo(-arrowSize * 0.65, arrowSize * 0.65);
      ctx.closePath();
      ctx.fillStyle = '#38BDF8';
      ctx.fill();
      ctx.restore();
    }

    // 5. Interactive spatial keyframe diamond nodes + frame tags
    ctx.font = `600 ${Math.round(10 * invScale)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    for (const node of path.nodes) {
      const isCurrent = node.frame === state.frame;
      const r = (isCurrent ? 6.5 : 5) * invScale;

      ctx.save();
      ctx.translate(node.x, node.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = isCurrent ? '#FFFFFF' : '#F59E0B';
      ctx.strokeStyle = isCurrent ? '#F59E0B' : '#0D0F12';
      ctx.lineWidth = 1.6 * invScale;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.strokeRect(-r, -r, r * 2, r * 2);
      ctx.restore();

      const label = `F${node.frame}`;
      const labelY = node.y - 9 * invScale;
      ctx.lineWidth = 2.5 * invScale;
      ctx.strokeStyle = 'rgba(13, 15, 18, 0.88)';
      ctx.strokeText(label, node.x, labelY);
      ctx.fillStyle = isCurrent ? '#FDE68A' : '#E2E8F0';
      ctx.fillText(label, node.x, labelY);
    }

    ctx.restore();
  }

  hitTest(
    project: MotionProject,
    state: EvaluatedCompositionState,
    compPointX: number,
    compPointY: number
  ): string | null {
    const compW = state.composition.settings.width;
    const compH = state.composition.settings.height;

    // Convert composition space point into camera-local space
    const camX = (compPointX - compW / 2) / state.camera.zoom + compW / 2 + state.camera.x;
    const camY = (compPointY - compH / 2) / state.camera.zoom + compH / 2 + state.camera.y;

    // Iterate top-most layer first (index 0 = top)
    for (let i = 0; i < state.layers.length; i++) {
      const layer = state.layers[i];
      if (!layer.visibleAtFrame || layer.layer.locked) continue;
      const evalObj = layer.objects[0];
      if (!evalObj) continue;

      const lx = camX - layer.parallaxOffsetX;
      const ly = camY - layer.parallaxOffsetY;
      const t = evalObj.worldTransform;
      const dx = lx - t.x;
      const dy = ly - t.y;
      const cos = Math.cos(-t.rotation);
      const sin = Math.sin(-t.rotation);
      const rx = (dx * cos - dy * sin) / Math.max(0.05, Math.abs(t.scaleX)) + t.pivotX;
      const ry = (dx * sin + dy * cos) / Math.max(0.05, Math.abs(t.scaleY)) + t.pivotY;

      const { w, h } = this.getObjectDimensions(project, evalObj);
      if (rx >= -w / 2 - 8 && rx <= w / 2 + 8 && ry >= -h / 2 - 8 && ry <= h / 2 + 8) {
        return layer.layer.id;
      }
    }
    return null;
  }

  dispose(): void {
    this.imageCache.clear();
    this.loadingImages.clear();
    this.offscreenCompPool.clear();
  }
}
