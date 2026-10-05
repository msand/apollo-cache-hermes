"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionSetIsStatic = exports.ConsoleTracer = exports.Cache = exports.Hermes = void 0;
const tslib_1 = require("tslib");
const environment_1 = require("./environment");
// Try to detect environment misconfiguration early.
(0, environment_1.assertValidEnvironment)();
tslib_1.__exportStar(require("./errors"), exports);
var apollo_1 = require("./apollo");
Object.defineProperty(exports, "Hermes", { enumerable: true, get: function () { return apollo_1.Hermes; } });
var Cache_1 = require("./Cache");
Object.defineProperty(exports, "Cache", { enumerable: true, get: function () { return Cache_1.Cache; } });
var ConsoleTracer_1 = require("./context/ConsoleTracer");
Object.defineProperty(exports, "ConsoleTracer", { enumerable: true, get: function () { return ConsoleTracer_1.ConsoleTracer; } });
var util_1 = require("./util");
Object.defineProperty(exports, "selectionSetIsStatic", { enumerable: true, get: function () { return util_1.selectionSetIsStatic; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7O0FBQUEsK0NBQXVEO0FBRXZELG9EQUFvRDtBQUNwRCxJQUFBLG9DQUFzQixHQUFFLENBQUM7QUFFekIsbURBQXlCO0FBQ3pCLG1DQUFrQztBQUF6QixnR0FBQSxNQUFNLE9BQUE7QUFDZixpQ0FBOEM7QUFBckMsOEZBQUEsS0FBSyxPQUFBO0FBQ2QseURBQXdEO0FBQS9DLDhHQUFBLGFBQWEsT0FBQTtBQUN0QiwrQkFBOEM7QUFBckMsNEdBQUEsb0JBQW9CLE9BQUEifQ==