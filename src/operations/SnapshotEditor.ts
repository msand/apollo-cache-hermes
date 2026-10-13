import * as equality from '@wry/equality';
import { isPlainObject, makeReference } from '@apollo/client/utilities/internal';
import type { Reference } from '@apollo/client/cache';
import type { StoreObject } from '@apollo/client/utilities';

import type { CacheContext } from '../context';
import { isRootNodeId, makeToReference, typenameOf } from '../context/helpers';
import { argsStoreKey, storeFieldNameOf } from '../context/storeFieldNames';
import type { GraphSnapshot as GraphSnapshotType } from '../GraphSnapshot';
import type { NodeReference, EntitySnapshot as EntitySnapshotType, NodeSnapshot } from '../nodes';
import { alternativeForType, childrenForType, fieldNodeOf, selectionSetOf } from '../ParsedQueryNode';
import type { ParsedQuery, ParsedQueryNode } from '../ParsedQueryNode';
import type { JsonArray, JsonObject, JsonScalar, JsonValue, NestedObject, Nil, PathPart } from '../primitive';
import type { NodeId, OperationInstance, RawOperation } from '../schema';
import * as graphSnapshot from '../GraphSnapshot';
import * as schema from '../schema';
import * as errors from '../errors';
import * as nodes from '../nodes';
import * as util from '../util';
import type { FragmentMap } from '../util';

import { FieldFunctions, withReferences } from './fieldFunctions';
import type { StreamInfoRef } from './streamFields';
import { defaultStreamFieldMergeFn, runStreamAwareMerge, streamInfoOf, usesDefaultStreamMerge } from './streamFields';

// Ensure typescript doesn't emit (0, fn)(...args)
const isEqual = equality.equal;
const { GraphSnapshot } = graphSnapshot;
const { StaticNodeId } = schema;
const { InvalidPayloadError, OperationError } = errors;
const { cloneNodeSnapshot, EntitySnapshot, ParameterizedValueSnapshot } = nodes;
const {
  addInboundReference,
  addOutboundReference,
  addParameterizedReference,
  addToSet,
  deepGet,
  hasOwn,
  hasParameterizedReference,
  ifString,
  isNil,
  isObject,
  isReference,
  iterParameterized,
  iterRefs,
  lazyImmutableDeepSet,
  pathBeginsWith,
  removeInboundReference,
  removeOutboundReference,
  removeParameterizedReference,
  toOutKey,
} = util;
const makeRef = makeReference;

/**
 * How many nodes the backward searches of _removeUnreachableNodes may visit
 * (in total, plus a number per candidate) before it marks the reachable nodes
 * of the whole graph instead.
 */
const UNREACHABLE_SEARCH_BUDGET = 1000;
const UNREACHABLE_SEARCH_BUDGET_PER_CANDIDATE = 8;

const ensureIdConstistencyMsg = `Ensure id is included (or not included) consistently across multiple requests.`;
/**
 * A newly modified snapshot.
 */
export interface EditedSnapshot<TSerialized = GraphSnapshotType> {
  snapshot: GraphSnapshotType;
  editedNodeIds: Set<NodeId>;
  writtenQueries: Set<OperationInstance<TSerialized>>;
  ref: Reference | undefined;
}

/**
 * Describes an edit to a reference contained within a node.
 */
interface ReferenceEdit {
  /** The node that contains the reference. */
  containerId: NodeId;
  /** The path to the reference within the container. */
  path: PathPart[];
  /** The id of the node that was previously referenced. */
  prevNodeId: NodeId | undefined;
  /** The id of the node that should be referenced. */
  nextNodeId: NodeId | undefined;
  /** Whether we know we can skip the write. */
  noWrite?: true;
  /** Whether the payload was a reference (which may be dangling). */
  reference?: true;
}

/**
 * How a value is merged with the existing value, per its merge policy: like
 * InMemoryCache, 'replace' replaces unidentified objects (rather than
 * deep-merging them), and 'merge' also merges them with entities.
 */
type MergeMode = 'replace' | 'merge';

/** Whether a node is retained (see the SnapshotEditor constructor). */
export type IsRetained = (id: NodeId) => boolean;

// https://github.com/nzakas/eslint-plugin-typescript/issues/69
export type NodeSnapshotMap = { [Key in NodeId]?: NodeSnapshot };

function forEach(parameterized: Map<string, NodeReference[]> | undefined, fn: (node: NodeReference) => void) {
  if (!parameterized) {
    return;
  }
  for (const refs of parameterized.values()) {
    for (const ref of refs) {
      fn(ref);
    }
  }
}

function getVisibleProxy(
  value: JsonValue | NestedObject<JsonScalar> | undefined | null,
  map: { [prop: string]: string } | undefined,
) {
  const compatible = value != null && typeof value === 'object';
  if (!compatible) {
    return undefined;
  }
  if (!map) {
    return value;
  }
  return new Proxy(value, {
    get: (target, p: string) => {
      return hasOwn.call(target, p) ? target[p] : target[map[p]];
    },
  });
}

/**
 * Like getVisibleProxy, for a payload (keyed by response names): a field that
 * is selected under an alias is read from that alias, even if the payload
 * also has a key of the field's name (like InMemoryCache, so that a field
 * aliased as __typename or id cannot change which entity is written).
 */
function getPayloadProxy(value: JsonValue | undefined | null, map: { [prop: string]: string } | undefined) {
  if (value == null || typeof value !== 'object' || !map) return getVisibleProxy(value, map);
  return new Proxy(value, {
    get: (target, p: string) => (hasOwn.call(map, p) ? target[map[p]] : target[p]),
  });
}

/**
 * The fields of a written object by their schema names (rather than the
 * response keys of its payload), like InMemoryCache's store objects: the
 * context.storeObject of keyFields functions.
 */
function toStoreObject(
  payload: JsonObject,
  parsed: ParsedQuery,
  fieldForType: (node: ParsedQueryNode, typename: unknown) => ParsedQueryNode,
): JsonObject {
  const storeObject: JsonObject = {};
  for (const key in parsed) {
    const value = payload[key];
    if (value === undefined) continue;
    const node = fieldForType(parsed[key], payload.__typename);
    const name = node.schemaName ?? key;
    if (hasOwn.call(storeObject, name)) continue;
    storeObject[name] = node.children ? toStoreValue(value, node.children, fieldForType) : value;
  }
  // Like InMemoryCache, fields in the payload that are not selected count too.
  for (const key of Object.keys(payload)) {
    if (!hasOwn.call(parsed, key) && !hasOwn.call(storeObject, key)) storeObject[key] = payload[key];
  }
  return storeObject;
}

function toStoreValue(
  value: JsonValue,
  parsed: ParsedQuery,
  fieldForType: (node: ParsedQueryNode, typename: unknown) => ParsedQueryNode,
): JsonValue {
  if (Array.isArray(value)) return value.map(item => toStoreValue(item, parsed, fieldForType));
  if (isObject(value) && !isReference(value)) return toStoreObject(value, parsed, fieldForType);
  return value;
}

/**
 * A copy of `value` (found at `path`) with null in place of each Reference
 * within it (as Hermes stores the slots of references, before filling them in
 * with the referenced data), collecting their paths and ids in `references`.
 */
function withoutReferences(value: unknown, path: PathPart[], references: [PathPart[], NodeId][]): JsonValue {
  if (isReference(value)) {
    references.push([path, value.__ref]);
    return null;
  }
  if (Array.isArray(value)) {
    let copy: JsonValue[] | undefined;
    value.forEach((item, index) => {
      const newItem = withoutReferences(item, [...path, index], references);
      if (newItem !== item) (copy ??= value.slice())[index] = newItem;
    });
    return copy ?? (value as JsonValue[]);
  }
  if (isPlainObject(value)) {
    let copy: JsonObject | undefined;
    for (const key of Object.keys(value)) {
      const newValue = withoutReferences(value[key], [...path, key], references);
      if (newValue !== value[key]) (copy ??= { ...(value as JsonObject) })[key] = newValue;
    }
    return copy ?? (value as JsonObject);
  }
  return value as JsonValue;
}

/** Whether two values are objects with different __typenames (like InMemoryCache's mergeObjects checks). */
function typenamesDiffer(a: unknown, b: unknown): boolean {
  const aTypename = typenameOf(a);
  const bTypename = typenameOf(b);
  return !!aTypename && !!bTypename && aTypename !== bTypename;
}

/**
 * Builds a set of changes to apply on top of an existing `GraphSnapshot`.
 *
 * Performs the minimal set of edits to generate new immutable versions of each
 * node, while preserving immutability of the parent snapshot.
 */
export class SnapshotEditor<TSerialized> {
  /**
   * Tracks all node snapshots that have changed vs the parent snapshot.
   */
  private _newNodes: NodeSnapshotMap = Object.create(null);

