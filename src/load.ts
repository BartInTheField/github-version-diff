import { fetchDiff, type DiffResult } from './diff/fetch';
import { parseDiff, type FileDiff } from './diff/parse';
import { detectBaseDrift, rebaseFromMergeBases, type RebaseCheck } from './diff/rebase';
import { loadViaApi, mergeBase } from './github/api-source';
import { loadViaHtml } from './github/html-source';
import { patchDiffUrl, prKey, rawDiffUrl } from './github/urls';
import { getOptions } from './storage';
import type { PrRef, Version, VersionList } from './types';
import { buildVersions } from './versions';

/** Glue between data sources, caches and the UI. */

const versionCache = new Map<string, VersionList>();

export function cachedVersions(pr: PrRef): VersionList | undefined {
  return versionCache.get(prKey(pr));
}

/**
 * Load the version list (one version per push). With a PAT the GitHub API is used; without one,
 * github.com pages with the user's session. Falls back to the pages if the API fails.
 */
export async function loadVersions(pr: PrRef): Promise<VersionList & { apiError?: string }> {
  const { pat } = await getOptions();
  let apiError: string | undefined;
  if (pat) {
    try {
      const list = buildVersions(await loadViaApi(pr, pat));
      versionCache.set(prKey(pr), list);
      return list;
    } catch (e) {
      apiError = (e as Error).message;
    }
  }
  const list = buildVersions(await loadViaHtml(pr));
  versionCache.set(prKey(pr), list);
  return { ...list, apiError };
}

export type RangeCheck = RebaseCheck & {
  /** Why the range diff itself could not be loaded, if it could not. */
  rawError?: Exclude<DiffResult, { ok: true }>['reason'];
};

function files(r: DiffResult | undefined): FileDiff[] | undefined {
  return r?.ok ? parseDiff(r.text) : undefined;
}

/**
 * Does the range include a rebase? With a PAT: compare merge-bases (exact). Without: fetch the
 * range diff and the PR's patch at both versions and look for base-only changes.
 */
export async function checkRange(pr: PrRef, list: VersionList, from: Version, to: Version): Promise<RangeCheck> {
  const baseRef = list.meta.baseBranch ?? list.meta.baseSha;
  const none: RangeCheck = { rebased: null, baseOnlyFiles: [], method: 'none' };

  const { pat } = await getOptions();
  if (pat && baseRef) {
    try {
      const [mbX, mbY] = await Promise.all([mergeBase(pr, baseRef, from.sha, pat), mergeBase(pr, baseRef, to.sha, pat)]);
      const exact = rebaseFromMergeBases(mbX, mbY);
      if (exact !== null) return { rebased: exact, baseOnlyFiles: [], method: 'merge-base' };
    } catch {
      // Fall through to the token-less check.
    }
  }

  const [raw, patchX, patchY] = await Promise.all([
    fetchDiff(rawDiffUrl(pr, from.sha, to.sha)),
    baseRef ? fetchDiff(patchDiffUrl(pr, baseRef, from.sha)) : undefined,
    baseRef ? fetchDiff(patchDiffUrl(pr, baseRef, to.sha)) : undefined,
  ]);
  if (!raw.ok) return { ...none, rawError: raw.reason };
  const px = files(patchX);
  const py = files(patchY);
  if (!px || !py) return none;
  return detectBaseDrift(parseDiff(raw.text), px, py);
}
