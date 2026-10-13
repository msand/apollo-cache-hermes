import { NodeSnapshot } from './nodes';
import { QueryResult, QueryResultWithNodeIds } from './operations/read';
import { NodeId, OperationInstance } from './schema';
import { deepFreeze } from './util/freeze';

export type NodeSnapshotMap = { [Key in NodeId]: NodeSnapshot };

/** Changed nodes, by id: their new snapshot, or null if removed. */
type NodeChanges = Map<NodeId, NodeSnapshot | null>;

/** The most changes a snapshot keeps in its own (latest) level. */
const TOP_SIZE = 32;

/**
 * Maintains an identity map of all value snapshots that reference into a
 * particular version of the graph.
 *
 * Provides an immutable view into the graph at a point in time.
 *
 * Also provides a place to hang per-snapshot caches off of.
 *
 * Snapshots made from others (see withChanges) share their nodes: each holds
 * a base map of nodes, shared with other snapshots and never modified, and two
 * levels of changes on top of it (like a log-structured merge tree), so that a
 * write costs a copy of some of the changes so far rather than of the whole
 * graph:
 *
 * - the latest changes, copied by each write, until they outgrow TOP_SIZE;
 * - then merged into the earlier changes (copying those), until those outgrow
 *   the square root of 2 × the base's size × the size of the latest changes
 *   (which balances the cost of copying them with that of merging them into a
 *   new base);
 * - then merged into a new base.
 */
/** The nodes of a snapshot (see GraphSnapshot). */
interface SnapshotState {
  /** The nodes (shared with other snapshots: never modified). */
  readonly base: NodeSnapshotMap;
  /** The number of nodes in base. */
  readonly baseSize: number;
  /** Earlier changes on top of base. */
  readonly mid: NodeChanges | undefined;
  /** The latest changes, on top of mid. */
  readonly top: NodeChanges | undefined;
  /** The nodes added or changed by this snapshot (those that freeze() freezes); all of them if undefined. */
  fresh: NodeSnapshot[] | undefined;
  /** All of the nodes (built on demand when there are changes). */
  flat: NodeSnapshotMap | undefined;
}

export class GraphSnapshot {
  /**
   * Returns a snapshot of `parent` with `changes` (new snapshots by id, or
   * undefined for removed nodes) applied, sharing parent's nodes.
   *
   * @internal
   */
  static withChanges(parent: GraphSnapshot, changes: { [Key in NodeId]: NodeSnapshot | undefined }): GraphSnapshot {
    const state = parent._state;
    let top: NodeChanges | undefined = state.top ? new Map(state.top) : new Map();
    const fresh: NodeSnapshot[] = [];
    for (const id in changes) {
      const node = changes[id];
      top.set(id, node ?? null);
      if (node) fresh.push(node);
    }

    let { base, mid, baseSize } = state;
    if (top.size > TOP_SIZE) {
      const merged = mergeChanges(mid, top);
      if (merged.size * merged.size > 2 * baseSize * top.size) {
        base = flatten(base, merged);
        baseSize = countKeys(base);
        mid = undefined;
      } else {
        mid = merged;
      }
      top = undefined;
    }
    const snapshot = new GraphSnapshot(base, mid, top, baseSize);
    snapshot._state.fresh = fresh;
    return snapshot;
  }

  /** Cached results for queries. */
  public readonly readCache = new Map<OperationInstance<GraphSnapshot>, QueryResult | QueryResultWithNodeIds>();

  /**
   * The nodes. (Not enumerable, while _values is an enumerable getter, so
   * that snapshots holding the same nodes are deeply equal however they share
   * them.)
   */
  declare private readonly _state: SnapshotState;

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
    mid?: NodeChanges,
    top?: NodeChanges,
    baseSize: number = countKeys(base),
  ) {
    const state: SnapshotState = { base, baseSize, mid, top, fresh: undefined, flat: undefined };
    Object.defineProperty(this, '_state', { value: state });
    Object.defineProperty(this, '_values', { get: allValues, enumerable: true });
  }

  /**
   * See _values.
   *
   * @internal
   */
  _allValues(): NodeSnapshotMap {
    const state = this._state;
    if (!state.mid && !state.top) return state.base;
    state.flat ??= flatten(state.base, state.top ? mergeChanges(state.mid, state.top) : state.mid!);
    return state.flat;
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
    return this.getNodeSnapshot(id) !== undefined;
  }

  /**
   * Retrieves the snapshot for the value identified by `id`.
   *
   * @internal
   */
  getNodeSnapshot(id: NodeId): Readonly<NodeSnapshot> | undefined {
    // (Like the keys of an object, ids that are not strings, e.g. numbers that
    // resolver redirects return, are converted to strings.)
    if (typeof id !== 'string') id = String(id);
    const { top, mid, base } = this._state;
    let node;
    if (top !== undefined && (node = top.get(id)) !== undefined) return node ?? undefined;
    if (mid !== undefined && (node = mid.get(id)) !== undefined) return node ?? undefined;
    return base[id];
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
    const state = this._state;
    // Node snapshots are class instances, so freeze them and their (plain) data
    // explicitly. (Nodes this snapshot shares with the one it was made from
    // were frozen with that one.)
    for (const node of state.fresh ?? Object.values(state.base)) {
      if (!node || Object.isFrozen(node)) continue;
      Object.freeze(node);
      for (const value of Object.values(node)) deepFreeze(value);
    }
    if (!state.mid && !state.top) Object.freeze(state.base);
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

/** `changes` applied to `earlier` (a new map). */
function mergeChanges(earlier: NodeChanges | undefined, changes: NodeChanges): NodeChanges {
  const merged = new Map(earlier);
  for (const [id, node] of changes) merged.set(id, node);
  return merged;
}

function countKeys(values: NodeSnapshotMap): number {
  let count = 0;
  for (const _id in values) count++;
  return count;
}
