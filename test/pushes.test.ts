import { describe, expect, it } from 'vitest';
import { parseActivityItems, parseTimelineNodes } from '../src/github/api-source';
import { loadViaHtml, parseActivityPage, scanTimeline, viewerReviewSha } from '../src/github/html-source';
import type { Push, VersionSource } from '../src/types';
import { buildVersions } from '../src/versions';
import { doc, fixture } from './helpers';

const sha = (n: number) => n.toString(16).padStart(40, 'a');
const at = (min: number) => new Date(Date.UTC(2026, 10, 2, 10, 0, 0) + min * 60_000).toISOString();
const src = (pushes: Push[], meta: VersionSource['meta'] = {}): VersionSource => ({
  meta,
  pushes,
  forcePushes: [],
  commits: [],
  incomplete: false,
  via: 'html',
});

describe('versions from push activity (Graphite model)', () => {
  it('counts the opening state plus one version per push: a stacked, babysat PR', () => {
    // Shape of a real PR: branch created, PR opened 12 s later, 20 force-pushes, branch deleted on merge.
    const pushes: Push[] = [{ kind: 'branch_creation', after: sha(0), at: at(0) }];
    for (let i = 1; i <= 20; i++) pushes.push({ kind: 'force_push', before: sha(i - 1), after: sha(i), at: at(i * 10) });
    pushes.push({ kind: 'branch_deletion', before: sha(20), at: at(300) });
    const list = buildVersions(src(pushes, { headSha: sha(20), createdAt: at(0.2) }));
    expect(list.versions).toHaveLength(21);
    expect(list.versions[0]).toMatchObject({ n: 1, sha: sha(0), forcePushed: false });
    expect(list.versions.slice(1).every((v) => v.forcePushed)).toBe(true);
    expect(list.versions[20]?.sha).toBe(sha(20));
    expect(list.incomplete).toBe(false);
  });

  it('treats one normal push of several commits as one version', () => {
    const list = buildVersions(
      src(
        [
          { kind: 'branch_creation', after: sha(1), at: at(0) },
          { kind: 'push', before: sha(1), after: sha(4), at: at(5) },
        ],
        { headSha: sha(4), createdAt: at(1) },
      ),
    );
    expect(list.versions.map((v) => v.sha)).toEqual([sha(1), sha(4)]);
  });

  it('starts at the state the PR was opened with and stops at its head (reused branch)', () => {
    const pushes: Push[] = [
      { kind: 'branch_creation', after: sha(1), at: at(0) },
      { kind: 'push', after: sha(2), at: at(1) },
      { kind: 'branch_deletion', before: sha(2), at: at(2) },
      { kind: 'branch_creation', after: sha(3), at: at(10) },
      { kind: 'push', after: sha(4), at: at(11) },
      { kind: 'push', after: sha(5), at: at(20) },
      { kind: 'push', after: sha(6), at: at(30) }, // after the PR was closed at sha(5)
    ];
    const list = buildVersions(src(pushes, { headSha: sha(5), createdAt: at(12) }));
    expect(list.versions.map((v) => v.sha)).toEqual([sha(4), sha(5)]);
  });

  it('falls back to the timeline when activity does not reach the PR head', () => {
    const list = buildVersions({
      ...src([{ kind: 'push', after: sha(1), at: at(0) }], { headSha: sha(9), createdAt: at(0) }),
      commits: [{ sha: sha(9) }],
    });
    expect(list.versions.map((v) => v.sha)).toEqual([sha(9)]);
    expect(list.incomplete).toBe(true);
  });

  it('flags missing early history when activity starts after the PR was opened', () => {
    const list = buildVersions(src([{ kind: 'push', after: sha(1), at: at(10) }], { headSha: sha(1), createdAt: at(0) }));
    expect(list.incomplete).toBe(true);
  });

  it('reads REST activity items, mapping zero SHAs to undefined', () => {
    expect(
      parseActivityItems([
        { activity_type: 'branch_creation', before: '0'.repeat(40), after: sha(1), timestamp: 't', actor: { login: 'me' } },
      ]),
    ).toEqual([{ kind: 'branch_creation', before: undefined, after: sha(1), at: 't', actor: 'me' }]);
  });
});

