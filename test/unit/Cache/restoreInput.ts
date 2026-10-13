import { gql } from '@apollo/client';

import { Hermes } from '../../../src';
import { deepFreeze } from '../../../src/util/freeze';

// restore() fills in the references of the serialized nodes in copies of
// their data, leaving the serialized state as it is (extract() results share
// objects, and may be restored again).
describe(`restore`, () => {
  const query = gql`
    query {
      viewer {
        __typename
        id
        friends {
          __typename
          id
          name
          bestFriend {
            __typename
            id
            name
          }
        }
        posts(first: 2) {
          __typename
          id
          author {
            __typename
            id
            name
          }
        }
      }
    }
  `;
  const data = {
    viewer: {
      __typename: 'User',
      id: 'u1',
      friends: [
        { __typename: 'User', id: 'u2', name: 'Two', bestFriend: { __typename: 'User', id: 'u3', name: 'Three' } },
        { __typename: 'User', id: 'u3', name: 'Three', bestFriend: { __typename: 'User', id: 'u2', name: 'Two' } },
      ],
      posts: [
        { __typename: 'Post', id: 'p1', author: { __typename: 'User', id: 'u2', name: 'Two' } },
        { __typename: 'Post', id: 'p2', author: { __typename: 'User', id: 'u3', name: 'Three' } },
      ],
    },
  };

  function extracted() {
    const cache = new Hermes();
    cache.writeQuery({ query, data });
    return cache.extract();
  }

  it(`doesn't change the serialized state`, () => {
    const state = extracted();
    const copy = JSON.parse(JSON.stringify(state));
    new Hermes().restore(state);
    expect(JSON.parse(JSON.stringify(state))).toEqual(copy);
  });

  it(`restores the same state more than once`, () => {
    const state = extracted();
    const first = new Hermes();
    first.restore(state);
    const second = new Hermes();
    second.restore(state);
    // (Reads return a superset of the selected fields.)
    expect(first.readQuery({ query })).toMatchObject(data);
    expect(second.readQuery({ query })).toEqual(first.readQuery({ query }));
  });

  it(`restores frozen state`, () => {
    const state = deepFreeze(extracted());
    const cache = new Hermes();
    cache.restore(state);
    expect(cache.readQuery({ query })).toMatchObject(data);
  });

  it(`restores references between entities, in their final form`, () => {
    const cache = new Hermes();
    cache.restore(extracted());
    const result = cache.readQuery<any>({ query })!;
    const [two, three] = result.viewer.friends;
    expect(two.bestFriend).toBe(three);
    expect(three.bestFriend).toBe(two);
    expect(result.viewer.posts[0].author).toBe(two);
  });
});
