/**
 * After the extension is reloaded or updated, Chrome keeps the old content script running in
 * open tabs, but its extension context is gone: `chrome.storage` is undefined and messaging
 * throws. The old script must notice and shut itself down.
 */
export function extensionAlive(): boolean {
  try {
    return !!chrome.runtime?.id && !!chrome.storage?.local;
  } catch {
    return false;
  }
}
