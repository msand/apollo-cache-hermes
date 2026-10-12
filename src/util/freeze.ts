/**
 * Deeply freezes plain objects and arrays.
 *
 * Class instances (e.g. a client or subscription stored as a scalar value) are
 * left alone, since freezing them would break the live objects they belong to.
 */
export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    Object.freeze(value);
    for (const item of value) deepFreeze(item);
  } else if (isPlainObject(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function isPlainObject(value: unknown): value is object {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
