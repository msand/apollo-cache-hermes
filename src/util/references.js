"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.set = void 0;
exports.removeInboundReference = removeInboundReference;
exports.removeOutboundReference = removeOutboundReference;
exports.removeParameterizedReference = removeParameterizedReference;
exports.addInboundReference = addInboundReference;
exports.addOutboundReference = addOutboundReference;
exports.addParameterizedReference = addParameterizedReference;
exports.hasParameterizedReference = hasParameterizedReference;
exports.getIndexOfGivenReference = getIndexOfGivenReference;
exports.safeStringify = safeStringify;
exports.refToInKey = refToInKey;
exports.toInKey = toInKey;
exports.toOutKey = toOutKey;
exports.toParamKey = toParamKey;
exports.getInbound = getInbound;
exports.getOutbound = getOutbound;
exports.getParameterized = getParameterized;
exports.iterParameterized = iterParameterized;
exports.iterRefs = iterRefs;
exports.isReference = isReference;
/**
 * Mutates a snapshot, removing a reference from it.
 */
function removeInboundReference(snapshot, id, path) {
    const map = snapshot.inbound;
    if (!map)
        return;
    const key = toInKey(id, path);
    map.delete(key);
    const empty = map.size === 0;
    if (empty) {
        snapshot.inbound = undefined;
    }
}
function removeOutboundReference(snapshot, path) {
    const map = snapshot.outbound;
    if (!map)
        return;
    const key = toOutKey(path);
    map.delete(key);
    const empty = map.size === 0;
    if (empty) {
        snapshot.outbound = undefined;
    }
}
function removeParameterizedReference(snapshot, id, path) {
    const map = snapshot.parameterized;
    if (!map)
        return;
    const key = toParamKey(path);
    const refs = map.get(key);
    if (!refs)
        return;
    const index = getIndexOfGivenReference(refs, id, path);
    if (index !== -1) {
        refs.splice(index, 1);
    }
    if (refs.length === 0) {
        map.delete(key);
    }
    const empty = map.size === 0;
    if (empty) {
        snapshot.parameterized = undefined;
    }
}
/**
 * Mutates a snapshot, adding a new reference to it.
 */
function addInboundReference(snapshot, id, path) {
    const node = { id, path };
    let references = snapshot.inbound;
    if (!references) {
        references = snapshot.inbound = new Map();
    }
    const key = refToInKey(node);
    references.set(key, node);
}
function addOutboundReference(snapshot, id, path) {
    const node = { id, path };
    let references = snapshot.outbound;
    if (!references) {
        references = snapshot.outbound = new Map();
    }
    const key = toOutKey(path);
    references.set(key, node);
}
function addParameterizedReference(snapshot, id, path) {
    let references = snapshot.parameterized;
    if (!references) {
        references = snapshot.parameterized = new Map();
    }
    const key = toParamKey(path);
    const refs = references.get(key);
    if (refs === undefined) {
        references.set(key, [{ id, path }]);
    }
    else if (getIndexOfGivenReference(refs, id, path) === -1) {
        refs.push({ id, path });
    }
}
/**
 * Return true if { id, path } is a valid reference in the node's references
 * array. Otherwise, return false.
 */
function hasParameterizedReference(snapshot, id, path) {
    var _a;
    const refs = (_a = snapshot.parameterized) === null || _a === void 0 ? void 0 : _a.get(toParamKey(path));
    return refs !== undefined && getIndexOfGivenReference(refs, id, path) > -1;
}
/**
 * Return index of { id, path } reference in references array.
 * Otherwise, return -1.
 */
