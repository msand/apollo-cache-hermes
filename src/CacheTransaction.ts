import type {
  Cache as CacheInterface,
  Modifier,
  ModifierDetails,
  ReadFieldOptions,
  Reference,
  StoreObject,
  StoreValue,
} from '@apollo/client/cache';
import { makeReference } from '@apollo/client/utilities/internal';
import { invariant } from '@apollo/client/utilities/invariant';
import * as equality from '@wry/equality';
import type { FragmentDefinitionNode, InlineFragmentNode } from 'graphql';

import type { ChangeId, NodeId, OperationInstance, CacheDelta, RawOperation } from './schema';
import type { CacheSnapshot as CacheSnapshotType } from './CacheSnapshot';
import type { GraphSnapshot, NodeSnapshotMap } from './GraphSnapshot';
import type { JsonObject, JsonValue } from './primitive';
import type { CacheContext } from './context';
import type { Policies } from './context/policies';
import type { ScalarConfig } from './context/scalars';
import { fieldNameFromStoreName, isStoreFieldNameKey, storeFieldNameOf } from './context/storeFieldNames';
import type { OptimisticUpdate } from './OptimisticUpdateQueue';
import { applyDeltas } from './OptimisticUpdateQueue';
import type { Queryable } from './Queryable';
import type { NodeSnapshot } from './nodes';
import type { DocumentNode } from './util';
import * as transaction from './apollo/Transaction';
import * as cacheSnapshot from './CacheSnapshot';
import * as operations from './operations';
import * as schema from './schema';
import * as nodes from './nodes';
import * as util from './util';
import { nodeIdForParameterizedValue, nodeIdForStoreKey } from './operations/SnapshotEditor';
import { checkWrite, checkWriteDocument } from './operations/checkWrite';
import { entityTypename } from './operations/fieldFunctions';

const isEqual = equality.equal;
const makeRef = makeReference;
const { StaticNodeId } = schema;
const { CacheSnapshot } = cacheSnapshot;
const { ApolloTransaction } = transaction;
const { cloneNodeSnapshot, EntitySnapshot } = nodes;
const { read, SnapshotEditor, write } = operations;
const { addToSet, hasOwn, isObject, isReference } = util;

type DeleteModifier = ModifierDetails['DELETE'];
type InvalidateModifier = ModifierDetails['INVALIDATE'];

const DELETE: DeleteModifier = Object.create(null);
const INVALIDATE: InvalidateModifier = Object.create(null);

/**
 * The storeFieldName passed to modifiers for a field stored at `storeFieldName`
 * (a field name, or a parameterized value's node id): like InMemoryCache's,
 * for fields stored per their keyArgs policies (e.g. `feed:{"type":"news"}`).
 */
function modifierStoreFieldName(storeFieldName: string): string {
  const index = storeFieldName.lastIndexOf('❖');
  if (index < 0) return storeFieldName;
  const storeKey = storeFieldName.slice(index + 1);
  return isStoreFieldNameKey(storeKey) ? storeKey : storeFieldName;
}

/**
 * A copy of a stored list for a modifier function: frozen, like InMemoryCache's
 * store values, if the stored list is.
 */
function copyList<T>(list: readonly T[]): T[] {
  const copy = list.slice();
  return Object.isFrozen(list) ? (Object.freeze(copy) as T[]) : copy;
}

/** The (InMemoryCache) store field name of the parameterized value node `nodeId`. */
function storeFieldNameOfNode(fieldName: string, nodeId: string): string {
  return storeFieldNameOf(fieldName, nodeId.slice(nodeId.lastIndexOf('❖') + 1));
}

function isDeleteModifier(value: any): value is DeleteModifier {
  return value === DELETE;
}

function isInvalidateModifier(value: any): value is InvalidateModifier {
  return value === INVALIDATE;
}

/**
 * Re-runs an optimistic update on top of a snapshot (see Cache), returning the
 * resulting snapshot, with the update re-enqueued.
 */
export type OptimisticReplay = (
  snapshot: CacheSnapshotType,
  update: OptimisticUpdate,
) => { snapshot: CacheSnapshotType; editedNodeIds: Set<NodeId> };

/**
 * Services a transaction gets from the cache that runs it.
 */
