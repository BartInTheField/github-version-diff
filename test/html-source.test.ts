import { describe, expect, it } from 'vitest';
import {
  findTimelineGapLoaders,
  forcePushesFromJson,
  parseCommitsPage,
  parseForcePushes,
  scanTimeline,
} from '../src/github/html-source';
import { buildVersions } from '../src/versions';
import { doc, fixture } from './helpers';

const pr = { owner: 'cli', repo: 'cli', number: 14768 };
const base = 'https://github.com/cli/cli/pull/14768';

describe('Conversation page (recorded, logged out)', () => {
  const page = doc(fixture('pr14768-conversation.html'));

  it('extracts the visible force-push events with actor and time', () => {
    const fps = parseForcePushes(page);
    expect(fps.map((f) => `${f.before.slice(0, 7)}..${f.after.slice(0, 7)}`)).toEqual([
      '04b3929..831b934',
      '831b934..b38159e',
      '128b7c6..15e431d',
      '15e431d..6ec1ba5',
    ]);
    expect(fps.every((f) => f.actor === 'babakks')).toBe(true);
    expect(fps[0]?.at).toBe('2026-10-21T09:42:30Z');
  });

  it('finds the progressive loader for the hidden middle of the timeline', () => {
    const loaders = findTimelineGapLoaders(page);
    expect(loaders).toHaveLength(1);
    expect(loaders[0]).toMatch(/^cli\/cli\/timeline_focused_item\?/);
  });

  it('reports incomplete when the hidden part cannot be loaded', async () => {
    const scan = await scanTimeline(page, base, async () => {
      throw new Error('404');
    });
    expect(scan.forcePushes).toHaveLength(4);
    expect(scan.failedPages).toBe(1);
  });

  it('merges force-pushes from loaded pages', async () => {
    const urls: string[] = [];
    const scan = await scanTimeline(page, base, async (url) => {
      urls.push(url);
      return `<div class="TimelineItem"><svg class="octicon octicon-repo-push"></svg>
        <a class="author" href="/x">someone</a>
        <a href="/cli/cli/compare/${'b'.repeat(40)}..${'c'.repeat(40)}">force-pushed</a>
        <relative-time datetime="2026-10-21T10:00:00Z"></relative-time></div>`;
    });
    expect(urls[0]).toMatch(/^https:\/\/github\.com\/cli\/cli\/timeline_focused_item\?after_cursor=/);
    expect(scan.failedPages).toBe(0);
    expect(scan.forcePushes).toHaveLength(5);
    expect(scan.forcePushes.find((f) => f.actor === 'someone')?.before).toBe('b'.repeat(40));
  });

  it('ignores compare links that are not force-pushes', () => {
    const d = doc('<div class="TimelineItem">see <a href="/o/r/compare/abcdef1..1234567">this</a></div>');
    expect(parseForcePushes(d)).toEqual([]);
  });
});

describe('Commits page (recorded)', () => {
  it('reads the commit list and PR metadata from embedded JSON', () => {
    const { meta, commits } = parseCommitsPage(doc(fixture('pr14768-commits.html')), pr);
    expect(commits.map((c) => c.sha.slice(0, 7))).toEqual(['fd1b1fe', '6ec1ba5']);
    expect(commits[0]?.message).toBe('chore(deps): bump github.com/cli/oauth to v1.3.0');
    expect(meta).toMatchObject({ headSha: '6ec1ba54542baca6cc5932582634104c83f36a28', baseBranch: 'trunk', state: 'MERGED' });
  });

  it('falls back to commit links on a classic page', () => {
    const s1 = '1'.repeat(40);
    const s2 = '2'.repeat(40);
    const d = doc(`<a href="/o/r/pull/7/commits/${s1}">a</a><a href="/o/r/pull/7/commits/${s1}">dup</a>
      <a href="/o/r/pull/7/commits/${s2}">b</a>`);
    const { meta, commits } = parseCommitsPage(d, { owner: 'o', repo: 'r', number: 7 });
    expect(commits.map((c) => c.sha)).toEqual([s1, s2]);
    expect(meta.headSha).toBe(s2);
  });
});

describe('embedded GraphQL-shaped timeline', () => {
  it('finds force-push nodes anywhere in the JSON', () => {
    const json = {
      payload: {
        timeline: {
          edges: [
            { node: { __typename: 'IssueComment' } },
            { node: { createdAt: 't', actor: { login: 'x' }, beforeCommit: { oid: 'a1b2c3d' }, afterCommit: { oid: 'd4e5f60' } } },
          ],
        },
      },
    };
    expect(forcePushesFromJson(json)).toEqual([{ before: 'a1b2c3d', after: 'd4e5f60', at: 't', actor: 'x' }]);
  });
});

describe('HTML end to end', () => {
  it('builds a version list from the visible events and marks it incomplete', async () => {
    const page = doc(fixture('pr14768-conversation.html'));
    const scan = await scanTimeline(page, base, async () => {
      throw new Error('404');
    });
    const { meta, commits } = parseCommitsPage(doc(fixture('pr14768-commits.html')), pr);
    const list = buildVersions({ meta, commits, forcePushes: scan.forcePushes, incomplete: scan.failedPages > 0, via: 'html' });
    expect(list.incomplete).toBe(true);
    expect(list.versions.map((v) => v.sha.slice(0, 7))).toEqual([
      '04b3929',
      '831b934',
      'b38159e',
      '128b7c6',
      '15e431d',
      '6ec1ba5',
    ]);
  });
});
