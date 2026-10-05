"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheConsistencyError = exports.InvalidPayloadError = exports.OperationError = exports.ConflictingFieldsError = exports.UnsatisfiedCacheError = exports.QueryError = exports.InvalidEnvironmentError = exports.HermesCacheError = void 0;
const tslib_1 = require("tslib");
const makeError = tslib_1.__importStar(require("make-error"));
function _toDetails(messageOrDetails) {
    if (typeof messageOrDetails === 'object')
        return messageOrDetails;
    return { message: messageOrDetails };
}
function _expandMessage(messageOrDetails, template) {
    const _a = _toDetails(messageOrDetails), { message } = _a, details = tslib_1.__rest(_a, ["message"]);
    return Object.assign(Object.assign({}, details), { message: template.replace('{{message}}', message) });
}
/**
 * Base error class for all errors emitted by the cache.
 *
 * Note that we rely on make-error so that we can safely extend the built in
 * Error in a cross-platform manner.
 */
class HermesCacheError extends makeError.BaseError {
    constructor(messageOrDetails) {
        const { message, infoUrl } = _toDetails(messageOrDetails);
        super(infoUrl ? `[${infoUrl}] ${message}` : message);
    }
}
exports.HermesCacheError = HermesCacheError;
/**
 * The current runtime environment isn't suited to run Hermes.
 */
class InvalidEnvironmentError extends HermesCacheError {
}
exports.InvalidEnvironmentError = InvalidEnvironmentError;
/**
 * An error with a query - generally occurs when parsing an error.
 */
class QueryError extends HermesCacheError {
    constructor(messageOrDetails, 
    // The path within the query where the error occurred.
    path) {
        super(_expandMessage(messageOrDetails, `{{message}} at ${prettyPath(path)}`));
        this.path = path;
    }
}
exports.QueryError = QueryError;
/**
 * An error with a read query - generally occurs when data in cache is partial
 * or missing.
 */
class UnsatisfiedCacheError extends HermesCacheError {
}
exports.UnsatisfiedCacheError = UnsatisfiedCacheError;
/**
 * An error thrown when multiple fields within a query disagree about what they
 * are selecting.
 */
class ConflictingFieldsError extends QueryError {
    constructor(messageOrDetails, 
    // The path within the query where the error occurred.
    path, 
    // The fields that are conflicting
    fields) {
        super(_expandMessage(messageOrDetails, `Conflicting field definitions: {{message}}`), path);
        this.path = path;
        this.fields = fields;
    }
}
exports.ConflictingFieldsError = ConflictingFieldsError;
/**
 * An error occurring during a cache operation, associated with a location in
 * the cache.
 */
class OperationError extends HermesCacheError {
    constructor(messageOrDetails, 
    // The path from the payload root to the node containing the error.
    prefixPath, 
    // The node id being processed when the error occurred.
    nodeId, 
    // The path within the node where the error occurred.
    path, 
    // A value associated with the error.
    value) {
        super(_expandMessage(messageOrDetails, `{{message}} at ${prettyPath([...prefixPath, ...path])} (node ${nodeId})`));
        this.prefixPath = prefixPath;
        this.nodeId = nodeId;
        this.path = path;
        this.value = value;
    }
}
exports.OperationError = OperationError;
/**
 * An error occurring while processing a payload for a write operation.
 */
class InvalidPayloadError extends OperationError {
}
exports.InvalidPayloadError = InvalidPayloadError;
/**
 * An error occurring as the result of a cache bug.
 */
class CacheConsistencyError extends OperationError {
    constructor(messageOrDetails, 
    // The path from the payload root to the node containing the error.
    prefixPath, 
    // The node id being processed when the error occurred.
    nodeId, 
    // The path within the node where the error occurred.
    path, 
    // A value that is the subject of the error
    value) {
        super(_expandMessage(messageOrDetails, `Hermes BUG: {{message}}`), prefixPath, nodeId, path);
        this.prefixPath = prefixPath;
        this.nodeId = nodeId;
        this.path = path;
        this.value = value;
    }
}
exports.CacheConsistencyError = CacheConsistencyError;
/**
 * Renders a path as a pretty string.
 */
