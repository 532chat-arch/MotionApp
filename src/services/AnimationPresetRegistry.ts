import type { MotionModifierInstance } from '../schema/projectSchema.ts';
import {
  ANIMATION_PRESET_JSON_SCHEMA,
  AnimationPresetSchema,
  PRESET_REGISTRY,
  PresetCategorySchema,
  PresetParameterControlSchema,
  PresetParameterValueSchema,
  PresetTargetTypeSchema,
} from '../engine/presetRegistry.ts';
import type {
  MotionPresetDefinition,
  PresetCategory,
  PresetParameterSchema,
  PresetTargetType,
} from '../engine/presetRegistry.ts';

export const PRESET_EXPORT_FORMAT = 'motion-studio.presets.v1' as const;
const CUSTOM_PRESETS_STORAGE_KEY = 'motion_studio_custom_presets_v1';

export interface PresetQueryFilter {
  category?: PresetCategory;
  categories?: PresetCategory[];
  targetType?: PresetTargetType;
  search?: string;
  loopOnly?: boolean;
  customOnly?: boolean;
}

export interface BatchRegisterResult {
  registered: MotionPresetDefinition[];
  errors: Array<{ index: number; id?: string; error: string }>;
}

export interface PresetExportBundle {
  format: typeof PRESET_EXPORT_FORMAT;
  schemaVersion: 1;
  exportedAt: string;
  presetCount: number;
  presets: MotionPresetDefinition[];
}

export interface PresetExportOptions {
  ids?: string[];
  category?: PresetCategory;
  includeBuiltIn?: boolean;
  pretty?: boolean;
}

export interface PresetImportOptions {
  overwriteExisting?: boolean;
  overwriteBuiltIn?: boolean;
  markAsCustom?: boolean;
}

export interface PresetImportResult {
  ok: boolean;
  imported: MotionPresetDefinition[];
  replaced: MotionPresetDefinition[];
  skipped: Array<{ index: number; id: string; reason: string }>;
  errors: Array<{ index: number; id?: string; error: string }>;
}

export interface CreateCustomPresetOptions {
  id?: string;
  name: string;
  description?: string;
  category?: PresetCategory;
  targetType?: PresetTargetType[];
  fps?: number;
}

function slugifyPresetName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'custom-motion';
}

/**
 * Singleton AnimationPresetRegistry service (`src/services/AnimationPresetRegistry.ts`):
 * - Stores built-in & custom animation presets defined in the master specification
 * - Validates preset JSON payloads against the canonical Zod / JSON Schema
 * - Queries and filters presets by category, targetType, loop, custom flag, and search text
 * - Exports custom or selected presets to JSON bundles and imports user-created preset JSON
 * - Instantiates non-destructive MotionModifierInstance modifiers
 */
export class AnimationPresetRegistry {
  private static instance: AnimationPresetRegistry | null = null;
  private presets = new Map<string, MotionPresetDefinition>();
  private builtInIds = new Set<string>();
  private customIds = new Set<string>();
  private revision = 0;
  private listeners = new Set<() => void>();
  private suppressNotify = false;
  private readonly persistToStorage: boolean;

  private constructor(
    initialPresets: MotionPresetDefinition[] = PRESET_REGISTRY,
    persistToStorage = false
  ) {
    this.persistToStorage = persistToStorage;
    for (const preset of initialPresets) {
      const parsed = AnimationPresetSchema.safeParse(preset);
      if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw new Error(`Invalid animation preset "${preset?.id ?? 'unknown'}": ${msg}`);
      }
      this.presets.set(parsed.data.id, parsed.data as MotionPresetDefinition);
      this.builtInIds.add(parsed.data.id);
    }

