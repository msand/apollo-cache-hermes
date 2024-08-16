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
  const references = snapshot[direction];
  if (!references) return true;

  const key = direction === 'inbound' ? JSON.stringify({ id, path }) : path.join();
  const ref = references.get(key);
  if (ref === undefined) return false;
  references.delete(key);

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
): boolean {
  let references = snapshot[direction];
  if (!references) {
    references = snapshot[direction] = new Map();
  }

  const key = direction === 'inbound' ? JSON.stringify({ id, path }) : path.join();
  const idx = references.get(key);
  if (idx === undefined) {
    references.set(key, { id, path });
    return true;
  }
  return false;
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
  const references = snapshot[type];
  return references !== undefined && references.has(type === 'inbound' ? JSON.stringify({ id, path }) : path.join());
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