  /**
   * Tracks the nodes that have new _values_ vs the parent snapshot.
   *
   * This is a subset of the keys in `_newValues`.  The difference is all nodes
   * that have only changed references.
   */
  private _editedNodeIds = new Set<NodeId>();

  /**
   * Tracks the nodes that have been rebuilt, and have had all their inbound
   * references updated to point to the new value.
   */
  private _rebuiltNodeIds = new Set<NodeId>();

  /** The queries that were written, and should now be considered complete. */
  private _writtenQueries = new Set<OperationInstance<TSerialized>>();
  private _pathToId = Object.create(null);

  /** The variables of the operation being merged, for merge functions. */
  private _variables: JsonObject | undefined;
  /** The extensions of the write being merged, for merge functions. */
  private _extensions: Record<string, unknown> | undefined;
  /** Apollo's `@stream` info for the write being merged (incremental results). */
  private _streamInfo: StreamInfoRef | undefined;
  /** Whether the write being merged overwrites existing values (for merge functions). */
  private _overwrite = false;
  private _fieldFunctionsInstance: FieldFunctions<TSerialized> | undefined;
  /** The fragments of the operation being merged, for keyFields functions. */
  private _fragmentMap: FragmentMap | undefined;
  /** The reference edits of the payload being merged (see mergePayload). */
  private _referenceEdits: ReferenceEdit[] | undefined;

  constructor(
    /** The configuration/context to use when editing snapshots. */
    private _context: CacheContext<TSerialized>,
    /** The snapshot to base edits off of. */
    private _parent: GraphSnapshotType,
    /**
     * Whether a node is retained (e.g. by cache.retain, or as the root of a
     * watch), so that it (and what it references) is kept, like root nodes,
     * when unreachable reference cycles are removed. (Required, so that no
     * editor of the cache's snapshots leaves it out by accident.)
     */
    private _isRetained: IsRetained | undefined,
  ) {}

  /**
   * Merge a GraphQL payload (query/fragment/etc) into the snapshot, rooted at
   * the node identified by `rootId`.
   */
  mergePayload(
    query: RawOperation,
    payload: JsonObject,
    prune: boolean,
  ): { warnings?: string[]; ref: NodeId | undefined } {
    const parsed = this._context.parseOperation(query);
    this._variables = parsed.variables;
    // Like InMemoryCache, merge functions see the write's extensions without
    // Apollo's internal @stream info (kept under a symbol key).
    const extensions = query.extensions && Object.entries(query.extensions);
    this._extensions = extensions?.length ? Object.fromEntries(extensions) : undefined;
    this._streamInfo = streamInfoOf(query.extensions);
    this._overwrite = !!query.overwrite;
    this._fieldFunctionsInstance = undefined;
    this._fragmentMap = parsed.info.fragmentMap;

    // We collect all warnings associated with this operation to avoid
    // overwhelming the log for particularly nasty payloads.
    const warnings: string[] = [];

    // First, we walk the payload and apply all _scalar_ edits, while collecting
    // all references that have changed.  Reference changes are applied later,
    // once all new nodes have been built (and we can guarantee that we're
    // referencing the correct version).
    const referenceEdits: ReferenceEdit[] = [];
    this._referenceEdits = referenceEdits;
    const ref = this._mergeSubgraph(
      referenceEdits,
      warnings,
      parsed.rootId,
      [] /* prefixPath */,
      [] /* path */,
      parsed.parsedQuery,
      payload,
      prune,
      parsed.propMap,
    );

    // Now that we have new versions of every edited node, we can point all the
    // edited references to the correct nodes.
    //
    // In addition, this performs bookkeeping the inboundReferences of affected
    // nodes, and collects all newly orphaned nodes (and the nodes that lost
    // some, but not all, of their inbound references).
    const unreachableCandidates = new Set<NodeId>();
    this._referenceEdits = undefined;
    const orphanedNodeIds = this._mergeReferenceEdits(referenceEdits, unreachableCandidates);

    // Remove (garbage collect) orphaned subgraphs.
    this._removeOrphanedNodes(orphanedNodeIds, unreachableCandidates);

    // Remove the reference cycles that are no longer reachable (whose nodes
    // still reference each other, and so are not orphaned).
    this._removeUnreachableNodes(unreachableCandidates, parsed.rootId);

    // The query should now be considered complete for future reads.
    this._writtenQueries.add(parsed);

    // Don't emit empty arrays for easy testing upstream.
    return warnings.length ? { warnings, ref } : { ref };
  }

