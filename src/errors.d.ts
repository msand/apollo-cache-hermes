import * as makeError from 'make-error';
import { PathPart } from './primitive';
import { NodeId } from './schema';
export interface ErrorDetails {
    message: string;
    infoUrl?: string;
}
export type MessageOrDetails = string | ErrorDetails;
/**
 * Base error class for all errors emitted by the cache.
 *
 * Note that we rely on make-error so that we can safely extend the built in
 * Error in a cross-platform manner.
 */
export declare class HermesCacheError extends makeError.BaseError {
    constructor(messageOrDetails: MessageOrDetails);
}
/**
 * The current runtime environment isn't suited to run Hermes.
 */
export declare class InvalidEnvironmentError extends HermesCacheError {
}
/**
 * An error with a query - generally occurs when parsing an error.
 */
export declare class QueryError extends HermesCacheError {
    readonly path: string[];
    constructor(messageOrDetails: MessageOrDetails, path: string[]);
}
/**
 * An error with a read query - generally occurs when data in cache is partial
 * or missing.
 */
export declare class UnsatisfiedCacheError extends HermesCacheError {
}
/**
 * An error thrown when multiple fields within a query disagree about what they
 * are selecting.
 */
export declare class ConflictingFieldsError extends QueryError {
    readonly path: string[];
    readonly fields: any[];
    constructor(messageOrDetails: MessageOrDetails, path: string[], fields: any[]);
}
/**
 * An error occurring during a cache operation, associated with a location in
 * the cache.
 */
export declare class OperationError extends HermesCacheError {
    readonly prefixPath: PathPart[];
    readonly nodeId: NodeId;
    readonly path: PathPart[];
    readonly value?: any | undefined;
    constructor(messageOrDetails: MessageOrDetails, prefixPath: PathPart[], nodeId: NodeId, path: PathPart[], value?: any | undefined);
}
/**
 * An error occurring while processing a payload for a write operation.
 */
export declare class InvalidPayloadError extends OperationError {
}
/**
 * An error occurring as the result of a cache bug.
 */
export declare class CacheConsistencyError extends OperationError {
    readonly prefixPath: PathPart[];
    readonly nodeId: NodeId;
    readonly path: PathPart[];
    readonly value?: any | undefined;
    constructor(messageOrDetails: MessageOrDetails, prefixPath: PathPart[], nodeId: NodeId, path: PathPart[], value?: any | undefined);
}
//# sourceMappingURL=errors.d.ts.map