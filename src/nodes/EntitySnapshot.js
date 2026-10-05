"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntitySnapshot = void 0;
const util_1 = require("../util");
/**
 * Maintains a reference to a single entity within the cached graph, and any
 * bookkeeping metadata associated with it.
 *
 * Note that this houses all the _static_ values for an entity, but none of the
 * parameterized values that may also have been queried for it.
 */
class EntitySnapshot {
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
exports.EntitySnapshot = EntitySnapshot;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiRW50aXR5U25hcHNob3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJFbnRpdHlTbmFwc2hvdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxrQ0FBb0U7QUFPcEU7Ozs7OztHQU1HO0FBQ0gsTUFBYSxjQUFjO0lBT3pCO0lBQ0Usd0RBQXdEO0lBQ2pELElBQWlCO0lBQ3hCLG1EQUFtRDtJQUNuRCxPQUFzRDtJQUN0RCxrREFBa0Q7SUFDbEQsUUFBdUQ7SUFDdkQsZ0VBQWdFO0lBQ2hFLGFBQThEO1FBTnZELFNBQUksR0FBSixJQUFJLENBQWE7UUFReEIsSUFBSSxDQUFDLE9BQU8sR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFBLGlCQUFVLEVBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQztRQUN0RSxJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUEsa0JBQVcsRUFBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDO1FBQzNFLElBQUksQ0FBQyxhQUFhLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBQSx1QkFBZ0IsRUFBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDO0lBQ3RHLENBQUM7Q0FDRjtBQXJCRCx3Q0FxQkMifQ==