  /**
   * Merge a payload (subgraph) into the cache, following the parsed form of the
   * operation.
   */
  private _mergeSubgraph(
    referenceEdits: ReferenceEdit[],
    warnings: string[],
    containerId: NodeId,
    prefixPath: PathPart[],
    path: PathPart[],
    parsed: ParsedQuery,
    payload: JsonValue | undefined,
    prune: boolean,
    propMap: { [prop: string]: string } | undefined,
    mode?: MergeMode,
  ) {
    // Don't trust our inputs; we can receive values that aren't JSON
    // serializable via optimistic updates.
    if (payload === undefined) {
      payload = null;
    }

    // We should only ever reach a subgraph if it is a container (object/array).
    if (typeof payload !== 'object') {
      const message = `Received a ${typeof payload} value, but expected an object/array/null`;
      throw new InvalidPayloadError(message, prefixPath, containerId, path, payload);
    }

    // TODO(ianm): We're doing this a lot.  How much is it impacting perf?
    const previousValue = this._getPreviousValue(containerId, path);

    const isRoot = containerId === StaticNodeId.QueryRoot;
    // Like InMemoryCache, root objects have their root type's __typename.
    const rootTypename = path.length === 0 ? this._context.rootTypename(containerId) : undefined;
    const payloadTypename = typenameOf(payload);
    const storedTypename = rootTypename ?? typenameOf(previousValue);
    // The type whose field policies apply to the value's fields...
    const typename = (isRoot && rootTypename) || payloadTypename || storedTypename;
    // ...and the type that fragments' type conditions are matched against
    // (values nested within the root are not of the Query type).
    const fragmentTypename = payloadTypename || storedTypename || rootTypename;

    // Recurse into arrays.
    if (Array.isArray(payload) || Array.isArray(previousValue)) {
      if (!isNil(previousValue) && !Array.isArray(previousValue)) {
        throw new InvalidPayloadError(
          `Unsupported transition from a non-list to list value`,
          prefixPath,
          containerId,
          path,
          payload,
        );
      }
      if (!isNil(payload) && !Array.isArray(payload)) {
        throw new InvalidPayloadError(
          `Unsupported transition from a list to a non-list value`,
          prefixPath,
          containerId,
          path,
          payload,
        );
      }

      this._mergeArraySubgraph(
        referenceEdits,
        warnings,
        containerId,
        prefixPath,
        path,
        parsed,
        payload,
        previousValue,
        prune,
        propMap,
        mode,
      );
      return;
    }

    const ref = isReference(payload) ? payload.__ref : undefined;
    // Root objects are never identified by their data (see isRootNodeId).
    const isRootObject = path.length === 0 && isRootNodeId(containerId);
    let payloadId =
      ref ??
      (isRootObject ? undefined : this._identifyPayload(payload, parsed, propMap)) ??
      // A null value of a parameterized field (whose node is the container) is
      // not the container itself.
      (path.length === 0 && !isRoot && !isNil(payload) ? containerId : undefined);
    const previousId =
      (isRootObject ? undefined : this._identifyPrevious(previousValue, propMap, containerId, path)) ??
      (path.length === 0 && !isRoot
        ? containerId
        : (ifString(deepGet(this._pathToId[containerId], path)) ?? this._danglingReferenceId(containerId, path)));

    // Like InMemoryCache's mergeObjects, merge:true policies merge an
    // unidentified object into an entity (or an entity into the unidentified
    // object it replaces); objects whose __typenames differ are not merged.
    // Two different entities are not merged either: the incoming one replaces
    // the existing one.
    if (mode === 'merge' && typenamesDiffer(payload, previousValue)) mode = 'replace';
    if (
      payloadId !== previousId &&
      (!payloadId || !previousId) &&
      mode === 'merge' &&
      !isNil(payload) &&
      !isNil(previousValue) &&
      !ref
    ) {
      if (!payloadId) {
        payloadId = previousId;
      } else {
        payload = { ...(previousValue as JsonObject), ...payload };
      }
    }

    // Writing the entity that a dangling reference here points to re-links them.
    if (
      payloadId &&
      payloadId === previousId &&
      previousValue === undefined &&
      !ref &&
      (containerId !== payloadId || path.length !== 0)
    ) {
      referenceEdits.push({ containerId, path, prevNodeId: undefined, nextNodeId: payloadId });
    }

    // Is this an identity change?
    if (payloadId !== previousId) {
      // Like InMemoryCache, an unidentified value may replace an entity (the
      // reference is dropped and the value embedded in its place)...
      const replacesEntity = !isNil(payload) && !payloadId;
      // ...and an entity may replace an unidentified value.
      if (!isNil(previousValue) && !previousId) {
        // The replaced value may itself contain references.
        this._removeReferencesWithin(referenceEdits, containerId, path);
      }
      // Double check that our id generator is behaving properly.
      if (payloadId && isNil(payload)) {
        throw new OperationError(
          `entityIdForNode emitted an id for a nil payload value`,
          prefixPath,
          containerId,
          path,
          payload,
        );
      }

      // Fix references. See: orphan node tests on "orphan a subgraph" The new
      // value is null and the old value is an entity. We will want to remove
      // reference to such entity
      if (containerId !== payloadId || path.length !== 0) {
        if (!(containerId in this._pathToId)) {
          this._pathToId[containerId] = Object.create(null);
        }
        lazyImmutableDeepSet(this._pathToId[containerId], undefined, path, payloadId);
        referenceEdits.push({
          containerId,
          path,
          prevNodeId: previousId,
          nextNodeId: payloadId,
          // An unidentified value replacing the entity is written below.
          ...(replacesEntity && { noWrite: true as const }),
          ...(ref ? { reference: true } : undefined),
        });
      }
      if (replacesEntity) {
        this._setValue(containerId, path, {});
      }

      // Nothing more to do here; the reference edit will null out this field.
      if (isNil(payload)) return;
      // Enough to set the reference, no sub selections to traverse in the ref
      if (ref) return;

      // End of the line for a non-reference.
    } else if (isNil(payload)) {
      if (previousValue !== null) {
        this._setValue(containerId, path, null);
      }
      this._dropDanglingReference(containerId, path);
      return;
    } else if (ref) {
      // An unchanged reference.
      return payloadId;
    }

    // The (unidentified) value of a parameterized field, which is its node's
    // data (rather than an entity).
    const isParameterizedValue =
      payloadId === containerId &&
      path.length === 0 &&
      this._getNodeSnapshot(containerId) instanceof ParameterizedValueSnapshot;
    const unidentified = !payloadId || isParameterizedValue;

    // Unidentified objects replaced by a merge policy lose their other fields.
    const replacedValue =
      unidentified && (!previousId || isParameterizedValue) && mode === 'replace' ? previousValue : undefined;
    const writtenFields = replacedValue ? new Set<string>() : undefined;

    // If we've entered a new node; it becomes our container.
    if (payloadId) {
      prefixPath = [...prefixPath, ...path];
      containerId = payloadId;
      path = [];
    }

    // Like InMemoryCache, an empty unidentified object (e.g. the `{}` a merge
    // function returns) is stored, rather than left missing.
    if (
      !prune &&
      !payloadId &&
      isNil(previousValue) &&
      path.length &&
      isObject(payload) &&
      !Object.keys(payload).length
    ) {
      this._setValue(containerId, path, {});
    }

    // The schema names of the selected fields (written from their response keys).
    const selectedNames = new Set<string>();

    // Finally, we can walk into individual values.
    for (const payloadName in parsed) {
      let node = parsed[payloadName];
      let fieldValue = deepGet(payload, [payloadName]) as JsonValue | undefined;
      // Like InMemoryCache, skip fields of fragments that don't match the type.
      // (Fuzzy subtypes were inferred from the whole result by checkWrite.)
      if (node.alternatives) {
        // The field selected under this key for objects of this type.
        const alternative = alternativeForType(this._context, node, fragmentTypename);
        if (!alternative) continue;
        node = alternative;
      } else if (node.conditions && !this._context.conditionsMatch(node.conditions, fragmentTypename)) {
        continue;
      }
      // Having a schemaName on the node implies that payloadName is an alias.
      const schemaName = node.schemaName ? node.schemaName : payloadName;
      selectedNames.add(schemaName);
      // Don't trust our inputs.
      if (fieldValue === undefined) {
        // If it was explicitly undefined, that likely indicates a malformed
        // input (mutation, direct write).
        if (payload && payloadName in payload) {
          warnings.push(`Encountered undefined at ${[...prefixPath, ...path].join('.')}. Treating as null`);
        }

        continue;
      }

      let containerIdForField = containerId;
      // Only the child selections of fragments that match the type apply.
      const children = node.variants ? childrenForType(this._context, node, fragmentTypename) : node.children;

      // For static fields, we append the current cacheKey to create a new path
      // to the field.
      //
      //   user: {
      //     name: 'Bob',   -> fieldPath: ['user', 'name']
      //     address: {     -> fieldPath: ['user', 'address']
      //       city: 'A',   -> fieldPath: ['user', 'address', 'city']
      //       state: 'AB', -> fieldPath: ['user', 'address', 'state']
      //     },
      //     info: {
      //       id: 0,       -> fieldPath: ['id']
      //       prop1: 'hi'  -> fieldPath: ['prop1']
      //     },
      //     history: [
      //       {
      //         postal: 123 -> fieldPath: ['user', 'history', 0, 'postal']
      //       },
      //       {
      //         postal: 456 -> fieldPath: ['user', 'history', 1, 'postal']
      //       }
      //     ],
      //     phone: [
      //       '1234', -> fieldPath: ['user', 0]
      //       '5678', -> fieldPath: ['user', 1]
      //     ],
      //   },
      //
      // Similarly, something to keep in mind is that parameterized nodes
      // (instances of ParameterizedValueSnapshot) can have direct references to
      // an entity node's value.
      //
      // For example, with the query:
      //
      //   foo(id: 1) { id, name }
      //
      // The cache would have:
      //
      //   1: {
      //     data: { id: 1, name: 'Foo' },
      //   },
      //   'ROOT_QUERY❖["foo"]❖{"id":1}': {
      //     data: // a direct reference to the node of entity '1'.
      //   },
      //
      // This allows us to rely on standard behavior for entity references: If
      // node '1' is edited, the parameterized node must also be edited.
      // Similarly, the parameterized node contains an outbound reference to the
      // entity node, for garbage collection.
      let fieldPrefixPath = prefixPath;
      let fieldPath = [...path, schemaName];

      // Fields are stored under their arguments, or as their keyArgs policies
      // (or @connection directives) say, like InMemoryCache's store field names.
      const args = (node.args as JsonObject | undefined) ?? null;
      const field = fieldNodeOf(node);
      const storeKey = this._context.storeFieldNames.storeKey(typename, schemaName, args, field, this._variables);
      const storeFieldName = storeFieldNameOf(schemaName, storeKey, args);

      if (storeKey !== undefined) {
        if (fieldValue === null && prune) {
          this._setValue(containerIdForField, path, null);
          continue;
        }
        // The values of a parameterized field are explicit nodes in the graph;
        // so we set up a new container & path.
        containerIdForField = this._ensureParameterizedValueSnapshot(containerId, fieldPath, storeKey);
        fieldPrefixPath = [...prefixPath, ...fieldPath];
        fieldPath = [];
      }

      // Note that we're careful to fetch the value of our new container; not
      // the outer container.
      const previousFieldValue = this._getPreviousValue(containerIdForField, fieldPath);
      writtenFields?.add(schemaName);

      // Like InMemoryCache, fall back to the merge policy of the child's type.
      let merge = this._context.policies.getMergeFunction(
        typename,
        schemaName,
        node.children && isObject(fieldValue) ? fieldValue.__typename : undefined,
      );
      // Like InMemoryCache, the chunks of `@stream` lists without a merge
      // policy are merged into the cached list by its default stream merge.
      if (merge === undefined && usesDefaultStreamMerge(this._streamInfo, field, fieldValue, this._variables)) {
        merge = defaultStreamFieldMergeFn;
      }
      let fieldMode: MergeMode | undefined = merge === true ? 'merge' : merge === false ? 'replace' : undefined;
      if (typeof merge === 'function') {
        // Like InMemoryCache, merge functions see References in place of
        // entities (which are written first), and their result replaces the
        // existing value.
        const existing = withReferences(this._getNodeSnapshot(containerIdForField), fieldPath, previousFieldValue);
        // The field-name path (with list indices) from the root of the write,
        // which locates the field's `@stream` chunk info (like InMemoryCache's).
        const writePath = [...prefixPath, ...path, schemaName];
        const incoming = children
          ? this._normalizeIncoming(referenceEdits, warnings, writePath, children, fieldValue, prune, node.propMap)
          : fieldValue;
        const storageKeys = [containerId, ...path, storeFieldName];
        const fieldMerge = merge;
        fieldValue = runStreamAwareMerge(this._streamInfo, writePath, incoming, streamFieldInfo =>
          fieldMerge(
            // Like InMemoryCache, overwriting writes call merge functions without existing data.
            this._overwrite ? undefined : existing,
            incoming,
            this._fieldFunctions().mergeOptions(
              schemaName,
              storeFieldName,
              args,
              storageKeys,
              this._extensions,
              existing,
              field,
              streamFieldInfo,
            ),
          ),
        ) as JsonValue | undefined;
        fieldMode = 'replace';

        // Fields merged into undefined are not stored.
        if (fieldValue === undefined) {
          writtenFields?.delete(schemaName);
          if (previousFieldValue !== undefined) {
            this._removeReferencesWithin(referenceEdits, containerIdForField, fieldPath, true);
            this._setValue(containerIdForField, fieldPath, undefined, true, true);
          }
          continue;
        }
      } else if (!fieldMode && mode === 'replace' && unidentified) {
        // Nested values of a replaced unidentified object are replaced too.
        fieldMode = 'replace';
      }

      // Custom scalar values are stored serialized (and parsed when read).
      if (!node.children) {
        fieldValue = this._context.scalars.serializeField(typename, schemaName, fieldValue) as JsonValue | undefined;
      }

      // For fields with sub selections, we walk into them; only leaf fields are
      // directly written via _setValue.  This allows us to perform minimal
      // edits to the graph.
      if (node.children) {
        this._mergeSubgraph(
          referenceEdits,
          warnings,
          containerIdForField,
          fieldPrefixPath,
          fieldPath,
          children ?? {},
          fieldValue,
          prune,
          node.propMap,
          fieldMode,
        );

        // We've hit a leaf field.
        //
        // Note that we must perform a _deep_ equality check here, to cover cases
        // where a leaf value is a complex object.
      } else if (!isEqual(fieldValue, previousFieldValue)) {
        // We intentionally do not deep copy the nodeValue as Apollo will
        // then perform Object.freeze anyway. So any change in the payload
        // value afterward will be reflect in the graph as well.
        //
        // We use selection.name.value instead of payloadKey so that we
        // always write to cache using real field name rather than alias
        // name.
        this._setValue(containerIdForField, fieldPath, fieldValue);
      }
    }
    if (payload && !prune) {
      // Unselected fields of the payload are stored too, unless they are named
      // like a field selected under an alias: like InMemoryCache, which only
      // stores selected fields, the aliased value wins (e.g. when Apollo Client
      // writes back a cache diff's result, which has both).
      for (const payloadName of Object.keys(payload)) {
        if (!hasOwn.call(parsed, payloadName) && !selectedNames.has(payloadName)) {
          const value = payload[payloadName];
          const fieldPath = [...path, payloadName];
          writtenFields?.add(payloadName);
          this._setValue(containerId, fieldPath, value);
        }
      }
    }
    if (writtenFields && isObject(replacedValue)) {
      for (const key of Object.keys(replacedValue)) {
        if (writtenFields.has(key)) continue;
        this._removeReferencesWithin(referenceEdits, containerId, [...path, key], true);
        this._setValue(containerId, [...path, key], undefined, true, true);
      }
    }
    return payloadId;
  }

