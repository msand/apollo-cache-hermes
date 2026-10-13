import { CacheContext } from './context';
import { GraphSnapshot } from './GraphSnapshot';
import { SnapshotEditor } from './operations';
import type { IsRetained } from './operations/SnapshotEditor';
import { JsonObject } from './primitive';
import { ChangeId, NodeId, CacheDelta } from './schema';

/**
 * Tracks an individual optimistic update (a layer, in InMemoryCache terms).
 */
export interface OptimisticUpdate {
  id: ChangeId;
  /** The edits recorded the last time the update ran. */
  deltas: CacheDelta[];
  /**
   * The transaction callback that produced the deltas. Like InMemoryCache's
   * layers, the callback is re-run when an update beneath it is removed, so
   * that it can pick up the new data beneath it.
   */
  callback?: (transaction: any) => any;
}

/**
 * Manages a queue of optimistic updates, and the values they express on top of
 * existing cache snapshots.
 */
export class OptimisticUpdateQueue {
  constructor(
    /**
     * The queue of updates, in order of oldest (lowest precedence) to newest
     * (highest precedence).
     */
    private _updates = [] as OptimisticUpdate[],
  ) {}

  /**
   * Appends a new optimistic update to the queue.
   */
  enqueue(id: ChangeId, deltas: CacheDelta[], callback?: OptimisticUpdate['callback']): OptimisticUpdateQueue {
    // Several updates may share an id; remove() drops all of them.
    return new OptimisticUpdateQueue([...this._updates, { id, deltas, callback }]);
  }

  /**
   * Splits the queue around the updates with the given id, as needed to remove
   * them: the updates below the first match keep their recorded deltas, while
   * the ones above it must be re-run against the new data beneath them.
   *
   * Returns undefined if no update has the id.
   */
  split(id: ChangeId): { below: OptimisticUpdateQueue; above: OptimisticUpdate[] } | undefined {
    const index = this._updates.findIndex(u => u.id === id);
    if (index < 0) return undefined;
    return {
      below: new OptimisticUpdateQueue(this._updates.slice(0, index)),
      above: this._updates.slice(index + 1).filter(u => u.id !== id),
    };
  }

  /**
   * Appends edits to every update; used to evict data from all layers.
   */
  appendToAll(deltas: CacheDelta[]): OptimisticUpdateQueue {
    return new OptimisticUpdateQueue(this._updates.map(u => ({ ...u, deltas: [...u.deltas, ...deltas] })));
  }

  /**
   * Whether there is an update with the given id.
   */
  has(id: ChangeId): boolean {
    return this._updates.some(u => u.id === id);
  }

  /**
   * Whether there are any updates to apply.
   */
  hasUpdates(): boolean {
    return this._updates.length > 0;
  }

  /**
   * Applies the recorded deltas of the current optimistic updates to a
   * snapshot.  Like InMemoryCache's layers (which keep the fields they wrote
   * when the data beneath them changes), the updates are not re-run here.
   *
   * `isRetained` tells the retained nodes (see SnapshotEditor), which the
   * replayed writes must keep, as the original writes did.
   */
  apply<TSerialized>(
    context: CacheContext<TSerialized>,
    snapshot: GraphSnapshot,
    isRetained: IsRetained | undefined,
  ): { snapshot: GraphSnapshot; editedNodeIds: Set<NodeId> } {
    const editor = new SnapshotEditor(context, snapshot, isRetained);
    for (const update of this._updates) {
      applyDeltas(editor, update.deltas);
    }

    return editor.commit();
  }
}

/**
 * Applies recorded optimistic edits to a snapshot editor.
 */
export function applyDeltas<TSerialized>(editor: SnapshotEditor<TSerialized>, deltas: CacheDelta[]) {
  for (const delta of deltas) {
    if ('query' in delta) {
      editor.mergePayload(delta.query, delta.payload as JsonObject, false);
    } else if ('delete' in delta) {
      editor.delete(delta.delete);
    } else if ('id' in delta) {
      const seenObjects = new Set<object | null>();
      editor.modify(delta.id, delta.payload, delta.deleted, seenObjects);
    }
  }
}
