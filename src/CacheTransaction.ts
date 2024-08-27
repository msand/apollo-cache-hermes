import type {
  DeleteModifier,
  InvalidateModifier,
  Modifier,
  ModifierDetails,
  ReadFieldOptions,
} from '@apollo/client/cache/core/types/common';
import type { Cache as CacheInterface, Reference, StoreObject, StoreValue } from '@apollo/client';
import { makeReference } from '@apollo/client';
import * as equality from '@wry/equality';

import type { ChangeId, NodeId, OperationInstance, CacheDelta, RawOperation } from './schema';
import type { CacheSnapshot as CacheSnapshotType } from './CacheSnapshot';
import type { GraphSnapshot, NodeSnapshotMap } from './GraphSnapshot';
import type { JsonObject, JsonValue } from './primitive';
import type { CacheContext } from './context';
import type { Queryable } from './Queryable';
import type { NodeReference, NodeSnapshot } from './nodes';
import type { DocumentNode } from './util';
import * as transaction from './apollo/Transaction';
import * as cacheSnapshot from './CacheSnapshot';
import * as operations from './operations';
import * as schema from './schema';
import * as nodes from './nodes';
import * as util from './util';

const isEqual = equality.equal;
const makeRef = makeReference;
const { StaticNodeId } = schema;
const { CacheSnapshot } = cacheSnapshot;
const { ApolloTransaction } = transaction;
const { cloneNodeSnapshot, EntitySnapshot } = nodes;
const { read, SnapshotEditor, write } = operations;
const { addToSet, isObject, isReference } = util;

const DELETE: DeleteModifier = Object.create(null);
const INVALIDATE: InvalidateModifier = Object.create(null);

function isDeleteModifier(value: any): value is DeleteModifier {
  return value === DELETE;
}

function isInvalidateModifier(value: any): value is InvalidateModifier {
  return value === INVALIDATE;
}

type Node<TSerialized> = {
  node: any,
  previous: JsonValue | undefined,
  updater: CacheContext.EntityUpdater<TSerialized>,
};

/**
 * Collects a set of edits against a version of the cache, eventually committing
 * them in the form of a new cache snapshot.
 *
 * If a ChangeId is provided, edits will be made on top of the optimistic state
 * (an optimistic update).  Otherwise edits are made against the baseline state.
 */
export class CacheTransaction<TSerialized> implements Queryable {

  /** The set of nodes edited throughout the transaction. */
  private _editedNodeIds = new Set<NodeId>();

  /** All edits made throughout the transaction. */
  private _deltas: CacheDelta[] = [];

  /** All queries written during the transaction. */
  private _writtenQueries = new Set<OperationInstance<TSerialized>>();

  /** The original snapshot before the transaction began. */
  private _parentSnapshot: CacheSnapshotType;

  constructor(
    private _context: CacheContext<TSerialized>,
    private _snapshot: CacheSnapshotType,
    private _optimisticChangeId?: ChangeId,
  ) {
    this._parentSnapshot = _snapshot;
  }

  isOptimisticTransaction(): true | undefined {
    return this._optimisticChangeId ? true : undefined;
  }

  transformDocument(document: DocumentNode): DocumentNode {
    return this._context.transformDocument(document);
  }

  /**
   * Executes reads against the current values in the transaction.
   */
  read(query: RawOperation): CacheInterface.DiffResult<JsonValue> {
    return read(
      this._context,
      query,
      this._optimisticChangeId ? this._snapshot.optimistic : this._snapshot.baseline,
      Object.create(null)
    );
  }

  /**
   * Merges a payload with the current values in the transaction.
   *
   * If this is an optimistic transaction, edits will be made directly on top of
   * any previous optimistic values.  Otherwise, edits will be made to the
   * baseline state (and any optimistic updates will be replayed over it).
   */
  write(query: RawOperation, payload: JsonObject): Reference | undefined {
    if (this._optimisticChangeId) {
      return this._writeOptimistic(query, payload);
    } else {
      return this._writeBaseline(query, payload);
    }
  }

