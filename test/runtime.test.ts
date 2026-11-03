import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensionAlive } from '../src/runtime';
import { getLastViewed, getOptions, setLastViewed } from '../src/storage';

const pr = { owner: 'o', repo: 'r', number: 1 };

describe('orphaned content script (extension reloaded under the tab)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is detected when chrome.storage is gone', () => {
    vi.stubGlobal('chrome', { runtime: {} });
    expect(extensionAlive()).toBe(false);
    vi.stubGlobal('chrome', {
      runtime: {
        get id() {
          throw new Error('Extension context invalidated.');
        },
      },
    });
    expect(extensionAlive()).toBe(false);
  });

  it('makes storage calls no-ops instead of throwing', async () => {
    vi.stubGlobal('chrome', { runtime: {} });
    await expect(getOptions()).resolves.toEqual({});
    await expect(getLastViewed(pr)).resolves.toBeUndefined();
    await expect(setLastViewed(pr, 'abc')).resolves.toBeUndefined();
  });

  it('uses storage while the extension is alive', async () => {
    const get = vi.fn(async () => ({ options: { pat: 'x' } }));
    vi.stubGlobal('chrome', { runtime: { id: 'ext' }, storage: { local: { get } } });
    expect(extensionAlive()).toBe(true);
    await expect(getOptions()).resolves.toEqual({ pat: 'x' });
  });
});
