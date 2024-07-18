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

  it(`correctly modify root query`, () => {
    expect(baseline.getNodeSnapshot(QueryRootId)).to.deep.eq(
      new EntitySnapshot(
        {
          id: 123,
          name: 'Gouda',
          __typename: 'Viewer',
        },
        /* inbound */ undefined,
        [{ id: '123', path: [] }],
      )
    );
    expect(baseline.getNodeData(QueryRootId)).to.eq(baseline.getNodeData('123'));
  });

  it(`correctly add new reference`, () => {
    expect(baseline.getNodeSnapshot('123')).to.deep.eq(
      new EntitySnapshot(
        {
          id: 123,
          name: 'Gouda',
          __typename: 'Viewer',
        },
        [{ id: QueryRootId, path: [] }],
        /* outbound */ undefined,
      )
    );
  });

});
