import { describe, expect, it } from 'vitest';
import { buildAudioExportPlan } from '../../audio/audioExportMixer';
import { createStarterProject } from '../../utils/starterProject';

describe('audioExportMixer', () => {
  it('schedules composition audio tracks while respecting mute, solo, and timeline bounds', () => {
    const project = createStarterProject();
    const comp = project.compositions[0];

    project.assets.push(
      {
        id: 'aud_music',
        name: 'Theme.wav',
        category: 'audio',
        type: 'audio',
        mimeType: 'audio/wav',
        dataUrl: 'data:audio/wav;base64,AAAA',
        durationSeconds: 10,
        tags: [],
        folder: 'Audio',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      },
      {
        id: 'aud_sfx',
        name: 'Bang.wav',
        category: 'audio',
        type: 'audio',
        mimeType: 'audio/wav',
        dataUrl: 'data:audio/wav;base64,AAAA',
        durationSeconds: 2,
        tags: [],
        folder: 'Audio',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      }
    );

    comp.settings.durationFrames = 120; // 5s at 24fps
    comp.audioTracks = [
      {
        id: 'tr_music',
        name: 'Music',
        category: 'music',
        muted: false,
        solo: false,
        volume: 0.8,
        clips: [
          {
            id: 'c1',
            assetId: 'aud_music',
            name: 'BG',
            startFrame: 24,
            inFrame: 12,
            durationFrames: 120, // extends past 120 -> clamped to 96 frames (4s)
            volume: 1,
            fadeInFrames: 12,
            fadeOutFrames: 12,
            loop: false,
          },
        ],
      },
      {
        id: 'tr_muted',
        name: 'Muted SFX',
        category: 'sfx',
        muted: true,
        solo: false,
        volume: 1,
        clips: [
          {
            id: 'c2',
            assetId: 'aud_sfx',
            name: 'Shot',
            startFrame: 10,
            inFrame: 0,
            durationFrames: 24,
            volume: 1,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            loop: false,
          },
        ],
      },
    ];

    const plan = buildAudioExportPlan(project, 'composition', comp.id);
    expect(plan.fps).toBe(24);
    expect(plan.totalFrames).toBe(120);
    expect(plan.clips).toHaveLength(1);
    expect(plan.clips[0].startSec).toBeCloseTo(1, 5);
    expect(plan.clips[0].durationSec).toBeCloseTo(4, 5);
    expect(plan.clips[0].offsetSec).toBeCloseTo(0.5, 5);
    expect(plan.clips[0].volume).toBeCloseTo(0.8, 5);
    expect(plan.clips[0].fadeInSec).toBeCloseTo(0.5, 5);
    // Clipped at comp end -> trailing fadeOut is trimmed
    expect(plan.clips[0].fadeOutSec).toBe(0);

    // Enabling solo on another track excludes non-solo tracks
    comp.audioTracks[1].muted = false;
    comp.audioTracks[1].solo = true;
    const soloPlan = buildAudioExportPlan(project, 'composition', comp.id);
    expect(soloPlan.clips).toHaveLength(1);
    expect(soloPlan.clips[0].assetId).toBe('aud_sfx');
  });

  it('schedules audio across Movie Timeline clips with inOffsetFrames and sequential placement', () => {
    const project = createStarterProject();
    const compA = project.compositions[0];
    const compB = project.compositions[1] ?? structuredClone(compA);
    if (!project.compositions[1]) {
      compB.id = 'comp_b';
      project.compositions.push(compB);
    }

    project.assets.push({
      id: 'aud_voice',
      name: 'Voice.wav',
      category: 'audio',
      type: 'audio',
      mimeType: 'audio/wav',
      dataUrl: 'data:audio/wav;base64,AAAA',
      durationSeconds: 8,
      tags: [],
      folder: 'Audio',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    });

    compA.settings.durationFrames = 120;
    compA.audioTracks = [
      {
        id: 'tr_a',
        name: 'Dialogue A',
        category: 'dialogue',
        muted: false,
        solo: false,
        volume: 1,
        clips: [
          {
            id: 'ca',
            assetId: 'aud_voice',
            name: 'Line A',
            startFrame: 0,
            inFrame: 0,
            durationFrames: 96,
            volume: 1,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            loop: false,
          },
        ],
      },
    ];

    compB.settings.durationFrames = 120;
    compB.audioTracks = [
      {
        id: 'tr_b',
        name: 'Dialogue B',
        category: 'dialogue',
        muted: false,
        solo: false,
        volume: 0.9,
        clips: [
          {
            id: 'cb',
            assetId: 'aud_voice',
            name: 'Line B',
            startFrame: 12,
            inFrame: 0,
            durationFrames: 72,
            volume: 1,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            loop: false,
          },
        ],
      },
    ];

    project.projectTimeline.clips = [
      {
        id: 'tl1',
        compositionId: compA.id,
        startFrame: 0,
        durationFrames: 72,
        inOffsetFrames: 24, // skips first 1s of compA
        transitionIn: 'cut',
        transitionDurationFrames: 0,
      },
      {
        id: 'tl2',
        compositionId: compB.id,
        startFrame: 72, // starts at 3.0s
        durationFrames: 96,
        inOffsetFrames: 0,
        transitionIn: 'cut',
        transitionDurationFrames: 0,
      },
    ];

    const plan = buildAudioExportPlan(project, 'movie');
    expect(plan.totalFrames).toBe(168);
    expect(plan.clips).toHaveLength(2);

    // Clip A: frames 24..96 mapped to movie frames 0..72 -> startSec=0, offsetSec=1s, durationSec=3s
    expect(plan.clips[0].startSec).toBeCloseTo(0, 5);
    expect(plan.clips[0].offsetSec).toBeCloseTo(1, 5);
    expect(plan.clips[0].durationSec).toBeCloseTo(3, 5);

    // Clip B: comp frame 12..84 mapped to movie frames 84..156 -> startSec=3.5s, offsetSec=0, durationSec=3s
    expect(plan.clips[1].startSec).toBeCloseTo(3.5, 5);
    expect(plan.clips[1].offsetSec).toBeCloseTo(0, 5);
    expect(plan.clips[1].durationSec).toBeCloseTo(3, 5);
  });
});
