import * as equality from '@wry/equality';
import { makeReference } from '@apollo/client';
import type { TypePolicy } from '@apollo/client/cache/inmemory/policies';
import type { Reference } from '@apollo/client';
import type { StoreObject } from '@apollo/client/utilities';

import type { CacheContext } from '../context';
import type { GraphSnapshot as GraphSnapshotType } from '../GraphSnapshot';
import type { NodeReference, EntitySnapshot as EntitySnapshotType, NodeSnapshot } from '../nodes';
import type { FieldArguments, ParsedQuery } from '../ParsedQueryNode';
import type { JsonArray, JsonObject, JsonScalar, JsonValue, NestedObject, Nil, PathPart } from '../primitive';
import type { NodeId, OperationInstance, RawOperation } from '../schema';
import * as graphSnapshot from '../GraphSnapshot';
import * as schema from '../schema';
import * as errors from '../errors';
import * as nodes from '../nodes';
import * as util from '../util';

import { FieldFunctions, getFieldPolicy, storageFieldName, withReferences } from './fieldFunctions';

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
  private _fieldFunctionsInstance: FieldFunctions<TSerialized> | undefined;

  constructor(
    /** The configuration/context to use when editing snapshots. */
    private _context: CacheContext<TSerialized>,
    /** The snapshot to base edits off of. */
    private _parent: GraphSnapshotType,
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
    this._fieldFunctionsInstance = undefined;

    // We collect all warnings associated with this operation to avoid
    // overwhelming the log for particularly nasty payloads.
    const warnings: string[] = [];

    // First, we walk the payload and apply all _scalar_ edits, while collecting
    // all references that have changed.  Reference changes are applied later,
    // once all new nodes have been built (and we can guarantee that we're
    // referencing the correct version).
    const referenceEdits: ReferenceEdit[] = [];
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
    // nodes, and collects all newly orphaned nodes.
    const orphanedNodeIds = this._mergeReferenceEdits(referenceEdits);

    // Remove (garbage collect) orphaned subgraphs.
    this._removeOrphanedNodes(orphanedNodeIds);

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
    const typename =
      isRoot && path.length === 0
        ? 'Query'
        : payload && typeof payload === 'object' && '__typename' in payload
          ? payload.__typename
          : previousValue && typeof previousValue === 'object' && '__typename' in previousValue
            ? previousValue.__typename
            : undefined;
    // The type that fragments' type conditions are matched against (values
    // nested within the root are not of the Query type).
    const fragmentTypename =
      payload && typeof payload === 'object' && '__typename' in payload
        ? payload.__typename
        : isRoot && path.length === 0
          ? 'Query'
          : previousValue && typeof previousValue === 'object' && '__typename' in previousValue
            ? previousValue.__typename
            : undefined;

    const typePolicy: TypePolicy | undefined =
      typeof typename === 'string' ? this._context.typePolicies?.[typename] : undefined;
    if (typeof typePolicy?.merge === 'function') {
      payload = typePolicy.merge(previousValue, payload, {} as any) as JsonObject;
    }

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
    let payloadId =
      ref ??
      this._context.entityIdForValue(getVisibleProxy(payload, propMap)) ??
      (path.length === 0 && !isRoot ? containerId : undefined);
    const previousId =
      this._context.entityIdForValue(getVisibleProxy(previousValue, propMap)) ??
      (path.length === 0 && !isRoot
        ? containerId
        : (ifString(deepGet(this._pathToId[containerId], path)) ?? this._danglingReferenceId(containerId, path)));

    // Like InMemoryCache's mergeObjects, merge:true policies merge unidentified
    // objects and entities together.
    if (payloadId !== previousId && mode === 'merge' && !isNil(payload) && !isNil(previousValue) && !ref) {
      if (!payloadId) {
        payloadId = previousId;
      } else {
        payload = { ...(previousValue as JsonObject), ...payload };
      }
    }

    // Is this an identity change?
    if (payloadId !== previousId) {
      // Unless a merge policy replaces (or merges) the value, it is invalid to
      // transition from a *value* with an id to one without.
      const replacesEntity = !isNil(payload) && !payloadId;
      if (replacesEntity && !mode) {
        const message = `Unsupported transition from an entity to a non-entity value. ${ensureIdConstistencyMsg}`;
        throw new InvalidPayloadError(message, prefixPath, containerId, path, payload);
      }
      // The reverse is also invalid.
      if (!isNil(previousValue) && !previousId) {
        if (!mode) {
          const message = `Unsupported transition from a non-entity value to an entity. ${ensureIdConstistencyMsg}`;
          throw new InvalidPayloadError(message, prefixPath, containerId, path, payload);
        }
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

    // Unidentified objects replaced by a merge policy lose their other fields.
    const replacedValue = !payloadId && !previousId && mode === 'replace' ? previousValue : undefined;
    const writtenFields = replacedValue ? new Set<string>() : undefined;

    // If we've entered a new node; it becomes our container.
    if (payloadId) {
      prefixPath = [...prefixPath, ...path];
      containerId = payloadId;
      path = [];
    }

    // Finally, we can walk into individual values.
    for (const payloadName in parsed) {
      const node = parsed[payloadName];
      let fieldValue = deepGet(payload, [payloadName]) as JsonValue | undefined;
      // Like InMemoryCache, skip fields of fragments that don't match the type.
      if (
        node.conditions &&
        !this._context.conditionsMatch(node.conditions, fragmentTypename, fieldValue !== undefined)
      ) {
        continue;
      }
      // Having a schemaName on the node implies that payloadName is an alias.
      const schemaName = node.schemaName ? node.schemaName : payloadName;
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

      if (node.args) {
        if (fieldValue === null && prune) {
          this._setValue(containerIdForField, path, null);
          continue;
        }
        // The values of a parameterized field are explicit nodes in the graph;
        // so we set up a new container & path.
        containerIdForField = this._ensureParameterizedValueSnapshot(containerId, fieldPath, node.args);
        fieldPrefixPath = [...prefixPath, ...fieldPath];
        fieldPath = [];
      }

      // Note that we're careful to fetch the value of our new container; not
      // the outer container.
      const previousFieldValue = this._getPreviousValue(containerIdForField, fieldPath);
      writtenFields?.add(schemaName);

      // Like InMemoryCache, fall back to the merge policy of the child's type.
      const fieldPolicy = getFieldPolicy(this._context.typePolicies, typename, schemaName);
      let merge = typeof fieldPolicy === 'object' ? fieldPolicy.merge : undefined;
      if (merge === undefined && node.children && isObject(fieldValue)) {
        merge = this._context.typePolicies?.[fieldValue.__typename as string]?.merge;
      }
      let fieldMode: MergeMode | undefined = merge === true ? 'merge' : merge === false ? 'replace' : undefined;
      if (typeof merge === 'function') {
        // Like InMemoryCache, merge functions see References in place of
        // entities (which are written first), and their result replaces the
        // existing value.
        const existing = withReferences(this._getNodeSnapshot(containerIdForField), fieldPath, previousFieldValue);
        const incoming = node.children
          ? this._normalizeIncoming(
              referenceEdits,
              warnings,
              fieldPrefixPath,
              node.children,
              fieldValue,
              prune,
              node.propMap,
            )
          : fieldValue;
        const args = (node.args as JsonObject | undefined) ?? null;
        const storageKeys = [containerId, ...path, storageFieldName(schemaName, args)];
        fieldValue = merge(
          existing,
          incoming,
          this._fieldFunctions().options(undefined, schemaName, payloadName, args, storageKeys),
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
      } else if (!fieldMode && mode === 'replace' && !payloadId) {
        // Nested values of a replaced unidentified object are replaced too.
        fieldMode = 'replace';
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
          node.children,
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
      for (const payloadName of Object.keys(payload)) {
        if (!hasOwn.call(parsed, payloadName)) {
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
   */
  private _normalizeIncoming(
    referenceEdits: ReferenceEdit[],
    warnings: string[],
    prefixPath: PathPart[],
    parsed: ParsedQuery,
    value: JsonValue | undefined,
    prune: boolean,
    propMap: { [prop: string]: string } | undefined,
  ): any {
    if (Array.isArray(value)) {
      return value.map(item =>
        this._normalizeIncoming(referenceEdits, warnings, prefixPath, parsed, item, prune, propMap),
      );
    }
    if (!isObject(value) || isReference(value)) return value;

    const entityId = this._context.entityIdForValue(getVisibleProxy(value, propMap));
    if (entityId) {
      this._mergeSubgraph(referenceEdits, warnings, entityId, prefixPath, [], parsed, value, prune, propMap);
      return makeRef(entityId);
    }

    let normalized = value;
    for (const payloadName in parsed) {
      const { children, propMap: childPropMap } = parsed[payloadName];
      const child = value[payloadName];
      if (!children || child === undefined) continue;
      const normalizedChild = this._normalizeIncoming(
        referenceEdits,
        warnings,
        prefixPath,
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
      (value, mergeIntoStore) => {
        if (typeof value === 'string') return makeRef(value);
        if (isReference(value)) return value;
        const entityId = this._context.entityIdForValue(value);
        if (entityId && mergeIntoStore) this._mergeIntoEntity(entityId, value as StoreObject);
        return entityId ? makeRef(entityId) : undefined;
      },
      (ref, value) => this._mergeIntoEntity(ref.__ref, value),
    ));
  }

  /**
   * Shallowly merges `value` into the data of an entity (creating it if needed).
   */
  private _mergeIntoEntity(entityId: NodeId, value: StoreObject) {
    const data = this._getNodeData(entityId);
    this._setValue(entityId, [], { ...(isObject(data) ? data : {}), ...value });
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
    const payloadId = reference
      ? reference
      : this._context.entityIdForValue({ ...(previousValue as JsonObject), ...payload });
    const previousId = this._context.entityIdForValue(previousValue);

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
      // edits to the graph.
      if (typeof node === 'object') {
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
        const key = path.at(0);
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
   * Returns the set of node ids that are newly orphaned by these edits.
   */
  private _mergeReferenceEdits(referenceEdits: ReferenceEdit[]) {
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

    const snapshot = this._buildNewSnapshot();
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
   */
  private _removeOrphanedNodes(nodeIds: Set<NodeId>) {
    const queue = Array.from(nodeIds);
    while (queue.length) {
      const nodeId = queue.pop()!;
      const node = this._getNodeSnapshot(nodeId);
      if (!node) continue;

      this._newNodes[nodeId] = undefined;
      this._editedNodeIds.add(nodeId);

      const { outbound, parameterized } = node;
      if (outbound) {
        this.removeInbound(outbound.values(), nodeId, queue);
      }
      if (parameterized) {
        this.removeInbound(iterParameterized(parameterized), nodeId, queue);
      }
    }
  }

  private removeInbound(refs: Iterable<NodeReference>, nodeId: string, queue: string[]) {
    for (const { id, path } of refs) {
      // Dangling references have no target to update.
      if (!this._getNodeSnapshot(id)) continue;
      const reference = this._ensureNewSnapshot(id);
      removeInboundReference(reference, nodeId, path);
      if (reference.inbound === undefined) {
        queue.push(id);
      }
    }
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
  private _ensureParameterizedValueSnapshot(containerId: NodeId, path: PathPart[], args: FieldArguments) {
    const fieldId = nodeIdForParameterizedValue(containerId, path, args);

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
  return `${containerId}❖${JSON.stringify(path)}❖${JSON.stringify(args)}`;
}
