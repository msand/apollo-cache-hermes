"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cloneNodeSnapshot = cloneNodeSnapshot;
const util_1 = require("../util");
const EntitySnapshot_1 = require("./EntitySnapshot");
const ParameterizedValueSnapshot_1 = require("./ParameterizedValueSnapshot");
/**
 * Factory function for cloning nodes to their specific type signatures, while
 * preserving object shapes.
 */
function cloneNodeSnapshot(parent) {
    const inbound = parent.inbound ? new Map(parent.inbound) : undefined;
    const outbound = parent.outbound ? new Map(parent.outbound) : undefined;
    const parameterized = parent.parameterized ? (0, util_1.getParameterized)((0, util_1.iterParameterized)(parent.parameterized)) : undefined;
    if (parent instanceof EntitySnapshot_1.EntitySnapshot) {
        return new EntitySnapshot_1.EntitySnapshot(parent.data, inbound, outbound, parameterized);
    }
    else if (parent instanceof ParameterizedValueSnapshot_1.ParameterizedValueSnapshot) {
        return new ParameterizedValueSnapshot_1.ParameterizedValueSnapshot(parent.data, inbound, outbound, parameterized);
    }
    else {
        throw new Error(`Unknown node type: ${Object.getPrototypeOf(parent).constructor.name}`);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvbmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjbG9uZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQVVBLDhDQVlDO0FBdEJELGtDQUE4RDtBQUU5RCxxREFBa0Q7QUFFbEQsNkVBQTBFO0FBRTFFOzs7R0FHRztBQUNILFNBQWdCLGlCQUFpQixDQUFDLE1BQW9CO0lBQ3BELE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO0lBQ3JFLE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO0lBQ3hFLE1BQU0sYUFBYSxHQUFHLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLElBQUEsdUJBQWdCLEVBQUMsSUFBQSx3QkFBaUIsRUFBQyxNQUFNLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO0lBRW5ILElBQUksTUFBTSxZQUFZLCtCQUFjLEVBQUUsQ0FBQztRQUNyQyxPQUFPLElBQUksK0JBQWMsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFDM0UsQ0FBQztTQUFNLElBQUksTUFBTSxZQUFZLHVEQUEwQixFQUFFLENBQUM7UUFDeEQsT0FBTyxJQUFJLHVEQUEwQixDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxhQUFhLENBQUMsQ0FBQztJQUN2RixDQUFDO1NBQU0sQ0FBQztRQUNOLE1BQU0sSUFBSSxLQUFLLENBQUMsc0JBQXNCLE1BQU0sQ0FBQyxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7SUFDMUYsQ0FBQztBQUNILENBQUMifQ==