export interface TransactionHooks {
  /** Re-runs an optimistic update (see CacheTransaction#rollback). */
  replayOptimisticUpdate?: OptimisticReplay;
  /**
   * Ids of the nodes watched queries are rooted at.  The transaction records
   * the fields of these nodes that it changes in changedFields, so that (like
   * InMemoryCache) onWatchUpdated is called for the watches reading them, even
   * if their result ends up unchanged.
   */
  watchedRootIds?: Set<NodeId>;
  changedFields?: ChangedFields;
}

/**
 * The fields changed per node, in the baseline and in the optimistic view.
 */
export interface ChangedFields {
  baseline: Map<NodeId, Set<string>>;
  optimistic: Map<NodeId, Set<string>>;
}

type Node<TSerialized> = {
  node: any;
  previous: JsonValue | undefined;
  updater: CacheContext.EntityUpdater<TSerialized>;
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

  /** The ids non-optimistic writes started at, which the cache retains. */
  private _writtenRootIds = new Set<NodeId>();

  /** The original snapshot before the transaction began. */
  private _parentSnapshot: CacheSnapshotType;

  constructor(
    private _context: CacheContext<TSerialized>,
    private _snapshot: CacheSnapshotType,
    private _optimisticChangeId?: ChangeId,
    private _hooks: TransactionHooks = {},
  ) {
    this._parentSnapshot = _snapshot;
  }

  isOptimisticTransaction(): true | undefined {
    return this._optimisticChangeId ? true : undefined;
  }

  transformDocument(document: DocumentNode): DocumentNode {
    return this._context.transformDocument(document);
  }

  identify(object: StoreObject | Reference): string | undefined {
    return this._context.entityIdForValue(object);
  }

  fragmentMatches(fragment: InlineFragmentNode | FragmentDefinitionNode, typename: string): boolean {
    return operations.fragmentMatches(this._context, fragment, typename);
  }

  lookupFragment(fragmentName: string): FragmentDefinitionNode | null {
    return this._context.fragments?.lookup(fragmentName) ?? null;
  }

  /** Custom scalar support. */
  get scalars(): ScalarConfig {
    return this._context.scalars;
  }

  /** The type policies and possibleTypes. */
  get policies(): Policies {
    return this._context.policies;
  }

  resolvesClientField(typename: string, fieldName: string): boolean {
    // Not the read functions that parse custom scalars.
    return !!this._context.policies.getReadFunction(typename, fieldName);
  }

  /**
   * Executes reads against the current values in the transaction.
   */
  read(query: RawOperation, optimistic?: boolean): operations.QueryResult {
    return read(
      this._context,
      query,
      this.readsOptimistic(optimistic) ? this._snapshot.optimistic : this._snapshot.baseline,
      Object.create(null),
    );
  }

  /** Whether optimistic reads see the optimistic view; see withBaselineReads. */
  private _optimisticReads = true;

  /**
   * Whether a read (optimistic or not) made in the transaction sees the
   * optimistic view.  Like InMemoryCache, an optimistic transaction reads its
   * own layer either way.
   */
  readsOptimistic(optimistic?: boolean): boolean {
    return !!this._optimisticChangeId || (!!optimistic && this._optimisticReads);
  }

  /**
   * Runs a callback in which optimistic reads see the baseline, like
   * InMemoryCache's batch({ optimistic: false }).
   */
  withBaselineReads<T>(callback: () => T): T {
    const optimisticReads = this._optimisticReads;
    this._optimisticReads = false;
    try {
      return callback();
    } finally {
      this._optimisticReads = optimisticReads;
    }
  }

  /**
   * Merges a payload with the current values in the transaction.
   *
   * If this is an optimistic transaction, edits will be made directly on top of
   * any previous optimistic values.  Otherwise, edits will be made to the
   * baseline state (and any optimistic updates will be replayed over it).
   */
  write(query: RawOperation, payload: JsonObject): Reference | undefined {
    checkWriteDocument(query.document);
    if (payload && typeof payload === 'object') {
      checkWrite(
        this._context,
        this._context.transformDocument(query.document),
        query.variables,
        payload,
        this._rootTypename(query.rootId),
      );
    }
    if (this._optimisticChangeId) {
      return this._writeOptimistic(query, payload);
    } else {
      return this._writeBaseline(query, payload);
    }
  }

  /**
   * The __typename of the node a write starts at, when it is known before the
   * written data is looked at.
   */
  private _rootTypename(rootId: NodeId): string | undefined {
    const rootTypename = this._context.rootTypename(rootId);
    if (rootTypename) return rootTypename;
    const data = this.getCurrentNodeSnapshot(rootId)?.data;
    return isObject(data) && typeof data.__typename === 'string' ? data.__typename : undefined;
  }

  /**
   * Roll back previously enqueued optimistic updates with the given id.
   *
   * Like InMemoryCache's removeOptimistic, the updates beneath the removed one
   * are kept as they are, and the ones above it are re-run on top of the data
   * beneath them (so they pick up any data written since they last ran).
   */
  rollback(changeId: ChangeId): void {
    const current = this._snapshot;
    const parts = current.optimisticQueue.split(changeId);
    if (!parts) return;

    // Invalidate all IDs from the soon-to-be previous optimistic snapshot,
    // since we don't know which IDs were changed by the one we're rolling back.
    addToSet(this._editedNodeIds, current.optimistic.allNodeIds());

    let optimistic = current.baseline;
    if (parts.below.hasUpdates()) {
      const applied = parts.below.apply(this._context, current.baseline);
      optimistic = applied.snapshot;
      addToSet(this._editedNodeIds, applied.editedNodeIds);
    }
    let snapshot = new CacheSnapshot(current.baseline, optimistic, parts.below);

    for (const update of parts.above) {
      if (update.callback && this._hooks.replayOptimisticUpdate) {
        const replayed = this._hooks.replayOptimisticUpdate(snapshot, update);
        snapshot = replayed.snapshot;
        addToSet(this._editedNodeIds, replayed.editedNodeIds);
      } else {
        const optimisticQueue = snapshot.optimisticQueue.enqueue(update.id, update.deltas, update.callback);
        const editor = new SnapshotEditor(this._context, snapshot.optimistic);
        applyDeltas(editor, update.deltas);
        const applied = editor.commit();
        addToSet(this._editedNodeIds, applied.editedNodeIds);
        snapshot = new CacheSnapshot(snapshot.baseline, applied.snapshot, optimisticQueue);
      }
    }

    addToSet(this._editedNodeIds, snapshot.optimistic.allNodeIds());
    this._setCurrentSnapshot(snapshot);
  }

  /**
   * Complete the transaction, returning the new snapshot and the ids of any
   * nodes that were edited.
   */
  commit(callback?: OptimisticUpdate['callback']): {
    snapshot: CacheSnapshotType;
    editedNodeIds: Set<NodeId>;
    writtenQueries: Set<OperationInstance<TSerialized>>;
    writtenRootIds: Set<NodeId>;
  } {
    this._triggerEntityUpdaters();

    let snapshot = this._snapshot;
    if (this._optimisticChangeId) {
      // The callback is kept so the update can be re-run (see rollback).
      snapshot = new CacheSnapshot(
        snapshot.baseline,
        snapshot.optimistic,
        snapshot.optimisticQueue.enqueue(this._optimisticChangeId, this._deltas, callback),
      );
    }

    return {
      snapshot,
      editedNodeIds: this._editedNodeIds,
      writtenQueries: this._writtenQueries,
      writtenRootIds: this._writtenRootIds,
    };
  }

  markEditedNodeIds(allIds: Iterable<string>) {
    addToSet(this._editedNodeIds, allIds);
  }

  setSnapshot(snapshot: CacheSnapshotType) {
    this._snapshot = snapshot;
  }

  /**
   * The current (uncommitted) version of the cache, as seen by this
   * transaction.
   */
  getSnapshot(): CacheSnapshotType {
    return this._snapshot;
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
   * Moves the transaction to a new version of the cache, recording the fields
   * of watched root nodes that changed (see TransactionHooks#watchedRootIds).
   */
  private _setCurrentSnapshot(next: CacheSnapshotType) {
    const previous = this._snapshot;
    this._snapshot = next;
    const { watchedRootIds, changedFields } = this._hooks;
    if (!watchedRootIds || !changedFields) return;
    for (const id of watchedRootIds) {
      addChangedFields(previous.baseline, next.baseline, id, changedFields.baseline);
      addChangedFields(previous.optimistic, next.optimistic, id, changedFields.optimistic);
    }
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
      let typeName = isObject(either.data) && (either.data.__typename as string | undefined);
      const isRoot = nodeId === StaticNodeId.QueryRoot;
      if (!typeName && isRoot) {
        typeName = this._context.rootTypename(nodeId)!;
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

    const {
      snapshot: baseline,
      editedNodeIds,
      writtenQueries,
      ref,
    } = write(this._context, current.baseline, query, payload);
    addToSet(this._editedNodeIds, editedNodeIds);
    addToSet(this._writtenQueries, writtenQueries);
    this._writtenRootIds.add(query.rootId);

    const optimistic = this._buildOptimisticSnapshot(baseline);

    this._setCurrentSnapshot(new CacheSnapshot(baseline, optimistic, current.optimisticQueue));

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

    const {
      snapshot: optimistic,
      editedNodeIds,
      writtenQueries,
      ref,
    } = write(this._context, this._snapshot.optimistic, query, payload);
    addToSet(this._writtenQueries, writtenQueries);
    addToSet(this._editedNodeIds, editedNodeIds);

    this._setCurrentSnapshot(new CacheSnapshot(this._snapshot.baseline, optimistic, this._snapshot.optimisticQueue));

    return ref;
  }

  modify<Entity extends Record<string, unknown>>(options: CacheInterface.ModifyOptions<Entity>): boolean {
    // Like InMemoryCache, an optimistic transaction modifies its own layer.
    return this._modify(options, this._optimisticChangeId ? 'layer' : options.optimistic ? 'optimistic' : 'baseline');
  }

  /**
   * Modifies the baseline (and re-applies the optimistic updates over it), the
   * optimistic view, the optimistic update made by this transaction ('layer'),
   * or every optimistic update ('allLayers', used by evict so that evicted data
   * is not resurrected by optimistic updates).
   */
  private _modify<Entity extends Record<string, unknown>>(
    options: CacheInterface.ModifyOptions<Entity>,
    target: 'baseline' | 'optimistic' | 'layer' | 'allLayers',
  ): boolean {
    const optimistic = target !== 'baseline';
    let graphSnapshot = optimistic ? this._snapshot.optimistic : this._snapshot.baseline;

    const id = 'id' in options ? options.id : 'ROOT_QUERY';
    if (!id) {
      return false;
    }
    const rootTypename = this._context.rootTypename(id);
    const node = graphSnapshot.getNodeSnapshot(id);
    if (!node) {
      return false;
    }

    // Modifier functions may write to the cache (in this transaction), so
    // reads made while they run see the latest data.
    const currentGraph = () => (optimistic ? this._snapshot.optimistic : this._snapshot.baseline);

    const nodeRefToMatch = ({ id }) => ({ d: currentGraph().getNodeData(id), k: id });

    // Like InMemoryCache, a field with arguments is passed to modifiers as its stored
    // value, or as a Reference when it holds an entity.
    const parameterizedFieldValue = (nodeId: string, data: any) => {
      const outbound = currentGraph().getNodeSnapshot(nodeId)?.outbound;
      for (const reference of outbound?.values() ?? []) {
        if (reference.path.length === 0) return makeRef(reference.id);
      }
      return data && typeof data === 'object' ? { ...data } : data;
    };

    function readFromSnapshot(obj: Readonly<NodeSnapshot>, key: string) {
      const data = obj.data;
      const datum = data && typeof data === 'object' && key in data ? (data as JsonObject)[key] : undefined;
      const nodes: { d: any; k: string | null }[] = obj.parameterized?.get(key)?.map(nodeRefToMatch) ?? [];
      if (datum != null) {
        // Like InMemoryCache, each stored variant of the field (e.g. with
        // keyArgs, `field` and `field:{"arg":1}`) is modified.
        return [{ d: datum, k: null }, ...nodes];
      }
      const out = obj.outbound?.get(key);
      if (out) {
        const k = out.id;
        const target = currentGraph().getNodeData(k);
        // Like InMemoryCache, a dangling reference is passed as a Reference.
        return [target === undefined ? { d: makeRef(k), k: null } : { d: target, k }].concat(nodes);
      }
      if (nodes.length) {
        return nodes;
      }
      if (key === '__typename' && rootTypename) {
        return [{ d: rootTypename, k: null }];
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
        return currentGraph().getNodeData(out.id);
      }
      const ref = obj.parameterized?.get(key)?.[0];
      if (ref) {
        return currentGraph().getNodeData(ref.id);
      }
      if (key === '__typename' && rootTypename) {
        return rootTypename;
      }
      return datum;
    }

    const tempStore: NodeSnapshotMap = Object.create(null);

    const readField = (
      fieldNameOrOptions: string | ReadFieldOptions,
      from: StoreObject | Reference = (tempStore[id]?.data ?? node.data) as StoreObject,
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
        const obj = tempStore[ref] ?? currentGraph().getNodeSnapshot(ref);
        if (!obj) {
          return undefined;
        }
        return readOneFromSnapshot(obj, fieldNameOrOptions);
      } else {
        return from[fieldNameOrOptions];
      }
    };

    function getSnapshot(nodeId: string) {
      return tempStore[nodeId] ?? currentGraph().getNodeSnapshot(nodeId);
    }

    // Like InMemoryCache's EntityStore#modify, warn (in development) about
    // values that will not be stored as their author probably intends.
    const warnAboutModifiedValue = (value: unknown) => {
      if ((globalThis as { __DEV__?: boolean }).__DEV__ === false) return;
      const checkReference = (ref: Reference) => {
        if (getSnapshot(ref.__ref)) return false;
        invariant.warn(
          'cache.modify: You are trying to write a Reference that is not part of the store: %o\n' +
            'Please make sure to set the `mergeIntoStore` parameter to `true` when creating a Reference that is not part of the store yet:\n' +
            '`toReference(object, true)`',
          ref,
        );
        return true;
      };
      if (isReference(value)) {
        checkReference(value);
      } else if (Array.isArray(value)) {
        // Warn about writing "mixed" arrays of Reference and non-Reference objects.
        let seenReference = false;
        let someNonReference: unknown;
        for (const item of value) {
          if (isReference(item)) {
            seenReference = true;
            if (checkReference(item)) break;
          } else if (typeof item === 'object' && item) {
            const itemId = this._context.entityIdForValue(item);
            if (itemId !== undefined) {
              // Hermes hands modifiers the data of stored entities, rather than references to them.
              if (getSnapshot(itemId)?.data === item) {
                seenReference = true;
              } else {
                someNonReference = item;
              }
            }
          }
          if (seenReference && someNonReference !== undefined) {
            invariant.warn(
              'cache.modify: Writing an array with a mix of both References and Objects will not result in the Objects being normalized correctly.\n' +
                'Please convert the object instance %o to a Reference before writing it to the cache by calling `toReference(object, true)`.',
              someNonReference,
            );
            break;
          }
        }
      }
    };

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
        return isReference(value) ? snapshot.has(value.__ref) : typeof value === 'object' && value !== null;
      },
      fieldName: '',
      isReference,
      // Like the options of read and merge functions, the storage of the field
      // being modified (see the getter below).
      storage: undefined as any,
      storeFieldName: '',
      toReference: (value, mergeIntoStore) => {
        const entityId = this._context.entityIdForValue(value);
        if (entityId && mergeIntoStore && !isReference(value) && typeof value !== 'string') {
          const nodeSnapshot = ensureNewSnapshot(entityId);
          nodeSnapshot.data = { ...(nodeSnapshot.data as {}), ...value };
          modified = true;
        }
        return entityId ? makeRef(entityId) : undefined;
      },
    };

    const fieldStorage = this._context.fieldStorage;
    Object.defineProperty(details, 'storage', {
      get() {
        const { fieldName, storeFieldName } = details;
        // Parameterized fields' node ids end with their store keys.
        const storeKey = storeFieldName.includes('❖')
          ? storeFieldName.slice(storeFieldName.lastIndexOf('❖') + 1)
          : storeFieldName === fieldName
            ? undefined
            : storeFieldName;
        return fieldStorage.get([id, storeFieldNameOf(fieldName, storeKey)]);
      },
    });

    const data = node.data ?? {};
    const keys = Object.keys(data);
    // Fields holding a dangling reference have no data, but are still fields.
    for (const { id: targetId, path } of node.outbound?.values() ?? []) {
      const [key] = path;
      if (path.length === 1 && typeof key === 'string' && !hasOwn.call(data, key) && !graphSnapshot.has(targetId)) {
        keys.push(key);
      }
    }
    const payload: JsonObject = {};
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
            ? copyList(d)
            : useRef
              ? parameterizedFieldValue(k!, d)
              : typeof d === 'object'
                ? { ...d }
                : d;
          details.fieldName = key;
          details.storeFieldName = modifierStoreFieldName(storeFieldName);
          const value = field(copyOrCurrent, details);
          if (isDeleteModifier(value)) {
            deleted.add(storeFieldName);
            modified = true;
          } else if (isInvalidateModifier(value)) {
            this._editedNodeIds.add(id);
            let dirty = this._context.dirty.get(id);
            if (!dirty) {
              this._context.dirty.set(id, (dirty = new Set()));
            }
            dirty.add(key);
            dirty.add(storeFieldName);
            invalidated = true;
          } else if (value !== copyOrCurrent || (!useRef && !isEqual(value, d))) {
            warnAboutModifiedValue(value);
            payload[key] = (isReference(value) ? (getSnapshot(value.__ref)?.data ?? value) : value) as JsonValue;
            modified = true;
          }
        }
      }
      if (keys.length !== 0 && keys.length === deleted.size && keys.every(key => deleted.has(key))) {
        allDeleted = true;
        modified = true;
      }
    } else {
      for (const fieldKey of Object.keys(options.fields) as (string & keyof Entity)[]) {
        const field = options.fields[fieldKey];
        if (!field) continue;
        // Like InMemoryCache, a modifier may be given for a field name (to modify
        // every stored variant of the field) or for a store field name (e.g.
        // `feed:{"type":"news"}`, to modify just that variant).
        const key = fieldNameFromStoreName(fieldKey);
        let variants = readFromSnapshot(node, key);
        if (key !== fieldKey) {
          variants = variants.filter(({ k }) => k?.includes('❖') && storeFieldNameOfNode(key, k) === fieldKey);
        }
        for (const { d, k } of variants) {
          const storeFieldName = k ?? key;
          const useRef = k?.includes('❖');
          const copyOrCurrent = Array.isArray(d)
            ? copyList(d)
            : useRef
              ? parameterizedFieldValue(k!, d)
              : typeof d === 'object'
                ? { ...d }
                : d;
          details.fieldName = key;
          details.storeFieldName = modifierStoreFieldName(storeFieldName);
          const value = field(copyOrCurrent, details);
          if (isDeleteModifier(value)) {
            deleted.add(storeFieldName);
            modified = true;
          } else if (isInvalidateModifier(value)) {
            this._editedNodeIds.add(id);
            let dirty = this._context.dirty.get(id);
            if (!dirty) {
              this._context.dirty.set(id, (dirty = new Set()));
            }
            dirty.add(key);
            dirty.add(storeFieldName);
            invalidated = true;
          } else if (value !== copyOrCurrent || (!useRef && !isEqual(value, d))) {
            warnAboutModifiedValue(value);
            // A reference to a missing entity is written as such (and dangles).
            const nextValue = isReference(value) ? (getSnapshot(value.__ref)?.data ?? value) : value;
            if (nextValue !== undefined) {
              payload[key] = nextValue as JsonValue;
            }
            modified = true;
          }
        }
      }
      // Deleting the last fields of ROOT_QUERY keeps the node, like the
      // ROOT_QUERY of InMemoryCache, which keeps its __typename.
      if (
        id !== StaticNodeId.QueryRoot &&
        keys.length !== 0 &&
        keys.length === deleted.size &&
        keys.every(key => deleted.has(key))
      ) {
        allDeleted = true;
        modified = true;
      }
    }
    if (!modified && !invalidated) {
      return false;
    }

    // Modifier functions may have written to the cache (in this transaction);
    // apply the modifications on top of those writes rather than dropping them.
    const current = this._snapshot;
    graphSnapshot = optimistic ? current.optimistic : current.baseline;

    const editor = new SnapshotEditor(this._context, graphSnapshot);
    const empty = new Set<string>();
    const seenObjects = new Set<object | null>();
    for (const [mergeId, snapshot] of Object.entries(tempStore)) {
      const mergePayload = snapshot.data;
      if (mergePayload && typeof mergePayload === 'object' && !Array.isArray(mergePayload)) {
        editor.modify(mergeId, mergePayload, empty, seenObjects);
      }
    }
    let delta: CacheDelta;
    if (allDeleted) {
      editor.delete(id);
      delta = { delete: id };
    } else {
      const seenObjects = new Set<object | null>();
      editor.modify(id, payload, deleted, seenObjects);
      delta = { id, payload, deleted };
    }
    if (optimistic) {
      this._deltas.push(delta);
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

    if (target === 'allLayers') {
      const optimisticQueue = current.optimisticQueue.appendToAll([delta]);
      this._setCurrentSnapshot(new CacheSnapshot(current.baseline, snapshot, optimisticQueue));
    } else if (optimistic) {
      this._setCurrentSnapshot(new CacheSnapshot(current.baseline, snapshot, current.optimisticQueue));
    } else {
      const optimistic = this._buildOptimisticSnapshot(snapshot);
      this._setCurrentSnapshot(new CacheSnapshot(snapshot, optimistic, current.optimisticQueue));
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
    this._setCurrentSnapshot(new CacheSnapshot(snapshot, optimistic, current.optimisticQueue));
  }

  evict(options: CacheInterface.EvictOptions): boolean {
    // Like InMemoryCache, only a missing id means ROOT_QUERY; other falsy ids match nothing.
    if ('id' in options && !options.id) return false;
    // Evicting one argument variant of a field removes just that stored value.
    if (options.fieldName && options.args) {
      // The variant is identified as the field's keyArgs policy says.
      const id = options.id ?? 'ROOT_QUERY';
      const node = this._snapshot.baseline.getNodeSnapshot(id) ?? this._snapshot.optimistic.getNodeSnapshot(id);
      const typename = entityTypename(this._context, id, node);
      const { storeFieldNames } = this._context;
      const args = options.args as JsonObject;
      if (!storeFieldNames.hasKeyArgsFor(typename, options.fieldName)) {
        return this.batchEvict([nodeIdForParameterizedValue(id, [options.fieldName], args)]);
      }
      const storeKey = storeFieldNames.storeKey(typename, options.fieldName, args, undefined, undefined);
      if (storeKey !== undefined) {
        return this.batchEvict([nodeIdForStoreKey(id, [options.fieldName], storeKey)]);
      }
      // Stored under the field name itself (e.g. keyArgs: false).
      options = { ...options, args: undefined };
    }
    const modifier: Modifier<any> = (_current, details) => {
      return details.DELETE;
    };
    const modifyOptions: CacheInterface.ModifyOptions = {
      id: options.id ?? 'ROOT_QUERY',
      fields: options.fieldName
        ? {
            [options.fieldName]: modifier,
          }
        : modifier,
      broadcast: options.broadcast,
    };
    // Like InMemoryCache, an optimistic transaction evicts from its own layer
    // only; otherwise data is evicted from the baseline and every layer.
    if (this._optimisticChangeId) return this._modify(modifyOptions, 'layer');
    const evicted = this._modify(modifyOptions, 'baseline');
    if (!this._snapshot.optimisticQueue.hasUpdates()) return evicted;
    return this._modify(modifyOptions, 'allLayers') || evicted;
  }

  /**
   * Evicts several entities with one snapshot edit, where evict() makes one
   * per entity. Like evict(), it skips ids that are not in the cache.
   *
   * Each entity is removed whole. evict() instead keeps the fields it cannot
   * match to a stored field name, such as a null field that also has a
   * parameterized variant.
   *
   * Unless fromLayers is false, the entities are also evicted from any
   * optimistic updates (so they cannot reappear when those are re-applied).
   *
   * Returns whether any entity was evicted.
   */
  batchEvict(ids: Iterable<NodeId>, fromLayers = true): boolean {
    const idList = Array.from(ids);
    // Like evict(), an optimistic transaction evicts from its own layer only.
    if (this._optimisticChangeId) return this._batchEvict(idList, 'layer');
    const evicted = this._batchEvict(idList, 'baseline');
    if (!fromLayers || !this._snapshot.optimisticQueue.hasUpdates()) return evicted;
    return this._batchEvict(idList, 'allLayers') || evicted;
  }

  private _batchEvict(ids: NodeId[], target: 'baseline' | 'layer' | 'allLayers'): boolean {
    const current = this._snapshot;
    const graphSnapshot = target === 'baseline' ? current.baseline : current.optimistic;
    const evictedIds = new Set<NodeId>();
    for (const id of ids) {
      if (graphSnapshot.getNodeSnapshot(id)) {
        evictedIds.add(id);
      }
    }
    if (!evictedIds.size) {
      return false;
    }

    const editor = new SnapshotEditor(this._context, graphSnapshot);
    for (const id of evictedIds) {
      editor.delete(id);
    }
    // The same commit steps as modify() takes for a non-optimistic evict.
    const { snapshot, editedNodeIds } = editor.commit();
    addToSet(this._editedNodeIds, editedNodeIds);
    const edited = Array.from(editedNodeIds);
    for (const [key, val] of snapshot.readCache) {
      if (evictedIds.has(key.rootId) || edited.some(cachedId => val.entityIds?.has(cachedId))) {
        snapshot.readCache.delete(key);
      }
    }

    if (target === 'baseline') {
      const optimistic = this._buildOptimisticSnapshot(snapshot);
      this._setCurrentSnapshot(new CacheSnapshot(snapshot, optimistic, current.optimisticQueue));
    } else {
      const deltas: CacheDelta[] = Array.from(evictedIds, id => ({ delete: id }));
      let { optimisticQueue } = current;
      if (target === 'layer') {
        this._deltas.push(...deltas);
      } else {
        optimisticQueue = optimisticQueue.appendToAll(deltas);
      }
      this._setCurrentSnapshot(new CacheSnapshot(current.baseline, snapshot, optimisticQueue));
    }

    return true;
  }
}

