"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deepGet = deepGet;
exports.pathBeginsWith = pathBeginsWith;
exports.addToSet = addToSet;
exports.lazyImmutableDeepSet = lazyImmutableDeepSet;
exports.setsHaveSomeIntersection = setsHaveSomeIntersection;
/**
 * Gets a nested value, with support for blank paths.
 */
function deepGet(target, path) {
    let index = 0;
    const { length } = path;
    while (target != null && index < length) {
        target = target[path[index++]];
    }
    return target;
}
function pathBeginsWith(target, prefix) {
    if (target.length < prefix.length)
        return false;
    for (let i = 0; i < prefix.length; i++) {
        if (prefix[i] !== target[i])
            return false;
    }
    return true;
}
/**
 * Adds values to a set, mutating it.
 */
function addToSet(target, source) {
    for (const value of source) {
        target.add(value);
    }
}
/**
 * An immutable deep set, where it only creates containers (objects/arrays) if
 * they differ from the _original_ object copied from - even if
 * `_setValue` is called against it multiple times.
 */
function lazyImmutableDeepSet(target, original, path, value, deleted) {
    if (!path.length)
        return value;
    let parentNode;
    let targetNode = target;
    let originalNode = original;
    // We assume that the last path component is the key of a value; not a
    // container, so we stop there.
    for (let i = 0; i < path.length; i++) {
        const key = path[i];
        // If the target still references the original's objects, we need to diverge
        if (!targetNode || targetNode === originalNode || !Object.isExtensible(targetNode)) {
            if (typeof key === 'number') {
                targetNode = originalNode ? [...originalNode] : [];
            }
            else if (typeof key === 'string') {
                targetNode = originalNode ? Object.assign({}, originalNode) : {};
            }
            else {
                throw new Error(`Unknown path type ${JSON.stringify(key)} in path ${JSON.stringify(path)} at index ${i}`);
            }
            if (i === 0) {
                // Make sure we have a reference to the new target. We can keep the
                // reference here because "target" is pointing as currentNode.data.
                target = targetNode;
            }
            else {
                parentNode[path[i - 1]] = targetNode;
            }
        }
        // Regardless, we keep walking deeper.
        parentNode = targetNode;
        targetNode = targetNode[key];
        originalNode = originalNode && originalNode[key];
    }
    if (deleted) {
        delete parentNode[path[path.length - 1]];
    }
    else {
        // Finally, set the value in our previously or newly cloned target.
        parentNode[path[path.length - 1]] = value;
    }
    return target;
}
function setsHaveSomeIntersection(left, right) {
    // Walk the smaller set.
    const [toIterate, toCheck] = left.size > right.size ? [right, left] : [left, right];
    for (const value of toIterate) {
        if (toCheck.has(value))
            return true;
    }
    return false;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29sbGVjdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvbGxlY3Rpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFLQSwwQkFRQztBQUVELHdDQU1DO0FBS0QsNEJBSUM7QUFPRCxvREFpREM7QUFFRCw0REFRQztBQTlGRDs7R0FFRztBQUNILFNBQWdCLE9BQU8sQ0FBQyxNQUFXLEVBQUUsSUFBZ0I7SUFDbkQsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDO0lBQ2QsTUFBTSxFQUFFLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQztJQUN4QixPQUFPLE1BQU0sSUFBSSxJQUFJLElBQUksS0FBSyxHQUFHLE1BQU0sRUFBRSxDQUFDO1FBQ3hDLE1BQU0sR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQztJQUNqQyxDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUM7QUFDaEIsQ0FBQztBQUVELFNBQWdCLGNBQWMsQ0FBQyxNQUFrQixFQUFFLE1BQWtCO0lBQ25FLElBQUksTUFBTSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTTtRQUFFLE9BQU8sS0FBSyxDQUFDO0lBQ2hELEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7UUFDdkMsSUFBSSxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssTUFBTSxDQUFDLENBQUMsQ0FBQztZQUFFLE9BQU8sS0FBSyxDQUFDO0lBQzVDLENBQUM7SUFDRCxPQUFPLElBQUksQ0FBQztBQUNkLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLFFBQVEsQ0FBSSxNQUFjLEVBQUUsTUFBbUI7SUFDN0QsS0FBSyxNQUFNLEtBQUssSUFBSSxNQUFNLEVBQUUsQ0FBQztRQUMzQixNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3BCLENBQUM7QUFDSCxDQUFDO0FB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