  /**
   * Like InMemoryCache, writes the entities within an incoming field value
   * (for a merge function), returning the value with References in their place.
   * `path` is the value's field-name path (with list indices) from the root of
   * the write.
   */
  private _normalizeIncoming(
    referenceEdits: ReferenceEdit[],
    warnings: string[],
    path: PathPart[],
    parsed: ParsedQuery,
    value: JsonValue | undefined,
    prune: boolean,
    propMap: { [prop: string]: string } | undefined,
  ): any {
    if (Array.isArray(value)) {
      return value.map((item, i) =>
        this._normalizeIncoming(referenceEdits, warnings, [...path, i], parsed, item, prune, propMap),
      );
    }
    if (!isObject(value) || isReference(value)) return value;

    const entityId = this._identifyPayload(value, parsed, propMap);
    if (entityId) {
      this._mergeSubgraph(referenceEdits, warnings, entityId, path, [], parsed, value, prune, propMap);
      return makeRef(entityId);
    }

    let normalized = value;
    for (const payloadName in parsed) {
      const { children, propMap: childPropMap, schemaName } = this._fieldForType(parsed[payloadName], value.__typename);
      const child = value[payloadName];
      if (!children || child === undefined) continue;
      const normalizedChild = this._normalizeIncoming(
        referenceEdits,
        warnings,
        [...path, schemaName ?? payloadName],
        children,
        child,
        prune,
        childPropMap,
      );
      if (normalizedChild !== child) {
        normalized = normalized === value ? { ...value } : normalized;
        normalized[payloadName] = normalizedChild;
      }
    }
    return normalized;
  }

  /**
   * The id of a written object (with the given selections), like
   * InMemoryCache's policies.identify: keyFields functions see the object's
   * fields by their schema names, its selection set, and the fragments of the
   * operation.
   */
  private _identifyPayload(
    payload: JsonValue | undefined,
    parsed: ParsedQuery,
    propMap: { [prop: string]: string } | undefined,
  ): NodeId | undefined {
    if (!isObject(payload)) return undefined;
    return this._context.entityIdForValue(
      getPayloadProxy(payload, propMap),
      { selectionSet: selectionSetOf(parsed), fragmentMap: this._fragmentMap },
      () => toStoreObject(payload, parsed, (node, typename) => this._fieldForType(node, typename)),
    );
  }

  /**
   * The field selected under a response key (whose node is `node`) for
   * objects of the given type: the node, unless it has alternatives.
   */
  private _fieldForType(node: ParsedQueryNode, typename: unknown): ParsedQueryNode {
    return node.alternatives ? (alternativeForType(this._context, node, typename) ?? node) : node;
  }

  /**
   * The id of the entity previously stored at `path` of a node (whose data is
   * `previousValue`).  Like InMemoryCache, keyFields functions only identify
   * written objects, so for their types the id is found in the graph.
   */
  private _identifyPrevious(
    previousValue: JsonValue | undefined,
    propMap: { [prop: string]: string } | undefined,
    containerId: NodeId,
    path: PathPart[],
  ): NodeId | undefined {
    if (!isObject(previousValue)) return undefined;
    if (this._context.policies.hasKeyFieldsFunction(previousValue.__typename)) {
      const reference = this._getNodeSnapshot(containerId)?.outbound?.get(toOutKey(path));
      return reference && this._getNodeSnapshot(reference.id) ? reference.id : undefined;
    }
    return this._context.entityIdForValue(getVisibleProxy(previousValue, propMap));
  }

  /**
   * Removes the references found within (or, with `inclusive`, at or within)
   * `path` of a node, without writing to it.
   */
  private _removeReferencesWithin(
    referenceEdits: ReferenceEdit[],
    containerId: NodeId,
    path: PathPart[],
    inclusive = false,
  ) {
    const container = this._getNodeSnapshot(containerId);
    if (!container || (!container.outbound && !container.parameterized)) return;
    for (const reference of iterRefs(container.outbound, container.parameterized)) {
      if (!pathBeginsWith(reference.path, path)) continue;
      if (!inclusive && reference.path.length === path.length) continue;
      referenceEdits.push({
        containerId,
        path: reference.path,
        prevNodeId: reference.id,
        nextNodeId: undefined,
        noWrite: true,
      });
    }
  }

  /**
   * The helpers passed to merge functions.
   */
  private _fieldFunctions() {
    return (this._fieldFunctionsInstance ??= new FieldFunctions(
      this._context,
      id => this._getNodeSnapshot(id),
      this._variables,
      makeToReference(this._context.entityIdForValue, (entityId, value) => this._mergeIntoEntity(entityId, value)),
      (ref, value, valueIsOlder) => this._mergeIntoEntity(ref.__ref, value, valueIsOlder),
    ));
  }

  /**
   * Shallowly merges `value` (a store object, from toReference or
   * mergeObjects) into the data of an entity, creating it if needed. With
   * `valueIsOlder`, the entity's own fields take precedence.
   *
   * The References within `value` become references of the entity (so, like
   * any other, they keep what they reference from being garbage collected).
   */
  private _mergeIntoEntity(entityId: NodeId, value: StoreObject, valueIsOlder = false) {
    // Custom scalar values are stored serialized.
    value = this._context.scalars.serializeStoreObject(value);
    const node = this._getNodeSnapshot(entityId);
    const data = isObject(node?.data) ? (node!.data as JsonObject) : undefined;
    // Outside of mergePayload, the edits are applied right away.
    const referenceEdits = this._referenceEdits ?? [];

    if (!data) this._setValue(entityId, [], {});
    for (const key of Object.keys(value)) {
      const hasField = (data && hasOwn.call(data, key)) || node?.outbound?.has(key);
      if (valueIsOlder && hasField) continue;
      const references: [PathPart[], NodeId][] = [];
      const fieldValue = withoutReferences(value[key], [key], references);
      if (hasField) this._removeReferencesWithin(referenceEdits, entityId, [key], true);
      this._setValue(entityId, [key], fieldValue);
      for (const [path, id] of references) {
        referenceEdits.push({ containerId: entityId, path, prevNodeId: undefined, nextNodeId: id, reference: true });
      }
    }

    if (!this._referenceEdits) this._mergeReferenceEdits(referenceEdits);
  }