  /**
   * Roll back a previously enqueued optimistic update.
   */
  rollback(changeId: ChangeId): void {
    const current = this._snapshot;

    const optimisticQueue = current.optimisticQueue.remove(changeId);
    current.optimisticQueue = optimisticQueue;
    const optimistic = this._buildOptimisticSnapshot(current.baseline);

    // Invalidate all IDs from the soon-to-be previous optimistic snapshot,
    // since we don't know which IDs were changed by the one we're rolling back.
    const allIds = new Set(current.optimistic.allNodeIds());
    addToSet(this._editedNodeIds, allIds);

    this._snapshot = new CacheSnapshot(current.baseline, optimistic, optimisticQueue);
  }

  /**
   * Complete the transaction, returning the new snapshot and the ids of any
   * nodes that were edited.
   */
  commit(): { snapshot: CacheSnapshotType, editedNodeIds: Set<NodeId>, writtenQueries: Set<OperationInstance<TSerialized>> } {
    this._triggerEntityUpdaters();

    let snapshot = this._snapshot;
    if (this._optimisticChangeId) {
      snapshot = new CacheSnapshot(
        snapshot.baseline,
        snapshot.optimistic,
        snapshot.optimisticQueue.enqueue(this._optimisticChangeId, this._deltas),
      );
    }

    return { snapshot, editedNodeIds: this._editedNodeIds, writtenQueries: this._writtenQueries };
  }

  markEditedNodeIds(allIds: Iterable<string>) {
    addToSet(this._editedNodeIds, allIds);
  }

  setSnapshot(snapshot: CacheSnapshotType) {
    this._snapshot = snapshot;
  }

  getPreviousNodeSnapshot(nodeId: NodeId): NodeSnapshot | undefined {
    const prevSnapshot = this._optimisticChangeId ? this._parentSnapshot.optimistic : this._parentSnapshot.baseline;
    return prevSnapshot.getNodeSnapshot(nodeId);
  }

  getCurrentNodeSnapshot(nodeId: NodeId): NodeSnapshot | undefined {
    const currentSnapshot = this._optimisticChangeId ? this._snapshot.optimistic : this._snapshot.baseline;
    return currentSnapshot.getNodeSnapshot(nodeId);
  }

  /**
   * Emits change events for any callbacks configured via
   * CacheContext#entityUpdaters.
   */
  private _triggerEntityUpdaters() {
    const { entityUpdaters } = this._context;
    if (!Object.keys(entityUpdaters).length) return;

    // Capture a static set of nodes, as the updaters may add to _editedNodeIds.
    const nodesToEmit: Node<TSerialized>[] = [];
    for (const nodeId of this._editedNodeIds) {
      const node = this.getCurrentNodeSnapshot(nodeId);
      const previous = this.getPreviousNodeSnapshot(nodeId);
      // One of them may be undefined; but we are guaranteed that both represent
      // the same entity.
      const either = node || previous;

      if (!(either instanceof EntitySnapshot)) continue; // Only entities
      let typeName = isObject(either.data) && either.data.__typename as string | undefined;
      const isRoot = nodeId === StaticNodeId.QueryRoot;
      if (!typeName && isRoot) {
        typeName = 'Query';
      }
      if (!typeName) continue; // Must have a typename for now.

      const updater = entityUpdaters[typeName];
      if (!updater) continue;

      nodesToEmit.push({
        updater,
        node: node && (isRoot || node.inbound) && node.data,
        previous: previous && previous.data,
      });
    }

    if (!nodesToEmit.length) return;

    // TODO: This is weirdly the only place where we assume an Apollo interface.
    // Can we clean this up? :(
    const dataProxy = new ApolloTransaction<TSerialized>(this);
    for (const { updater, node, previous } of nodesToEmit) {
      updater(dataProxy, node, previous);
    }
  }

