import { displayPath, type FileDiff } from './parse';

/**
 * The parts of a file's patch that describe the PR's change, without anything a rebase
 * shifts around: hunk line numbers and blob ids are dropped. For binary files the new blob
 * id is the only content signal, so it stays.
 */
export function normalizePatch(f: FileDiff): string {
  const out: string[] = [];
  if (f.status === 'renamed' || f.status === 'copied') out.push(`${f.status} ${f.oldPath} → ${f.newPath}`);
  out.push(...f.modeLines);
  if (f.binary) out.push(`binary ${f.newBlob ?? ''}`);
  for (const h of f.hunks) {
    out.push(`@@ ${h.section}`.trimEnd());
    out.push(...h.lines);
  }
  return out.join('\n') + '\n';
}

export interface RebaseCheck {
  /** null when the check could not decide (e.g. a patch was unavailable). */
  rebased: boolean | null;
  /** Files whose change between the versions came from the base branch, not the PR. */
  baseOnlyFiles: string[];
  method: 'merge-base' | 'heuristic' | 'none';
}

/**
 * Exact check: the merge-base with the base branch differs between the two versions.
 * Needs the GitHub API (see api-source.ts).
 */
export function rebaseFromMergeBases(mbX: string | undefined, mbY: string | undefined): boolean | null {
  if (!mbX || !mbY) return null;
  return mbX !== mbY;
}

/**
 * Token-less check: a file changed between the two versions whose PR patch is identical in
 * both (or absent from both) can only have changed through the base branch.
 */
export function detectBaseDrift(raw: FileDiff[], patchX: FileDiff[], patchY: FileDiff[]): RebaseCheck {
  if (patchX.length === 0 || patchY.length === 0) {
    // An empty patch usually means the version is already contained in the base branch
    // (merged with a merge commit), which makes the comparison meaningless.
    return { rebased: null, baseOnlyFiles: [], method: 'none' };
  }
  const index = (fs: FileDiff[]) => {
    const m = new Map<string, FileDiff>();
    for (const f of fs) {
      m.set(f.newPath, f);
      m.set(f.oldPath, f);
    }
    return m;
  };
  const ix = index(patchX);
  const iy = index(patchY);

  const baseOnlyFiles: string[] = [];
  for (const f of raw) {
    const path = displayPath(f);
    const fx = ix.get(f.newPath) ?? ix.get(f.oldPath);
    const fy = iy.get(f.newPath) ?? iy.get(f.oldPath);
    if (!fx && !fy) baseOnlyFiles.push(path);
    else if (fx && fy && normalizePatch(fx) === normalizePatch(fy)) baseOnlyFiles.push(path);
  }
  return { rebased: baseOnlyFiles.length > 0, baseOnlyFiles, method: 'heuristic' };
}