  /**
   * Merge an array from the payload (or previous cache data).
   */
  private _mergeArraySubgraph(
    referenceEdits: ReferenceEdit[],
    warnings: string[],
    containerId: NodeId,
    prefixPath: PathPart[],
    path: PathPart[],
    parsed: ParsedQuery,
    payload: JsonArray | Nil,
    previousValue: JsonArray | Nil,
    prune: boolean,
    propMap: { [prop: string]: string } | undefined,
    mode: MergeMode | undefined,
  ) {
    if (isNil(payload)) {
      // Note that we mark this as an edit, as this method is only ever called
      // if we've determined the value to be an array (which means that
      // previousValue MUST be an array in this case).
      this._setValue(containerId, path, null);
      return;
    }

    const payloadLength = payload ? payload.length : 0;
    const previousLength = previousValue ? previousValue.length : 0;
    // Note that even though we walk into arrays, we need to be
    // careful to ensure that we don't leave stray values around if
    // the new array is of a different length.
    //
    // So, we resize the array to our desired size before walking.
    if (payloadLength !== previousLength || !previousValue) {
      const newArray = Array.isArray(previousValue) ? previousValue.slice(0, payloadLength) : new Array(payloadLength);
      this._setValue(containerId, path, newArray);

      // Drop any extraneous references.
      if (payloadLength < previousLength) {
        this._removeArrayReferences(referenceEdits, containerId, path, payloadLength - 1);
      }
    }

    // Note that we're careful to iterate over all indexes, in case this is a
    // sparse array.
    for (let i = 0; i < payload.length; i++) {
      let childPayload = payload[i];
      if (childPayload === undefined) {
        // Undefined values in an array are strictly invalid; and likely
        // indicate a malformed input (mutation, direct write).
        childPayload = null;

        if (i in payload) {
          warnings.push(`Encountered undefined at ${[...path, i].join('.')}. Treating as null`);
        } else {
          warnings.push(`Encountered hole in array at ${[...path, i].join('.')}. Filling with null`);
        }
      }

      this._mergeSubgraph(
        referenceEdits,
        warnings,
        containerId,
        prefixPath,
        [...path, i],
        parsed,
        childPayload,
        prune,
        propMap,
        mode,
      );
    }
  }

  delete(nodeId: NodeId) {
    this._editedNodeIds.add(nodeId);
    const referenceEdits: ReferenceEdit[] = [];
    const nodeSnapshot = this._getNodeSnapshot(nodeId);

    // A parameterized value is removed from its container without writing a null field value.
    const noWrite = nodeSnapshot instanceof ParameterizedValueSnapshot ? true : undefined;
    nodeSnapshot?.inbound?.forEach(({ id, path }) => {
      this._editedNodeIds.add(id);
      if (noWrite) {
        referenceEdits.push({ containerId: id, nextNodeId: undefined, prevNodeId: nodeId, path, noWrite });
      } else if (!this._isDeleted(id)) {
        // Like InMemoryCache, referrers keep their (now dangling) reference to
        // a deleted entity, so reads report it as missing data rather than null.
        this._setValue(id, path, undefined, true, typeof path[path.length - 1] === 'string');
      }
    });

    // Outbound targets only lose an inbound reference; their data is unchanged,
    // so they are not marked as edited, and their other referrers are not
    // rebuilt. Targets left without any inbound reference are still marked, as
    // orphans, by _mergeReferenceEdits.
    nodeSnapshot?.outbound?.forEach(({ id, path }) => {
      referenceEdits.push({ containerId: nodeId, nextNodeId: undefined, prevNodeId: id, path });
    });

    forEach(nodeSnapshot?.parameterized, ({ id, path }) => {
      referenceEdits.push({ containerId: nodeId, nextNodeId: undefined, prevNodeId: id, path });
    });

    // One editor may delete several nodes (batchEvict, gc, optimistic replay).
    // Edits touching a node this editor already deleted are moot, and would
    // otherwise fail on its missing snapshot.
    this._mergeReferenceEdits(
      referenceEdits.filter(
        ({ containerId, prevNodeId }) => !this._isDeleted(containerId) && !(prevNodeId && this._isDeleted(prevNodeId)),
      ),
    );
    this._newNodes[nodeId] = undefined;

    // Parameterized values only exist as fields of this node, so they go with it.
    forEach(nodeSnapshot?.parameterized, ({ id }) => {
      if (!this._isDeleted(id)) this.delete(id);
    });
  }

  /**
   * Whether this editor has deleted the node.
   */
  private _isDeleted(nodeId: NodeId) {
    return nodeId in this._newNodes && this._newNodes[nodeId] === undefined;
  }

  /**
   * Modify a GraphQL payload (query/fragment/etc) into the snapshot, rooted at
   * the node identified by `rootId`.
   */
  modify(
    rootId: NodeId,
    payload: JsonObject,
    deleted: Set<string>,
    seenObjects: Set<object | null>,
  ): { warnings?: string[] } {
    const warnings: string[] = [];
    const referenceEdits: ReferenceEdit[] = [];
    this._modifySubgraph(
      referenceEdits,
      warnings,
      rootId,
      [] /* prefixPath */,
      [] /* path */,
      payload,
      deleted,
      seenObjects,
    );
    this._mergeReferenceEdits(referenceEdits);
    return warnings.length ? { warnings } : {};
  }