function getIndexOfGivenReference(references, id, path) {
    return references.findIndex((reference) => {
        const p = reference.path;
        return reference.id === id && path.every((part, i) => part === p[i]);
    });
}
function getCircularReplacer() {
    const ancestors = [];
    return function replacer(_key, value) {
        if (typeof value !== 'object' || value === null) {
            return value;
        }
        // `this` is the object that value is contained in,
        // i.e., its direct parent.
        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
            ancestors.pop();
        }
        if (ancestors.includes(value)) {
            return '[Circular]';
        }
        ancestors.push(value);
        return value;
    };
}
function safeStringify(value) {
    try {
        return JSON.stringify(value, undefined, 2);
    }
    catch (e) {
        try {
            return JSON.stringify(value, getCircularReplacer(), 2);
        }
        catch (error) {
            try {
                if (typeof value === 'object') {
                    const obj = {};
                    Object.entries(value).forEach(([key, val]) => {
                        obj[key] = val == null ? val : Array.isArray(val) ? '[...]' : typeof val === 'object' ? '{...}' : val;
                    });
                    return JSON.stringify(obj, undefined, 2);
                }
            }
            catch (innerError) {
                return error instanceof Error ? error.message : 'Failed to stringify value';
            }
            return error instanceof Error ? error.message : 'Failed to stringify value';
        }
    }
}
function refToInKey({ id, path }) {
    return `${id}.${path.join('.')}`;
}
function toInKey(id, path) {
    return `${id}.${path.join('.')}`;
}
function toOutKey(path) {
    return path.join('.');
}
function toParamKey(path) {
    return path[0].toString();
}
function getInbound(inbound) {
    if (!inbound) {
        return inbound;
    }
    const map = new Map();
    for (const ref of inbound) {
        map.set(refToInKey(ref), ref);
    }
    return map;
}
function getOutbound(outbound) {
    if (!outbound) {
        return outbound;
    }
    const map = new Map();
    for (const out of outbound) {
        map.set(toOutKey(out.path), out);
    }
    return map;
}
function setParameterized(map, node) {
    const key = toParamKey(node.path);
    const arr = map.get(key);
    if (arr === undefined) {
        map.set(key, [node]);
    }
    else {
        arr.push(node);
    }
}
exports.set = setParameterized;
function getParameterized(parameterized) {
    if (!parameterized) {
        return parameterized;
    }
    const map = new Map();
    for (const ref of parameterized) {
        setParameterized(map, ref);
    }
    return map;
}
function* iterParameterized(parameterized) {
    if (!parameterized) {
        return;
    }
    for (const refs of parameterized.values()) {
        for (const ref of refs) {
            yield ref;
        }
    }
}
function* iterRefs(outbound, parameterized) {
    if (parameterized !== undefined) {
        for (const refs of parameterized.values()) {
            for (const ref of refs) {
                yield ref;
            }
        }
    }
    if (outbound !== undefined) {
        for (const ref of outbound.values()) {
            yield ref;
        }
    }
}
function isReference(obj) {
    return obj != null && typeof obj === 'object' && typeof obj.__ref === 'string';
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVmZXJlbmNlcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInJlZmVyZW5jZXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBU0Esd0RBZUM7QUFDRCwwREFjQztBQUNELG9FQXlCQztBQUtELGtEQVlDO0FBQ0Qsb0RBWUM7QUFDRCw4REFnQkM7QUFNRCw4REFPQztBQU1ELDREQUtDO0FBcUJELHNDQXFCQztBQUVELGdDQUVDO0FBQ0QsMEJBRUM7QUFDRCw0QkFFQztBQUNELGdDQUVDO0FBRUQsZ0NBU0M7QUFFRCxrQ0FTQztBQWNELDRDQVNDO0FBRUQsOENBU0M7QUFFRCw0QkFhQztBQUVELGtDQUVDO0FBcFFEOztHQUVHO0FBQ0gsU0FBZ0Isc0JBQXNCLENBQ3BDLFFBQXNCLEVBQ3RCLEVBQVUsRUFDVixJQUFnQjtJQUVoQixNQUFNLEdBQUcsR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDO0lBQzdCLElBQUksQ0FBQyxHQUFHO1FBQUUsT0FBTztJQUVqQixNQUFNLEdBQUcsR0FBRyxPQUFPLENBQUMsRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQzlCLEdBQUcsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7SUFFaEIsTUFBTSxLQUFLLEdBQUcsR0FBRyxDQUFDLElBQUksS0FBSyxDQUFDLENBQUM7SUFDN0IsSUFBSSxLQUFLLEVBQUUsQ0FBQztRQUNWLFFBQVEsQ0FBQyxPQUFPLEdBQUcsU0FBUyxDQUFDO0lBQy9CLENBQUM7QUFDSCxDQUFDO0FBQ0QsU0FBZ0IsdUJBQXVCLENBQ3JDLFFBQXNCLEVBQ3RCLElBQWdCO0lBRWhCLE1BQU0sR0FBRyxHQUFHLFFBQVEsQ0FBQyxRQUFRLENBQUM7SUFDOUIsSUFBSSxDQUFDLEdBQUc7UUFBRSxPQUFPO0lBRWpCLE1BQU0sR0FBRyxHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMzQixHQUFHLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBRWhCLE1BQU0sS0FB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