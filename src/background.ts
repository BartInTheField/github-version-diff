import { directFetch, isGithubUrl, PROXY_MESSAGE, type NetRequest } from './github/net';

/** Proxies github.com requests for content scripts running on other sites (Linear). */
chrome.runtime.onMessage.addListener((msg: { type?: string; req?: NetRequest }, sender, sendResponse) => {
  if (msg?.type !== PROXY_MESSAGE || !msg.req) return false;
  // Only our own content scripts, and only github.com.
  if (sender.id !== chrome.runtime.id || !isGithubUrl(msg.req.url)) {
    sendResponse({ ok: false, status: 0, contentType: '', text: '', error: 'network' });
    return false;
  }
  directFetch(msg.req).then(sendResponse);
  return true;
});
