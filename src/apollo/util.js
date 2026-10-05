"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRawOperationFromQuery = buildRawOperationFromQuery;
exports.buildRawOperationFromFragment = buildRawOperationFromFragment;
const utilities_1 = require("@apollo/client/utilities");
const schema_1 = require("../schema");
/**
 * Builds a query.
 */
function buildRawOperationFromQuery(document, variables, rootId) {
    return {
        rootId: rootId || schema_1.StaticNodeId.QueryRoot,
        document,
        variables,
    };
}
function buildRawOperationFromFragment(fragmentDocument, rootId, variables, fragmentName) {
    return {
        rootId,
        document: (0, utilities_1.getFragmentQueryDocument)(fragmentDocument, fragmentName),
        variables,
        fragmentName,
        fromFragmentDocument: true,
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInV0aWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFTQSxnRUFNQztBQUVELHNFQWFDO0FBOUJELHdEQUFvRTtBQUdwRSxzQ0FBK0Q7QUFHL0Q7O0dBRUc7QUFDSCxTQUFnQiwwQkFBMEIsQ0FBQyxRQUFzQixFQUFFLFNBQXNCLEVBQUUsTUFBZTtJQUN4RyxPQUFPO1FBQ0wsTUFBTSxFQUFFLE1BQU0sSUFBSSxxQkFBWSxDQUFDLFNBQVM7UUFDeEMsUUFBUTtRQUNSLFNBQVM7S0FDVixDQUFDO0FBQ0osQ0FBQztBQUVELFNBQWdCLDZCQUE2QixDQUMzQyxnQkFBOEIsRUFDOUIsTUFBYyxFQUNkLFNBQXNCLEVBQ3RCLFlBQXFCO0lBRXJCLE9BQU87UUFDTCxNQUFNO1FBQ04sUUFBUSxFQUFFLElBQUEsb0NBQXdCLEVBQUMsZ0JBQWdCLEVBQUUsWUFBWSxDQUFDO1FBQ2xFLFNBQVM7UUFDVCxZQUFZO1FBQ1osb0JBQW9CLEVBQUUsSUFBSTtLQUMzQixDQUFDO0FBQ0osQ0FBQyJ9