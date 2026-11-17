import type { CompositionRecord, LayerDocument } from '../schema/projectSchema.ts';

/**
 * Detects whether nesting `candidateChildCompId` inside `parentCompId` would
 * create a circular composition dependency.
 */
export function wouldCreateCompositionCycle(
  compositions: CompositionRecord[],
  parentCompId: string,
  candidateChildCompId: string
): boolean {
  if (parentCompId === candidateChildCompId) return true;

  const compMap = new Map<string, CompositionRecord>();
  for (const c of compositions) {
    compMap.set(c.id, c);
  }

  // BFS/DFS starting from candidateChildCompId to see if it reaches parentCompId
  const visited = new Set<string>();
  const stack = [candidateChildCompId];

  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (currentId === parentCompId) return true;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const comp = compMap.get(currentId);
    if (!comp) continue;

    for (const layer of comp.layers) {
      for (const obj of layer.objects) {
        if (obj.kind === 'nestedComposition') {
          if (obj.compositionId === parentCompId) return true;
          stack.push(obj.compositionId);
        }
      }
    }
  }

  return false;
}

/**
 * Detects whether setting `childLayerId.parentId = candidateParentLayerId`
 * would introduce a parenting cycle inside a Composition.
 */
export function wouldCreateLayerParentCycle(
  layers: LayerDocument[],
  childLayerId: string,
  candidateParentLayerId: string
): boolean {
  if (childLayerId === candidateParentLayerId) return true;

  const parentById = new Map<string, string | undefined>();
  for (const l of layers) {
    parentById.set(l.id, l.parentId);
  }

  let cursor: string | undefined = candidateParentLayerId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === childLayerId) return true;
    if (visited.has(cursor)) return true; // already cyclic
    visited.add(cursor);
    cursor = parentById.get(cursor);
  }
  return false;
}
