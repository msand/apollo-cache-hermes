"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsoleTracer = void 0;
const INDENT = '  ';
/**
 * The default tracer used by the cache.
 *
 * By default it logs only warnings, but a verbose mode can be enabled to log
 * out all cache operations.
 */
class ConsoleTracer {
    constructor(_verbose, _logger = ConsoleTracer.DefaultLogger) {
        this._verbose = _verbose;
        this._logger = _logger;
        // Used when emulating grouping behavior.
        this._indent = 0;
    }
    warning(message, ...metadata) {
        if (this._verbose)
            return;
        this._emit('warn', message, ...metadata);
    }
    readEnd(operation, info) {
        if (!this._verbose)
            return;
        const message = this.formatOperation('read', operation);
        if (info.cacheHit) {
            this._emit('debug', `${message} (cached)`, info.result);
        }
        else {
            this._emit('info', message, info.result);
        }
    }
    writeEnd(operation, info) {
        if (!this._verbose)
            return;
        const { payload, newSnapshot, warnings } = info;
        const message = this.formatOperation('write', operation);
        // Extended logging for writes that trigger warnings.
        if (warnings) {
            this._group(message, () => {
                this._emit('warn', 'payload with warnings:', payload);
                for (const warning of warnings) {
                    this._emit('warn', warning);
                }
                this._emit('debug', 'new snapshot:', newSnapshot);
            });
        }
        else {
            this._emit('debug', message, { payload, newSnapshot });
        }
    }
    transactionEnd(error) {
        if (error) {
            this._emit('warn', `Rolling transaction back due to error:`, error);
        }
    }
    formatOperation(action, operation) {
        const { operationType, operationName } = operation.info;
        return `${action}(${operationType} ${operationName})`;
    }
    // Internal
    _emit(level, message, ...metadata) {
        if (this._indent) {
            for (let i = 0; i < this._indent; i++) {
                message = `${INDENT}${message}`;
            }
        }
        this._logger[level](message, ...metadata);
    }
    _group(message, callback) {
        this._groupStart(message);
        try {
            callback();
        }
        finally {
            this._groupEnd();
        }
    }
    _groupStart(message) {
        if (this._logger.group && this._logger.groupEnd) {
            this._logger.group(message);
        }
        else {
            this._indent += 1;
            this._logger.info(message);
        }
    }
    _groupEnd() {
        if (this._logger.group && this._logger.groupEnd) {
            this._logger.groupEnd();
        }
        else {
            this._indent -= 1;
        }
    }
}
exports.ConsoleTracer = ConsoleTracer;
(function (ConsoleTracer) {
    ConsoleTracer.DefaultLogger = {
        debug: _makeDefaultEmitter('debug'),
        info: _makeDefaultEmitter('info'),
        warn: _makeDefaultEmitter('warn'),
        // Grouping:
        group: _makeDefaultEmitter('group'),
        groupEnd: console.groupEnd ? console.groupEnd.bind(console) : () => { },
    };
})(ConsoleTracer || (exports.ConsoleTracer = ConsoleTracer = {}));
function _makeDefaultEmitter(level) {
    const method = console[level] || console.log;
    return function defaultLogger(message, ...args) {
        method.call(console, `[Cache] ${message}`, ...args);
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ29uc29sZVRyYWNlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIkNvbnNvbGVUcmFjZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBSUEsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDO0FBRXBCOzs7OztHQUtHO0FBQ0gsTUFBYSxhQUFhO0lBS3hCLFlBQ1UsUUFBaUIsRUFDakIsVUFBZ0MsYUFBYSxDQUFDLGFBQWE7UUFEM0QsYUFBUSxHQUFSLFFBQVEsQ0FBUztRQUNqQixZQUFPLEdBQVAsT0FBTyxDQUFvRDtRQUxyRSx5Q0FBeUM7UUFDakMsWUFBTyxHQUFHLENBQUMsQ0FBQztJQUtqQixDQUFDO0lBRUosT0FBTyxDQUFDLE9BQWUsRUFBRSxHQUFHLFFBQWU7UUFDekMsSUFBSSxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU87UUFDMUIsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsUUFBUSxDQUFDLENBQUM7SUFDM0MsQ0FBQztJQUVELE9BQU8sQ0FBQyxTQUF5QyxFQUFFLElBQXFCO1FBQ3RFLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU87UUFDM0IsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLEVBQUUsU0FBUyxDQUFDLENBQUM7UUFDeEQsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDbEIsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsR0FBRyxPQUFPLFdBQVcsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDMUQsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQzNDLENBQUM7SUFDSCxDQUFDO0lBRUQsUUFBUSxDQUFDLFNBQXlDLEVBQUUsSUFBbUM7UUFDckYsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRO1lB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