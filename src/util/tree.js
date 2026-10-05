"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.walkOperation = walkOperation;
exports.get = get;
class OperationWalkNode {
    constructor(parsedOperation, path, parent) {
        this.parsedOperation = parsedOperation;
        this.path = path;
        this.parent = parent;
    }
}
/**
 * Walk and run on ParsedQueryNode and the result.
 * This is used to verify result of the read operation.
 */
function walkOperation(rootOperation, result, visitor) {
    // Perform the walk as a depth-first traversal; and unlike the payload walk,
    // we don't bother tracking the path.
    const queue = [new OperationWalkNode(rootOperation, [], result)];
    for (let q = 0; q < queue.length; q++) {
        const { parsedOperation, parent, path } = queue[q];
        // We consider null nodes to be skippable (and satisfy the walk).
        if (parent === null)
            continue;
        // Fan-out for arrays.
        if (Array.isArray(parent)) {
            for (let i = 0, l = parent.length; i < l; i++) {
                queue.push(new OperationWalkNode(parsedOperation, [...path, i], parent[i]));
            }
            continue;
        }
        const fields = [];
        // TODO: Directives?
        for (const fieldName in parsedOperation) {
            fields.push(fieldName);
            const nextParsedQuery = parsedOperation[fieldName].children;
            if (nextParsedQuery) {
                queue.push(new OperationWalkNode(nextParsedQuery, [...path, fieldName], get(parent, fieldName)));
            }
        }
        if (fields.length) {
            const shouldStop = visitor(parent, fields, path);
            if (shouldStop)
                return;
        }
    }
}
function get(value, key) {
    // Remember: arrays are typeof 'object', too.
    return value !== null && typeof value === 'object' ? value[key] : undefined;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJlZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInRyZWUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFvQkEsc0NBa0NDO0FBRUQsa0JBR0M7QUF4REQsTUFBTSxpQkFBaUI7SUFDckIsWUFDa0IsZUFBeUMsRUFDekMsSUFBeUIsRUFDekIsTUFBa0I7UUFGbEIsb0JBQWUsR0FBZixlQUFlLENBQTBCO1FBQ3pDLFNBQUksR0FBSixJQUFJLENBQXFCO1FBQ3pCLFdBQU0sR0FBTixNQUFNLENBQVk7SUFDakMsQ0FBQztDQUNMO0FBT0Q7OztHQUdHO0FBQ0gsU0FBZ0IsYUFBYSxDQUFDLGFBQXVDLEVBQUUsTUFBOEIsRUFBRSxPQUF5QjtJQUU5SCw0RUFBNEU7SUFDNUUscUNBQXFDO0lBQ3JDLE1BQU0sS0FBSyxHQUFHLENBQUMsSUFBSSxpQkFBaUIsQ0FBQyxhQUFhLEVBQUUsRUFBRSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUM7SUFFakUsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztRQUN0QyxNQUFNLEVBQUUsZUFBZSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFFLENBQUM7UUFDcEQsaUVBQWlFO1FBQ2pFLElBQUksTUFBTSxLQUFLLElBQUk7WUFBRSxTQUFTO1FBRTlCLHNCQUFzQjtRQUN0QixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztZQUMxQixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7Z0JBQzlDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxpQkFBaUIsQ0FBQyxlQUFlLEVBQUUsQ0FBQyxHQUFHLElBQUksRUFBRSxDQUFDLENBQUMsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzlFLENBQUM7WUFDRCxTQUFTO1FBQ1gsQ0FBQztRQUVELE1BQU0sTUFBTSxHQUFhLEVBQUUsQ0FBQztRQUM1QixvQkFBb0I7UUFDcEIsS0FBSyxNQUFNLFNBQVMsSUFBSSxlQUFlLEVBQUUsQ0FBQztZQUN4QyxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQ3ZCLE1BQU0sZUFBZSxHQUFHLGVBQWUsQ0FBQyxTQUFTLENBQUMsQ0FBQyxRQUFRLENBQUM7WUFDNUQsSUFBSSxlQUFlLEVBQUUsQ0FBQztnQkFDcEIsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLGlCQUFpQixDQUFDLGVBQWUsRUFBRSxDQUFDLEdBQUcsSUFBSSxFQUFFLFNBQVMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxNQUFNLEVBQUUsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ25HLENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDbEIsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUM7WUFDakQsSUFBSSxVQUFVO2dCQUFFLE9BQU87UUFDekIsQ0FBQztJQUNILENBQUM7QUFDSCxDQUFDO0FBRUQsU0FBZ0IsR0FBRyxDQUFDLEtBQVUsRUFBRSxHQUFhO0lBQzNDLDZDQUE2QztJQUM3QyxPQUFPLEtBQUssS0FBSyxJQUFJLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztBQUM5RSxDQUFDIn0=