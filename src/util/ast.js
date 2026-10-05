"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOperationOrDie = getOperationOrDie;
exports.variablesInOperation = variablesInOperation;
exports.variableDefaultsInOperation = variableDefaultsInOperation;
exports.fragmentMapForDocument = fragmentMapForDocument;
exports.selectionSetIsStatic = selectionSetIsStatic;
exports.fieldIsStatic = fieldIsStatic;
exports.fieldHasAlias = fieldHasAlias;
exports.fieldIsParameterized = fieldIsParameterized;
exports.fieldHasStaticDirective = fieldHasStaticDirective;
const tslib_1 = require("tslib");
const utilities_1 = require("@apollo/client/utilities");
const ts_invariant_1 = tslib_1.__importDefault(require("ts-invariant"));
const primitive_1 = require("./primitive");
const store_1 = require("./store");
function getOperationOrDie(document) {
    const def = (0, utilities_1.getOperationDefinition)(document);
    (0, ts_invariant_1.default)(def, `GraphQL document is missing an operation`);
    return def;
}
/**
 * Returns the names of all variables declared by the operation.
 */
function variablesInOperation(operation) {
    const names = new Set();
    if (operation.variableDefinitions) {
        for (const definition of operation.variableDefinitions) {
            names.add(definition.variable.name.value);
        }
    }
    return names;
}
/**
 * Returns the default values of all variables in the operation.
 */
function variableDefaultsInOperation(operation) {
    const defaults = {};
    if (operation.variableDefinitions) {
        for (const definition of operation.variableDefinitions) {
            if (definition.type.kind === 'NonNullType')
                continue; // Required.
            const { defaultValue } = definition;
            defaults[definition.variable.name.value] = (0, primitive_1.isObject)(defaultValue) ? (0, store_1.valueFromNode)(defaultValue) : null;
        }
    }
    return defaults;
}
/**
 * Extracts fragments from `document` by name.
 */
function fragmentMapForDocument(document) {
    const map = {};
    for (const definition of document.definitions) {
        if (definition.kind !== 'FragmentDefinition')
            continue;
        map[definition.name.value] = definition;
    }
    return map;
}
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
function selectionSetIsStatic(selectionSet, fragmentGetter) {
    for (const selection of selectionSet.selections) {
        if (selection.kind === 'Field') {
            if (!fieldIsStatic(selection))
                return false;
            if (selection.selectionSet && !selectionSetIsStatic(selection.selectionSet, fragmentGetter))
                return false;
        }
        else if (selection.kind === 'FragmentSpread') {
            if (!fragmentGetter) {
                throw new Error(`fragmentGetter is required for selection sets with ...fragments`);
            }
            const fragmentSet = fragmentGetter(selection.name.value);
            if (!fragmentSet) {
                throw new Error(`Unknown fragment ${selection.name.value} in isSelectionSetStatic`);
            }
            if (!selectionSetIsStatic(fragmentSet, fragmentGetter))
                return false;
        }
        else if (selection.kind === 'InlineFragment') {
            if (!selectionSetIsStatic(selection.selectionSet, fragmentGetter))
                return false;
        }
        else {
            throw new Error(`Unknown selection type ${selection.kind} in isSelectionSetStatic`);
        }
    }
    return true;
}
function fieldIsStatic(field) {
    const isActuallyStatic = !fieldHasAlias(field) && !fieldIsParameterized(field);
    return isActuallyStatic || fieldHasStaticDirective(field);
}
function fieldHasAlias(field) {
    return !!field.alias;
}
function fieldIsParameterized(field) {
    return !!(field.arguments && field.arguments.length);
}
function fieldHasStaticDirective({ directives }) {
    if (!directives)
        return false;
    return directives.some(directive => directive.name.value === 'static');
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBK0JBLDhDQU1DO0FBS0Qsb0RBU0M7QUFLRCxrRUFZQztBQUlELHdEQVFDO0FBWUQsb0RBNkJDO0FBRUQsc0NBR0M7QUFFRCxzQ0FFQztBQUVELG9EQUVDO0FBRUQsMERBR0M7O0FBaElELHdEQUErRTtBQUMvRSx3RUFBcUM7QUFJckMsMkNBQXVDO0FBQ3ZDLG1DQUF3QztBQWN4QyxTQUFnQixpQkFBaUIsQ0FDL0IsUUFBc0I7SUFFdEIsTUFBTSxHQUFHLEdBQUcsSUFBQSxrQ0FBc0IsRUFBQyxRQUFRLENBQUMsQ0FBQztJQUM3QyxJQUFBLHNCQUFTLEVBQUMsR0FBRyxFQUFFLDBDQUEwQyxDQUFDLENBQUM7SUFDM0QsT0FBTyxHQUE4QixDQUFDO0FBQ3hDLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLG9CQUFvQixDQUFDLFNBQWtDO0lBQ3JFLE1BQU0sS0FBSyxHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7SUFDaEMsSUFBSSxTQUFTLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztRQUNsQyxLQUFLLE1BQU0sVUFBVSxJQUFJLFNBQVMsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1lBQ3ZELEtBQUssQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDNUMsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQztBQUNmLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLDJCQUEyQixDQUFDLFNBQWtDO0lBQzVFLE1BQU0sUUFBUSxHQUFpQyxFQUFFLENBQUM7SUFDbEQsSUFBSSxTQUFTLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztRQUNsQyxLQUFLLE1BQU0sVUFBVSxJQUFJLFNBQVMsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1lBQ3ZELElBQUksVUFBVSxDQUFDLElBQUksQ0FBQyxJ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