import { describe, expect, it } from 'vitest';
import { CommandManager } from '../../commands/commandManager';
import { ProjectCommands, uid } from '../../commands/projectCommands';
import { validateProject } from '../../schema/projectSchema';
import { parseMotionXArchive, serializeMotionXArchive } from '../../storage/IndexedDbStorage';
import { createBlankComposition, createStarterProject } from '../../utils/starterProject';
import { wouldCreateCompositionCycle, wouldCreateLayerParentCycle } from '../cycleDetection';
import {
  applyInterpolation,
  evaluateCompositionAtFrame,
  evaluateProjectTimelineAtFrame,
} from '../evaluator';
import { computeLayerMotionPath } from '../motionPath';

describe('Motion Studio Core Engine & Commands', () => {
  it('validates starter project and round-trips through .motionx archive', () => {
    const project = createStarterProject();
    const validation = validateProject(project);
    expect(validation.success).toBe(true);

    const serialized = serializeMotionXArchive(project);
    const parsed = parseMotionXArchive(serialized);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.project.name).toBe('The Lost Kingdom');
      expect(parsed.project.compositions.length).toBe(2);
    }
  });

  it('evaluates keyframes and character sprite frames deterministically at arbitrary frames', () => {
    const project = createStarterProject();
    const comp = project.compositions[0];

    const evalA = evaluateCompositionAtFrame(project, comp.id, 96);
    const evalB = evaluateCompositionAtFrame(project, comp.id, 96);
    expect(evalA).not.toBeNull();
    expect(evalB).not.toBeNull();

    const travelerA = evalA!.layers.find((l) => l.layer.id === 'layer_traveler')!;
    const travelerB = evalB!.layers.find((l) => l.layer.id === 'layer_traveler')!;
    expect(travelerA.worldTransform.x).toBeCloseTo(travelerB.worldTransform.x, 5);
    expect(travelerA.worldTransform.x).toBeGreaterThan(240);
    expect(travelerA.worldTransform.x).toBeLessThan(920);
    expect(travelerA.objects[0].characterFrameIndex).toBe(
      travelerB.objects[0].characterFrameIndex
    );
  });

  it('supports undo/redo via CommandManager and pre-compose workflow', () => {
    const manager = new CommandManager();
    let project = createStarterProject();
    const compId = project.compositions[0].id;
    const initialCount = project.compositions.length;
    const targetLayers = [
      project.compositions[0].layers[1].id,
      project.compositions[0].layers[2].id,
    ];

    const res = manager.dispatch(
      project,
      ProjectCommands.preComposeLayers(compId, targetLayers, 'Hero Group')
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    project = res.project;

    expect(project.compositions.length).toBe(initialCount + 1);
    const parentComp = project.compositions.find((c) => c.id === compId)!;
    expect(parentComp.layers.some((l) => l.objects[0]?.kind === 'nestedComposition')).toBe(true);

    // Evaluate nested composition inside parent
    const evalParent = evaluateCompositionAtFrame(project, compId, 48);
    const nestedLayer = evalParent?.layers.find(
      (l) => l.objects[0]?.object.kind === 'nestedComposition'
    );
    expect(nestedLayer?.objects[0].nestedComposition).toBeDefined();

    // Undo restores original layers and removes pre-comp
    const undone = manager.undo(project);
    expect(undone).not.toBeNull();
    expect(undone!.project.compositions.length).toBe(initialCount);

    // Redo reapplies pre-compose cleanly
    const redone = manager.redo();
    expect(redone).not.toBeNull();
    expect(redone!.project.compositions.length).toBe(initialCount + 1);
  });

  it('rejects circular Composition nesting dependencies', () => {
    const manager = new CommandManager();
    let project = createStarterProject();
    const compA = project.compositions[0].id;
    const compB = project.compositions[1].id;

    // Self-nesting must fail
    expect(wouldCreateCompositionCycle(project.compositions, compA, compA)).toBe(true);
    const selfRes = manager.dispatch(
      project,
      ProjectCommands.nestCompositionLayer(compA, compA)
    );
    expect(selfRes.ok).toBe(false);

    // Valid nest: compB inside compA
    const nestRes = manager.dispatch(
      project,
      ProjectCommands.nestCompositionLayer(compA, compB)
    );
    expect(nestRes.ok).toBe(true);
    if (!nestRes.ok) return;
    project = nestRes.project;

    // Reverse nest: compA inside compB would create A -> B -> A cycle -> must be rejected!
    const cycleRes = manager.dispatch(
      project,
      ProjectCommands.nestCompositionLayer(compB, compA)
    );
    expect(cycleRes.ok).toBe(false);
  });

  it('rejects circular Layer parenting and composes valid parent transforms', () => {
    const manager = new CommandManager();
    let project = createStarterProject();
    const comp = project.compositions[0];
    const layerA = comp.layers[0].id;
    const layerB = comp.layers[1].id;

    expect(wouldCreateLayerParentCycle(comp.layers, layerA, layerA)).toBe(true);
    const resValid = manager.dispatch(
      project,
      ProjectCommands.setLayerParent(comp.id, layerA, layerB)
    );
    expect(resValid.ok).toBe(true);
    if (!resValid.ok) return;
    project = resValid.project;

    const resCycle = manager.dispatch(
      project,
      ProjectCommands.setLayerParent(comp.id, layerB, layerA)
    );
    expect(resCycle.ok).toBe(false);
  });

  it('replaces source asset non-destructively while preserving instance transforms across Compositions', () => {
    const manager = new CommandManager();
    let project = createStarterProject();
    const archwayId = 'asset_archway';

    const comp2Before = project.compositions[1].layers.find((l) => l.id === 'layer_c2_gate')!;
    const origX = comp2Before.objects[0].transform.x;

    const res = manager.dispatch(
      project,
      ProjectCommands.replaceAssetSource(archwayId, {
        name: 'Crystal Rune Gate',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        width: 500,
        height: 500,
        hash: 'new_hash_123',
      })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    project = res.project;

    const updatedAsset = project.assets.find((a) => a.id === archwayId)!;
    expect(updatedAsset.name).toBe('Crystal Rune Gate');

    const comp2After = project.compositions[1].layers.find((l) => l.id === 'layer_c2_gate')!;
    expect(comp2After.objects[0].transform.x).toBe(origX);
  });

  it('evaluates Project Timeline transitions across multiple Compositions', () => {
    const project = createStarterProject();
    const newComp = createBlankComposition('03 - Epilogue');
    project.compositions.push(newComp);
    expect(newComp.id).toContain('comp_');

    // Frame 180 is inside the crossDissolve overlap between Comp 1 (0..192) and Comp 2 (176..320)
    const evalMid = evaluateProjectTimelineAtFrame(project, 180);
    expect(evalMid.primary).not.toBeNull();
    expect(evalMid.outgoing).not.toBeNull();
    expect(evalMid.transitionType).toBe('crossDissolve');
    expect(evalMid.transitionProgress).toBeGreaterThan(0);
    expect(evalMid.transitionProgress).toBeLessThan(1);
    expect(uid('test')).toContain('test_');
  });

  it('manages layer keyframes and interpolation curves for opacity, position, and rotation', () => {
    const manager = new CommandManager();
    let project = createStarterProject();
    const comp = project.compositions[0];
    const layer = comp.layers[0];

    // Add opacity keyframes at frame 0 (0) and frame 24 (1) with linear interpolation
    let res = manager.dispatch(
      project,
      ProjectCommands.setLayerKeyframe(comp.id, layer.id, 'opacity', 0, 0, 'linear')
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    project = res.project;

    res = manager.dispatch(
      project,
      ProjectCommands.setLayerKeyframe(comp.id, layer.id, 'opacity', 24, 1, 'linear')
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    project = res.project;

    // Linear midpoint at frame 12 should evaluate to ~0.5
    const evalLinear = evaluateCompositionAtFrame(project, comp.id, 12);
    const linearLayer = evalLinear!.layers.find((l) => l.layer.id === layer.id)!;
    expect(linearLayer.effectiveOpacity).toBeCloseTo(0.5, 3);

    // Switch first keyframe interpolation to 'hold' via updateLayerKeyframe
    const updatedLayer = project.compositions[0].layers.find((l) => l.id === layer.id)!;
    const kf0 = updatedLayer.keyframes.opacity[0];
    res = manager.dispatch(
      project,
      ProjectCommands.updateLayerKeyframe(comp.id, layer.id, 'opacity', kf0.id, {
        interpolation: 'hold',
      })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    project = res.project;

    const evalHold = evaluateCompositionAtFrame(project, comp.id, 12);
    const holdLayer = evalHold!.layers.find((l) => l.layer.id === layer.id)!;
    expect(holdLayer.effectiveOpacity).toBeCloseTo(0, 5);

    // Clear opacity keyframes and verify undo restores them
    const preClearCount =
      project.compositions[0].layers.find((l) => l.id === layer.id)!.keyframes.opacity.length;
    res = manager.dispatch(
      project,
      ProjectCommands.clearLayerPropertyKeyframes(comp.id, layer.id, 'opacity')
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(
      res.project.compositions[0].layers.find((l) => l.id === layer.id)!.keyframes.opacity.length
    ).toBe(0);

    const undone = manager.undo(res.project);
    expect(undone).not.toBeNull();
    expect(
      undone!.project.compositions[0].layers.find((l) => l.id === layer.id)!.keyframes.opacity.length
    ).toBe(preClearCount);
  });

  it('applies Linear, Ease-In, Ease-Out, and Ease-In-Out curves to property transitions', () => {
    expect(applyInterpolation(0.5, 'linear')).toBeCloseTo(0.5, 5);
    expect(applyInterpolation(0.5, 'easeIn')).toBeCloseTo(0.125, 5);
    expect(applyInterpolation(0.5, 'easeOut')).toBeCloseTo(0.875, 5);
    expect(applyInterpolation(0.25, 'easeInOut')).toBeCloseTo(0.0625, 5);
    expect(applyInterpolation(0.5, 'easeInOut')).toBeCloseTo(0.5, 5);

    const manager = new CommandManager();
    let project = createStarterProject();
    const comp = project.compositions[0];
    const layer = comp.layers[1];

    // Clear existing x keyframes and set 0 -> 400 over frames 0..40 with easeIn
    let res = manager.dispatch(
      project,
      ProjectCommands.clearLayerPropertyKeyframes(comp.id, layer.id, 'x')
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    project = res.project;

    res = manager.dispatch(
      project,
      ProjectCommands.setLayerKeyframe(comp.id, layer.id, 'x', 0, 0, 'easeIn')
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    project = res.project;

    res = manager.dispatch(
      project,
      ProjectCommands.setLayerKeyframe(comp.id, layer.id, 'x', 40, 400, 'linear')
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    project = res.project;

    // At frame 20 (t = 0.5), easeIn yields 0.125 * 400 = 50
    const evalEaseIn = evaluateCompositionAtFrame(project, comp.id, 20)!;
    const xEaseIn = evalEaseIn.layers.find((l) => l.layer.id === layer.id)!.worldTransform.x;
    expect(xEaseIn).toBeCloseTo(50, 3);

    // Switch transition to easeOut -> yields 0.875 * 400 = 350 at frame 20
    const kf0 = project.compositions[0].layers.find((l) => l.id === layer.id)!.keyframes.x[0];
    res = manager.dispatch(
      project,
      ProjectCommands.updateLayerKeyframe(comp.id, layer.id, 'x', kf0.id, {
        interpolation: 'easeOut',
      })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    project = res.project;

    const evalEaseOut = evaluateCompositionAtFrame(project, comp.id, 20)!;
    const xEaseOut = evalEaseOut.layers.find((l) => l.layer.id === layer.id)!.worldTransform.x;
    expect(xEaseOut).toBeCloseTo(350, 3);
  });

  it('computes spatial motion paths, curved easing arcs, velocity dots, and drag overrides', () => {
    const manager = new CommandManager();
    let project = createStarterProject();
    const comp = project.compositions[0];

    // Layer without spatial keyframes returns null
    const staticLayer = comp.layers.find(
      (l) => l.keyframes.x.length === 0 && l.keyframes.y.length === 0 && !l.parentId
    )!;
    expect(staticLayer).toBeDefined();
    expect(computeLayerMotionPath(project, comp.id, staticLayer.id)).toBeNull();

    // Animate layer[1] from (100, 100) at frame 0 to (500, 500) at frame 36 with distinct X/Y easing
    const layer = comp.layers[1];
    for (const prop of ['x', 'y'] as const) {
      const clearRes = manager.dispatch(
        project,
        ProjectCommands.clearLayerPropertyKeyframes(comp.id, layer.id, prop)
      );
      expect(clearRes.ok).toBe(true);
      if (clearRes.ok) project = clearRes.project;
    }

    const cmds = [
      ProjectCommands.setLayerKeyframe(comp.id, layer.id, 'x', 0, 100, 'easeIn'),
      ProjectCommands.setLayerKeyframe(comp.id, layer.id, 'x', 36, 500, 'linear'),
      ProjectCommands.setLayerKeyframe(comp.id, layer.id, 'y', 0, 100, 'easeOut'),
      ProjectCommands.setLayerKeyframe(comp.id, layer.id, 'y', 36, 500, 'linear'),
    ];
    for (const cmd of cmds) {
      const res = manager.dispatch(project, cmd);
      expect(res.ok).toBe(true);
      if (res.ok) project = res.project;
    }

    const path = computeLayerMotionPath(project, comp.id, layer.id);
    expect(path).not.toBeNull();
    expect(path!.startFrame).toBe(0);
    expect(path!.endFrame).toBe(36);
    expect(path!.nodes.map((n) => n.frame)).toEqual([0, 36]);
    expect(path!.points.length).toBeGreaterThanOrEqual(37);
    expect(path!.velocityDots.length).toBeGreaterThan(0);

    // Distinct X (easeIn) and Y (easeOut) curves produce a genuine curved arc at midpoint frame 18
    const midPt = path!.points.find((p) => p.frame === 18)!;
    expect(midPt.x).toBeLessThan(300); // easeIn lags behind linear midpoint 300
    expect(midPt.y).toBeGreaterThan(300); // easeOut leads ahead of linear midpoint 300

    // Transient dragOverride bends the sampled node and arc without mutating project
    const bentPath = computeLayerMotionPath(project, comp.id, layer.id, {
      layerId: layer.id,
      frame: 36,
      localX: 720,
      localY: 220,
    });
    expect(bentPath).not.toBeNull();
    const bentEndNode = bentPath!.nodes.find((n) => n.frame === 36)!;
    expect(bentEndNode.localX).toBe(720);
    expect(bentEndNode.localY).toBe(220);
  });

  it('validates all HomeWorkspace demo templates and transitions cleanly from home entry point', async () => {
    const { DEMO_TEMPLATES, createDemoProject } = await import('../../utils/demoProjects');
    const { useStudioStore } = await import('../../store/useStudioStore');

    expect(useStudioStore.getState().workspace).toBe('home');
    expect(DEMO_TEMPLATES.length).toBe(3);

    for (const tpl of DEMO_TEMPLATES) {
      const demo = createDemoProject(tpl.id);
      const check = validateProject(demo);
      expect(check.success, `Demo ${tpl.id} failed validation`).toBe(true);
      const evaluated = evaluateCompositionAtFrame(demo, demo.compositions[0].id, 12);
      expect(evaluated).not.toBeNull();
      expect(evaluated!.layers.length).toBeGreaterThan(0);
    }

    await useStudioStore.getState().openDemoProject('sakura-portrait');
    const afterDemo = useStudioStore.getState();
    expect(afterDemo.workspace).toBe('composition');
    expect(afterDemo.project.name).toContain('Sakura Wind');

    await useStudioStore.getState().createNewProject('Fresh Short', {
      width: 720,
      height: 1280,
      fps: 30,
    });
    const afterNew = useStudioStore.getState();
    expect(afterNew.workspace).toBe('composition');
    expect(afterNew.project.name).toBe('Fresh Short');
    expect(afterNew.project.settings.defaultWidth).toBe(720);
    expect(afterNew.project.settings.defaultHeight).toBe(1280);
    expect(afterNew.project.settings.fps.numerator).toBe(30);
  });
});
