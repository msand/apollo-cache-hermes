import { gql } from '@apollo/client';

import { Hermes } from '../../../../../src';
import { GraphSnapshot } from '../../../../../src/GraphSnapshot';

// Removing unreachable reference cycles takes (roughly) linear work, however
// the nodes that lost references are ordered.
describe(`operations.write`, () => {
  describe(`unreachable reference cycles in large graphs`, () => {
    /** Counts the node lookups (a measure of work) made while `callback` runs. */
    function countLookups(callback: () => void): number {
      const { getNodeSnapshot } = GraphSnapshot.prototype;
      let count = 0;
      GraphSnapshot.prototype.getNodeSnapshot = function (this: GraphSnapshot, id: string) {
        count++;
        return getNodeSnapshot.call(this, id);
      };
      try {
        callback();
      } finally {
        GraphSnapshot.prototype.getNodeSnapshot = getNodeSnapshot;
      }
      return count;
    }

    const nodeCount = 8000;
    const listQuery = gql`
      {
        head {
          id
        }
        all {
          id
          next {
            id
          }
        }
      }
    `;

    /** A linked list of nodes 0 → 1 → … (circular, if `circular`), in reverse order. */
    function linkedList(circular = false) {
      const nodes: any[] = [];
      for (let i = 0; i < nodeCount; i++) {
        const next = i + 1 < nodeCount ? String(i + 1) : circular ? '0' : undefined;
        nodes.push({ __typename: 'N', id: String(i), next: next ? { __typename: 'N', id: next } : null });
      }
      return nodes.reverse();
    }

    it(`keeps a long list that stays reachable, with linear work`, () => {
      const cache = new Hermes({ freeze: false });
      cache.writeQuery({ query: listQuery, data: { head: { __typename: 'N', id: '0' }, all: linkedList() } });

      const start = Date.now();
      const lookups = countLookups(() => {
        cache.writeQuery({ query: listQuery, data: { head: { __typename: 'N', id: '0' }, all: [] } });
      });

      jestExpect(Object.keys(cache.extract()).length).toBe(nodeCount + 1);
      // A search per node would take tens of millions of lookups (and seconds).
      jestExpect(lookups).toBeLessThan(nodeCount * 50);
      jestExpect(Date.now() - start).toBeLessThan(2000);
    });

    it(`removes a long cycle that becomes unreachable, with linear work`, () => {
      const cache = new Hermes({ freeze: false });
      cache.writeQuery({
        query: listQuery,
        data: { head: { __typename: 'N', id: '0' }, all: linkedList(true) },
      });

      const lookups = countLookups(() => {
        cache.writeQuery({ query: listQuery, data: { head: null, all: [] } });
      });

      jestExpect(Object.keys(cache.extract())).toEqual(['ROOT_QUERY']);
      jestExpect(lookups).toBeLessThan(nodeCount * 50);
    });

    describe(`a node referenced by many others`, () => {
      const referrerCount = 3000;
      const query = gql`
        {
          hub {
            id
            refs {
              id
              target {
                id
              }
            }
          }
          center {
            id
            hub {
              id
            }
          }
        }
      `;
      const refs = Array.from({ length: referrerCount }, (_, i) => ({
        __typename: 'X',
        id: String(i),
        target: { __typename: 'C', id: '1' },
      }));
      const hub = { __typename: 'H', id: '1', refs };

      it(`is kept while one of its referrers is reachable`, () => {
        const cache = new Hermes({ freeze: false });
        cache.writeQuery({ query, data: { hub, center: { __typename: 'C', id: '1', hub: null } } });

        cache.writeQuery({
          query: gql`
            {
              center {
                id
              }
            }
          `,
          data: { center: null },
        });

        const extracted = cache.extract();
        jestExpect(extracted['C:1']).toBeDefined();
        jestExpect(Object.keys(extracted).length).toBe(referrerCount + 3);
      });

      it(`is removed, with its referrers, once none of them is reachable`, () => {
        const cache = new Hermes({ freeze: false });
        // The hub is only reachable through the center, which it references.
        cache.writeQuery({
          query: gql`
            {
              center {
                id
                hub {
                  id
                  refs {
                    id
                    target {
                      id
                    }
                  }
                }
              }
            }
          `,
          data: { center: { __typename: 'C', id: '1', hub } },
        });
        jestExpect(Object.keys(cache.extract()).length).toBe(referrerCount + 3);

        cache.writeQuery({
          query: gql`
            {
              center {
                id
              }
            }
          `,
          data: { center: null },
        });

        jestExpect(Object.keys(cache.extract())).toEqual(['ROOT_QUERY']);
      });
    });
  });
});
