import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass,
  Hand,
  Maximize2,
  MousePointer2,
  Route,
  Square,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { ProjectCommands, uid } from '../commands/projectCommands';
import { evaluateCompositionAtFrame } from '../engine/evaluator';
import { computeLayerMotionPath, MotionPathDragOverride } from '../engine/motionPath';
import { Canvas2DRenderer } from '../renderer/Canvas2DRenderer';
import { ViewportTransform } from '../renderer/IRendererAdapter';
import { PixiEnvironmentEffectsSystem } from '../renderer/PixiEnvironmentEffects';
import { LayerDocument } from '../schema/projectSchema';
import { useStudioStore } from '../store/useStudioStore';

interface ActivePointer {
  x: number;
  y: number;
}

type DragMode =
  | { kind: 'none' }
  | { kind: 'pan'; startX: number; startY: number; origPanX: number; origPanY: number }
  | {
      kind: 'moveLayer';
      layerId: string;
      startCompX: number;
      startCompY: number;
      origX: number;
      origY: number;
    }
  | {
      kind: 'scaleLayer';
      layerId: string;
      centerCompX: number;
      centerCompY: number;
      startDist: number;
      origScaleX: number;
      origScaleY: number;
    }
  | {
      kind: 'rotateLayer';
      layerId: string;
      centerCompX: number;
      centerCompY: number;
      startAngle: number;
      origRot: number;
    }
  | {
      kind: 'moveKeyframeNode';
      layerId: string;
      frame: number;
      startCamX: number;
      startCamY: number;
      origLocalX: number;
      origLocalY: number;
      origWorldX: number;
      origWorldY: number;
      parentRotation: number;
      parentScaleX: number;
      parentScaleY: number;
    };

