import { CacheContext } from '../../../../../src/context';
import { GraphSnapshot } from '../../../../../src/GraphSnapshot';
import { write } from '../../../../../src/operations';
import { StaticNodeId } from '../../../../../src/schema';
import { query, strictConfig } from '../../../../helpers';

const { QueryRoot: QueryRootId } = StaticNodeId;

// Like InMemoryCache (which only stores selected fields), a field selected
// under an alias is written from its alias, even when the payload also has an
// unselected key of the field's schema name (e.g. a read result, which is a
// superset of the selection, written back with a merged deferred chunk).
describe(`operations.write`, () => {
  const context = new CacheContext(strictConfig);
  const empty = new GraphSnapshot();

  describe(`alias and an unselected key of its schema name`, () => {
    it(`writes a leaf value from the alias`, () => {
      const aliasQuery = query(`{
        user {
          id
          FirstName: name
        }
      }`);
      const { snapshot } = write(context, empty, aliasQuery, {
        user: { name: 'Stale', id: 0, FirstName: 'Foo' },
      });

      jestExpect(snapshot.getNodeData('0')).toEqual({ id: 0, name: 'Foo' });
    });

    it(`writes an object value from the alias`, () => {
      const aliasQuery = query(`{
        greeting {
          message
          user: recipient {
            name
            email
          }
        }
      }`);
      const { snapshot } = write(context, empty, aliasQuery, {
        greeting: {
          message: 'Hello',
          recipient: { name: 'Alice' },
          user: { name: 'Alice', email: 'alice@example.com' },
        },
      });

      jestExpect(snapshot.getNodeData(QueryRootId)).toEqual({
        greeting: {
          message: 'Hello',
          recipient: { name: 'Alice', email: 'alice@example.com' },
        },
      });
    });

    it(`still stores other unselected keys`, () => {
      const aliasQuery = query(`{
        user {
          id
          FirstName: name
        }
      }`);
      const { snapshot } = write(context, empty, aliasQuery, {
        user: { id: 0, FirstName: 'Foo', nickname: 'F' },
      });

      jestExpect(snapshot.getNodeData('0')).toEqual({ id: 0, name: 'Foo', nickname: 'F' });
    });

    // A frozen read result written back: a proxy of a frozen object may not
    // report a different value for its own key of the schema name.
    it(`writes a frozen payload`, () => {
      const aliasQuery = query(`{
        user {
          id
          FirstName: name
          posts: authoredPosts {
            title
          }
        }
      }`);
      const payload = Object.freeze({
        user: Object.freeze({
          id: 0,
          name: 'Stale',
          FirstName: 'Foo',
          authoredPosts: Object.freeze({ title: 'Stale' }),
          posts: Object.freeze({ title: 'Fresh' }),
        }),
      });
      const { snapshot } = write(context, empty, aliasQuery, payload);

      jestExpect(snapshot.getNodeData('0')).toEqual({ id: 0, name: 'Foo', authoredPosts: { title: 'Fresh' } });
    });
  });
});
