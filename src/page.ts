import { isFilesTab, parsePrPath, prKey } from './github/urls';
import type { PrRef } from './types';

/** Which PR the current page is about, and where we are. */
export interface PageContext {
  pr: PrRef;
  key: string;
  site: 'github' | 'linear';
}

/** Linear Diffs: `linear.review/o/r/pull/n` redirects to `linear.app/review/o/r/pull/n`. */
const LINEAR_REVIEW_RE = /\/review\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/;
const GITHUB_PR_LINK_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/;
/** Linear's PR chip in the review header: `<button aria-label="owner/repo#123, pull request actions">`. */
const LINEAR_PR_CHIP_RE = /^([\w.-]+)\/([\w.-]+)#(\d+), pull request\b/;

function ctx(owner: string, repo: string, n: string, site: PageContext['site']): PageContext {
  const pr = { owner, repo, number: Number(n) };
  return { pr, key: `${site}:${prKey(pr)}`, site };
}

export function detectPage(url: URL, doc: ParentNode): PageContext | undefined {
  if (url.hostname === 'github.com') {
    const loc = parsePrPath(url.pathname);
    return loc && isFilesTab(loc) ? ctx(loc.owner, loc.repo, String(loc.number), 'github') : undefined;
  }
  if (url.hostname === 'linear.app' && url.pathname.includes('/review/')) {
    const m = LINEAR_REVIEW_RE.exec(url.pathname);
    if (m) return ctx(m[1] as string, m[2] as string, m[3] as string, 'linear');
    // Workspace-scoped review URLs (`/<workspace>/review/<slug>/…`) don't carry the PR:
    // read it from the PR chip in the header, or from a GitHub link on the page.
    for (const el of Array.from(doc.querySelectorAll('[aria-label*="pull request"]'))) {
      const c = LINEAR_PR_CHIP_RE.exec(el.getAttribute('aria-label') ?? '');
      if (c) return ctx(c[1] as string, c[2] as string, c[3] as string, 'linear');
    }
    for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href^="https://github.com/"]'))) {
      const l = GITHUB_PR_LINK_RE.exec(a.href);
      if (l) return ctx(l[1] as string, l[2] as string, l[3] as string, 'linear');
    }
  }
  return undefined;
}
