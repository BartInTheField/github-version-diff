import type { PrRef } from '../types';
import { GITHUB } from './net';

const PR_PATH_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/([^?#]*))?/;

export interface PrLocation extends PrRef {
  /** Path after the PR number, e.g. "files", "changes", "commits", "" for Conversation. */
  tab: string;
}

export function parsePrPath(pathname: string): PrLocation | undefined {
  const m = PR_PATH_RE.exec(pathname);
  if (!m) return undefined;
  return { owner: m[1] as string, repo: m[2] as string, number: Number(m[3]), tab: (m[4] ?? '').replace(/\/$/, '') };
}

/** The Files tab: classic `/files` and the newer `/changes` experience (plus per-commit views). */
export function isFilesTab(loc: PrLocation): boolean {
  return /^(files|changes)(\/|$)/.test(loc.tab);
}

export function prKey(pr: PrRef): string {
  return `${pr.owner}/${pr.repo}#${pr.number}`;
}

/** Branch names may contain slashes; encode each segment but keep the separators. */
export function encodeRef(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/');
}

/** Tree diff between two versions (two-dot). */
export function rawDiffUrl(pr: PrRef, from: string, to: string): string {
  return `${GITHUB}/${pr.owner}/${pr.repo}/compare/${from}..${to}.diff`;
}

/** The PR's own patch at one version: diff from the merge-base with the base branch (three-dot). */
export function patchDiffUrl(pr: PrRef, baseRef: string, sha: string): string {
  return `${GITHUB}/${pr.owner}/${pr.repo}/compare/${encodeRef(baseRef)}...${sha}.diff`;
}

/** GitHub's own compare page between two versions. */
export function compareHtmlUrl(pr: PrRef, from: string, to: string): string {
  return `${GITHUB}/${pr.owner}/${pr.repo}/compare/${from}..${to}`;
}

/** GitHub's compare page for the whole PR at one version (three-dot, from the merge-base). */
export function baseCompareHtmlUrl(pr: PrRef, baseRef: string, sha: string): string {
  return `${GITHUB}/${pr.owner}/${pr.repo}/compare/${encodeRef(baseRef)}...${sha}`;
}
