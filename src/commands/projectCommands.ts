import { wouldCreateCompositionCycle, wouldCreateLayerParentCycle } from '../engine/cycleDetection.ts';
import { applyLayerModifiers, evaluateCameraAtFrame, evaluateKeyframes, getPrimaryObjectBounds } from '../engine/evaluator.ts';
import type {
  AssetRecord,
  AudioClipDocument,
  AudioTrackDocument,
  CameraDocument,
  CharacterDefinition,
  CompositionRecord,
  EnvironmentDocument,
  InterpolationType,
  Keyframe,
  LayerAnimatableProp,
  LayerDocument,
  LyricsConfig,
  MotionModifierInstance,
  MotionProject,
  ProjectTimelineClip,
  SceneObjectDocument,
} from '../schema/projectSchema.ts';
import type { ProjectCommand } from './commandManager.ts';

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function updateComposition(
  project: MotionProject,
  compId: string,
  updater: (comp: CompositionRecord) => CompositionRecord
): MotionProject {
  return {
    ...project,
    compositions: project.compositions.map((c) => (c.id === compId ? updater(c) : c)),
  };
}

function updateLayer(
  project: MotionProject,
  compId: string,
  layerId: string,
  updater: (layer: LayerDocument) => LayerDocument
): MotionProject {
  return updateComposition(project, compId, (comp) => ({
    ...comp,
    layers: comp.layers.map((l) => (l.id === layerId ? updater(l) : l)),
  }));
}

