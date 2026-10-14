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
 *
 * A response key may select different fields (or the same field with different
 * arguments) under type conditions that cannot apply to the same object, e.g.
 * `... on Book { size: pages } ... on Movie { size: runtime }`: the node of the
 * key is then the first of them, with the others as its `alternatives`.
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
    /**
     * The selections of the field, by the conditions they were made under, when
     * the field is selected under several conditions with different child
     * selections (e.g. through fragments on different types).  `children` then
     * holds all of their child selections, for objects of unknown type; use
     * `childrenForType` to get those that apply to an object's __typename.
     */
    public variants?: readonly ParsedQueryVariant<TArgTypes>[],
    /**
     * The other fields selected under the same response key, under type
     * conditions disjoint from this node's (and each other's), in document
     * order.  (Alternatives have no alternatives of their own.)  Use
     * `alternativeForType` to get the one that applies to an object.
     */
    public alternatives?: readonly ParsedQueryNode<TArgTypes>[],
  ) {}
}

/**
 * The child selections a field was selected with under some conditions.
 */
export interface ParsedQueryVariant<TArgTypes = JsonScalar> {
  /** The conditions (as for ParsedQueryNode#conditions); undefined if unconditional. */
  readonly conditions?: readonly SelectionCondition[];
  readonly children?: ParsedQueryNodeMap<TArgTypes>;
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
 * The constructor of node maps: like Object.create(null), its objects inherit
 * no keys (their prototype is an empty object without a prototype), but V8
 * keeps them in fast mode (rather than as hash tables), which makes the
 * for...in loops of reads and writes over them several times faster.
 */
function NodeMap() {}
NodeMap.prototype = Object.create(null);

/** A new, empty node map (see NodeMap). */
export function createNodeMap<TArgTypes>(): ParsedQueryNodeMap<TArgTypes> {
  return new (NodeMap as unknown as new () => ParsedQueryNodeMap<TArgTypes>)();
}

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

