import React, { useMemo, useRef, useState } from 'react';
import {
  FileAudio,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { ProjectCommands, uid } from '../commands/projectCommands';
import { AssetCategory, AssetRecord } from '../schema/projectSchema';
import { getActiveCompFps, useStudioStore } from '../store/useStudioStore';
import {
  computeStringHash,
  probeAudioDuration,
  probeImageDimensions,
  readFileAsDataUrl,
} from '../utils/mediaImport';

const CATEGORIES: { id: 'all' | AssetCategory; label: string }[] = [
  { id: 'all', label: 'All Assets' },
  { id: 'characters', label: 'Characters' },
  { id: 'environments', label: 'Environments' },
  { id: 'backgrounds', label: 'Backgrounds' },
  { id: 'foregrounds', label: 'Foregrounds' },
  { id: 'props', label: 'Props' },
  { id: 'audio', label: 'Audio' },
];

export const AssetLibraryWorkspace: React.FC = () => {
  const {
    project,
    activeCompositionId,
    currentFrame,
    dispatchCommand,
    selectLayer,
    setWorkspace,
    showFeedback,
  } = useStudioStore();

  const [category, setCategory] = useState<'all' | AssetCategory>('all');
  const [search, setSearch] = useState('');
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);

  const importInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const activeComp =
    project.compositions.find((c) => c.id === activeCompositionId) ?? project.compositions[0];

  // Count how many Compositions reference each asset
  const usageCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const comp of project.compositions) {
      const usedInComp = new Set<string>();
      for (const l of comp.layers) {
        for (const o of l.objects) {
          if (o.kind === 'sprite') usedInComp.add(o.assetId);
          if (o.kind === 'character') {
            const ch = project.characters.find((c) => c.id === o.characterId);
            if (ch) usedInComp.add(ch.assetId);
          }
        }
      }
      for (const tr of comp.audioTracks) {
        for (const cl of tr.clips) usedInComp.add(cl.assetId);
      }
      for (const assetId of usedInComp) {
        map.set(assetId, (map.get(assetId) ?? 0) + 1);
      }
    }
    return map;
  }, [project.compositions, project.characters]);

  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return project.assets.filter((a) => {
      if (category !== 'all' && a.category !== category) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [project.assets, category, search]);

  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    let importedCount = 0;
    let duplicateCount = 0;

    for (const file of files) {
      const dataUrl = await readFileAsDataUrl(file);
      const hash = await computeStringHash(dataUrl);
      const duplicate = project.assets.find((a) => a.hash === hash);
      if (duplicate) {
        duplicateCount++;
        continue;
      }

      const now = new Date().toISOString();
      const isAudio = file.type.startsWith('audio/');
      if (isAudio) {
        const dur = await probeAudioDuration(dataUrl);
        dispatchCommand(
          ProjectCommands.addAsset({
            id: uid('asset'),
            name: file.name.replace(/\.[^.]+$/, ''),
            category: 'audio',
            type: 'audio',
            mimeType: file.type || 'audio/wav',
            dataUrl,
            durationSeconds: dur,
            hash,
            tags: ['audio', 'imported'],
            folder: 'Audio',
            createdAt: now,
            updatedAt: now,
            metadata: {},
          })
        );
      } else {
        const dims = await probeImageDimensions(dataUrl);
        dispatchCommand(
          ProjectCommands.addAsset({
            id: uid('asset'),
            name: file.name.replace(/\.[^.]+$/, ''),
            category: category === 'all' ? 'props' : category,
            type: 'image',
            mimeType: file.type || 'image/png',
            dataUrl,
            width: dims.width,
            height: dims.height,
            hash,
            tags: ['imported'],
            folder: 'Imports',
            createdAt: now,
            updatedAt: now,
            metadata: {},
          })
        );
      }
      importedCount++;
    }

    if (duplicateCount > 0 && importedCount === 0) {
      showFeedback('info', `Skipped ${duplicateCount} duplicate asset(s) matching existing hashes.`);
    } else if (importedCount > 0) {
      showFeedback(
        'info',
        `Imported ${importedCount} asset(s)${duplicateCount > 0 ? ` (${duplicateCount} duplicate skipped)` : ''}.`
      );
    }
    e.target.value = '';
  };

  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !replaceTargetId) return;
    const dataUrl = await readFileAsDataUrl(file);
    const hash = await computeStringHash(dataUrl);
    const isAudio = file.type.startsWith('audio/');
    if (isAudio) {
      const dur = await probeAudioDuration(dataUrl);
      dispatchCommand(
        ProjectCommands.replaceAssetSource(replaceTargetId, {
          name: file.name.replace(/\.[^.]+$/, ''),
          mimeType: file.type,
          dataUrl,
          durationSeconds: dur,
          hash,
        })
      );
    } else {
      const dims = await probeImageDimensions(dataUrl);
      dispatchCommand(
        ProjectCommands.replaceAssetSource(replaceTargetId, {
          name: file.name.replace(/\.[^.]+$/, ''),
          mimeType: file.type,
          dataUrl,
          width: dims.width,
          height: dims.height,
          hash,
        })
      );
    }
    setReplaceTargetId(null);
    showFeedback('info', 'Replaced source asset across all placed instances.');
    e.target.value = '';
  };

  const handlePlaceInComposition = (asset: AssetRecord) => {
    if (asset.type === 'audio') {
      const fps = getActiveCompFps(project, activeComp.id);
      let trackId = activeComp.audioTracks[0]?.id;
      if (!trackId) {
        trackId = uid('atrack');
        dispatchCommand(
          ProjectCommands.addAudioTrack(activeComp.id, {
            id: trackId,
            name: 'Audio Track 1',
            category: 'sfx',
            muted: false,
            solo: false,
            volume: 1,
            clips: [],
          })
        );
      }
      dispatchCommand(
        ProjectCommands.addAudioClip(activeComp.id, trackId, {
          id: uid('aclip'),
          assetId: asset.id,
          name: asset.name,
          startFrame: currentFrame,
          inFrame: 0,
          durationFrames: Math.max(12, Math.round((asset.durationSeconds ?? 4) * fps)),
          volume: 1,
          fadeInFrames: 0,
          fadeOutFrames: 0,
          loop: false,
        })
      );
      showFeedback('info', `Added "${asset.name}" to ${activeComp.name} audio timeline.`);
      setWorkspace('composition');
      return;
    }

    const layerId = uid('layer');
    const maxDim = 420;
    const w = asset.width ?? 280;
    const h = asset.height ?? 280;
    const scaleFit = Math.min(1, maxDim / Math.max(w, h));

    dispatchCommand(
      ProjectCommands.addLayer(
        activeComp.id,
        {
          id: layerId,
          name: asset.name,
          role:
            asset.category === 'backgrounds'
              ? 'background'
              : asset.category === 'foregrounds'
              ? 'foreground'
              : 'prop',
          visible: true,
          locked: false,
          solo: false,
          opacity: 1,
          blendMode: 'normal',
          depth: asset.category === 'backgrounds' ? -0.6 : asset.category === 'foregrounds' ? 0.5 : 0,
          inFrame: 0,
          outFrame: activeComp.settings.durationFrames,
          objects: [
            {
              id: uid('obj'),
              name: asset.name,
              kind: 'sprite',
              assetId: asset.id,
              width: Math.round(w * scaleFit),
              height: Math.round(h * scaleFit),
              transform: {
                x: activeComp.settings.width / 2,
                y: activeComp.settings.height / 2,
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
        },
        0
      )
    );
    selectLayer(layerId, 'layer');
    setWorkspace('composition');
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#111317] overflow-hidden">
      {/* Toolbar */}
      <div className="p-4 border-b border-white/8 bg-[#181B20] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategory(cat.id)}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                category === cat.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#111317] text-slate-300 hover:bg-white/5 border border-white/8'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets..."
              className="w-full min-h-[40px] pl-8 pr-3 rounded-xl bg-[#111317] border border-white/10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <input
            ref={importInputRef}
            type="file"
            accept="image/*,audio/*"
            multiple
            onChange={handleImportFiles}
            className="hidden"
          />
          <input
            ref={replaceInputRef}
            type="file"
            accept="image/*,audio/*"
            onChange={handleReplaceFile}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="min-h-[40px] px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Upload className="w-4 h-4" />
            Import Media
          </button>
        </div>
      </div>

      {/* Asset Grid */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {filteredAssets.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto space-y-3">
            <ImageIcon className="w-10 h-10 text-slate-500" />
            <div className="text-sm font-medium text-slate-200">No matching assets</div>
            <p className="text-xs text-slate-400">
              Import transparent PNGs, WebP illustrations, sprite sheets, or WAV/MP3 audio files to reuse across Compositions.
            </p>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="min-h-[42px] px-4 rounded-xl bg-blue-600 text-white text-xs font-semibold"
            >
              Import Files
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredAssets.map((asset) => {
              const usedIn = usageCounts.get(asset.id) ?? 0;
              return (
                <div
                  key={asset.id}
                  className="rounded-2xl bg-[#181B20] border border-white/8 overflow-hidden flex flex-col"
                >
                  <div className="h-40 bg-[#111317] flex items-center justify-center p-3 relative">
                    {asset.type === 'audio' ? (
                      <div className="flex flex-col items-center gap-2 text-emerald-400">
                        <FileAudio className="w-10 h-10" />
                        <span className="text-xs font-mono tabular-nums text-slate-300">
                          {(asset.durationSeconds ?? 0).toFixed(1)}s audio
                        </span>
                      </div>
                    ) : (
                      <img
                        src={asset.dataUrl}
                        alt={asset.name}
                        className="max-w-full max-h-full object-contain"
                      />
                    )}
                  </div>

                  <div className="p-3.5 flex-1 flex flex-col justify-between space-y-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-100 truncate">
                        {asset.name}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                        <span className="capitalize">{asset.category}</span>
                        <span aria-hidden="true">·</span>
                        {asset.width && asset.height ? (
                          <span className="font-mono tabular-nums">
                            {asset.width}×{asset.height}
                          </span>
                        ) : (
                          <span>{asset.mimeType.split('/')[1]}</span>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          Used in {usedIn} comp{usedIn === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handlePlaceInComposition(asset)}
                        className="flex-1 min-h-[40px] px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center justify-center gap-1 whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Place in Scene
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReplaceTargetId(asset.id);
                          replaceInputRef.current?.click();
                        }}
                        title="Replace source media non-destructively"
                        aria-label={`Replace source for ${asset.name}`}
                        className="min-h-[40px] min-w-[40px] rounded-xl bg-[#20242B] hover:bg-[#2A2F38] text-slate-300 flex items-center justify-center"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => dispatchCommand(ProjectCommands.deleteAsset(asset.id))}
                        title="Remove asset"
                        aria-label={`Delete ${asset.name}`}
                        className="min-h-[40px] min-w-[40px] rounded-xl bg-[#20242B] hover:bg-red-500/20 text-slate-400 hover:text-red-300 flex items-center justify-center"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