  /**
   * Merge a payload with the baseline snapshot.
   */
  private _writeBaseline(query: RawOperation, payload: JsonObject) {
    const current = this._snapshot;

    const { snapshot: baseline, editedNodeIds, writtenQueries, ref } = write(this._context, current.baseline, query, payload);
    addToSet(this._editedNodeIds, editedNodeIds);
    addToSet(this._writtenQueries, writtenQueries);

    const optimistic = this._buildOptimisticSnapshot(baseline);

    this._snapshot = new CacheSnapshot(baseline, optimistic, current.optimisticQueue);

    return ref;
  }

  /**
   * Given a baseline snapshot, build an optimistic one from it.
   */
  _buildOptimisticSnapshot(baseline: GraphSnapshot) {
    const { optimisticQueue } = this._snapshot;
    if (!optimisticQueue.hasUpdates()) return baseline;

    const { snapshot, editedNodeIds } = optimisticQueue.apply(this._context, baseline);
    addToSet(this._editedNodeIds, editedNodeIds);

    return snapshot;
  }

  /**
   * Merge a payload with the optimistic snapshot.
   */
  private _writeOptimistic(query: RawOperation, payload: JsonObject) {
    this._deltas.push({ query, payload });

    const { snapshot: optimistic, editedNodeIds, writtenQueries, ref } = write(this._context, this._snapshot.optimistic, query, payload);
    addToSet(this._writtenQueries, writtenQueries);
    addToSet(this._editedNodeIds, editedNodeIds);

    this._snapshot = new CacheSnapshot(this._snapshot.baseline, optimistic, this._snapshot.optimisticQueue);

    return ref;
  }

