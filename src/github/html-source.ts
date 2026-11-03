import type { ForcePush, PrCommit, PrMeta, PrRef, Push, VersionSource } from '../types';
import { GITHUB, githubFetch, type NetRequest } from './net';

/**
 * Token-less version data, scraped from github.com pages with the user's session cookies.
 * See NOTES.md for what was verified and what is best-effort.
 */

const COMPARE_RE = /\/compare\/([0-9a-f]{7,40})\.\.([0-9a-f]{7,40})(?:$|[?#])/;
const SHA_IN_PATH_RE = /\/commits?\/([0-9a-f]{40})(?:$|[/?#])/;
const MAX_TIMELINE_PAGES = 30;
const MAX_ACTIVITY_PAGES = 10;

type RequestInit = Omit<NetRequest, 'url'>;
export type FetchText = (url: string, init?: RequestInit) => Promise<string>;

export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const res = await githubFetch({ url, ...init });
  if (!res.ok) throw new Error(res.status ? `GitHub returned ${res.status} for ${new URL(url).pathname}` : 'Could not reach github.com');
  return res.text;
}

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** Force-push events rendered in a (partial) Conversation timeline. */
export function parseForcePushes(root: ParentNode): ForcePush[] {
  const seen = new Map<string, ForcePush>();
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/compare/"]'))) {
    const m = COMPARE_RE.exec(a.getAttribute('href') ?? '');
    if (!m) continue;
    const item = a.closest('.TimelineItem, .js-timeline-item') ?? a.parentElement;
    const isForcePush =
      /force-pushed/i.test(item?.textContent ?? a.textContent ?? '') || !!item?.querySelector('.octicon-repo-push');
    if (!isForcePush) continue;
    const key = `${m[1]}..${m[2]}`;
    if (seen.has(key)) continue;
    const times = /\b(\d+) times\b/.exec(item?.textContent ?? '');
    seen.set(key, {
      before: m[1] as string,
      after: m[2] as string,
      at: item?.querySelector('relative-time')?.getAttribute('datetime') ?? undefined,
      actor: item?.querySelector('a.author')?.textContent?.trim() || undefined,
      branch: item?.querySelector('.commit-ref')?.textContent?.trim() || undefined,
      times: times ? Number(times[1]) : undefined,
    });
  }
  return [...seen.values()];
}

/** JSON blobs that GitHub's React pages embed for hydration. */
export function embeddedData(root: ParentNode): unknown[] {
  return Array.from(root.querySelectorAll('script[data-target="react-app.embeddedData"]')).flatMap((s) => {
    try {
      return [JSON.parse(s.textContent ?? '')];
    } catch {
      return [];
    }
  });
}

/** Depth-first search for the first value stored under `key`. */
export function findKey(obj: unknown, key: string): unknown {
  const stack: unknown[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (!Array.isArray(cur) && key in cur) return (cur as Record<string, unknown>)[key];
    stack.push(...Object.values(cur));
  }
  return undefined;
}

type Json = Record<string, any>;

/**
 * Force-push events in embedded JSON. GitHub's React conversation view (rolled out to some
 * users) ships GraphQL-shaped timeline nodes; match them by shape rather than by path.
 */
export function forcePushesFromJson(obj: unknown): ForcePush[] {
  const out: ForcePush[] = [];
  const stack: unknown[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    const o = cur as Json;
    const before = o.beforeCommit?.oid;
    const after = o.afterCommit?.oid;
    if (o.__typename === 'BaseRefForcePushedEvent') continue;
    if (typeof before === 'string' && typeof after === 'string') {
      out.push({ before, after, at: o.createdAt, actor: o.actor?.login });
      continue;
    }
    stack.push(...Object.values(o));
  }
  return out;
}

/** "Load more…" controls for hidden timeline items. */
export function findLoadMoreForms(root: ParentNode): HTMLFormElement[] {
  return Array.from(root.querySelectorAll<HTMLFormElement>('form')).filter(
    (f) =>
      /\bajax-pagination\b|\bjs-ajax-pagination\b|ajax-pagination-form/.test(f.className) ||
      Array.from(f.querySelectorAll('button')).some((b) => /load more|hidden items/i.test(b.textContent ?? '')),
  );
}

/**
 * Progressive timeline loaders: when GitHub truncates the middle of a long timeline it leaves
 * an element whose `data-timeline-item-src` (relative to the site root) loads the gap.
 */
export function findTimelineGapLoaders(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('[data-timeline-item-src]'))
    .map((el) => el.getAttribute('data-timeline-item-src') ?? '')
    .filter((src) => /before_cursor=/.test(src) && /after_cursor=/.test(src));
}

type PageRequest = { url: string; init: RequestInit };

const XHR_HEADERS = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html' };

function gapRequest(src: string, base: string): PageRequest {
  const url = new URL(src.startsWith('/') ? src : `/${src}`, base);
  return { url: url.toString(), init: { headers: XHR_HEADERS } };
}

function formRequest(form: HTMLFormElement, base: string): PageRequest {
  const method = (form.getAttribute('method') ?? 'get').toUpperCase();
  const url = new URL(form.getAttribute('action') ?? '', base);
  const params = new URLSearchParams();
  for (const el of Array.from(form.querySelectorAll<HTMLInputElement>('input[name]'))) {
    params.append(el.name, el.value);
  }
  const headers = XHR_HEADERS;
  if (method === 'GET') {
    params.forEach((v, k) => url.searchParams.append(k, v));
    return { url: url.toString(), init: { method, headers } };
  }
  return {
    url: url.toString(),
    init: { method, headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() },
  };
}

export interface TimelineScan {
  forcePushes: ForcePush[];
  /** Load-more pages that we found but could not fetch. */
  failedPages: number;
  /** Force-pushes hidden inside collapsed "N times" items. */
  collapsed: number;
}

/**
 * Parse the Conversation page and follow "Load more…" pagination. Force-pushes of other
 * branches (the base branch of a stacked PR) are dropped when the head branch is known.
 */
export async function scanTimeline(
  firstPage: Document,
  base: string,
  get: FetchText,
  opts: { headBranch?: string; followPages?: boolean } = {},
): Promise<TimelineScan> {
  const all = new Map<string, ForcePush>();
  const addAll = (fps: ForcePush[]) => fps.forEach((fp) => all.set(`${fp.before}..${fp.after}`, fp));

  addAll(parseForcePushes(firstPage));
  embeddedData(firstPage).forEach((d) => addAll(forcePushesFromJson(d)));

  const pagesIn = (root: ParentNode): PageRequest[] => [
    ...findLoadMoreForms(root).map((f) => formRequest(f, base)),
    ...findTimelineGapLoaders(root).map((src) => gapRequest(src, base)),
  ];

  const visited = new Set<string>();
  let queue = opts.followPages === false ? [] : pagesIn(firstPage);
  let failedPages = 0;
  let fetched = 0;
  while (queue.length) {
    const next: PageRequest[] = [];
    for (const { url, init } of queue) {
      if (visited.has(url)) continue;
      visited.add(url);
      if (fetched++ >= MAX_TIMELINE_PAGES) {
        failedPages++;
        continue;
      }
      try {
        const frag = parseHtml(await get(url, init));
        addAll(parseForcePushes(frag));
        next.push(...pagesIn(frag));
      } catch {
        failedPages++;
      }
    }
    queue = next;
  }
  const forcePushes = [...all.values()].filter((fp) => !opts.headBranch || !fp.branch || fp.branch === opts.headBranch);
  const collapsed = forcePushes.reduce((n, fp) => n + Math.max(0, (fp.times ?? 1) - 1), 0);
  return { forcePushes, failedPages, collapsed };
}

/** Commits tab: current commit list (oldest first) and PR metadata. */
export function parseCommitsPage(doc: Document, pr: PrRef): { meta: PrMeta; commits: PrCommit[] } {
  const data = embeddedData(doc);
  const route = data.map((d) => findKey(d, 'pullRequestsCommitsRoute')).find(Boolean) as Json | undefined;
  const layout = data.map((d) => findKey(d, 'pullRequestsLayoutRoute')).find(Boolean) as Json | undefined;
  const p = (layout?.pullRequest ?? {}) as Json;

  let commits: PrCommit[] = [];
  const groups = route?.commitGroups;
  if (Array.isArray(groups)) {
    commits = groups.flatMap((g: Json) => (Array.isArray(g.commits) ? g.commits : [])).map((c: Json) => ({
      sha: String(c.oid),
      at: c.pushedDate ?? c.committedDate ?? c.authoredDate ?? undefined,
      author: c.authors?.[0]?.login ?? c.authors?.[0]?.displayName ?? undefined,
      message: c.shortMessage ?? undefined,
    }));
  } else {
    // Classic (non-React) commits page: commit links in document order.
    const seen = new Set<string>();
    for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>(`a[href*="/pull/${pr.number}/commits/"]`))) {
      const m = SHA_IN_PATH_RE.exec(a.getAttribute('href') ?? '');
      if (m && !seen.has(m[1] as string)) {
        seen.add(m[1] as string);
        commits.push({ sha: m[1] as string });
      }
    }
  }

  return {
    meta: {
      headSha: p.headSha ?? commits[commits.length - 1]?.sha,
      headBranch: p.headBranch,
      headOwner: p.headRepositoryOwnerLogin ?? pr.owner,
      headRepo: p.headRepositoryName ?? pr.repo,
      createdAt: p.createdTime,
      baseBranch: p.baseBranch,
      baseSha: p.baseSha,
      state: p.state,
    },
    commits,
  };
}

