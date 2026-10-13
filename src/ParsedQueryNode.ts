import isEqual from '@wry/equality';
import type { DirectiveNode, FieldNode, FragmentSpreadNode } from 'graphql';

import { CacheContext } from './context';
import { ConflictingFieldsError } from './errors';
import { DeepReadonly, JsonScalar, JsonObject, JsonValue, NestedObject, NestedValue } from './primitive';
import {
  ArgumentNode,
  FragmentMap,
  SelectionNode,
  SelectionSetNode,
  ValueNode,
  isObject,
  fieldHasStaticDirective,
  valueFromNode,
} from './util';

export type JsonAndVariables = JsonScalar | VariableArgument;
export type FieldArguments<TArgTypes = JsonScalar> = NestedObject<TArgTypes>;

/**
 * The GraphQL AST is parsed down into a simple tree containing all information
 * the cache requires to read/write associated payloads.
 *
 * A parsed query has no notion of fragments, or other such redirections; they
 * are flattened into query nodes when parsed.  Fields that are only selected
 * through fragments with type conditions (or through @skip/@include directives
 * that depend on variables) record those as `conditions`.
 */
export class ParsedQueryNode<TArgTypes = JsonScalar> {
  constructor(
    /** Any child fields. */
    public children?: ParsedQueryNodeMap<TArgTypes>,
    /**
     * The name of the field (as defined by the schema).
     *
     * Omitted by default (can be inferred by its key in a node map), unless
     * the field is aliased.
     */
    public schemaName?: string,
    /** The map of the field's arguments and their values, if parameterized. */
    public args?: NestedObject<TArgTypes>,
    /**
     * Whether a (transitive) child contains arguments.  This allows us to
     * ignore whole subtrees in some situations if they were completely static.
     * */
    public hasParameterizedChildren?: true,
    public propMap?: {
      [key: string]: string;
    },
    /**
     * The alternative conditions under which the field is selected (any one of
     * them suffices).  Omitted when the field is selected unconditionally.
     */
    public conditions?: readonly SelectionCondition[],
  ) {}
}

/** The (first) field node that selects each parsed field. */
const fieldNodes = new WeakMap<object, FieldNode>();

/**
 * The (first) field node that selects a parsed field, for the `field` option
 * of read and merge functions.  (Kept apart from the node's structure, which
 * is compared and frozen.)
 */
export function fieldNodeOf(node: object): FieldNode | undefined {
  return fieldNodes.get(node);
}

/** Records the field node that selects a parsed field (see fieldNodeOf). */
function _withField<TArgTypes>(node: ParsedQueryNode<TArgTypes>, field: FieldNode | undefined) {
  if (field) {
    fieldNodes.set(node, field);
    if (node.children && field.selectionSet) selectionSets.set(node.children, field.selectionSet);
  }
  return node;
}

/** The (first) selection set each parsed node map was parsed from. */
const selectionSets = new WeakMap<object, SelectionSetNode>();

/**
 * The (first) selection set a parsed node map (the children of a field, or a
 * parsed operation) was parsed from, for the selectionSet option of keyFields
 * functions.
 */
export function selectionSetOf(parsed: object): SelectionSetNode | undefined {
  return selectionSets.get(parsed);
}

/** Records the selection set a parsed operation was parsed from (see selectionSetOf). */
export function setSelectionSetOf(parsed: object, selectionSet: SelectionSetNode) {
  selectionSets.set(parsed, selectionSet);
}

/**
 * A condition under which a field is selected: the field was selected through
 * fragments with the given type conditions (which must all match the
 * containing object's __typename), and through @skip/@include directives that
 * depend on the given variables (which must all pass).
 *
 * Directive conditions are resolved by `expandVariables`; type conditions are
 * checked against values when reading/writing.
 */
export interface SelectionCondition {
  readonly typeConditions?: readonly string[];
  readonly directives?: readonly InclusionDirective[];
}

/**
 * A @skip(if: $variable) or @include(if: $variable) directive.
 */
export interface InclusionDirective {
  readonly variable: string;
  /** Whether the field is included when the variable is truthy (@include). */
  readonly include: boolean;
}

/**
 * A ParsedQueryNode that is known to have arguments.
 */
export interface ParsedQueryNodeWithArgs<TArgTypes = JsonScalar> extends ParsedQueryNode<TArgTypes> {
  args: NestedObject<TArgTypes>;
}

/**
 * Child nodes are expressed as a map of field names (as defined by the query)
 * mapped to their metadata.
 */
