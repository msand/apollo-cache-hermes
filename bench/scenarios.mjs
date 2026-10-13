// Benchmark scenarios. Each scenario's setup(impl) builds its state outside
// the timed region and returns { op, check }: `op` is the timed operation and
// `check` (optional) reports sanity data, so a scenario that silently does
// nothing (or something else) on one implementation is visible. A scenario's
// `valid(check)` returns true, or the reason the implementation does not
// support it; the worker then reports it as "n/a" instead of timing it.

import * as F from './fixtures.mjs';

function dashboardCache(impl, config) {
  const cache = impl.createCache(config);
  cache.writeQuery({ query: impl.gql(F.DASHBOARD), data: F.dashboardData() });
  return cache;
}

/** A small write: toggles one task's `done` flag (a different task each time). */
function taskToggler(impl, cache) {
  const fragment = impl.gql(F.TASK_DONE_FRAGMENT);
  let n = 0;
  return () => {
    const p = n % F.SIZES.projects;
    const t = Math.floor(n / F.SIZES.projects) % F.SIZES.tasksPerProject;
    const id = cache.identify({ __typename: 'Task', id: F.taskId(p, t) });
    // Every task id is toggled an even number of times per 2000 calls.
    const done = Math.floor(n / (F.SIZES.projects * F.SIZES.tasksPerProject)) % 2 === 0;
    cache.writeFragment({ id, fragment, data: { __typename: 'Task', id: F.taskId(p, t), done } });
    n++;
  };
}

function countTasks(data) {
  return data?.viewer?.organization?.projects?.reduce((sum, p) => sum + p.tasks.length, 0);
}

