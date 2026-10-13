import { gql, makeVar } from '@apollo/client';
import type { Reference } from '@apollo/client';

import { Hermes } from '../../../src';

// Reads reuse what they made of entities with read functions while what that
// depended on is the same (see OverlaidEntity in src/operations/read.ts);
// these check that changes to what read functions read show up.
describe(`reads with read functions after changes`, () => {
  const query = gql`
    query {
      projects {
        __typename
        id
        label
        tasks {
          __typename
          id
          title
          ownerName
        }
      }
    }
  `;
  const data = {
    projects: [
      {
        __typename: 'Project',
        id: 'p1',
        tasks: [
          { __typename: 'Task', id: 't1', title: 'One', owner: { __typename: 'User', id: 'u1', name: 'Ann' } },
          { __typename: 'Task', id: 't2', title: 'Two', owner: { __typename: 'User', id: 'u2', name: 'Bob' } },
        ],
      },
      {
        __typename: 'Project',
        id: 'p2',
        tasks: [{ __typename: 'Task', id: 't3', title: 'Three', owner: { __typename: 'User', id: 'u1', name: 'Ann' } }],
      },
    ],
  };
  const writeQuery = gql`
    query {
      projects {
        __typename
        id
        tasks {
          __typename
          id
          title
          owner {
            __typename
            id
            name
          }
        }
      }
    }
  `;

  const suffix = makeVar('!');
  function createCache() {
    const cache: Hermes = new Hermes({
      typePolicies: {
        Project: {
          fields: {
            label: { read: (_, { readField }) => `${readField('id')}${suffix()}` },
          },
        },
        Task: {
          fields: {
            ownerName: {
              read: (_, { readField }) => readField<string>('name', readField<Reference>('owner')),
            },
          },
        },
      },
    });
    cache.writeQuery({ query: writeQuery, data });
    return cache;
  }

  const read = (cache: Hermes) => cache.readQuery<any>({ query })!;
  const renameUser = (cache: Hermes, id: string, name: string) =>
    cache.writeFragment({
      id: `User:${id}`,
      fragment: gql`
        fragment U on User {
          name
        }
      `,
      data: { __typename: 'User', name },
    });

  it(`reflect changes to entities read through readField`, () => {
    const cache = createCache();
    expect(read(cache).projects[1].tasks[0].ownerName).toBe('Ann');
    renameUser(cache, 'u1', 'Anna');
    const result = read(cache);
    expect(result.projects[0].tasks[0].ownerName).toBe('Anna');
    expect(result.projects[0].tasks[1].ownerName).toBe('Bob');
    expect(result.projects[1].tasks[0].ownerName).toBe('Anna');
  });

  it(`reuse the results of unchanged entities`, () => {
    const cache = createCache();
    const before = read(cache);
    renameUser(cache, 'u2', 'Bert');
    const after = read(cache);
    expect(after.projects[0].tasks[1].ownerName).toBe('Bert');
    expect(after.projects[1]).toBe(before.projects[1]);
    expect(after.projects[0].tasks[0]).toBe(before.projects[0].tasks[0]);
  });

  it(`reflect changes to entities read through references they don't hold`, () => {
    const cache = new Hermes({
      typePolicies: {
        Task: {
          fields: {
            firstProject: {
              read: (_, { readField, toReference }) =>
                readField<string>('label', toReference({ __typename: 'Project', id: 'p2' })),
            },
          },
        },
      },
    });
    const withLabels = gql`
      query {
        projects {
          __typename
          id
          label
          tasks {
            __typename
            id
            firstProject
          }
        }
      }
    `;
    cache.writeQuery({
      query: withLabels,
      data: {
        projects: [
          { __typename: 'Project', id: 'p1', label: 'P1', tasks: [{ __typename: 'Task', id: 't1' }] },
          { __typename: 'Project', id: 'p2', label: 'P2', tasks: [] },
        ],
      },
    });
    expect(cache.readQuery<any>({ query: withLabels })!.projects[0].tasks[0].firstProject).toBe('P2');
    cache.writeFragment({
      id: 'Project:p2',
      fragment: gql`
        fragment L on Project {
          label
        }
      `,
      data: { __typename: 'Project', label: 'Renamed' },
    });
    expect(cache.readQuery<any>({ query: withLabels })!.projects[0].tasks[0].firstProject).toBe('Renamed');
  });

  it(`reflect changes to reactive variables`, () => {
    const cache = createCache();
    expect(read(cache).projects[0].label).toBe('p1!');
    suffix('?');
    try {
      expect(read(cache).projects[0].label).toBe('p1?');
    } finally {
      suffix('!');
    }
  });

  it(`reflect changes to what read functions read from the cache`, () => {
    const cache: Hermes = new Hermes({
      typePolicies: {
        Task: {
          fields: {
            ownerName: {
              // (Another user's name: one the task doesn't hold.)
              read: () =>
                cache.readFragment<{ name: string }>({
                  id: 'User:u2',
                  fragment: gql`
                    fragment N on User {
                      name
                    }
                  `,
                })?.name,
            },
          },
        },
      },
    });
    cache.writeQuery({ query: writeQuery, data });
    const tasksQuery = gql`
      query {
        projects {
          __typename
          id
          tasks {
            __typename
            id
            ownerName
          }
        }
      }
    `;
    expect(cache.readQuery<any>({ query: tasksQuery })!.projects[1].tasks[0].ownerName).toBe('Bob');
    renameUser(cache, 'u2', 'Bert');
    expect(cache.readQuery<any>({ query: tasksQuery })!.projects[1].tasks[0].ownerName).toBe('Bert');
  });

  it(`reflect changes to parameterized fields`, () => {
    const cache = new Hermes();
    const countQuery = gql`
      query {
        projects {
          __typename
          id
          count(status: "open")
        }
      }
    `;
    cache.writeQuery({
      query: countQuery,
      data: {
        projects: [
          { __typename: 'Project', id: 'p1', count: 1 },
          { __typename: 'Project', id: 'p2', count: 2 },
        ],
      },
    });
    const before = cache.readQuery<any>({ query: countQuery })!;
    cache.writeFragment({
      id: 'Project:p2',
      fragment: gql`
        fragment C on Project {
          count(status: "open")
        }
      `,
      data: { __typename: 'Project', count: 5 },
    });
    const after = cache.readQuery<any>({ query: countQuery })!;
    expect(after.projects.map((p: any) => p.count)).toEqual([1, 5]);
    expect(after.projects[0]).toBe(before.projects[0]);
  });

  it(`notify watches of changes within reused entities`, () => {
    const cache = createCache();
    read(cache);
    const callback = jest.fn();
    cache.watch({ query, optimistic: true, callback });
    read(cache);
    renameUser(cache, 'u2', 'Bert');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].result.projects[0].tasks[1].ownerName).toBe('Bert');
  });

  it(`start over after a reset`, async () => {
    const cache = createCache();
    read(cache);
    await cache.reset();
    expect(cache.readQuery({ query })).toBeNull();
    cache.writeQuery({ query: writeQuery, data });
    expect(read(cache).projects[0].tasks[0].ownerName).toBe('Ann');
  });
});