/**
 * Records the top-level fields of a node that differ between two snapshots.
 */
function addChangedFields(
  previous: GraphSnapshot,
  next: GraphSnapshot,
  id: NodeId,
  changedFields: Map<NodeId, Set<string>>,
) {
  if (previous === next) return;
  const prevNode = previous.getNodeSnapshot(id);
  const nextNode = next.getNodeSnapshot(id);
  if (prevNode === nextNode) return;

  let fields = changedFields.get(id);
  if (!fields) changedFields.set(id, (fields = new Set()));

  const prevData = (isObject(prevNode?.data) ? prevNode!.data : {}) as JsonObject;
  const nextData = (isObject(nextNode?.data) ? nextNode!.data : {}) as JsonObject;
  for (const key of new Set([...Object.keys(prevData), ...Object.keys(nextData)])) {
    if (prevData[key] !== nextData[key] && !isEqual(prevData[key], nextData[key])) fields.add(key);
  }

  // References are stored outside of the data; parameterized fields are
  // separate nodes, which may have changed themselves (edits to those alone
  // count as edits to the parameterized nodes, not to this one).
  if (prevNode?.outbound === nextNode?.outbound && prevNode?.parameterized === nextNode?.parameterized) return;
  const prevRefs = referencesByField(previous, prevNode);
  const nextRefs = referencesByField(next, nextNode);
  for (const key of new Set([...prevRefs.keys(), ...nextRefs.keys()])) {
    const prevField = prevRefs.get(key);
    const nextField = nextRefs.get(key);
    if (
      !prevField ||
      !nextField ||
      prevField.length !== nextField.length ||
      prevField.some((value, index) => value !== nextField[index])
    ) {
      fields.add(key);
    }
  }
}

function referencesByField(snapshot: GraphSnapshot, node: NodeSnapshot | undefined) {
  const refs = new Map<string, unknown[]>();
  const add = (key: unknown, value: unknown) => {
    const field = String(key);
    const values = refs.get(field);
    if (values) values.push(value);
    else refs.set(field, [value]);
  };
  node?.outbound?.forEach(({ id, path }) => add(path[0], id));
  node?.parameterized?.forEach(list =>
    list.forEach(({ id, path }) => {
      add(path[0], id);
      add(path[0], snapshot.getNodeSnapshot(id));
    }),
  );
  return refs;
}