export const ProjectCommands = {
  renameProject(name: string): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Rename Project',
      affectedIds: ['project'],
      validate: () => (name.trim().length === 0 ? 'Project name cannot be empty' : null),
      execute: (p) => ({ ...p, name: name.trim() }),
    };
  },

  createComposition(comp: CompositionRecord): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Create Composition "${comp.name}"`,
      affectedIds: [comp.id],
      execute: (p) => ({
        ...p,
        compositions: [...p.compositions, comp],
      }),
    };
  },

  duplicateComposition(sourceCompId: string, newId: string, newName: string): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Duplicate Composition`,
      affectedIds: [sourceCompId, newId],
      execute: (p) => {
        const src = p.compositions.find((c) => c.id === sourceCompId);
        if (!src) return p;
        const clone: CompositionRecord = structuredClone(src);
        clone.id = newId;
        clone.name = newName;
        clone.layers = clone.layers.map((l) => ({
          ...l,
          id: uid('layer'),
          objects: l.objects.map((o) => ({ ...o, id: uid('obj') })),
        }));
        return {
          ...p,
          compositions: [...p.compositions, clone],
        };
      },
    };
  },

  deleteComposition(compId: string): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Delete Composition',
      affectedIds: [compId],
      validate: (p) =>
        p.compositions.length <= 1 ? 'A Project must retain at least one Composition.' : null,
      execute: (p) => ({
        ...p,
        compositions: p.compositions.filter((c) => c.id !== compId),
        projectTimeline: {
          ...p.projectTimeline,
          clips: p.projectTimeline.clips.filter((cl) => cl.compositionId !== compId),
        },
      }),
    };
  },

  updateCompositionSettings(
    compId: string,
    patch: Partial<CompositionRecord['settings']> & { name?: string }
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Update Composition Settings',
      affectedIds: [compId],
      execute: (p) =>
        updateComposition(p, compId, (c) => ({
          ...c,
          name: patch.name !== undefined ? patch.name : c.name,
          settings: {
            ...c.settings,
            ...patch,
          },
        })),
    };
  },

  updateEnvironment(compId: string, patch: Partial<EnvironmentDocument>): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Update Environment',
      affectedIds: [compId],
      execute: (p) =>
        updateComposition(p, compId, (c) => ({
          ...c,
          environment: { ...c.environment, ...patch },
        })),
    };
  },

  updateCamera(compId: string, patch: Partial<CameraDocument>): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Update Camera',
      affectedIds: [compId],
      execute: (p) =>
        updateComposition(p, compId, (c) => ({
          ...c,
          camera: { ...c.camera, ...patch },
        })),
    };
  },

  setCameraKeyframe(
    compId: string,
    prop: 'x' | 'y' | 'zoom',
    frame: number,
    value: number,
    interpolation: InterpolationType = 'easeInOut'
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Keyframe Camera ${prop}`,
      affectedIds: [compId],
      execute: (p) =>
        updateComposition(p, compId, (c) => {
          const list = c.camera.keyframes[prop] ?? [];
          const existingIdx = list.findIndex((k) => k.frame === frame);
          const nextList =
            existingIdx >= 0
              ? list.map((k, idx) => (idx === existingIdx ? { ...k, value, interpolation } : k))
              : [...list, { id: uid('kf'), frame, value, interpolation }].sort(
                  (a, b) => a.frame - b.frame
                );
          return {
            ...c,
            camera: {
              ...c.camera,
              [prop]: value,
              keyframes: {
                ...c.camera.keyframes,
                [prop]: nextList,
              },
            },
          };
        }),
    };
  },

  removeCameraKeyframe(compId: string, prop: 'x' | 'y' | 'zoom', frame: number): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Remove Camera Keyframe`,
      affectedIds: [compId],
      execute: (p) =>
        updateComposition(p, compId, (c) => ({
          ...c,
          camera: {
            ...c.camera,
            keyframes: {
              ...c.camera.keyframes,
              [prop]: c.camera.keyframes[prop].filter((k) => k.frame !== frame),
            },
          },
        })),
    };
  },

  updateCameraKeyframe(
    compId: string,
    prop: 'x' | 'y' | 'zoom',
    keyframeId: string,
    patch: { frame?: number; value?: number; interpolation?: InterpolationType }
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Edit Camera ${prop} Keyframe`,
      affectedIds: [compId, keyframeId],
      execute: (p) =>
        updateComposition(p, compId, (c) => {
          const list = c.camera.keyframes[prop] ?? [];
          const targetFrame =
            patch.frame !== undefined ? Math.max(0, Math.round(patch.frame)) : undefined;
          const nextValue =
            patch.value !== undefined
              ? prop === 'zoom'
                ? Math.max(0.1, patch.value)
                : patch.value
              : undefined;
          const nextList = list
            .filter((k) => targetFrame === undefined || k.id === keyframeId || k.frame !== targetFrame)
            .map((k) =>
              k.id === keyframeId
                ? {
                    ...k,
                    frame: targetFrame ?? k.frame,
                    value: nextValue ?? k.value,
                    interpolation: patch.interpolation ?? k.interpolation,
                  }
                : k
            )
            .sort((a, b) => a.frame - b.frame);
          return {
            ...c,
            camera: {
              ...c.camera,
              keyframes: {
                ...c.camera.keyframes,
                [prop]: nextList,
              },
            },
          };
        }),
    };
  },

  addLayer(compId: string, layer: LayerDocument, atIndex?: number): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Add Layer "${layer.name}"`,
      affectedIds: [compId, layer.id],
      execute: (p) =>
        updateComposition(p, compId, (c) => {
          const layers = [...c.layers];
          if (atIndex !== undefined && atIndex >= 0 && atIndex <= layers.length) {
            layers.splice(atIndex, 0, layer);
          } else {
            layers.push(layer);
          }
          return { ...c, layers };
        }),
    };
  },

  deleteLayer(compId: string, layerId: string): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Delete Layer',
      affectedIds: [compId, layerId],
      execute: (p) =>
        updateComposition(p, compId, (c) => ({
          ...c,
          layers: c.layers
            .filter((l) => l.id !== layerId)
            .map((l) => (l.parentId === layerId ? { ...l, parentId: undefined } : l)),
        })),
    };
  },

  reorderLayer(compId: string, fromIndex: number, toIndex: number): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Reorder Layer',
      affectedIds: [compId],
      execute: (p) =>
        updateComposition(p, compId, (c) => {
          if (
            fromIndex < 0 ||
            fromIndex >= c.layers.length ||
            toIndex < 0 ||
            toIndex >= c.layers.length
          ) {
            return c;
          }
          const next = [...c.layers];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          return { ...c, layers: next };
        }),
    };
  },

  updateLayerProps(
    compId: string,
    layerId: string,
    patch: Partial<
      Pick<
        LayerDocument,
        'name' | 'role' | 'visible' | 'locked' | 'solo' | 'opacity' | 'blendMode' | 'depth' | 'inFrame' | 'outFrame'
      >
    >
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Update Layer',
      affectedIds: [compId, layerId],
      execute: (p) => updateLayer(p, compId, layerId, (l) => ({ ...l, ...patch })),
    };
  },

  setLayerParent(
    compId: string,
    layerId: string,
    parentId: string | undefined
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: parentId ? 'Set Layer Parent' : 'Clear Layer Parent',
      affectedIds: [compId, layerId],
      validate: (p) => {
        if (!parentId) return null;
        const comp = p.compositions.find((c) => c.id === compId);
        if (!comp) return 'Composition not found';
        if (wouldCreateLayerParentCycle(comp.layers, layerId, parentId)) {
          return 'Cannot set parent: this would create a circular parenting dependency.';
        }
        return null;
      },
      execute: (p) => updateLayer(p, compId, layerId, (l) => ({ ...l, parentId })),
    };
  },

  updateObject(
    compId: string,
    layerId: string,
    objectId: string,
    updater: (obj: SceneObjectDocument) => SceneObjectDocument
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Edit Object',
      affectedIds: [compId, layerId, objectId],
      execute: (p) =>
        updateLayer(p, compId, layerId, (l) => ({
          ...l,
          objects: l.objects.map((o) => (o.id === objectId ? updater(o) : o)),
        })),
    };
  },

  setLayerTransformProperty(
    compId: string,
    layerId: string,
    prop: LayerAnimatableProp,
    value: number,
    frame: number,
    autoKeyframe = true
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Change ${prop}`,
      affectedIds: [compId, layerId],
      execute: (p) =>
        updateLayer(p, compId, layerId, (l) => {
          const nextLayer = { ...l };
          if (prop === 'opacity') {
            nextLayer.opacity = Math.max(0, Math.min(1, value));
          }
          if (nextLayer.objects[0]) {
            const first = nextLayer.objects[0];
            nextLayer.objects = [
              {
                ...first,
                transform: {
                  ...first.transform,
                  [prop]: prop === 'opacity' ? Math.max(0, Math.min(1, value)) : value,
                },
              },
              ...nextLayer.objects.slice(1),
            ];
          }

          const existingKfs = nextLayer.keyframes[prop] ?? [];
          if (autoKeyframe && existingKfs.length > 0) {
            const idx = existingKfs.findIndex((k) => k.frame === frame);
            const updatedKfs =
              idx >= 0
                ? existingKfs.map((k, i) => (i === idx ? { ...k, value } : k))
                : [
                    ...existingKfs,
                    { id: uid('kf'), frame, value, interpolation: 'easeInOut' as const },
                  ].sort((a, b) => a.frame - b.frame);
            nextLayer.keyframes = { ...nextLayer.keyframes, [prop]: updatedKfs };
          }
          return nextLayer;
        }),
    };
  },

  setLayerKeyframe(
    compId: string,
    layerId: string,
    prop: LayerAnimatableProp,
    frame: number,
    value: number,
    interpolation: InterpolationType = 'easeInOut'
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Set ${prop} Keyframe`,
      affectedIds: [compId, layerId],
      execute: (p) =>
        updateLayer(p, compId, layerId, (l) => {
          const list = l.keyframes[prop] ?? [];
          const clampedFrame = Math.max(0, Math.round(frame));
          const clampedValue = prop === 'opacity' ? Math.max(0, Math.min(1, value)) : value;
          const existingIdx = list.findIndex((k) => k.frame === clampedFrame);
          const nextList: Keyframe[] =
            existingIdx >= 0
              ? list.map((k, idx) =>
                  idx === existingIdx
                    ? { ...k, value: clampedValue, interpolation }
                    : k
                )
              : [
                  ...list,
                  { id: uid('kf'), frame: clampedFrame, value: clampedValue, interpolation },
                ].sort((a, b) => a.frame - b.frame);
          return {
            ...l,
            keyframes: {
              ...l.keyframes,
              [prop]: nextList,
            },
          };
        }),
    };
  },

  updateLayerKeyframe(
    compId: string,
    layerId: string,
    prop: LayerAnimatableProp,
    keyframeId: string,
    patch: { frame?: number; value?: number; interpolation?: InterpolationType }
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Edit ${prop} Keyframe`,
      affectedIds: [compId, layerId, keyframeId],
      execute: (p) =>
        updateLayer(p, compId, layerId, (l) => {
          const targetFrame =
            patch.frame !== undefined ? Math.max(0, Math.round(patch.frame)) : undefined;
          const nextValue =
            patch.value !== undefined
              ? prop === 'opacity'
                ? Math.max(0, Math.min(1, patch.value))
                : patch.value
              : undefined;
          const list = (l.keyframes[prop] ?? [])
            .filter((k) => targetFrame === undefined || k.id === keyframeId || k.frame !== targetFrame)
            .map((k) =>
              k.id === keyframeId
                ? {
                    ...k,
                    frame: targetFrame ?? k.frame,
                    value: nextValue ?? k.value,
                    interpolation: patch.interpolation ?? k.interpolation,
                  }
                : k
            )
            .sort((a, b) => a.frame - b.frame);
          return {
            ...l,
            keyframes: { ...l.keyframes, [prop]: list },
          };
        }),
    };
  },

  moveLayerKeyframe(
    compId: string,
    layerId: string,
    prop: LayerAnimatableProp,
    keyframeId: string,
    targetFrame: number
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Move Keyframe',
      affectedIds: [compId, layerId, keyframeId],
      execute: (p) =>
        updateLayer(p, compId, layerId, (l) => {
          const clampedFrame = Math.max(0, Math.round(targetFrame));
          const list = l.keyframes[prop]
            .filter((k) => k.id === keyframeId || k.frame !== clampedFrame)
            .map((k) => (k.id === keyframeId ? { ...k, frame: clampedFrame } : k))
            .sort((a, b) => a.frame - b.frame);
          return {
            ...l,
            keyframes: { ...l.keyframes, [prop]: list },
          };
        }),
    };
  },

  deleteLayerKeyframe(
    compId: string,
    layerId: string,
    prop: LayerAnimatableProp,
    keyframeId: string
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Delete Keyframe',
      affectedIds: [compId, layerId, keyframeId],
      execute: (p) =>
        updateLayer(p, compId, layerId, (l) => ({
          ...l,
          keyframes: {
            ...l.keyframes,
            [prop]: l.keyframes[prop].filter((k) => k.id !== keyframeId),
          },
        })),
    };
  },

  clearLayerPropertyKeyframes(
    compId: string,
    layerId: string,
    prop: LayerAnimatableProp
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Clear ${prop} Keyframes`,
      affectedIds: [compId, layerId],
      execute: (p) =>
        updateLayer(p, compId, layerId, (l) => ({
          ...l,
          keyframes: {
            ...l.keyframes,
            [prop]: [],
          },
        })),
    };
  },

  nestCompositionLayer(
    parentCompId: string,
    childCompId: string,
    layerName?: string
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Nest Composition',
      affectedIds: [parentCompId, childCompId],
      validate: (p) => {
        if (wouldCreateCompositionCycle(p.compositions, parentCompId, childCompId)) {
          return 'Cannot nest Composition: circular nesting dependency detected.';
        }
        return null;
      },
      execute: (p) => {
        const parent = p.compositions.find((c) => c.id === parentCompId);
        const child = p.compositions.find((c) => c.id === childCompId);
        if (!parent || !child) return p;

        const nestedLayer: LayerDocument = {
          id: uid('layer'),
          name: layerName ?? `Nested: ${child.name}`,
          role: 'midground',
          visible: true,
          locked: false,
          solo: false,
          opacity: 1,
          blendMode: 'normal',
          depth: 0,
          inFrame: 0,
          outFrame: parent.settings.durationFrames,
          objects: [
            {
              id: uid('obj'),
              name: child.name,
              kind: 'nestedComposition',
              compositionId: child.id,
              timeOffsetFrames: 0,
              playbackSpeed: 1,
              loop: true,
              transform: {
                x: parent.settings.width / 2,
                y: parent.settings.height / 2,
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

        return updateComposition(p, parentCompId, (c) => ({
          ...c,
          layers: [...c.layers, nestedLayer],
        }));
      },
    };
  },

  preComposeLayers(
    parentCompId: string,
    layerIds: string[],
    newCompName: string
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Pre-compose "${newCompName}"`,
      affectedIds: [parentCompId, ...layerIds],
      validate: (p) => {
        if (layerIds.length === 0) return 'Select at least one layer to pre-compose.';
        return null;
      },
      execute: (p) => {
        const parent = p.compositions.find((c) => c.id === parentCompId);
        if (!parent) return p;

        const selectedSet = new Set(layerIds);
        const selectedLayers = parent.layers.filter((l) => selectedSet.has(l.id));
        if (selectedLayers.length === 0) return p;

        const firstSelectedIdx = parent.layers.findIndex((l) => selectedSet.has(l.id));
        const newCompId = uid('comp');

        const newComp: CompositionRecord = {
          id: newCompId,
          name: newCompName.trim() || 'Pre-comp 1',
          description: `Pre-composed from ${parent.name}`,
          settings: { ...parent.settings },
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
            presetId: 'transparent',
            skyTopColor: 'transparent',
            skyBottomColor: 'transparent',
            hazeColor: '#000000',
            hazeIntensity: 0,
            weatherType: 'none',
            weatherDensity: 0,
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
          layers: structuredClone(selectedLayers).map((l) => ({
            ...l,
            parentId: l.parentId && selectedSet.has(l.parentId) ? l.parentId : undefined,
          })),
          audioTracks: [],
          markers: [],
        };

        const replacementLayer: LayerDocument = {
          id: uid('layer'),
          name: newComp.name,
          role: 'midground',
          visible: true,
          locked: false,
          solo: false,
          opacity: 1,
          blendMode: 'normal',
          depth: 0,
          inFrame: 0,
          outFrame: parent.settings.durationFrames,
          objects: [
            {
              id: uid('obj'),
              name: newComp.name,
              kind: 'nestedComposition',
              compositionId: newCompId,
              timeOffsetFrames: 0,
              playbackSpeed: 1,
              loop: true,
              transform: {
                x: parent.settings.width / 2,
                y: parent.settings.height / 2,
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

        const remainingLayers = parent.layers.filter((l) => !selectedSet.has(l.id));
        remainingLayers.splice(firstSelectedIdx, 0, replacementLayer);

        return {
          ...p,
          compositions: [
            ...p.compositions.map((c) =>
              c.id === parentCompId ? { ...c, layers: remainingLayers } : c
            ),
            newComp,
          ],
        };
      },
    };
  },

  addAsset(asset: AssetRecord): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Import Asset "${asset.name}"`,
      affectedIds: [asset.id],
      execute: (p) => ({
        ...p,
        assets: [...p.assets, asset],
      }),
    };
  },

  replaceAssetSource(
    targetAssetId: string,
    replacement: Pick<AssetRecord, 'name' | 'mimeType' | 'dataUrl' | 'width' | 'height' | 'hash' | 'durationSeconds'>
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Replace Asset Source',
      affectedIds: [targetAssetId],
      execute: (p) => ({
        ...p,
        assets: p.assets.map((a) =>
          a.id === targetAssetId
            ? {
                ...a,
                ...replacement,
                updatedAt: new Date().toISOString(),
              }
            : a
        ),
      }),
    };
  },

  deleteAsset(assetId: string): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Remove Asset',
      affectedIds: [assetId],
      execute: (p) => ({
        ...p,
        assets: p.assets.filter((a) => a.id !== assetId),
      }),
    };
  },

  upsertCharacter(character: CharacterDefinition): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Save Character "${character.name}"`,
      affectedIds: [character.id],
      execute: (p) => {
        const exists = p.characters.some((c) => c.id === character.id);
        return {
          ...p,
          characters: exists
            ? p.characters.map((c) => (c.id === character.id ? character : c))
            : [...p.characters, character],
        };
      },
    };
  },

  addAudioTrack(compId: string, track: AudioTrackDocument): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Add Audio Track "${track.name}"`,
      affectedIds: [compId, track.id],
      execute: (p) =>
        updateComposition(p, compId, (c) => ({
          ...c,
          audioTracks: [...c.audioTracks, track],
        })),
    };
  },

  updateAudioTrack(
    compId: string,
    trackId: string,
    patch: Partial<AudioTrackDocument>
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Update Audio Track',
      affectedIds: [compId, trackId],
      execute: (p) =>
        updateComposition(p, compId, (c) => ({
          ...c,
          audioTracks: c.audioTracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
        })),
    };
  },

  addAudioClip(compId: string, trackId: string, clip: AudioClipDocument): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Add Audio Clip "${clip.name}"`,
      affectedIds: [compId, trackId, clip.id],
      execute: (p) =>
        updateComposition(p, compId, (c) => ({
          ...c,
          audioTracks: c.audioTracks.map((t) =>
            t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t
          ),
        })),
    };
  },

  updateAudioClip(
    compId: string,
    trackId: string,
    clipId: string,
    patch: Partial<AudioClipDocument>
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Edit Audio Clip',
      affectedIds: [compId, trackId, clipId],
      execute: (p) =>
        updateComposition(p, compId, (c) => ({
          ...c,
          audioTracks: c.audioTracks.map((t) =>
            t.id === trackId
              ? {
                  ...t,
                  clips: t.clips.map((cl) => (cl.id === clipId ? { ...cl, ...patch } : cl)),
                }
              : t
          ),
        })),
    };
  },

  deleteAudioClip(compId: string, trackId: string, clipId: string): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Delete Audio Clip',
      affectedIds: [compId, trackId, clipId],
      execute: (p) =>
        updateComposition(p, compId, (c) => ({
          ...c,
          audioTracks: c.audioTracks.map((t) =>
            t.id === trackId ? { ...t, clips: t.clips.filter((cl) => cl.id !== clipId) } : t
          ),
        })),
    };
  },

  setProjectTimelineClips(clips: ProjectTimelineClip[]): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Update Movie Timeline',
      affectedIds: ['projectTimeline'],
      execute: (p) => ({
        ...p,
        projectTimeline: {
          ...p.projectTimeline,
          clips,
        },
      }),
    };
  },

  addLayerModifier(
    compId: string,
    layerId: string,
    modifier: MotionModifierInstance
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Apply Preset "${modifier.label ?? modifier.presetId}"`,
      affectedIds: [compId, layerId, modifier.id],
      execute: (p) =>
        updateLayer(p, compId, layerId, (l) => ({
          ...l,
          modifiers: [...(l.modifiers ?? []), modifier],
        })),
    };
  },

  updateLayerModifier(
    compId: string,
    layerId: string,
    modifierId: string,
    patch: Partial<MotionModifierInstance>
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Update Motion Preset',
      affectedIds: [compId, layerId, modifierId],
      execute: (p) =>
        updateLayer(p, compId, layerId, (l) => ({
          ...l,
          modifiers: (l.modifiers ?? []).map((m) =>
            m.id === modifierId
              ? {
                  ...m,
                  ...patch,
                  params: patch.params ? { ...m.params, ...patch.params } : m.params,
                }
              : m
          ),
        })),
    };
  },

  removeLayerModifier(compId: string, layerId: string, modifierId: string): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Remove Motion Preset',
      affectedIds: [compId, layerId, modifierId],
      execute: (p) =>
        updateLayer(p, compId, layerId, (l) => ({
          ...l,
          modifiers: (l.modifiers ?? []).filter((m) => m.id !== modifierId),
        })),
    };
  },

  bakeLayerModifiersToKeyframes(
    compId: string,
    layerId: string,
    stepFrames = 6,
    options?: {
      startFrame?: number;
      endFrame?: number;
      removeModifiersAfterBake?: boolean;
      modifierIds?: string[];
    }
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Bake Modifiers to Keyframes',
      affectedIds: [compId, layerId],
      execute: (p) =>
        updateLayer(p, compId, layerId, (l) => {
          const targetIdSet = options?.modifierIds ? new Set(options.modifierIds) : null;
          const activeMods = (l.modifiers ?? []).filter(
            (m) => m.enabled && (!targetIdSet || targetIdSet.has(m.id))
          );
          if (activeMods.length === 0) return l;

          const baseObj = l.objects[0]?.transform ?? {
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            pivotX: 0,
            pivotY: 0,
            opacity: 1,
          };
          const { w: objW, h: objH } = getPrimaryObjectBounds(l);

          const startF = Math.max(0, Math.round(options?.startFrame ?? l.inFrame));
          const defaultEndInclusive = Math.max(startF, l.outFrame - 1);
          const endInclusive = Math.max(
            startF,
            Math.round(options?.endFrame ?? defaultEndInclusive)
          );
          const step = Math.max(1, Math.round(stepFrames));

          const sampleFrames: number[] = [];
          for (let f = startF; f <= endInclusive; f += step) {
            sampleFrames.push(f);
          }
          if (sampleFrames[sampleFrames.length - 1] !== endInclusive) {
            sampleFrames.push(endInclusive);
          }

          const nextKfs: Record<LayerAnimatableProp, Keyframe[]> = {
            x: [],
            y: [],
            rotation: [],
            scaleX: [],
            scaleY: [],
            opacity: [],
          };

          for (const f of sampleFrames) {
            const baseAtF = {
              x: evaluateKeyframes(l.keyframes.x, f, baseObj.x),
              y: evaluateKeyframes(l.keyframes.y, f, baseObj.y),
              rotation: evaluateKeyframes(l.keyframes.rotation, f, baseObj.rotation),
              scaleX: evaluateKeyframes(l.keyframes.scaleX, f, baseObj.scaleX),
              scaleY: evaluateKeyframes(l.keyframes.scaleY, f, baseObj.scaleY),
              pivotX: baseObj.pivotX,
              pivotY: baseObj.pivotY,
              opacity: evaluateKeyframes(l.keyframes.opacity, f, l.opacity),
            };
            const { transform: baked } = applyLayerModifiers(baseAtF, activeMods, f, objW, objH);
            nextKfs.x.push({ id: uid('kf'), frame: f, value: Number(baked.x.toFixed(2)), interpolation: 'linear' });
            nextKfs.y.push({ id: uid('kf'), frame: f, value: Number(baked.y.toFixed(2)), interpolation: 'linear' });
            nextKfs.rotation.push({ id: uid('kf'), frame: f, value: Number(baked.rotation.toFixed(4)), interpolation: 'linear' });
            nextKfs.scaleX.push({ id: uid('kf'), frame: f, value: Number(baked.scaleX.toFixed(4)), interpolation: 'linear' });
            nextKfs.scaleY.push({ id: uid('kf'), frame: f, value: Number(baked.scaleY.toFixed(4)), interpolation: 'linear' });
            nextKfs.opacity.push({ id: uid('kf'), frame: f, value: Number(baked.opacity.toFixed(3)), interpolation: 'linear' });
          }

          const bakedIds = new Set(activeMods.map((m) => m.id));
          const nextModifiers = options?.removeModifiersAfterBake
            ? (l.modifiers ?? []).filter((m) => !bakedIds.has(m.id))
            : (l.modifiers ?? []).map((m) => (bakedIds.has(m.id) ? { ...m, enabled: false } : m));

          return {
            ...l,
            keyframes: nextKfs,
            modifiers: nextModifiers,
          };
        }),
    };
  },

  addCameraModifier(compId: string, modifier: MotionModifierInstance): ProjectCommand {
    return {
      id: uid('cmd'),
      label: `Apply Camera Preset "${modifier.label ?? modifier.presetId}"`,
      affectedIds: [compId, modifier.id],
      execute: (p) =>
        updateComposition(p, compId, (c) => ({
          ...c,
          camera: {
            ...c.camera,
            modifiers: [...(c.camera.modifiers ?? []), modifier],
          },
        })),
    };
  },

  updateCameraModifier(
    compId: string,
    modifierId: string,
    patch: Partial<MotionModifierInstance>
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Update Camera Preset',
      affectedIds: [compId, modifierId],
      execute: (p) =>
        updateComposition(p, compId, (c) => ({
          ...c,
          camera: {
            ...c.camera,
            modifiers: (c.camera.modifiers ?? []).map((m) =>
              m.id === modifierId
                ? {
                    ...m,
                    ...patch,
                    params: patch.params ? { ...m.params, ...patch.params } : m.params,
                  }
                : m
            ),
          },
        })),
    };
  },

  removeCameraModifier(compId: string, modifierId: string): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Remove Camera Preset',
      affectedIds: [compId, modifierId],
      execute: (p) =>
        updateComposition(p, compId, (c) => ({
          ...c,
          camera: {
            ...c.camera,
            modifiers: (c.camera.modifiers ?? []).filter((m) => m.id !== modifierId),
          },
        })),
    };
  },

  bakeCameraModifiersToKeyframes(
    compId: string,
    stepFrames = 6,
    options?: {
      startFrame?: number;
      endFrame?: number;
      removeModifiersAfterBake?: boolean;
      modifierIds?: string[];
    }
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Bake Camera Modifiers to Keyframes',
      affectedIds: [compId],
      execute: (p) =>
        updateComposition(p, compId, (c) => {
          const targetIdSet = options?.modifierIds ? new Set(options.modifierIds) : null;
          const activeMods = (c.camera.modifiers ?? []).filter(
            (m) => m.enabled && (!targetIdSet || targetIdSet.has(m.id))
          );
          if (activeMods.length === 0) return c;

          const startF = Math.max(0, Math.round(options?.startFrame ?? 0));
          const defaultEnd = Math.max(startF, c.settings.durationFrames - 1);
          const endF = Math.max(startF, Math.round(options?.endFrame ?? defaultEnd));
          const step = Math.max(1, Math.round(stepFrames));
          const frames: number[] = [];
          for (let f = startF; f <= endF; f += step) frames.push(f);
          if (frames[frames.length - 1] !== endF) frames.push(endF);

          const kx: Keyframe[] = [];
          const ky: Keyframe[] = [];
          const kz: Keyframe[] = [];
          for (const f of frames) {
            const evalCam = evaluateCameraAtFrame(c, f);
            kx.push({ id: uid('ckf'), frame: f, value: Number(evalCam.x.toFixed(2)), interpolation: 'linear' });
            ky.push({ id: uid('ckf'), frame: f, value: Number(evalCam.y.toFixed(2)), interpolation: 'linear' });
            kz.push({ id: uid('ckf'), frame: f, value: Number(evalCam.zoom.toFixed(3)), interpolation: 'linear' });
          }

          const bakedIds = new Set(activeMods.map((m) => m.id));
          const nextModifiers = options?.removeModifiersAfterBake
            ? (c.camera.modifiers ?? []).filter((m) => !bakedIds.has(m.id))
            : (c.camera.modifiers ?? []).map((m) =>
                bakedIds.has(m.id) ? { ...m, enabled: false } : m
              );

          return {
            ...c,
            camera: {
              ...c.camera,
              keyframes: { x: kx, y: ky, zoom: kz },
              modifiers: nextModifiers,
            },
          };
        }),
    };
  },

  setTextLyrics(
    compId: string,
    layerId: string,
    objectId: string,
    lyrics: LyricsConfig | undefined
  ): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Update Lyrics & Typography Animation',
      affectedIds: [compId, layerId, objectId],
      execute: (p) =>
        updateLayer(p, compId, layerId, (l) => ({
          ...l,
          objects: l.objects.map((o) =>
            o.id === objectId && o.kind === 'text' ? { ...o, lyrics } : o
          ),
        })),
    };
  },

  updateExportSettings(patch: Partial<MotionProject['exportSettings']>): ProjectCommand {
    return {
      id: uid('cmd'),
      label: 'Update Export Settings',
      affectedIds: ['exportSettings'],
      execute: (p) => ({
        ...p,
        exportSettings: {
          ...p.exportSettings,
          ...patch,
        },
      }),
    };
  },
};
