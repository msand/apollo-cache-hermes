"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VariableArgument = exports.ParsedQueryNode = void 0;
exports.parseQuery = parseQuery;
exports.areChildrenDynamic = areChildrenDynamic;
exports.expandVariables = expandVariables;
exports._expandVariables = _expandVariables;
exports.expandFieldArguments = expandFieldArguments;
exports._expandArgument = _expandArgument;
const tslib_1 = require("tslib");
const equality_1 = tslib_1.__importDefault(require("@wry/equality"));
const errors_1 = require("./errors");
const util_1 = require("./util");
/**
 * The GraphQL AST is parsed down into a simple tree containing all information
 * the cache requires to read/write associated payloads.
 *
 * A parsed query has no notion of fragments, or other such redirections; they
 * are flattened into query nodes when parsed.
 */
class ParsedQueryNode {
    constructor(
    /** Any child fields. */
    children, 
    /**
     * The name of the field (as defined by the schema).
     *
     * Omitted by default (can be inferred by its key in a node map), unless
     * the field is aliased.
     */
    schemaName, 
    /** The map of the field's arguments and their values, if parameterized. */
    args, 
    /**
     * Whether a (transitive) child contains arguments.  This allows us to
     * ignore whole subtrees in some situations if they were completely static.
     * */
    hasParameterizedChildren, propMap) {
        this.children = children;
        this.schemaName = schemaName;
        this.args = args;
        this.hasParameterizedChildren = hasParameterizedChildren;
        this.propMap = propMap;
    }
}
exports.ParsedQueryNode = ParsedQueryNode;
/**
 * Represents the location a variable should be used as an argument to a
 * parameterized field.
 *
 * Note that variables can occur _anywhere_ within an argument, not just at the
 * top level.
 */
class VariableArgument {
    constructor(
    /** The name of the variable. */
    name) {
        this.name = name;
    }
}
exports.VariableArgument = VariableArgument;
/**
 * Parsed a GraphQL AST selection into a tree of ParsedQueryNode instances.
 */
