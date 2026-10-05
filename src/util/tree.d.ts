import { ParsedQueryWithVariables } from '../ParsedQueryNode';
import { JsonObject, JsonValue, PathPart } from '../primitive';
/**
 * Returning true indicates that the walk should STOP.
 */
export type OperationVisitor = (parent: JsonValue | undefined, fields: string[], path: (string | number)[]) => boolean;
/**
 * Walk and run on ParsedQueryNode and the result.
 * This is used to verify result of the read operation.
 */
export declare function walkOperation(rootOperation: ParsedQueryWithVariables, result: JsonObject | undefined, visitor: OperationVisitor): void;
export declare function get(value: any, key: PathPart): any;
//# sourceMappingURL=tree.d.ts.map