export interface ParsedQueryNodeMap<TArgTypes> {
  [key: string]: ParsedQueryNode<TArgTypes>;
}

/**
 * A parsed query is simply a map of top level fields and their descendants.
 */
export interface ParsedQuery<TArgTypes = JsonScalar> extends ParsedQueryNodeMap<TArgTypes> {}

/**
 * When we first parse a query, VariableArgument placeholders can exist in node
 * args.
 *
 * Queries given to the cache to read/write payloads must have values
 * substituted for any VariableArguments in the parsed query (and are a plain
 * ParsedQueryNode).
 */
export interface ParsedQueryWithVariables extends ParsedQuery<JsonAndVariables> {}

/**
 * Represents the location a variable should be used as an argument to a
 * parameterized field.
 *
 * Note that variables can occur _anywhere_ within an argument, not just at the
 * top level.
 */
export class VariableArgument {
  constructor(
    /** The name of the variable. */
    public readonly name: string,
  ) {}
}

/**
 * Parsed a GraphQL AST selection into a tree of ParsedQueryNode instances.
 */
export function parseQuery<TSerialized>(
  context: CacheContext<TSerialized>,
  fragments: FragmentMap,
  selectionSet: SelectionSetNode,
): {
  parsedQuery: DeepReadonly<ParsedQueryWithVariables>;
  variables: Set<string>;
  propMap?: { [p: string]: string } | undefined;
} {
  const variables = new Set<string>();
  const propMap = Object.create(null);
  const parsedQuery = _buildNodeMap(variables, context, fragments, propMap, selectionSet);
  if (!parsedQuery) {
    throw new Error(`Parsed a query, but found no fields present; it may use unsupported GraphQL features`);
  }

  const map = unlessEmpty(propMap);
  if (map !== undefined) {
    return { parsedQuery, variables, propMap: map };
  }

  return { parsedQuery, variables };
}

function unlessEmpty(propMap: { [p: string]: string }) {
  return Object.keys(propMap).length === 0 ? undefined : propMap;
}

/**
 * Recursively builds a mapping of field names to ParsedQueryNodes for the given
 * selection set.
 *
 * `condition` is the condition under which the selection set is selected (via
 * fragments with type conditions or conditional @skip/@include directives).
 */
function _buildNodeMap<TSerialized>(
  variables: Set<string>,
  context: CacheContext<TSerialized>,
  fragments: FragmentMap,
  propMap: { [p: string]: string },
  selectionSet?: SelectionSetNode,
  path: string[] = [],
  condition?: SelectionCondition,
): ParsedQueryWithVariables | undefined {
  if (!selectionSet) return undefined;

  const nodeMap = Object.create(null);
  // Whether the selection set selects anything (even if only skipped fields).
  let hasSelections = false;
  for (const selection of selectionSet.selections) {
    _collectDirectiveVariables(variables, selection);

    // Selections that are statically skipped (e.g. @skip(if: true)) are omitted
    // entirely; those that depend on variables become conditional.
    const directives = _inclusionDirectives(selection.directives);
    if (directives === false) {
      hasSelections = true;
      continue;
    }
    const selectionCondition = directives ? _extendCondition(condition, undefined, directives) : condition;

    if (selection.kind === 'Field') {
      // The name of the field (as defined by the query).
      const name = selection.alias ? selection.alias.value : selection.name.value;
      const innerPropMap = Object.create(null);
      const children = _buildNodeMap(variables, context, fragments, innerPropMap, selection.selectionSet, [
        ...path,
        name,
      ]);

      let args, schemaName;
      // fields marked as @static are treated as if they are a static field in
      // the schema.  E.g. parameters are ignored, and an alias is considered
      // to be truth.
      if (!fieldHasStaticDirective(selection)) {
        args = _buildFieldArgs(variables, selection.arguments);
        schemaName = selection.alias ? selection.name.value : undefined;
        if (schemaName !== undefined) {
          propMap[schemaName] = name;
        }
      }

      const hasParameterizedChildren = areChildrenDynamic(children);

      const node = _withField(
        new ParsedQueryNode(
          children,
          schemaName,
          args,
          hasParameterizedChildren,
          unlessEmpty(innerPropMap),
          selectionCondition ? [selectionCondition] : undefined,
        ),
        selection,
      );
      nodeMap[name] = _mergeNodes([...path, name], node, nodeMap[name]);
      hasSelections = true;
    } else if (selection.kind === 'FragmentSpread' || selection.kind === 'InlineFragment') {
      const fragment = selection.kind === 'FragmentSpread' ? fragments[selection.name.value] : selection;
      if (!fragment) {
        // Same message as InMemoryCache.
        throw new Error(`No fragment named ${(selection as FragmentSpreadNode).name.value}`);
      }

      // Fields of fragments with a type condition only apply to objects whose
      // __typename matches it.
      const typeCondition = fragment.typeCondition?.name.value;
      const fragmentCondition = typeCondition
        ? _extendCondition(selectionCondition, typeCondition)
        : selectionCondition;
      const fragmentMap = _buildNodeMap(
        variables,
        context,
        fragments,
        propMap,
        fragment.selectionSet,
        path,
        fragmentCondition,
      );
      if (fragmentMap) {
        hasSelections = true;
        for (const name in fragmentMap) {
          nodeMap[name] = _mergeNodes([...path, name], fragmentMap[name], nodeMap[name]);
        }
      }
    } else if (context.tracer.warning) {
      context.tracer.warning(`${(selection as any).kind} selections are not supported; query may misbehave`);
    }
  }

  return hasSelections ? nodeMap : undefined;
}