  /**
   * Modify a payload (subgraph) into the cache.
   */
  private _modifySubgraph(
    referenceEdits: ReferenceEdit[],
    warnings: string[],
    containerId: NodeId,
    prefixPath: PathPart[],
    path: PathPart[],
    payload: JsonValue | undefined,
    deleted: Set<string>,
    seenObjects: Set<object | null>,
  ) {
    // Don't trust our inputs; we can receive values that aren't JSON
    // serializable via optimistic updates.
    if (payload === undefined) {
      payload = null;
    }

    // We should only ever reach a subgraph if it is a container (object/array).
    if (typeof payload !== 'object') {
      const message = `Received a ${typeof payload} value, but expected an object/array/null`;
      throw new InvalidPayloadError(message, prefixPath, containerId, path, payload);
    }

    if (seenObjects.has(payload)) {
      return;
    }
    seenObjects.add(payload);

    // TODO(ianm): We're doing this a lot.  How much is it impacting perf?
    const previousValue = this._getPreviousValue(containerId, path);
    const nodeSnapshot = this._getNodeSnapshot(containerId);

    // Recurse into arrays.
    if (Array.isArray(payload) || Array.isArray(previousValue)) {
      if (!isNil(previousValue) && !Array.isArray(previousValue)) {
        throw new InvalidPayloadError(
          `Unsupported transition from a non-list to list value`,
          prefixPath,
          containerId,
          path,
          payload,
        );
      }
      if (!isNil(payload) && !Array.isArray(payload)) {
        throw new InvalidPayloadError(
          `Unsupported transition from a list to a non-list value`,
          prefixPath,
          containerId,
          path,
          payload,
        );
      }

      this._modifyArraySubgraph(
        referenceEdits,
        warnings,
        containerId,
        prefixPath,
        path,
        payload,
        previousValue,
        seenObjects,
      );
      return;
    }

    const reference = isReference(payload) ? payload.__ref : null;
    // Root objects are never identified by their data (see isRootNodeId).
    const isRootObject = path.length === 0 && isRootNodeId(containerId);
    const payloadId = reference
      ? reference
      : isRootObject
        ? undefined
        : this._context.entityIdForValue({ ...(previousValue as JsonObject), ...payload });
    const previousId = isRootObject ? undefined : this._identifyPrevious(previousValue, undefined, containerId, path);

    // Is this an identity change?
    if (payloadId !== previousId) {
      // It is invalid to transition from a *value* with an id to one without.
      if (!isNil(payload) && !payloadId) {
        const message = `Unsupported transition from an entity to a non-entity value. ${ensureIdConstistencyMsg}`;
        throw new InvalidPayloadError(message, prefixPath, containerId, path, payload);
      }
      // The reverse is also invalid.
      if (!isNil(previousValue) && !previousId) {
        const message = `Unsupported transition from a non-entity value to an entity. ${ensureIdConstistencyMsg}`;
        throw new InvalidPayloadError(message, prefixPath, containerId, path, payload);
      }
      // Double check that our id generator is behaving properly.
      if (payloadId && isNil(payload)) {
        throw new OperationError(
          `entityIdForNode emitted an id for a nil payload value`,
          prefixPath,
          containerId,
          path,
          payload,
        );
      }

      // Fix references. See: orphan node tests on "orphan a subgraph" The new
      // value is null and the old value is an entity. We will want to remove
      // reference to such entity
      if (containerId !== payloadId || path.length !== 0) {
        referenceEdits.push({
          containerId,
          path,
          prevNodeId: previousId,
          nextNodeId: payloadId,
          ...(reference ? { reference: true } : undefined),
        });
      }

      // Nothing more to do here; the reference edit will null out this field.
      if (!payloadId || reference) return;

      // End of the line for a non-reference.
    } else if (isNil(payload)) {
      if (previousValue !== null) {
        this._setValue(containerId, path, null);
      }
      this._dropDanglingReference(containerId, path);
      return;
    }

    // If we've entered a new node; it becomes our container.
    if (payloadId) {
      prefixPath = [...prefixPath, ...path];
      containerId = payloadId;
      path = [];
    }

    // Finally, we can walk into individual values.
    for (const payloadName in payload) {
      const node = payload[payloadName];
      // Having a schemaName on the node implies that payloadName is an alias.
      const fieldValue = deepGet(payload, [payloadName]) as JsonValue | undefined;

      // Don't trust our inputs.
      if (fieldValue === undefined) {
        // If it was explicitly undefined, that likely indicates a malformed
        // input (mutation, direct write).
        if (payload && payloadName in payload) {
          warnings.push(`Encountered undefined at ${[...prefixPath, ...path].join('.')}. Treating as null`);
        }

        continue;
      }

      const containerIdForField = containerId;

      // For static fields, we append the current cacheKey to create a new path
      // to the field.
      //
      //   user: {
      //     name: 'Bob',   -> fieldPath: ['user', 'name']
      //     address: {     -> fieldPath: ['user', 'address']
      //       city: 'A',   -> fieldPath: ['user', 'address', 'city']
      //       state: 'AB', -> fieldPath: ['user', 'address', 'state']
      //     },
      //     info: {
      //       id: 0,       -> fieldPath: ['id']
      //       prop1: 'hi'  -> fieldPath: ['prop1']
      //     },
      //     history: [
      //       {
      //         postal: 123 -> fieldPath: ['user', 'history', 0, 'postal']
      //       },
      //       {
      //         postal: 456 -> fieldPath: ['user', 'history', 1, 'postal']
      //       }
      //     ],
      //     phone: [
      //       '1234', -> fieldPath: ['user', 0]
      //       '5678', -> fieldPath: ['user', 1]
      //     ],
      //   },
      //
      // Similarly, something to keep in mind is that parameterized nodes
      // (instances of ParameterizedValueSnapshot) can have direct references to
      // an entity node's value.
      //
      // For example, with the query:
      //
      //   foo(id: 1) { id, name }
      //
      // The cache would have:
      //
      //   1: {
      //     data: { id: 1, name: 'Foo' },
      //   },
      //   'ROOT_QUERY❖["foo"]❖{"id":1}': {
      //     data: // a direct reference to the node of entity '1'.
      //   },
      //
      // This allows us to rely on standard behavior for entity references: If
      // node '1' is edited, the parameterized node must also be edited.
      // Similarly, the parameterized node contains an outbound reference to the
      // entity node, for garbage collection.
      const fieldPrefixPath = prefixPath;
      const fieldPath = [...path, payloadName];

      const parameterizedFields = nodeSnapshot?.parameterized?.get(payloadName);
      if (parameterizedFields?.length) {
        for (const field of parameterizedFields) {
          // The values of a parameterized field are explicit nodes in the graph
          // so we set up a new container & path.
          this._modifySubgraph(
            referenceEdits,
            warnings,
            field.id,
            [...prefixPath, ...field.path],
            [],
            deepGet(fieldValue, field.path.slice(1)),
            new Set(),
            seenObjects,
          );
        }
        if (parameterizedFields.some(field => field.path.length === 1)) {
          continue;
        }
      }

      // Note that we're careful to fetch the value of our new container; not
      // the outer container.
      const previousFieldValue = this._getPreviousValue(containerIdForField, fieldPath);

      // For fields with sub selections, we walk into them; only leaf fields are
      // directly written via _setValue.  This allows us to perform minimal
      // edits to the graph.  (Values like Dates or Maps are leaf values.)
      if (typeof node === 'object' && (node === null || Array.isArray(node) || isPlainObject(node))) {
        this._modifySubgraph(
          referenceEdits,
          warnings,
          containerIdForField,
          fieldPrefixPath,
          fieldPath,
          fieldValue,
          new Set(),
          seenObjects,
        );

        // We've hit a leaf field.
        //
        // Note that we must perform a _deep_ equality check here, to cover cases
        // where a leaf value is a complex object.
      } else if (!isEqual(fieldValue, previousFieldValue)) {
        // We intentionally do not deep copy the nodeValue as Apollo will
        // then perform Object.freeze anyway. So any change in the payload
        // value afterward will be reflect in the graph as well.
        //
        // We use selection.name.value instead of payloadKey so that we
        // always write to cache using real field name rather than alias
        // name.
        this._setValue(containerIdForField, fieldPath, fieldValue);
      }
    }
    const node = this._getNodeSnapshot(containerId);
    const value = deepGet(node?.data, path);

    for (const key of deleted) {
      const fieldPath = [...path, key];
      if (value && key in value) {
        this._setValue(containerId, fieldPath, undefined, true, true);
        // Like InMemoryCache, the field's references go with it (so gc can
        // collect what they referenced).
        this._removeReferencesUnder(referenceEdits, containerId, fieldPath);
      } else if (this._danglingReferenceId(containerId, fieldPath) !== undefined) {
        // A field holding a dangling reference has no value to remove.
        this._editedNodeIds.add(containerId);
        this._dropDanglingReference(containerId, fieldPath);
      } else {
        const keyParts = key.split('❖');
        if (keyParts.length > 1) {
          // A field with arguments: remove its stored value too, as InMemoryCache's evict does.
          this.delete(key);
          continue;
        }
        const keyPath = [key];
        referenceEdits.push({
          containerId,
          path: keyPath,
          prevNodeId: key,
          nextNodeId: undefined,
        });
      }
    }
  }

  /**
   * The id of the missing entity referenced at `path` of a node, if that
   * reference is dangling (its entity was deleted).
   */
  private _danglingReferenceId(containerId: NodeId, path: PathPart[]): NodeId | undefined {
    const reference = this._getNodeSnapshot(containerId)?.outbound?.get(toOutKey(path));
    return reference && !this._getNodeSnapshot(reference.id) ? reference.id : undefined;
  }

  /**
   * Removes a dangling reference at `path` of a node, once a value replaces it.
   */
  private _dropDanglingReference(containerId: NodeId, path: PathPart[]) {
    if (this._danglingReferenceId(containerId, path) !== undefined) {
      removeOutboundReference(this._ensureNewSnapshot(containerId), path);
    }
  }

  private _getPreviousValue(containerId: string, path: PathPart[]): JsonValue | undefined {
    const node = this._getNodeSnapshot(containerId);
    const value = deepGet(node?.data, path);
    if (value === undefined) {
      if (node) {
        const out = node.outbound?.get(toOutKey(path));
        if (out !== undefined) {
          return this._getNodeData(out.id);
        }
        const key = path[0];
        if (key === undefined) {
          return value;
        }
        const refs = node.parameterized?.get(key.toString());
        if (refs === undefined) {
          return value;
        }
        const length = path.length;
        for (const ref of refs) {
          const p = ref.path;
          if (p.length === length && path.every((part, i) => part === p[i])) {
            return this._getNodeData(ref.id);
          }
        }
      }
    }
    return value;
  }

