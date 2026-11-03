import type { PrRef } from './types';
import { prKey } from './github/urls';

export interface Options {
  /** Fine-grained PAT with read access to pull requests and contents. */
  pat?: string;
}

const LAST_VIEWED_PREFIX = 'lastViewed:';

export async function getOptions(): Promise<Options> {
  const { options } = await chrome.storage.local.get('options');
  return (options as Options | undefined) ?? {};
}

export async function setOptions(options: Options): Promise<void> {
  await chrome.storage.local.set({ options });
}

/** The newest version the user has looked at on this PR. */
export async function getLastViewed(pr: PrRef): Promise<string | undefined> {
  const key = LAST_VIEWED_PREFIX + prKey(pr);
  const got = await chrome.storage.local.get(key);
  return got[key] as string | undefined;
}

export async function setLastViewed(pr: PrRef, sha: string): Promise<void> {
  await chrome.storage.local.set({ [LAST_VIEWED_PREFIX + prKey(pr)]: sha });
}