function parseQuery(context, fragments, selectionSet) {
    const variables = new Set();
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
function unlessEmpty(propMap) {
    return Object.keys(propMap).length === 0 ? undefined : propMap;
}
/**
 * Recursively builds a mapping of field names to ParsedQueryNodes for the given
 * selection set.
 */
function _buildNodeMap(variables, context, fragments, propMap, selectionSet, path = []) {
    if (!selectionSet)
        return undefined;
    const nodeMap = Object.create(null);
    for (const selection of selectionSet.selections) {
        if (selection.kind === 'Field') {
            // The name of the field (as defined by the query).
            const name = selection.alias ? selection.alias.value : selection.name.value;
            const innerPropMap = Object.create(null);
            const children = _buildNodeMap(variables, context, fragments, innerPropMap, selection.selectionSet, [...path, name]);
            let args, schemaName;
            // fields marked as @static are treated as if they are a static field in
            // the schema.  E.g. parameters are ignored, and an alias is considered
            // to be truth.
            if (!(0, util_1.fieldHasStaticDirective)(selection)) {
                args = _buildFieldArgs(variables, selection.arguments);
                schemaName = selection.alias ? selection.name.value : undefined;
                if (schemaName !== undefined) {
                    propMap[schemaName] = name;
                }
            }
            const hasParameterizedChildren = areChildrenDynamic(children);
            const node = new ParsedQueryNode(children, schemaName, args, hasParameterizedChildren, unlessEmpty(innerPropMap));
            nodeMap[name] = _mergeNodes([...path, name], node, nodeMap[name]);
        }
        else if (selection.kind === 'FragmentSpread') {
            const fragment = fragments[selection.name.value];
            if (!fragment) {
                throw new Error(`Expected fragment ${selection.name.value} to be defined`);
            }
            const fragmentMap = _buildNodeMap(variables, context, fragments, propMap, fragment.selectionSet, path);
            if (fragmentMap) {
                for (const name in fragmentMap) {
                    nodeMap[name] = _mergeNodes([...path, name], fragmentMap[name], nodeMap[name]);
                }
            }
        }
        else if (selection.kind === 'InlineFragment') {
            const fragmentMap = _buildNodeMap(variables, context, fragments, propMap, selection.selectionSet, path);
            if (fragmentMap) {
                for (const name in fragmentMap) {
                    nodeMap[name] = _mergeNodes([...path, name], fragmentMap[name], nodeMap[name]);
                }
            }
        }
        else if (context.tracer.warning) {
            context.tracer.warning(`${selection.kind} selections are not supported; query may misbehave`);
        }
        _collectDirectiveVariables(variables, selection);
    }
    return Object.keys(nodeMap).length ? nodeMap : undefined;
}
/**
 * Well, are they?
 */
function areChildrenDynamic(children) {
    if (!children)
        return undefined;
    for (const name in children) {
        const child = children[name];
        if (child.hasParameterizedChildren)
            return true;
        if (child.args)
            return true;
        if (child.schemaName)
            return true; // Aliases are dynamic at read time.
    }
    return undefined;
}
/**
 * Build the map of arguments to their natural JS values (or variables).
 */
function _buildFieldArgs(variables, argumentsNode) {
    if (!argumentsNode)
        return undefined;
    const args = {};
    for (const arg of argumentsNode) {
        // Mapped name of argument to it JS value
        args[arg.name.value] = _valueFromNode(variables, arg.value);
    }
    return Object.keys(args).length ? args : undefined;
}
/**
 * Evaluate a ValueNode and yield its value in its natural JS form.
 */
function _valueFromNode(variables, node) {
    return (0, util_1.valueFromNode)(node, ({ name: { value } }) => {
        variables.add(value);
        return new VariableArgument(value);
    });
}
/**
 * Collect the variables in use by any directives on the node.
 */
function _collectDirectiveVariables(variables, node) {
    const { directives } = node;
    if (!directives)
        return;
    for (const directive of directives) {
        if (!directive.arguments)
            continue;
        for (const argument of directive.arguments) {
            (0, util_1.valueFromNode)(argument.value, ({ name: { value } }) => {
                variables.add(value);
            });
        }
    }
}
/**
 * Merges two node definitions; mutating `target` to include children from
 * `source`.
 */
function _mergeNodes(path, target, source) {
    if (!source)
        return target;
    if (!(0, equality_1.default)(target.args, source.args)) {
        throw new errors_1.ConflictingFieldsError(`parameterization mismatch`, path, [target, source]);
    }
    if (target.schemaName !== source.schemaName) {
        throw new errors_1.ConflictingFieldsError(`alias mismatch`, path, [target, source]);
    }
    if (!source.children)
        return target;
    if (!target.children) {
        target.children = source.children;
    }
    else {
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
function expandVariables(parsed, variables) {
    return _expandVariables(parsed, variables);
}
function _expandVariables(parsed, variables) {
    if (!parsed)
        return undefined;
    const newMap = {};
    for (const key in parsed) {
        const node = parsed[key];
        if (node.args || node.hasParameterizedChildren) {
            newMap[key] = new ParsedQueryNode(_expandVariables(node.children, variables), node.schemaName, expandFieldArguments(node.args, variables), node.hasParameterizedChildren, node.propMap);
            // No variables to substitute for this subtree.
        }
        else {
            newMap[key] = node;
        }
    }
    return newMap;
}
/**
 * Sub values in for any variables required by a field's args.
 */
function expandFieldArguments(args, variables) {
    return args ? _expandArgument(args, variables) : undefined;
}
function _expandArgument(arg, variables) {
    if (arg instanceof VariableArgument) {
        if (!variables || !(arg.name in variables)) {
            throw new Error(`Expected variable $${arg.name} to exist for query`);
        }
        return variables[arg.name];
    }
    else if (Array.isArray(arg)) {
        return arg.map(v => _expandArgument(v, variables));
    }
    else if ((0, util_1.isObject)(arg)) {
        const expanded = {};
        for (const key in arg) {
            expanded[key] = _expandArgument(arg[key], variables);
        }
        return expanded;
    }
    else {
        // TS isn't inferring that arg cannot contain any VariableArgument values.
        return arg;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUGFyc2VkUXVlcnlOb2RlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiUGFyc2VkUXVlcnlOb2RlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQWlHQSxnQ0FzQkM7QUErRUQsZ0RBU0M7QUFnRkQsMENBRUM7QUFFRCw0Q0FxQkM7QUFLRCxvREFLQztBQUVELDBDQXFCQzs7QUF6VkQscUVBQW9DO0FBR3BDLHFDQUFrRDtBQUVsRCxpQ0FTZ0I7QUFLaEI7Ozs7OztHQU1HO0FBQ0gsTUFBYSxlQUFlO0lBQzFCO0lBQ0Usd0JBQXdCO0lBQ2pCLFFBQXdDO0lBQy9DOzs7OztPQUtHO0lBQ0ksVUFBbUI7SUFDMUIsMkVBQTJFO0lBQ3BFLElBQThCO0lBQ3JDOzs7U0FHSztJQUNFLHdCQUErQixFQUMvQixPQUVOO1FBakJNLGFBQVEsR0FBUixRQUFRLENBQWdDO1FBT3hDLGVBQVUsR0FBVixVQUFVLENBQVM7UUFFbkIsU0FBSSxHQUFKLElBQUksQ0FBMEI7UUFLOUIsNkJBQXdCLEdBQXhCLHdCQUF3QixDQUFPO1FBQy9CLFlBQU8sR0FBUCxPQUFPLENBRWI7SUFDQSxDQUFDO0NBQ0w7QUF0QkQsMENBc0JDO0FBZ0NEOzs7Ozs7R0FNRztBQUNILE1BQWEsZ0JBQWdCO0lBQzNCO0lBQ0UsZ0NBQWdDO0lBQ2hCLElBQVk7UUFBWixTQUFJLEdBQUosSUFBSSxDQUFRO0lBQzNCLENBQUM7Q0FDTDtBQUxELDRDQUtDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQixVQUFVLENBQ3hCLE9BQWtDLEVBQ2xDLFNBQXNCLEVBQ3RCLFlBQThCO0lBTTlCLE1BQU0sU0FBUyxHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7SUFDcEMsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNwQyxNQUFNLFdBQVcsR0FBRyxhQUFhLENBQUMsU0FBUyxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLFlBQVksQ0FBQyxDQUFD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