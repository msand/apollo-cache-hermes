import isEqual from '@wry/equality';

import { NodeReference, NodeSnapshot } from '../nodes';
import { JsonObject, PathPart } from '../primitive';
import { NodeId } from '../schema';

export type ReferenceDirection = 'inbound' | 'outbound';

/**
 * Mutates a snapshot, removing an inbound reference from it.
 *
 * Returns whether all references were removed.
 */
export function removeNodeReference(
  direction: ReferenceDirection,
  snapshot: NodeSnapshot,
  id: NodeId,
  path: PathPart[],
): boolean {
  let references: Map<string, NodeReference> | Map<string, NodeReference[]> | undefined;
  if (direction === 'inbound') {
    const map = snapshot.inbound;
    if (!map) return true;
    const key = JSON.stringify({ id, path });
    const ref = map.get(key);
    if (ref === undefined) return false;
    map.delete(key);
    references = map;
  } else {
    const map = snapshot.outbound;
    if (!map) return true;
    const key = path.join();
    const refs = map.get(key);
    if (!refs) return false;
    const index = getIndexOfGivenReference(refs, id, path);
    if (index !== -1) {
      refs.splice(index, 1);
    }
    if (refs.length === 0) {
      map.delete(key);
    }
    references = map;
  }

  const empty = references.size === 0;
  if (empty) {
    snapshot[direction] = undefined;
  }

  return empty;
}

/**
 * Mutates a snapshot, adding a new reference to it.
 */
export function addNodeReference(
  direction: ReferenceDirection,
  snapshot: NodeSnapshot,
  id: NodeId,
  path: PathPart[],
) {
  if (direction === 'inbound') {
    let references = snapshot.inbound;
    if (!references) {
      references = snapshot.inbound = new Map();
    }
    const node: NodeReference = { id, path };
    const key = JSON.stringify(node);
    references.set(key, node);
  } else {
    let references = snapshot.outbound;
    if (!references) {
      references = snapshot.outbound = new Map();
    }
    const key = path.join();
    const refs = references.get(key);
    if (!refs || getIndexOfGivenReference(refs, id, path) === -1) {
      set(references, { id, path });
    }
  }
}

/**
 * Return true if { id, path } is a valid reference in the node's references
 * array. Otherwise, return false.
 */
export function hasNodeReference(
  snapshot: NodeSnapshot,
  type: ReferenceDirection,
  id: NodeId,
  path: PathPart[],
): boolean {
  if (type === 'inbound') {
    return snapshot.inbound?.has(JSON.stringify({ id, path })) === true;
  } else {
    const refs = snapshot.outbound?.get(path.join());
    return Array.isArray(refs) && getIndexOfGivenReference(refs, id, path) > -1;
  }
}

/**
 * Return index of { id, path } reference in references array.
 * Otherwise, return -1.
 */
export function getIndexOfGivenReference(references: NodeReference[], id: NodeId, path: PathPart[]): number {
  return references.findIndex((reference) => {
    return reference.id === id && isEqual(reference.path, path);
  });
}

function getCircularReplacer() {
  const ancestors: unknown[] = [];
  return function replacer(this: unknown, _key: string, value: unknown) {
    if (typeof value !== 'object' || value === null) {
      return value;
    }
    // `this` is the object that value is contained in,
    // i.e., its direct parent.
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
      ancestors.pop();
    }
    if (ancestors.includes(value)) {
      return '[Circular]';
    }
    ancestors.push(value);
    return value;
  };
}

export function safeStringify(value: JsonObject) {
  try {
    return JSON.stringify(value, undefined, 2);
  } catch (e) {
    try {
      return JSON.stringify(value, getCircularReplacer(), 2);
    } catch (error) {
      try {
        if (typeof value === 'object') {
          const obj: Record<string, unknown> = {};
          Object.entries(value).forEach(([key, val]) => {
            obj[key] = val == null ? val : Array.isArray(val) ? '[...]' : typeof val === 'object' ? '{...}' : val;
          });
          return JSON.stringify(obj, undefined, 2);
        }
      } catch (innerError) {
        return error instanceof Error ? error.message : 'Failed to stringify value';
      }
      return error instanceof Error ? error.message : 'Failed to stringify value';
    }
  }
}

export const nodeToEntry = (node: NodeReference): [string, NodeReference] => [node.path.join(), node];
export const nodeToInEntry = (node: NodeReference): [string, NodeReference] => [JSON.stringify(node), node];

export function getInbound(inbound: NodeReference[]) {
  return new Map(inbound.map(nodeToInEntry));
}

export const set = (map: Map<string, NodeReference[]>, node: NodeReference) => {
  const key = node.path.join();
  const arr = map.get(key) ?? [];
  if (arr.length === 0) {
    map.set(key, arr);
  }
  arr.push(node);
};

export function getOutbound(outbound: Iterable<NodeReference> | undefined): Map<string, NodeReference[]> | undefined {
  if (!outbound) {
    return outbound;
  }
  const map = new Map<string, NodeReference[]>();
  for (const out of outbound) {
    set(map, out);
  }
  return map;
}

export function *iterOutbound(outbound: Map<string, NodeReference[]> | undefined) {
  if (!outbound) {
    return;
  }
  for (const out of outbound.values()) {
    for (const o of out) {
      yield o;
    }
  }
}
