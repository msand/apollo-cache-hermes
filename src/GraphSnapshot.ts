import { NodeSnapshot } from './nodes';
import { QueryResult, QueryResultWithNodeIds } from './operations/read';
import { NodeId, OperationInstance } from './schema';
import { deepFreeze } from './util/freeze';

export type NodeSnapshotMap = { [Key in NodeId]: NodeSnapshot };

/** Changed nodes, by id: their new snapshot, or null if removed. */
type NodeChanges = Map<NodeId, NodeSnapshot | null>;

/**
 * Maintains an identity map of all value snapshots that reference into a
 * particular version of the graph.
 *
 * Provides an immutable view into the graph at a point in time.
 *
 * Also provides a place to hang per-snapshot caches off of.
 *
 * Snapshots made from others (see withChanges) share their nodes: each holds
 * a base map of nodes, shared with other snapshots and never modified, and the
 * changes made on top of it. A write therefore costs a copy of the changes so
 * far rather than of the whole graph; once the changes grow past the square
 * root of the base's size, they are merged into a new base.
 */
export class GraphSnapshot {
  /**
   * Returns a snapshot of `parent` with `changes` (new snapshots by id, or
   * undefined for removed nodes) applied, sharing parent's nodes.
   *
   * @internal
   */
  static withChanges(parent: GraphSnapshot, changes: { [Key in NodeId]: NodeSnapshot | undefined }): GraphSnapshot {
    const merged: NodeChanges = parent._changes ? new Map(parent._changes) : new Map();
    const fresh: NodeSnapshot[] = [];
    for (const id in changes) {
      const node = changes[id];
      merged.set(id, node ?? null);
      if (node) fresh.push(node);
    }

    let snapshot;
    if (merged.size * merged.size > parent._baseSize) {
      const values = flatten(parent._base, merged);
      snapshot = new GraphSnapshot(values, undefined, Object.keys(values).length);
    } else {
      snapshot = new GraphSnapshot(parent._base, merged, parent._baseSize);
    }
    snapshot._fresh = fresh;
    return snapshot;
  }

  /** Cached results for queries. */
  public readonly readCache = new Map<OperationInstance<GraphSnapshot>, QueryResult | QueryResultWithNodeIds>();

  // (The fields below are not enumerable, and _values is an enumerable getter,
  // so that snapshots holding the same nodes are deeply equal however they
  // share them.)

  /** The nodes (shared with other snapshots: never modified). */
  declare private readonly _base: NodeSnapshotMap;

  /** Changes on top of _base. */
  declare private readonly _changes: NodeChanges | undefined;

  /** The number of nodes in _base. */
  declare private readonly _baseSize: number;

  /** The nodes added or changed by this snapshot (those that freeze() freezes); all of them if undefined. */
  declare private _fresh: NodeSnapshot[] | undefined;

  /** All of the nodes (built on demand when there are changes). */
  declare private _flat: NodeSnapshotMap | undefined;

  /**
   * All of the nodes, by id (an object with a null prototype; do not modify).
   *
   * @internal
   */
  declare readonly _values: NodeSnapshotMap;

  /**
   * @internal
   */
  constructor(
    // TODO: Profile Object.create(null) vs Map.
    base: NodeSnapshotMap = Object.create(null),
    changes?: NodeChanges,
    baseSize: number = Object.keys(base).length,
  ) {
    Object.defineProperties(this, {
      _base: { value: base },
      _changes: { value: changes },
      _baseSize: { value: baseSize },
      _fresh: { value: undefined, writable: true },
      _flat: { value: undefined, writable: true },
      _values: { get: allValues, enumerable: true },
    });
  }

  /**
   * See _values.
   *
   * @internal
   */
  _allValues(): NodeSnapshotMap {
    if (!this._changes) return this._base;
    if (!this._flat) {
      this._flat = flatten(this._base, this._changes);
    }
    return this._flat;
  }

  /**
   * Retrieves the value identified by `id`.
   */
  getNodeData(id: NodeId): any {
    const snapshot = this.getNodeSnapshot(id);
    return snapshot ? snapshot.data : undefined;
  }

  /**
   * Returns whether `id` exists as an value in the graph.
   */
  has(id: NodeId): boolean {
    if (this._changes) {
      const node = this._changes.get(id);
      if (node !== undefined) return node !== null;
    }
    return id in this._base;
  }

  /**
   * Retrieves the snapshot for the value identified by `id`.
   *
   * @internal
   */
  getNodeSnapshot(id: NodeId): Readonly<NodeSnapshot> | undefined {
    if (this._changes) {
      const node = this._changes.get(id);
      if (node !== undefined) return node ?? undefined;
    }
    return this._base[id];
  }

  /**
   * Returns the set of ids present in the snapshot.
   *
   * @internal
   */
  allNodeIds(): NodeId[] {
    return Object.keys(this._values);
  }

  /**
   * Freezes the snapshot (generally for development mode)
   *
   * @internal
   */
  freeze(): void {
    // Node snapshots are class instances, so freeze them and their (plain) data
    // explicitly. (Nodes this snapshot shares with the one it was made from
    // were frozen with that one.)
    for (const node of this._fresh ?? Object.values(this._base)) {
      if (!node || Object.isFrozen(node)) continue;
      Object.freeze(node);
      for (const value of Object.values(node)) deepFreeze(value);
    }
    if (!this._changes) Object.freeze(this._base);
  }
}

function allValues(this: GraphSnapshot): NodeSnapshotMap {
  return this._allValues();
}

/**
 * The nodes of `base` with `changes` applied, in the order of an object
 * updated in place (changed nodes keep their position; new ones come last).
 */
function flatten(base: NodeSnapshotMap, changes: NodeChanges): NodeSnapshotMap {
  const values = Object.create(null) as NodeSnapshotMap;
  for (const id in base) {
    const node = changes.get(id);
    if (node === undefined) values[id] = base[id];
    else if (node) values[id] = node;
  }
  for (const [id, node] of changes) {
    if (node && !(id in base)) values[id] = node;
  }
  return values;
}