  modify<Entity extends Record<string, unknown>>(options: CacheInterface.ModifyOptions<Entity>): boolean {
    const graphSnapshot = options.optimistic ? this._snapshot.optimistic : this._snapshot.baseline;

    const id = 'id' in options ? options.id : 'ROOT_QUERY';
    if (!id) {
      return false;
    }
    const node = graphSnapshot.getNodeSnapshot(id);
    if (!node) {
      return false;
    }

    const nodeRefToMatch = ({ id }: NodeReference) => ({ d: graphSnapshot.getNodeData(id), k: id });

    function readFromSnapshot(obj: Readonly<NodeSnapshot>, key: string) {
      const data = obj.data;
      const datum = data && typeof data === 'object' && key in data ? (data as JsonObject)[key] : undefined;
      if (datum != null) {
        return [{ d: datum, k: null }];
      }
      const nodes: { d: any, k: string }[] = obj.parameterized?.get(key)?.map(nodeRefToMatch) ?? [];
      const out = obj.outbound?.get(key);
      if (out) {
        const k = out.id;
        return [{ d: graphSnapshot.getNodeData(k), k }].concat(nodes);
      }
      if (nodes.length) {
        return nodes;
      }
      if (id === 'ROOT_QUERY' && key === '__typename') {
        return [{ d: 'Query', k: null }];
      }
      if (datum === null) {
        return [{ d: null, k: null }];
      }
      return [];
    }

    function readOneFromSnapshot(obj: Readonly<NodeSnapshot>, key: string) {
      const data = obj.data;
      const datum = data && typeof data === 'object' && key in data ? (data as JsonObject)[key] : undefined;
      if (datum != null) {
        return datum;
      }
      const out = obj.outbound?.get(key);
      if (out) {
        return graphSnapshot.getNodeData(out.id);
      }
      const ref = obj.parameterized?.get(key)?.[0];
      if (ref) {
        return graphSnapshot.getNodeData(ref.id);
      }
      if (id === 'ROOT_QUERY' && key === '__typename') {
        return 'Query';
      }
      return datum;
    }

    const tempStore: NodeSnapshotMap = Object.create(null);

    const readField = (
      fieldNameOrOptions: string | ReadFieldOptions,
      from: StoreObject | Reference = (tempStore[id]?.data ?? node.data) as StoreObject
    ) => {
      if (typeof fieldNameOrOptions === 'object') {
        from = fieldNameOrOptions.from ?? from;
        fieldNameOrOptions = fieldNameOrOptions.fieldName;
      }
      if (!from) {
        return undefined;
      }

      if (isReference(from)) {
        const ref = from.__ref;
        const obj = tempStore[ref] ?? graphSnapshot.getNodeSnapshot(ref);
        if (!obj) {
          return undefined;
        }
        return readOneFromSnapshot(obj, fieldNameOrOptions);
      } else {
        return from[fieldNameOrOptions];
      }
    };

    function getSnapshot(nodeId: string) {
      return tempStore[nodeId] ?? graphSnapshot.getNodeSnapshot(nodeId);
    }

    const ensureNewSnapshot = (nodeId: NodeId): NodeSnapshot => {
      const parent = getSnapshot(nodeId);

      // TODO: We're assuming that the only time we call _ensureNewSnapshot when
      // there is no parent is when the node is an entity. Can we enforce it, or
      // pass a type through?
      const newSnapshot = parent ? cloneNodeSnapshot(parent) : new EntitySnapshot();
      tempStore[nodeId] = newSnapshot;
      return newSnapshot;
    };

    const details: ModifierDetails = {
      readField,
      DELETE,
      INVALIDATE,
      canRead(value: StoreValue): boolean {
        return isReference(value)
          ? snapshot.has(value.__ref)
          : typeof value === 'object' && value !== null;
      },
      fieldName: '',
      isReference,
      storage: node,
      storeFieldName: '',
      toReference: (value, mergeIntoStore) => {
        const entityId = this._context.entityIdForValue(value);
        if (entityId && mergeIntoStore && !isReference(value) && typeof value !== 'string') {
          const nodeSnapshot = ensureNewSnapshot(entityId);
          nodeSnapshot.data = { ...nodeSnapshot.data as {}, ...value };
          modified = true;
        }
        return entityId ? makeRef(entityId) : undefined;
      },
    };

    const data = node.data ?? {};
    const keys = Object.keys(data);
    const payload: JsonObject = { };
    const deleted = new Set<string>();

    let modified = false;
    let allDeleted = false;
    let invalidated = false;

    if (typeof options.fields === 'function') {
      const field = options.fields;
      if (keys.length === 0) {
        details.fieldName = '';
        details.storeFieldName = '';
        try {
          const value = field(data as any, details);
          if (isDeleteModifier(value)) {
            allDeleted = true;
            modified = true;
          }
        } catch (e) {
          console.log(e);
        }
      }
      for (const key of keys) {
        for (const { d, k } of readFromSnapshot(node, key)) {
          const storeFieldName = k ?? key;
          const useRef = k?.includes('❖');
          const copyOrCurrent = Array.isArray(d)
            ? Array.prototype.slice.call(d)
            : useRef ? { __ref: k } : typeof d === 'object'
              ? { ...d }
              : d;
          details.fieldName = key;
          details.storeFieldName = storeFieldName;
          const value = field(copyOrCurrent, details);
          if (isDeleteModifier(value)) {
            deleted.add(storeFieldName);
            modified = true;
          } else if (isInvalidateModifier(value)) {
            this._editedNodeIds.add(id);
            let dirty = this._context.dirty.get(id);
            if (!dirty) {
              this._context.dirty.set(id, dirty = new Set());
            }
            dirty.add(key);
            dirty.add(storeFieldName);
            invalidated = true;
          } else if (value !== copyOrCurrent || (!useRef && !isEqual(value, d))) {
            payload[key] = (isReference(value) ? getSnapshot(value.__ref).data : value) as JsonValue;
            modified = true;
          }
        }
      }
      if (
        keys.length !== 0 && keys.length === deleted.size && keys.every(key => deleted.has(key))
      ) {
        allDeleted = true;
        modified = true;
      }
    } else {
      for (const key of Object.keys(options.fields) as (string & keyof Entity)[]) {
        const field = options.fields[key];
        if (!field) continue;
        for (const { d, k } of readFromSnapshot(node, key)) {
          const storeFieldName = k ?? key;
          const useRef = k?.includes('❖');
          const copyOrCurrent = Array.isArray(d)
            ? Array.prototype.slice.call(d)
            : useRef ? { __ref: k } : typeof d === 'object'
              ? { ...d }
              : d;
          details.fieldName = key;
          details.storeFieldName = storeFieldName;
          const value = field(copyOrCurrent, details);
          if (isDeleteModifier(value)) {
            deleted.add(storeFieldName);
            modified = true;
          } else if (isInvalidateModifier(value)) {
            this._editedNodeIds.add(id);
            let dirty = this._context.dirty.get(id);
            if (!dirty) {
              this._context.dirty.set(id, dirty = new Set());
            }
            dirty.add(key);
            dirty.add(storeFieldName);
            invalidated = true;
          } else if (value !== copyOrCurrent || (!useRef && !isEqual(value, d))) {
            const nextValue = isReference(value) ? getSnapshot(value.__ref).data : value;
            if (nextValue !== undefined) {
              payload[key] = nextValue as JsonValue;
            }
            modified = true;
          }
        }
      }
      if (
        keys.length !== 0 && keys.length === deleted.size && keys.every(key => deleted.has(key))
      ) {
        allDeleted = true;
        modified = true;
      }
    }
    if (!modified && !invalidated) {
      return false;
    }

    const current = this._snapshot;

    const editor = new SnapshotEditor(this._context, graphSnapshot);
    const empty = new Set<string>();
    const seenObjects = new Set<object | null>();
    for (const [mergeId, snapshot] of Object.entries(tempStore)) {
      const mergePayload = snapshot.data;
      if (mergePayload && typeof mergePayload === 'object' && !Array.isArray(mergePayload)) {
        editor.modify(mergeId, mergePayload, empty, seenObjects);
      }
    }
    if (allDeleted) {
      editor.delete(id);
      if (options.optimistic) {
        this._deltas.push({ delete: id });
      }
    } else {
      const seenObjects = new Set<object | null>();
      editor.modify(id, payload, deleted, seenObjects);
      if (options.optimistic) {
        this._deltas.push({ id, payload, deleted });
      }
    }
    const newSnapshot = editor.commit();
    const { snapshot, editedNodeIds } = newSnapshot;
    addToSet(this._editedNodeIds, editedNodeIds);
    const edited = Array.from(editedNodeIds);
    for (const [key, val] of snapshot.readCache) {
      if (key.rootId === id || edited.some(cachedId => val.entityIds?.has(cachedId))) {
        snapshot.readCache.delete(key);
      }
    }

    if (options.optimistic) {
      this._snapshot = new CacheSnapshot(current.baseline, snapshot, current.optimisticQueue);
    } else {
      const optimistic = this._buildOptimisticSnapshot(snapshot);
      this._snapshot = new CacheSnapshot(snapshot, optimistic, current.optimisticQueue);
    }

    return modified;
  }

