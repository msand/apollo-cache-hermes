"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertValidEnvironment = assertValidEnvironment;
const errors_1 = require("./errors");
/**
 * Hermes relies on some ES6 functionality: iterators (via Symbol.iterator),
 * Sets, and Maps.
 *
 * Unfortunately, it can be tricky to polyfill correctly (and some environments
 * don't do it properly. Looking at you react-native on android). So, let's make
 * sure that everything is in a happy state, and complain otherwise.
 */
function assertValidEnvironment() {
    const missingBehavior = [];
    if (!_isSymbolPolyfilled())
        missingBehavior.push('Symbol');
    if (!_isSetPolyfilled())
        missingBehavior.push('Set');
    if (!_isMapPolyfilled())
        missingBehavior.push('Map');
    if (!missingBehavior.length)
        return;
    throw new errors_1.InvalidEnvironmentError({
        message: `Hermes requires some ES2015 features that your current environment lacks: `
            + `${missingBehavior.join(', ')}. Please polyfill!`,
        infoUrl: `https://bit.ly/2SGa7uz`,
    });
}
function _isSymbolPolyfilled() {
    if (typeof Symbol !== 'function')
        return false;
    if (!Symbol.iterator)
        return false;
    return true;
}
function _isSetPolyfilled() {
    if (typeof Set !== 'function')
        return false;
    if (!_isSymbolPolyfilled())
        return false;
    if (typeof (new Set)[Symbol.iterator] !== 'function')
        return false;
    return true;
}
function _isMapPolyfilled() {
    if (typeof Set !== 'function')
        return false;
    if (!_isSymbolPolyfilled())
        return false;
    if (typeof (new Set)[Symbol.iterator] !== 'function')
        return false;
    return true;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW52aXJvbm1lbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJlbnZpcm9ubWVudC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQVVBLHdEQVlDO0FBdEJELHFDQUFtRDtBQUVuRDs7Ozs7OztHQU9HO0FBQ0gsU0FBZ0Isc0JBQXNCO0lBQ3BDLE1BQU0sZUFBZSxHQUFhLEVBQUUsQ0FBQztJQUNyQyxJQUFJLENBQUMsbUJBQW1CLEVBQUU7UUFBRSxlQUFlLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQzNELElBQUksQ0FBQyxnQkFBZ0IsRUFBRTtRQUFFLGVBQWUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDckQsSUFBSSxDQUFDLGdCQUFnQixFQUFFO1FBQUUsZUFBZSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUNyRCxJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU07UUFBRSxPQUFPO0lBRXBDLE1BQU0sSUFBSSxnQ0FBdUIsQ0FBQztRQUNoQyxPQUFPLEVBQUUsNEVBQTRFO2NBQ2pGLEdBQUcsZUFBZSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsb0JBQW9CO1FBQ3JELE9BQU8sRUFBRSx3QkFBd0I7S0FDbEMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQztBQUVELFNBQVMsbUJBQW1CO0lBQzFCLElBQUksT0FBTyxNQUFNLEtBQUssVUFBVTtRQUFFLE9BQU8sS0FBSyxDQUFDO0lBQy9DLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUTtRQUFFLE9BQU8sS0FBSyxDQUFDO0lBRW5DLE9BQU8sSUFBSSxDQUFDO0FBQ2QsQ0FBQztBQUVELFNBQVMsZ0JBQWdCO0lBQ3ZCLElBQUksT0FBTyxHQUFHLEtBQUssVUFBVTtRQUFFLE9BQU8sS0FBSyxDQUFDO0lBQzVDLElBQUksQ0FBQyxtQkFBbUIsRUFBRTtRQUFFLE9BQU8sS0FBSyxDQUFDO0lBQ3pDLElBQUksT0FBTyxDQUFDLElBQUksR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLFVBQVU7UUFBRSxPQUFPLEtBQUssQ0FBQztJQUVuRSxPQUFPLElBQUksQ0FBQztBQUNkLENBQUM7QUFFRCxTQUFTLGdCQUFnQjtJQUN2QixJQUFJLE9BQU8sR0FBRyxLQUFLLFVBQVU7UUFBRSxPQUFPLEtBQUssQ0FBQztJQUM1QyxJQUFJLENBQUMsbUJBQW1CLEVBQUU7UUFBRSxPQUFPLEtBQUssQ0FBQztJQUN6QyxJQUFJLE9BQU8sQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsS0FBSyxVQUFVO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFFbkUsT0FBTyxJQUFJLENBQUM7QUFDZCxDQUFDIn0=