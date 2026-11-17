import { MotionProject, validateProject } from '../schema/projectSchema';

const DB_NAME = 'motion_studio_db';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_META = 'meta';

export interface SavedProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  compositionCount: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProjectToIndexedDb(project: MotionProject): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_PROJECTS, STORE_META], 'readwrite');
    tx.objectStore(STORE_PROJECTS).put(project);
    tx.objectStore(STORE_META).put({ key: 'lastOpenedProjectId', value: project.id });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadProjectFromIndexedDb(id: string): Promise<MotionProject | null> {
  const db = await openDatabase();
  const raw = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const req = tx.objectStore(STORE_PROJECTS).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!raw) return null;
  const validated = validateProject(raw);
  return validated.success ? validated.data : null;
}

export async function getLastOpenedProjectId(): Promise<string | null> {
  try {
    const db = await openDatabase();
    const res = await new Promise<{ key: string; value: string } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get('lastOpenedProjectId');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return res?.value ?? null;
  } catch {
    return null;
  }
}

export async function listSavedProjects(): Promise<SavedProjectSummary[]> {
  try {
    const db = await openDatabase();
    const all = await new Promise<MotionProject[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).getAll();
      req.onsuccess = () => resolve((req.result as MotionProject[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all
      .map((p) => ({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        compositionCount: p.compositions?.length ?? 0,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export async function deleteProjectFromIndexedDb(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function serializeMotionXArchive(project: MotionProject): string {
  return JSON.stringify(
    {
      format: 'motionx-project-archive',
      archiveVersion: 1,
      exportedAt: new Date().toISOString(),
      project,
    },
    null,
    2
  );
}

export function parseMotionXArchive(
  jsonText: string
): { success: true; project: MotionProject } | { success: false; error: string } {
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const rawProject =
      parsed && typeof parsed === 'object' && 'project' in parsed ? parsed.project : parsed;
    const validated = validateProject(rawProject);
    if (!validated.success) {
      return { success: false, error: validated.error };
    }
    return { success: true, project: validated.data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Invalid .motionx archive JSON',
    };
  }
}
