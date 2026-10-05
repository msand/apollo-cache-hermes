"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OptimisticUpdateQueue = void 0;
const operations_1 = require("./operations");
/**
 * Manages a queue of optimistic updates, and the values they express on top of
 * existing cache snapshots.
 */
class OptimisticUpdateQueue {
    constructor(
    /**
     * The queue of updates, in order of oldest (lowest precedence) to newest
     * (highest precedence).
     */
    _updates = []) {
        this._updates = _updates;
    }
    /**
     * Appends a new optimistic update to the queue.
     */
    enqueue(id, deltas) {
        // TODO: Assert unique change ids.
        return new OptimisticUpdateQueue([...this._updates, { id, deltas }]);
    }
    /**
     * Removes an update from the queue.
     */
    remove(id) {
        return new OptimisticUpdateQueue(this._updates.filter(u => u.id !== id));
    }
    /**
     * Whether there are any updates to apply.
     */
    hasUpdates() {
        return this._updates.length > 0;
    }
    /**
     * Applies the current optimistic updates to a snapshot.
     */
    apply(context, snapshot) {
        const editor = new operations_1.SnapshotEditor(context, snapshot);
        for (const update of this._updates) {
            for (const delta of update.deltas) {
                if ('query' in delta) {
                    editor.mergePayload(delta.query, delta.payload, false);
                }
                else if ('delete' in delta) {
                    editor.delete(delta.delete);
                }
                else if ('id' in delta) {
                    const seenObjects = new Set();
                    editor.modify(delta.id, delta.payload, delta.deleted, seenObjects);
                }
            }
        }
        return editor.commit();
    }
}
exports.OptimisticUpdateQueue = OptimisticUpdateQueue;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiT3B0aW1pc3RpY1VwZGF0ZVF1ZXVlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiT3B0aW1pc3RpY1VwZGF0ZVF1ZXVlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLDZDQUE4QztBQVk5Qzs7O0dBR0c7QUFDSCxNQUFhLHFCQUFxQjtJQUVoQztJQUNFOzs7T0FHRztJQUNLLFdBQVcsRUFBd0I7UUFBbkMsYUFBUSxHQUFSLFFBQVEsQ0FBMkI7SUFDMUMsQ0FBQztJQUVKOztPQUVHO0lBQ0gsT0FBTyxDQUFDLEVBQVksRUFBRSxNQUFvQjtRQUN4QyxrQ0FBa0M7UUFDbEMsT0FBTyxJQUFJLHFCQUFxQixDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsUUFBUSxFQUFFLEVBQUUsRUFBRSxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUMsQ0FBQztJQUN2RSxDQUFDO0lBRUQ7O09BRUc7SUFDSCxNQUFNLENBQUMsRUFBWTtRQUNqQixPQUFPLElBQUkscUJBQXFCLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDM0UsQ0FBQztJQUVEOztPQUVHO0lBQ0gsVUFBVTtRQUNSLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0lBQ2xDLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBYyxPQUFrQyxFQUFFLFFBQXVCO1FBQzVFLE1BQU0sTUFBTSxHQUFHLElBQUksMkJBQWMsQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDckQsS0FBSyxNQUFNLE1BQU0sSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDbkMsS0FBSyxNQUFNLEtBQUssSUFBSSxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUM7Z0JBQ2xDLElBQUksT0FBTyxJQUFJLEtBQUssRUFBRSxDQUFDO29CQUNyQixNQUFNLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLE9BQXFCLEVBQUUsS0FBSyxDQUFDLENBQUM7Z0JBQ3ZFLENBQUM7cUJBQU0sSUFBSSxRQUFRLElBQUksS0FBSyxFQUFFLENBQUM7b0JBQzdCLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDO2dCQUM5QixDQUFDO3FCQUFNLElBQUksSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO29CQUN6QixNQUFNLFdBQVcsR0FBRyxJQUFJLEdBQUcsRUFBaUIsQ0FBQztvQkFDN0MsTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQyxPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU8sRUFBRSxXQUFXLENBQUMsQ0FBQztnQkFDckUsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUM7SUFDekIsQ0FBQztDQUVGO0FBckRELHNEQXFEQyJ9