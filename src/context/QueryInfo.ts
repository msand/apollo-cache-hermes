import { ParsedQueryWithVariables, parseQuery } from '../ParsedQueryNode';
import { JsonValue } from '../primitive';
import { RawOperation } from '../schema';
import {
  DocumentNode,
  OperationDefinitionNode,
  OperationTypeNode,
  FragmentMap,
  fragmentMapForDocument,
  getOperationOrDie,
  variableDefaultsInOperation,
} from '../util';
import { GraphSnapshot } from '../GraphSnapshot';

import { CacheContext } from './CacheContext';

/**
 * Metadata about a GraphQL document (query/mutation/fragment/etc).
 *
 * We do a fair bit of pre-processing over them, and these objects hang onto
 * that information.
 */
export class QueryInfo<TSerialized = GraphSnapshot> {
  /** The original document (after __typename fields are injected). */
  public readonly document: DocumentNode;
  /** The primary operation in the document. */
  public readonly operation: OperationDefinitionNode;
  /** The type of operation. */
  public readonly operationType: OperationTypeNode;
  /** The name of the operation. */
  public readonly operationName?: string;
  /** The GQL source of the operation */
  public readonly operationSource?: string;
  /** All fragments in the document, indexed by name. */
  public readonly fragmentMap: FragmentMap;
  /**
   * The fully parsed query document.  It will be flattened (no fragments),
   * and contain placeholders for any variables in use.
   */
  public readonly parsed: ParsedQueryWithVariables;
  /** Variables used within this query. */
  public readonly variables: Set<string>;
  public readonly propMap: { [p: string]: string } | undefined;
  /**
   * Default values for the variables used by this query.
   *
   * Variables not present in this map are considered required.
   */
  public readonly variableDefaults: { [Key: string]: JsonValue };
  /**
   * Whether the caller transformed the document itself (as ApolloClient does),
   * so that the __typename fields added by addTypename were part of the
   * document the caller passed in.
   */
  public readonly pretransformed: boolean;

  constructor(context: CacheContext<TSerialized>, raw: RawOperation, pretransformed = false) {
    this.document = raw.document;
    this.pretransformed = pretransformed;
    this.operation = getOperationOrDie(raw.document);
    this.operationType = this.operation.operation;
    this.operationName = this.operation.name && this.operation.name.value;
    this.operationSource = this.operation.loc && this.operation.loc.source.body;
    this.fragmentMap = fragmentMapForDocument(raw.document);

    const { parsedQuery, variables, propMap } = parseQuery(context, this.fragmentMap, this.operation.selectionSet);
    this.parsed = parsedQuery;
    this.variables = variables;
    this.propMap = propMap;
    this.variableDefaults = variableDefaultsInOperation(this.operation);
    // Like InMemoryCache, variables the operation uses without declaring (and
    // the caller doesn't pass) are not an error: they read as undefined.
  }
}
