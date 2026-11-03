/**
 * Requests to github.com with the user's session cookies.
 *
 * On github.com the content script fetches same-origin. Elsewhere (Linear's diff view), the
 * page origin would make these cross-origin requests that GitHub's CORS policy blocks, so they
 * go through the background service worker, which has a host permission for github.com.
 */

export const GITHUB = 'https://github.com';
export const TIMEOUT_MS = 45_000;

export interface NetRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface NetResponse {
  ok: boolean;
  /** 0 when the request failed before getting a response. */
  status: number;
  contentType: string;
  text: string;
  error?: 'timeout' | 'network';
}

export const PROXY_MESSAGE = 'prv-fetch';

export function isGithubUrl(url: string): boolean {
  return url.startsWith(`${GITHUB}/`);
}

/** Perform the request in the current context. Used directly on github.com and by the worker. */
export async function directFetch(req: NetRequest): Promise<NetResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(req.url, {
      method: req.method ?? 'GET',
      headers: req.headers,
      body: req.body,
      credentials: 'include',
      signal: ctrl.signal,
    });
    return { ok: res.ok, status: res.status, contentType: res.headers.get('content-type') ?? '', text: await res.text() };
  } catch (e) {
    const error = (e as Error).name === 'AbortError' ? 'timeout' : 'network';
    return { ok: false, status: 0, contentType: '', text: '', error };
  } finally {
    clearTimeout(timer);
  }
}

export async function githubFetch(req: NetRequest): Promise<NetResponse> {
  if (!isGithubUrl(req.url)) throw new Error(`Not a github.com URL: ${req.url}`);
  if (location.origin === GITHUB) return directFetch(req);
  try {
    const res = (await chrome.runtime.sendMessage({ type: PROXY_MESSAGE, req })) as NetResponse | undefined;
    return res ?? { ok: false, status: 0, contentType: '', text: '', error: 'network' };
  } catch {
    // "Extension context invalidated": the extension was reloaded under this tab.
    return { ok: false, status: 0, contentType: '', text: '', error: 'network' };
  }
}