  /**
   * Modify an array from the payload (or previous cache data).
   */
  private _modifyArraySubgraph(
    referenceEdits: ReferenceEdit[],
    warnings: string[],
    containerId: NodeId,
    prefixPath: PathPart[],
    path: PathPart[],
    payload: JsonArray | Nil,
    previousValue: JsonArray | Nil,
    seenObjects: Set<object | null>,
  ) {
    if (isNil(payload)) {
      // Note that we mark this as an edit, as this method is only ever called
      // if we've determined the value to be an array (which means that
      // previousValue MUST be an array in this case).
      this._setValue(containerId, path, null);
      return;
    }

    const payloadLength = payload ? payload.length : 0;
    const previousLength = previousValue ? previousValue.length : 0;
    // Note that even though we walk into arrays, we need to be
    // careful to ensure that we don't leave stray values around if
    // the new array is of a different length.
    //
    // So, we resize the array to our desired size before walking.
    if (payloadLength !== previousLength || !previousValue) {
      const newArray = Array.isArray(previousValue) ? previousValue.slice(0, payloadLength) : new Array(payloadLength);
      this._setValue(containerId, path, newArray);

      // Drop any extraneous references.
      if (payloadLength < previousLength) {
        this._removeArrayReferences(referenceEdits, containerId, path, payloadLength - 1);
      }
    }

    // Note that we're careful to iterate over all indexes, in case this is a
    // sparse array.
    for (let i = 0; i < payload.length; i++) {
      let childPayload = payload[i];
      if (childPayload === undefined) {
        // Undefined values in an array are strictly invalid; and likely
        // indicate a malformed input (mutation, direct write).
        childPayload = null;

        if (i in payload) {
          warnings.push(`Encountered undefined at ${[...path, i].join('.')}. Treating as null`);
        } else {
          warnings.push(`Encountered hole in array at ${[...path, i].join('.')}. Filling with null`);
        }
      }

      if (typeof childPayload === 'object') {
        this._modifySubgraph(
          referenceEdits,
          warnings,
          containerId,
          prefixPath,
          [...path, i],
          childPayload,
          new Set(),
          seenObjects,
        );
      } else {
        this._setValue(containerId, [...path, i], childPayload);
      }
    }
  }

  /**
   * Removes the (outbound) references at or below `prefix` of a node, without
   * writing their values.
   */
  private _removeReferencesUnder(referenceEdits: ReferenceEdit[], containerId: NodeId, prefix: PathPart[]) {
    const outbound = this._getNodeSnapshot(containerId)?.outbound;
    if (!outbound) return;
    for (const reference of outbound.values()) {
      if (!pathBeginsWith(reference.path, prefix)) continue;
      referenceEdits.push({
        containerId,
        path: reference.path,
        prevNodeId: reference.id,
        nextNodeId: undefined,
        noWrite: true,
      });
    }
  }

  /**
   *
   */
  private _removeArrayReferences(
    referenceEdits: ReferenceEdit[],
    containerId: NodeId,
    prefix: PathPart[],
    afterIndex: number,
  ) {
    const container = this._getNodeSnapshot(containerId);
    if (!container || (!container.outbound && !container.parameterized)) return;
    for (const reference of iterRefs(container.outbound, container.parameterized)) {
      if (!pathBeginsWith(reference.path, prefix)) continue;
      const index = reference.path[prefix.length];
      if (typeof index !== 'number') continue;
      if (index <= afterIndex) continue;

      // At this point, we've got a reference beyond the array's new bounds.
      referenceEdits.push({
        containerId,
        path: reference.path,
        prevNodeId: reference.id,
        nextNodeId: undefined,
        noWrite: true,
      });
    }
  }

  /**
   * Update all nodes with edited references, and ensure that the bookkeeping of
   * the new and _past_ references are properly updated.
   *
   * Returns the set of node ids that are newly orphaned by these edits, and
   * adds the nodes that lost inbound references but still have some to
   * `unreachableCandidates` (see _removeUnreachableNodes).
   */
  private _mergeReferenceEdits(referenceEdits: ReferenceEdit[], unreachableCandidates?: Set<NodeId>) {
    const orphanedNodeIds: Set<NodeId> = new Set();

    for (const { containerId, path, prevNodeId, nextNodeId, noWrite, reference } of referenceEdits) {
      // Like InMemoryCache, a reference to a missing entity is kept, dangling.
      const dangling = reference && nextNodeId && !this._getNodeSnapshot(nextNodeId);
      if (dangling) {
        this._setValue(containerId, path, undefined, true, typeof path[path.length - 1] === 'string');
      } else if (!noWrite) {
        const target = nextNodeId ? this._getNodeData(nextNodeId) : null;
        this._setValue(containerId, path, target);
      }
      const container = this._ensureNewSnapshot(containerId);

      if (prevNodeId && !this._getNodeSnapshot(prevNodeId)) {
        // A dangling reference: there is no target to update.
        removeOutboundReference(container, path);
      } else if (prevNodeId) {
        const prevTarget = this._ensureNewSnapshot(prevNodeId);
        const parameterized = prevTarget instanceof ParameterizedValueSnapshot;
        if (parameterized) {
          removeParameterizedReference(container, prevNodeId, path);
        } else {
          removeOutboundReference(container, path);
        }
        removeInboundReference(prevTarget, containerId, path);
        if (!prevTarget.inbound) {
          orphanedNodeIds.add(prevNodeId);
        } else {
          unreachableCandidates?.add(prevNodeId);
        }
      }

      if (dangling) {
        addOutboundReference(container, nextNodeId, path);
      } else if (nextNodeId) {
        const nextTarget = this._ensureNewSnapshot(nextNodeId);
        const parameterized = nextTarget instanceof ParameterizedValueSnapshot;
        if (parameterized) {
          addParameterizedReference(container, nextNodeId, path);
        } else {
          addOutboundReference(container, nextNodeId, path);
        }
        addInboundReference(nextTarget, containerId, path);
        orphanedNodeIds.delete(nextNodeId);
      }
    }

    for (const id of orphanedNodeIds) {
      this._editedNodeIds.add(id);
    }

    return orphanedNodeIds;
  }

  /**
   * Commits the transaction, returning a new immutable snapshot.
   */
  commit(ref?: NodeId | undefined): EditedSnapshot<TSerialized> {
    // At this point, every node that has had any of its properties change now
    // exists in _newNodes.  In order to preserve immutability, we need to walk
    // all nodes that transitively reference an edited node, and update their
    // references to point to the new version.
    this._rebuildInboundReferences();

    // When nothing changed (e.g. the same values were written again), keep the
    // snapshot, along with its cached reads (so their results keep their identity).
    const unchanged = !this._editedNodeIds.size && !Object.keys(this._newNodes).length;
    const snapshot = unchanged ? this._parent : this._buildNewSnapshot();
    if (this._context.freezeSnapshots) {
      snapshot.freeze();
    }

    return {
      snapshot,
      editedNodeIds: this._editedNodeIds,
      writtenQueries: this._writtenQueries,
      ref: ref ? makeRef(ref) : undefined,
    };
  }

  /**
   * Collect all our pending changes into a new GraphSnapshot.
   */
  _buildNewSnapshot() {
    const { entityTransformer } = this._context;
    const snapshots = { ...this._parent._values };

    for (const id in this._newNodes) {
      const newSnapshot = this._newNodes[id];
      // Drop snapshots that were garbage collected.
      if (newSnapshot === undefined) {
        delete snapshots[id];
      } else {
        // TODO: This should not be run for ParameterizedValueSnapshots
        if (entityTransformer) {
          const { data } = this._newNodes[id] as EntitySnapshotType;
          if (data) entityTransformer(data);
        }
        snapshots[id] = newSnapshot;
      }
    }

    return new GraphSnapshot(snapshots);
  }

  /**
   * Transitively walks the inbound references of all edited nodes, rewriting
   * those references to point to the newly edited versions.
   */
  private _rebuildInboundReferences() {
    const queue = Array.from(this._editedNodeIds);
    addToSet(this._rebuiltNodeIds, queue);

    while (queue.length) {
      const nodeId = queue.pop()!;
      const snapshot = this._getNodeSnapshot(nodeId);
      if (!(snapshot instanceof EntitySnapshot)) continue;
      if (!snapshot || !snapshot.inbound) continue;

      for (const { id, path } of snapshot.inbound.values()) {
        this._setValue(id, path, snapshot.data, false);
        if (this._rebuiltNodeIds.has(id)) continue;

        this._rebuiltNodeIds.add(id);
        queue.push(id);
      }
    }
  }

  /**
   * Transitively removes all orphaned nodes from the graph.
   *
   * The nodes that lose inbound references but still have some are added to
   * `unreachableCandidates` (see _removeUnreachableNodes).
   */
  private _removeOrphanedNodes(nodeIds: Iterable<NodeId>, unreachableCandidates: Set<NodeId>) {
    const queue = Array.from(nodeIds);
    while (queue.length) {
      const nodeId = queue.pop()!;
      const node = this._getNodeSnapshot(nodeId);
      if (!node) continue;

      this._newNodes[nodeId] = undefined;
      this._editedNodeIds.add(nodeId);

      const { outbound, parameterized } = node;
      if (outbound) {
        this.removeInbound(outbound.values(), nodeId, queue, unreachableCandidates);
      }
      if (parameterized) {
        this.removeInbound(iterParameterized(parameterized), nodeId, queue, unreachableCandidates);
      }
    }
  }

  private removeInbound(
    refs: Iterable<NodeReference>,
    nodeId: string,
    queue: string[],
    unreachableCandidates: Set<NodeId>,
  ) {
    for (const { id, path } of refs) {
      // Dangling references have no target to update.
      if (!this._getNodeSnapshot(id)) continue;
      const reference = this._ensureNewSnapshot(id);
      removeInboundReference(reference, nodeId, path);
      if (reference.inbound === undefined) {
        queue.push(id);
      } else {
        unreachableCandidates.add(id);
      }
    }
  }

