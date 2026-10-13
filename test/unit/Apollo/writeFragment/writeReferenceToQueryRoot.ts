import { expect } from 'chai';
import gql from 'graphql-tag';

import { Hermes } from '../../../../src';
import { GraphSnapshot } from '../../../../src/GraphSnapshot';
import { EntitySnapshot } from '../../../../src/nodes';
import { StaticNodeId } from '../../../../src/schema';
import { strictConfig } from '../../../helpers';

const { QueryRoot: QueryRootId } = StaticNodeId;

describe(`writeFragment directly to root query`, () => {
  let hermes: Hermes, baseline: GraphSnapshot;
  beforeAll(() => {
    hermes = new Hermes(strictConfig);
    hermes.writeFragment({
      id: QueryRootId,
      fragment: gql(`
        fragment viewer on Viewer {
          id
          name
          __typename
        }
      `),
      data: {
        id: 123,
        name: 'Gouda',
        __typename: 'Viewer',
      },
    });
    baseline = hermes.getCurrentCacheSnapshot().baseline;
  });

  // Like InMemoryCache, the fields are written to the root object itself: it
  // is not identified as an entity by its data.
  it(`writes the fields to the root query itself`, () => {
    expect(baseline.getNodeSnapshot(QueryRootId)).to.deep.eq(
      new EntitySnapshot({
        id: 123,
        name: 'Gouda',
        __typename: 'Viewer',
      }),
    );
  });

  it(`does not add an entity for the data`, () => {
    expect(baseline.getNodeSnapshot('123')).to.eq(undefined);
    expect(baseline.allNodeIds()).to.deep.eq([QueryRootId]);
  });
});
