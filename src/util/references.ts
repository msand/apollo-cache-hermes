import { Reference } from '@apollo/client/utilities';

import { NodeReference, NodeSnapshot } from '../nodes';
import { JsonObject, PathPart } from '../primitive';
import { NodeId } from '../schema';

/**
 * The reference maps that node snapshots share with the snapshots they were
 * cloned from (see cloneNodeSnapshot): the functions below copy them before
 * changing them.
 */
const sharedReferences = new WeakSet<object>();

/** Marks the reference maps of a node snapshot as shared (with a clone of it). */
export function shareReferences(snapshot: NodeSnapshot) {
  if (snapshot.inbound) sharedReferences.add(snapshot.inbound);
  if (snapshot.outbound) sharedReferences.add(snapshot.outbound);
  if (snapshot.parameterized) sharedReferences.add(snapshot.parameterized);
}

function ownInbound(snapshot: NodeSnapshot) {
  const map = snapshot.inbound;
  return map && sharedReferences.has(map) ? (snapshot.inbound = new Map(map)) : map;
}

function ownOutbound(snapshot: NodeSnapshot) {
  const map = snapshot.outbound;
  return map && sharedReferences.has(map) ? (snapshot.outbound = new Map(map)) : map;
}

/** (The lists in the map are shared too: they are copied before they are changed.) */
function ownParameterized(snapshot: NodeSnapshot) {
  const map = snapshot.parameterized;
  return map && sharedReferences.has(map) ? (snapshot.parameterized = new Map(map)) : map;
}

/**
 * Mutates a snapshot, removing a reference from it.
 */
export function removeInboundReference(snapshot: NodeSnapshot, id: NodeId, path: PathPart[]) {
  const map = ownInbound(snapshot);
  if (!map) return;

  const key = toInKey(id, path);
  map.delete(key);

  const empty = map.size === 0;
  if (empty) {
    snapshot.inbound = undefined;
  }
}
export function removeOutboundReference(snapshot: NodeSnapshot, path: PathPart[]) {
  const map = ownOutbound(snapshot);
  if (!map) return;

  const key = toOutKey(path);
  map.delete(key);

  const empty = map.size === 0;
  if (empty) {
    snapshot.outbound = undefined;
  }
}
export function removeParameterizedReference(snapshot: NodeSnapshot, id: NodeId, path: PathPart[]) {
  const map = ownParameterized(snapshot);
  if (!map) return;

  const key = toParamKey(path);
  let refs = map.get(key);
  if (!refs) return;

  const index = getIndexOfGivenReference(refs, id, path);
  if (index !== -1) {
    refs = refs.filter((_ref, i) => i !== index);
    map.set(key, refs);
  }

  if (refs.length === 0) {
    map.delete(key);
  }

  const empty = map.size === 0;
  if (empty) {
    snapshot.parameterized = undefined;
  }
}

/**
 * Mutates a snapshot, adding a new reference to it.
 */
export function addInboundReference(snapshot: NodeSnapshot, id: NodeId, path: PathPart[]) {
  const node: NodeReference = { id, path };
  let references = ownInbound(snapshot);
  if (!references) {
    references = snapshot.inbound = new Map();
  }
  const key = refToInKey(node);
  references.set(key, node);
}
export function addOutboundReference(snapshot: NodeSnapshot, id: NodeId, path: PathPart[]) {
  const node: NodeReference = { id, path };
  let references = ownOutbound(snapshot);
  if (!references) {
    references = snapshot.outbound = new Map();
  }
  const key = toOutKey(path);
  references.set(key, node);
}
export function addParameterizedReference(snapshot: NodeSnapshot, id: NodeId, path: PathPart[]) {
  let references = ownParameterized(snapshot);
  if (!references) {
    references = snapshot.parameterized = new Map();
  }
  const key = toParamKey(path);
  const refs = references.get(key);
  if (refs === undefined) {
    references.set(key, [{ id, path }]);
  } else if (getIndexOfGivenReference(refs, id, path) === -1) {
    references.set(key, [...refs, { id, path }]);
  }
}

/**
 * Return true if { id, path } is a valid reference in the node's references
 * array. Otherwise, return false.
 */
export function hasParameterizedReference(snapshot: NodeSnapshot, id: NodeId, path: PathPart[]): boolean {
  const refs = snapshot.parameterized?.get(toParamKey(path));
  return refs !== undefined && getIndexOfGivenReference(refs, id, path) > -1;
}

/**
 * Return index of { id, path } reference in references array.
 * Otherwise, return -1.
 */
export function getIndexOfGivenReference(references: NodeReference[], id: NodeId, path: PathPart[]): number {
  return references.findIndex(reference => {
    const p = reference.path;
    return reference.id === id && path.every((part, i) => part === p[i]);
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

export function refToInKey({ id, path }: NodeReference) {
  return `${id}.${path.join('.')}`;
}
export function toInKey(id: NodeId, path: PathPart[]) {
  return `${id}.${path.join('.')}`;
}
export function toOutKey(path: PathPart[]) {
  // (The common case: a field of an entity.)
  return path.length === 1 ? String(path[0]) : path.join('.');
}
export function toParamKey(path: PathPart[]) {
  return path[0].toString();
}

export function getInbound(inbound: NodeReference[] | undefined): Map<string, NodeReference> | undefined {
  if (!inbound) {
    return inbound;
  }
  const map = new Map<string, NodeReference>();
  for (const ref of inbound) {
    map.set(refToInKey(ref), ref);
  }
  return map;
}

export function getOutbound(outbound: Iterable<NodeReference> | undefined): Map<string, NodeReference> | undefined {
  if (!outbound) {
    return outbound;
  }
  const map = new Map<string, NodeReference>();
  for (const out of outbound) {
    map.set(toOutKey(out.path), out);
  }
  return map;
}

function setParameterized(map: Map<string, NodeReference[]>, node: NodeReference) {
  const key = toParamKey(node.path);
  const arr = map.get(key);
  if (arr === undefined) {
    map.set(key, [node]);
  } else {
    arr.push(node);
  }
}

export const set = setParameterized;

export function getParameterized(
  parameterized: Iterable<NodeReference> | undefined,
): Map<string, NodeReference[]> | undefined {
  if (!parameterized) {
    return parameterized;
  }
  const map = new Map<string, NodeReference[]>();
  for (const ref of parameterized) {
    setParameterized(map, ref);
  }
  return map;
}

export function* iterParameterized(parameterized: Map<string, NodeReference[]> | undefined) {
  if (!parameterized) {
    return;
  }
  for (const refs of parameterized.values()) {
    for (const ref of refs) {
      yield ref;
    }
  }
}

export function* iterRefs(
  outbound: Map<string, NodeReference> | undefined,
  parameterized: Map<string, NodeReference[]> | undefined,
): Generator<NodeReference> {
  if (parameterized !== undefined) {
    for (const refs of parameterized.values()) {
      for (const ref of refs) {
        yield ref;
      }
    }
  }
  if (outbound !== undefined) {
    for (const ref of outbound.values()) {
      yield ref;
    }
  }
}

export function isReference(obj: any): obj is Reference {
  return obj != null && typeof obj === 'object' && typeof obj.__ref === 'string';
}
