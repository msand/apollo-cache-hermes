"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParameterizedValueSnapshot = void 0;
const util_1 = require("../util");
/**
 * Maintains a reference to the value of a specific parameterized field
 * contained within some other node.
 *
 * These values are stored outside of the entity that contains them, as the
 * entity node is reserved for static values.  At read time, these values are
 * overlaid on top of the static values of the entity that contains them.
 */
class ParameterizedValueSnapshot {
    constructor(
    /** A reference to the entity this snapshot is about. */
    data, 
    /** Other node snapshots that point to this one. */
    inbound, 
    /** The node snapshots that this one points to. */
    outbound, 
    /** The parameterized node snapshots that this one points to. */
    parameterized) {
        this.data = data;
        this.inbound = Array.isArray(inbound) ? (0, util_1.getInbound)(inbound) : inbound;
        this.outbound = Array.isArray(outbound) ? (0, util_1.getOutbound)(outbound) : outbound;
        this.parameterized = Array.isArray(parameterized) ? (0, util_1.getParameterized)(parameterized) : parameterized;
    }
}
exports.ParameterizedValueSnapshot = ParameterizedValueSnapshot;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUGFyYW1ldGVyaXplZFZhbHVlU25hcHNob3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJQYXJhbWV0ZXJpemVkVmFsdWVTbmFwc2hvdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxrQ0FBb0U7QUFPcEU7Ozs7Ozs7R0FPRztBQUNILE1BQWEsMEJBQTBCO0lBT3JDO0lBQ0Usd0RBQXdEO0lBQ2pELElBQWdCO0lBQ3ZCLG1EQUFtRDtJQUNuRCxPQUFzRDtJQUN0RCxrREFBa0Q7SUFDbEQsUUFBdUQ7SUFDdkQsZ0VBQWdFO0lBQ2hFLGFBQThEO1FBTnZELFNBQUksR0FBSixJQUFJLENBQVk7UUFRdkIsSUFBSSxDQUFDLE9BQU8sR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFBLGlCQUFVLEVBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQztRQUN0RSxJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUEsa0JBQVcsRUFBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDO1FBQzNFLElBQUksQ0FBQyxhQUFhLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBQSx1QkFBZ0IsRUFBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDO0lBQ3RHLENBQUM7Q0FDRjtBQXJCRCxnRUFxQkMifQ==