describe('Activity page (recorded, cli/cli#14768 branch)', () => {
  it('lists every push, newest first', () => {
    const page = parseActivityPage(doc(fixture('pr14768-activity.html')))!;
    expect(page.pushes).toHaveLength(16);
    expect(page.pushes.map((p) => p.kind).filter((k) => k === 'force_push')).toHaveLength(14);
    expect(page.hasNextPage).toBe(false);
  });

  it('gives the same 15 versions as the GraphQL timeline, without a token', async () => {
    const pages: Record<string, string> = {
      'https://github.com/cli/cli/pull/14768': fixture('pr14768-conversation.html'),
      'https://github.com/cli/cli/pull/14768/commits': fixture('pr14768-commits.html'),
      'https://github.com/cli/cli/activity?ref=babakks%2Frefresh-token-bump-deps': fixture('pr14768-activity.html'),
    };
    const requested: string[] = [];
    const source = await loadViaHtml({ owner: 'cli', repo: 'cli', number: 14768 }, async (url) => {
      requested.push(url);
      const page = pages[url];
      if (!page) throw new Error(`unexpected ${url}`);
      return page;
    });
    const list = buildVersions(source);

    const p = JSON.parse(fixture('pr14768-graphql.json')).data.repository.pullRequest;
    const { forcePushes } = parseTimelineNodes(p.timelineItems.nodes);
    const expected = [forcePushes[0]!.before, ...forcePushes.map((f) => f.after)];
    expect(list.versions.map((v) => v.sha)).toEqual(expected);
    expect(list.incomplete).toBe(false);
    // With activity available, the hidden-timeline loader is not requested.
    expect(requested.some((u) => u.includes('timeline_focused_item'))).toBe(false);
  });
});

describe('timeline fallback fixes', () => {
  const item = (branch: string, before: string, after: string, extra = '') => `
    <div class="TimelineItem"><svg class="octicon octicon-repo-push"></svg>
      <a class="author">me</a> <a href="/o/r/compare/${before}..${after}">force-pushed</a>
      the <span class="commit-ref">${branch}</span> branch ${extra} from x to y
      <relative-time datetime="2026-11-02T10:00:00Z"></relative-time></div>`;

  it('ignores force-pushes of the base branch (stacked PRs)', async () => {
    const d = doc(item('feature/base', sha(1), sha(2)) + item('feature/head', sha(3), sha(4)));
    const scan = await scanTimeline(d, 'https://github.com/o/r/pull/1', async () => '', { headBranch: 'feature/head' });
    expect(scan.forcePushes.map((f) => f.after)).toEqual([sha(4)]);
  });

  it('counts force-pushes hidden in collapsed "N times" items', async () => {
    const scan = await scanTimeline(doc(fixture('pr14768-conversation.html')), 'https://github.com/cli/cli/pull/14768', async () => {
      throw new Error('404');
    });
    expect(scan.collapsed).toBe(10);
  });
});

describe('viewerReviewSha', () => {
  it("reads the signed-in user's latest review commit from the reviewers sidebar", () => {
    const d = doc(`<meta name="user-login" content="me">
      <a id="review-status-other" href="/o/r/pull/1/files/${sha(1)}"></a>
      <a id="review-status-me" href="/o/r/pull/1/files/${sha(2)}"></a>`);
    expect(viewerReviewSha(d)).toBe(sha(2));
  });

  it('is undefined when logged out or not a reviewer', () => {
    expect(viewerReviewSha(doc(`<a id="review-status-me" href="/o/r/pull/1/files/${sha(2)}"></a>`))).toBeUndefined();
    expect(viewerReviewSha(doc('<meta name="user-login" content="me">'))).toBeUndefined();
  });
});
