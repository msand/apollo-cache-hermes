import type { ArgumentNode, DocumentNode, FieldNode, OperationDefinitionNode, OperationTypeNode, SelectionNode, SelectionSetNode, ValueNode } from 'graphql';
import { FragmentMap } from '@apollo/client/utilities';
import { JsonValue } from '../primitive';
export { ArgumentNode, DocumentNode, OperationDefinitionNode, OperationTypeNode, SelectionNode, SelectionSetNode, ValueNode, FragmentMap, };
export declare function getOperationOrDie(document: DocumentNode): OperationDefinitionNode;
/**
 * Returns the names of all variables declared by the operation.
 */
export declare function variablesInOperation(operation: OperationDefinitionNode): Set<string>;
/**
 * Returns the default values of all variables in the operation.
 */
export declare function variableDefaultsInOperation(operation: OperationDefinitionNode): {
    [Key: string]: JsonValue;
};
/**
 * Extracts fragments from `document` by name.
 */
export declare function fragmentMapForDocument(document: DocumentNode): FragmentMap;
/**
 * Returns whether a selection set is considered static from the cache's
 * perspective.
 *
 * This is helpful if you want to assert that certain fragments or queries stay
 * static within the cache (and thus, avoid read-time overhead).
 *
 * If the selectionSet contains fragments, you must provide a getter function
 * that exposes them.
 */
export declare function selectionSetIsStatic(selectionSet: SelectionSetNode, fragmentGetter?: (name: string) => SelectionSetNode | undefined): boolean;
export declare function fieldIsStatic(field: FieldNode): boolean;
export declare function fieldHasAlias(field: FieldNode): boolean;
export declare function fieldIsParameterized(field: FieldNode): boolean;
export declare function fieldHasStaticDirective({ directives }: FieldNode): boolean;
//# sourceMappingURL=ast.d.ts.map