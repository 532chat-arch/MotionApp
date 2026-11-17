import { describe, expect, it } from 'vitest';
import {
  computeEnvironmentParticles,
  SpritePool,
} from '../../renderer/PixiEnvironmentEffects';
import type { EnvironmentDocument } from '../../schema/projectSchema';

function makeEnv(overrides: Partial<EnvironmentDocument> = {}): EnvironmentDocument {
  return {
    presetId: 'test',
    skyTopColor: '#0F172A',
    skyBottomColor: '#1E293B',
    hazeColor: '#94A3B8',
    hazeIntensity: 0,
    weatherType: 'none',
    weatherDensity: 0.5,
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
    ...overrides,
  };
}

describe('PixiJS Sprite-Pooled Environment Effects', () => {
  it('reuses pre-allocated pool items across acquire, release, and releaseAll cycles without extra allocation', () => {
    let allocations = 0;
    const pool = new SpritePool({
      initialSize: 10,
      maxCapacity: 15,
      factory: () => {
        allocations += 1;
        return { id: allocations, visible: false, alpha: 1 };
      },
      reset: (item) => {
        item.alpha = 1;
      },
    });

    expect(allocations).toBe(10);
    expect(pool.getStats()).toEqual({
      activeCount: 0,
      idleCount: 10,
      totalAllocated: 10,
      maxCapacity: 15,
    });

    // Acquire 6 items from warmed idle pool -> zero new allocations
    const batchA = Array.from({ length: 6 }, () => pool.acquire()!);
    expect(batchA.every((item) => item.visible)).toBe(true);
    expect(allocations).toBe(10);
    expect(pool.getStats().activeCount).toBe(6);
    expect(pool.getStats().idleCount).toBe(4);

    // Release all and re-acquire 8 -> still reuses warmed sprites
    pool.releaseAll();
    expect(batchA.every((item) => !item.visible)).toBe(true);
    const batchB = Array.from({ length: 8 }, () => pool.acquire()!);
    expect(batchB.length).toBe(8);
    expect(allocations).toBe(10);

    // Acquiring beyond maxCapacity (15) caps cleanly at null
    const extra = Array.from({ length: 10 }, () => pool.acquire()).filter(Boolean);
    expect(extra.length).toBe(7); // 8 + 7 = 15
    expect(allocations).toBe(15);
    expect(pool.acquire()).toBeNull();
  });

  it('computes deterministic, loop-seamless particles for Rain, Snow, and Floating Dust', () => {
    const rainEnv = makeEnv({ weatherType: 'rain', weatherDensity: 0.6, weatherLoopFrames: 120 });
    const snowEnv = makeEnv({ weatherType: 'snow', weatherDensity: 0.4, weatherLoopFrames: 120 });
    const dustEnv = makeEnv({ weatherType: 'dust', weatherDensity: 0.5, weatherLoopFrames: 120 });
    const noneEnv = makeEnv({ weatherType: 'none', weatherDensity: 0.8 });

    expect(computeEnvironmentParticles(noneEnv, 1280, 720, 10)).toEqual([]);

    const rainF0 = computeEnvironmentParticles(rainEnv, 1280, 720, 0, 'full');
    const rainF24 = computeEnvironmentParticles(rainEnv, 1280, 720, 24, 'full');
    const rainLoop = computeEnvironmentParticles(rainEnv, 1280, 720, 120, 'full');
    const rainReduced = computeEnvironmentParticles(rainEnv, 1280, 720, 24, 'reduced');

    expect(rainF0.length).toBeGreaterThan(rainReduced.length);
    expect(rainF0[0].kind).toBe('rain');
    expect(rainF24[0].y).not.toBe(rainF0[0].y);
    // Seamless wraparound at weatherLoopFrames
    expect(rainLoop).toEqual(rainF0);

    const snowF15 = computeEnvironmentParticles(snowEnv, 1280, 720, 15, 'full');
    expect(snowF15[0].kind).toBe('snow');
    expect(snowF15[0].x).toBeGreaterThanOrEqual(0);
    expect(snowF15[0].x).toBeLessThan(1280);

    const dustF30 = computeEnvironmentParticles(dustEnv, 1280, 720, 30, 'full');
    expect(dustF30[0].kind).toBe('dust');
    expect(dustF30[0].alpha).toBeGreaterThan(0);
    expect(dustF30[0].alpha).toBeLessThan(1);
  });
});
