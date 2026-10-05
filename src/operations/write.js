"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.write = write;
const SnapshotEditor_1 = require("./SnapshotEditor");
/**
 * Merges a payload with an existing graph snapshot, generating a new one.
 *
 * Performs the minimal set of edits to generate new immutable versions of each
 * node, while preserving immutability of the parent snapshot.
 */
function write(context, snapshot, raw, payload, prune = false) {
    let tracerContext;
    if (context.tracer.writeStart) {
        tracerContext = context.tracer.writeStart(raw, payload);
    }
    // We _could_ go purely functional with the editor, but it's honestly pretty
    // convenient to follow the builder function instead - it'd end up passing
    // around a context object anyway.
    const editor = new SnapshotEditor_1.SnapshotEditor(context, snapshot);
    const { warnings, ref } = editor.mergePayload(raw, payload, prune);
    const newSnapshot = editor.commit(ref);
    if (context.tracer.writeEnd) {
        context.tracer.writeEnd(context.parseOperation(raw), { payload, newSnapshot, warnings }, tracerContext);
    }
    return newSnapshot;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid3JpdGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJ3cml0ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQWFBLHNCQXdCQztBQWhDRCxxREFBa0U7QUFFbEU7Ozs7O0dBS0c7QUFDSCxTQUFnQixLQUFLLENBQ25CLE9BQWtDLEVBQ2xDLFFBQXVCLEVBQ3ZCLEdBQWlCLEVBQ2pCLE9BQW1CLEVBQ25CLFFBQWlCLEtBQUs7SUFFdEIsSUFBSSxhQUFhLENBQUM7SUFDbEIsSUFBSSxPQUFPLENBQUMsTUFBTSxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQzlCLGFBQWEsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxHQUFHLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDMUQsQ0FBQztJQUVELDRFQUE0RTtJQUM1RSwwRUFBMEU7SUFDMUUsa0NBQWtDO0lBQ2xDLE1BQU0sTUFBTSxHQUFHLElBQUksK0JBQWMsQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDckQsTUFBTSxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsR0FBRyxNQUFNLENBQUMsWUFBWSxDQUFDLEdBQUcsRUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDbkUsTUFBTSxXQUFXLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUV2QyxJQUFJLE9BQU8sQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDNUIsT0FBTyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFDMUcsQ0FBQztJQUVELE9BQU8sV0FBVyxDQUFDO0FBQ3JCLENBQUMifQ==