export const CompositionStage: React.FC = () => {
  const {
    project,
    activeCompositionId,
    selectedLayerId,
    currentFrame,
    activeTool,
    showGuides,
    showMotionPath,
    previewQuality,
    selectLayer,
    setCurrentFrame,
    setActiveTool,
    toggleGuides,
    toggleMotionPath,
    dispatchCommand,
  } = useStudioStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixiHostRef = useRef<HTMLDivElement>(null);
  const pixiEffectsRef = useRef<PixiEnvironmentEffectsSystem | null>(null);
  const [pixiReady, setPixiReady] = useState(false);
  const [decodeTick, setDecodeTick] = useState(0);
  const renderer = useMemo(
    () => new Canvas2DRenderer(() => setDecodeTick((t) => t + 1)),
    []
  );

  const [viewport, setViewport] = useState<ViewportTransform>({
    panX: 0,
    panY: 0,
    zoom: 0.65,
  });

  // Live preview transform override during pointer drag before committing command on pointerUp
  const [liveDragPreview, setLiveDragPreview] = useState<{
    layerId: string;
    frame?: number;
    localX?: number;
    localY?: number;
    x?: number;
    y?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
  } | null>(null);

  const dragRef = useRef<DragMode>({ kind: 'none' });
  const pointersRef = useRef<Map<number, ActivePointer>>(new Map());
  const pinchRef = useRef<{ dist: number; zoom: number; midX: number; midY: number; panX: number; panY: number } | null>(null);

  const composition = useMemo(
    () => project.compositions.find((c) => c.id === activeCompositionId) ?? project.compositions[0],
    [project.compositions, activeCompositionId]
  );

  // Fit composition nicely inside stage on first mount or composition resize
  const fitToStage = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const pad = 48;
    const availW = Math.max(200, el.clientWidth - pad);
    const availH = Math.max(160, el.clientHeight - pad);
    const z = Math.min(availW / composition.settings.width, availH / composition.settings.height, 1.5);
    setViewport({ panX: 0, panY: 0, zoom: Math.max(0.15, Number(z.toFixed(3))) });
  }, [composition.settings.width, composition.settings.height]);

  useEffect(() => {
    fitToStage();
  }, [fitToStage]);

  useEffect(() => {
    const host = pixiHostRef.current;
    if (!host) return;
    const fx = new PixiEnvironmentEffectsSystem();
    pixiEffectsRef.current = fx;
    let active = true;
    void fx.mount(host).then((ok) => {
      if (active) {
        setPixiReady(ok);
      }
    });
    return () => {
      active = false;
      setPixiReady(false);
      fx.dispose();
      if (pixiEffectsRef.current === fx) {
        pixiEffectsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Re-render on container resize
      setDecodeTick((t) => t + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build effective evaluated composition state (applying live drag preview if active)
  const evaluatedState = useMemo(() => {
    const state = evaluateCompositionAtFrame(project, composition.id, currentFrame);
    if (!state || !liveDragPreview) return state;

    return {
      ...state,
      layers: state.layers.map((el) => {
        if (el.layer.id !== liveDragPreview.layerId) return el;
        return {
          ...el,
          objects: el.objects.map((eo, idx) =>
            idx === 0
              ? {
                  ...eo,
                  worldTransform: {
                    ...eo.worldTransform,
                    x: liveDragPreview.x ?? eo.worldTransform.x,
                    y: liveDragPreview.y ?? eo.worldTransform.y,
                    scaleX: liveDragPreview.scaleX ?? eo.worldTransform.scaleX,
                    scaleY: liveDragPreview.scaleY ?? eo.worldTransform.scaleY,
                    rotation: liveDragPreview.rotation ?? eo.worldTransform.rotation,
                  },
                }
              : eo
          ),
        };
      }),
    };
  }, [project, composition.id, currentFrame, liveDragPreview]);

  const motionPathOverride = useMemo<MotionPathDragOverride | null>(() => {
    if (!liveDragPreview) return null;
    if (
      liveDragPreview.frame !== undefined &&
      liveDragPreview.localX !== undefined &&
      liveDragPreview.localY !== undefined
    ) {
      return {
        layerId: liveDragPreview.layerId,
        frame: liveDragPreview.frame,
        localX: liveDragPreview.localX,
        localY: liveDragPreview.localY,
      };
    }
    if (liveDragPreview.x !== undefined && liveDragPreview.y !== undefined) {
      const layer = composition.layers.find((l) => l.id === liveDragPreview.layerId);
      if (
        layer &&
        !layer.parentId &&
        ((layer.keyframes.x?.length ?? 0) > 0 || (layer.keyframes.y?.length ?? 0) > 0)
      ) {
        return {
          layerId: liveDragPreview.layerId,
          frame: currentFrame,
          localX: liveDragPreview.x,
          localY: liveDragPreview.y,
        };
      }
    }
    return null;
  }, [liveDragPreview, composition.layers, currentFrame]);

  // Render canvas & PixiJS sprite-pooled environment particles whenever state or viewport updates
  useEffect(() => {
    if (!canvasRef.current || !evaluatedState) return;
    renderer.renderComposition(canvasRef.current, project, evaluatedState, {
      viewport,
      selectedLayerId,
      showGuides,
      showMotionPath,
      motionPathOverride,
      quality: previewQuality,
      skipWeatherParticles: pixiReady,
    });

    if (pixiReady && pixiEffectsRef.current && pixiHostRef.current) {
      const host = pixiHostRef.current;
      pixiEffectsRef.current.update({
        width: host.clientWidth || canvasRef.current.clientWidth,
        height: host.clientHeight || canvasRef.current.clientHeight,
        compW: evaluatedState.composition.settings.width,
        compH: evaluatedState.composition.settings.height,
        frame: evaluatedState.frame,
        env: evaluatedState.composition.environment,
        viewport,
        quality: previewQuality,
      });
    }
  }, [
    renderer,
    project,
    evaluatedState,
    viewport,
    selectedLayerId,
    showGuides,
    showMotionPath,
    previewQuality,
    motionPathOverride,
    decodeTick,
    pixiReady,
  ]);

  const screenToComp = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const compW = composition.settings.width;
      const compH = composition.settings.height;
      const x = (sx - rect.width / 2 - viewport.panX) / viewport.zoom + compW / 2;
      const y = (sy - rect.height / 2 - viewport.panY) / viewport.zoom + compH / 2;
      return { x, y };
    },
    [composition.settings.width, composition.settings.height, viewport]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Multi-touch pinch-to-zoom & two-finger pan
    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      pinchRef.current = {
        dist: Math.max(10, dist),
        zoom: viewport.zoom,
        midX,
        midY,
        panX: viewport.panX,
        panY: viewport.panY,
      };
      dragRef.current = { kind: 'none' };
      return;
    }

    if (activeTool === 'pan' || e.button === 1 || e.altKey) {
      dragRef.current = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        origPanX: viewport.panX,
        origPanY: viewport.panY,
      };
      return;
    }

    if (!evaluatedState) return;
    const compPt = screenToComp(e.clientX, e.clientY);

    const compW = composition.settings.width;
    const compH = composition.settings.height;
    const camCos = Math.cos(-evaluatedState.camera.rotation);
    const camSin = Math.sin(-evaluatedState.camera.rotation);
    const camRelX = (compPt.x - compW / 2) / evaluatedState.camera.zoom;
    const camRelY = (compPt.y - compH / 2) / evaluatedState.camera.zoom;
    const camX = camRelX * camCos - camRelY * camSin + compW / 2 + evaluatedState.camera.x;
    const camY = camRelX * camSin + camRelY * camCos + compH / 2 + evaluatedState.camera.y;

    // Hit-test spatial keyframe diamond nodes on the active motion path first
    if (showMotionPath && selectedLayerId) {
      const selRawLayer = composition.layers.find((l) => l.id === selectedLayerId);
      if (selRawLayer && !selRawLayer.locked) {
        const motionPath = computeLayerMotionPath(project, composition.id, selectedLayerId);
        if (motionPath) {
          const nodeTol = 20 / Math.max(0.25, viewport.zoom * evaluatedState.camera.zoom);
          let closestNode = null as (typeof motionPath.nodes)[number] | null;
          let bestDist = Infinity;
          for (const node of motionPath.nodes) {
            const d = Math.hypot(camX - node.x, camY - node.y);
            if (d <= nodeTol && d < bestDist) {
              bestDist = d;
              closestNode = node;
            }
          }
          if (closestNode) {
            setCurrentFrame(closestNode.frame);
            let parentRotation = 0;
            let parentScaleX = 1;
            let parentScaleY = 1;
            if (selRawLayer.parentId) {
              const atNodeState = evaluateCompositionAtFrame(
                project,
                composition.id,
                closestNode.frame
              );
              const parentEval = atNodeState?.layers.find(
                (l) => l.layer.id === selRawLayer.parentId
              );
              if (parentEval) {
                parentRotation = parentEval.worldTransform.rotation;
                parentScaleX = parentEval.worldTransform.scaleX;
                parentScaleY = parentEval.worldTransform.scaleY;
              }
            }
            dragRef.current = {
              kind: 'moveKeyframeNode',
              layerId: selectedLayerId,
              frame: closestNode.frame,
              startCamX: camX,
              startCamY: camY,
              origLocalX: closestNode.localX,
              origLocalY: closestNode.localY,
              origWorldX: closestNode.x,
              origWorldY: closestNode.y,
              parentRotation,
              parentScaleX,
              parentScaleY,
            };
            return;
          }
        }
      }
    }

    // Check if pointer grabbed a gizmo handle on currently selected layer
    if (selectedLayerId) {
      const selEvalLayer = evaluatedState.layers.find((l) => l.layer.id === selectedLayerId);
      if (selEvalLayer && !selEvalLayer.layer.locked && selEvalLayer.objects[0]) {
        const evalObj = selEvalLayer.objects[0];
        const t = evalObj.worldTransform;
        const { w, h } = renderer.getObjectDimensions(project, evalObj);

        const lx = camX - selEvalLayer.parallaxOffsetX;
        const ly = camY - selEvalLayer.parallaxOffsetY;

        const dx = lx - t.x;
        const dy = ly - t.y;
        const cos = Math.cos(-t.rotation);
        const sin = Math.sin(-t.rotation);
        const localX = (dx * cos - dy * sin) / Math.max(0.05, Math.abs(t.scaleX));
        const localY = (dx * sin + dy * cos) / Math.max(0.05, Math.abs(t.scaleY));

        const handleTol = 22 / Math.max(0.2, viewport.zoom);
        // Top rotation handle
        const rotHandleY = -h / 2 - 28 / Math.max(0.2, viewport.zoom * Math.abs(t.scaleY));
        if (Math.hypot(localX, localY - rotHandleY) <= handleTol) {
          dragRef.current = {
            kind: 'rotateLayer',
            layerId: selectedLayerId,
            centerCompX: t.x,
            centerCompY: t.y,
            startAngle: Math.atan2(ly - t.y, lx - t.x),
            origRot: t.rotation,
          };
          return;
        }

        // 4 Corner scale handles
        const corners = [
          [-w / 2, -h / 2],
          [w / 2, -h / 2],
          [w / 2, h / 2],
          [-w / 2, h / 2],
        ];
        for (const [cx, cy] of corners) {
          if (Math.hypot(localX - cx, localY - cy) <= handleTol) {
            dragRef.current = {
              kind: 'scaleLayer',
              layerId: selectedLayerId,
              centerCompX: t.x,
              centerCompY: t.y,
              startDist: Math.max(12, Math.hypot(lx - t.x, ly - t.y)),
              origScaleX: t.scaleX,
              origScaleY: t.scaleY,
            };
            return;
          }
        }
      }
    }

    // Otherwise hit-test layer objects
    const hitId = renderer.hitTest(project, evaluatedState, compPt.x, compPt.y);
    if (hitId) {
      selectLayer(hitId, 'layer');
      const hitLayer = evaluatedState.layers.find((l) => l.layer.id === hitId);
      const t = hitLayer?.objects[0]?.worldTransform;
      if (t && !hitLayer.layer.locked) {
        dragRef.current = {
          kind: 'moveLayer',
          layerId: hitId,
          startCompX: compPt.x,
          startCompY: compPt.y,
          origX: t.x,
          origY: t.y,
        };
      }
    } else {
      // Tapped empty stage -> allow panning stage smoothly
      dragRef.current = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        origPanX: viewport.panX,
        origPanY: viewport.panY,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pointersRef.current.size === 2 && pinchRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const scaleFactor = dist / pinchRef.current.dist;
      const nextZoom = Math.max(0.15, Math.min(4, pinchRef.current.zoom * scaleFactor));
      setViewport({
        zoom: nextZoom,
        panX: pinchRef.current.panX + (midX - pinchRef.current.midX),
        panY: pinchRef.current.panY + (midY - pinchRef.current.midY),
      });
      return;
    }

    const drag = dragRef.current;
    if (drag.kind === 'none') return;

    if (drag.kind === 'pan') {
      setViewport((v) => ({
        ...v,
        panX: drag.origPanX + (e.clientX - drag.startX),
        panY: drag.origPanY + (e.clientY - drag.startY),
      }));
      return;
    }

    const compPt = screenToComp(e.clientX, e.clientY);
    if (drag.kind === 'moveKeyframeNode' && evaluatedState) {
      const compW = composition.settings.width;
      const compH = composition.settings.height;
      const camCos = Math.cos(-evaluatedState.camera.rotation);
      const camSin = Math.sin(-evaluatedState.camera.rotation);
      const camRelX = (compPt.x - compW / 2) / evaluatedState.camera.zoom;
      const camRelY = (compPt.y - compH / 2) / evaluatedState.camera.zoom;
      const camX = camRelX * camCos - camRelY * camSin + compW / 2 + evaluatedState.camera.x;
      const camY = camRelX * camSin + camRelY * camCos + compH / 2 + evaluatedState.camera.y;

      const dxCam = camX - drag.startCamX;
      const dyCam = camY - drag.startCamY;

      const pCos = Math.cos(-drag.parentRotation);
      const pSin = Math.sin(-drag.parentRotation);
      const rx = dxCam * pCos - dyCam * pSin;
      const ry = dxCam * pSin + dyCam * pCos;
      const dxLocal = rx / (Math.abs(drag.parentScaleX) > 0.05 ? drag.parentScaleX : 1);
      const dyLocal = ry / (Math.abs(drag.parentScaleY) > 0.05 ? drag.parentScaleY : 1);

      const evalLayer = evaluatedState.layers.find((l) => l.layer.id === drag.layerId);
      const pxOffset = evalLayer?.parallaxOffsetX ?? 0;
      const pyOffset = evalLayer?.parallaxOffsetY ?? 0;

      setLiveDragPreview({
        layerId: drag.layerId,
        frame: drag.frame,
        localX: Math.round(drag.origLocalX + dxLocal),
        localY: Math.round(drag.origLocalY + dyLocal),
        x: Math.round(drag.origWorldX - pxOffset + dxCam),
        y: Math.round(drag.origWorldY - pyOffset + dyCam),
      });
    } else if (drag.kind === 'moveLayer') {
      const camZoom = evaluatedState?.camera.zoom ?? 1;
      const dx = (compPt.x - drag.startCompX) / camZoom;
      const dy = (compPt.y - drag.startCompY) / camZoom;
      setLiveDragPreview({
        layerId: drag.layerId,
        x: Math.round(drag.origX + dx),
        y: Math.round(drag.origY + dy),
      });
    } else if (drag.kind === 'scaleLayer' && evaluatedState) {
      const compW = composition.settings.width;
      const compH = composition.settings.height;
      const camX = (compPt.x - compW / 2) / evaluatedState.camera.zoom + compW / 2 + evaluatedState.camera.x;
      const camY = (compPt.y - compH / 2) / evaluatedState.camera.zoom + compH / 2 + evaluatedState.camera.y;
      const evalLayer = evaluatedState.layers.find((l) => l.layer.id === drag.layerId);
      const lx = camX - (evalLayer?.parallaxOffsetX ?? 0);
      const ly = camY - (evalLayer?.parallaxOffsetY ?? 0);
      const curDist = Math.max(10, Math.hypot(lx - drag.centerCompX, ly - drag.centerCompY));
      const ratio = curDist / drag.startDist;
      setLiveDragPreview({
        layerId: drag.layerId,
        scaleX: Number((drag.origScaleX * ratio).toFixed(2)),
        scaleY: Number((drag.origScaleY * ratio).toFixed(2)),
      });
    } else if (drag.kind === 'rotateLayer' && evaluatedState) {
      const compW = composition.settings.width;
      const compH = composition.settings.height;
      const camX = (compPt.x - compW / 2) / evaluatedState.camera.zoom + compW / 2 + evaluatedState.camera.x;
      const camY = (compPt.y - compH / 2) / evaluatedState.camera.zoom + compH / 2 + evaluatedState.camera.y;
      const evalLayer = evaluatedState.layers.find((l) => l.layer.id === drag.layerId);
      const lx = camX - (evalLayer?.parallaxOffsetX ?? 0);
      const ly = camY - (evalLayer?.parallaxOffsetY ?? 0);
      const angle = Math.atan2(ly - drag.centerCompY, lx - drag.centerCompX);
      setLiveDragPreview({
        layerId: drag.layerId,
        rotation: drag.origRot + (angle - drag.startAngle),
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }

    if (liveDragPreview) {
      const { layerId, frame, localX, localY, x, y, scaleX, scaleY, rotation } = liveDragPreview;
      if (frame !== undefined && localX !== undefined && localY !== undefined) {
        const targetLayer = composition.layers.find((l) => l.id === layerId);
        const existingX = targetLayer?.keyframes.x.find((k) => k.frame === frame);
        const existingY = targetLayer?.keyframes.y.find((k) => k.frame === frame);

        if (existingX) {
          dispatchCommand(
            ProjectCommands.updateLayerKeyframe(composition.id, layerId, 'x', existingX.id, {
              value: localX,
            })
          );
        } else {
          dispatchCommand(
            ProjectCommands.setLayerKeyframe(composition.id, layerId, 'x', frame, localX)
          );
        }

        if (existingY) {
          dispatchCommand(
            ProjectCommands.updateLayerKeyframe(composition.id, layerId, 'y', existingY.id, {
              value: localY,
            })
          );
        } else {
          dispatchCommand(
            ProjectCommands.setLayerKeyframe(composition.id, layerId, 'y', frame, localY)
          );
        }
      } else {
        if (x !== undefined) {
          dispatchCommand(ProjectCommands.setLayerTransformProperty(composition.id, layerId, 'x', x, currentFrame));
        }
        if (y !== undefined) {
          dispatchCommand(ProjectCommands.setLayerTransformProperty(composition.id, layerId, 'y', y, currentFrame));
        }
        if (scaleX !== undefined) {
          dispatchCommand(ProjectCommands.setLayerTransformProperty(composition.id, layerId, 'scaleX', scaleX, currentFrame));
        }
        if (scaleY !== undefined) {
          dispatchCommand(ProjectCommands.setLayerTransformProperty(composition.id, layerId, 'scaleY', scaleY, currentFrame));
        }
        if (rotation !== undefined) {
          dispatchCommand(ProjectCommands.setLayerTransformProperty(composition.id, layerId, 'rotation', rotation, currentFrame));
        }
      }
      setLiveDragPreview(null);
    }

    dragRef.current = { kind: 'none' };
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0) {
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      setViewport((v) => ({
        ...v,
        zoom: Math.max(0.15, Math.min(4, Number((v.zoom * factor).toFixed(3)))),
      }));
    }
  };

  const handleQuickAddShape = () => {
    const newLayer: LayerDocument = {
      id: uid('layer'),
      name: 'Shape Layer',
      role: 'prop',
      visible: true,
      locked: false,
      solo: false,
      opacity: 1,
      blendMode: 'normal',
      depth: 0,
      inFrame: 0,
      outFrame: composition.settings.durationFrames,
      objects: [
        {
          id: uid('obj'),
          name: 'Rounded Box',
          kind: 'shape',
          shapeType: 'rect',
          width: 180,
          height: 180,
          fill: '#3B82F6',
          stroke: '#93C5FD',
          strokeWidth: 2,
          cornerRadius: 20,
          transform: {
            x: composition.settings.width / 2,
            y: composition.settings.height / 2,
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
    dispatchCommand(ProjectCommands.addLayer(composition.id, newLayer, 0));
    selectLayer(newLayer.id, 'layer');
  };

  const handleQuickAddText = () => {
    const newLayer: LayerDocument = {
      id: uid('layer'),
      name: 'Text Title',
      role: 'foreground',
      visible: true,
      locked: false,
      solo: false,
      opacity: 1,
      blendMode: 'normal',
      depth: 0.2,
      inFrame: 0,
      outFrame: composition.settings.durationFrames,
      objects: [
        {
          id: uid('obj'),
          name: 'Text',
          kind: 'text',
          text: 'Scene Title',
          fontSize: 52,
          fontFamily: 'Plus Jakarta Sans',
          color: '#F8FAFC',
          align: 'center',
          transform: {
            x: composition.settings.width / 2,
            y: composition.settings.height / 2,
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
    dispatchCommand(ProjectCommands.addLayer(composition.id, newLayer, 0));
    selectLayer(newLayer.id, 'layer');
  };

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0 min-h-0 bg-[#0D0F12] overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        className={`w-full h-full block touch-none ${
          activeTool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
        }`}
      />
      <div
        ref={pixiHostRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
      />

      {/* Slim Left Contextual Toolbar */}
      <div className="absolute left-2.5 top-2.5 flex flex-col gap-0.5 p-1 rounded-xl bg-[#181B20]/90 backdrop-blur-md border border-white/10 shadow-lg">
        <button
          type="button"
          onClick={() => setActiveTool('select')}
          title="Select & Transform (Tap, drag, corner scale, top rotate)"
          aria-label="Select tool"
          className={`h-9 w-9 rounded-lg flex items-center justify-center transition-colors ${
            activeTool === 'select'
              ? 'bg-blue-600 text-white'
              : 'text-slate-300 hover:bg-white/8'
          }`}
        >
          <MousePointer2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setActiveTool('pan')}
          title="Pan Canvas (or two-finger drag)"
          aria-label="Pan tool"
          className={`h-9 w-9 rounded-lg flex items-center justify-center transition-colors ${
            activeTool === 'pan'
              ? 'bg-blue-600 text-white'
              : 'text-slate-300 hover:bg-white/8'
          }`}
        >
          <Hand className="w-4 h-4" />
        </button>

        <div className="h-px bg-white/10 my-0.5" />

        <button
          type="button"
          onClick={handleQuickAddShape}
          title="Add Shape Layer"
          aria-label="Add shape layer"
          className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/8 hover:text-white transition-colors"
        >
          <Square className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleQuickAddText}
          title="Add Text Layer"
          aria-label="Add text layer"
          className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/8 hover:text-white transition-colors"
        >
          <Type className="w-4 h-4" />
        </button>

        <div className="h-px bg-white/10 my-0.5" />

        <button
          type="button"
          onClick={toggleGuides}
          title={showGuides ? 'Hide Safe Guides' : 'Show Safe Guides'}
          aria-label="Toggle safe guides"
          className={`h-9 w-9 rounded-lg flex items-center justify-center transition-colors ${
            showGuides ? 'text-blue-400 bg-blue-500/12' : 'text-slate-400 hover:bg-white/8'
          }`}
        >
          <Compass className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={toggleMotionPath}
          title={showMotionPath ? 'Hide Motion Path' : 'Show Motion Path'}
          aria-label="Toggle motion path"
          className={`h-9 w-9 rounded-lg flex items-center justify-center transition-colors ${
            showMotionPath ? 'text-sky-400 bg-sky-500/12' : 'text-slate-400 hover:bg-white/8'
          }`}
        >
          <Route className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom-Right Compact Zoom Bar */}
      <div className="absolute right-2.5 bottom-2.5 flex items-center gap-0.5 p-0.5 rounded-xl bg-[#181B20]/90 backdrop-blur-md border border-white/10 shadow-lg">
        <button
          type="button"
          onClick={() => setViewport((v) => ({ ...v, zoom: Math.max(0.15, v.zoom * 0.85) }))}
          aria-label="Zoom out"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/8"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <span className="px-1 text-[11px] font-mono tabular-nums text-slate-300 min-w-[40px] text-center">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setViewport((v) => ({ ...v, zoom: Math.min(4, v.zoom * 1.15) }))}
          aria-label="Zoom in"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/8"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={fitToStage}
          title="Fit Composition to View"
          aria-label="Fit to view"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/8"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
