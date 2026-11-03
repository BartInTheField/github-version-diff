import { describe, expect, it } from 'vitest';
import { isFilesTab, parsePrPath, patchDiffUrl, rawDiffUrl } from '../src/github/urls';

describe('urls', () => {
  it('parses PR paths and tabs', () => {
    expect(parsePrPath('/o/r/pull/12')).toEqual({ owner: 'o', repo: 'r', number: 12, tab: '' });
    expect(parsePrPath('/o/r/pull/12/files')?.tab).toBe('files');
    expect(isFilesTab(parsePrPath('/o/r/pull/12/files')!)).toBe(true);
    expect(isFilesTab(parsePrPath('/o/r/pull/12/changes')!)).toBe(true);
    expect(isFilesTab(parsePrPath('/o/r/pull/12/files/abc123..def456')!)).toBe(true);
    expect(isFilesTab(parsePrPath('/o/r/pull/12/commits')!)).toBe(false);
    expect(parsePrPath('/o/r/issues/12')).toBeUndefined();
  });

  it('builds compare URLs', () => {
    const pr = { owner: 'o', repo: 'r', number: 1 };
    expect(rawDiffUrl(pr, 'a', 'b')).toBe('https://github.com/o/r/compare/a..b.diff');
    expect(patchDiffUrl(pr, 'feat/x y', 'c')).toBe('https://github.com/o/r/compare/feat/x%20y...c.diff');
  });
});