/** One page of a repository's Activity view (`/<o>/<r>/activity?ref=<branch>`), newest first. */
export function parseActivityPage(doc: Document): { pushes: Push[]; hasNextPage: boolean; endCursor?: string } | undefined {
  const list = embeddedData(doc).map((d) => findKey(d, 'activityList')).find(Boolean) as Json | undefined;
  if (!list || !Array.isArray(list.items)) return undefined;
  const pushes = list.items.map((it: Json) => ({
    kind: String(it.pushType),
    before: it.before ?? undefined,
    after: it.after ?? undefined,
    at: String(it.pushedAt),
    actor: it.pusher?.login ?? undefined,
    message: it.commit?.message ?? undefined,
  }));
  return { pushes, hasNextPage: !!list.hasNextPage, endCursor: list.endCursor ?? undefined };
}

/**
 * All pushes to the head branch since just before the PR was opened. Pages are newest first;
 * stop once we have a push from before the PR's creation (that is v1).
 */
export async function loadActivity(meta: PrMeta, get: FetchText): Promise<Push[] | undefined> {
  if (!meta.headBranch || !meta.headOwner || !meta.headRepo) return undefined;
  const url = new URL(`${GITHUB}/${meta.headOwner}/${meta.headRepo}/activity`);
  url.searchParams.set('ref', meta.headBranch);
  const created = meta.createdAt ? Date.parse(meta.createdAt) : NaN;
  const pushes: Push[] = [];
  for (let page = 0; page < MAX_ACTIVITY_PAGES; page++) {
    const parsed = parseActivityPage(parseHtml(await get(url.toString())));
    if (!parsed) return pushes.length ? pushes : undefined;
    pushes.push(...parsed.pushes);
    const oldest = parsed.pushes[parsed.pushes.length - 1];
    if (!parsed.hasNextPage || !parsed.endCursor) break;
    if (oldest && Date.parse(oldest.at) <= created) break;
    url.searchParams.set('after', parsed.endCursor);
  }
  return pushes;
}

