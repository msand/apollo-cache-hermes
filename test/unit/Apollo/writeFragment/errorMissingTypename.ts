import { expect } from 'chai';
import gql from 'graphql-tag';

import { Hermes } from '../../../../src';
import { strictConfig } from '../../../helpers';
import { StaticNodeId } from '../../../../src/schema';

const { QueryRoot: QueryRootId } = StaticNodeId;

describe(`writeFragment with missing __typename`, () => {
  let hermes: Hermes;
  beforeAll(() => {
    hermes = new Hermes({
      ...strictConfig,
      addTypename: true,
    });
  });

  it(`does not throw an error`, () => {
    expect(
      hermes.writeFragment({
        id: QueryRootId,
        fragment: gql(`
          fragment viewer on Viewer {
            id
            name
          }
        `),
        data: {
          id: 123,
          name: 'Gouda',
        },
      }),
      // Like InMemoryCache, the root object is not identified by its data.
    ).to.deep.equal({ __ref: QueryRootId });
  });
});
