import { describe, expect, it } from 'vitest';
import { MotionMcpServerCore } from '../../mcp/mcpServerCore';
import { MCP_PROTOCOL_VERSION } from '../../mcp/mcpTypes';
import { validateProject } from '../../schema/projectSchema';

describe('Motion Studio MCP Server Core', () => {
  it('handles JSON-RPC 2.0 initialize, tools/list, resources/list, and prompts/list', () => {
    const core = new MotionMcpServerCore();

    const init = core.handleRpcMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} },
    });
    expect(init?.error).toBeUndefined();
    expect((init?.result as { protocolVersion: string }).protocolVersion).toBe(
      MCP_PROTOCOL_VERSION
    );

    const notify = core.handleRpcMessage({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(notify).toBeNull();

    const toolsRes = core.handleRpcMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (toolsRes?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.length).toBeGreaterThanOrEqual(12);
    expect(tools.some((t) => t.name === 'animate_motion_arc')).toBe(true);

    const resourcesRes = core.handleRpcMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/list',
    });
    const resources = (resourcesRes?.result as { resources: Array<{ uri: string }> }).resources;
    expect(resources.some((r) => r.uri === 'motion://project/current')).toBe(true);

    const promptsRes = core.handleRpcMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'prompts/list',
    });
    const prompts = (promptsRes?.result as { prompts: Array<{ name: string }> }).prompts;
    expect(prompts.some((p) => p.name === 'create_animated_scene')).toBe(true);
  });

  it('creates compositions, adds layers, animates motion arcs, evaluates frames, and emits SSE events', () => {
    const core = new MotionMcpServerCore();
    const events: string[] = [];
    const unsubscribe = core.subscribe((e) => {
      if (e.type === 'project:updated') events.push(e.label);
    });

    const createComp = core.handleRpcMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'create_composition',
        arguments: {
          name: 'MCP Test Scene',
          width: 1280,
          height: 720,
          durationFrames: 120,
          environmentPreset: 'aurora',
        },
      },
    });
    const compId = (
      createComp?.result as { structuredContent: { compositionId: string } }
    ).structuredContent.compositionId;
    expect(compId).toBeTruthy();

    const addLayer = core.handleRpcMessage({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'add_layer',
        arguments: {
          compositionId: compId,
          name: 'Orbiter',
          kind: 'shape',
          shapeType: 'star',
          x: 100,
          y: 200,
        },
      },
    });
    const layerId = (
      addLayer?.result as { structuredContent: { layerId: string } }
    ).structuredContent.layerId;
    expect(layerId).toBeTruthy();

    const arcRes = core.handleRpcMessage({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: {
        name: 'animate_motion_arc',
        arguments: {
          compositionId: compId,
          layerId,
          waypoints: [
            { frame: 0, x: 100, y: 200, xEasing: 'easeIn', yEasing: 'easeOut' },
            { frame: 60, x: 900, y: 500, xEasing: 'linear', yEasing: 'linear' },
          ],
        },
      },
    });
    expect((arcRes?.result as { isError?: boolean }).isError).toBeUndefined();

    const evalRes = core.handleRpcMessage({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'evaluate_frame',
        arguments: { compositionId: compId, frame: 30 },
      },
    });
    const evalLayers = (
      evalRes?.result as {
        structuredContent: {
          layers: Array<{ id: string; worldTransform: { x: number; y: number } }>;
        };
      }
    ).structuredContent.layers;
    const orbiter = evalLayers.find((l) => l.id === layerId)!;
    // easeIn lags linear midpoint 500 on X, easeOut leads midpoint 350 on Y
    expect(orbiter.worldTransform.x).toBeLessThan(500);
    expect(orbiter.worldTransform.y).toBeGreaterThan(350);

    // Project remains 100% schema valid after MCP mutations
    expect(validateProject(core.getProject()).success).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(3);

    // Resource read returns current project JSON
    const readRes = core.handleRpcMessage({
      jsonrpc: '2.0',
      id: 14,
      method: 'resources/read',
      params: { uri: `motion://composition/${compId}` },
    });
    const contents = (readRes?.result as { contents: Array<{ text: string }> }).contents;
    expect(JSON.parse(contents[0].text).name).toBe('MCP Test Scene');

    unsubscribe();
  });

  it('returns JSON-RPC errors on unknown methods and missing resources', () => {
    const core = new MotionMcpServerCore();
    const badMethod = core.handleRpcMessage({
      jsonrpc: '2.0',
      id: 99,
      method: 'unknown/method',
    });
    expect(badMethod?.error?.code).toBe(-32601);

    const missingResource = core.handleRpcMessage({
      jsonrpc: '2.0',
      id: 100,
      method: 'resources/read',
      params: { uri: 'motion://composition/does-not-exist' },
    });
    expect(missingResource?.error?.code).toBe(-32002);
  });

  it('supports all 10 cinematic preset, hair, cloth, idle, lyrics, environment, camera, and preview MCP tools', () => {
    const core = new MotionMcpServerCore();

    const listRes = core.handleRpcMessage({ jsonrpc: '2.0', id: 200, method: 'tools/list' });
    const tools = (listRes?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.length).toBeGreaterThanOrEqual(22);

    const presetsRes = core.callTool('get_available_presets', { category: 'hair' });
    expect((presetsRes.structuredContent as { count: number }).count).toBe(5);

    const presetResource = core.readResource('motion://presets');
    expect(presetResource).not.toBeNull();
    expect(JSON.parse(presetResource!.text).length).toBe(42);

    const layerId = core.getProject().compositions[0].layers[0].id;

    const hairRes = core.callTool('create_hair_animation', {
      layerId,
      style: 'gentle-wind',
      windDirection: 'left',
      intensity: 1.4,
    });
    expect(hairRes.isError).toBeUndefined();
    const hairModId = (hairRes.structuredContent as { modifierId: string }).modifierId;

    const updateRes = core.callTool('update_animation_parameters', {
      targetType: 'layer',
      layerId,
      modifierId: hairModId,
      speed: 1.5,
      intensity: 1.8,
    });
    expect(updateRes.isError).toBeUndefined();

    const clothRes = core.callTool('create_cloth_animation', {
      layerId,
      style: 'scarf-flutter',
    });
    expect(clothRes.isError).toBeUndefined();

    const idleRes = core.callTool('create_character_idle_animation', {
      layerId,
      presets: ['breathing', 'eye-blinking', 'head-tilt'],
    });
    expect(idleRes.isError).toBeUndefined();

    const applyRes = core.callTool('apply_motion_preset', {
      targetType: 'layer',
      layerId,
      presetId: 'fx.float-hover',
    });
    expect(applyRes.isError).toBeUndefined();

    const envRes = core.callTool('create_environment_effect', {
      weatherType: 'leaves',
      weatherDensity: 0.6,
      fogOpacity: 0.4,
      cloudDensity: 0.5,
      grassDensity: 0.7,
    });
    expect(envRes.isError).toBeUndefined();

    const lyricsRes = core.callTool('create_lyrics_animation', {
      style: 'karaoke',
      lrcText: '[00:00.50]Moonlit echoes\n[00:03.00]Carry through night',
      beatBpm: 128,
    });
    expect(lyricsRes.isError).toBeUndefined();
    expect((lyricsRes.structuredContent as { cueCount: number }).cueCount).toBe(2);

    const camRes = core.callTool('create_camera_animation', {
      preset: 'slow-zoom-in',
      followLayerId: layerId,
    });
    expect(camRes.isError).toBeUndefined();

    const previewRes = core.callTool('preview_composition', {
      startFrame: 0,
      endFrame: 48,
      stepFrames: 24,
    });
    expect(previewRes.isError).toBeUndefined();
    const samples = (previewRes.structuredContent as { samples: Array<{ activeLyrics: unknown[] }> })
      .samples;
    expect(samples.length).toBe(3);
    expect(samples[1].activeLyrics.length).toBe(1);

    expect(validateProject(core.getProject()).success).toBe(true);
  });
});
