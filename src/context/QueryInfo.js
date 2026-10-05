"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryInfo = void 0;
const ParsedQueryNode_1 = require("../ParsedQueryNode");
const util_1 = require("../util");
/**
 * Metadata about a GraphQL document (query/mutation/fragment/etc).
 *
 * We do a fair bit of pre-processing over them, and these objects hang onto
 * that information.
 */
class QueryInfo {
    constructor(context, raw) {
        var _a;
        this.document = raw.document;
        this.operation = (0, util_1.getOperationOrDie)(raw.document);
        this.operationType = this.operation.operation;
        this.operationName = this.operation.name && this.operation.name.value;
        this.operationSource = this.operation.loc && this.operation.loc.source.body;
        this.fragmentMap = (0, util_1.fragmentMapForDocument)(raw.document);
        const { parsedQuery, variables, propMap } = (0, ParsedQueryNode_1.parseQuery)(context, this.fragmentMap, this.operation.selectionSet);
        this.parsed = parsedQuery;
        this.variables = variables;
        this.propMap = propMap;
        this.variableDefaults = (0, util_1.variableDefaultsInOperation)(this.operation);
        // Skip verification if rawOperation is constructed from fragments
        // (e.g readFragment/writeFragment) because fragment will not declare
        // variables. Users will have to know to provide `variables` parameter
        if (!raw.fromFragmentDocument) {
            const declaredVariables = (0, util_1.variablesInOperation)(this.operation);
            for (const key of Object.keys((_a = raw.variables) !== null && _a !== void 0 ? _a : {})) {
                declaredVariables.add(key);
            }
            this._assertValid(declaredVariables);
        }
    }
    _assertValid(declaredVariables) {
        const messages = [];
        this._assertAllVariablesDeclared(messages, declaredVariables);
        if (!messages.length)
            return;
        const mainMessage = `Validation errors in ${this.operationType} ${this.operationName || '<unknown>'}`;
        throw new Error(`${mainMessage}:${messages.map(m => `\n * ${m}`).join('')}`);
    }
    _assertAllVariablesDeclared(messages, declaredVariables) {
        for (const name of this.variables) {
            if (!declaredVariables.has(name)) {
                messages.push(`Variable $${name} is used, but not declared`);
            }
        }
    }
}
exports.QueryInfo = QueryInfo;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUXVlcnlJbmZvLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiUXVlcnlJbmZvLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLHdEQUEwRTtBQUcxRSxrQ0FTaUI7QUFLakI7Ozs7O0dBS0c7QUFDSCxNQUFhLFNBQVM7SUE2QnBCLFlBQVksT0FBa0MsRUFBRSxHQUFpQjs7UUFDL0QsSUFBSSxDQUFDLFFBQVEsR0FBRyxHQUFHLENBQUMsUUFBUSxDQUFDO1FBQzdCLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBQSx3QkFBaUIsRUFBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDakQsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQztRQUM5QyxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQztRQUN0RSxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUM7UUFDNUUsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFBLDZCQUFzQixFQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUV4RCxNQUFNLEVBQUUsV0FBVyxFQUFFLFNBQVMsRUFBRSxPQUFPLEVBQUUsR0FBRyxJQUFBLDRCQUFVLEVBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUMvRyxJQUFJLENBQUMsTUFBTSxHQUFHLFdBQVcsQ0FBQztRQUMxQixJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztRQUMzQixJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQztRQUN2QixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBQSxrQ0FBMkIsRUFBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7UUFFcEUsa0VBQWtFO1FBQ2xFLHFFQUFxRTtRQUNyRSxzRUFBc0U7UUFDdEUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1lBQzlCLE1BQU0saUJBQWlCLEdBQUcsSUFBQSwyQkFBb0IsRUFBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7WUFDL0QsS0FBSyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQUEsR0FBRyxDQUFDLFNBQVMsbUNBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQztnQkFDbkQsaUJBQWlCLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQzdCLENBQUM7WUFDRCxJQUFJLENBQUMsWUFBWSxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFDdkMsQ0FBQztJQUNILENBQUM7SUFFTyxZQUFZLENBQUMsaUJBQThCO1FBQ2pELE1BQU0sUUFBUSxHQUFhLEVBQUUsQ0FBQztRQUU5QixJQUFJLENBQUMsMkJBQTJCLENBQUMsUUFBUSxFQUFFLGlCQUFpQixDQUFDLENBQUM7UUFFOUQsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNO1lBQUUsT0FBTztRQUM3QixNQUFNLFdBQVcsR0FBRyx3QkFBd0IsSUFBSSxDQUFDLGFBQWEsSUFBSSxJQUFJLENBQUMsYUFBYSxJQUFJLFdBQVcsRUFBRSxDQUFDO1FBQ3RHLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxXQUFXLElBQUksUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQy9FLENBQUM7SUFFTywyQkFBMkIsQ0FBQyxRQUFrQixFQUFFLGlCQUE4QjtRQUNwRixLQUFLLE1BQU0sSUFBSSxJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNsQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQ2pDLFFBQVEsQ0FBQyxJQUFJLENBQUMsYUFBYSxJQUFJLDRCQUE0QixDQUFDLENBQUM7WUFDL0QsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0NBRUY7QUF6RUQsOEJBeUVDIn0=