/**
 * Returns a condition that additionally requires a type condition and/or
 * directives.
 */
function _extendCondition(
  condition: SelectionCondition | undefined,
  typeCondition?: string,
  directives?: InclusionDirective[],
): SelectionCondition {
  const extended: { typeConditions?: string[]; directives?: InclusionDirective[] } = {};
  if (condition?.typeConditions || typeCondition) {
    extended.typeConditions = [...(condition?.typeConditions ?? []), ...(typeCondition ? [typeCondition] : [])];
  }
  if (condition?.directives || directives) {
    extended.directives = [...(condition?.directives ?? []), ...(directives ?? [])];
  }
  return extended;
}

/**
 * Evaluates the @skip/@include directives of a selection, as far as possible
 * without variables.
 *
 * Returns false if the selection is statically skipped, the directives that
 * depend on variables (if any), or undefined if it is always included.
 */
function _inclusionDirectives(directives?: readonly DirectiveNode[]): InclusionDirective[] | false | undefined {
  if (!directives) return undefined;

  let inclusionDirectives: InclusionDirective[] | undefined;
  for (const directive of directives) {
    const directiveName = directive.name.value;
    if (directiveName !== 'skip' && directiveName !== 'include') continue;

    const ifArgument = directive.arguments?.find(argument => argument.name.value === 'if');
    if (!ifArgument) continue;

    const include = directiveName === 'include';
    const { value } = ifArgument;
    if (value.kind === 'Variable') {
      inclusionDirectives = inclusionDirectives ?? [];
      inclusionDirectives.push({ variable: value.name.value, include });
    } else if (value.kind === 'BooleanValue' && value.value !== include) {
      return false;
    }
  }

  return inclusionDirectives;
}

/**
 * Well, are they?
 */
export function areChildrenDynamic(children?: ParsedQueryWithVariables) {
  if (!children) return undefined;
  for (const name in children) {
    const child = children[name];
    if (child.hasParameterizedChildren) return true;
    if (child.args) return true;
    if (child.schemaName) return true; // Aliases are dynamic at read time.
    // Directive conditions are resolved per operation (see expandVariables).
    if (child.conditions?.some(condition => condition.directives)) return true;
  }
  return undefined;
}

/**
 * Build the map of arguments to their natural JS values (or variables).
 */
function _buildFieldArgs(variables: Set<string>, argumentsNode?: readonly ArgumentNode[]) {
  if (!argumentsNode) return undefined;

  const args: JsonObject = {};
  for (const arg of argumentsNode) {
    // Mapped name of argument to it JS value
    args[arg.name.value] = _valueFromNode(variables, arg.value);
  }

  return Object.keys(args).length ? args : undefined;
}

/**
 * Evaluate a ValueNode and yield its value in its natural JS form.
 */
function _valueFromNode(variables: Set<string>, node: ValueNode): JsonValue {
  return valueFromNode(node, ({ name: { value } }) => {
    variables.add(value);
    return new VariableArgument(value);
  });
}

/**
 * Collect the variables in use by any directives on the node.
 */
function _collectDirectiveVariables(variables: Set<string>, node: SelectionNode) {
  const { directives } = node;
  if (!directives) return;

  for (const directive of directives) {
    if (!directive.arguments) continue;

    for (const argument of directive.arguments) {
      valueFromNode(argument.value, ({ name: { value } }) => {
        variables.add(value);
      });
    }
  }
}

/**
 * Merges two node definitions; mutating `target` to include children from
 * `source`.
 */
