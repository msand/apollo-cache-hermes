import { Reference } from '@apollo/client/utilities';
import { NodeReference, NodeSnapshot } from '../nodes';
import { JsonObject, PathPart } from '../primitive';
import { NodeId } from '../schema';
/**
 * Mutates a snapshot, removing a reference from it.
 */
export declare function removeInboundReference(snapshot: NodeSnapshot, id: NodeId, path: PathPart[]): void;
export declare function removeOutboundReference(snapshot: NodeSnapshot, path: PathPart[]): void;
export declare function removeParameterizedReference(snapshot: NodeSnapshot, id: NodeId, path: PathPart[]): void;
/**
 * Mutates a snapshot, adding a new reference to it.
 */
export declare function addInboundReference(snapshot: NodeSnapshot, id: NodeId, path: PathPart[]): void;
export declare function addOutboundReference(snapshot: NodeSnapshot, id: NodeId, path: PathPart[]): void;
export declare function addParameterizedReference(snapshot: NodeSnapshot, id: NodeId, path: PathPart[]): void;
/**
 * Return true if { id, path } is a valid reference in the node's references
 * array. Otherwise, return false.
 */
export declare function hasParameterizedReference(snapshot: NodeSnapshot, id: NodeId, path: PathPart[]): boolean;
/**
 * Return index of { id, path } reference in references array.
 * Otherwise, return -1.
 */
export declare function getIndexOfGivenReference(references: NodeReference[], id: NodeId, path: PathPart[]): number;
export declare function safeStringify(value: JsonObject): string;
export declare function refToInKey({ id, path }: NodeReference): string;
export declare function toInKey(id: NodeId, path: PathPart[]): string;
export declare function toOutKey(path: PathPart[]): string;
export declare function toParamKey(path: PathPart[]): string;
export declare function getInbound(inbound: NodeReference[] | undefined): Map<string, NodeReference> | undefined;
export declare function getOutbound(outbound: Iterable<NodeReference> | undefined): Map<string, NodeReference> | undefined;
declare function setParameterized(map: Map<string, NodeReference[]>, node: NodeReference): void;
export declare const set: typeof setParameterized;
export declare function getParameterized(parameterized: Iterable<NodeReference> | undefined): Map<string, NodeReference[]> | undefined;
export declare function iterParameterized(parameterized: Map<string, NodeReference[]> | undefined): Generator<NodeReference, void, unknown>;
export declare function iterRefs(outbound: Map<string, NodeReference> | undefined, parameterized: Map<string, NodeReference[]> | undefined): Generator<NodeReference>;
export declare function isReference(obj: any): obj is Reference;
export {};
//# sourceMappingURL=references.d.ts.map