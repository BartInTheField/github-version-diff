import { describe, expect, it } from 'vitest';
import { parseTimelineNodes } from '../src/github/api-source';
import type { VersionSource } from '../src/types';
import { buildVersions, defaultRange, newSinceLastViewed, sameSha } from '../src/versions';
import { fixture } from './helpers';

const sha = (c: string) => c.repeat(40).slice(0, 40);
const src = (over: Partial<VersionSource>): VersionSource => ({
  meta: {},
  forcePushes: [],
  commits: [],
  incomplete: false,
  via: 'html',
  ...over,
});

describe('buildVersions', () => {
  it('uses one version per commit when there are no force-pushes', () => {
    const { versions } = buildVersions(
      src({
        commits: [
          { sha: sha('a'), at: '2026-01-01T10:00:00Z', message: 'first' },
          { sha: sha('b'), at: '2026-01-01T11:00:00Z' },
          { sha: sha('c'), at: '2026-01-01T12:00:00Z' },
        ],
        meta: { headSha: sha('c') },
      }),
    );
    expect(versions.map((v) => [v.n, v.sha[0], v.forcePushed])).toEqual([
      [1, 'a', false],
      [2, 'b', false],
      [3, 'c', false],
    ]);
    expect(versions[0]?.message).toBe('first');
  });

  it('chains force-pushes and captures normal pushes between them via `before`', () => {
    // a (pushed) → force-push a→b → normal push c on b → force-push c→d → normal push e on d
    const { versions } = buildVersions(
      src({
        forcePushes: [
          { before: sha('c'), after: sha('d'), at: '2026-01-01T13:00:00Z', actor: 'bot' },
          { before: sha('a'), after: sha('b'), at: '2026-01-01T11:00:00Z', actor: 'me' },
        ],
        commits: [
          { sha: sha('d'), at: '2026-01-01T12:59:00Z' },
          { sha: sha('e'), at: '2026-01-01T14:00:00Z' },
        ],
        meta: { headSha: sha('e') },
      }),
    );
    expect(versions.map((v) => `${v.n}:${v.sha[0]}:${v.forcePushed ? 'F' : '-'}`)).toEqual([
      '1:a:-',
      '2:b:F',
      '3:c:-',
      '4:d:F',
      '5:e:-',
    ]);
    expect(versions[1]?.actor).toBe('me');
    expect(versions[3]?.actor).toBe('bot');
  });

  it('keeps untouched commits that predate the first force-push (tip amended)', () => {
    const { versions } = buildVersions(
      src({
        forcePushes: [{ before: sha('b'), after: sha('c'), at: '2026-01-02T00:00:00Z' }],
        commits: [
          { sha: sha('a'), at: '2026-01-01T00:00:00Z' },
          { sha: sha('c'), at: '2026-01-01T23:59:00Z' },
        ],
        meta: { headSha: sha('c') },
      }),
    );
    expect(versions.map((v) => v.sha[0])).toEqual(['a', 'b', 'c']);
  });

  it('appends the head when it is not covered by any event', () => {
    const { versions } = buildVersions(src({ meta: { headSha: sha('f') } }));
    expect(versions).toHaveLength(1);
    expect(versions[0]?.sha).toBe(sha('f'));
  });

  it('flags the list as incomplete when the last seen force-push target was rewritten', () => {
    const list = buildVersions(
      src({
        forcePushes: [{ before: sha('a'), after: sha('b'), at: '2026-01-01T00:00:00Z' }],
        commits: [{ sha: sha('z'), at: '2026-01-03T00:00:00Z' }],
        meta: { headSha: sha('z') },
      }),
    );
    expect(list.incomplete).toBe(true);
  });

  it('matches abbreviated SHAs', () => {
    expect(sameSha('6ec1ba5', '6ec1ba54542baca6cc5932582634104c83f36a28')).toBe(true);
    expect(sameSha('6ec1ba', '6ec1ba54542baca6cc5932582634104c83f36a28')).toBe(false);
  });

  it('builds 15 versions for cli/cli#14768 from recorded GraphQL data', () => {
    const p = JSON.parse(fixture('pr14768-graphql.json')).data.repository.pullRequest;
    const { forcePushes, commits } = parseTimelineNodes(p.timelineItems.nodes);
    expect(forcePushes).toHaveLength(14);
    const list = buildVersions(
      src({ forcePushes, commits, meta: { headSha: p.headRefOid, baseBranch: p.baseRefName }, via: 'api' }),
    );
    const v = list.versions;
    expect(v).toHaveLength(15);
    expect(v[0]?.sha.slice(0, 7)).toBe('04b3929');
    expect(v[0]?.forcePushed).toBe(false);
    expect(v.slice(1).every((x) => x.forcePushed)).toBe(true);
    expect(v[14]?.sha).toBe(p.headRefOid);
    expect(list.incomplete).toBe(false);
  });
});

describe('defaultRange / newSinceLastViewed', () => {
  const versions = buildVersions(
    src({ commits: ['a', 'b', 'c', 'd'].map((c) => ({ sha: sha(c) })) }),
  ).versions;

  it('defaults to previous → latest', () => {
    expect(defaultRange(versions)?.map((v) => v.n)).toEqual([3, 4]);
  });

  it('prefers last viewed → latest', () => {
    expect(defaultRange(versions, sha('a'))?.map((v) => v.n)).toEqual([1, 4]);
    expect(newSinceLastViewed(versions, sha('a'))).toBe(3);
  });

  it('falls back when last viewed is the latest or unknown', () => {
    expect(defaultRange(versions, sha('d'))?.map((v) => v.n)).toEqual([3, 4]);
    expect(defaultRange(versions, sha('x'))?.map((v) => v.n)).toEqual([3, 4]);
    expect(newSinceLastViewed(versions, sha('x'))).toBe(0);
  });

  it('needs two versions', () => {
    expect(defaultRange(versions.slice(0, 1))).toBeUndefined();
  });
});