  const nodeMap = createNodeMap<JsonAndVariables>();
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
      nodeMap[name] = _mergeNodes([...path, name], node, nodeMap[name], false, context);
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
          nodeMap[name] = _mergeNodes([...path, name], fragmentMap[name], nodeMap[name], false, context);
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
    if (child.variants?.some(variant => variant.conditions?.some(condition => condition.directives))) return true;
    if (child.alternatives) return true;
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
 * Merges two node definitions of a response key (`source` holding the earlier
 * selections); mutating `target` to include children from `source`.
 *
 * Different fields (or arguments) selected under the key under disjoint type
 * conditions become alternatives; under overlapping conditions, they are a
 * ConflictingFieldsError, unless `lenient` (when merging the selections that
 * apply to an object at read/write time, or to objects of unknown type), in
 * which case the earlier field wins.
 *
 * When parsing, `context` relates type conditions through possibleTypes.
 */
function _mergeNodes<TArgTypes>(
  path: string[],
  target: ParsedQueryNode<TArgTypes>,
  source?: ParsedQueryNode<TArgTypes>,
  lenient = false,
  context?: CacheContext<any>,
): ParsedQueryNode<TArgTypes> {
  if (!source) return target;
  // The common case: selections of the same field.
  if (!target.alternatives && !source.alternatives && _isSameField(target, source)) {
    return _mergeSameField(path, target, source, lenient, context);
  }

  const merged = _alternativesOf(source);
  for (const alternative of _alternativesOf(target)) {
    let same: number | undefined;
    let conflict: ParsedQueryNode<TArgTypes> | undefined;
    for (let i = 0; i < merged.length; i++) {
      if (_isSameField(merged[i], alternative)) {
        same = i;
      } else if (!conflict && _conditionsOverlap(merged[i].conditions, alternative.conditions, context)) {
        conflict = merged[i];
      }
    }
    if (conflict && !lenient) {
      const message = isEqual(alternative.args, conflict.args) ? `alias mismatch` : `parameterization mismatch`;
      throw new ConflictingFieldsError(message, path, [alternative, conflict]);
    }
    if (same !== undefined) {
      // (Even when it also overlaps another field, leniently: the selections
      // of the same field still apply.)
      merged[same] = _mergeSameField(path, alternative, merged[same], lenient, context);
    } else if (!conflict) {
      merged.push(alternative);
    }
  }

  const [first, ...rest] = merged;
  first.alternatives = rest.length ? rest : undefined;
  return first;
}

/** Whether two nodes select the same field, with the same arguments. */
function _isSameField<TArgTypes>(a: ParsedQueryNode<TArgTypes>, b: ParsedQueryNode<TArgTypes>) {
  return a.schemaName === b.schemaName && isEqual(a.args, b.args);
}

/** The alternatives of a node (being merged), starting with itself. */
function _alternativesOf<TArgTypes>(node: ParsedQueryNode<TArgTypes>): ParsedQueryNode<TArgTypes>[] {
  const { alternatives } = node;
  if (!alternatives) return [node];
  node.alternatives = undefined;
  return [node, ...alternatives];
}

/**
 * Whether fields selected under the conditions `a` and `b` may both apply to
 * the same object (so that GraphQL would require them to be the same field).
 *
 * Without a schema, type conditions are taken to be distinct object types,
 * unless possibleTypes (of `context`) relates them: the conditions only overlap
 * when each of one's type conditions is (a supertype or subtype of) one of the
 * other's (e.g. a field selected without a type condition overlaps all
 * others). Directives are ignored, as by GraphQL's validation.
 */
function _conditionsOverlap(
  a: readonly SelectionCondition[] | undefined,
  b: readonly SelectionCondition[] | undefined,
  context?: CacheContext<any>,
): boolean {
  if (!a || !b) return true;
  return a.some(x => b.some(y => _typeConditionsOverlap(x.typeConditions ?? [], y.typeConditions ?? [], context)));
}

function _typeConditionsOverlap(a: readonly string[], b: readonly string[], context?: CacheContext<any>) {
  const related = (x: string, y: string) =>
    x === y || (!!context && (context.fragmentMatches(x, y) || context.fragmentMatches(y, x)));
  return a.every(x => b.some(y => related(x, y))) || b.every(y => a.some(x => related(x, y)));
}

/**
 * Merges two selections of the same field; mutating `target` to include
 * children from `source` (which holds the earlier selections).
 */
function _mergeSameField<TArgTypes>(
  path: string[],
  target: ParsedQueryNode<TArgTypes>,
  source: ParsedQueryNode<TArgTypes>,
  lenient: boolean,
  context?: CacheContext<any>,
) {
  // Child selections made under disjoint conditions only apply to objects
  // of different types: for objects of unknown type, the earlier wins.
  const lenientChildren = lenient || !_conditionsOverlap(source.conditions, target.conditions, context);
  // `source` holds the earlier selections.
  _withField(target, fieldNodeOf(source));
  // Child selections made under different conditions (e.g. fragments on
  // different types) only apply where their conditions do; keep them apart
  // (before the children are merged below, which mutates them).
  const variants = _mergeVariants(path, source, target, lenient, context);
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
  target.variants = variants;
  if (!source.children) return target;

  if (!target.children) {
    target.children = source.children;
  } else {
    for (const name in source.children) {
      const later = target.children[name];
      target.children[name] = later
        ? _mergeNodes([...path, name], later, source.children[name], lenientChildren, context)
        : source.children[name];
    }
  }

  if (source.hasParameterizedChildren && !target.hasParameterizedChildren) {
    target.hasParameterizedChildren = true;
  }

  return target;
}

/**
 * The variants of a field merged from the selections of `earlier` and
 * `later`: undefined if all of its child selections apply wherever the field
 * does (it has no children, or all its selections share their conditions).
 * (See _mergeNodes for `lenient`.)
 */
function _mergeVariants<TArgTypes>(
  path: string[],
  earlier: ParsedQueryNode<TArgTypes>,
  later: ParsedQueryNode<TArgTypes>,
  lenient: boolean,
  context?: CacheContext<any>,
): readonly ParsedQueryVariant<TArgTypes>[] | undefined {
  // The common cases: leaf fields, and fields selected under the same conditions.
  if (!earlier.children && !later.children) return undefined;
  if (!earlier.variants && !later.variants && isEqual(earlier.conditions, later.conditions)) return undefined;

  const variants: ParsedQueryVariant<TArgTypes>[] = [..._variantsOf(earlier)];
  for (const variant of _variantsOf(later)) {
    const index = variants.findIndex(existing => isEqual(existing.conditions, variant.conditions));
    if (index < 0) {
      variants.push(variant);
      continue;
    }
    const existing = variants[index];
    variants[index] = {
      conditions: existing.conditions,
      children: _mergeMaps(path, existing.children, variant.children, lenient, context),
    };
  }

  if (variants.length < 2 || !variants.some(variant => variant.children)) return undefined;
  return variants;
}

/** The variants of a field (one for all its selections, if it has none). */
function _variantsOf<TArgTypes>(node: ParsedQueryNode<TArgTypes>): readonly ParsedQueryVariant<TArgTypes>[] {
  // Variants are never mutated (merging them merges copies).
  if (node.variants) return node.variants;
  return [{ conditions: node.conditions, children: node.children && _cloneMap(node.children) }];
}

/**
 * Merges two child maps of variants into a new one (leaving them intact); see
 * _mergeNodes for `lenient`.
 */
function _mergeMaps<TArgTypes>(
  path: string[],
  earlier: ParsedQueryNodeMap<TArgTypes> | undefined,
  later: ParsedQueryNodeMap<TArgTypes> | undefined,
  lenient = false,
  context?: CacheContext<any>,
): ParsedQueryNodeMap<TArgTypes> | undefined {
  if (!earlier || !later) return earlier ?? later;
  const merged = _cloneMap(later);
  for (const name in earlier) {
    const laterNode = merged[name];
    merged[name] = laterNode
      ? _mergeNodes([...path, name], laterNode, _cloneNode(earlier[name]), lenient, context)
      : _cloneNode(earlier[name]);
  }
  return merged;
}

/** A deep copy of a node map (so that merging into it leaves the original intact). */
function _cloneMap<TArgTypes>(map: ParsedQueryNodeMap<TArgTypes>): ParsedQueryNodeMap<TArgTypes> {
  const clone = createNodeMap<TArgTypes>();
  for (const name in map) {
    clone[name] = _cloneNode(map[name]);
  }
  const selectionSet = selectionSets.get(map);
  if (selectionSet) selectionSets.set(clone, selectionSet);
  return clone;
}

function _cloneNode<TArgTypes>(node: ParsedQueryNode<TArgTypes>): ParsedQueryNode<TArgTypes> {
  const clone = new ParsedQueryNode(
    node.children && _cloneMap(node.children),
    node.schemaName,
    node.args,
    node.hasParameterizedChildren,
    node.propMap,
    node.conditions,
    node.variants,
    node.alternatives?.map(_cloneNode),
  );
  const field = fieldNodeOf(node);
  if (field) fieldNodes.set(clone, field);
  return clone;
}

/** The merged children of the matching variants of fields, by the variants' indexes. */
const typedChildren = new WeakMap<object, Map<string, ParsedQueryNodeMap<any> | undefined>>();

/**
 * The child selections of a field that apply to the object it was read from
 * or written to (whose __typename is `typename`): the selections made under
 * conditions (fragments' type conditions) that don't match it are left out.
 *
 * Like the selection of fields themselves (CacheContext#conditionsMatch), all
 * child selections apply to objects of unknown type.
 */
export function childrenForType<TSerialized, TArgTypes>(
  context: CacheContext<TSerialized>,
  node: ParsedQueryNode<TArgTypes>,
  typename: unknown,
): ParsedQueryNodeMap<TArgTypes> | undefined {
  const { variants } = node;
  if (!variants || typeof typename !== 'string') return node.children;

  let matched: number[] | undefined;
  for (let i = 0; i < variants.length; i++) {
    if (context.conditionsMatch(variants[i].conditions, typename)) (matched ??= []).push(i);
  }
  // (The field itself is only selected if some variant matches.)
  if (!matched || matched.length === variants.length) return node.children;
  if (matched.length === 1) return variants[matched[0]].children;

  const key = matched.join();
  let byKey = typedChildren.get(node);
  if (!byKey) typedChildren.set(node, (byKey = new Map()));
  if (!byKey.has(key)) {
    let children: ParsedQueryNodeMap<TArgTypes> | undefined;
    for (const i of matched) {
      children = _mergeMaps([], children, variants[i].children, true);
    }
    byKey.set(key, children);
  }
  return byKey.get(key);
}

/**
 * The field selected under a response key (whose node is `node`) that applies
 * to an object with the given __typename: the first (in document order) of
 * the node and its alternatives whose conditions match the type, if any.
 *
 * Objects of unknown type (like objects of types that GraphQL would not allow
 * several of the alternatives to apply to) get the first alternative.
 */
export function alternativeForType<TSerialized, TArgTypes>(
  context: CacheContext<TSerialized>,
  node: ParsedQueryNode<TArgTypes>,
  typename: unknown,
): ParsedQueryNode<TArgTypes> | undefined {
  if (context.conditionsMatch(node.conditions, typename)) return node;
  for (const alternative of node.alternatives ?? []) {
    if (context.conditionsMatch(alternative.conditions, typename)) return alternative;
  }
  return undefined;
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

  const newMap = createNodeMap<JsonScalar>();
  for (const key in parsed) {
    const node = parsed[key];
    const expanded = node.alternatives ? _expandAlternatives(node, variables) : _expandNode(node, variables);
    if (expanded) newMap[key] = expanded;
  }

  return newMap;
}

/**
 * Expands a node (ignoring its alternatives); undefined if it is skipped for
 * these variables.
 */
function _expandNode(
  node: ParsedQueryNode<JsonAndVariables>,
  variables: JsonObject | undefined,
): ParsedQueryNode<JsonScalar> | undefined {
  let conditions = node.conditions;
  if (conditions?.some(condition => condition.directives)) {
    const resolved = _resolveDirectives(conditions, variables);
    // Skipped for these variables.
    if (resolved === null) return undefined;
    conditions = resolved;
  }

  const { variants } = node;
  const hasVariantDirectives = variants?.some(variant => variant.conditions?.some(condition => condition.directives));
  if (variants && (node.args || node.hasParameterizedChildren || hasVariantDirectives)) {
    return _expandVariants(node, conditions, variables);
  } else if (node.args || node.hasParameterizedChildren || conditions !== node.conditions) {
    // (The variants of a field, if any, need no expansion here: their
    // conditions have no directives, and their children no variables.)
    return _withField(
      new ParsedQueryNode(
        _expandVariables(node.children, variables),
        node.schemaName,
        expandFieldArguments(node.args, variables),
        node.hasParameterizedChildren,
        node.propMap,
        conditions,
        variants as readonly ParsedQueryVariant<JsonScalar>[] | undefined,
      ),
      fieldNodeOf(node),
    );
  }
  // No variables to substitute for this subtree.
  return node as ParsedQueryNode;
}

/**
 * Expands a node with alternatives: those skipped for these variables are
 * dropped.
 */
function _expandAlternatives(
  node: ParsedQueryNode<JsonAndVariables>,
  variables: JsonObject | undefined,
): ParsedQueryNode<JsonScalar> | undefined {
  const alternatives = [node, ...node.alternatives!];
  const expanded: ParsedQueryNode<JsonScalar>[] = [];
  let unchanged = true;
  for (const alternative of alternatives) {
    const expandedAlternative = _expandNode(alternative, variables);
    if (expandedAlternative !== alternative) unchanged = false;
    if (expandedAlternative) expanded.push(expandedAlternative);
  }
  if (unchanged) return node as ParsedQueryNode;
  if (!expanded.length) return undefined;

  const [first, ...rest] = expanded;
  if (!rest.length && first !== node) return first;
  // (A copy, as the expanded nodes may be the operation's own.)
  return _withField(
    new ParsedQueryNode(
      first.children,
      first.schemaName,
      first.args,
      first.hasParameterizedChildren,
      first.propMap,
      first.conditions,
      first.variants,
      rest.length ? rest : undefined,
    ),
    fieldNodeOf(first),
  );
}

/**
 * Expands a field with variants: the variants whose @skip/@include directives
 * exclude them for these variables are dropped (along with their children).
 */
function _expandVariants(
  node: ParsedQueryNode<JsonAndVariables>,
  conditions: readonly SelectionCondition[] | undefined,
  variables: JsonObject | undefined,
): ParsedQueryNode<JsonScalar> {
  const variants: ParsedQueryVariant<JsonScalar>[] = [];
  let dropped = false;
  for (const variant of node.variants!) {
    let variantConditions = variant.conditions;
    if (variantConditions?.some(condition => condition.directives)) {
      const resolved = _resolveDirectives(variantConditions, variables);
      if (resolved === null) {
        dropped = true;
        continue;
      }
      variantConditions = resolved;
    }
    variants.push({ conditions: variantConditions, children: _expandVariables(variant.children, variables) });
  }

  let children: ParsedQueryNodeMap<JsonScalar> | undefined;
  if (dropped) {
    // Only the children of the remaining variants are selected.
    for (const variant of variants) {
      children = _mergeMaps([], children, variant.children, true);
    }
  } else {
    children = _expandVariables(node.children, variables);
  }

  return _withField(
    new ParsedQueryNode(
      children,
      node.schemaName,
      expandFieldArguments(node.args, variables),
      node.hasParameterizedChildren,
      node.propMap,
      conditions,
      variants.length > 1 ? variants : undefined,
    ),
    fieldNodeOf(node),
  );
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
