import { EvaluatedCompositionState } from '../engine/evaluator';
import { MotionPathDragOverride } from '../engine/motionPath';
import { BlendMode, MotionProject } from '../schema/projectSchema';

export interface RendererCapabilities {
  name: string;
  supportedBlendModes: BlendMode[];
  supportsFilters: boolean;
  supportsOffscreenCapture: boolean;
}

export interface ViewportTransform {
  panX: number;
  panY: number;
  zoom: number;
}

export interface RenderOptions {
  viewport: ViewportTransform;
  selectedLayerId?: string | null;
  showGuides?: boolean;
  showMotionPath?: boolean;
  motionPathOverride?: MotionPathDragOverride | null;
  showCheckerboard?: boolean;
  isExport?: boolean;
  quality?: 'full' | 'reduced';
  skipWeatherParticles?: boolean;
}

export interface IRendererAdapter {
  getCapabilities(): RendererCapabilities;
  renderComposition(
    target: HTMLCanvasElement,
    project: MotionProject,
    state: EvaluatedCompositionState,
    options: RenderOptions
  ): void;
  renderCompositionToImageData(
    project: MotionProject,
    state: EvaluatedCompositionState,
    width: number,
    height: number
  ): HTMLCanvasElement;
  hitTest(
    project: MotionProject,
    state: EvaluatedCompositionState,
    compPointX: number,
    compPointY: number
  ): string | null;
  dispose(): void;
}
