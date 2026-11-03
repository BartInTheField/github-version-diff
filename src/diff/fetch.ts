import { githubFetch } from '../github/net';

/** Fetch `.diff` text from github.com with the user's session, with a per-URL cache. */

export type DiffResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'not-found' | 'too-large' | 'timeout' | 'error'; status?: number };

const cache = new Map<string, Promise<DiffResult>>();

async function load(url: string): Promise<DiffResult> {
  const res = await githubFetch({ url });
  if (res.error) return { ok: false, reason: res.error === 'timeout' ? 'timeout' : 'error' };
  if (res.status === 404) return { ok: false, reason: 'not-found', status: 404 };
  if (!res.ok) {
    // GitHub answers oversized comparisons with 406/422/5xx or a timeout.
    const reason = [406, 422, 500, 502, 503, 504].includes(res.status) ? 'too-large' : 'error';
    return { ok: false, reason, status: res.status };
  }
  if (res.contentType.includes('text/html')) {
    // A login or error page instead of a diff: treat like a missing object.
    return { ok: false, reason: 'not-found', status: res.status };
  }
  return { ok: true, text: res.text };
}

export function fetchDiff(url: string): Promise<DiffResult> {
  let p = cache.get(url);
  if (!p) {
    p = load(url).catch((): DiffResult => ({ ok: false, reason: 'error' }));
    cache.set(url, p);
    // Do not pin failures: a retry may succeed (timeouts, transient 5xx).
    p.then((r) => {
      if (!r.ok) cache.delete(url);
    });
  }
  return p;
}