    if (this.persistToStorage) {
      this.loadCustomPresetsFromStorage();
    }
  }

  public static getInstance(): AnimationPresetRegistry {
    if (!AnimationPresetRegistry.instance) {
      AnimationPresetRegistry.instance = new AnimationPresetRegistry(PRESET_REGISTRY, true);
    }
    return AnimationPresetRegistry.instance;
  }

  public static createScoped(
    initialPresets: MotionPresetDefinition[] = PRESET_REGISTRY
  ): AnimationPresetRegistry {
    return new AnimationPresetRegistry(initialPresets, false);
  }

  public static resetInstance(): void {
    AnimationPresetRegistry.instance = null;
  }

  private loadCustomPresetsFromStorage(): void {
    try {
      const storage = (globalThis as { localStorage?: Storage }).localStorage;
      if (!storage) return;
      const raw = storage.getItem(CUSTOM_PRESETS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { presets?: unknown[] }).presets)
          ? (parsed as { presets: unknown[] }).presets
          : [];
      for (const item of list) {
        const check = this.validatePreset(item);
        if (check.success && !this.builtInIds.has(check.data.id)) {
          this.presets.set(check.data.id, check.data);
          this.customIds.add(check.data.id);
        }
      }
    } catch {
      // Ignore malformed storage entries silently
    }
  }

  private saveCustomPresetsToStorage(): void {
    if (!this.persistToStorage) return;
    try {
      const storage = (globalThis as { localStorage?: Storage }).localStorage;
      if (!storage) return;
      const customPresets = this.getCustomPresets();
      storage.setItem(CUSTOM_PRESETS_STORAGE_KEY, JSON.stringify(customPresets));
    } catch {
      // Ignore storage quota / restricted context errors
    }
  }

  public getRevision(): number {
    return this.revision;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    if (this.suppressNotify) return;
    this.saveCustomPresetsToStorage();
    this.revision += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }

  public getAll(): MotionPresetDefinition[] {
    return Array.from(this.presets.values());
  }

  public isBuiltInPreset(presetId: string): boolean {
    return this.builtInIds.has(presetId);
  }

  public isCustomPreset(presetId: string): boolean {
    return this.customIds.has(presetId);
  }

  public getCustomPresets(): MotionPresetDefinition[] {
    return this.getAll().filter((p) => this.customIds.has(p.id));
  }

  public getBuiltInPresets(): MotionPresetDefinition[] {
    return this.getAll().filter((p) => !this.customIds.has(p.id));
  }

  public hasPreset(presetId: string): boolean {
    return this.presets.has(presetId);
  }

  public getById(presetId: string): MotionPresetDefinition | undefined {
    return this.presets.get(presetId);
  }

  public getPreset(presetId: string): MotionPresetDefinition | undefined {
    return this.getById(presetId);
  }

  public getByCategory(category: PresetCategory): MotionPresetDefinition[] {
    return this.getAll().filter((p) => p.category === category);
  }

  public filterByCategory(category: PresetCategory): MotionPresetDefinition[] {
    return this.getByCategory(category);
  }

  public getByTargetType(targetType: PresetTargetType): MotionPresetDefinition[] {
    return this.getAll().filter((p) => p.targetType.includes(targetType));
  }

  public filterByTargetType(targetType: PresetTargetType): MotionPresetDefinition[] {
    return this.getByTargetType(targetType);
  }

  public query(filter: PresetQueryFilter = {}): MotionPresetDefinition[] {
    const q = filter.search?.trim().toLowerCase() ?? '';
    return this.getAll().filter((p) => {
      if (filter.customOnly && !this.customIds.has(p.id)) return false;
      if (filter.category && p.category !== filter.category) return false;
      if (filter.categories && filter.categories.length > 0 && !filter.categories.includes(p.category)) {
        return false;
      }
      if (filter.targetType && !p.targetType.includes(filter.targetType)) return false;
      if (filter.loopOnly && !p.loop) return false;
      if (q) {
        const hay = `${p.id} ${p.name} ${p.description} ${p.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  public getAvailablePresets(
    categoryOrFilter?: PresetCategory | PresetQueryFilter,
    targetType?: PresetTargetType
  ): MotionPresetDefinition[] {
    if (typeof categoryOrFilter === 'string') {
      return this.query({ category: categoryOrFilter, targetType });
    }
    if (categoryOrFilter && typeof categoryOrFilter === 'object') {
      return this.query({
        ...categoryOrFilter,
        targetType: categoryOrFilter.targetType ?? targetType,
      });
    }
    return this.query({ targetType });
  }

  public getCategoryCounts(): Record<PresetCategory, number> {
    const counts: Record<PresetCategory, number> = {
      character: 0,
      hair: 0,
      clothing: 0,
      environment: 0,
      camera: 0,
      lyrics: 0,
      effects: 0,
    };
    for (const preset of this.presets.values()) {
      counts[preset.category] += 1;
    }
    return counts;
  }

  public validatePreset(
    rawPreset: unknown
  ): { success: true; data: MotionPresetDefinition } | { success: false; error: string } {
    const parsed = AnimationPresetSchema.safeParse(rawPreset);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      };
    }
    return { success: true, data: parsed.data as MotionPresetDefinition };
  }

  public registerPreset(
    rawPreset: unknown,
    options?: { markAsCustom?: boolean }
  ): { success: true; preset: MotionPresetDefinition } | { success: false; error: string } {
    const validated = this.validatePreset(rawPreset);
    if (!validated.success) {
      return validated;
    }
    const id = validated.data.id;
    this.presets.set(id, validated.data);
    const shouldMarkCustom = options?.markAsCustom ?? !this.builtInIds.has(id);
    if (shouldMarkCustom) {
      this.customIds.add(id);
    }
    this.notify();
    return { success: true, preset: validated.data };
  }

  public registerPresets(
    rawPresets: unknown[],
    options?: { markAsCustom?: boolean }
  ): BatchRegisterResult {
    const registered: MotionPresetDefinition[] = [];
    const errors: Array<{ index: number; id?: string; error: string }> = [];
    this.suppressNotify = true;
    try {
      rawPresets.forEach((raw, index) => {
        const res = this.registerPreset(raw, options);
        if (res.success) {
          registered.push(res.preset);
        } else {
          const rawId =
            raw && typeof raw === 'object' && 'id' in raw && typeof (raw as { id?: unknown }).id === 'string'
              ? (raw as { id: string }).id
              : undefined;
          errors.push({ index, id: rawId, error: res.error });
        }
      });
    } finally {
      this.suppressNotify = false;
    }
    if (registered.length > 0) {
      this.notify();
    }
    return { registered, errors };
  }

  public unregisterPreset(presetId: string): boolean {
    const removed = this.presets.delete(presetId);
    if (removed) {
      this.customIds.delete(presetId);
      this.builtInIds.delete(presetId);
      this.notify();
    }
    return removed;
  }

  public clearCustomPresets(): number {
    let removedCount = 0;
    for (const id of Array.from(this.customIds)) {
      if (this.presets.delete(id)) {
        removedCount += 1;
      }
      this.customIds.delete(id);
    }
    if (removedCount > 0) {
      this.notify();
    }
    return removedCount;
  }

  public createCustomPresetFromModifier(
    mod: MotionModifierInstance,
    options: CreateCustomPresetOptions
  ): { success: true; preset: MotionPresetDefinition } | { success: false; error: string } {
    const trimmedName = options.name.trim();
    if (!trimmedName) {
      return { success: false, error: 'Custom preset name is required.' };
    }

    const sourceDef = this.getById(mod.presetId);
    const category: PresetCategory = options.category ?? sourceDef?.category ?? 'effects';
    const targetType: PresetTargetType[] =
      options.targetType && options.targetType.length > 0
        ? options.targetType
        : sourceDef?.targetType ?? ['image', 'sprite', 'character-part', 'layer'];
    const fps = Math.max(1, options.fps ?? 24);
    const durationSec = Math.max(0.25, Number((mod.durationFrames / fps).toFixed(2)));
    const basePresetId = sourceDef?.basePresetId ?? mod.presetId;

    let candidateId = options.id?.trim();
    if (!candidateId) {
      const baseSlug = `custom.${category}.${slugifyPresetName(trimmedName)}`;
      candidateId = baseSlug;
      let counter = 2;
      while (this.hasPreset(candidateId)) {
        candidateId = `${baseSlug}-${counter}`;
        counter += 1;
      }
    }

    const payload: MotionPresetDefinition = {
      id: candidateId,
      version: '1.0.0',
      name: trimmedName,
      category,
      description:
        options.description?.trim() ||
        `Custom setup based on ${sourceDef?.name ?? mod.label ?? mod.presetId}`,
      targetType,
      duration: durationSec,
      loop: mod.loop,
      playbackDirection: mod.direction,
      blendMode: mod.blendMode,
      defaultPivot: mod.pivotAnchor,
      basePresetId,
      defaultIntensity: mod.intensity,
      parameters: {
        ...mod.params,
        speed: mod.speed,
      },
      parameterControls: sourceDef?.parameterControls ? [...sourceDef.parameterControls] : [],
      ...(sourceDef?.environmentPatch ? { environmentPatch: { ...sourceDef.environmentPatch } } : {}),
      ...(sourceDef?.lyricsStyle ? { lyricsStyle: sourceDef.lyricsStyle } : {}),
    };

    return this.registerPreset(payload, { markAsCustom: true });
  }

  public exportPresetsToBundle(options: PresetExportOptions = {}): PresetExportBundle {
    let candidates: MotionPresetDefinition[];
    if (options.ids && options.ids.length > 0) {
      candidates = options.ids
        .map((id) => this.presets.get(id))
        .filter((p): p is MotionPresetDefinition => Boolean(p));
    } else if (options.includeBuiltIn) {
      candidates = this.getAll();
    } else {
      candidates = this.getCustomPresets();
    }

    if (options.category) {
      candidates = candidates.filter((p) => p.category === options.category);
    }

    const cloned = candidates.map((p) => structuredClone(p));
    return {
      format: PRESET_EXPORT_FORMAT,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      presetCount: cloned.length,
      presets: cloned,
    };
  }

  public exportPresetsToJson(options: PresetExportOptions = {}): string {
    const bundle = this.exportPresetsToBundle(options);
    const pretty = options.pretty ?? true;
    return pretty ? JSON.stringify(bundle, null, 2) : JSON.stringify(bundle);
  }

  public exportPresetToJson(presetId: string, pretty = true): string | null {
    if (!this.hasPreset(presetId)) return null;
    return this.exportPresetsToJson({ ids: [presetId], includeBuiltIn: true, pretty });
  }

  public importPresetsFromJson(
    jsonTextOrData: string | unknown,
    options: PresetImportOptions = {}
  ): PresetImportResult {
    const overwriteExisting = options.overwriteExisting ?? true;
    const overwriteBuiltIn = options.overwriteBuiltIn ?? false;
    const markAsCustom = options.markAsCustom ?? true;

    let parsedInput: unknown = jsonTextOrData;
    if (typeof jsonTextOrData === 'string') {
      try {
        parsedInput = JSON.parse(jsonTextOrData) as unknown;
      } catch (err) {
        return {
          ok: false,
          imported: [],
          replaced: [],
          skipped: [],
          errors: [
            {
              index: -1,
              error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }

    let rawList: unknown[] | null = null;
    if (Array.isArray(parsedInput)) {
      rawList = parsedInput;
    } else if (parsedInput && typeof parsedInput === 'object') {
      const obj = parsedInput as Record<string, unknown>;
      if (Array.isArray(obj.presets)) {
        rawList = obj.presets;
      } else if (typeof obj.id === 'string' && typeof obj.name === 'string') {
        rawList = [parsedInput];
      }
    }

    if (!rawList) {
      return {
        ok: false,
        imported: [],
        replaced: [],
        skipped: [],
        errors: [
          {
            index: -1,
            error:
              'Unrecognized preset JSON format. Expected a preset object, an array of presets, or a motion-studio.presets.v1 bundle.',
          },
        ],
      };
    }

    const imported: MotionPresetDefinition[] = [];
    const replaced: MotionPresetDefinition[] = [];
    const skipped: Array<{ index: number; id: string; reason: string }> = [];
    const errors: Array<{ index: number; id?: string; error: string }> = [];

    this.suppressNotify = true;
    try {
      rawList.forEach((raw, index) => {
        const rawId =
          raw && typeof raw === 'object' && 'id' in raw && typeof (raw as { id?: unknown }).id === 'string'
            ? (raw as { id: string }).id
            : undefined;

        const validated = this.validatePreset(raw);
        if (!validated.success) {
          errors.push({ index, id: rawId, error: validated.error });
          return;
        }

        const preset = validated.data;
        const alreadyExists = this.presets.has(preset.id);
        const isBuiltIn = this.builtInIds.has(preset.id);

        if (alreadyExists) {
          if (isBuiltIn && !overwriteBuiltIn) {
            skipped.push({
              index,
              id: preset.id,
              reason: 'Preset ID matches a built-in preset.',
            });
            return;
          }
          if (!overwriteExisting) {
            skipped.push({
              index,
              id: preset.id,
              reason: 'Preset with this ID already exists.',
            });
            return;
          }
        }

        this.presets.set(preset.id, preset);
        if (markAsCustom && (!isBuiltIn || overwriteBuiltIn)) {
          this.customIds.add(preset.id);
          if (overwriteBuiltIn) this.builtInIds.delete(preset.id);
        }

        if (alreadyExists) {
          replaced.push(preset);
        } else {
          imported.push(preset);
        }
      });
    } finally {
      this.suppressNotify = false;
    }

    if (imported.length > 0 || replaced.length > 0) {
      this.notify();
    }

    return {
      ok: errors.length === 0 && (imported.length > 0 || replaced.length > 0 || skipped.length > 0),
      imported,
      replaced,
      skipped,
      errors,
    };
  }

  public createModifier(
    presetId: string,
    fps: number,
    modifierId: string,
    overrides?: Partial<MotionModifierInstance>
  ): MotionModifierInstance | null {
    const def = this.getById(presetId);
    if (!def) return null;

    const durationFrames = Math.max(1, Math.round(def.duration * Math.max(1, fps)));
    return {
      id: modifierId,
      presetId: def.id,
      basePresetId: overrides?.basePresetId ?? def.basePresetId,
      label: def.name,
      enabled: true,
      startFrame: overrides?.startFrame ?? 0,
      durationFrames: overrides?.durationFrames ?? durationFrames,
      delayFrames: overrides?.delayFrames ?? 0,
      loop: overrides?.loop ?? def.loop,
      direction: overrides?.direction ?? def.playbackDirection,
      blendMode: overrides?.blendMode ?? def.blendMode,
      intensity: overrides?.intensity ?? def.defaultIntensity ?? 1,
      speed: overrides?.speed ?? Number(def.parameters.speed ?? 1),
      phaseOffset: overrides?.phaseOffset ?? 0,
      pivotAnchor: overrides?.pivotAnchor ?? def.defaultPivot,
      params: {
        ...def.parameters,
        ...(overrides?.params ?? {}),
      },
    };
  }

  public getJsonSchema(): Record<string, unknown> {
    return ANIMATION_PRESET_JSON_SCHEMA;
  }

  public toJSON(): MotionPresetDefinition[] {
    return this.getAll();
  }
}

export const animationPresetRegistry = AnimationPresetRegistry.getInstance();

export function getPresetById(presetId: string): MotionPresetDefinition | undefined {
  return animationPresetRegistry.getById(presetId);
}

export function getAvailablePresets(
  categoryOrFilter?: PresetCategory | PresetQueryFilter,
  targetType?: PresetTargetType
): MotionPresetDefinition[] {
  return animationPresetRegistry.getAvailablePresets(categoryOrFilter, targetType);
}

export function createModifierFromPreset(
  presetId: string,
  fps: number,
  modifierId: string,
  overrides?: Partial<MotionModifierInstance>
): MotionModifierInstance | null {
  return animationPresetRegistry.createModifier(presetId, fps, modifierId, overrides);
}

export {
  ANIMATION_PRESET_JSON_SCHEMA,
  AnimationPresetSchema,
  PRESET_REGISTRY,
  PresetCategorySchema,
  PresetParameterControlSchema,
  PresetParameterValueSchema,
  PresetTargetTypeSchema,
};

export type {
  MotionPresetDefinition,
  PresetCategory,
  PresetParameterSchema,
  PresetTargetType,
};
