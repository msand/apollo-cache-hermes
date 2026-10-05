import { JsonObject, Nil, Scalar } from '../primitive';
export declare function isScalar(value: any): value is Scalar;
export declare function isObject(value: any): value is JsonObject;
export declare function isNil(value: any): value is Nil;
export declare function isNumber(element: any): element is Number;
export declare function verboseTypeof(value: any): string;
export declare const hasOwn: (v: PropertyKey) => boolean;
export declare function ifString(value: unknown): string | undefined;
//# sourceMappingURL=primitive.d.ts.map