function prettyPath(path) {
    return path.length ? path.join('.') : '[]';
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXJyb3JzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZXJyb3JzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7QUFBQSw4REFBd0M7QUFXeEMsU0FBUyxVQUFVLENBQUMsZ0JBQWtDO0lBQ3BELElBQUksT0FBTyxnQkFBZ0IsS0FBSyxRQUFRO1FBQUUsT0FBTyxnQkFBZ0IsQ0FBQztJQUNsRSxPQUFPLEVBQUUsT0FBTyxFQUFFLGdCQUFnQixFQUFFLENBQUM7QUFDdkMsQ0FBQztBQUVELFNBQVMsY0FBYyxDQUFDLGdCQUFrQyxFQUFFLFFBQWdCO0lBQzFFLE1BQU0sS0FBMEIsVUFBVSxDQUFDLGdCQUFnQixDQUFDLEVBQXRELEVBQUUsT0FBTyxPQUE2QyxFQUF4QyxPQUFPLHNCQUFyQixXQUF1QixDQUErQixDQUFDO0lBQzdELHVDQUNLLE9BQU8sS0FDVixPQUFPLEVBQUUsUUFBUSxDQUFDLE9BQU8sQ0FBQyxhQUFhLEVBQUUsT0FBTyxDQUFDLElBQ2pEO0FBQ0osQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsTUFBYSxnQkFBaUIsU0FBUSxTQUFTLENBQUMsU0FBUztJQUN2RCxZQUFZLGdCQUFrQztRQUM1QyxNQUFNLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxHQUFHLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBQzFELEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksT0FBTyxLQUFLLE9BQU8sRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUN2RCxDQUFDO0NBQ0Y7QUFMRCw0Q0FLQztBQUVEOztHQUVHO0FBQ0gsTUFBYSx1QkFBd0IsU0FBUSxnQkFBZ0I7Q0FBRztBQUFoRSwwREFBZ0U7QUFFaEU7O0dBRUc7QUFDSCxNQUFhLFVBQVcsU0FBUSxnQkFBZ0I7SUFDOUMsWUFDRSxnQkFBa0M7SUFDbEMsc0RBQXNEO0lBQ3RDLElBQWM7UUFFOUIsS0FBSyxDQUFDLGNBQWMsQ0FBQyxnQkFBZ0IsRUFBRSxrQkFBa0IsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBRjlELFNBQUksR0FBSixJQUFJLENBQVU7SUFHaEMsQ0FBQztDQUNGO0FBUkQsZ0NBUUM7QUFFRDs7O0dBR0c7QUFDSCxNQUFhLHFCQUFzQixTQUFRLGdCQUFnQjtDQUFHO0FBQTlELHNEQUE4RDtBQUU5RDs7O0dBR0c7QUFDSCxNQUFhLHNCQUF1QixTQUFRLFVBQVU7SUFDcEQsWUFDRSxnQkFBa0M7SUFDbEMsc0RBQXNEO0lBQ3RDLElBQWM7SUFDOUIsa0NBQWtDO0lBQ2xCLE1BQWE7UUFFN0IsS0FBSyxDQUFDLGNBQWMsQ0FBQyxnQkFBZ0IsRUFBRSw0Q0FBNEMsQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBSjVFLFNBQUksR0FBSixJQUFJLENBQVU7UUFFZCxXQUFNLEdBQU4sTUFBTSxDQUFPO0lBRy9CLENBQUM7Q0FDRjtBQVZELHdEQVVDO0FBRUQ7OztHQUdHO0FBQ0gsTUFBYSxjQUFlLFNBQVEsZ0JBQWdCO0lBQ2xELFlBQ0UsZ0JBQWtDO0lBQ2xDLG1FQUFtRTtJQUNuRCxVQUFzQjtJQUN0Qyx1REFBdUQ7SUFDdkMsTUFBYztJQUM5QixxREFBcUQ7SUFDckMsSUFBZ0I7SUFDaEMscUNBQXFDO0lBQ3JCLEtBQVc7UUFFM0IsS0FBSyxDQUFDLGNBQWMsQ0FBQyxnQkFBZ0IsRUFBRSxrQkFBa0IsVUFBVSxDQUFDLENBQUMsR0FBRyxVQUFVLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQyxVQUFVLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQztRQVJuRyxlQUFVLEdBQVYsVUFBVSxDQUFZO1FBRXRCLFdBQU0sR0FBTixNQUFNLENBQVE7UUFFZCxTQUFJLEdBQUosSUFBSSxDQUFZO1FBRWhCLFVBQUssR0FBTCxLQUFLLENBQU07SUFHN0IsQ0FBQztDQUNGO0FBZEQsd0NBY0M7QUFFRDs7R0FFRztBQUNILE1BQWEsbUJBQW9CLFNBQVEsY0FBYztDQUFHO0FBQTFELGtEQUEwRDtBQUUxRDs7R0FFRztBQUNILE1BQWEscUJBQXNCLFNBQVEsY0FBYztJQUN2RCxZQUNFLGdCQUFrQztJQUNsQyxtRUFBbUU7SUFDbkQsVUFBc0I7SUFDdEMsdURBQXVEO0lBQ3ZDLE1BQWM7SUFDOUIscURBQXFEO0lBQ3JDLElBQWdCO0lBQ2hDLDJDQUEyQztJQUMzQixLQUFXO1FBRTNCLEtBQUssQ0FBQyxjQUFjLENBQUMsZ0JBQWdCLEVBQUUseUJBQXlCLENBQUMsRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBUjdFLGVBQVUsR0FBVixVQUFVLENBQVk7UUFFdEIsV0FBTSxHQUFOLE1BQU0sQ0FBUTtRQUVkLFNBQUksR0FBSixJQUFJLENBQVk7UUFFaEIsVUFBSyxHQUFMLEtBQUssQ0FBTTtJQUc3QixDQUFDO0NBQ0Y7QUFkRCxzREFjQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxVQUFVLENBQUMsSUFBZ0I7SUFDbEMsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7QUFDN0MsQ0FBQyJ9