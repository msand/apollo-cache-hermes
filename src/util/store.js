"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.valueFromNode = valueFromNode;
// We only depend on graphql for its types; nothing at runtime.
// eslint-disable-next-line import/no-extraneous-dependencies
const graphql_1 = require("graphql");
const ts_invariant_1 = require("ts-invariant");
// Note: These functions were originally a part of apollo-utilities, but were
// removed 87c7a2bc as they were unused within the apollo-client project.
function defaultValueFromVariable(_node) {
    throw new ts_invariant_1.InvariantError(`Variable nodes are not supported by valueFromNode`);
}
/**
 * Evaluate a ValueNode and yield its value in its natural JS form.
 */
function valueFromNode(node, onVariable = defaultValueFromVariable) {
    switch (node.kind) {
        case graphql_1.Kind.VARIABLE:
            return onVariable(node);
        case graphql_1.Kind.NULL:
            return null;
        case graphql_1.Kind.INT:
            return parseInt(node.value);
        case graphql_1.Kind.FLOAT:
            return parseFloat(node.value);
        case graphql_1.Kind.LIST:
            return node.values.map(v => valueFromNode(v, onVariable));
        case graphql_1.Kind.OBJECT: {
            const value = {};
            for (const field of node.fields) {
                value[field.name.value] = valueFromNode(field.value, onVariable);
            }
            return value;
        }
        case graphql_1.Kind.STRING:
            return node.value;
        case graphql_1.Kind.BOOLEAN:
            return node.value;
        case graphql_1.Kind.ENUM:
            return node.value;
        default: throw new Error(`Unknown node: ${JSON.stringify(node)}`);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzdG9yZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQWdCQSxzQ0E4QkM7QUE5Q0QsK0RBQStEO0FBQy9ELDZEQUE2RDtBQUM3RCxxQ0FBd0Q7QUFDeEQsK0NBQThDO0FBRzlDLDZFQUE2RTtBQUM3RSx5RUFBeUU7QUFFekUsU0FBUyx3QkFBd0IsQ0FBQyxLQUFtQjtJQUNuRCxNQUFNLElBQUksNkJBQWMsQ0FBQyxtREFBbUQsQ0FBQyxDQUFDO0FBQ2hGLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLGFBQWEsQ0FDM0IsSUFBZSxFQUNmLGFBQTRCLHdCQUF3QjtJQUVwRCxRQUFRLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNsQixLQUFLLGNBQUksQ0FBQyxRQUFRO1lBQ2hCLE9BQU8sVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQzFCLEtBQUssY0FBSSxDQUFDLElBQUk7WUFDWixPQUFPLElBQUksQ0FBQztRQUNkLEtBQUssY0FBSSxDQUFDLEdBQUc7WUFDWCxPQUFPLFFBQVEsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDOUIsS0FBSyxjQUFJLENBQUMsS0FBSztZQUNiLE9BQU8sVUFBVSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNoQyxLQUFLLGNBQUksQ0FBQyxJQUFJO1lBQ1osT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLGFBQWEsQ0FBQyxDQUFDLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FBQztRQUM1RCxLQUFLLGNBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO1lBQ2pCLE1BQU0sS0FBSyxHQUEyQixFQUFFLENBQUM7WUFDekMsS0FBSyxNQUFNLEtBQUssSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7Z0JBQ2hDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFLFVBQVUsQ0FBQyxDQUFDO1lBQ25FLENBQUM7WUFDRCxPQUFPLEtBQUssQ0FBQztRQUNmLENBQUM7UUFDRCxLQUFLLGNBQUksQ0FBQyxNQUFNO1lBQ2QsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDO1FBQ3BCLEtBQUssY0FBSSxDQUFDLE9BQU87WUFDZixPQUFPLElBQUksQ0FBQyxLQUFLLENBQUM7UUFDcEIsS0FBSyxjQUFJLENBQUMsSUFBSTtZQUNaLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQztRQUNwQixPQUFPLENBQUMsQ0FBQyxNQUFNLElBQUksS0FBSyxDQUFDLGlCQUFpQixJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUNwRSxDQUFDO0FBQ0gsQ0FBQyJ9