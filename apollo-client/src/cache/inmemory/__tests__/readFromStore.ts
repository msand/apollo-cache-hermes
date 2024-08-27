import gql from "graphql-tag";

import { Cache } from "../../core/types/Cache";
import { MissingFieldError } from "../../core/types/common";
import { Reference, isReference, TypedDocumentNode } from "../../../core";
import { Hermes } from "../../../../../src";

describe("reading from the store", () => {
  it("readQuery supports returnPartialData", () => {
    const cache = new Hermes();
    const aQuery = gql`
      query {
        a
      }
    `;
    const bQuery = gql`
      query {
        b
      }
    `;
    const abQuery = gql`
      query {
        a
        b
      }
    `;

    cache.writeQuery({
      query: aQuery,
      data: { a: 123 },
    });

    expect(cache.readQuery({ query: bQuery })).toBe(null);
    expect(cache.readQuery({ query: abQuery })).toBe(null);

    expect(
      cache.readQuery({
        query: bQuery,
        returnPartialData: true,
      })
    ).toEqual({});

    expect(
      cache.readQuery({
        query: abQuery,
        returnPartialData: true,
      })
    ).toEqual({ a: 123 });
  });

  it("readFragment supports returnPartialData", () => {
    const cache = new Hermes();
    const id = cache.identify({
      __typename: "ABObject",
      id: 321,
    });

    const aFragment = gql`
      fragment AFragment on ABObject {
        a
      }
    `;
    const bFragment = gql`
      fragment BFragment on ABObject {
        b
      }
    `;
    const abFragment = gql`
      fragment ABFragment on ABObject {
        a
        b
      }
    `;

    expect(cache.readFragment({ id, fragment: aFragment })).toBe(null);
    expect(cache.readFragment({ id, fragment: bFragment })).toBe(null);
    expect(cache.readFragment({ id, fragment: abFragment })).toBe(null);

    const ref = cache.writeFragment({
      id,
      fragment: aFragment,
      data: {
        __typename: "ABObject",
        a: 123,
      },
    });
    expect(isReference(ref)).toBe(true);
    expect(ref!.__ref).toBe(id);

    expect(
      cache.readFragment({
        id,
        fragment: bFragment,
      })
    ).toBe(null);

    expect(
      cache.readFragment({
        id,
        fragment: abFragment,
      })
    ).toBe(null);

    expect(
      cache.readFragment({
        id,
        fragment: bFragment,
        returnPartialData: true,
      })
    ).toEqual({
      __typename: "ABObject",
    });

    expect(
      cache.readFragment({
        id,
        fragment: abFragment,
        returnPartialData: true,
      })
    ).toEqual({
      __typename: "ABObject",
      a: 123,
    });
  });

  it("distinguishes between missing @client and non-@client fields", () => {
    const query = gql`
      query {
        normal {
          present @client
          missing
        }
        clientOnly @client {
          present
          missing
        }
      }
    `;

    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            normal() {
              return { present: "here" };
            },
            clientOnly() {
              return { present: "also here" };
            },
          },
        },
      },
    });

    const { result, complete, missing } = cache.diff({
      query,
      optimistic: true,
      returnPartialData: true,
    });

    expect(complete).toBe(false);

    expect(result).toEqual({
      normal: {
        present: "here",
      },
      clientOnly: {
        present: "also here",
      },
    });

    expect(missing).toEqual([
      new MissingFieldError(
        `Can't find field 'missing' on object ${JSON.stringify(
          {
            present: "here",
          },
          null,
          2
        )}`,
        {
          normal: {
            missing: `Can't find field 'missing' on object ${JSON.stringify(
              { present: "here" },
              null,
              2
            )}`,
          },
          clientOnly: {
            missing: `Can't find field 'missing' on object ${JSON.stringify(
              { present: "also here" },
              null,
              2
            )}`,
          },
        },
        query,
        {} // variables
      ),
    ]);
  });

  it("read functions for root query fields work with empty cache", () => {
    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            uuid() {
              return "8d573b9c-cfcf-4e3e-98dd-14d255af577e";
            },
            null() {
              return null;
            },
          },
        },
      },
    });

    expect(
      cache.readQuery({
        query: gql`
          query {
            uuid
            null
          }
        `,
      })
    ).toEqual({
      uuid: "8d573b9c-cfcf-4e3e-98dd-14d255af577e",
      null: null,
    });

    expect(cache.extract()).toEqual({});

    expect(
      cache.readFragment({
        id: "ROOT_QUERY",
        fragment: gql`
          fragment UUIDFragment on Query {
            null
            uuid
          }
        `,
      })
    ).toEqual({
      uuid: "8d573b9c-cfcf-4e3e-98dd-14d255af577e",
      null: null,
    });

    expect(cache.extract()).toEqual({});

    expect(
      cache.readFragment({
        id: "does not exist",
        fragment: gql`
          fragment F on Never {
            whatever
          }
        `,
      })
    ).toBe(null);

    expect(cache.extract()).toEqual({});
  });

  it("custom read functions can map/filter dangling references", () => {
    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            ducks(existing: Reference[] = [], { canRead }) {
              return existing.map((duck) => (canRead(duck) ? duck : null));
            },
            chickens(existing: Reference[] = [], { canRead }) {
              return existing.map((chicken) =>
                canRead(chicken) ? chicken : {}
              );
            },
            oxen(existing: Reference[] = [], { canRead }) {
              return existing.filter(canRead);
            },
          },
        },
      },
    });

    cache.writeQuery({
      query: gql`
        query {
          ducks {
            quacking
          }
          chickens {
            inCoop
          }
          oxen {
            gee
            haw
          }
        }
      `,
      data: {
        ducks: [
          { __typename: "Duck", id: 1, quacking: true },
          { __typename: "Duck", id: 2, quacking: false },
          { __typename: "Duck", id: 3, quacking: false },
        ],
        chickens: [
          { __typename: "Chicken", id: 1, inCoop: true },
          { __typename: "Chicken", id: 2, inCoop: true },
          { __typename: "Chicken", id: 3, inCoop: false },
        ],
        oxen: [
          { __typename: "Ox", id: 1, gee: true, haw: false },
          { __typename: "Ox", id: 2, gee: false, haw: true },
        ],
      },
    });

    expect(cache.extract()).toEqual({
      "Chicken:1": {
        __typename: "Chicken",
        id: 1,
        inCoop: true,
      },
      "Chicken:2": {
        __typename: "Chicken",
        id: 2,
        inCoop: true,
      },
      "Chicken:3": {
        __typename: "Chicken",
        id: 3,
        inCoop: false,
      },
      "Duck:1": {
        __typename: "Duck",
        id: 1,
        quacking: true,
      },
      "Duck:2": {
        __typename: "Duck",
        id: 2,
        quacking: false,
      },
      "Duck:3": {
        __typename: "Duck",
        id: 3,
        quacking: false,
      },
      "Ox:1": {
        __typename: "Ox",
        id: 1,
        gee: true,
        haw: false,
      },
      "Ox:2": {
        __typename: "Ox",
        id: 2,
        gee: false,
        haw: true,
      },
      ROOT_QUERY: {
        __typename: "Query",
        chickens: [
          { __ref: "Chicken:1" },
          { __ref: "Chicken:2" },
          { __ref: "Chicken:3" },
        ],
        ducks: [{ __ref: "Duck:1" }, { __ref: "Duck:2" }, { __ref: "Duck:3" }],
        oxen: [{ __ref: "Ox:1" }, { __ref: "Ox:2" }],
      },
    });

    function diffChickens() {
      return cache.diff({
        query: gql`
          query {
            chickens {
              id
              inCoop
            }
          }
        `,
        optimistic: true,
      });
    }

    expect(diffChickens()).toEqual({
      complete: true,
      result: {
        chickens: [
          { __typename: "Chicken", id: 1, inCoop: true },
          { __typename: "Chicken", id: 2, inCoop: true },
          { __typename: "Chicken", id: 3, inCoop: false },
        ],
      },
    });

    expect(
      cache.evict({
        id: cache.identify({
          __typename: "Chicken",
          id: 2,
        }),
      })
    ).toBe(true);

    expect(diffChickens()).toEqual({
      complete: false,
      missing: [
        new MissingFieldError(
          "Can't find field 'id' on object {}",
          {
            chickens: {
              1: {
                id: "Can't find field 'id' on object {}",
                inCoop: "Can't find field 'inCoop' on object {}",
              },
            },
          },
          expect.anything(), // query
          expect.anything() // variables
        ),
      ],
      result: {
        chickens: [
          { __typename: "Chicken", id: 1, inCoop: true },
          {},
          { __typename: "Chicken", id: 3, inCoop: false },
        ],
      },
    });

    function diffDucks() {
      return cache.diff({
        query: gql`
          query {
            ducks {
              id
              quacking
            }
          }
        `,
        optimistic: true,
      });
    }

    expect(diffDucks()).toEqual({
      complete: true,
      result: {
        ducks: [
          { __typename: "Duck", id: 1, quacking: true },
          { __typename: "Duck", id: 2, quacking: false },
          { __typename: "Duck", id: 3, quacking: false },
        ],
      },
    });

    expect(
      cache.evict({
        id: cache.identify({
          __typename: "Duck",
          id: 3,
        }),
      })
    ).toBe(true);

    // Returning null as a placeholder in a list is a way to indicate that
    // a list element has been removed, without causing an incomplete
    // diff, and without altering the positions of later elements.
    expect(diffDucks()).toEqual({
      complete: true,
      result: {
        ducks: [
          { __typename: "Duck", id: 1, quacking: true },
          { __typename: "Duck", id: 2, quacking: false },
          null,
        ],
      },
    });

    function diffOxen() {
      return cache.diff({
        query: gql`
          query {
            oxen {
              id
              gee
              haw
            }
          }
        `,
        optimistic: true,
      });
    }

    expect(diffOxen()).toEqual({
      complete: true,
      result: {
        oxen: [
          { __typename: "Ox", id: 1, gee: true, haw: false },
          { __typename: "Ox", id: 2, gee: false, haw: true },
        ],
      },
    });

    expect(
      cache.evict({
        id: cache.identify({
          __typename: "Ox",
          id: 1,
        }),
      })
    ).toBe(true);

    expect(diffOxen()).toEqual({
      complete: true,
      result: {
        oxen: [{ __typename: "Ox", id: 2, gee: false, haw: true }],
      },
    });
  });

  it("propagates eviction signals to parent queries", () => {
    const cache = new Hermes({
      // canonizeResults: true,
      typePolicies: {
        Deity: {
          keyFields: ["name"],
          fields: {
            children(offspring: Reference[], { canRead }) {
              // Automatically filter out any dangling references, and
              // supply a default empty array if !offspring.
              return offspring ? offspring.filter(canRead) : [];
            },
          },
        },

        Query: {
          fields: {
            ruler(ruler, { canRead, toReference }) {
              // If the throne is empty, promote Apollo!
              return canRead(ruler) ? ruler : (
                  toReference({
                    __typename: "Deity",
                    name: "Apollo",
                  })
                );
            },
          },
        },
      },
    });

    const rulerQuery = gql`
      query {
        ruler {
          name
          children {
            name
            children {
              name
            }
          }
        }
      }
    `;

    const children = [
      // Sons #1 and #2 don't have names because Cronus (l.k.a. Saturn)
      // devoured them shortly after birth, as famously painted by
      // Francisco Goya:
      "Son #1",
      "Hera",
      "Son #2",
      "Zeus",
      "Demeter",
      "Hades",
      "Poseidon",
      "Hestia",
    ].map((name) => ({
      __typename: "Deity",
      name,
      children: [],
    }));

    cache.writeQuery({
      query: rulerQuery,
      data: {
        ruler: {
          __typename: "Deity",
          name: "Cronus",
          children,
        },
      },
    });

    const diffs: Cache.DiffResult<any>[] = [];

    function watch(immediate = true) {
      return cache.watch({
        query: rulerQuery,
        immediate,
        optimistic: true,
        callback(diff) {
          diffs.push(diff);
        },
      });
    }

    const cancel = watch();

    function devour(name: string) {
      return cache.evict({
        id: cache.identify({ __typename: "Deity", name }),
      });
    }

    const initialDiff = {
      result: {
        ruler: {
          __typename: "Deity",
          name: "Cronus",
          children,
        },
      },
      complete: true,
    };

    // We already have one diff because of the immediate:true above.
    expect(diffs).toEqual([initialDiff]);

    expect(devour("Son #1")).toBe(true);

    const childrenWithoutSon1 = children.filter(
      (child) => child.name !== "Son #1"
    );

    expect(childrenWithoutSon1.length).toBe(children.length - 1);

    const diffWithoutSon1 = {
      result: {
        ruler: {
          name: "Cronus",
          __typename: "Deity",
          children: childrenWithoutSon1,
        },
      },
      complete: true,
    };

    expect(diffs).toEqual([initialDiff, diffWithoutSon1]);

    expect(devour("Son #1")).toBe(false);

    expect(diffs).toEqual([initialDiff, diffWithoutSon1]);

    expect(devour("Son #2")).toBe(true);

    const diffWithoutDevouredSons = {
      result: {
        ruler: {
          name: "Cronus",
          __typename: "Deity",
          children: childrenWithoutSon1.filter((child) => {
            return child.name !== "Son #2";
          }),
        },
      },
      complete: true,
    };

    expect(diffs).toEqual([
      initialDiff,
      diffWithoutSon1,
      diffWithoutDevouredSons,
    ]);

    const childrenOfZeus = [
      "Ares",
      "Artemis",
      // Fun fact: Apollo is the only major Greco-Roman deity whose name
      // is the same in both traditions.
      "Apollo",
      "Athena",
    ].map((name) => ({
      __typename: "Deity",
      name,
      children: [],
    }));

    const zeusRef = cache.writeFragment({
      id: cache.identify({
        __typename: "Deity",
        name: "Zeus",
      }),
      fragment: gql`
        fragment Offspring on Deity {
          children {
            name
          }
        }
      `,
      data: {
        children: childrenOfZeus,
      },
    });

    expect(isReference(zeusRef)).toBe(true);
    expect(zeusRef!.__ref).toBe('Deity:{"name":"Zeus"}');

    const diffWithChildrenOfZeus = {
      complete: true,
      result: {
        ...diffWithoutDevouredSons.result,
        ruler: {
          ...diffWithoutDevouredSons.result.ruler,
          children: diffWithoutDevouredSons.result.ruler.children.map(
            (child) => {
              return child.name === "Zeus" ?
                  {
                    ...child,
                    children: childrenOfZeus
                      // Remove empty child.children arrays.
                      .map(({ children, ...child }) => child),
                  }
                : child;
            }
          ),
        },
      },
    };

    expect(diffs).toEqual([
      initialDiff,
      diffWithoutSon1,
      diffWithoutDevouredSons,
      diffWithChildrenOfZeus,
    ]);

    // Zeus usurps the throne from Cronus!
    cache.writeQuery({
      query: rulerQuery,
      data: {
        ruler: {
          __typename: "Deity",
          name: "Zeus",
        },
      },
    });

    const diffWithZeusAsRuler = {
      complete: true,
      result: {
        ruler: {
          __typename: "Deity",
          name: "Zeus",
          children: childrenOfZeus,
        },
      },
    };

    expect(diffs).toEqual([
      initialDiff,
      diffWithoutSon1,
      diffWithoutDevouredSons,
      diffWithChildrenOfZeus,
      diffWithZeusAsRuler,
    ]);

    expect(cache.gc().sort()).toEqual([
      'Deity:{"name":"Cronus"}',
      'Deity:{"name":"Demeter"}',
      'Deity:{"name":"Hades"}',
      'Deity:{"name":"Hera"}',
      'Deity:{"name":"Hestia"}',
      'Deity:{"name":"Poseidon"}',
    ]);

    const snapshotAfterGC = {
      ROOT_QUERY: {
        __typename: "Query",
        ruler: { __ref: 'Deity:{"name":"Zeus"}' },
      },
      'Deity:{"name":"Zeus"}': {
        __typename: "Deity",
        name: "Zeus",
        children: [
          { __ref: 'Deity:{"name":"Ares"}' },
          { __ref: 'Deity:{"name":"Artemis"}' },
          { __ref: 'Deity:{"name":"Apollo"}' },
          { __ref: 'Deity:{"name":"Athena"}' },
        ],
      },
      'Deity:{"name":"Apollo"}': {
        __typename: "Deity",
        name: "Apollo",
      },
      'Deity:{"name":"Artemis"}': {
        __typename: "Deity",
        name: "Artemis",
      },
      'Deity:{"name":"Ares"}': {
        __typename: "Deity",
        name: "Ares",
      },
      'Deity:{"name":"Athena"}': {
        __typename: "Deity",
        name: "Athena",
      },
    };

    const zeusMeta = {
      extraRootIds: ['Deity:{"name":"Zeus"}'],
    };

    expect(cache.extract()).toEqual({
      ...snapshotAfterGC,
      __META: zeusMeta,
    });

    // There should be no diff generated by garbage collection.
    expect(diffs).toEqual([
      initialDiff,
      diffWithoutSon1,
      diffWithoutDevouredSons,
      diffWithChildrenOfZeus,
      diffWithZeusAsRuler,
    ]);

    cancel();

    const lastDiff = diffs[diffs.length - 1];

    expect(
      cache.readQuery({
        query: rulerQuery,
      })
    ).toBe(lastDiff.result);

    expect(
      cache.evict({
        id: cache.identify({
          __typename: "Deity",
          name: "Ares",
        }),
      })
    ).toBe(true);

    // No new diff generated since we called cancel() above.
    expect(diffs).toEqual([
      initialDiff,
      diffWithoutSon1,
      diffWithoutDevouredSons,
      diffWithChildrenOfZeus,
      diffWithZeusAsRuler,
    ]);

    const snapshotWithoutAres = {
      ...snapshotAfterGC,
      __META: zeusMeta,
    };
    delete (snapshotWithoutAres as any)['Deity:{"name":"Ares"}'];
    expect(cache.extract()).toEqual(snapshotWithoutAres);
    // Ares already removed, so no new garbage to collect.
    expect(cache.gc()).toEqual([]);

    const childrenOfZeusWithoutAres = childrenOfZeus.filter((child) => {
      return child.name !== "Ares";
    });

    expect(childrenOfZeusWithoutAres).toEqual([
      { __typename: "Deity", name: "Artemis", children: [] },
      { __typename: "Deity", name: "Apollo", children: [] },
      { __typename: "Deity", name: "Athena", children: [] },
    ]);

    expect(
      cache.readQuery({
        query: rulerQuery,
      })
    ).toEqual({
      ruler: {
        __typename: "Deity",
        name: "Zeus",
        children: childrenOfZeusWithoutAres,
      },
    });

    expect(
      cache.evict({
        id: cache.identify({
          __typename: "Deity",
          name: "Zeus",
        }),
      })
    ).toBe(true);

    // You didn't think we were going to let Apollo be garbage-collected,
    // did you?
    cache.retain(
      cache.identify({
        __typename: "Deity",
        name: "Apollo",
      })!
    );

    expect(cache.gc().sort()).toEqual([
      'Deity:{"name":"Artemis"}',
      'Deity:{"name":"Athena"}',
    ]);

    expect(cache.extract()).toEqual({
      __META: {
        extraRootIds: ['Deity:{"name":"Apollo"}', 'Deity:{"name":"Zeus"}'],
      },
      ROOT_QUERY: {
        __typename: "Query",
        ruler: { __ref: 'Deity:{"name":"Zeus"}' },
      },
      'Deity:{"name":"Apollo"}': {
        __typename: "Deity",
        name: "Apollo",
      },
    });

    const apolloRulerResult = cache.readQuery<{
      ruler: Record<string, any>;
    }>({ query: rulerQuery })!;

    expect(apolloRulerResult).toEqual({
      ruler: {
        __typename: "Deity",
        name: "Apollo",
        children: [],
      },
    });

    // No new diffs since before.
    expect(diffs).toEqual([
      initialDiff,
      diffWithoutSon1,
      diffWithoutDevouredSons,
      diffWithChildrenOfZeus,
      diffWithZeusAsRuler,
    ]);

    // Rewatch the rulerQuery, but avoid delivering an immediate initial
    // result (by passing false), so that we can use cache.modify to
    // trigger the delivery of diffWithApolloAsRuler below.
    const cancel2 = watch(false);

    expect(diffs).toEqual([
      initialDiff,
      diffWithoutSon1,
      diffWithoutDevouredSons,
      diffWithChildrenOfZeus,
      diffWithZeusAsRuler,
    ]);

    cache.modify({
      fields: {
        ruler(value, { toReference }) {
          expect(isReference(value)).toBe(true);
          expect(value.__ref).toBe(
            cache.identify(diffWithZeusAsRuler.result.ruler)
          );
          expect(value.__ref).toBe('Deity:{"name":"Zeus"}');
          // Interim ruler Apollo takes over for real.
          return toReference(apolloRulerResult.ruler)!;
        },
      },
    });

    cancel2();

    const diffWithApolloAsRuler = {
      complete: true,
      result: apolloRulerResult,
    };

    // The cache.modify call should have triggered another diff, since we
    // overwrote the ROOT_QUERY.ruler field with a valid Reference to the
    // Apollo entity object.
    expect(diffs).toEqual([
      initialDiff,
      diffWithoutSon1,
      diffWithoutDevouredSons,
      diffWithChildrenOfZeus,
      diffWithZeusAsRuler,
      diffWithApolloAsRuler,
    ]);

    expect(
      // Undo the cache.retain call above.
      cache.release(
        cache.identify({
          __typename: "Deity",
          name: "Apollo",
        })!
      )
    ).toBe(0);

    // Since ROOT_QUERY.ruler points to Apollo, nothing needs to be
    // garbage collected.
    expect(cache.gc()).toEqual([]);

    // Having survived GC, Apollo reigns supreme atop Olympus... or
    // something like that.
    expect(cache.extract()).toEqual({
      __META: zeusMeta,
      ROOT_QUERY: {
        __typename: "Query",
        ruler: { __ref: 'Deity:{"name":"Apollo"}' },
      },
      'Deity:{"name":"Apollo"}': {
        __typename: "Deity",
        name: "Apollo",
      },
    });
  });

  it("returns === results for different queries", () => {
    const cache = new Hermes({
      // canonizeResults: true,
    });

    const aQuery: TypedDocumentNode<{
      a: string[];
    }> = gql`
      query {
        a
      }
    `;

    const abQuery: TypedDocumentNode<{
      a: string[];
      b: {
        c: string;
        d: string;
      };
    }> = gql`
      query {
        a
        b {
          c
          d
        }
      }
    `;

    const bQuery: TypedDocumentNode<{
      b: {
        c: string;
        d: string;
      };
    }> = gql`
      query {
        b {
          d
          c
        }
      }
    `;

    const abData1 = {
      a: ["a", "y"],
      b: {
        c: "see",
        d: "dee",
      },
    };

    cache.writeQuery({
      query: abQuery,
      data: abData1,
    });

    function read<Data, Vars>(query: TypedDocumentNode<Data, Vars>) {
      return cache.readQuery({ query })!;
    }

    const aResult1 = read(aQuery);
    const abResult1 = read(abQuery);
    const bResult1 = read(bQuery);

    expect(aResult1.a).toBe(abResult1.a);
    expect(abResult1).toEqual(abData1);
    expect(aResult1).toEqual({ a: abData1.a });
    expect(bResult1).toEqual({ b: abData1.b });
    expect(abResult1.b).toBe(bResult1.b);

    const aData2 = {
      a: "ayy".split(""),
    };

    cache.writeQuery({
      query: aQuery,
      data: aData2,
    });

    const aResult2 = read(aQuery);
    const abResult2 = read(abQuery);
    const bResult2 = read(bQuery);

    expect(aResult2).toEqual(aData2);
    expect(abResult2).toEqual({ ...abData1, ...aData2 });
    expect(aResult2.a).toBe(abResult2.a);
    expect(bResult2).toBe(bResult1);
    expect(abResult2.b).toBe(bResult2.b);
    expect(abResult2.b).toBe(bResult1.b);

    const bData3 = {
      b: {
        d: "D",
        c: "C",
      },
    };

    cache.writeQuery({
      query: bQuery,
      data: bData3,
    });

    const aResult3 = read(aQuery);
    const abResult3 = read(abQuery);
    const bResult3 = read(bQuery);

    expect(aResult3).toBe(aResult2);
    expect(bResult3).toEqual(bData3);
    expect(bResult3).not.toBe(bData3);
    expect(abResult3).toEqual({
      ...abResult2,
      ...bData3,
    });

    expect(cache.extract()).toMatchSnapshot();
  });

  it("does not canonicalize custom scalar objects", () => {
    const now = new Date();
    const abc = { a: 1, b: 2, c: 3 };

    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            now() {
              return now;
            },

            abc() {
              return abc;
            },
          },
        },
      },
    });

    const query: TypedDocumentNode<{
      now: typeof now;
      abc: typeof abc;
    }> = gql`
      query {
        now
        abc
      }
    `;

    const result1 = cache.readQuery({ query })!;
    const result2 = cache.readQuery({ query })!;

    expect(result1).toBe(result2);
    expect(result1.now).toBeInstanceOf(Date);

    // We already know result1.now === result2.now, but it's also
    // important that it be the very same (===) Date object that was
    // returned from the read function for the Query.now field, not a
    // canonicalized version.
    expect(result1.now).toBe(now);
    expect(result2.now).toBe(now);

    // The Query.abc field returns a "normal" object, but we know from the
    // structure of the query that it's a scalar object, so it will not be
    // canonicalized.
    expect(result1.abc).toEqual(abc);
    expect(result2.abc).toEqual(abc);
    expect(result1.abc).toBe(result2.abc);
    expect(result1.abc).toBe(abc);
    expect(result2.abc).toBe(abc);
  });

  it("readQuery can opt out of canonization", () => {
    let count = 0;

    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            count() {
              return count++;
            },
          },
        },
      },
    });

    const canon = cache["storeReader"].canon;

    const query = gql`
      query {
        count
      }
    `;

    function readQuery(canonizeResults: boolean) {
      return cache.readQuery<{
        count: number;
      }>({
        query,
        canonizeResults,
      });
    }

    const nonCanonicalQueryResult0 = readQuery(false);
    expect(canon.isKnown(nonCanonicalQueryResult0)).toBe(false);
    expect(nonCanonicalQueryResult0).toEqual({ count: 0 });

    const canonicalQueryResult0 = readQuery(true);
    expect(canon.isKnown(canonicalQueryResult0)).toBe(true);
    // The preservation of { count: 0 } proves the result didn't have to be
    // recomputed, but merely canonized.
    expect(canonicalQueryResult0).toEqual({ count: 0 });

    cache.evict({
      fieldName: "count",
    });

    const canonicalQueryResult1 = readQuery(true);
    expect(canon.isKnown(canonicalQueryResult1)).toBe(true);
    expect(canonicalQueryResult1).toEqual({ count: 1 });

    const nonCanonicalQueryResult1 = readQuery(false);
    // Since we already read a canonical result, we were able to reuse it when
    // reading the non-canonical result.
    expect(nonCanonicalQueryResult1).toBe(canonicalQueryResult1);
  });

  it("readFragment can opt out of canonization", () => {
    let count = 0;

    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            count() {
              return count++;
            },
          },
        },
      },
    });

    const canon = cache["storeReader"].canon;

    const fragment = gql`
      fragment CountFragment on Query {
        count
      }
    `;

    function readFragment(canonizeResults: boolean) {
      return cache.readFragment<{
        count: number;
      }>({
        id: "ROOT_QUERY",
        fragment,
        canonizeResults,
      });
    }

    const canonicalFragmentResult1 = readFragment(true);
    expect(canon.isKnown(canonicalFragmentResult1)).toBe(true);
    expect(canonicalFragmentResult1).toEqual({ count: 0 });

    const nonCanonicalFragmentResult1 = readFragment(false);
    // Since we already read a canonical result, we were able to reuse it when
    // reading the non-canonical result.
    expect(nonCanonicalFragmentResult1).toBe(canonicalFragmentResult1);

    cache.evict({
      fieldName: "count",
    });

    const nonCanonicalFragmentResult2 = readFragment(false);
    expect(readFragment(false)).toBe(nonCanonicalFragmentResult2);
    expect(canon.isKnown(nonCanonicalFragmentResult2)).toBe(false);
    expect(nonCanonicalFragmentResult2).toEqual({ count: 1 });
    expect(readFragment(false)).toBe(nonCanonicalFragmentResult2);

    const canonicalFragmentResult2 = readFragment(true);
    expect(readFragment(true)).toBe(canonicalFragmentResult2);
    expect(canon.isKnown(canonicalFragmentResult2)).toBe(true);
    expect(canonicalFragmentResult2).toEqual({ count: 1 });
  });
});
