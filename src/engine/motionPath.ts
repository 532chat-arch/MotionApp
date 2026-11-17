import { MotionProject } from '../schema/projectSchema';
import { evaluateCompositionAtFrame, evaluateKeyframes } from './evaluator';

export interface MotionPathPoint {
  frame: number;
  x: number; // composition camera-space X (worldTransform.x + parallaxOffsetX)
  y: number; // composition camera-space Y (worldTransform.y + parallaxOffsetY)
}

export interface MotionPathNode extends MotionPathPoint {
  localX: number;
  localY: number;
  hasX: boolean;
  hasY: boolean;
  kfIdX?: string;
  kfIdY?: string;
}

export interface MotionPathData {
  layerId: string;
  startFrame: number;
  endFrame: number;
  points: MotionPathPoint[];
  velocityDots: MotionPathPoint[];
  nodes: MotionPathNode[];
}

export interface MotionPathDragOverride {
  layerId: string;
  frame: number;
  localX: number;
  localY: number;
}

/**
 * Computes the sampled spatial motion path, velocity timing dots, and keyframe anchor nodes
 * for a Layer across its animated keyframe span (or composition span if parented to an animated layer).
 */
export function computeLayerMotionPath(
  project: MotionProject,
  compositionId: string,
  layerId: string,
  dragOverride?: MotionPathDragOverride | null
): MotionPathData | null {
  const comp = project.compositions.find((c) => c.id === compositionId);
  if (!comp) return null;
  const rawLayer = comp.layers.find((l) => l.id === layerId);
  if (!rawLayer) return null;

  // Apply transient drag override cleanly without mutating the project
  const effectiveProject: MotionProject =
    dragOverride && dragOverride.layerId === layerId
      ? {
          ...project,
          compositions: project.compositions.map((c) =>
            c.id !== compositionId
              ? c
              : {
                  ...c,
                  layers: c.layers.map((l) => {
                    if (l.id !== layerId) return l;
                    const upsert = (
                      list: typeof l.keyframes.x,
                      frame: number,
                      value: number
                    ) => {
                      const idx = list.findIndex((k) => k.frame === frame);
                      if (idx >= 0) {
                        return list.map((k, i) => (i === idx ? { ...k, value } : k));
                      }
                      return [
                        ...list,
                        {
                          id: `__preview_${frame}`,
                          frame,
                          value,
                          interpolation: 'easeInOut' as const,
                        },
                      ].sort((a, b) => a.frame - b.frame);
                    };
                    return {
                      ...l,
                      keyframes: {
                        ...l.keyframes,
                        x: upsert(l.keyframes.x, dragOverride.frame, dragOverride.localX),
                        y: upsert(l.keyframes.y, dragOverride.frame, dragOverride.localY),
                      },
                    };
                  }),
                }
          ),
        }
      : project;

  const effComp = effectiveProject.compositions.find((c) => c.id === compositionId)!;
  const effLayer = effComp.layers.find((l) => l.id === layerId)!;

  const xKfs = effLayer.keyframes.x ?? [];
  const yKfs = effLayer.keyframes.y ?? [];

  // Collect unique spatial keyframe frames
  const frameSet = new Set<number>();
  for (const k of xKfs) frameSet.add(k.frame);
  for (const k of yKfs) frameSet.add(k.frame);

  // Also include parent positional keyframes if this layer is parented
  let parentId = effLayer.parentId;
  const seenParents = new Set<string>([layerId]);
  let hasParentPositionAnimation = false;
  while (parentId && !seenParents.has(parentId)) {
    seenParents.add(parentId);
    const parentLayer = effComp.layers.find((l) => l.id === parentId);
    if (!parentLayer) break;
    for (const k of parentLayer.keyframes.x ?? []) {
      frameSet.add(k.frame);
      hasParentPositionAnimation = true;
    }
    for (const k of parentLayer.keyframes.y ?? []) {
      frameSet.add(k.frame);
      hasParentPositionAnimation = true;
    }
    for (const k of parentLayer.keyframes.rotation ?? []) {
      frameSet.add(k.frame);
      hasParentPositionAnimation = true;
    }
    parentId = parentLayer.parentId;
  }

  if (frameSet.size < 2 && !hasParentPositionAnimation) {
    return null;
  }

  const sortedFrames = [...frameSet].sort((a, b) => a - b);
  const startFrame = sortedFrames[0];
  const endFrame = sortedFrames[sortedFrames.length - 1];
  if (endFrame <= startFrame) return null;

  const span = endFrame - startFrame;
  // Adaptive step so long timelines remain fast while curves remain smooth
  const sampleStep = span <= 180 ? 1 : Math.max(1, Math.floor(span / 180));
  const sampleFrames = new Set<number>(sortedFrames);
  for (let f = startFrame; f <= endFrame; f += sampleStep) {
    sampleFrames.add(f);
  }
  sampleFrames.add(endFrame);
  const orderedSampleFrames = [...sampleFrames].sort((a, b) => a - b);

  const points: MotionPathPoint[] = [];
  const dotStep = Math.max(2, Math.round(span / 36));
  const velocityDots: MotionPathPoint[] = [];
  const nodes: MotionPathNode[] = [];

  for (const f of orderedSampleFrames) {
    const evalState = evaluateCompositionAtFrame(effectiveProject, compositionId, f);
    const evalLayer = evalState?.layers.find((el) => el.layer.id === layerId);
    const objT = evalLayer?.objects[0]?.worldTransform;
    if (!evalLayer || !objT) continue;

    const px = objT.x + evalLayer.parallaxOffsetX;
    const py = objT.y + evalLayer.parallaxOffsetY;
    points.push({ frame: f, x: px, y: py });

    if ((f - startFrame) % dotStep === 0 && !frameSet.has(f)) {
      velocityDots.push({ frame: f, x: px, y: py });
    }

    const kfX = xKfs.find((k) => k.frame === f);
    const kfY = yKfs.find((k) => k.frame === f);
    if (kfX || kfY || frameSet.has(f)) {
      // Evaluate local X/Y so dragging a node updates local keyframes accurately even if only one axis is keyframed at this frame
      const base = effLayer.objects[0]?.transform;
      const evalLocalX = kfX ? kfX.value : evaluateKeyframes(xKfs, f, base?.x ?? objT.x);
      const evalLocalY = kfY ? kfY.value : evaluateKeyframes(yKfs, f, base?.y ?? objT.y);
      nodes.push({
        frame: f,
        x: px,
        y: py,
        localX: evalLocalX,
        localY: evalLocalY,
        hasX: Boolean(kfX),
        hasY: Boolean(kfY),
        kfIdX: kfX?.id,
        kfIdY: kfY?.id,
      });
    }
  }

  if (points.length < 2) return null;

  return {
    layerId,
    startFrame,
    endFrame,
    points,
    velocityDots,
    nodes,
  };
}
