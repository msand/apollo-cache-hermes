import { expect } from 'chai';
import gql from 'graphql-tag';

import { Hermes } from '../../../src';

const document = gql`
  query SharedRecords($active: Boolean) {
    holders(active: $active) {
      nodes {
        id
        shared {
          id
          name
        }
      }
    }
    shared(active: $active) {
      nodes {
        id
        name
      }
    }
  }
`;
const variables = { active: true };
const payload = () => ({
  holders: {
    __typename: 'HoldersConnection',
    nodes: [1, 2].map(id => ({
      __typename: 'Holder',
      id,
      shared: { __typename: 'Shared', id, name: `Shared ${id}` },
    })),
  },
  shared: {
    __typename: 'SharedConnection',
    nodes: [1, 2].map(id => ({ __typename: 'Shared', id, name: `Shared ${id}` })),
  },
});

function restoredCache() {
  const cache = new Hermes({
    addTypename: true,
    entityIdForNode(node) {
      return typeof node?.__typename === 'string' && typeof node.id === 'number'
        ? `${node.__typename}_${node.id}`
        : undefined;
    },
  });
  cache.writeQuery({ query: document, variables, data: payload() });
  cache.batchEvict(['Holder_1', 'Shared_1']);
  cache.gc();
  cache.writeQuery({ query: document, variables, data: payload() });
  return cache;
}

describe('reinserted shared entities', () => {
  it('relinks every list when an earlier field already recreated the entity', () => {
    const cache = restoredCache();
    const result = cache.diff<ReturnType<typeof payload>>({ query: document, variables, optimistic: false });

    expect(result.complete).to.eq(true);
    expect(result.result).to.deep.eq(payload());
  });

  it('propagates later entity edits through all restored references', () => {
    const cache = restoredCache();
    cache.writeFragment({
      id: 'Shared_1',
      fragment: gql`
        fragment SharedName on Shared {
          id
          name
        }
      `,
      data: { __typename: 'Shared', id: 1, name: 'Renamed' },
    });
    const result = cache.readQuery<ReturnType<typeof payload>>({ query: document, variables });

    expect(result?.holders.nodes[0].shared.name).to.eq('Renamed');
    expect(result?.shared.nodes[0].name).to.eq('Renamed');
    expect(result?.shared.nodes[1].name).to.eq('Shared 2');
  });
});
