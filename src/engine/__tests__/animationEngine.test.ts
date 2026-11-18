import { describe, expect, it } from 'vitest';
import { CommandManager } from '../../commands/commandManager';
import { ProjectCommands, uid } from '../../commands/projectCommands';
import { validateProject } from '../../schema/projectSchema';
import { createStarterProject } from '../../utils/starterProject';
import {
  applyLayerModifiers,
  evaluateCompositionAtFrame,
  evaluateLyricsAtFrame,
} from '../evaluator';
import { parseLrc, parsePlainLyrics, parseSrt } from '../lyricsParser';
import {
  AnimationPresetRegistry,
  AnimationPresetSchema,
  animationPresetRegistry,
  createModifierFromPreset,
  getAvailablePresets,
  getPresetById,
  PRESET_EXPORT_FORMAT,
  PRESET_REGISTRY,
} from '../../services/AnimationPresetRegistry';
import { evaluatePresetPreviewState } from '../../components/PresetHoverPreview';
import { Canvas2DRenderer } from '../../renderer/Canvas2DRenderer';

describe('Cinematic Animation Engine & Presets', () => {
  it('registers all 42 presets across 7 categories with valid metadata', () => {
    expect(PRESET_REGISTRY.length).toBe(42);
    expect(getAvailablePresets('hair').length).toBe(5);
    expect(getAvailablePresets('clothing').length).toBe(5);
    expect(getAvailablePresets('character').length).toBe(5);
    expect(getAvailablePresets('camera').length).toBe(7);
    expect(getAvailablePresets('environment').length).toBe(8);
    expect(getAvailablePresets('lyrics').length).toBe(9);
    expect(getAvailablePresets('effects').length).toBe(3);

    const hairGentle = getPresetById('hair.gentle-wind');
    expect(hairGentle).toBeDefined();
    expect(hairGentle?.defaultPivot).toBe('top');

    // Every registered preset conforms to the formal AnimationPresetSchema
    for (const preset of PRESET_REGISTRY) {
      const check = AnimationPresetSchema.safeParse(preset);
      expect(check.success, `Invalid preset ${preset.id}`).toBe(true);
    }

    // Singleton identity & filtering
    expect(AnimationPresetRegistry.getInstance()).toBe(animationPresetRegistry);
    expect(animationPresetRegistry.filterByCategory('hair').length).toBe(5);
    expect(animationPresetRegistry.filterByTargetType('camera').length).toBe(7);

    // Retrieve by category and targetType
    expect(getAvailablePresets({ category: 'hair', targetType: 'character-part' }).length).toBe(5);
    expect(getAvailablePresets({ category: 'camera', targetType: 'character-part' }).length).toBe(0);
    expect(animationPresetRegistry.getByTargetType('camera').length).toBe(7);
    expect(animationPresetRegistry.getByTargetType('text').length).toBeGreaterThanOrEqual(12);
    expect(animationPresetRegistry.getJsonSchema().title).toBe('MotionStudioAnimationPreset');

    // Dynamic JSON preset registration & validation in a scoped registry instance
    const customReg = AnimationPresetRegistry.createScoped(PRESET_REGISTRY);
    const badReg = customReg.registerPreset({ id: '', name: 'Invalid' });
    expect(badReg.success).toBe(false);
    const goodReg = customReg.registerPreset({
      id: 'hair.custom-breeze',
      version: '1.0.0',
      name: 'Custom Breeze',
      category: 'hair',
      targetType: ['image', 'character-part'],
      duration: 2.0,
      loop: true,
      parameters: { rotationStrength: 5, speed: 1.2 },
    });
    expect(goodReg.success).toBe(true);
    expect(customReg.hasPreset('hair.custom-breeze')).toBe(true);
    expect(customReg.getById('hair.custom-breeze')?.name).toBe('Custom Breeze');
    expect(customReg.query({ category: 'hair', search: 'custom breeze' }).length).toBe(1);
    expect(customReg.getCategoryCounts().hair).toBe(6);

    const batchRes = customReg.registerPresets([
      { id: '', name: 'Bad' },
      {
        id: 'cloth.cape-drift',
        version: '1.0.0',
        name: 'Cape Drift',
        category: 'clothing',
        targetType: ['sprite', 'character-part'],
        duration: 2.5,
        loop: true,
        parameters: { speed: 1 },
      },
    ]);
    expect(batchRes.registered.length).toBe(1);
    expect(batchRes.errors.length).toBe(1);
    expect(customReg.hasPreset('cloth.cape-drift')).toBe(true);
  });

  it('stacks multiple character idle presets (breathing + blinking + head tilt) without overwriting properties', () => {
    const fps = 24;
    const breath = createModifierFromPreset('character.breathing', fps, 'm_breath')!;
    const blink = createModifierFromPreset('character.eye-blinking', fps, 'm_blink')!;
    const tilt = createModifierFromPreset('character.head-tilt', fps, 'm_tilt')!;

    const base = {
      x: 500,
      y: 360,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      pivotX: 0,
      pivotY: 0,
      opacity: 1,
    };

    // Frame 4 falls inside the blinking window and breathing phase
    const evalBlinkWindow = applyLayerModifiers(base, [breath, blink, tilt], 3, 180, 220);
    // Eye blinking multiplies Y scale cleanly below 1 while head-tilt adds rotation
    expect(evalBlinkWindow.transform.scaleY).toBeLessThan(0.5);
    expect(Math.abs(evalBlinkWindow.transform.rotation)).toBeGreaterThan(0.01);

    // Mid-cycle breathing lifts torso (y < 360) without losing rotation from tilt
    const evalMidCycle = applyLayerModifiers(base, [breath, blink, tilt], 30, 180, 220);
    expect(evalMidCycle.transform.y).toBeLessThan(360);
    expect(Math.abs(evalMidCycle.transform.rotation)).toBeGreaterThan(0.01);
  });

  it('supports deterministic mesh deformation for hair/clothing and bakes modifiers to undoable keyframes', () => {
    const baseProject = createStarterProject();
    const comp = baseProject.compositions[0];
    const targetLayer = comp.layers[0];
    const mod = createModifierFromPreset('cloth.scarf-flutter', 24, uid('mod'))!;

    const cm = new CommandManager();
    const addRes = cm.dispatch(
      baseProject,
      ProjectCommands.addLayerModifier(comp.id, targetLayer.id, mod)
    );
    expect(addRes.ok).toBe(true);
    if (!addRes.ok) return;

    const evalWithMod = evaluateCompositionAtFrame(addRes.project, comp.id, 12);
    const evalLayer = evalWithMod?.layers.find((l) => l.layer.id === targetLayer.id);
    expect(evalLayer?.objects[0].meshDeform).toBeDefined();
    expect(evalLayer?.objects[0].meshDeform?.anchorEdge).toBe('left');

    // Bake to keyframes and verify deterministic frame parity
    const preBakeF12 = evalLayer!.worldTransform;
    const bakeRes = cm.dispatch(
      addRes.project,
      ProjectCommands.bakeLayerModifiersToKeyframes(comp.id, targetLayer.id, 6)
    );
    expect(bakeRes.ok).toBe(true);
    if (!bakeRes.ok) return;

    const postBakeState = evaluateCompositionAtFrame(bakeRes.project, comp.id, 12);
    const postBakeLayer = postBakeState?.layers.find((l) => l.layer.id === targetLayer.id);
    expect(postBakeLayer?.layer.keyframes.x.length).toBeGreaterThan(2);
    expect(postBakeLayer?.layer.modifiers[0].enabled).toBe(false);
    expect(Math.abs(postBakeLayer!.worldTransform.x - preBakeF12.x)).toBeLessThan(0.5);
    expect(Math.abs(postBakeLayer!.worldTransform.y - preBakeF12.y)).toBeLessThan(0.5);

    // Undo restores active modifier
    const undone = cm.undo(bakeRes.project);
    expect(undone).not.toBeNull();
    const restoredLayer = undone!.project.compositions[0].layers.find(
      (l) => l.id === targetLayer.id
    );
    expect(restoredLayer?.modifiers[0].enabled).toBe(true);
  });

  it('evaluates camera zoom, shake, and follow-object tracking deterministically', () => {
    const project = createStarterProject();
    const comp = project.compositions[0];
    const targetLayer = comp.layers[0];
    const cm = new CommandManager();

    const zoomMod = createModifierFromPreset('camera.slow-zoom-in', 24, 'cam_zoom')!;
    const followMod = createModifierFromPreset('camera.follow-object', 24, 'cam_follow')!;

    let res = cm.dispatch(project, ProjectCommands.addCameraModifier(comp.id, zoomMod));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    res = cm.dispatch(res.project, ProjectCommands.addCameraModifier(comp.id, followMod));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    res = cm.dispatch(
      res.project,
      ProjectCommands.updateCamera(comp.id, { followLayerId: targetLayer.id })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Animate target layer horizontally
    res = cm.dispatch(
      res.project,
      ProjectCommands.setLayerKeyframe(comp.id, targetLayer.id, 'x', 0, 200, 'linear')
    );
    if (!res.ok) return;
    res = cm.dispatch(
      res.project,
      ProjectCommands.setLayerKeyframe(comp.id, targetLayer.id, 'x', 72, 920, 'linear')
    );
    if (!res.ok) return;

    const evalStart = evaluateCompositionAtFrame(res.project, comp.id, 0)!;
    const evalEnd = evaluateCompositionAtFrame(res.project, comp.id, 72)!;

    expect(evalEnd.camera.zoom).toBeGreaterThan(evalStart.camera.zoom);
    expect(evalEnd.camera.x).toBeGreaterThan(evalStart.camera.x + 600);
  });

  it('parses LRC, SRT, and plain lyrics and evaluates karaoke & typewriter timing', () => {
    const lrc = `[00:01.00]Hello bright world\n[00:03.00]Dance under stars`;
    const lrcCues = parseLrc(lrc, 24);
    expect(lrcCues.length).toBe(2);
    expect(lrcCues[0].startFrame).toBe(24);
    expect(lrcCues[0].endFrame).toBe(72);
    expect(lrcCues[0].words.map((w) => w.text)).toEqual(['Hello', 'bright', 'world']);

    const srt = `1\n00:00:01,000 --> 00:00:03,000\nMoonlit sky\n`;
    const srtCues = parseSrt(srt, 24);
    expect(srtCues.length).toBe(1);
    expect(srtCues[0].startFrame).toBe(24);
    expect(srtCues[0].endFrame).toBe(72);

    const plainCues = parsePlainLyrics('Line one\nLine two', 24, 0, 2);
    expect(plainCues.length).toBe(2);
    expect(plainCues[1].startFrame).toBe(48);

    const karaokeState = evaluateLyricsAtFrame(
      {
        enabled: true,
        style: 'karaoke',
        highlightColor: '#F59E0B',
        glowColor: '#38BDF8',
        glowBlur: 10,
        shadowColor: 'rgba(0,0,0,0.6)',
        shadowBlur: 5,
        staggerFrames: 3,
        beatBpm: 120,
        beatSyncIntensity: 0.2,
        cues: lrcCues,
      },
      'Fallback',
      30,
      24
    )!;
    expect(karaokeState.text).toBe('Hello bright world');
    expect(karaokeState.words[0].isActive).toBe(true);

    const typewriterState = evaluateLyricsAtFrame(
      {
        enabled: true,
        style: 'typewriter',
        highlightColor: '#F59E0B',
        glowColor: '#38BDF8',
        glowBlur: 0,
        shadowColor: 'rgba(0,0,0,0.6)',
        shadowBlur: 0,
        staggerFrames: 2,
        beatBpm: 120,
        beatSyncIntensity: 0,
        cues: lrcCues,
      },
      'Fallback',
      45,
      24
    )!;
    expect(typewriterState.visibleCharCount).toBeGreaterThan(5);
    expect(typewriterState.visibleCharCount).toBeLessThanOrEqual('Hello bright world'.length);
  });

  it('migrates and validates legacy project JSON missing new environment/modifier fields', () => {
    const project = createStarterProject() as unknown as Record<string, unknown>;
    const clone = structuredClone(project) as {
      compositions: Array<{
        camera: Record<string, unknown>;
        environment: Record<string, unknown>;
        layers: Array<Record<string, unknown>>;
      }>;
    };
    delete clone.compositions[0].camera.modifiers;
    delete clone.compositions[0].environment.fogOpacity;
    delete clone.compositions[0].environment.windDirection;
    delete clone.compositions[0].layers[0].modifiers;

    const validated = validateProject(clone);
    expect(validated.success).toBe(true);
    if (validated.success) {
      expect(validated.data.compositions[0].camera.modifiers).toEqual([]);
      expect(validated.data.compositions[0].environment.windDirection).toBe('right');
      expect(validated.data.compositions[0].layers[0].modifiers).toEqual([]);
    }
  });

  it('applies non-destructive motion presets to active layer via useStudioStore.apply_motion_preset and updates parameters in real time', async () => {
    const { useStudioStore } = await import('../../store/useStudioStore');
    const store = useStudioStore.getState();
    const comp = store.project.compositions.find((c) => c.id === store.activeCompositionId)!;
    const targetLayer = comp.layers.find((l) => l.id === store.selectedLayerId) ?? comp.layers[0];
    expect(targetLayer).toBeDefined();

    const initialModifierCount = targetLayer.modifiers.length;
    const applied = store.apply_motion_preset('hair.gentle-wind', {
      layerId: targetLayer.id,
    });
    expect(applied.ok).toBe(true);
    expect(applied.targetScope).toBe('layer');
    expect(applied.modifierId).toBeDefined();

    const afterApply = useStudioStore.getState();
    expect(afterApply.selectedModifierId).toBe(applied.modifierId);
    const updatedLayer = afterApply.project.compositions
      .find((c) => c.id === comp.id)!
      .layers.find((l) => l.id === targetLayer.id)!;
    expect(updatedLayer.modifiers.length).toBe(initialModifierCount + 1);

    const addedMod = updatedLayer.modifiers.find((m) => m.id === applied.modifierId)!;
    expect(addedMod.presetId).toBe('hair.gentle-wind');

    // Update speed, intensity, and preset-specific parameter
    const updateOk = afterApply.updateMotionModifier(
      addedMod.id,
      {
        speed: 1.75,
        intensity: 1.35,
        params: { ...addedMod.params, waveFrequency: 2.6 },
      },
      { layerId: targetLayer.id, targetScope: 'layer' }
    );
    expect(updateOk).toBe(true);

    const afterUpdate = useStudioStore.getState();
    const modifiedLayer = afterUpdate.project.compositions
      .find((c) => c.id === comp.id)!
      .layers.find((l) => l.id === targetLayer.id)!;
    const modifiedMod = modifiedLayer.modifiers.find((m) => m.id === addedMod.id)!;
    expect(modifiedMod.speed).toBe(1.75);
    expect(modifiedMod.intensity).toBe(1.35);
    expect(modifiedMod.params.waveFrequency).toBe(2.6);

    // Non-destructive removal restores modifier count and clears selectedModifierId
    const removeOk = afterUpdate.removeMotionModifier(addedMod.id, {
      layerId: targetLayer.id,
      targetScope: 'layer',
    });
    expect(removeOk).toBe(true);
    const afterRemove = useStudioStore.getState();
    expect(afterRemove.selectedModifierId).toBeNull();
    const finalLayer = afterRemove.project.compositions
      .find((c) => c.id === comp.id)!
      .layers.find((l) => l.id === targetLayer.id)!;
    expect(finalLayer.modifiers.length).toBe(initialModifierCount);
  });

  it('supports baking layer and camera modifiers with custom frame ranges, step cadences, and optional removal', () => {
    const project = createStarterProject();
    const comp = project.compositions[0];
    const layer = comp.layers[0];
    const cm = new CommandManager();

    const layerMod = createModifierFromPreset('hair.gentle-wind', 24, uid('mod'))!;
    const camMod = createModifierFromPreset('camera.slow-zoom-in', 24, uid('cmod'))!;

    let res = cm.dispatch(project, ProjectCommands.addLayerModifier(comp.id, layer.id, layerMod));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    res = cm.dispatch(res.project, ProjectCommands.addCameraModifier(comp.id, camMod));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Bake layer modifiers only over frames 12..36 with stepFrames=4 and removeModifiersAfterBake=true
    res = cm.dispatch(
      res.project,
      ProjectCommands.bakeLayerModifiersToKeyframes(comp.id, layer.id, 4, {
        startFrame: 12,
        endFrame: 36,
        removeModifiersAfterBake: true,
      })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const bakedLayer = res.project.compositions[0].layers.find((l) => l.id === layer.id)!;
    expect(bakedLayer.modifiers.length).toBe(0);
    expect(bakedLayer.keyframes.x.map((k) => k.frame)).toEqual([12, 16, 20, 24, 28, 32, 36]);

    // Bake camera modifiers over frames 0..48 with stepFrames=12 and non-destructive disable
    res = cm.dispatch(
      res.project,
      ProjectCommands.bakeCameraModifiersToKeyframes(comp.id, 12, {
        startFrame: 0,
        endFrame: 48,
        removeModifiersAfterBake: false,
      })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const bakedComp = res.project.compositions[0];
    expect(bakedComp.camera.keyframes.zoom.map((k) => k.frame)).toEqual([0, 12, 24, 36, 48]);
    expect(bakedComp.camera.modifiers.length).toBe(1);
    expect(bakedComp.camera.modifiers[0].enabled).toBe(false);
  });

  it('notifies subscribers cleanly on preset registration, batch registration, and unregistration', () => {
    const scoped = AnimationPresetRegistry.createScoped(PRESET_REGISTRY);
    const initialRevision = scoped.getRevision();
    let notifications = 0;
    const unsubscribe = scoped.subscribe(() => {
      notifications += 1;
    });

    // Single valid registration notifies once and increments revision
    const regOne = scoped.registerPreset({
      id: 'hair.dynamic-ribbon',
      version: '1.0.0',
      name: 'Dynamic Ribbon',
      category: 'hair',
      targetType: ['image', 'character-part'],
      duration: 2.0,
      loop: true,
      parameters: { rotationStrength: 6, speed: 1.1 },
    });
    expect(regOne.success).toBe(true);
    expect(notifications).toBe(1);
    expect(scoped.getRevision()).toBe(initialRevision + 1);
    expect(scoped.query({ category: 'hair' }).some((p) => p.id === 'hair.dynamic-ribbon')).toBe(
      true
    );

    // Invalid registration should not notify
    const regBad = scoped.registerPreset({ id: '', name: 'Bad' });
    expect(regBad.success).toBe(false);
    expect(notifications).toBe(1);

    // Batch registration notifies once for the whole batch
    const batch = scoped.registerPresets([
      {
        id: 'character.nod-idle',
        version: '1.0.0',
        name: 'Gentle Nod',
        category: 'character',
        targetType: ['character-part'],
        duration: 2.4,
        loop: true,
        parameters: { speed: 1.0 },
      },
      {
        id: 'lyrics.pulse-glow',
        version: '1.0.0',
        name: 'Pulse Glow',
        category: 'lyrics',
        targetType: ['text'],
        duration: 1.5,
        loop: true,
        parameters: { speed: 1.0 },
      },
    ]);
    expect(batch.registered.length).toBe(2);
    expect(notifications).toBe(2);
    expect(scoped.getCategoryCounts().character).toBe(6);
    expect(scoped.getCategoryCounts().lyrics).toBe(10);

    // Unregister notifies and removes from query results
    expect(scoped.unregisterPreset('hair.dynamic-ribbon')).toBe(true);
    expect(notifications).toBe(3);
    expect(scoped.unregisterPreset('hair.dynamic-ribbon')).toBe(false);
    expect(notifications).toBe(3);

    // Unsubscribe stops future notifications
    unsubscribe();
    expect(scoped.unregisterPreset('character.nod-idle')).toBe(true);
    expect(notifications).toBe(3);
  });

  it('evaluates deterministic miniature hover preview playback loops across all 7 preset categories', () => {
    for (const preset of PRESET_REGISTRY) {
      const startState = evaluatePresetPreviewState(preset, 0.25);
      const midState = evaluatePresetPreviewState(preset, 1.15);

      expect(Number.isFinite(startState.progress)).toBe(true);
      expect(Number.isFinite(midState.progress)).toBe(true);

      if (preset.category === 'environment') {
        expect(startState.kind).toBe('environment');
        if (startState.kind === 'environment' && preset.environmentPatch?.weatherType) {
          expect(startState.particles.length).toBeGreaterThan(0);
        }
      } else if (preset.category === 'camera') {
        expect(startState.kind).toBe('camera');
        if (startState.kind === 'camera' && midState.kind === 'camera') {
          expect(Number.isFinite(midState.camera.zoom)).toBe(true);
          expect(Number.isFinite(midState.camera.x)).toBe(true);
        }
      } else if (preset.category === 'lyrics') {
        expect(startState.kind).toBe('lyrics');
        if (startState.kind === 'lyrics') {
          expect(startState.lyricsState.text).toBe('Shine bright tonight');
        }
      } else {
        expect(startState.kind).toBe('layer');
        if (startState.kind === 'layer' && midState.kind === 'layer') {
          expect(Number.isFinite(midState.transform.x)).toBe(true);
          expect(Number.isFinite(midState.transform.rotation)).toBe(true);
          expect(Number.isFinite(midState.transform.scaleY)).toBe(true);
        }
      }
    }

    // Verify hair wind preset produces real mesh deformation in miniature preview
    const hairPreset = getPresetById('hair.gentle-wind')!;
    const hairFrame = evaluatePresetPreviewState(hairPreset, 0.75);
    expect(hairFrame.kind).toBe('layer');
    if (hairFrame.kind === 'layer') {
      expect(hairFrame.meshDeform).toBeDefined();
      expect(hairFrame.meshDeform?.anchorEdge).toBe('top');
    }
  });

  it('creates custom presets from modifiers, exports them to JSON bundles, and imports user-created presets', () => {
    const artistA = AnimationPresetRegistry.createScoped(PRESET_REGISTRY);
    const tunedMod = artistA.createModifier('hair.gentle-wind', 24, 'mod_tuned', {
      intensity: 1.5,
      speed: 1.4,
      params: { rotationStrength: 9, movementStrength: 11, meshDeform: 8, windDirection: 'left' },
    })!;

    const saved = artistA.createCustomPresetFromModifier(tunedMod, {
      name: 'Sunset Hair Gust',
      description: 'Leftward twilight breeze',
      fps: 24,
    });
    expect(saved.success).toBe(true);
    if (!saved.success) return;

    expect(artistA.isCustomPreset(saved.preset.id)).toBe(true);
    expect(artistA.getCustomPresets().length).toBe(1);
    expect(saved.preset.basePresetId).toBe('hair.gentle-wind');
    expect(saved.preset.defaultIntensity).toBe(1.5);

    // Export only custom presets to JSON bundle
    const exportedJson = artistA.exportPresetsToJson({ includeBuiltIn: false });
    const parsedBundle = JSON.parse(exportedJson);
    expect(parsedBundle.format).toBe(PRESET_EXPORT_FORMAT);
    expect(parsedBundle.presetCount).toBe(1);
    expect(parsedBundle.presets[0].id).toBe(saved.preset.id);

    // Import into another artist's registry and verify notification & animation parity
    const artistB = AnimationPresetRegistry.createScoped(PRESET_REGISTRY);
    let importNotifications = 0;
    artistB.subscribe(() => {
      importNotifications += 1;
    });

    const importRes = artistB.importPresetsFromJson(exportedJson);
    expect(importRes.ok).toBe(true);
    expect(importRes.imported.length).toBe(1);
    expect(importNotifications).toBe(1);
    expect(artistB.isCustomPreset(saved.preset.id)).toBe(true);

    const importedMod = artistB.createModifier(saved.preset.id, 24, 'mod_imported')!;
    const base = {
      x: 100,
      y: 100,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      pivotX: 0,
      pivotY: 0,
      opacity: 1,
    };
    const evalOriginal = applyLayerModifiers(base, [tunedMod], 18, 160, 200);
    const evalImported = applyLayerModifiers(base, [importedMod], 18, 160, 200);
    expect(evalImported.transform.rotation).toBeCloseTo(evalOriginal.transform.rotation, 4);
    expect(evalImported.transform.x).toBeCloseTo(evalOriginal.transform.x, 4);
    expect(evalImported.meshDeform?.amplitude).toBeCloseTo(evalOriginal.meshDeform!.amplitude, 4);

    // Supports single preset JSON import & protects built-in IDs when overwriteBuiltIn=false
    const singleImport = artistB.importPresetsFromJson(
      JSON.stringify([
        {
          id: 'hair.gentle-wind',
          version: '1.0.0',
          name: 'Attempt Overwrite Builtin',
          category: 'hair',
          targetType: ['image'],
          duration: 2,
          loop: true,
          parameters: { speed: 1 },
        },
        {
          id: 'fx.user-prism',
          version: '1.0.0',
          name: 'User Prism Hover',
          category: 'effects',
          targetType: ['sprite'],
          duration: 2.2,
          loop: true,
          basePresetId: 'fx.float-hover',
          parameters: { movementStrength: 16, speed: 1.3 },
        },
      ])
    );
    expect(singleImport.imported.map((p) => p.id)).toEqual(['fx.user-prism']);
    expect(singleImport.skipped.map((s) => s.id)).toEqual(['hair.gentle-wind']);

    // Handles malformed JSON gracefully
    const badJson = artistB.importPresetsFromJson('{ not valid json');
    expect(badJson.ok).toBe(false);
    expect(badJson.errors.length).toBe(1);
  });

  it('exposes full direction, angle, and root-anchor controls across hair & cloth presets and evaluates 2D vectors', () => {
    const hairAndCloth = [
      ...getAvailablePresets('hair'),
      ...getAvailablePresets('clothing'),
    ];
    expect(hairAndCloth.length).toBe(10);
    for (const preset of hairAndCloth) {
      const keys = preset.parameterControls.map((c) => c.key);
      expect(keys).toContain('windDirection');
      expect(keys).toContain('windAngle');
    }

    const base = {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      pivotX: 0,
      pivotY: 0,
      opacity: 1,
    };

    // Custom 45-degree wind angle + left root anchor
    const customAngleMod = createModifierFromPreset('hair.gentle-wind', 24, 'mod_dir_45', {
      params: {
        rotationStrength: 4,
        movementStrength: 10,
        meshDeform: 8,
        windDirection: 'custom',
        windAngle: 45,
        anchorEdge: 'left',
      },
    })!;
    const eval45 = applyLayerModifiers(base, [customAngleMod], 15, 200, 300);
    expect(eval45.meshDeform?.anchorEdge).toBe('left');
    expect(Math.abs(eval45.meshDeform?.amplitude ?? 0)).toBeGreaterThan(0.1);
    expect(Math.abs(eval45.meshDeform?.amplitudeY ?? 0)).toBeGreaterThan(0.1);
    expect(eval45.transform.y).not.toBe(0);

    // Upward wind direction drives negative vertical offset & vertical mesh wave
    const upMod = createModifierFromPreset('cloth.gentle-sway', 24, 'mod_dir_up', {
      params: {
        rotationStrength: 0,
        movementStrength: 8,
        meshDeform: 6,
        windDirection: 'up',
      },
    })!;
    const evalUp = applyLayerModifiers(base, [upMod], 15, 200, 300);
    expect(evalUp.transform.x).toBeCloseTo(0, 5);
    expect(evalUp.transform.y).toBeLessThan(0);
    expect(evalUp.meshDeform?.amplitude).toBeCloseTo(0, 5);
    expect(evalUp.meshDeform?.amplitudeY).toBeLessThan(0);
  });

  it('renders mesh deformation using high-density sheared micro-strips instead of coarse un-sheared blocks', () => {
    const renderer = new Canvas2DRenderer() as unknown as {
      drawImageWithMeshDeform: (
        ctx: unknown,
        img: unknown,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
        deform: {
          amplitude: number;
          amplitudeY?: number;
          frequency: number;
          phase: number;
          anchorEdge: 'top' | 'bottom' | 'left' | 'right';
          axis: 'x' | 'y';
        },
        quality: 'full' | 'reduced'
      ) => void;
    };

    let drawCalls = 0;
    let transformCalls = 0;
    let hasNonZeroShear = false;
    const mockCtx = {
      save: () => {},
      restore: () => {},
      translate: () => {},
      transform: (_a: number, b: number, c: number) => {
        transformCalls += 1;
        if (Math.abs(b) > 1e-4 || Math.abs(c) > 1e-4) {
          hasNonZeroShear = true;
        }
      },
      drawImage: () => {
        drawCalls += 1;
      },
    };

    renderer.drawImageWithMeshDeform(
      mockCtx,
      {},
      0,
      0,
      400,
      600,
      -200,
      -300,
      400,
      600,
      {
        amplitude: 12,
        amplitudeY: 4,
        frequency: 1.5,
        phase: 0.7,
        anchorEdge: 'top',
        axis: 'x',
      },
      'full'
    );

    expect(drawCalls).toBeGreaterThanOrEqual(36);
    expect(transformCalls).toBe(drawCalls);
    expect(hasNonZeroShear).toBe(true);
  });
});
