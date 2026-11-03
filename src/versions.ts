import type { ForcePush, PrCommit, Push, Version, VersionList, VersionSource } from './types';

/** SHAs from HTML can be abbreviated; treat a prefix match of at least 7 chars as equal. */
export function sameSha(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 7 && long.startsWith(short);
}

function time(iso: string | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? NaN : t;
}

function commitVersion(c: PrCommit): Omit<Version, 'n'> {
  return { sha: c.sha, at: c.at, actor: c.author, forcePushed: false, message: c.message };
}

/**
 * Turn the raw material into an ordered list of versions (successive states of the PR head).
 *
 * Preferred: push activity (see `buildFromPushes`). Fallback, from the timeline:
 * - Each force-push contributes its `before` (the head right before the push, which
 *   also captures any normal pushes since the previous force-push) and its `after`.
 * - Commits pushed normally after the last force-push are one version each.
 * - Commits still in the history that predate the first force-push (e.g. the tip was
 *   amended but earlier commits kept) are versions too.
 *
 * Commits that were pushed normally and later rewritten are gone from GitHub's record,
 * except for the last one before each force-push.
 */
export function buildVersions(src: VersionSource): VersionList {
  if (src.pushes?.length) {
    const fromPushes = buildFromPushes(src.pushes, src);
    if (fromPushes) return fromPushes;
    // Activity did not cover this PR; the timeline was not fully loaded in that case.
    return buildFromTimeline({ ...src, incomplete: true });
  }
  return buildFromTimeline(src);
}

/**
 * One version per push, the way Graphite counts: v1 is the head when the PR was opened, then
 * every later push (normal or force) to the head branch, up to the PR's current head.
 * Returns undefined when the activity does not cover this PR (e.g. a reused branch name with
 * no push matching the PR's head), so the caller can fall back to the timeline.
 */
export function buildFromPushes(pushes: Push[], src: VersionSource): VersionList | undefined {
  const { meta, commits } = src;
  const states = pushes
    .filter((p): p is Push & { after: string } => !!p.after && p.kind !== 'branch_deletion')
    .sort((a, b) => time(a.at) - time(b.at));
  if (states.length === 0) return undefined;

  let incomplete = src.incomplete;

  // Start at the last push at or before PR creation: the state the PR was opened with.
  const created = time(meta.createdAt);
  let start = 0;
  if (!Number.isNaN(created)) {
    const before = states.filter((p) => time(p.at) <= created);
    if (before.length) start = states.lastIndexOf(before[before.length - 1]!);
    else incomplete = true; // Activity starts after the PR was opened: early versions are gone.
  }

  // End at the PR's head (the branch may have been reused or pushed after merge).
  let end = states.length;
  if (meta.headSha) {
    let headIdx = -1;
    states.forEach((p, i) => {
      if (i >= start && sameSha(p.after, meta.headSha)) headIdx = i;
    });
    if (headIdx < 0) return undefined;
    end = headIdx + 1;
  }

  const messageOf = (sha: string) => commits.find((c) => sameSha(c.sha, sha))?.message;
  const out: Omit<Version, 'n'>[] = [];
  for (const p of states.slice(start, end)) {
    const last = out[out.length - 1];
    if (last && sameSha(last.sha, p.after)) continue;
    out.push({
      sha: p.after,
      at: p.at,
      actor: p.actor,
      forcePushed: p.kind === 'force_push',
      message: p.message?.split('\n')[0] ?? messageOf(p.after),
    });
  }
  return { versions: out.map((v, i) => ({ ...v, n: i + 1 })), meta, incomplete, via: src.via };
}

/**
 * Fallback without push activity: rebuild versions from force-push events plus the PR's
 * current commit list.
 */
function buildFromTimeline(src: VersionSource): VersionList {
  const { commits, meta } = src;
  const forcePushes = [...src.forcePushes].sort((a, b) => {
    const ta = time(a.at);
    const tb = time(b.at);
    return Number.isNaN(ta) || Number.isNaN(tb) ? 0 : ta - tb;
  });

  const out: Omit<Version, 'n'>[] = [];
  const add = (v: Omit<Version, 'n'>) => {
    const last = out[out.length - 1];
    if (last && sameSha(last.sha, v.sha)) {
      // Same head reached twice in a row (e.g. a commit that is also a force-push target):
      // keep one entry but remember the richer metadata.
      if (v.forcePushed) {
        last.forcePushed = true;
        last.at = v.at ?? last.at;
        last.actor = v.actor ?? last.actor;
      }
      last.message ??= v.message;
      return;
    }
    out.push({ ...v });
  };
  const indexOf = (sha: string) => commits.findIndex((c) => sameSha(c.sha, sha));

  if (forcePushes.length === 0) {
    commits.forEach((c) => add(commitVersion(c)));
  } else {
    const first = forcePushes[0] as ForcePush;
    const last = forcePushes[forcePushes.length - 1] as ForcePush;

    const firstAfterIdx = indexOf(first.after);
    const t0 = time(first.at);
    commits.forEach((c, i) => {
      const inHistoryBefore = firstAfterIdx < 0 || i < firstAfterIdx;
      if (inHistoryBefore && time(c.at) < t0) add(commitVersion(c));
    });

    for (const fp of forcePushes) {
      const known = commits[indexOf(fp.before)];
      add({ sha: fp.before, forcePushed: false, at: known?.at, message: known?.message });
      const after = commits[indexOf(fp.after)];
      add({ sha: fp.after, forcePushed: true, at: fp.at, actor: fp.actor, message: after?.message });
    }

    const lastIdx = indexOf(last.after);
    if (lastIdx >= 0) {
      commits.slice(lastIdx + 1).forEach((c) => add(commitVersion(c)));
    } else {
      const tLast = time(last.at);
      commits.filter((c) => time(c.at) > tLast).forEach((c) => add(commitVersion(c)));
    }
  }

  if (meta.headSha) {
    const head = commits[indexOf(meta.headSha)];
    add(head ? commitVersion(head) : { sha: meta.headSha, forcePushed: false });
  }

  return {
    versions: out.map((v, i) => ({ ...v, n: i + 1 })),
    meta,
    incomplete: src.incomplete || looksIncomplete(src),
    via: src.via,
  };
}

/**
 * If the newest force-push we saw landed on a SHA that is neither in the current history
 * nor the head, a later force-push must have rewritten it: we missed timeline events.
 */
function looksIncomplete(src: VersionSource): boolean {
  const last = src.forcePushes.reduce<ForcePush | undefined>(
    (acc, fp) => (!acc || time(fp.at) >= time(acc.at) ? fp : acc),
    undefined,
  );
  if (!last || src.commits.length === 0) return false;
  return !src.commits.some((c) => sameSha(c.sha, last.after)) && !sameSha(src.meta.headSha, last.after);
}

/** Default comparison: last viewed → latest if we have it, else previous → latest. */
export function defaultRange(versions: Version[], lastViewedSha?: string): [Version, Version] | undefined {
  if (versions.length < 2) return undefined;
  const latest = versions[versions.length - 1] as Version;
  const lastViewed = lastViewedSha ? versions.find((v) => sameSha(v.sha, lastViewedSha)) : undefined;
  if (lastViewed && lastViewed !== latest) return [lastViewed, latest];
  return [versions[versions.length - 2] as Version, latest];
}

/** Number of versions newer than the one the user last looked at. */
export function newSinceLastViewed(versions: Version[], lastViewedSha?: string): number {
  if (!lastViewedSha) return 0;
  const idx = versions.findIndex((v) => sameSha(v.sha, lastViewedSha));
  return idx < 0 ? 0 : versions.length - 1 - idx;
}