function _mergeNodes<TArgTypes>(
  path: string[],
  target: ParsedQueryNode<TArgTypes>,
  source?: ParsedQueryNode<TArgTypes>,
) {
  if (!source) return target;
  if (!isEqual(target.args, source.args)) {
    throw new ConflictingFieldsError(`parameterization mismatch`, path, [target, source]);
  }
  if (target.schemaName !== source.schemaName) {
    throw new ConflictingFieldsError(`alias mismatch`, path, [target, source]);
  }
  // `source` holds the earlier selections.
  _withField(target, fieldNodeOf(source));
  // A field is selected if any of its selections apply.
  if (!target.conditions || !source.conditions) {
    target.conditions = undefined;
  } else {
    // `source` holds the earlier selections (keep them in document order).
    const sourceConditions = source.conditions;
    const newConditions = target.conditions.filter(
      condition => !sourceConditions.some(existing => isEqual(existing, condition)),
    );
    target.conditions = [...sourceConditions, ...newConditions];
  }
  if (!source.children) return target;

  if (!target.children) {
    target.children = source.children;
  } else {
    for (const name in source.children) {
      target.children[name] = _mergeNodes([...path, name], source.children[name], target.children[name]);
    }
  }

  if (source.hasParameterizedChildren && !target.hasParameterizedChildren) {
    target.hasParameterizedChildren = true;
  }

  return target;
}

/**
 * Replace all instances of VariableArgument contained within a parsed operation
 * with their actual values.
 *
 * This requires that all variables used are provided in `variables`.
 */
export function expandVariables(
  parsed: ParsedQueryWithVariables,
  variables: JsonObject | undefined,
): ParsedQuery<JsonScalar> {
  return _expandVariables(parsed, variables)!;
}

export function _expandVariables(parsed?: ParsedQueryWithVariables, variables?: JsonObject) {
  if (!parsed) return undefined;

  const newMap: ParsedQuery<JsonScalar> = {};
  for (const key in parsed) {
    const node = parsed[key];
    let conditions = node.conditions;
    if (conditions?.some(condition => condition.directives)) {
      const resolved = _resolveDirectives(conditions, variables);
      // Skipped for these variables.
      if (resolved === null) continue;
      conditions = resolved;
    }

    if (node.args || node.hasParameterizedChildren || conditions !== node.conditions) {
      newMap[key] = _withField(
        new ParsedQueryNode(
          _expandVariables(node.children, variables),
          node.schemaName,
          expandFieldArguments(node.args, variables),
          node.hasParameterizedChildren,
          node.propMap,
          conditions,
        ),
        fieldNodeOf(node),
      );
      // No variables to substitute for this subtree.
    } else {
      newMap[key] = node as ParsedQueryNode;
    }
  }

  return newMap;
}

/**
 * Evaluates the @skip/@include directives of a field's conditions.
 *
 * Returns null if the field is not selected, the remaining type conditions
 * otherwise (undefined if it is selected unconditionally).
 */
function _resolveDirectives(
  conditions: readonly SelectionCondition[],
  variables: JsonObject | undefined,
): readonly SelectionCondition[] | undefined | null {
  const resolved: SelectionCondition[] = [];
  for (const { typeConditions, directives } of conditions) {
    if (directives && !directives.every(({ variable, include }) => !!variables?.[variable] === include)) continue;
    if (!typeConditions) return undefined;
    resolved.push({ typeConditions });
  }
  return resolved.length ? resolved : null;
}

/**
 * Sub values in for any variables required by a field's args.
 */
export function expandFieldArguments(
  args: NestedValue<JsonAndVariables> | undefined,
  variables: JsonObject | undefined,
): JsonObject | undefined {
  return args ? (_expandArgument(args, variables) as JsonObject) : undefined;
}

export function _expandArgument(arg: NestedValue<JsonAndVariables>, variables: JsonObject | undefined): JsonValue {
  if (arg instanceof VariableArgument) {
    if (!variables || !(arg.name in variables)) {
      throw new Error(`Expected variable $${arg.name} to exist for query`);
    }
    return variables[arg.name];
  } else if (Array.isArray(arg)) {
    return arg.map(v => _expandArgument(v, variables));
  } else if (isObject(arg)) {
    const expanded: JsonValue = {};
    for (const key in arg) {
      expanded[key] = _expandArgument(arg[key], variables);
    }
    return expanded;
  } else {
    // TS isn't inferring that arg cannot contain any VariableArgument values.
    return arg as JsonValue;
  }
}