export const SCENARIOS = [
  {
    name: 'write.initial',
    description: 'Write the ~3.3k-entity dashboard query into a fresh cache',
    setup(impl) {
      const query = impl.gql(F.DASHBOARD);
      const data = F.dashboardData();
      let cache;
      return {
        op() {
          cache = impl.createCache();
          cache.writeQuery({ query, data });
        },
        check: () => ({ entities: impl.entityCount(cache) }),
      };
    },
    valid: c => c.entities > 1000 || 'nothing written',
  },
  {
    name: 'read.hit',
    description: 'readQuery of the unchanged dashboard (result cache hit)',
    setup(impl) {
      const cache = dashboardCache(impl);
      const query = impl.gql(F.DASHBOARD);
      let result;
      return {
        op() {
          result = cache.readQuery({ query });
        },
        check: () => ({ tasks: countTasks(result) }),
      };
    },
    valid: c => c.tasks === 1000 || 'incomplete result',
  },
  {
    name: 'read.afterWrite',
    description: 'Toggle one task, then readQuery the whole dashboard',
    setup(impl) {
      const cache = dashboardCache(impl);
      const query = impl.gql(F.DASHBOARD);
      const toggle = taskToggler(impl, cache);
      let result;
      return {
        op() {
          toggle();
          result = cache.readQuery({ query });
        },
        check: () => ({ tasks: countTasks(result) }),
      };
    },
    valid: c => c.tasks === 1000 || 'incomplete result',
  },
  {
    name: 'read.variables',
    description: 'readQuery of 20 parameterized queries, fresh variables objects each time',
    setup(impl) {
      const cache = impl.createCache();
      const query = impl.gql(F.PROJECT_TASKS);
      for (let i = 0; i < F.PROJECT_TASKS_SETS; i++) {
        cache.writeQuery({ query, variables: F.projectTasksVariables(i), data: F.projectTasksData(i) });
      }
      let rows = 0;
      return {
        op() {
          rows = 0;
          for (let i = 0; i < F.PROJECT_TASKS_SETS; i++) {
            rows += cache.readQuery({ query, variables: F.projectTasksVariables(i) }).project.tasks.length;
          }
        },
        check: () => ({ rows }),
      };
    },
    valid: c => c.rows === 400 || 'incomplete result',
  },
  {
    name: 'union.write',
    description: 'Write a 1.5k-item feed through interface/union fragments (possibleTypes)',
    setup(impl) {
      const query = impl.gql(F.FEED);
      const data = F.feedData();
      let cache;
      return {
        op() {
          cache = impl.createCache({ possibleTypes: F.POSSIBLE_TYPES });
          cache.writeQuery({ query, data });
        },
        check: () => ({ entities: impl.entityCount(cache) }),
      };
    },
    valid: c => c.entities > 1000 || 'nothing written',
  },
  {
    name: 'union.afterWrite',
    description: 'Change one feed item, then readQuery the 1.5k-item union feed',
    setup(impl) {
      const cache = impl.createCache({ possibleTypes: F.POSSIBLE_TYPES });
      const query = impl.gql(F.FEED);
      cache.writeQuery({ query, data: F.feedData() });
      const fragment = impl.gql(F.FEED_ITEM_FRAGMENT);
      let n = 0;
      let result;
      return {
        op() {
          // Posts are every 5th item.
          const i = (n % (F.SIZES.feedItems / 5)) * 5;
          const id = cache.identify({ __typename: 'Post', id: `f${i}` });
          cache.writeFragment({ id, fragment, data: { __typename: 'Post', id: `f${i}`, likes: n } });
          n++;
          result = cache.readQuery({ query });
        },
        check: () => ({
          items: result?.feed.items.length,
          withTitle: result?.feed.items.filter(item => item.title).length,
          withUrl: result?.feed.items.filter(item => item.url).length,
        }),
      };
    },
    valid: c =>
      (c.items === 1500 && c.withTitle === 600 && c.withUrl === 900) || 'fragments on interfaces/unions not read',
  },
  {
    name: 'policies.paginate',
    description: 'offsetLimitPagination merge: write 20 pages of 100, then read the 2k list',
    setup(impl) {
      const config = { typePolicies: { Query: { fields: { feedPage: impl.offsetLimitPagination(['category']) } } } };
      const query = impl.gql(F.FEED_PAGE);
      const pages = Array.from({ length: F.SIZES.pages }, (_, page) => F.feedPageData(page));
      let length = 0;
      return {
        op() {
          const cache = impl.createCache(config);
          for (let page = 0; page < F.SIZES.pages; page++) {
            cache.writeQuery({
              query,
              variables: { category: 'news', offset: page * F.SIZES.pageSize, limit: F.SIZES.pageSize },
              data: pages[page],
            });
          }
          length = cache.readQuery({ query, variables: { category: 'news', offset: 0, limit: F.SIZES.pageSize } })
            .feedPage.length;
        },
        check: () => ({ length }),
      };
    },
    valid: c => c.length === F.SIZES.pages * F.SIZES.pageSize || 'typePolicies merge functions not supported',
  },
  {
    name: 'policies.read',
    description: 'Toggle one task, then read 1k tasks through a read function, plus a cache redirect',
    setup(impl) {
      const config = {
        typePolicies: {
          Query: {
            fields: {
              task: { read: (_, { args, toReference }) => toReference({ __typename: 'Task', id: args.id }) },
            },
          },
          Task: {
            fields: {
              titleUpper: { read: (_, { readField }) => readField('title').toUpperCase() },
            },
          },
        },
      };
      const cache = dashboardCache(impl, config);
      const query = impl.gql(F.POLICY_READ);
      const toggle = taskToggler(impl, cache);
      let result;
      return {
        op() {
          toggle();
          result = cache.readQuery({ query, variables: { taskId: 'p3-t4' } });
        },
        check: () => ({
          tasks: countTasks(result),
          titleUpper: result?.viewer.organization.projects[0].tasks[0].titleUpper,
          redirect: result?.task?.titleUpper,
        }),
      };
    },
    valid: c =>
      (c.tasks === 1000 && c.titleUpper === 'TASK P0-T0' && c.redirect === 'TASK P3-T4') ||
      'typePolicies read functions not supported',
  },
  {
    name: 'policies.keyArgs',
    description: 'Write page 1 of a keyArgs field (50 items), then read it back as page 2',
    setup(impl) {
      const cache = dashboardCache(impl, { typePolicies: { Query: { fields: { search: { keyArgs: ['term'] } } } } });
      const query = impl.gql(F.SEARCH);
      const data = F.searchData();
      let result;
      return {
        op() {
          cache.writeQuery({ query, variables: { term: 'task', page: 1 }, data });
          // `page` is not a key argument, so page 2 reads what page 1 wrote.
          result = cache.readQuery({ query, variables: { term: 'task', page: 2 } });
        },
        check: () => ({ search: result?.search?.length }),
      };
    },
    valid: c => c.search === 50 || 'typePolicies keyArgs not supported',
  },
  {
    name: 'watch.broadcast',
    description: '50 watched project queries; rename one user (affects a few watches)',
    setup(impl) {
      const dashboard = F.dashboardData();
      const cache = impl.createCache();
      cache.writeQuery({ query: impl.gql(F.DASHBOARD), data: dashboard });
      const query = impl.gql(F.PROJECT_WATCH);
      let callbacks = 0;
      for (let p = 0; p < F.SIZES.watches; p++) {
        cache.writeQuery({ query, variables: { id: `p${p}` }, data: F.projectWatchData(dashboard, p) });
        cache.watch({ query, variables: { id: `p${p}` }, optimistic: true, callback: () => callbacks++ });
      }
      const fragment = impl.gql(F.USER_NAME_FRAGMENT);
      let n = 0;
      let ops = 0;
      // Count only the broadcasts caused by the timed writes.
      callbacks = 0;
      return {
        op() {
          const u = 1 + (n % (F.SIZES.users - 1));
          const id = cache.identify({ __typename: 'User', id: F.userId(u) });
          cache.writeFragment({
            id,
            fragment,
            data: { __typename: 'User', id: F.userId(u), name: `User ${u} (${Math.floor(n / F.SIZES.users)})` },
          });
          n++;
          ops++;
        },
        check: () => ({ callbacksPerOp: +(callbacks / ops).toFixed(2) }),
      };
    },
    valid: c => (c.callbacksPerOp > 0 && c.callbacksPerOp < 20) || 'unexpected broadcast count',
  },
  {
    name: 'gc.orphan',
    description: "Replace one project's 20 tasks (orphans 60 entities) in the dashboard, then collect",
    setup(impl) {
      const cache = dashboardCache(impl);
      const query = impl.gql(F.PROJECT_REPLACE_TASKS);
      const before = impl.entityCount(cache);
      let generation = 0;
      return {
        op() {
          const p = generation % F.SIZES.projects;
          cache.writeQuery({ query, variables: { id: `p${p}` }, data: F.projectReplaceTasksData(p, generation) });
          impl.collectGarbage(cache);
          generation++;
        },
        check: () => ({ entitiesBefore: before, entitiesAfter: impl.entityCount(cache) }),
      };
    },
    // Hermes also keeps one node per parameterized root field (project(id:)).
    valid: c => c.entitiesAfter - c.entitiesBefore <= F.SIZES.projects || 'orphaned entities are not removed',
  },
  {
    name: 'gc.cycle',
    description: 'Replace a 200-node cyclic cluster next to the dashboard (unreachable cycle), then collect',
    setup(impl) {
      const cache = dashboardCache(impl);
      const query = impl.gql(F.FOCUS);
      cache.writeQuery({ query, data: F.focusData(0) });
      const before = impl.entityCount(cache);
      let generation = 1;
      return {
        op() {
          cache.writeQuery({ query, data: F.focusData(generation++) });
          impl.collectGarbage(cache);
        },
        check: () => ({ entitiesBefore: before, entitiesAfter: impl.entityCount(cache) }),
      };
    },
    valid: c => c.entitiesAfter === c.entitiesBefore || 'unreachable cycles are not removed (the store grows)',
  },
  {
    name: 'diff.partial',
    description: 'diff (returnPartialData) of the dashboard plus a missing field, unchanged cache',
    setup(impl) {
      const cache = dashboardCache(impl);
      const query = impl.gql(F.DASHBOARD_PARTIAL);
      let result;
      return {
        op() {
          result = cache.diff({ query, returnPartialData: true, optimistic: false });
        },
        check: () => ({ complete: result.complete, tasks: countTasks(result.result) }),
      };
    },
    valid: c => (c.complete === false && c.tasks === 1000) || 'unexpected partial result',
  },
  {
    name: 'diff.partial.afterWrite',
    description: 'Toggle one task, then diff (returnPartialData) of the partial dashboard',
    setup(impl) {
      const cache = dashboardCache(impl);
      const query = impl.gql(F.DASHBOARD_PARTIAL);
      const toggle = taskToggler(impl, cache);
      let result;
      return {
        op() {
          toggle();
          result = cache.diff({ query, returnPartialData: true, optimistic: false });
        },
        check: () => ({ complete: result.complete, tasks: countTasks(result.result) }),
      };
    },
    valid: c => (c.complete === false && c.tasks === 1000) || 'unexpected partial result',
  },
  {
    name: 'modify.read',
    description: 'cache.modify one task field, then readQuery the dashboard',
    setup(impl) {
      const cache = dashboardCache(impl);
      const query = impl.gql(F.DASHBOARD);
      let n = 0;
      let result;
      return {
        op() {
          const p = n % F.SIZES.projects;
          const t = Math.floor(n / F.SIZES.projects) % F.SIZES.tasksPerProject;
          cache.modify({
            id: cache.identify({ __typename: 'Task', id: F.taskId(p, t) }),
            fields: { done: done => !done },
          });
          n++;
          result = cache.readQuery({ query });
        },
        check: () => ({ tasks: countTasks(result) }),
      };
    },
    valid: c => c.tasks === 1000 || 'incomplete result',
  },
  {
    name: 'extract',
    description: 'extract() the dashboard cache',
    setup(impl) {
      const cache = dashboardCache(impl);
      let snapshot;
      return {
        op() {
          snapshot = cache.extract();
        },
        check: () => ({ keys: Object.keys(snapshot).length }),
      };
    },
    valid: c => c.keys > 3000 || 'incomplete snapshot',
  },
  {
    name: 'restore',
    description: 'restore() an extracted dashboard snapshot into a fresh cache, then read it',
    setup(impl) {
      const snapshot = dashboardCache(impl).extract();
      const query = impl.gql(F.DASHBOARD);
      let result;
      return {
        op() {
          const cache = impl.createCache();
          cache.restore(snapshot);
          result = cache.readQuery({ query });
        },
        check: () => ({ tasks: countTasks(result) }),
      };
    },
    valid: c => c.tasks === 1000 || 'incomplete result',
  },
];
