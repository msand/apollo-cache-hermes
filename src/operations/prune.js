"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prune = prune;
const GraphSnapshot_1 = require("../GraphSnapshot");
const read_1 = require("./read");
const write_1 = require("./write");
/**
 * Return a new graph snapshot pruned to just the shape of the given query
 */
function prune(context, snapshot, raw) {
    const queryResult = (0, read_1.read)(context, raw, snapshot, Object.create(null));
    const pruned = (0, write_1.write)(context, new GraphSnapshot_1.GraphSnapshot(), raw, queryResult.result ? queryResult.result : {}, true);
    return {
        snapshot: pruned.snapshot,
        complete: queryResult.complete,
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJ1bmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJwcnVuZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQVdBLHNCQWFDO0FBdkJELG9EQUFpRDtBQUlqRCxpQ0FBOEI7QUFDOUIsbUNBQWdDO0FBRWhDOztHQUVHO0FBQ0gsU0FBZ0IsS0FBSyxDQUFjLE9BQWtDLEVBQUUsUUFBdUIsRUFBRSxHQUFpQjtJQUMvRyxNQUFNLFdBQVcsR0FBRyxJQUFBLFdBQUksRUFBQyxPQUFPLEVBQUUsR0FBRyxFQUFFLFFBQVEsRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDdEUsTUFBTSxNQUFNLEdBQUcsSUFBQSxhQUFLLEVBQ2xCLE9BQU8sRUFDUCxJQUFJLDZCQUFhLEVBQUUsRUFDbkIsR0FBRyxFQUNILFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQWdCLEVBQzFELElBQUksQ0FDTCxDQUFDO0lBQ0YsT0FBTztRQUNMLFFBQVEsRUFBRSxNQUFNLENBQUMsUUFBUTtRQUN6QixRQUFRLEVBQUUsV0FBVyxDQUFDLFFBQVE7S0FDL0IsQ0FBQztBQUNKLENBQUMifQ==