  /**
   * Removes the nodes that lost inbound references (`candidates`), but are
   * still referenced, if they are no longer reachable from any root: the
   * reference cycles that orphan removal can't collect, since their nodes
   * still reference each other.
   *
   * Roots are the root nodes (ROOT_QUERY etc), the nodes nothing references
   * (which Hermes keeps, e.g. those written by writeFragment), retained nodes,
   * and the root of the write.
   *
   * Each candidate is first checked by searching backwards (through inbound
   * references) from it for a root or a node already known to be reachable;
   * when one is found, every node on the path to it is reachable too. If there
   * is none, all the nodes found are unreachable, and are removed (along with
   * what they alone reference).
   *
   * Those searches share a budget of visited nodes. Should it run out (many
   * candidates, in large reference graphs), reachability is instead marked
   * forwards from the roots, once, over the whole graph; then the candidates
   * that are not marked are removed with what references them.
   */
  private _removeUnreachableNodes(candidates: Set<NodeId>, writeRootId: NodeId) {
    if (!candidates.size) return;
    const reachable = new Set<NodeId>();
    const isRoot = (id: NodeId, node: NodeSnapshot) =>
      !node.inbound || id === writeRootId || isRootNodeId(id) || !!this._isRetained?.(id);
    const isKnownReachable = (id: NodeId, node: NodeSnapshot) => reachable.has(id) || isRoot(id, node);

    // The nodes the backward searches may visit, in total.
    let budget = UNREACHABLE_SEARCH_BUDGET + UNREACHABLE_SEARCH_BUDGET_PER_CANDIDATE * candidates.size;
    // Once the budget runs out: the nodes reachable from the roots.
    let marked: Set<NodeId> | undefined;

    for (const candidate of candidates) {
      const candidateNode = this._getNodeSnapshot(candidate);
      if (!candidateNode || reachable.has(candidate)) continue;
      if (marked) {
        if (!marked.has(candidate)) this._removeOrphanedNodes(this._referrersOf(candidate), candidates);
        continue;
      }
      if (isKnownReachable(candidate, candidateNode)) {
        reachable.add(candidate);
        continue;
      }

      // Breadth-first, so that the nearest root is found first. `via` maps
      // each node found to the node it references on the way to the candidate.
      const found = [candidate];
      const via = new Map<NodeId, NodeId | undefined>([[candidate, undefined]]);
      let reachedFrom: NodeId | undefined;
      for (let i = 0; reachedFrom === undefined && budget > 0 && i < found.length; i++) {
        const node = this._getNodeSnapshot(found[i]);
        if (!node?.inbound) continue;
        budget -= node.inbound.size;
        for (const { id: referrerId } of node.inbound.values()) {
          if (via.has(referrerId)) continue;
          const referrer = this._getNodeSnapshot(referrerId);
          if (!referrer) continue;
          via.set(referrerId, found[i]);
          if (isKnownReachable(referrerId, referrer)) {
            reachedFrom = found[i];
            break;
          }
          found.push(referrerId);
        }
      }

      if (reachedFrom !== undefined) {
        // Everything on the path from the candidate to the root is reachable.
        for (let id: NodeId | undefined = reachedFrom; id !== undefined; id = via.get(id)) reachable.add(id);
      } else if (budget > 0) {
        // Nothing that references these nodes (even indirectly) is reachable.
        // Removing them may leave more candidates (e.g. a cycle that one of
        // them referenced), which this loop visits too.
        this._removeOrphanedNodes(found, candidates);
      } else {
        marked = this._markReachableNodes(isRoot);
        if (!marked.has(candidate)) this._removeOrphanedNodes(this._referrersOf(candidate), candidates);
      }
    }
  }

  /**
   * The nodes reachable from the roots (see _removeUnreachableNodes), marked
   * forwards through references.
   */
  private _markReachableNodes(isRoot: (id: NodeId, node: NodeSnapshot) => boolean): Set<NodeId> {
    const marked = new Set<NodeId>();
    const queue: NodeId[] = [];
    const visit = (id: NodeId) => {
      if (marked.has(id) || !this._getNodeSnapshot(id)) return;
      marked.add(id);
      queue.push(id);
    };
    for (const id of this._parent.allNodeIds()) {
      const node = this._getNodeSnapshot(id);
      if (node && isRoot(id, node)) visit(id);
    }
    for (const id in this._newNodes) {
      const node = this._newNodes[id];
      if (node && isRoot(id, node)) visit(id);
    }
    while (queue.length) {
      const node = this._getNodeSnapshot(queue.pop()!)!;
      for (const { id } of iterRefs(node.outbound, node.parameterized)) visit(id);
    }
    return marked;
  }

  /** The node and every node that (directly or indirectly) references it. */
  private _referrersOf(nodeId: NodeId): NodeId[] {
    const found = [nodeId];
    const seen = new Set(found);
    for (let i = 0; i < found.length; i++) {
      for (const { id } of this._getNodeSnapshot(found[i])?.inbound?.values() ?? []) {
        if (!seen.has(id) && this._getNodeSnapshot(id)) {
          seen.add(id);
          found.push(id);
        }
      }
    }
    return found;
  }

  /**
   * Retrieve the _latest_ version of a node snapshot.
   */
  private _getNodeSnapshot(id: NodeId) {
    return id in this._newNodes ? this._newNodes[id] : this._parent.getNodeSnapshot(id);
  }

  /**
   * Retrieve the _latest_ version of a node.
   */
  private _getNodeData(id: NodeId) {
    const snapshot = this._getNodeSnapshot(id);
    return snapshot ? snapshot.data : undefined;
  }

  /**
   * Set `newValue` at `path` of the value snapshot identified by `id`, without
   * modifying the parent's copy of it.
   *
   * This will not shallow clone objects/arrays along `path` if they were
   * previously cloned during this transaction.
   */
  private _setValue(id: NodeId, path: PathPart[], newValue: any, isEdit = true, isDelete?: boolean) {
    if (isEdit) {
      this._editedNodeIds.add(id);
    }

    const parent = this._parent.getNodeSnapshot(id);
    const current = this._ensureNewSnapshot(id);
    current.data = lazyImmutableDeepSet(current.data, parent && parent.data, path, newValue, isDelete);
  }

  /**
   * Ensures that we have built a new version of a snapshot for node `id` (and
   * that it is referenced by `_newNodes`).
   */
  private _ensureNewSnapshot(id: NodeId): NodeSnapshot {
    let parent;
    if (id in this._newNodes) {
      const existing = this._newNodes[id];
      if (existing) return existing;
      // The node was deleted earlier in this edit (e.g. when replaying
      // optimistic updates), so it is written anew.
    } else {
      parent = this._parent.getNodeSnapshot(id);
    }

    // TODO: We're assuming that the only time we call _ensureNewSnapshot when
    // there is no parent is when the node is an entity.  Can we enforce it, or
    // pass a type through?
    const newSnapshot = parent ? cloneNodeSnapshot(parent) : new EntitySnapshot();
    this._newNodes[id] = newSnapshot;
    return newSnapshot;
  }

  /**
   * Ensures that there is a ParameterizedValueSnapshot for the given node with
   * arguments
   */
  private _ensureParameterizedValueSnapshot(containerId: NodeId, path: PathPart[], storeKey: string) {
    const fieldId = nodeIdForStoreKey(containerId, path, storeKey);

    // We're careful to not edit the container unless we absolutely have to.
    // (There may be no changes for this parameterized value).
    const containerSnapshot = this._getNodeSnapshot(containerId);
    if (!containerSnapshot || !hasParameterizedReference(containerSnapshot, fieldId, path)) {
      // We need to construct a new snapshot otherwise.
      const newSnapshot = new ParameterizedValueSnapshot();
      addInboundReference(newSnapshot, containerId, path);
      this._newNodes[fieldId] = newSnapshot;

      // Ensure that the container points to it.
      const snapshot = this._ensureNewSnapshot(containerId);
      addParameterizedReference(snapshot, fieldId, path);
    }

    return fieldId;
  }
}

/**
 * Generate a stable id for a parameterized value.
 */
export function nodeIdForParameterizedValue(containerId: NodeId, path: PathPart[], args?: JsonObject) {
  return nodeIdForStoreKey(containerId, path, args ? argsStoreKey(args) : JSON.stringify(args));
}

/**
 * The id of the parameterized value node holding the field at `path` within
 * the container, stored under `storeKey` (see StoreKey): the JSON of its
 * arguments, or its keyArgs-derived store field name.
 */
export function nodeIdForStoreKey(containerId: NodeId, path: PathPart[], storeKey: string) {
  return `${containerId}❖${JSON.stringify(path)}❖${storeKey}`;
}
