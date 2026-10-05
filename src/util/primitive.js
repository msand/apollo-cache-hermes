"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasOwn = void 0;
exports.isScalar = isScalar;
exports.isObject = isObject;
exports.isNil = isNil;
exports.isNumber = isNumber;
exports.verboseTypeof = verboseTypeof;
exports.ifString = ifString;
function isScalar(value) {
    return value === null || typeof value !== 'object';
}
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isNil(value) {
    return value === null || value === undefined || Number.isNaN(value);
}
function isNumber(element) {
    return typeof element === 'number' && !Number.isNaN(element);
}
function verboseTypeof(value) {
    if (value === null) {
        return 'null';
    }
    return typeof value;
}
exports.hasOwn = Object.prototype.hasOwnProperty;
function ifString(value) {
    return typeof value === 'string' ? value : undefined;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJpbWl0aXZlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicHJpbWl0aXZlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLDRCQUVDO0FBRUQsNEJBRUM7QUFFRCxzQkFFQztBQUVELDRCQUVDO0FBRUQsc0NBS0M7QUFJRCw0QkFFQztBQTNCRCxTQUFnQixRQUFRLENBQUMsS0FBVTtJQUNqQyxPQUFPLEtBQUssS0FBSyxJQUFJLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxDQUFDO0FBQ3JELENBQUM7QUFFRCxTQUFnQixRQUFRLENBQUMsS0FBVTtJQUNqQyxPQUFPLEtBQUssS0FBSyxJQUFJLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUM5RSxDQUFDO0FBRUQsU0FBZ0IsS0FBSyxDQUFDLEtBQVU7SUFDOUIsT0FBTyxLQUFLLEtBQUssSUFBSSxJQUFJLEtBQUssS0FBSyxTQUFTLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUN0RSxDQUFDO0FBRUQsU0FBZ0IsUUFBUSxDQUFDLE9BQVk7SUFDbkMsT0FBTyxPQUFPLE9BQU8sS0FBSyxRQUFRLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0FBQy9ELENBQUM7QUFFRCxTQUFnQixhQUFhLENBQUMsS0FBVTtJQUN0QyxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsQ0FBQztRQUNuQixPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO0lBQ0QsT0FBTyxPQUFPLEtBQUssQ0FBQztBQUN0QixDQUFDO0FBRThCLGNBQU0sR0FBSyxNQUFNLENBQUMsU0FBUyxnQkFBQztBQUUzRCxTQUFnQixRQUFRLENBQUMsS0FBYztJQUNyQyxPQUFPLE9BQU8sS0FBSyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7QUFDdkQsQ0FBQyJ9