"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticNodeId = void 0;
exports.isSerializable = isSerializable;
const util_1 = require("./util");
/**
 * There are a few pre-defined nodes present in all schemas.
 */
var StaticNodeId;
(function (StaticNodeId) {
    StaticNodeId["QueryRoot"] = "ROOT_QUERY";
    StaticNodeId["MutationRoot"] = "ROOT_MUTATION";
    StaticNodeId["SubscriptionRoot"] = "ROOT_SUBSCRIPTION";
})(StaticNodeId || (exports.StaticNodeId = StaticNodeId = {}));
function isSerializable(value, allowUndefined) {
    if ((0, util_1.isScalar)(value)) {
        // NaN is considered to typeof number
        const isNaNValue = Number.isNaN(value);
        return allowUndefined ? !isNaNValue : !isNaNValue && value !== undefined;
    }
    if ((0, util_1.isObject)(value)) {
        for (const propName of Object.getOwnPropertyNames(value)) {
            if (!isSerializable(value[propName], allowUndefined)) {
                return false;
            }
        }
        return true;
    }
    if (Array.isArray(value)) {
        for (const element of value) {
            if (!isSerializable(element, allowUndefined)) {
                return false;
            }
        }
        return true;
    }
    return false;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsic2NoZW1hLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQThHQSx3Q0EwQkM7QUFwSUQsaUNBQTBEO0FBbUIxRDs7R0FFRztBQUNILElBQVksWUFJWDtBQUpELFdBQVksWUFBWTtJQUN0Qix3Q0FBd0IsQ0FBQTtJQUN4Qiw4Q0FBOEIsQ0FBQTtJQUM5QixzREFBc0MsQ0FBQTtBQUN4QyxDQUFDLEVBSlcsWUFBWSw0QkFBWixZQUFZLFFBSXZCO0FBZ0ZELFNBQWdCLGNBQWMsQ0FBQyxLQUFVLEVBQUUsY0FBd0I7SUFDakUsSUFBSSxJQUFBLGVBQVEsRUFBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ3BCLHFDQUFxQztRQUNyQyxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQVksQ0FBQyxDQUFDO1FBQzlDLE9BQU8sY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLElBQUksS0FBSyxLQUFLLFNBQVMsQ0FBQztJQUMzRSxDQUFDO0lBRUQsSUFBSSxJQUFBLGVBQVEsRUFBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ3BCLEtBQUssTUFBTSxRQUFRLElBQUksTUFBTSxDQUFDLG1CQUFtQixDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDekQsSUFBSSxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLEVBQUUsY0FBYyxDQUFDLEVBQUUsQ0FBQztnQkFDckQsT0FBTyxLQUFLLENBQUM7WUFDZixDQUFDO1FBQ0gsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDO0lBQ2QsQ0FBQztJQUVELElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ3pCLEtBQUssTUFBTSxPQUFPLElBQUksS0FBSyxFQUFFLENBQUM7WUFDNUIsSUFBSSxDQUFDLGNBQWMsQ0FBQyxPQUFPLEVBQUUsY0FBYyxDQUFDLEVBQUUsQ0FBQztnQkFDN0MsT0FBTyxLQUFLLENBQUM7WUFDZixDQUFDO1FBQ0gsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDO0lBQ2QsQ0FBQztJQUVELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQyJ9