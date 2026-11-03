import { describe, expect, it } from 'vitest';
import { detectPage } from '../src/page';
import { doc } from './helpers';

const empty = doc('');

describe('detectPage', () => {
  it('detects the GitHub Files tab only', () => {
    expect(detectPage(new URL('https://github.com/o/r/pull/5/files'), empty)).toMatchObject({
      pr: { owner: 'o', repo: 'r', number: 5 },
      site: 'github',
    });
    expect(detectPage(new URL('https://github.com/o/r/pull/5'), empty)).toBeUndefined();
  });

  it('detects Linear Diffs review URLs', () => {
    for (const u of ['https://linear.app/review/o/r/pull/7', 'https://linear.app/acme/review/o/r/pull/7/files']) {
      expect(detectPage(new URL(u), empty)).toMatchObject({ pr: { owner: 'o', repo: 'r', number: 7 }, site: 'linear' });
    }
  });

  it('falls back to the GitHub PR link on a Linear review page', () => {
    const d = doc('<a href="https://github.com/o/r/issues/1">x</a><a href="https://github.com/o/r/pull/9">PR</a>');
    expect(detectPage(new URL('https://linear.app/acme/review/abc123'), d)?.pr.number).toBe(9);
  });

  it('reads the PR chip on workspace-scoped review URLs (recorded markup)', () => {
    const d = doc(`<div data-menu-open="false"><button type="button"
      aria-label="acme/app#9337, pull request actions" class="sx-3nfvp2"></button></div>
      <button aria-label="Pull request menu"></button>`);
    const page = detectPage(new URL('https://linear.app/acme/review/fix-something-cfebda80434c/review'), d);
    expect(page).toMatchObject({ pr: { owner: 'acme', repo: 'app', number: 9337 }, site: 'linear' });
  });

  it('ignores other Linear pages, even with PR links', () => {
    const d = doc('<a href="https://github.com/o/r/pull/9">PR</a>');
    expect(detectPage(new URL('https://linear.app/acme/issue/ENG-1'), d)).toBeUndefined();
  });

  it('keeps GitHub and Linear pickers apart', () => {
    const a = detectPage(new URL('https://github.com/o/r/pull/5/files'), empty);
    const b = detectPage(new URL('https://linear.app/review/o/r/pull/5'), empty);
    expect(a?.key).not.toBe(b?.key);
  });
});
