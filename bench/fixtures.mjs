// Deterministic data and query text for the benchmark scenarios.
//
// Queries are plain strings; each implementation parses them with its own
// `gql`, so every cache sees documents built by its own Apollo Client version.
// Every query selects `__typename` explicitly, so caches that add it and
// caches that do not see the same documents and store the same data.

export const SIZES = {
  users: 200,
  tags: 50,
  projects: 50,
  tasksPerProject: 20,
  commentsPerTask: 2,
  tagsPerTask: 2,
  feedItems: 1500,
  locations: 50,
  pages: 20,
  pageSize: 100,
  cycleNodes: 200,
  watches: 50,
};

/** A small seeded PRNG (mulberry32), so every run builds identical data. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const STATUSES = ['ACTIVE', 'PAUSED', 'DONE'];

// ---------------------------------------------------------------------------
// Dashboard: ~3.3k entities (1 org, 50 projects, 1000 tasks, 2000 comments,
// 200 users, 50 tags) with nested lists and shared references.

export const DASHBOARD = `
  query Dashboard {
    viewer {
      __typename id name
      organization {
        __typename id name
        projects {
          __typename id name status
          owner { __typename id name }
          tasks {
            __typename id title done priority
            assignee { __typename id name avatar }
            tags { __typename id label }
            comments { __typename id body author { __typename id name } }
          }
        }
      }
    }
  }
`;

// The dashboard plus a field that is never written: a partial result.
export const DASHBOARD_PARTIAL = DASHBOARD.replace('done priority', 'done priority estimate');

export const userId = i => `u${i}`;
export const taskId = (p, t) => `p${p}-t${t}`;

function user(i, withAvatar) {
  const u = { __typename: 'User', id: userId(i), name: `User ${i}` };
  if (withAvatar) u.avatar = `https://example.com/avatars/${i}.png`;
  return u;
}

export function taskData(random, p, t, prefix = '') {
  const id = prefix + taskId(p, t);
  return {
    __typename: 'Task',
    id,
    title: `Task ${id}`,
    done: random() < 0.3,
    priority: PRIORITIES[Math.floor(random() * PRIORITIES.length)],
    assignee: user(Math.floor(random() * SIZES.users), true),
    tags: Array.from({ length: SIZES.tagsPerTask }, () => {
      const tag = Math.floor(random() * SIZES.tags);
      return { __typename: 'Tag', id: `tag${tag}`, label: `Tag ${tag}` };
    }),
    comments: Array.from({ length: SIZES.commentsPerTask }, (_, c) => ({
      __typename: 'Comment',
      id: `${id}-c${c}`,
      body: `Comment ${c} on ${id}: ${'lorem ipsum '.repeat(3)}`,
      author: user(Math.floor(random() * SIZES.users), false),
    })),
  };
}

export function dashboardData() {
  const random = rng(1);
  return {
    viewer: {
      __typename: 'User',
      id: userId(0),
      name: 'User 0',
      organization: {
        __typename: 'Organization',
        id: 'org1',
        name: 'Acme',
        projects: Array.from({ length: SIZES.projects }, (_, p) => ({
          __typename: 'Project',
          id: `p${p}`,
          name: `Project ${p}`,
          status: STATUSES[p % STATUSES.length],
          owner: user(Math.floor(random() * SIZES.users), false),
          tasks: Array.from({ length: SIZES.tasksPerProject }, (_, t) => taskData(random, p, t)),
        })),
      },
    },
  };
}

// A small write that changes one task.
export const TASK_DONE_FRAGMENT = `fragment TaskDone on Task { __typename id done }`;
export const TASK_TITLE_FRAGMENT = `fragment TaskTitle on Task { __typename id title }`;
export const USER_NAME_FRAGMENT = `fragment UserName on User { __typename id name }`;

// ---------------------------------------------------------------------------
// Parameterized fields and variables.

export const PROJECT_TASKS = `
  query ProjectTasks($projectId: ID!, $first: Int!, $done: Boolean, $orderBy: TaskOrder) {
    project(id: $projectId) {
      __typename id name
      tasks(first: $first, filter: { done: $done }, orderBy: $orderBy) {
        __typename id title done priority
        assignee { __typename id name }
      }
    }
  }
`;

/** 20 variable sets; build a fresh object per read, as components do. */
export function projectTasksVariables(i) {
  return { projectId: `p${i % 10}`, first: 20, done: i % 2 === 0, orderBy: i < 10 ? 'PRIORITY' : 'TITLE' };
}
export const PROJECT_TASKS_SETS = 20;

