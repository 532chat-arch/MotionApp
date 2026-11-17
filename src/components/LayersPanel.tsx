import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Box,
  Boxes,
  CheckSquare,
  Copy,
  Eye,
  EyeOff,
  FolderPlus,
  Image as ImageIcon,
  Layers,
  Lock,
  MoreHorizontal,
  Plus,
  Settings2,
  Square,
  Trash2,
  Type,
  Unlock,
  User,
} from 'lucide-react';
import { ProjectCommands, uid } from '../commands/projectCommands';
import { LayerDocument } from '../schema/projectSchema';
import { useStudioStore } from '../store/useStudioStore';
import { createBlankComposition } from '../utils/starterProject';

export const LayersPanel: React.FC = () => {
  const {
    project,
    activeCompositionId,
    selectedLayerId,
    setActiveComposition,
    selectLayer,
    dispatchCommand,
    showFeedback,
  } = useStudioStore();

  const composition =
    project.compositions.find((c) => c.id === activeCompositionId) ?? project.compositions[0];

  const [selectMode, setSelectMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [showCompSettings, setShowCompSettings] = useState(false);
  const [showCompMenu, setShowCompMenu] = useState(false);
  const [showNestMenu, setShowNestMenu] = useState(false);
  const [newCompName, setNewCompName] = useState('');
  const [creatingComp, setCreatingComp] = useState(false);

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleCreateComp = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCompName.trim() || `0${project.compositions.length + 1} - New Scene`;
    const comp = createBlankComposition(name, project.settings.defaultWidth, project.settings.defaultHeight);
    if (dispatchCommand(ProjectCommands.createComposition(comp))) {
      setActiveComposition(comp.id);
      setNewCompName('');
      setCreatingComp(false);
    }
  };

  const handlePreCompose = () => {
    const targets = checkedIds.length > 0 ? checkedIds : selectedLayerId ? [selectedLayerId] : [];
    if (targets.length === 0) return;
    const ok = dispatchCommand(
      ProjectCommands.preComposeLayers(
        composition.id,
        targets,
        `Pre-comp (${targets.length} layers)`
      )
    );
    if (ok) {
      setCheckedIds([]);
      setSelectMode(false);
      showFeedback('info', 'Pre-composed layers into a nested Composition');
    }
  };

  const getLayerIcon = (layer: LayerDocument) => {
    const kind = layer.objects[0]?.kind;
    switch (kind) {
      case 'character':
        return <User className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
      case 'sprite':
        return <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case 'text':
        return <Type className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      case 'nestedComposition':
        return <Boxes className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
      default:
        return <Box className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
    }
  };

  const otherCompositions = project.compositions.filter((c) => c.id !== composition.id);
  const selectedIndex = composition.layers.findIndex((l) => l.id === selectedLayerId);

  return (
    <div className="flex flex-col h-full bg-[#181B20] text-slate-100 select-none">
      {/* Compact Composition Switcher */}
      <div className="p-2 border-b border-white/8 space-y-1.5">
        <div className="flex items-center gap-1">
          <select
            aria-label="Active Composition"
            value={composition.id}
            onChange={(e) => setActiveComposition(e.target.value)}
            className="flex-1 min-w-0 min-h-[36px] px-2 rounded-lg bg-[#111317] border border-white/10 text-xs font-medium text-slate-100 focus:outline-none focus:border-blue-500"
          >
            {project.compositions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setCreatingComp((v) => !v)}
            title="New Composition"
            aria-label="New Composition"
            className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/8"
          >
            <Plus className="w-4 h-4" />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowCompMenu((v) => !v)}
              title="Composition actions"
              aria-label="Composition actions"
              className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/8"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {showCompMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowCompMenu(false)} />
                <div className="absolute right-0 mt-1 w-44 rounded-xl bg-[#20242B] border border-white/12 shadow-2xl p-1 z-40 space-y-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      const newId = uid('comp');
                      if (
                        dispatchCommand(
                          ProjectCommands.duplicateComposition(
                            composition.id,
                            newId,
                            `${composition.name} Copy`
                          )
                        )
                      ) {
                        setActiveComposition(newId);
                      }
                      setShowCompMenu(false);
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-lg text-slate-200 hover:bg-white/8 flex items-center gap-2"
                  >
                    <Copy className="w-3.5 h-3.5 text-slate-400" /> Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCompSettings((v) => !v);
                      setShowCompMenu(false);
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-lg text-slate-200 hover:bg-white/8 flex items-center gap-2"
                  >
                    <Settings2 className="w-3.5 h-3.5 text-slate-400" /> Settings
                  </button>
                  {project.compositions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        dispatchCommand(ProjectCommands.deleteComposition(composition.id));
                        setShowCompMenu(false);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-lg text-red-400 hover:bg-red-500/15 flex items-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete Comp
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {creatingComp && (
          <form onSubmit={handleCreateComp} className="flex gap-1.5 pt-1">
            <input
              type="text"
              value={newCompName}
              onChange={(e) => setNewCompName(e.target.value)}
              placeholder="New scene name..."
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#111317] border border-white/12 text-xs text-slate-100"
              autoFocus
            />
            <button
              type="submit"
              className="px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium"
            >
              Add
            </button>
          </form>
        )}

        {showCompSettings && (
          <div className="p-2 rounded-xl bg-[#111317] border border-white/10 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-300">Dimensions & Length</span>
              <button
                type="button"
                onClick={() => setShowCompSettings(false)}
                className="text-[11px] text-blue-400"
              >
                Done
              </button>
            </div>
            <input
              type="text"
              value={composition.name}
              onChange={(e) =>
                dispatchCommand(
                  ProjectCommands.updateCompositionSettings(composition.id, {
                    name: e.target.value,
                  })
                )
              }
              className="w-full px-2 py-1 rounded bg-[#181B20] border border-white/10 text-slate-100"
            />
            <div className="grid grid-cols-3 gap-1">
              <label className="space-y-0.5">
                <span className="text-[10px] text-slate-400">W</span>
                <input
                  type="number"
                  value={composition.settings.width}
                  min={256}
                  max={3840}
                  onChange={(e) =>
                    dispatchCommand(
                      ProjectCommands.updateCompositionSettings(composition.id, {
                        width: Math.max(256, Number(e.target.value) || 1280),
                      })
                    )
                  }
                  className="w-full px-1.5 py-1 rounded bg-[#181B20] border border-white/10 font-mono text-slate-100"
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-slate-400">H</span>
                <input
                  type="number"
                  value={composition.settings.height}
                  min={256}
                  max={2160}
                  onChange={(e) =>
                    dispatchCommand(
                      ProjectCommands.updateCompositionSettings(composition.id, {
                        height: Math.max(256, Number(e.target.value) || 720),
                      })
                    )
                  }
                  className="w-full px-1.5 py-1 rounded bg-[#181B20] border border-white/10 font-mono text-slate-100"
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-slate-400">Frames</span>
                <input
                  type="number"
                  value={composition.settings.durationFrames}
                  min={24}
                  max={3600}
                  onChange={(e) =>
                    dispatchCommand(
                      ProjectCommands.updateCompositionSettings(composition.id, {
                        durationFrames: Math.max(24, Number(e.target.value) || 144),
                      })
                    )
                  }
                  className="w-full px-1.5 py-1 rounded bg-[#181B20] border border-white/10 font-mono text-slate-100"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Layer Header */}
      <div className="px-2.5 py-1.5 border-b border-white/8 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
          <Layers className="w-3.5 h-3.5" />
          <span>Layers ({composition.layers.length})</span>
        </div>

        <div className="flex items-center gap-1">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNestMenu((v) => !v)}
              disabled={otherCompositions.length === 0}
              title="Nest another Composition"
              className="min-h-[30px] px-2 rounded-md bg-[#20242B] hover:bg-[#2A2F38] disabled:opacity-35 text-[11px] text-slate-200 flex items-center gap-1"
            >
              <FolderPlus className="w-3 h-3 text-cyan-400" />
              Nest
            </button>
            {showNestMenu && otherCompositions.length > 0 && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowNestMenu(false)} />
                <div className="absolute right-0 mt-1 w-48 rounded-xl bg-[#20242B] border border-white/12 shadow-2xl p-1 z-40 space-y-0.5">
                  {project.compositions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        dispatchCommand(ProjectCommands.nestCompositionLayer(composition.id, c.id));
                        setShowNestMenu(false);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-lg text-xs text-slate-200 hover:bg-blue-600/20 truncate"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              if (!selectMode) {
                setSelectMode(true);
                setCheckedIds(selectedLayerId ? [selectedLayerId] : []);
              } else {
                setSelectMode(false);
                setCheckedIds([]);
              }
            }}
            title="Select multiple layers to Pre-compose"
            className={`min-h-[30px] px-2 rounded-md text-[11px] flex items-center gap-1 ${
              selectMode
                ? 'bg-blue-600 text-white'
                : 'bg-[#20242B] hover:bg-[#2A2F38] text-slate-200'
            }`}
          >
            <Boxes className="w-3 h-3" />
            {selectMode ? 'Cancel' : 'Group'}
          </button>
        </div>
      </div>

      {/* Decluttered Layers List */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {composition.layers.length === 0 ? (
          <div className="p-5 text-center text-xs text-slate-400">
            No layers yet. Use + Shape or + Text on the canvas.
          </div>
        ) : (
          composition.layers.map((layer) => {
            const isSelected = layer.id === selectedLayerId;
            const isChecked = checkedIds.includes(layer.id);
            return (
              <div
                key={layer.id}
                onClick={() => {
                  if (selectMode) toggleCheck(layer.id);
                  else selectLayer(layer.id, 'layer');
                }}
                className={`min-h-[40px] px-2 py-1 rounded-lg flex items-center gap-2 cursor-pointer transition-colors ${
                  isSelected && !selectMode
                    ? 'bg-blue-600/20 text-white'
                    : 'hover:bg-white/5 text-slate-300'
                }`}
              >
                {selectMode && (
                  <span className="shrink-0">
                    {isChecked ? (
                      <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-slate-500" />
                    )}
                  </span>
                )}

                {getLayerIcon(layer)}

                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate leading-tight">{layer.name}</div>
                </div>

                {/* Only Visibility & Lock on rows — zero icon clutter */}
                <div className="flex items-center shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatchCommand(
                        ProjectCommands.updateLayerProps(composition.id, layer.id, {
                          visible: !layer.visible,
                        })
                      );
                    }}
                    aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
                    className={`min-h-[32px] min-w-[28px] rounded flex items-center justify-center ${
                      layer.visible ? 'text-slate-400 hover:text-white' : 'text-slate-600'
                    }`}
                  >
                    {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatchCommand(
                        ProjectCommands.updateLayerProps(composition.id, layer.id, {
                          locked: !layer.locked,
                        })
                      );
                    }}
                    aria-label={layer.locked ? 'Unlock layer' : 'Lock layer'}
                    className={`min-h-[32px] min-w-[28px] rounded flex items-center justify-center ${
                      layer.locked ? 'text-amber-400' : 'text-slate-600 hover:text-slate-300'
                    }`}
                  >
                    {layer.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Action Strip for Selected Layer or Pre-compose */}
      {selectMode ? (
        <div className="p-2 border-t border-white/8 bg-[#14171C]">
          <button
            type="button"
            disabled={checkedIds.length === 0}
            onClick={handlePreCompose}
            className="w-full min-h-[38px] rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Boxes className="w-3.5 h-3.5" />
            Pre-compose ({checkedIds.length})
          </button>
        </div>
      ) : (
        selectedLayerId && (
          <div className="px-2 py-1.5 border-t border-white/8 flex items-center justify-between gap-1 bg-[#14171C]">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                disabled={selectedIndex <= 0}
                onClick={() =>
                  dispatchCommand(
                    ProjectCommands.reorderLayer(composition.id, selectedIndex, selectedIndex - 1)
                  )
                }
                title="Move layer forward"
                aria-label="Move layer up"
                className="min-h-[34px] min-w-[34px] rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/8 disabled:opacity-25"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={selectedIndex < 0 || selectedIndex >= composition.layers.length - 1}
                onClick={() =>
                  dispatchCommand(
                    ProjectCommands.reorderLayer(composition.id, selectedIndex, selectedIndex + 1)
                  )
                }
                title="Move layer back"
                aria-label="Move layer down"
                className="min-h-[34px] min-w-[34px] rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/8 disabled:opacity-25"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() =>
                dispatchCommand(ProjectCommands.deleteLayer(composition.id, selectedLayerId))
              }
              aria-label="Delete selected layer"
              className="min-h-[34px] px-2.5 rounded-lg text-xs text-red-400 hover:bg-red-500/15 flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        )
      )}
    </div>
  );
};
