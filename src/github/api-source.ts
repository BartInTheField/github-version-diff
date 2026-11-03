import type { ForcePush, PrCommit, PrMeta, PrRef, Push, VersionSource } from '../types';
import { encodeRef } from './urls';

/**
 * Version data from the GitHub API, using a fine-grained PAT. api.github.com does not accept
 * session cookies, and it answers CORS requests, so the content script calls it directly.
 *
 * Primary: REST repository activity for the head branch (one entry per push, like Graphite's
 * versions). Fallback: GraphQL force-push timeline.
 */

const API = 'https://api.github.com';
const MAX_PAGES = 20;

export class TokenError extends Error {}

const QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      headRefOid baseRefName baseRefOid state
      timelineItems(first: 100, after: $cursor, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT, PULL_REQUEST_COMMIT]) {
        pageInfo { hasNextPage endCursor }
        nodes {
          __typename
          ... on HeadRefForcePushedEvent { createdAt actor { login } beforeCommit { oid } afterCommit { oid } }
          ... on PullRequestCommit { commit { oid committedDate messageHeadline author { name user { login } } } }
        }
      }
    }
  }
}`;

type Json = Record<string, any>;

async function apiResponse(pathOrUrl: string, token: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(pathOrUrl.startsWith('https://') ? pathOrUrl : `${API}${pathOrUrl}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...init.headers },
  });
  if (res.status === 401 || res.status === 403) {
    throw new TokenError(`GitHub API rejected the token (${res.status}). Check that it can read this repository.`);
  }
  if (!res.ok) throw new Error(`GitHub API ${new URL(res.url).pathname} → ${res.status}`);
  return res;
}

async function api(path: string, token: string, init: RequestInit = {}): Promise<Json> {
  return (await apiResponse(path, token, init)).json();
}

function nextLink(res: Response): string | undefined {
  return /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1];
}

/** REST activity items → pushes. Exported for tests. */
export function parseActivityItems(items: Json[]): Push[] {
  return items.map((it) => ({
    kind: String(it.activity_type),
    before: /^0+$/.test(it.before ?? '') ? undefined : it.before,
    after: /^0+$/.test(it.after ?? '') ? undefined : it.after,
    at: String(it.timestamp),
    actor: it.actor?.login,
  }));
}

const MAX_ACTIVITY_PAGES = 10;

async function loadActivity(meta: PrMeta, token: string): Promise<Push[]> {
  if (!meta.headBranch || !meta.headOwner || !meta.headRepo) return [];
  const ref = encodeURIComponent(`refs/heads/${meta.headBranch}`);
  let url: string | undefined = `/repos/${meta.headOwner}/${meta.headRepo}/activity?ref=${ref}&per_page=100&direction=asc`;
  const pushes: Push[] = [];
  for (let page = 0; url && page < MAX_ACTIVITY_PAGES; page++) {
    const res = await apiResponse(url, token);
    pushes.push(...parseActivityItems(await res.json()));
    url = nextLink(res);
  }
  return pushes;
}

async function viewerReviewSha(pr: PrRef, token: string): Promise<string | undefined> {
  const [user, reviews] = await Promise.all([
    api('/user', token),
    api(`/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews?per_page=100`, token) as Promise<unknown>,
  ]);
  const mine = (reviews as Json[]).filter((r) => r.user?.login === user.login && r.commit_id && r.state !== 'PENDING');
  return mine[mine.length - 1]?.commit_id;
}

export async function loadViaApi(pr: PrRef, token: string): Promise<VersionSource> {
  const pull = await api(`/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`, token);
  const meta: PrMeta = {
    headSha: pull.head?.sha,
    headBranch: pull.head?.ref,
    headOwner: pull.head?.repo?.owner?.login,
    headRepo: pull.head?.repo?.name,
    baseBranch: pull.base?.ref,
    baseSha: pull.base?.sha,
    state: pull.merged_at ? 'MERGED' : String(pull.state ?? '').toUpperCase(),
    createdAt: pull.created_at,
  };
  const [pushes, reviewSha] = await Promise.all([
    loadActivity(meta, token).catch(() => [] as Push[]),
    viewerReviewSha(pr, token).catch(() => undefined),
  ]);
  meta.viewerReviewSha = reviewSha;
  if (pushes.length) return { meta, pushes, forcePushes: [], commits: [], incomplete: false, via: 'api' };

  const timeline = await loadViaGraphql(pr, token);
  return { ...timeline, meta: { ...timeline.meta, ...meta } };
}

/** Convert one page of GraphQL timeline nodes. Exported for tests. */
export function parseTimelineNodes(nodes: Json[]): { forcePushes: ForcePush[]; commits: PrCommit[] } {
  const forcePushes: ForcePush[] = [];
  const commits: PrCommit[] = [];
  for (const n of nodes) {
    if (n.__typename === 'HeadRefForcePushedEvent') {
      // beforeCommit/afterCommit are null when GitHub no longer has the object.
      if (n.beforeCommit?.oid && n.afterCommit?.oid) {
        forcePushes.push({ before: n.beforeCommit.oid, after: n.afterCommit.oid, at: n.createdAt, actor: n.actor?.login });
      }
    } else if (n.__typename === 'PullRequestCommit' && n.commit?.oid) {
      commits.push({
        sha: n.commit.oid,
        at: n.commit.committedDate,
        author: n.commit.author?.user?.login ?? n.commit.author?.name,
        message: n.commit.messageHeadline,
      });
    }
  }
  return { forcePushes, commits };
}

export async function loadViaGraphql(pr: PrRef, token: string): Promise<VersionSource> {
  const forcePushes: ForcePush[] = [];
  const commits: PrCommit[] = [];
  let cursor: string | null = null;
  let p: Json = {};
  let incomplete = false;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      incomplete = true;
      break;
    }
    const body: Json = await api('/graphql', token, {
      method: 'POST',
      body: JSON.stringify({ query: QUERY, variables: { owner: pr.owner, repo: pr.repo, number: pr.number, cursor } }),
    });
    if (body.errors?.length) throw new Error(`GraphQL: ${body.errors[0].message}`);
    p = body.data?.repository?.pullRequest;
    if (!p) throw new Error('GraphQL: pull request not found');
    const parsed = parseTimelineNodes(p.timelineItems.nodes);
    forcePushes.push(...parsed.forcePushes);
    commits.push(...parsed.commits);
    if (!p.timelineItems.pageInfo.hasNextPage) break;
    cursor = p.timelineItems.pageInfo.endCursor;
  }
  return {
    meta: { headSha: p.headRefOid, baseBranch: p.baseRefName, baseSha: p.baseRefOid, state: p.state },
    forcePushes,
    commits,
    incomplete,
    via: 'api',
  };
}

const mergeBases = new Map<string, Promise<string | undefined>>();

/** Exact merge-base of `sha` with the base branch (REST compare API). Cached per session. */
export function mergeBase(pr: PrRef, baseRef: string, sha: string, token: string): Promise<string | undefined> {
  const path = `/repos/${pr.owner}/${pr.repo}/compare/${encodeRef(baseRef)}...${sha}?per_page=1`;
  let p = mergeBases.get(path);
  if (!p) {
    p = api(path, token).then((body) => body.merge_base_commit?.sha as string | undefined);
    p.catch(() => mergeBases.delete(path));
    mergeBases.set(path, p);
  }
  return p;
}