export function projectTasksData(i) {
  const random = rng(100 + i);
  const vars = projectTasksVariables(i);
  const p = Number(vars.projectId.slice(1));
  return {
    project: {
      __typename: 'Project',
      id: vars.projectId,
      name: `Project ${p}`,
      tasks: Array.from({ length: vars.first }, (_, t) => {
        const task = taskData(random, p, t);
        return {
          __typename: 'Task',
          id: task.id,
          title: task.title,
          done: vars.done,
          priority: task.priority,
          assignee: { __typename: 'User', id: task.assignee.id, name: task.assignee.name },
        };
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Fragments on interfaces and unions (needs possibleTypes).

export const POSSIBLE_TYPES = {
  FeedItem: ['Post', 'Event', 'Ad', 'Photo', 'Video'],
  Media: ['Photo', 'Video'],
  SearchResult: ['Post', 'Event'],
};

export const FEED = `
  query Feed {
    feed {
      __typename id
      items {
        ...FeedItemFields
        ... on Post { ...PostFields }
        ... on Event { ...EventFields }
        ... on Ad { headline url }
        ... on Media { url ... on Photo { width height } ... on Video { duration } }
      }
    }
  }
  fragment FeedItemFields on FeedItem { __typename id createdAt author { __typename id name } }
  fragment PostFields on Post { title body likes }
  fragment EventFields on Event { title startsAt location { __typename id name } }
`;

export const FEED_ITEM_FRAGMENT = `fragment FeedLikes on Post { __typename id likes }`;

export function feedData() {
  const random = rng(2);
  const kinds = ['Post', 'Event', 'Ad', 'Photo', 'Video'];
  return {
    feed: {
      __typename: 'Feed',
      id: 'main',
      items: Array.from({ length: SIZES.feedItems }, (_, i) => {
        const __typename = kinds[i % kinds.length];
        const a = Math.floor(random() * SIZES.users);
        const item = {
          __typename,
          id: `f${i}`,
          createdAt: `2026-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`,
          author: { __typename: 'User', id: userId(a), name: `User ${a}` },
        };
        switch (__typename) {
          case 'Post':
            return { ...item, title: `Post ${i}`, body: 'body '.repeat(10), likes: i };
          case 'Event': {
            const l = Math.floor(random() * SIZES.locations);
            return {
              ...item,
              title: `Event ${i}`,
              startsAt: '2026-02-01T10:00:00Z',
              location: { __typename: 'Location', id: `l${l}`, name: `Location ${l}` },
            };
          }
          case 'Ad':
            return { ...item, headline: `Ad ${i}`, url: `https://example.com/ad/${i}` };
          case 'Photo':
            return { ...item, url: `https://example.com/p/${i}.jpg`, width: 640, height: 480 };
          default:
            return { ...item, url: `https://example.com/v/${i}.mp4`, duration: 30 + (i % 90) };
        }
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// typePolicies: read functions, keyArgs, merge (offsetLimitPagination).

export const FEED_PAGE = `
  query FeedPage($category: String!, $offset: Int!, $limit: Int!) {
    feedPage(category: $category, offset: $offset, limit: $limit) {
      __typename id title score
    }
  }
`;

export function feedPageData(page) {
  return {
    feedPage: Array.from({ length: SIZES.pageSize }, (_, i) => {
      const n = page * SIZES.pageSize + i;
      return { __typename: 'Story', id: `s${n}`, title: `Story ${n}`, score: n % 97 };
    }),
  };
}

// Reads the dashboard's tasks through a read function (Task.titleUpper, never
// written) and a cache redirect (Query.task).
export const POLICY_READ = `
  query PolicyRead($taskId: ID!) {
    viewer {
      __typename id
      organization {
        __typename id
        projects { __typename id tasks { __typename id title titleUpper done } }
      }
    }
    task(id: $taskId) { __typename id title titleUpper }
  }
`;

// Query.search has keyArgs: ['term'], so every page shares one stored list.
export const SEARCH = `
  query Search($term: String!, $page: Int!) {
    search(term: $term, page: $page) { __typename id title }
  }
`;

export function searchData() {
  return {
    search: Array.from({ length: 50 }, (_, i) => ({
      __typename: 'Task',
      id: taskId(i % 50, 0),
      title: `Task ${taskId(i % 50, 0)}`,
    })),
  };
}

// ---------------------------------------------------------------------------
// Watches: one query per project.

export const PROJECT_WATCH = `
  query ProjectWatch($id: ID!) {
    project(id: $id) {
      __typename id name
      tasks { __typename id title done assignee { __typename id name } }
    }
  }
`;

export function projectWatchData(dashboard, p) {
  const project = dashboard.viewer.organization.projects[p];
  return {
    project: {
      __typename: 'Project',
      id: project.id,
      name: project.name,
      tasks: project.tasks.map(t => ({
        __typename: 'Task',
        id: t.id,
        title: t.title,
        done: t.done,
        assignee: { __typename: 'User', id: t.assignee.id, name: t.assignee.name },
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Orphans: replace one project's tasks with a fresh generation of tasks.

export const PROJECT_REPLACE_TASKS = `
  query ProjectReplaceTasks($id: ID!) {
    project(id: $id) {
      __typename id
      tasks {
        __typename id title done priority
        assignee { __typename id name avatar }
        tags { __typename id label }
        comments { __typename id body author { __typename id name } }
      }
    }
  }
`;

export function projectReplaceTasksData(p, generation) {
  const random = rng(1000 + generation);
  return {
    project: {
      __typename: 'Project',
      id: `p${p}`,
      tasks: Array.from({ length: SIZES.tasksPerProject }, (_, t) => taskData(random, p, t, `g${generation}-`)),
    },
  };
}

// ---------------------------------------------------------------------------
// Cycles: a cluster of nodes in a ring, each pointing back at its cluster.
// Replacing the focused cluster leaves the old ring unreachable but with
// non-zero reference counts.

export const FOCUS = `
  query Focus {
    focus {
      __typename id
      nodes { __typename id label next { __typename id } cluster { __typename id } }
    }
  }
`;

export function focusData(generation) {
  const clusterId = `c${generation}`;
  const nodeId = i => `${clusterId}-n${i}`;
  return {
    focus: {
      __typename: 'Cluster',
      id: clusterId,
      nodes: Array.from({ length: SIZES.cycleNodes }, (_, i) => ({
        __typename: 'GraphNode',
        id: nodeId(i),
        label: `Node ${i}`,
        next: { __typename: 'GraphNode', id: nodeId((i + 1) % SIZES.cycleNodes) },
        cluster: { __typename: 'Cluster', id: clusterId },
      })),
    },
  };
}