  merge(tempStore: NodeSnapshotMap) {
    const current = this._snapshot;
    const editor = new SnapshotEditor(this._context, current.baseline);
    const empty = new Set<string>();
    const seenObjects = new Set<object | null>();
    for (const [id, snapshot] of Object.entries(tempStore)) {
      const payload = snapshot.data;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        editor.modify(id, payload, empty, seenObjects);
      }
    }
    const newSnapshot = editor.commit();
    const { snapshot, editedNodeIds } = newSnapshot;
    addToSet(this._editedNodeIds, editedNodeIds);
    const edited = Array.from(editedNodeIds);
    for (const [key, val] of snapshot.readCache) {
      if (edited.some(cachedId => val.entityIds?.has(cachedId))) {
        snapshot.readCache.delete(key);
      }
    }

    const optimistic = this._buildOptimisticSnapshot(snapshot);
    this._snapshot = new CacheSnapshot(snapshot, optimistic, current.optimisticQueue);
  }

  evict(options: CacheInterface.EvictOptions): boolean {
    const modifier: Modifier<any> = (_current, details) => {
      return details.DELETE;
    };
    return this.modify({
      id: options.id ?? 'ROOT_QUERY',
      fields: options.fieldName ? {
        [options.fieldName]: modifier,
      } : modifier,
      broadcast: options.broadcast,
    });
  }

}
