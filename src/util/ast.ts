// We only depend on graphql for its types; nothing at runtime.
import type {
  ArgumentNode,
  DocumentNode,
  FieldNode,
  OperationDefinitionNode,
  OperationTypeNode,
  SelectionNode,
  SelectionSetNode,
  ValueNode,
} from 'graphql';
import { addTypenameToDocument } from '@apollo/client/utilities';
import { createFragmentMap, getFragmentDefinitions, getOperationDefinition } from '@apollo/client/utilities/internal';
import type { FragmentMap } from '@apollo/client/utilities/internal';
import { invariant } from '@apollo/client/utilities/invariant';

import { JsonValue } from '../primitive';

import { isObject } from './primitive';
import { valueFromNode } from './store';

// AST types for convenience.
export {
  ArgumentNode,
  DocumentNode,
  OperationDefinitionNode,
  OperationTypeNode,
  SelectionNode,
  SelectionSetNode,
  ValueNode,
  FragmentMap,
};

export function getOperationOrDie(document: DocumentNode): OperationDefinitionNode {
  const def = getOperationDefinition(document);
  invariant(def, `GraphQL document is missing an operation`);
  return def as OperationDefinitionNode;
}

/**
 * Returns the default values of the variables in the operation that declare
 * one.
 *
 * Like InMemoryCache (getDefaultValues), variables declared without a default
 * value have none: unless passed, they are undefined (and so are left out of
 * store field names), not null.
 */
export function variableDefaultsInOperation(operation: OperationDefinitionNode): { [Key: string]: JsonValue } {
  const defaults: { [Key: string]: JsonValue } = {};
  if (operation.variableDefinitions) {
    for (const definition of operation.variableDefinitions) {
      const { defaultValue } = definition;
      if (!isObject(defaultValue)) continue;
      defaults[definition.variable.name.value] = valueFromNode(defaultValue as ValueNode);
    }
  }

  return defaults;
}

/**
 * Extracts fragments from `document` by name.
 */
export function fragmentMapForDocument(document: DocumentNode): FragmentMap {
  return createFragmentMap(getFragmentDefinitions(document));
}

/**
 * Calls `callback` for each selection that the selection sets make for the
 * same object: their own selections, and those of their fragments (whether or
 * not their type conditions or @skip/@include directives apply), visiting each
 * selection set once. (It does not descend into fields' selection sets.)
 *
 * Stops when `callback` returns true, and returns whether it did.
 */
export function someSelection(
  selectionSets: Iterable<SelectionSetNode>,
  getFragment: (name: string) => SelectionSetNode | undefined,
  callback: (selection: SelectionNode) => boolean | void,
): boolean {
  const visited = new Set<SelectionSetNode>();
  const visit = (selectionSet: SelectionSetNode): boolean => {
    if (visited.has(selectionSet)) return false;
    visited.add(selectionSet);
    for (const selection of selectionSet.selections) {
      if (callback(selection)) return true;
      if (selection.kind === 'Field') continue;
      const fragment = selection.kind === 'InlineFragment' ? selection.selectionSet : getFragment(selection.name.value);
      if (fragment && visit(fragment)) return true;
    }
    return false;
  };
  for (const selectionSet of selectionSets) {
    if (visit(selectionSet)) return true;
  }
  return false;
}

/**
 * Whether the caller's document selects a field itself: any field but the
 * __typename fields that Hermes added with addTypenameToDocument. (Those added
 * before the document reached Hermes count when `pretransformed`.)
 */
export function isSelectedByCaller(field: FieldNode, pretransformed = false): boolean {
  return pretransformed || !addTypenameToDocument.added(field);
}

/**
 * Returns whether a selection set is considered static from the cache's
 * perspective.
 *
 * This is helpful if you want to assert that certain fragments or queries stay
 * static within the cache (and thus, avoid read-time overhead).
 *
 * Like the cache's reads, fields that are aliased or parameterized (unless
 * marked @static), and selections whose @skip/@include directives depend on
 * variables, are not static. (Field policies, if a cache has any, make every
 * read dynamic.)
 *
 * If the selectionSet contains fragments, you must provide a getter function
 * that exposes them.
 */
export function selectionSetIsStatic(
  selectionSet: SelectionSetNode,
  fragmentGetter?: (name: string) => SelectionSetNode | undefined,
): boolean {
  const getFragment = (name: string) => {
    if (!fragmentGetter) {
      throw new Error(`fragmentGetter is required for selection sets with ...fragments`);
    }
    const fragmentSet = fragmentGetter(name);
    if (!fragmentSet) {
      throw new Error(`Unknown fragment ${name} in isSelectionSetStatic`);
    }
    return fragmentSet;
  };
  const isStatic = (selections: SelectionSetNode): boolean =>
    !someSelection([selections], getFragment, selection => {
      if (hasVariableInclusionDirective(selection)) return true;
      if (selection.kind !== 'Field') return false;
      return !fieldIsStatic(selection) || (!!selection.selectionSet && !isStatic(selection.selectionSet));
    });
  return isStatic(selectionSet);
}

/** Whether a selection has a @skip or @include directive whose condition is a variable. */
function hasVariableInclusionDirective({ directives }: SelectionNode): boolean {
  return !!directives?.some(
    ({ name, arguments: args }) =>
      (name.value === 'skip' || name.value === 'include') && !!args?.some(arg => arg.value.kind === 'Variable'),
  );
}

export function fieldIsStatic(field: FieldNode) {
  const isActuallyStatic = !fieldHasAlias(field) && !fieldIsParameterized(field);
  return isActuallyStatic || fieldHasStaticDirective(field);
}

export function fieldHasAlias(field: FieldNode) {
  return !!field.alias;
}

export function fieldIsParameterized(field: FieldNode) {
  return !!(field.arguments && field.arguments.length);
}

export function fieldHasStaticDirective({ directives }: FieldNode) {
  if (!directives) return false;
  return directives.some(directive => directive.name.value === 'static');
}
