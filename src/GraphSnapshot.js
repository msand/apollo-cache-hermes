"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraphSnapshot = void 0;
const deepFreeze = require("deep-freeze-strict");
/**
 * Maintains an identity map of all value snapshots that reference into a
 * particular version of the graph.
 *
 * Provides an immutable view into the graph at a point in time.
 *
 * Also provides a place to hang per-snapshot caches off of.
 */
class GraphSnapshot {
    /**
     * @internal
     */
    constructor(
    // TODO: Profile Object.create(null) vs Map.
    _values = Object.create(null)) {
        this._values = _values;
        /** Cached results for queries. */
        this.readCache = new Map();
    }
    /**
     * Retrieves the value identified by `id`.
     */
    getNodeData(id) {
        const snapshot = this.getNodeSnapshot(id);
        return snapshot ? snapshot.data : undefined;
    }
    /**
     * Returns whether `id` exists as an value in the graph.
     */
    has(id) {
        return id in this._values;
    }
    /**
     * Retrieves the snapshot for the value identified by `id`.
     *
     * @internal
     */
    getNodeSnapshot(id) {
        return this._values[id];
    }
    /**
     * Returns the set of ids present in the snapshot.
     *
     * @internal
     */
    allNodeIds() {
        return Object.keys(this._values);
    }
    /**
     * Freezes the snapshot (generally for development mode)
     *
     * @internal
     */
    freeze() {
        deepFreeze(this._values);
    }
}
exports.GraphSnapshot = GraphSnapshot;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiR3JhcGhTbmFwc2hvdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIkdyYXBoU25hcHNob3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsaURBQWtEO0FBT2xEOzs7Ozs7O0dBT0c7QUFDSCxNQUFhLGFBQWE7SUFLeEI7O09BRUc7SUFDSDtJQUNFLDRDQUE0QztJQUNyQyxVQUEyQixNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQztRQUE5QyxZQUFPLEdBQVAsT0FBTyxDQUF1QztRQVJ2RCxrQ0FBa0M7UUFDbEIsY0FBUyxHQUFHLElBQUksR0FBRyxFQUEwRSxDQUFDO0lBUTNHLENBQUM7SUFFSjs7T0FFRztJQUNILFdBQVcsQ0FBQyxFQUFVO1FBQ3BCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDMUMsT0FBTyxRQUFRLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztJQUM5QyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxHQUFHLENBQUMsRUFBVTtRQUNaLE9BQU8sRUFBRSxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUM7SUFDNUIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxlQUFlLENBQUMsRUFBVTtRQUN4QixPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDMUIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxVQUFVO1FBQ1IsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNuQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE1BQU07UUFDSixVQUFVLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQzNCLENBQUM7Q0FFRjtBQXZERCxzQ0F1REMifQ==