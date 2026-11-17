import React, { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

export const KeyboardShortcutsModal: React.FC = () => {
  const { shortcutsModalOpen, setShortcutsModalOpen } = useStudioStore();

  useEffect(() => {
    if (!shortcutsModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShortcutsModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcutsModalOpen, setShortcutsModalOpen]);

  if (!shortcutsModalOpen) return null;

  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  const modKey = isMac ? '⌘' : 'Ctrl';

  const sections: ShortcutSection[] = [
    {
      title: 'Timeline & Playback',
      items: [
        { keys: ['Space'], description: 'Play or pause active timeline' },
        { keys: ['←', '→'], description: 'Step backward or forward 1 frame' },
        { keys: ['Shift', '← / →'], description: 'Jump backward or forward 10 frames' },
        { keys: ['Home'], description: 'Jump to first frame (F0)' },
        { keys: ['End'], description: 'Jump to last frame' },
        { keys: ['L'], description: 'Toggle loop playback' },
        { keys: ['M'], description: 'Mute or unmute master audio' },
      ],
    },
    {
      title: 'Studio Navigation & Tools',
      items: [
        { keys: ['1 – 7'], description: 'Switch workspace tabs (Home → MCP)' },
        { keys: ['V'], description: 'Select & Transform tool' },
        { keys: ['H'], description: 'Pan Canvas tool' },
        { keys: ['G'], description: 'Toggle Safe Guides overlay' },
        { keys: ['P'], description: 'Toggle Motion Path visualization' },
        { keys: ['?'], description: 'Open or close Keyboard Shortcuts' },
      ],
    },
    {
      title: 'Editing & Keyframes',
      items: [
        { keys: [modKey, 'Z'], description: 'Undo last command' },
        { keys: [modKey, 'Shift', 'Z'], description: 'Redo command' },
        { keys: [modKey, 'C'], description: 'Copy selected layer keyframes at frame' },
        { keys: [modKey, 'V'], description: 'Paste keyframes at current frame' },
        { keys: [modKey, 'S'], description: 'Save project to local storage' },
      ],
    },
    {
      title: 'Stage & Pointer Controls',
      items: [
        { keys: ['Alt', 'Drag'], description: 'Temporary stage pan' },
        { keys: ['Middle Drag'], description: 'Pan composition viewport' },
        { keys: ['Scroll'], description: 'Zoom composition stage in / out' },
        { keys: ['Drag ◇'], description: 'Edit spatial keyframe node on path' },
      ],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-[2px]"
      onClick={() => setShortcutsModalOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[86dvh] rounded-2xl bg-[#181B20] border border-white/12 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/8 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#20242B] border border-white/10 flex items-center justify-center text-sky-400 shrink-0">
              <Keyboard className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="shortcuts-modal-title"
                className="font-display text-sm font-semibold text-slate-100 truncate"
              >
                Keyboard Shortcuts
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Studio navigation, timeline playback, and stage editing controls
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShortcutsModalOpen(false)}
            aria-label="Close Keyboard Shortcuts"
            className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/8 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Shortcut Grid */}
        <div className="p-5 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          {sections.map((section) => (
            <section key={section.title} className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-200 pb-1.5 border-b border-white/8">
                {section.title}
              </h3>
              <ul className="divide-y divide-white/5">
                {section.items.map((item) => (
                  <li
                    key={item.description}
                    className="py-2 flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="text-slate-300 leading-snug">{item.description}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {item.keys.map((k, idx) => (
                        <React.Fragment key={`${k}-${idx}`}>
                          {idx > 0 && <span className="text-slate-500 text-[10px]">+</span>}
                          <kbd className="px-1.5 py-0.5 min-w-[22px] text-center rounded-md bg-[#111317] border border-white/15 font-mono tabular-nums text-[11px] text-slate-200 shadow-xs">
                            {k}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-white/8 bg-[#14171C] flex items-center justify-between text-xs text-slate-400 shrink-0">
          <span>Shortcuts are paused automatically while typing in text fields.</span>
          <span className="flex items-center gap-1.5 shrink-0">
            <span>Close</span>
            <kbd className="px-1.5 py-0.5 rounded bg-[#111317] border border-white/15 font-mono text-[10px] text-slate-300">
              Esc
            </kbd>
          </span>
        </div>
      </div>
    </div>
  );
};