/** The commit of the signed-in user's latest review, from the reviewers sidebar. */
export function viewerReviewSha(doc: Document): string | undefined {
  const login = doc.querySelector('meta[name="user-login"]')?.getAttribute('content');
  if (!login) return undefined;
  const link = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[id^="review-status-"]')).find(
    (a) => a.id === `review-status-${login}`,
  );
  return /\/files\/([0-9a-f]{40})/.exec(link?.getAttribute('href') ?? '')?.[1];
}

export async function loadViaHtml(pr: PrRef, get: FetchText = fetchText): Promise<VersionSource> {
  const base = `${GITHUB}/${pr.owner}/${pr.repo}/pull/${pr.number}`;
  const [conversation, commitsPage] = await Promise.all([get(base), get(`${base}/commits`)]);
  const conversationDoc = parseHtml(conversation);
  const { meta, commits } = parseCommitsPage(parseHtml(commitsPage), pr);
  meta.viewerReviewSha = viewerReviewSha(conversationDoc);

  const pushes = await loadActivity(meta, get).catch(() => undefined);
  // With push activity the timeline is only a fallback, so skip its extra page loads.
  const scan = await scanTimeline(conversationDoc, base, get, {
    headBranch: meta.headBranch,
    followPages: !pushes?.length,
  });
  return {
    meta,
    commits,
    pushes,
    forcePushes: scan.forcePushes,
    incomplete: !pushes?.length && (scan.failedPages > 0 || scan.collapsed > 0),
    via: 'html',
  };
}
