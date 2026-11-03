export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

/** One HeadRefForcePushedEvent: the branch head moved from `before` to `after`. */
export interface ForcePush {
  before: string;
  after: string;
  /** ISO timestamp of the push. */
  at?: string;
  actor?: string;
  /** Branch named in the event (HTML only), to tell head from base force-pushes. */
  branch?: string;
  /** GitHub collapses runs of force-pushes: "force-pushed … 11 times, most recently from A to B". */
  times?: number;
}

/** A commit that is currently part of the PR, oldest first. */
export interface PrCommit {
  sha: string;
  /** ISO timestamp: pushed date when known, otherwise committed date. */
  at?: string;
  author?: string;
  message?: string;
}

/** One push to the PR's head branch, from GitHub's repository activity. */
export interface Push {
  kind: 'push' | 'force_push' | 'branch_creation' | 'branch_deletion' | string;
  before?: string;
  /** Undefined for branch deletions. */
  after?: string;
  at: string;
  actor?: string;
  message?: string;
}

export interface PrMeta {
  headSha?: string;
  /** Head branch and the repository it lives in (a fork for cross-repo PRs). */
  headBranch?: string;
  headOwner?: string;
  headRepo?: string;
  baseBranch?: string;
  baseSha?: string;
  state?: string;
  createdAt?: string;
  /** Commit the signed-in user last submitted a review on, if any. */
  viewerReviewSha?: string;
}

/** Raw material for the version list, from either github.com HTML or the GraphQL API. */
export interface VersionSource {
  meta: PrMeta;
  forcePushes: ForcePush[];
  commits: PrCommit[];
  /** Push activity of the head branch. When present, versions are built from it (one per push). */
  pushes?: Push[];
  /** True when we know (or strongly suspect) that some timeline events were not seen. */
  incomplete: boolean;
  via: 'html' | 'api';
}

export interface Version {
  /** 1-based, oldest first. */
  n: number;
  sha: string;
  at?: string;
  actor?: string;
  /** This version was created by a force-push. */
  forcePushed: boolean;
  message?: string;
}

export interface VersionList {
  versions: Version[];
  meta: PrMeta;
  incomplete: boolean;
  via: VersionSource['via'];
}
