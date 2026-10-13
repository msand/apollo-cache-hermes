import { expect } from 'chai';
import gql from 'graphql-tag';

import { Cache } from '../../../../src';
import { CacheContext } from '../../../../src/context';
import { query, strictConfig } from '../../../helpers';

// updateListOfReferences reads the arguments of parameterized fields from
// their node ids, which may hold keyArgs store field names (or ❖ in values).
describe(`context.CacheContext`, () => {
  describe(`updateListOfReferences of fields stored per their keyArgs`, () => {
    const dashboardQuery = query(`
      query dashboard($active: Boolean, $tag: String) {
        dashboard {
          __typename
          id
          users(active: $active, tag: $tag) {
            __typename
            id
            active
            currentDashboard { id }
          }
        }
      }
    `);
    const getUserQuery = query(`
      query getUser($id: ID!) {
        user(id: $id) {
          __typename
          id
          active
          currentDashboard { id }
        }
      }
    `);

    const fieldArguments: unknown[] = [];
    const entityUpdaters: CacheContext.EntityUpdaters = {
      User(dataProxy, user, previous) {
        if (!user || !previous || user.active === previous.active) return;
        dataProxy.updateListOfReferences(
          user.currentDashboard.id,
          ['users'],
          { writeFragment: gql(`fragment user on User { id }`) },
          {
            readFragment: gql(`
              fragment dashboard on Dashboard {
                id
                users(active: $active, tag: $tag) { __typename id active currentDashboard { id } }
              }
            `),
          },
          (previousUsers, args) => {
            fieldArguments.push(args);
            return user.active ? previousUsers : previousUsers.filter((u: any) => u.id !== user.id);
          },
        );
      },
    };

    for (const [description, typePolicies, tag] of [
      ['with keyArgs', { Dashboard: { fields: { users: { keyArgs: ['active'] } } } }, 'a'],
      ['with ❖ in an argument', undefined, 'a❖b'],
    ] as const) {
      it(`updates the list ${description}`, () => {
        fieldArguments.length = 0;
        const cache = new Cache({ ...strictConfig, typePolicies: typePolicies as any, entityUpdaters });
        const variables = { active: true, tag };
        const user = (id: number, active: boolean) => ({
          __typename: 'User',
          id,
          active,
          currentDashboard: { id: 'dash0' },
        });
        cache.write(
          { ...dashboardQuery, variables },
          { dashboard: { __typename: 'Dashboard', id: 'dash0', users: [user(1, true), user(2, true)] } },
        );

        cache.write({ ...getUserQuery, variables: { id: 2 } }, { user: user(2, false) });

        expect(fieldArguments).to.deep.eq(typePolicies ? [{ active: true }] : [{ active: true, tag }]);
        const result: any = cache.read({ ...dashboardQuery, variables }).result;
        expect(result.dashboard.users.map((u: any) => u.id)).to.deep.eq([1]);
      });
    }
  });
});
