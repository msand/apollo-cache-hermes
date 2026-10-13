import { gql } from '@apollo/client';
import type { DocumentNode } from 'graphql';

import { Hermes } from '../../../src';

// Reads remember what they found checking each entity's data against a
// selection (see CheckedSubtree in src/operations/read.ts); these check that
// reads that reuse those findings report what a fresh cache would.
describe(`reads of unchanged entities`, () => {
  const query = gql`
    query {
      projects {
        __typename
        id
        name
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

  const owner = (id: string) => ({ __typename: 'User', id, name: `User ${id}` });
  const task = (id: string, ownerId = 'u1') => ({ __typename: 'Task', id, title: `Task ${id}`, owner: owner(ownerId) });
  const data = {
    projects: [
      { __typename: 'Project', id: 'p1', name: 'P1', tasks: [task('t1'), task('t2', 'u2')] },
      { __typename: 'Project', id: 'p2', name: 'P2', tasks: [task('t3'), task('t4', 'u2')] },
    ],
  };

  function diff(cache: Hermes, document: DocumentNode = query) {
    return cache.diff<any>({ query: document, returnPartialData: true, optimistic: false });
  }

  /** What a cache that never read anything reports for the same data. */
  function freshDiff(cache: Hermes, document: DocumentNode = query) {
    const fresh = new Hermes();
    fresh.restore(cache.extract());
    return diff(fresh, document);
  }

  function expectLikeFresh(cache: Hermes, document: DocumentNode = query) {
    const { result, complete, missing } = diff(cache, document);
    const expected = freshDiff(cache, document);
    expect(complete).toBe(expected.complete);
    expect(result).toEqual(expected.result);
    expect(missing?.missing).toEqual(expected.missing?.missing);
    expect(missing?.message).toEqual(expected.missing?.message);
  }

  /** Writes data that lacks selected fields (without logging their absence). */
  function writeIncomplete(cache: Hermes, document: DocumentNode, value: unknown, id?: string) {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      if (id) cache.writeFragment({ id, fragment: document, data: value });
      else cache.writeQuery({ query: document, data: value });
    } finally {
      error.mockRestore();
    }
  }

  it(`stay complete after writes to other entities`, () => {
    const cache = new Hermes();
    cache.writeQuery({ query, data });
    expect(diff(cache).complete).toBe(true);

    cache.writeFragment({
      id: 'Task:t3',
      fragment: gql`
        fragment T on Task {
          title
        }
      `,
      data: { __typename: 'Task', title: 'Renamed' },
    });
    const { result, complete } = diff(cache);
    expect(complete).toBe(true);
    expect(result.projects[1].tasks[0].title).toBe('Renamed');
    expect(result.projects[0]).toBe(diff(cache).result.projects[0]);
    expectLikeFresh(cache);
  });

  it(`report the missing fields of unchanged entities again`, () => {
    const cache = new Hermes();
    const incomplete = JSON.parse(JSON.stringify(data));
    delete incomplete.projects[0].tasks[1].title;
    incomplete.projects[1].tasks[0].owner = { __typename: 'User', id: 'u3' };
    writeIncomplete(cache, query, incomplete);

    const first = diff(cache);
    expect(first.complete).toBe(false);
    expect(first.missing?.missing).toEqual({
      projects: {
        0: { tasks: { 1: { title: `Can't find field 'title' on Task:t2 object` } } },
        1: { tasks: { 0: { owner: { name: `Can't find field 'name' on User:u3 object` } } } },
      },
    });
    expectLikeFresh(cache);

    // Changing an unrelated entity reuses what was found for the others.
    cache.writeFragment({
      id: 'Project:p2',
      fragment: gql`
        fragment P on Project {
          name
        }
      `,
      data: { __typename: 'Project', name: 'Renamed' },
    });
    expect(diff(cache).missing?.missing).toEqual(first.missing?.missing);
    expectLikeFresh(cache);

    // Filling in a missing field only drops what it fixed.
    cache.writeFragment({
      id: 'Task:t2',
      fragment: gql`
        fragment T on Task {
          title
        }
      `,
      data: { __typename: 'Task', title: 'Found' },
    });
    expect(diff(cache).missing?.missing).toEqual({
      projects: { 1: { tasks: { 0: { owner: { name: `Can't find field 'name' on User:u3 object` } } } } },
    });
    expectLikeFresh(cache);

    cache.writeFragment({
      id: 'User:u3',
      fragment: gql`
        fragment U on User {
          name
        }
      `,
      data: { __typename: 'User', name: 'Back' },
    });
    expect(diff(cache).complete).toBe(true);
    expectLikeFresh(cache);
  });

  it(`don't change the missing fields reported by earlier reads`, () => {
    const cache = new Hermes();
    const incomplete = JSON.parse(JSON.stringify(data));
    delete incomplete.projects[0].tasks[0].title;
    writeIncomplete(cache, query, incomplete);

    const before = diff(cache).missing!.missing;
    const copy = JSON.parse(JSON.stringify(before));
    // Another field of the same project, missing from a later read.
    writeIncomplete(cache, query, {
      projects: [{ ...incomplete.projects[0], name: undefined }, incomplete.projects[1]],
    });
    diff(cache);
    expect(before).toEqual(copy);
    expectLikeFresh(cache);
  });

  it(`report dangling references after the referenced entity is evicted`, () => {
    const cache = new Hermes();
    cache.writeQuery({ query, data });
    expect(diff(cache).complete).toBe(true);

    cache.evict({ id: 'Task:t4' });
    const { complete, result } = diff(cache);
    expect(result.projects[1].tasks.map((t: any) => t.id)).toEqual(['t3']);
    expect(complete).toBe(true);
    expectLikeFresh(cache);
  });

  it(`apply possibleTypes added after the first read`, () => {
    const interfaceQuery = gql`
      query {
        projects {
          __typename
          id
          ... on Named {
            name
          }
        }
      }
    `;
    const cache = new Hermes();
    writeIncomplete(cache, interfaceQuery, { projects: [{ __typename: 'Project', id: 'p1' }] });
    expect(diff(cache, interfaceQuery).complete).toBe(true);

    cache.policies.addPossibleTypes({ Named: ['Project'] });
    const { complete, missing } = diff(cache, interfaceQuery);
    expect(complete).toBe(false);
    expect(missing?.missing).toEqual({ projects: { 0: { name: `Can't find field 'name' on Project:p1 object` } } });
  });

  it(`notify watches of changes to entities whose findings were reused`, () => {
    const cache = new Hermes();
    cache.writeQuery({ query, data });
    const ownerQuery = gql`
      query {
        projects {
          __typename
          id
          tasks {
            __typename
            id
            owner {
              __typename
              id
              name
            }
          }
        }
      }
    `;
    // Read first, so the watch's read reuses the findings.
    diff(cache, ownerQuery);
    const callback = jest.fn();
    cache.watch({ query: ownerQuery, optimistic: true, callback });
    diff(cache, ownerQuery);

    cache.writeFragment({
      id: 'User:u2',
      fragment: gql`
        fragment U on User {
          name
        }
      `,
      data: { __typename: 'User', name: 'Renamed' },
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].result.projects[1].tasks[1].owner.name).toBe('Renamed');
  });
});
