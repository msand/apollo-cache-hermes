import { CacheContext } from '../context';
import { GraphSnapshot } from '../GraphSnapshot';
import { EntitySnapshot, NodeSnapshot, ParameterizedValueSnapshot } from '../nodes';
import { JsonValue, NestedValue } from '../primitive';
import { NodeId, Serializable, isSerializable } from '../schema';
import { iterParameterized, iterRefs, lazyImmutableDeepSet } from '../util';

/**
 * Create serializable representation of GraphSnapshot.
 *
 * The output still contains 'undefined' value as it is expected that caller
 * will perform JSON.stringify which will strip off 'undefined' value or
 * turn it into 'null' if 'undefined' is in an array.
 *
 * @throws Will throw an error if there is no corresponding node type
 */
export function extract<TSerialized>(
  graphSnapshot: GraphSnapshot,
  cacheContext: CacheContext<TSerialized>,
): Serializable.GraphSnapshot {
  let extracted = extractedSnapshots.get(graphSnapshot);
  if (!extracted) {
    const result = extractNodes(graphSnapshot, cacheContext);
    extracted = { ids: Object.keys(result), nodes: Object.values(result) };
    extractedSnapshots.set(graphSnapshot, extracted);
  }
  // (A new object each time, like InMemoryCache's.)
  const { ids, nodes } = extracted;
  const result: Serializable.GraphSnapshot = {};
  for (let i = 0; i < ids.length; i++) result[ids[i]] = nodes[i];
  return result;
}

/** The serialized nodes of each snapshot extracted (by id, in order). */
const extractedSnapshots = new WeakMap<GraphSnapshot, { ids: string[]; nodes: Serializable.NodeSnapshot[] }>();

function extractNodes<TSerialized>(
  graphSnapshot: GraphSnapshot,
  cacheContext: CacheContext<TSerialized>,
): Serializable.GraphSnapshot {
  const result: Serializable.GraphSnapshot = {};
  const entities = graphSnapshot._values;
  // We don't need to check for hasOwnProperty because data._values is
  // created with prototype of 'null'
  for (const id in entities) {
    const nodeSnapshot = entities[id];
    const targets = targetKinds(graphSnapshot, nodeSnapshot);
    const known = extractedNodes.get(nodeSnapshot);
    if (known && sameTargets(known.targets, targets)) {
      result[id] = known.serialized;
      continue;
    }
    const { outbound, inbound, parameterized } = nodeSnapshot;

    let type: Serializable.NodeSnapshotType;
    if (nodeSnapshot instanceof EntitySnapshot) {
      type = Serializable.NodeSnapshotType.EntitySnapshot;
    } else if (nodeSnapshot instanceof ParameterizedValueSnapshot) {
      type = Serializable.NodeSnapshotType.ParameterizedValueSnapshot;
    } else {
      throw new Error(
        `${nodeSnapshot.constructor.name} does not have corresponding enum value in Serializable.NodeSnapshotType`,
      );
    }

    const serializedEntity: Serializable.NodeSnapshot = { type };

    if (parameterized) {
      serializedEntity.parameterized = Array.from(iterParameterized(parameterized));
    }

    if (outbound) {
      serializedEntity.outbound = Array.from(outbound.values());
    }

    if (inbound) {
      serializedEntity.inbound = Array.from(inbound.values());
    }

    // Extract data value
    const extractedData = extractSerializableData(graphSnapshot, nodeSnapshot);
    if (extractedData !== undefined) {
      if (cacheContext.tracer.warning) {
        try {
          if (!isSerializable(extractedData, /* allowUndefined */ true)) {
            cacheContext.tracer.warning(`Data at entityID ${id} is unserializable`);
          }
        } catch (error) {
          cacheContext.tracer.warning(`Data at entityID ${id} is unserializable because of stack overflow`);
          if (error instanceof Error) {
            cacheContext.tracer.warning(error.toString());
          } else {
            cacheContext.tracer.warning('unknown error');
          }
        }
      }
      serializedEntity.data = extractedData;
    }

    result[id] = serializedEntity;
    extractedNodes.set(nodeSnapshot, { serialized: serializedEntity, targets });
  }

  return result;
}

/**
 * The serialized form of each node snapshot extracted, and the kinds of the
 * nodes it referenced then (see targetKinds): the node snapshots are
 * immutable, so it holds for as long as those don't change. (Like
 * InMemoryCache's extract(), extracts therefore share their entities' objects.)
 */
const extractedNodes = new WeakMap<NodeSnapshot, { serialized: Serializable.NodeSnapshot; targets: TargetKind[] }>();

/** What a reference's target is: an entity, another node, or missing (a dangling reference). */
const enum TargetKind {
  Missing,
  Entity,
  Other,
}

/** The kinds of the nodes a node references, which its serialized data depends on. */
function targetKinds(graphSnapshot: GraphSnapshot, nodeSnapshot: NodeSnapshot): TargetKind[] {
  const kinds: TargetKind[] = [];
  const kindOf = (reference: { id: NodeId }) => {
    const target = graphSnapshot.getNodeSnapshot(reference.id);
    kinds.push(target instanceof EntitySnapshot ? TargetKind.Entity : target ? TargetKind.Other : TargetKind.Missing);
  };
  // (In the order of iterRefs.)
  nodeSnapshot.parameterized?.forEach(references => references.forEach(kindOf));
  nodeSnapshot.outbound?.forEach(kindOf);
  return kinds;
}

function sameTargets(a: TargetKind[], b: TargetKind[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function extractSerializableData(
  graphSnapshot: GraphSnapshot,
  nodeSnapshot: NodeSnapshot,
): NestedValue<JsonValue | undefined> {
  // If there is no outbound, then data is a value
  // 'data' can also be undefined or null even though there exist an
  // outbound reference (e.g referencing ParameterizedValueSnapshot).
  // We can simply skip extraction of such data.
  if (!nodeSnapshot.outbound || !nodeSnapshot.data) {
    // A node that is a dangling reference (to a deleted entity) is serialized like a reference.
    const reference = nodeSnapshot.outbound?.get('');
    if (nodeSnapshot.data === undefined && reference && !graphSnapshot.getNodeSnapshot(reference.id)) {
      return null;
    }
    return nodeSnapshot.data;
  }

  // Type annotation is needed otherwise type of entity.data is not nullable
  // and so does extractedData which will cause an error when we assing 'null'.
  let extractedData: JsonValue | null = nodeSnapshot.data;

  // Set all the outbound path (e.g reference) to undefined.
  for (const outbound of iterRefs(nodeSnapshot.outbound, nodeSnapshot.parameterized)) {
    // Only reference to EntitySnapshot is recorded in the data property
    // So we didn't end up set the value to be 'undefined' in the output
    // in every case
    // A dangling reference (to a deleted entity) is serialized as a reference, too.
    const target = graphSnapshot.getNodeSnapshot(outbound.id);
    if (
      target instanceof EntitySnapshot ||
      (!target && nodeSnapshot.outbound.get(outbound.path.join('.')) === outbound)
    ) {
      // we have to write out 'null' here to differentiate between
      // data doesn't exist and data is a reference.
      //
      // In the case of parameterized field hanging off of a root
      // the data at the ROOTQUERY node will be undefined with outbound
      // reference to the parameterized node.
      extractedData = lazyImmutableDeepSet(
        extractedData,
        nodeSnapshot.data,
        outbound.path,
        outbound.path.length === 0 ? null : undefined,
      );
    }
  }

  return extractedData;
}
